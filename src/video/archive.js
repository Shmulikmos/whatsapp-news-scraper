/**
 * Archive Module
 * Local store for the full digest record: one JSON file (machine-readable, holds
 * the transcript) and one Markdown file (human-readable) per video, plus an
 * index that the Q&A layer reads.
 *
 * Google Sheets is the table you look at; this is where the long-form content
 * lives, because a transcript does not belong in a spreadsheet cell.
 */

const fsp = require('fs').promises;
const path = require('path');
const config = require('../config');
const logger = require('../logger');
const { idToSlug, InvalidVideoUrlError } = require('./urlParser');
const { redactDeep } = require('./redact');

const INDEX_FILE = 'index.json';

/**
 * Resolve the archive root as an absolute path.
 * @returns {string} Absolute directory path
 */
function archiveRoot() {
  return path.resolve(config.video.archiveDir);
}

/**
 * Build a path inside the archive, refusing anything that escapes the root.
 * @param {string} filename - Filename to place in the archive
 * @returns {string} Absolute, contained path
 * @throws {InvalidVideoUrlError} When the path would escape the archive root
 */
function archivePath(filename) {
  const root = archiveRoot();
  const resolved = path.resolve(root, filename);

  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new InvalidVideoUrlError(`Refusing to write outside the archive: ${filename}`);
  }

  return resolved;
}

/**
 * Ensure the archive directory exists.
 * @returns {Promise<string>} Absolute archive root
 */
async function ensureArchive() {
  const root = archiveRoot();
  await fsp.mkdir(root, { recursive: true });
  return root;
}

/**
 * Read the archive index.
 * @returns {Promise<{videos: Array<Object>, updatedAt: string|null}>} Index contents
 */
async function loadIndex() {
  try {
    const content = await fsp.readFile(archivePath(INDEX_FILE), 'utf8');
    const parsed = JSON.parse(content);
    return {
      videos: Array.isArray(parsed.videos) ? parsed.videos : [],
      updatedAt: parsed.updatedAt || null
    };
  } catch {
    // Missing or corrupt index: rebuildable from the record files, so start clean.
    return { videos: [], updatedAt: null };
  }
}

/**
 * Write the archive index atomically (temp file + rename), so a crash mid-write
 * cannot leave a truncated index behind.
 * @param {Object} index - Index contents
 * @returns {Promise<void>}
 */
async function saveIndex(index) {
  await ensureArchive();
  const target = archivePath(INDEX_FILE);
  const temp = `${target}.${process.pid}.tmp`;

  await fsp.writeFile(temp, JSON.stringify(index, null, 2), 'utf8');
  await fsp.rename(temp, target);
}

/**
 * Look up a record's index entry.
 * @param {string} id - Video id (`platform:videoId`)
 * @returns {Promise<Object|null>} Index entry, or null when unknown
 */
async function findInIndex(id) {
  const index = await loadIndex();
  return index.videos.find((entry) => entry.id === id) || null;
}

/**
 * Load a full archived record.
 * @param {string} id - Video id
 * @returns {Promise<Object|null>} Record, or null when not archived
 */
