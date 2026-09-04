/**
 * Pipeline Module
 * Orchestrates one link end to end: validate → extract → transcribe → analyze →
 * summarize → archive → publish to Google Sheets.
 *
 * Idempotent by design: an already-archived video short-circuits unless `force`
 * is set, so re-sending the same link is free and never duplicates a row.
 */

const path = require('path');
const config = require('../config');
const logger = require('../logger');
const { parseVideoUrl, InvalidVideoUrlError } = require('./urlParser');
const { parseLinkUrl } = require('./linkUrl');
const webPage = require('./webPage');
const extractor = require('./extractor');
const { subtitlesToTranscript } = require('./subtitles');
const { transcribeAudio } = require('./transcriber');
const { extractAll } = require('./entities');
const { enrichRepos } = require('./githubEnricher');
const { summarizeVideo } = require('./summarizer');
const archive = require('./archive');
const { TopicsSheet } = require('./topicsSheet');
const { redact } = require('./redact');

/**
 * Obtain a transcript, preferring captions and falling back to ASR.
 * Failure here is not fatal: a metadata-only summary is still worth archiving.
 * @param {Object} descriptor - Validated video descriptor
 * @param {Object} metadata - Normalized metadata
 * @param {Object} options - Run options
 * @param {boolean} options.allowAsr - Whether the ASR fallback may run
 * @returns {Promise<{text: string, source: string, detail: string}>} Transcript result
 */
async function obtainTranscript(descriptor, metadata, options) {
  let workDir = null;

  try {
    workDir = await extractor.createWorkDir(descriptor.id);

    const subtitles = await extractor.fetchSubtitles(descriptor, workDir);
    if (subtitles) {
      const { text, cueCount } = subtitlesToTranscript(subtitles.content);
      if (text.trim()) {
        logger.success(`Transcript from ${subtitles.kind}: ${text.length} chars, ${cueCount} cues`);
        return { text, source: 'captions', detail: `${subtitles.kind} (${subtitles.lang})` };
      }
    }

    if (!options.allowAsr || !config.video.asrEnabled) {
      return { text: '', source: 'none', detail: 'no captions; ASR not enabled for this run' };
    }

    const audioPath = await extractor.fetchAudio(descriptor, workDir, metadata.durationSec);
    const asr = await transcribeAudio(audioPath, workDir);
    return { text: asr.text, source: 'asr', detail: `ASR via ${asr.engine}` };
  } catch (error) {
    logger.warn(`Transcript unavailable: ${redact(error.message)}`);
    return { text: '', source: 'none', detail: redact(error.message) };
  } finally {
    await extractor.cleanupWorkDir(workDir);
  }
}

/**
 * Work out what kind of source a URL is.
 * A supported video wins; anything else that survives the link rules is a page.
 * @param {string} rawUrl - User-supplied URL
 * @returns {Object} Descriptor with a `sourceType` of `video` or `web`
 * @throws {InvalidVideoUrlError|InvalidLinkUrlError} When the URL is unusable
 */
function classifyUrl(rawUrl) {
  try {
    return { ...parseVideoUrl(rawUrl), sourceType: 'video' };
  } catch (error) {
    if (!(error instanceof InvalidVideoUrlError)) {
      throw error;
    }
    // Not a supported video - fall through to the generic web-link rules,
    // which apply their own (stricter, SSRF-aware) validation.
    return { ...parseLinkUrl(rawUrl), sourceType: 'web' };
  }
}

/**
 * A placeholder summary, used when the model could not be reached.
 * Keeps the record shape identical so archive, Sheets, and Q&A need no
 * null-guards, and marks itself pending so `--force` can complete it later.
 * @param {Object} metadata - Normalized metadata
 * @param {string} reason - Why summarization did not happen
 * @returns {Object} Summary stub
 */
function pendingSummary(metadata, reason) {
  const derived = [metadata.pageType, ...(metadata.tags || []).slice(0, 3)]
    .filter((t) => typeof t === 'string' && t && t !== 'website');

  const label = metadata.title ? `"${metadata.title}"` : 'This link';

  return {
    tldr: `${label} — saved, not yet summarized (${reason}). ` +
      'Re-run with --force once the page is reachable.',
    keyPoints: [],
    topics: derived.length
      ? derived.map((name) => ({ name, relevance: 'secondary', why: 'derived from page metadata' }))
      : [{ name: 'Unsorted', relevance: 'secondary', why: 'not summarized yet' }],
    actionItems: [],
    toolsMentioned: [],
    people: [],
    contentType: 'other',
    language: metadata.language || '',
    confidence: 'low',
    injectionAttempt: false,
    pending: true,
    pendingReason: reason
  };
}

/**
 * Digest one URL: a YouTube/Instagram video, or any other web page.
 * @param {string} rawUrl - User-supplied URL
 * @param {Object} [options] - Run options
 * @param {boolean} [options.force=false] - Re-process even if already archived
 * @param {boolean} [options.allowAsr=true] - Permit the ASR fallback
 * @param {boolean} [options.publish=true] - Write to Google Sheets
 * @param {boolean} [options.allowPending=true] - Archive even if summarizing fails
 * @returns {Promise<Object>} Result with `record`, `skipped`, and `sheet` fields
 */
