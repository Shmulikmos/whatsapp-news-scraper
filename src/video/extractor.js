/**
 * Video Extractor Module
 * Wraps `yt-dlp` to pull metadata, subtitles, and (only when needed) audio.
 *
 * Every invocation goes through `runTool`, which uses execFile with an argv
 * array and an explicit `shell: false`. No user-controlled string is ever
 * concatenated into a command line, and `--` terminates option parsing so a
 * URL can never be read as a flag.
 */

const { execFile } = require('child_process');
const fs = require('fs');
const fsp = require('fs').promises;
const os = require('os');
const path = require('path');
const config = require('../config');
const logger = require('../logger');
const { redact } = require('./redact');
const { idToSlug } = require('./urlParser');

class ExtractionError extends Error {
  constructor(message, { cause } = {}) {
    super(message);
    this.name = 'ExtractionError';
    if (cause) {
      this.cause = cause;
    }
  }
}

/**
 * Environment variables an external tool legitimately needs. Everything else -
 * API keys above all - is withheld: yt-dlp runs site-specific extractor code,
 * and it has no business seeing this process's credentials.
 */
const INHERITED_ENV_VARS = [
  'PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'TZ',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY',
  'http_proxy', 'https_proxy', 'no_proxy',
  'SSL_CERT_FILE', 'REQUESTS_CA_BUNDLE', 'NODE_EXTRA_CA_CERTS',
  'SYSTEMROOT', 'APPDATA', 'USERPROFILE'
];

/**
 * Build the minimal environment a child process is given.
 * @param {Object} [extra] - Additional variables to add
 * @returns {Object} Environment map
 */
function buildChildEnv(extra = {}) {
  const env = {};

  for (const name of INHERITED_ENV_VARS) {
    if (process.env[name] !== undefined) {
      env[name] = process.env[name];
    }
  }

  return { ...env, ...extra };
}

/**
 * Run an external tool with a hard timeout, output cap, and minimal environment.
 * @param {string} tool - Executable name or path
 * @param {Array<string>} args - Argument vector (never a shell string)
 * @param {Object} [options] - Overrides
 * @param {number} [options.timeoutMs] - Kill the process after this long
 * @param {number} [options.maxBuffer] - Cap on captured stdout/stderr
 * @param {Object} [options.env] - Extra environment variables for the child
 * @returns {Promise<{stdout: string, stderr: string}>} Captured output
 * @throws {ExtractionError} On non-zero exit, timeout, or missing executable
 */
function runTool(tool, args, options = {}) {
  const timeoutMs = options.timeoutMs || config.video.toolTimeoutMs;
  const maxBuffer = options.maxBuffer || config.video.maxToolOutputBytes;

  return new Promise((resolve, reject) => {
    execFile(
      tool,
      args,
      {
        timeout: timeoutMs,
        maxBuffer,
        shell: false,
        windowsHide: true,
        encoding: 'utf8',
        env: buildChildEnv(options.env)
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ stdout, stderr });
          return;
        }

        if (error.code === 'ENOENT') {
          reject(new ExtractionError(
            `"${tool}" is not installed or not on PATH. See README - Video Digest setup.`,
            { cause: error }
          ));
          return;
        }

        if (error.killed) {
          reject(new ExtractionError(`"${tool}" timed out after ${timeoutMs}ms`, { cause: error }));
          return;
        }

        const detail = redact((stderr || error.message || '').trim().split('\n').slice(-3).join(' '));
        reject(new ExtractionError(`"${tool}" failed: ${detail}`, { cause: error }));
      }
    );
  });
}

/**
 * Verify the external toolchain is present.
 * @returns {Promise<{ytDlp: string|null, ffmpeg: string|null}>} Detected versions
 */
async function checkToolchain() {
  const versions = { ytDlp: null, ffmpeg: null };

  try {
    const { stdout } = await runTool(config.video.ytDlpPath, ['--version'], { timeoutMs: 15000 });
    versions.ytDlp = stdout.trim();
  } catch {
    versions.ytDlp = null;
  }

  try {
    const { stdout } = await runTool('ffmpeg', ['-version'], { timeoutMs: 15000 });
    versions.ffmpeg = stdout.trim().split('\n')[0];
  } catch {
    versions.ffmpeg = null;
  }

  return versions;
}

/**
 * Base yt-dlp arguments shared by every invocation.
 * @returns {Array<string>} Argument list
 */