async function loadRecord(id) {
  try {
    const content = await fsp.readFile(archivePath(`${idToSlug(id)}.json`), 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Render a record as Markdown for human reading.
 * @param {Object} record - Digest record
 * @returns {string} Markdown document
 */
function renderMarkdown(record) {
  const { metadata, summary, entities, github, transcript } = record;
  const isPage = record.sourceType === 'web';
  const lines = [];

  lines.push(`# ${metadata.title || record.id}`);
  lines.push('');
  lines.push(`- **Source**: ${record.url}`);
  lines.push(`- **${isPage ? 'Site' : 'Channel'}**: ${metadata.channel || '—'}`);
  lines.push(`- **Published**: ${metadata.publishedAt || '—'}`);

  if (isPage) {
    lines.push(`- **Page type**: ${metadata.pageType || 'website'}`);
  } else {
    lines.push(`- **Duration**: ${metadata.durationSec ? `${Math.round(metadata.durationSec / 60)} min` : '—'}`);
  }

  lines.push(`- **Archived**: ${record.addedAt}`);
  lines.push(`- **Content**: ${record.transcriptSource}${record.truncated ? ' (truncated for summarization)' : ''}`);
  lines.push(`- **Confidence**: ${summary.confidence}`);
  lines.push('');

  if (summary.pending) {
    lines.push(`> ⏳ Not summarized yet — ${summary.pendingReason}.`);
    lines.push('> Re-run `npm run digest -- <url> --force` to complete this record.');
    lines.push('');
  }

  if (isPage && metadata.product) {
    const p = metadata.product;
    lines.push('## Product');
    lines.push('');
    lines.push('| Field | Value |');
    lines.push('| --- | --- |');
    lines.push(`| Name | ${p.name || '—'} |`);
    lines.push(`| Brand | ${p.brand || '—'} |`);
    lines.push(`| SKU | ${p.sku || '—'} |`);
    lines.push(`| Price | ${p.price !== null && p.price !== undefined ? `${p.price} ${p.currency}` : '—'} |`);
    lines.push(`| Availability | ${p.availability || '—'} |`);
    lines.push(`| Rating | ${p.rating !== null && p.rating !== undefined ? `${p.rating} (${p.reviewCount ?? 0} reviews)` : '—'} |`);
    lines.push('');
  }

  lines.push('## TL;DR');
  lines.push('');
  lines.push(summary.tldr);
  lines.push('');

  lines.push('## Topics');
  lines.push('');
  for (const topic of summary.topics || []) {
    lines.push(`- **${topic.name}** (${topic.relevance}) — ${topic.why}`);
  }
  lines.push('');

  lines.push('## Key points');
  lines.push('');
  (summary.keyPoints || []).forEach((point, i) => lines.push(`${i + 1}. ${point}`));
  lines.push('');

  if ((summary.actionItems || []).length) {
    lines.push('## Action items');
    lines.push('');
    for (const item of summary.actionItems) {
      lines.push(`- [ ] ${item}`);
    }
    lines.push('');
  }

  if ((summary.toolsMentioned || []).length) {
    lines.push('## Tools & products mentioned');
    lines.push('');
    for (const tool of summary.toolsMentioned) {
      lines.push(`- **${tool.name}** — ${tool.note}`);
    }
    lines.push('');
  }

  if ((github || []).length) {
    lines.push('## GitHub repositories');
    lines.push('');
    lines.push('| Repo | Stars | Language | Last push | Description |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const repo of github) {
      lines.push(
        `| [${repo.fullName}](${repo.url}) | ${repo.stars ?? '—'} | ${repo.language || '—'} | ` +
        `${repo.pushedAt ? repo.pushedAt.slice(0, 10) : '—'} | ${(repo.description || '—').replace(/\|/g, '\\|')} |`
      );
    }
    lines.push('');
  }

  if ((entities.links || []).length) {
    lines.push('## Links');
    lines.push('');
    for (const link of entities.links) {
      lines.push(`- [${link.domain}](${link.url}) _(${link.source})_`);
    }
    lines.push('');
  }

  if ((entities.chapters || []).length) {
    lines.push('## Chapters');
    lines.push('');
    for (const chapter of entities.chapters) {
      lines.push(`- \`${chapter.timestamp}\` ${chapter.label}`);
    }
    lines.push('');
  }

  if (summary.injectionAttempt) {
    lines.push('> ⚠️ This video contains text addressed at an AI assistant. It was archived as');
    lines.push('> content and never acted on.');
    lines.push('');
  }

  if (transcript) {
    lines.push(isPage ? '## Page text' : '## Transcript');
    lines.push('');
    lines.push('```text');
    lines.push(transcript);
    lines.push('```');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Persist a digest record: JSON, Markdown, and an index entry.
 * @param {Object} record - Digest record
 * @returns {Promise<{jsonPath: string, markdownPath: string}>} Written paths
 */
async function saveRecord(record) {
  await ensureArchive();

  const slug = idToSlug(record.id);
  const safeRecord = redactDeep(record);

  const jsonPath = archivePath(`${slug}.json`);
  const markdownPath = archivePath(`${slug}.md`);

  await fsp.writeFile(jsonPath, JSON.stringify(safeRecord, null, 2), 'utf8');
  await fsp.writeFile(markdownPath, renderMarkdown(safeRecord), 'utf8');

  const index = await loadIndex();
  const entry = {
    id: safeRecord.id,
    url: safeRecord.url,
    sourceType: safeRecord.sourceType || 'video',
    platform: safeRecord.platform,
    title: safeRecord.metadata.title,
    channel: safeRecord.metadata.channel,
    publishedAt: safeRecord.metadata.publishedAt,
    addedAt: safeRecord.addedAt,
    topics: (safeRecord.summary.topics || []).map((t) => t.name),
    tldr: safeRecord.summary.tldr,
    transcriptSource: safeRecord.transcriptSource,
    pending: Boolean(safeRecord.summary.pending),
    archivePath: path.relative(process.cwd(), markdownPath)
  };

  const existing = index.videos.findIndex((v) => v.id === record.id);
  if (existing >= 0) {
    index.videos[existing] = entry;
  } else {
    index.videos.push(entry);
  }

  index.updatedAt = new Date().toISOString();
  await saveIndex(index);

  logger.success(`Archived ${record.id} → ${path.relative(process.cwd(), markdownPath)}`);
  return { jsonPath, markdownPath };
}

/**
 * Load every archived record. Used by the Q&A layer.
 * @returns {Promise<Array<Object>>} All records, newest first
 */
async function loadAllRecords() {
  const index = await loadIndex();
  const records = [];

  for (const entry of index.videos) {
    const record = await loadRecord(entry.id);
    if (record) {
      records.push(record);
    }
  }

  return records.sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)));
}

/**
 * Group archived videos by topic.
 * @returns {Promise<Array<{topic: string, videos: Array<Object>}>>} Topics, most populated first
 */
async function topicIndex() {
  const index = await loadIndex();
  const byTopic = new Map();

  for (const video of index.videos) {
    for (const topic of video.topics || []) {
      if (!byTopic.has(topic)) {
        byTopic.set(topic, []);
      }
      byTopic.get(topic).push(video);
    }
  }

  return [...byTopic.entries()]
    .map(([topic, videos]) => ({ topic, videos }))
    .sort((a, b) => b.videos.length - a.videos.length || a.topic.localeCompare(b.topic));
}

module.exports = {
  ensureArchive,
  archivePath,
  archiveRoot,
  loadIndex,
  saveIndex,
  findInIndex,
  loadRecord,
  loadAllRecords,
  saveRecord,
  renderMarkdown,
  topicIndex
};