async function digest(rawUrl, options = {}) {
  const { force = false, allowAsr = true, publish = true, allowPending = true } = options;
  const descriptor = classifyUrl(rawUrl);

  logger.info(`Digesting ${descriptor.id} (${descriptor.canonicalUrl})`);

  if (!force) {
    const existing = await archive.loadRecord(descriptor.id);
    if (existing) {
      logger.info('Already archived - use --force to re-process');
      return { record: existing, skipped: true, sheet: null };
    }
  }

  // 1. Metadata + body text, from whichever source this is
  let metadata;
  let transcript;

  if (descriptor.sourceType === 'web') {
    try {
      const page = await webPage.fetchAndParse(descriptor.canonicalUrl);
      metadata = page.metadata;
      transcript = { text: page.metadata.text, source: 'page', detail: `fetched from ${page.finalUrl}` };
    } catch (error) {
      if (!allowPending) {
        throw error;
      }
      // Saving the link is the point; the page content can be filled in later.
      const reason = redact(error.message);
      logger.warn(`Could not fetch the page, saving the link anyway: ${reason}`);
      metadata = webPage.metadataFromUrl(descriptor.canonicalUrl);
      transcript = { text: '', source: 'none', detail: `page not fetched - ${reason}` };
    }
  } else {
    metadata = await extractor.fetchMetadata(descriptor);
    logger.info(`"${metadata.title}" by ${metadata.channel || 'unknown'}`);
    transcript = await obtainTranscript(descriptor, metadata, { allowAsr });
  }

  // 3. Deterministic entity extraction, before the model sees anything
  const entities = extractAll({
    title: metadata.title,
    description: metadata.description,
    transcript: transcript.text
  });
  logger.info(
    `Extracted ${entities.links.length} links, ${entities.githubRepos.length} GitHub repos`
  );

  // 4. GitHub enrichment
  const github = await enrichRepos(entities.githubRepos);
  if (github.length > 0) {
    logger.success(`Enriched ${github.length} GitHub repo(s)`);
  }

  // 5. Summarize. A failure here must not lose the link: the record is archived
  // with a pending stub, and `--force` completes it once the model is reachable.
  let summary;
  let usage = {};
  let truncated = false;
  let transcriptLength = transcript.text.length;

  const unfetched = descriptor.sourceType === 'web' && metadata.fetched === false;

  try {
    if (unfetched) {
      throw new Error(transcript.detail.replace(/^page not fetched - /, ''));
    }

    const result = await summarizeVideo({
      metadata,
      transcript: transcript.text,
      transcriptSource: transcript.source,
      entities,
      sourceType: descriptor.sourceType
    });
    ({ summary, usage, truncated, transcriptLength } = result);
  } catch (error) {
    if (!allowPending) {
      throw error;
    }
    const reason = redact(error.message);
    logger.warn(
      unfetched
        ? `Link saved without content: ${reason}`
        : `Summarization failed, archiving the link anyway: ${reason}`
    );
    summary = pendingSummary(metadata, reason);
  }

  // 6. Archive
  const record = {
    id: descriptor.id,
    sourceType: descriptor.sourceType,
    platform: descriptor.platform,
    videoId: descriptor.videoId,
    url: descriptor.canonicalUrl,
    addedAt: new Date().toISOString(),
    metadata,
    transcript: transcript.text,
    transcriptSource: transcript.source,
    transcriptDetail: transcript.detail,
    transcriptLength,
    truncated,
    entities,
    github,
    summary,
    usage,
    schemaVersion: 1
  };

  const { markdownPath } = await archive.saveRecord(record);
  record.archivePath = path.relative(process.cwd(), markdownPath);

  // 7. Publish to Google Sheets
  let sheet = null;
  if (publish) {
    const store = new TopicsSheet();
    if (store.isConfigured()) {
      try {
        sheet = await store.upsertRecord(record);
      } catch (error) {
        // The archive is already on disk; a Sheets outage must not lose the work.
        logger.error(`Google Sheets write failed: ${redact(error.message)}`);
        sheet = { action: 'failed', error: redact(error.message) };
      }
    } else {
      logger.info('Google Sheets not configured - archived locally only');
    }
  }

  return { record, skipped: false, sheet };
}

/**
 * Digest several URLs in sequence, never letting one failure stop the rest.
 * @param {Array<string>} urls - URLs to process
 * @param {Object} [options] - Run options, passed through to digest()
 * @returns {Promise<Array<Object>>} One result per URL, with `ok` and `error`
 */
async function digestMany(urls, options = {}) {
  const results = [];

  for (const url of urls) {
    try {
      const result = await digest(url, options);
      results.push({ url, ok: true, ...result });
    } catch (error) {
      logger.error(`Failed on ${url}: ${redact(error.message)}`);
      results.push({ url, ok: false, error: redact(error.message) });
    }
  }

  return results;
}

module.exports = { digest, digestMany, obtainTranscript, classifyUrl, pendingSummary };