function baseArgs() {
  const args = [
    '--no-playlist',
    '--no-warnings',
    '--ignore-config',       // never pick up a stray ~/.config/yt-dlp/config
    '--no-exec',             // refuse --exec even if a config tried to set one
    '--socket-timeout', '30',
    '--retries', '2'
  ];

  if (config.video.cookiesFromBrowser) {
    args.push('--cookies-from-browser', config.video.cookiesFromBrowser);
  } else if (config.video.cookiesFile) {
    args.push('--cookies', config.video.cookiesFile);
  }

  return args;
}

/**
 * Fetch video metadata as structured JSON.
 * @param {{canonicalUrl: string, id: string}} descriptor - Validated video descriptor
 * @returns {Promise<Object>} Normalized metadata
 * @throws {ExtractionError} When yt-dlp fails or returns unparseable JSON
 */
async function fetchMetadata(descriptor) {
  logger.info(`Fetching metadata for ${descriptor.id}`);

  const { stdout } = await runTool(config.video.ytDlpPath, [
    ...baseArgs(),
    '--dump-single-json',
    '--skip-download',
    '--',
    descriptor.canonicalUrl
  ]);

  let raw;
  try {
    raw = JSON.parse(stdout);
  } catch (error) {
    throw new ExtractionError('yt-dlp returned metadata that is not valid JSON', { cause: error });
  }

  return normalizeMetadata(raw);
}

/**
 * Reduce yt-dlp's very large metadata object to the fields we archive.
 * @param {Object} raw - Raw yt-dlp JSON
 * @returns {Object} Normalized metadata
 */
function normalizeMetadata(raw) {
  const uploadDate = typeof raw.upload_date === 'string' && /^\d{8}$/.test(raw.upload_date)
    ? `${raw.upload_date.slice(0, 4)}-${raw.upload_date.slice(4, 6)}-${raw.upload_date.slice(6, 8)}`
    : null;

  return {
    title: raw.title || raw.fulltitle || '',
    description: raw.description || '',
    channel: raw.uploader || raw.channel || raw.uploader_id || '',
    channelUrl: raw.uploader_url || raw.channel_url || '',
    publishedAt: uploadDate,
    durationSec: Number.isFinite(raw.duration) ? Math.round(raw.duration) : null,
    viewCount: Number.isFinite(raw.view_count) ? raw.view_count : null,
    likeCount: Number.isFinite(raw.like_count) ? raw.like_count : null,
    thumbnail: typeof raw.thumbnail === 'string' ? raw.thumbnail : '',
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t) => typeof t === 'string').slice(0, 50) : [],
    categories: Array.isArray(raw.categories) ? raw.categories.filter((c) => typeof c === 'string') : [],
    language: raw.language || null,
    chapters: Array.isArray(raw.chapters)
      ? raw.chapters
        .filter((c) => c && typeof c.title === 'string')
        .map((c) => ({ title: c.title, startSec: Math.round(Number(c.start_time) || 0) }))
        .slice(0, 200)
      : [],
    availableSubtitles: Object.keys(raw.subtitles || {}),
    availableAutoCaptions: Object.keys(raw.automatic_captions || {})
  };
}

/**
 * Create a private temp directory for one video's intermediate files.
 * @param {string} id - Validated video id
 * @returns {Promise<string>} Absolute path to the directory
 */
async function createWorkDir(id) {
  const base = path.join(os.tmpdir(), 'video-digest-');
  const dir = await fsp.mkdtemp(base);
  await fsp.mkdir(path.join(dir, idToSlug(id)), { recursive: true, mode: 0o700 });
  return path.join(dir, idToSlug(id));
}

/**
 * Remove a work directory and everything under it.
 * @param {string} dir - Directory created by createWorkDir
 * @returns {Promise<void>}
 */
async function cleanupWorkDir(dir) {
  if (!dir) {
    return;
  }

  try {
    await fsp.rm(path.dirname(dir), { recursive: true, force: true });
  } catch (error) {
    logger.warn(`Could not clean up temp directory: ${redact(error.message)}`);
  }
}

/**
 * Download subtitles for a video, preferring human captions over auto-generated.
 * @param {{canonicalUrl: string, id: string}} descriptor - Validated video descriptor
 * @param {string} workDir - Directory to write into
 * @returns {Promise<{content: string, kind: string, lang: string}|null>} Subtitle file, or null when none exist
 */
