/**
 * Topics Sheet Module
 * Google Sheets is the store you actually look at: a `Videos` tab with one row
 * per video, and a `Topics` tab with one row per (topic, video) pair so the
 * table can be filtered and pivoted by subject.
 *
 * Writes are idempotent - re-sending the same link updates its row in place
 * rather than appending a duplicate.
 *
 * Formula injection (threat T5) is handled twice over: `valueInputOption: RAW`
 * means Sheets stores the literal string, and `sanitizeCell` also prefixes the
 * dangerous leading characters so a later CSV export is safe too.
 */

const { google } = require('googleapis');
const fs = require('fs');
const config = require('../config');
const logger = require('../logger');
const { formatReposCell } = require('./githubEnricher');

const VIDEO_HEADERS = [
  'id', 'added_at', 'platform', 'url', 'title', 'channel', 'published_at',
  'duration_min', 'content_type', 'topics', 'tldr', 'key_points', 'action_items',
  'tools_mentioned', 'people', 'github_repos', 'links', 'transcript_source',
  'confidence', 'archive_path'
];

const TOPIC_HEADERS = [
  'topic', 'video_id', 'title', 'url', 'added_at', 'relevance', 'why'
];

/** Leading characters a spreadsheet would interpret as the start of a formula. */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/**
 * Make a value safe to place in a spreadsheet cell.
 * @param {*} value - Any value
 * @returns {string} Sanitized cell text
 */
function sanitizeCell(value) {
  if (value === null || value === undefined) {
    return '';
  }

  let text = Array.isArray(value) ? value.join('\n') : String(value);

  // Sheets caps a cell at 50k characters; stay under it with room to spare.
  if (text.length > 45000) {
    text = `${text.slice(0, 45000)}…[truncated]`;
  }

  return FORMULA_PREFIX.test(text) ? `'${text}` : text;
}

/**
 * Google Sheets store for video digests.
 */
class TopicsSheet {
  /**
   * @param {Object} [options] - Overrides
   * @param {string} [options.spreadsheetId] - Target spreadsheet
   * @param {Object} [options.sheetsClient] - Pre-built googleapis sheets client (for testing)
   */
  constructor(options = {}) {
    this.spreadsheetId = options.spreadsheetId || config.video.sheetId;
    this.credentialsPath = config.googleSheets.credentialsPath;
    this.videosTab = config.video.videosTab;
    this.topicsTab = config.video.topicsTab;
    this.sheets = options.sheetsClient || null;
  }

  /**
   * Whether Sheets output is configured at all.
   * @returns {boolean} True when a spreadsheet id is set
   */
  isConfigured() {
    return Boolean(this.spreadsheetId);
  }

  /**
   * Authenticate and build the Sheets client.
   * @returns {Promise<void>}
   * @throws {Error} When credentials or the spreadsheet id are missing
   */
  async initialize() {
    if (this.sheets) {
      return;
    }

    if (!this.spreadsheetId) {
      throw new Error('VIDEO_SHEET_ID (or GOOGLE_SHEET_ID) is not configured');
    }

    if (!fs.existsSync(this.credentialsPath)) {
      throw new Error(
        `Google credentials not found at ${this.credentialsPath}. See GOOGLE_SHEETS_SETUP.md.`
      );
    }

    const credentials = JSON.parse(fs.readFileSync(this.credentialsPath, 'utf8'));
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    this.sheets = google.sheets({ version: 'v4', auth });
    logger.info('Google Sheets client ready');
  }

