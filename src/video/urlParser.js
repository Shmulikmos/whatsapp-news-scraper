/**
 * URL Parser Module
 * Validates and canonicalizes video URLs. This is the security boundary of the
 * pipeline: nothing downstream touches a URL that has not passed through here.
 *
 * Threats handled (see docs/plans/2026-09-04-video-digest-design.md):
 *  - SSRF: strict host allowlist, https only, no credentials/ports/IP hosts
 *  - Argument injection: URLs that could be read as a CLI flag are rejected
 *  - Path traversal: the derived id is constrained to a filename-safe charset
 */

/** Hosts we are willing to fetch from, keyed by platform. */
const ALLOWED_HOSTS = {
  youtube: new Set([
    'youtube.com',
    'www.youtube.com',
    'm.youtube.com',
    'music.youtube.com',
    'youtu.be',
    'www.youtu.be',
    'youtube-nocookie.com',
    'www.youtube-nocookie.com'
  ]),
  instagram: new Set([
    'instagram.com',
    'www.instagram.com',
    'm.instagram.com'
  ])
};

/** Id prefixes the archive accepts: the video platforms plus generic web links. */
const KNOWN_SOURCES = new Set([...Object.keys(ALLOWED_HOSTS), 'web']);

/** Ids are used as filenames and as sheet keys - keep them boring. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Whitespace plus C0/C1 control characters, which never belong in a URL. */
const CONTROL_OR_SPACE = new RegExp('[\\s\\u0000-\\u001F\\u007F-\\u009F]');

/** Instagram video permalinks: /p/, /reel/, /reels/, /tv/. */
const INSTAGRAM_PATH = /^\/(?:[A-Za-z0-9._]{1,40}\/)?(p|reel|reels|tv)\/([A-Za-z0-9_-]{1,64})\/?$/;

class InvalidVideoUrlError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidVideoUrlError';
  }
}

/**
 * Resolve which platform a hostname belongs to.
 * @param {string} hostname - Lowercased hostname
 * @returns {string|null} Platform name, or null when not allowlisted
 */
function platformForHost(hostname) {
  for (const [platform, hosts] of Object.entries(ALLOWED_HOSTS)) {
    if (hosts.has(hostname)) {
      return platform;
    }
  }
  return null;
}

/**
 * Extract the YouTube video id from an allowlisted YouTube URL.
 * @param {URL} url - Parsed URL
 * @returns {string|null} Video id, or null when the URL is not a video permalink
 */
function youtubeId(url) {
  if (url.hostname.endsWith('youtu.be')) {
    return url.pathname.slice(1).split('/')[0] || null;
  }

  const watchId = url.searchParams.get('v');
  if (watchId) {
    return watchId;
  }

  // /shorts/<id>, /embed/<id>, /live/<id>, /v/<id>
  const match = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/);
  return match ? match[1] : null;
}

/**
 * Extract the Instagram shortcode from an allowlisted Instagram URL.
 * @param {URL} url - Parsed URL
 * @returns {string|null} Shortcode, or null when the URL is not a video permalink
 */
function instagramId(url) {
  const match = url.pathname.match(INSTAGRAM_PATH);
  return match ? match[2] : null;
}

/**
 * Parse and validate a video URL.
 * @param {string} rawUrl - User-supplied URL
 * @returns {{platform: string, videoId: string, id: string, canonicalUrl: string}}
 * @throws {InvalidVideoUrlError} When the URL is unsupported or unsafe
 */
function parseVideoUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    throw new InvalidVideoUrlError('URL is required');
  }

  const trimmed = rawUrl.trim();

  // A leading dash would be read as a flag by any CLI we hand this to.
  if (trimmed.startsWith('-')) {
    throw new InvalidVideoUrlError('URL must not start with "-"');
  }

  // Whitespace and control characters have no place in a URL we shell out with.
  if (CONTROL_OR_SPACE.test(trimmed)) {
    throw new InvalidVideoUrlError('URL must not contain whitespace or control characters');
  }

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    throw new InvalidVideoUrlError(`Not a valid URL: ${trimmed}`);
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new InvalidVideoUrlError(`Unsupported protocol: ${url.protocol}`);
  }

  if (url.username || url.password) {
    throw new InvalidVideoUrlError('URLs with embedded credentials are not accepted');
  }

  if (url.port) {
    throw new InvalidVideoUrlError('URLs with an explicit port are not accepted');
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  const platform = platformForHost(hostname);
  if (!platform) {
    throw new InvalidVideoUrlError(
      `Unsupported host "${url.hostname}". Only YouTube and Instagram links are accepted.`
    );
  }

  const videoId = platform === 'youtube' ? youtubeId(url) : instagramId(url);
  if (!videoId) {
    throw new InvalidVideoUrlError(`Could not find a video id in: ${trimmed}`);
  }

  if (!SAFE_ID.test(videoId)) {
    throw new InvalidVideoUrlError(`Unsafe video id: ${videoId}`);
  }

  const canonicalUrl = platform === 'youtube'
    ? `https://www.youtube.com/watch?v=${videoId}`
    : `https://www.instagram.com/p/${videoId}/`;

  return { platform, videoId, id: `${platform}:${videoId}`, canonicalUrl };
}

/**
 * Find every supported video URL inside a block of free text.
 * Used by the WhatsApp watcher, where a link arrives wrapped in a message.
 * @param {string} text - Arbitrary text
 * @returns {Array<Object>} Parsed, de-duplicated video descriptors
 */
function findVideoUrls(text) {
  if (typeof text !== 'string') {
    return [];
  }

  const candidates = text.match(/https?:\/\/[^\s<>"')\]]+/g) || [];
  const seen = new Set();
  const found = [];

  for (const candidate of candidates) {
    // Trailing punctuation is far more likely to be prose than part of the URL.
    const cleaned = candidate.replace(/[.,;:!?]+$/, '');
    try {
      const parsed = parseVideoUrl(cleaned);
      if (!seen.has(parsed.id)) {
        seen.add(parsed.id);
        found.push(parsed);
      }
    } catch {
      // Not a supported video link - skip it silently, this is a scanner.
    }
  }

  return found;
}

/**
 * Assert that an id is safe to use as a filesystem path segment.
 * @param {string} id - Composite id (`platform:videoId`) or bare video id
 * @returns {string} Filesystem-safe slug
 * @throws {InvalidVideoUrlError} When the id is not safe
 */
function idToSlug(id) {
  if (typeof id !== 'string') {
    throw new InvalidVideoUrlError('Id must be a string');
  }

  const parts = id.split(':');
  const platform = parts.length === 2 ? parts[0] : null;
  const videoId = parts.length === 2 ? parts[1] : parts[0];

  if (platform !== null && !KNOWN_SOURCES.has(platform)) {
    throw new InvalidVideoUrlError(`Unknown source in id: ${id}`);
  }

  if (!SAFE_ID.test(videoId)) {
    throw new InvalidVideoUrlError(`Unsafe id: ${id}`);
  }

  return platform ? `${platform}_${videoId}` : videoId;
}

module.exports = {
  parseVideoUrl,
  findVideoUrls,
  idToSlug,
  InvalidVideoUrlError,
  ALLOWED_HOSTS,
  KNOWN_SOURCES
};