async function fetchSubtitles(descriptor, workDir) {
  const langs = config.video.subtitleLangs;
  const outputTemplate = path.join(workDir, 'subs.%(ext)s');

  const attempts = [
    { kind: 'captions', flag: '--write-subs' },
    { kind: 'auto-captions', flag: '--write-auto-subs' }
  ];

  for (const attempt of attempts) {
    try {
      await runTool(config.video.ytDlpPath, [
        ...baseArgs(),
        attempt.flag,
        '--sub-langs', langs,
        '--sub-format', 'vtt/srt/best',
        '--convert-subs', 'vtt',
        '--skip-download',
        '-o', outputTemplate,
        '--',
        descriptor.canonicalUrl
      ]);
    } catch (error) {
      logger.warn(`Subtitle attempt (${attempt.kind}) failed: ${redact(error.message)}`);
      continue;
    }

    const found = await readFirstSubtitleFile(workDir);
    if (found) {
      logger.success(`Found ${attempt.kind} (${found.lang})`);
      return { ...found, kind: attempt.kind };
    }
  }

  logger.info('No subtitles available for this video');
  return null;
}

/**
 * Read the first subtitle file yt-dlp wrote into the work directory.
 * @param {string} workDir - Directory to scan
 * @returns {Promise<{content: string, lang: string}|null>} Subtitle content, or null
 */
async function readFirstSubtitleFile(workDir) {
  let entries;
  try {
    entries = await fsp.readdir(workDir);
  } catch {
    return null;
  }

  const subtitleFiles = entries.filter((name) => /\.(vtt|srt)$/i.test(name)).sort();
  if (subtitleFiles.length === 0) {
    return null;
  }

  const chosen = subtitleFiles[0];
  const filePath = path.join(workDir, chosen);
  const stats = await fsp.stat(filePath);

  if (stats.size > config.video.maxSubtitleBytes) {
    throw new ExtractionError(
      `Subtitle file is ${stats.size} bytes, over the ${config.video.maxSubtitleBytes} byte limit`
    );
  }

  const content = await fsp.readFile(filePath, 'utf8');
  // `subs.he.vtt` -> `he`; `subs.vtt` -> unknown
  const langMatch = chosen.match(/^subs\.([A-Za-z0-9_-]+)\.(?:vtt|srt)$/i);

  return { content, lang: langMatch ? langMatch[1] : 'unknown' };
}

/**
 * Download the audio track for ASR, refusing videos longer than the configured cap.
 * @param {{canonicalUrl: string, id: string}} descriptor - Validated video descriptor
 * @param {string} workDir - Directory to write into
 * @param {number|null} durationSec - Known duration, used for the pre-flight cap
 * @returns {Promise<string>} Path to the downloaded audio file
 * @throws {ExtractionError} When the video is too long or the download produced nothing
 */
async function fetchAudio(descriptor, workDir, durationSec) {
  const maxDuration = config.video.maxAsrDurationSec;
  if (Number.isFinite(durationSec) && durationSec > maxDuration) {
    throw new ExtractionError(
      `Video is ${durationSec}s, over the ${maxDuration}s transcription limit ` +
      '(raise MAX_ASR_DURATION_SEC to allow it)'
    );
  }

  logger.info('Downloading audio track for transcription');

  await runTool(config.video.ytDlpPath, [
    ...baseArgs(),
    '-f', 'bestaudio/best',
    '--extract-audio',
    '--audio-format', 'mp3',
    '--audio-quality', '5',
    '--max-filesize', `${config.video.maxAudioMegabytes}M`,
    '-o', path.join(workDir, 'audio.%(ext)s'),
    '--',
    descriptor.canonicalUrl
  ], { timeoutMs: config.video.audioTimeoutMs });

  const entries = await fsp.readdir(workDir);
  const audioFile = entries.find((name) => /^audio\.(mp3|m4a|webm|opus|ogg|wav)$/i.test(name));

  if (!audioFile) {
    throw new ExtractionError('Audio download produced no file (video may exceed the size limit)');
  }

  return path.join(workDir, audioFile);
}

/**
 * Report whether yt-dlp is available without throwing.
 * @returns {boolean} True when the executable resolves
 */
function ytDlpLooksInstalled() {
  const configured = config.video.ytDlpPath;
  if (configured.includes(path.sep)) {
    return fs.existsSync(configured);
  }
  return true; // A bare name is resolved via PATH by execFile; checkToolchain confirms.
}

module.exports = {
  runTool,
  buildChildEnv,
  checkToolchain,
  fetchMetadata,
  normalizeMetadata,
  fetchSubtitles,
  fetchAudio,
  createWorkDir,
  cleanupWorkDir,
  ytDlpLooksInstalled,
  ExtractionError
};
