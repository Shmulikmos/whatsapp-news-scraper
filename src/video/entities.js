/**
 * Entity Extraction Module
 * Pulls the concrete, checkable details out of a video's text: URLs, GitHub
 * repositories, social handles, hashtags, and chapter timestamps.
 *
 * This runs deterministically on the raw text *before* the model sees anything,
 * so the extracted links are the ones that were actually in the video - not
 * ones a summarizer might have hallucinated or a transcript tried to inject.
 */

/** Bare URLs, with trailing prose punctuation excluded from the match. */
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`\]{}|\\^]+/gi;

/** `github.com/owner/repo`, with or without a scheme. */
const GITHUB_URL_PATTERN =
  /(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9_.-]{1,100})/gi;

/** Spoken/typed shorthand, e.g. "the repo is foo/bar-baz". */
const BARE_REPO_PATTERN = /(?:^|\s)([A-Za-z0-9][A-Za-z0-9-]{1,38})\/([A-Za-z0-9_][A-Za-z0-9_.-]{1,99})(?=\s|$|[),.])/g;

/** @handles, as used on Instagram and YouTube. */
const HANDLE_PATTERN = /(?:^|[\s(])@([A-Za-z0-9._]{2,30})\b/g;

/** #hashtags, including Hebrew and other non-Latin scripts. */
const HASHTAG_PATTERN = /(?:^|[\s(])#([\p{L}\p{N}_]{2,50})/gu;

/** Non-repository paths on github.com that must not be treated as `owner/repo`. */
const GITHUB_RESERVED = new Set([
  'features', 'topics', 'collections', 'trending', 'events', 'sponsors',
  'marketplace', 'explore', 'settings', 'notifications', 'orgs', 'users',
  'about', 'pricing', 'enterprise', 'security', 'apps', 'login', 'join',
  'search', 'new', 'codespaces', 'issues', 'pulls', 'dashboard'
]);

/** Common `word/word` shapes that are paths or prose, not repositories. */
const NOT_A_REPO = new Set([
  'and/or', 'http/https', 'src/main', 'src/index', 'input/output', 'read/write',
  'client/server', 'w/o', 'a/b', 'ui/ux', 'ci/cd', 'tcp/ip', 'km/h', 'n/a', 'i/o'
]);

/**
 * Trim punctuation that prose put at the end of a URL.
 * @param {string} url - Raw matched URL
 * @returns {string} Cleaned URL
 */
function trimUrl(url) {
  let cleaned = url.replace(/[.,;:!?'"]+$/, '');

  // Drop a trailing ")" only when it has no opening partner inside the URL.
  while (cleaned.endsWith(')') && !cleaned.includes('(')) {
    cleaned = cleaned.slice(0, -1);
  }

  return cleaned;
}

/**
 * Extract every URL from text, de-duplicated and normalized.
 * @param {string} text - Arbitrary text
 * @returns {Array<{url: string, domain: string}>} Unique links in first-seen order
 */
function extractLinks(text) {
  if (typeof text !== 'string') {
    return [];
  }

  const seen = new Set();
  const links = [];

  for (const match of text.matchAll(URL_PATTERN)) {
    const cleaned = trimUrl(match[0]);

    let parsed;
    try {
      parsed = new URL(cleaned);
    } catch {
      continue;
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      continue;
    }

    const normalized = parsed.toString();
    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    links.push({ url: normalized, domain: parsed.hostname.replace(/^www\./, '') });
  }

  return links;
}

/**
 * Extract GitHub repositories mentioned in text.
 * Full `github.com/...` URLs are trusted; bare `owner/repo` shorthand is only
 * accepted when the same text also mentions GitHub, which keeps ordinary paths
 * and prose out of the results.
 * @param {string} text - Arbitrary text
 * @returns {Array<{owner: string, repo: string, fullName: string, url: string, confidence: string}>}
 */
function extractGithubRepos(text) {
  if (typeof text !== 'string') {
    return [];
  }

  const found = new Map();

  const add = (owner, repo, confidence) => {
    const cleanRepo = repo.replace(/\.git$/i, '').replace(/[.]+$/, '');
    if (!cleanRepo || GITHUB_RESERVED.has(owner.toLowerCase())) {
      return;
    }

    const fullName = `${owner}/${cleanRepo}`;
    const key = fullName.toLowerCase();
    if (found.has(key)) {
      return;
    }

    found.set(key, {
      owner,
      repo: cleanRepo,
      fullName,
      url: `https://github.com/${fullName}`,
      confidence
    });
  };

  for (const match of text.matchAll(GITHUB_URL_PATTERN)) {
    add(match[1], match[2], 'high');
  }

  if (/github/i.test(text)) {
    for (const match of text.matchAll(BARE_REPO_PATTERN)) {
      const candidate = `${match[1]}/${match[2]}`.toLowerCase();
      if (!NOT_A_REPO.has(candidate) && !candidate.includes('.com/')) {
        add(match[1], match[2], 'low');
      }
    }
  }

  return [...found.values()];
}

/**
 * Extract @handles from text.
 * @param {string} text - Arbitrary text
 * @returns {Array<string>} Unique handles without the leading @
 */
function extractHandles(text) {
  if (typeof text !== 'string') {
    return [];
  }

  const handles = new Set();
  for (const match of text.matchAll(HANDLE_PATTERN)) {
    // A trailing dot is sentence punctuation, not part of the handle.
    const handle = match[1].replace(/\.+$/, '');
    if (handle.length >= 2) {
      handles.add(handle);
    }
  }

  return [...handles];
}

/**
 * Extract #hashtags from text.
 * @param {string} text - Arbitrary text
 * @returns {Array<string>} Unique hashtags without the leading #
 */
function extractHashtags(text) {
  if (typeof text !== 'string') {
    return [];
  }

  const tags = new Set();
  for (const match of text.matchAll(HASHTAG_PATTERN)) {
    tags.add(match[1]);
  }

  return [...tags];
}

/**
 * Extract chapter markers written into a description, e.g. `00:00 Intro`.
 * @param {string} text - Description text
 * @returns {Array<{timestamp: string, label: string}>} Chapter markers in order
 */
function extractTimestamps(text) {
  if (typeof text !== 'string') {
    return [];
  }

  const chapters = [];
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*[-*•]?\s*((?:\d{1,2}:)?\d{1,2}:\d{2})\s*[-–—:)\]]?\s*(.+)$/);
    if (match && match[2].trim()) {
      chapters.push({ timestamp: match[1], label: match[2].trim().slice(0, 200) });
    }
  }

  return chapters;
}

/**
 * Run every extractor over a video's combined text.
 * @param {Object} sources - Text sources
 * @param {string} [sources.description] - Video description
 * @param {string} [sources.transcript] - Transcript text
 * @param {string} [sources.title] - Video title
 * @returns {Object} All extracted entities, with link provenance
 */
function extractAll({ description = '', transcript = '', title = '' } = {}) {
  const combined = [title, description, transcript].filter(Boolean).join('\n');

  const descriptionLinks = new Set(extractLinks(description).map((l) => l.url));

  return {
    links: extractLinks(combined).map((link) => ({
      ...link,
      source: descriptionLinks.has(link.url) ? 'description' : 'transcript'
    })),
    githubRepos: extractGithubRepos(combined),
    handles: extractHandles(combined),
    hashtags: extractHashtags(combined),
    chapters: extractTimestamps(description)
  };
}

module.exports = {
  extractAll,
  extractLinks,
  extractGithubRepos,
  extractHandles,
  extractHashtags,
  extractTimestamps
};