  /**
   * Create the tabs and header rows if they do not exist yet.
   * @returns {Promise<void>}
   */
  async ensureTabs() {
    await this.initialize();

    const meta = await this.sheets.spreadsheets.get({ spreadsheetId: this.spreadsheetId });
    const existing = new Set(meta.data.sheets.map((s) => s.properties.title));

    const missing = [this.videosTab, this.topicsTab].filter((tab) => !existing.has(tab));
    if (missing.length > 0) {
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        resource: {
          requests: missing.map((title) => ({ addSheet: { properties: { title } } }))
        }
      });
      logger.success(`Created sheet tab(s): ${missing.join(', ')}`);
    }

    await this.ensureHeaders(this.videosTab, VIDEO_HEADERS);
    await this.ensureHeaders(this.topicsTab, TOPIC_HEADERS);
  }

  /**
   * Write the header row if the tab is empty.
   * @param {string} tab - Tab name
   * @param {Array<string>} headers - Header labels
   * @returns {Promise<void>}
   */
  async ensureHeaders(tab, headers) {
    const range = `${tab}!A1:${columnLetter(headers.length)}1`;
    const current = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range
    });

    if (!current.data.values || current.data.values.length === 0) {
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range,
        valueInputOption: 'RAW',
        resource: { values: [headers] }
      });
      logger.success(`Added headers to "${tab}"`);
    }
  }

  /**
   * Read the id column of the Videos tab.
   * @returns {Promise<Map<string, number>>} Video id → 1-based sheet row number
   */
  async readVideoIdRows() {
    await this.initialize();

    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${this.videosTab}!A:A`
    });

    const rows = response.data.values || [];
    const map = new Map();

    // Row 1 is the header; data starts at row 2.
    for (let i = 1; i < rows.length; i++) {
      const id = (rows[i] || [])[0];
      if (id) {
        map.set(id, i + 1);
      }
    }

    return map;
  }

  /**
   * Convert a digest record into a Videos row.
   * @param {Object} record - Digest record
   * @returns {Array<string>} Sanitized cells
   */
  static toVideoRow(record) {
    const { summary, metadata, entities, github } = record;

    return [
      record.id,
      record.addedAt,
      record.platform,
      record.url,
      metadata.title,
      metadata.channel,
      metadata.publishedAt || '',
      metadata.durationSec ? Math.round(metadata.durationSec / 60) : '',
      summary.contentType,
      (summary.topics || []).map((t) => t.name).join('; '),
      summary.tldr,
      (summary.keyPoints || []).map((p, i) => `${i + 1}. ${p}`).join('\n'),
      (summary.actionItems || []).join('\n'),
      (summary.toolsMentioned || []).map((t) => `${t.name} — ${t.note}`).join('\n'),
      (summary.people || []).join('; '),
      formatReposCell(github),
      (entities.links || []).map((l) => l.url).join('\n'),
      record.transcriptSource,
      summary.confidence,
      record.archivePath || ''
    ].map(sanitizeCell);
  }

  /**
   * Convert a digest record into Topics rows, one per topic.
   * @param {Object} record - Digest record
   * @returns {Array<Array<string>>} Sanitized rows
   */
  static toTopicRows(record) {
    return (record.summary.topics || []).map((topic) => [
      topic.name,
      record.id,
      record.metadata.title,
      record.url,
      record.addedAt,
      topic.relevance,
      topic.why
    ].map(sanitizeCell));
  }

  /**
   * Write a record to both tabs, updating in place when the video is already there.
   * @param {Object} record - Digest record
   * @returns {Promise<{action: string, row: number|null}>} What was written
   */
  async upsertRecord(record) {
    await this.ensureTabs();

    const idRows = await this.readVideoIdRows();
    const videoRow = TopicsSheet.toVideoRow(record);
    const existingRow = idRows.get(record.id);

    if (existingRow) {
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${this.videosTab}!A${existingRow}:${columnLetter(VIDEO_HEADERS.length)}${existingRow}`,
        valueInputOption: 'RAW',
        resource: { values: [videoRow] }
      });

      await this.replaceTopicRows(record);
      logger.success(`Updated ${record.id} in "${this.videosTab}" (row ${existingRow})`);
      return { action: 'updated', row: existingRow };
    }

    const appended = await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: `${this.videosTab}!A:${columnLetter(VIDEO_HEADERS.length)}`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      resource: { values: [videoRow] }
    });

    await this.appendTopicRows(record);
    logger.success(`Added ${record.id} to "${this.videosTab}"`);

    return { action: 'added', row: null, range: appended.data.updates?.updatedRange || null };
  }

  /**
   * Append this record's topic rows.
   * @param {Object} record - Digest record
   * @returns {Promise<void>}
   */
  async appendTopicRows(record) {
    const rows = TopicsSheet.toTopicRows(record);
    if (rows.length === 0) {
      return;
    }

    await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: `${this.topicsTab}!A:${columnLetter(TOPIC_HEADERS.length)}`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      resource: { values: rows }
    });
  }

  /**
   * Clear this video's existing topic rows, then append the current ones.
   * Blanking rather than deleting keeps the operation a single values call and
   * avoids shifting rows underneath a concurrent reader.
   * @param {Object} record - Digest record
   * @returns {Promise<void>}
   */
  async replaceTopicRows(record) {
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${this.topicsTab}!A:B`
    });

    const rows = response.data.values || [];
    const staleRanges = [];

    for (let i = 1; i < rows.length; i++) {
      if ((rows[i] || [])[1] === record.id) {
        staleRanges.push(`${this.topicsTab}!A${i + 1}:${columnLetter(TOPIC_HEADERS.length)}${i + 1}`);
      }
    }

    if (staleRanges.length > 0) {
      await this.sheets.spreadsheets.values.batchClear({
        spreadsheetId: this.spreadsheetId,
        resource: { ranges: staleRanges }
      });
    }

    await this.appendTopicRows(record);
  }

  /**
   * Read every video row back as objects. Lets the Q&A layer answer from the
   * sheet on a machine that has no local archive.
   * @returns {Promise<Array<Object>>} Video rows keyed by header name
   */
  async readVideos() {
    await this.initialize();

    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${this.videosTab}!A:${columnLetter(VIDEO_HEADERS.length)}`
    });

    const rows = response.data.values || [];
    if (rows.length < 2) {
      return [];
    }

    const headers = rows[0];
    return rows.slice(1)
      .filter((row) => row && row[0])
      .map((row) => Object.fromEntries(headers.map((header, i) => [header, row[i] || ''])));
  }

  /**
   * Fetch the spreadsheet's shareable URL.
   * @returns {Promise<string>} Spreadsheet URL
   */
  async getUrl() {
    await this.initialize();
    const meta = await this.sheets.spreadsheets.get({ spreadsheetId: this.spreadsheetId });
    return meta.data.spreadsheetUrl;
  }
}

/**
 * Convert a 1-based column index to its A1 letter(s).
 * @param {number} index - 1-based column index
 * @returns {string} Column letters, e.g. 27 → "AA"
 */
function columnLetter(index) {
  let letters = '';
  let remaining = index;

  while (remaining > 0) {
    const modulo = (remaining - 1) % 26;
    letters = String.fromCharCode(65 + modulo) + letters;
    remaining = Math.floor((remaining - modulo) / 26);
  }

  return letters;
}

module.exports = { TopicsSheet, sanitizeCell, columnLetter, VIDEO_HEADERS, TOPIC_HEADERS };
