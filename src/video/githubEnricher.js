/**
 * GitHub Enricher Module
 * Looks up live metadata for repositories mentioned in a video.
 *
 * Read-only and deliberately narrow: only `api.github.com` is contacted, nothing
 * is ever cloned or executed, redirects are followed at most once and only when
 * they stay on the API host, and the token (if any) is never logged or archived.
 */

const config = require('../config');
const logger = require('../logger');
const { redact } = require('./redact');

const API_HOST = 'api.github.com';

/** GitHub's own limits: owner <= 39 chars, repo <= 100. */
const OWNER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const REPO_PATTERN = /^[A-Za-z0-9_.-]{1,100}$/;

/**
 * Build request headers, adding the token only when one is configured.
 * @returns {Object} Header map
 */
function buildHeaders() {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'video-digest-archive'
  };

  if (config.video.githubToken) {
    headers.Authorization = `Bearer ${config.video.githubToken}`;
  }

  return headers;
}

/**
 * Fetch one API path, following at most one same-host redirect.
 * @param {string} apiPath - Path beginning with `/`
 * @param {Object} [deps] - Injected dependencies (for testing)
 * @param {Function} [deps.fetchImpl] - fetch implementation
 * @returns {Promise<{status: number, body: Object|null}>} Status and parsed body
 */
async function apiGet(apiPath, { fetchImpl = globalThis.fetch } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.video.githubTimeoutMs);

  try {
    let url = `https://${API_HOST}${apiPath}`;

    for (let hop = 0; hop <= 1; hop++) {
      const response = await fetchImpl(url, {
        headers: buildHeaders(),
        redirect: 'manual',
        signal: controller.signal
      });

      // GitHub 301s renamed repositories; follow only within the API host.
      if ([301, 302, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location || hop === 1) {
          return { status: response.status, body: null };
        }

        const next = new URL(location, url);
        if (next.hostname !== API_HOST || next.protocol !== 'https:') {
          logger.warn(`Refusing GitHub redirect off ${API_HOST}: ${next.hostname}`);
          return { status: response.status, body: null };
        }

        url = next.toString();
        continue;
      }

      if (!response.ok) {
        return { status: response.status, body: null };
      }

      return { status: response.status, body: await response.json() };
    }

    return { status: 508, body: null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch metadata for a single repository.
 * @param {{owner: string, repo: string, fullName: string}} repo - Repo reference
 * @param {Object} [deps] - Injected dependencies (for testing)
 * @returns {Promise<Object>} Enriched repo record; `exists: false` when not found
 */
async function enrichRepo(repo, deps = {}) {
  if (!OWNER_PATTERN.test(repo.owner) || !REPO_PATTERN.test(repo.repo)) {
    return { ...repo, exists: false, error: 'invalid repository name' };
  }

  const path = `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`;

  try {
    const { status, body } = await apiGet(path, deps);

    if (status === 404) {
      return { ...repo, exists: false, error: 'not found' };
    }

    if (!body) {
      return { ...repo, exists: false, error: `HTTP ${status}` };
    }

    return {
      ...repo,
      exists: true,
      fullName: body.full_name || repo.fullName,
      url: body.html_url || repo.url,
      description: body.description || '',
      stars: body.stargazers_count ?? null,
      forks: body.forks_count ?? null,
      language: body.language || '',
      license: body.license?.spdx_id || '',
      topics: Array.isArray(body.topics) ? body.topics.slice(0, 20) : [],
      homepage: body.homepage || '',
      archived: Boolean(body.archived),
      pushedAt: body.pushed_at || null,
      defaultBranch: body.default_branch || ''
    };
  } catch (error) {
    const reason = error.name === 'AbortError' ? 'timed out' : redact(error.message);
    logger.warn(`GitHub lookup failed for ${repo.fullName}: ${reason}`);
    return { ...repo, exists: false, error: reason };
  }
}

/**
 * Enrich every repository detected in a video, in parallel and capped.
 * Low-confidence (bare `owner/repo`) mentions that turn out not to exist are
 * dropped, which is what makes the shorthand detection safe to keep.
 * @param {Array<Object>} repos - Repos from the entity extractor
 * @param {Object} [deps] - Injected dependencies (for testing)
 * @returns {Promise<Array<Object>>} Enriched repos, existing ones first
 */
async function enrichRepos(repos, deps = {}) {
  if (!config.video.githubEnabled || !Array.isArray(repos) || repos.length === 0) {
    return [];
  }

  const capped = repos.slice(0, config.video.maxReposPerVideo);
  const enriched = await Promise.all(capped.map((repo) => enrichRepo(repo, deps)));

  const kept = enriched.filter((repo) => repo.exists || repo.confidence === 'high');

  return kept.sort((a, b) => {
    if (a.exists !== b.exists) {
      return a.exists ? -1 : 1;
    }
    return (b.stars ?? -1) - (a.stars ?? -1);
  });
}

/**
 * Render enriched repos as a single spreadsheet-friendly cell.
 * @param {Array<Object>} repos - Enriched repos
 * @returns {string} One repo per line
 */
function formatReposCell(repos) {
  return (repos || [])
    .map((repo) => {
      if (!repo.exists) {
        return `${repo.fullName} (unverified)`;
      }
      const stars = repo.stars === null ? '' : ` (★${repo.stars})`;
      const desc = repo.description ? ` — ${repo.description}` : '';
      return `${repo.fullName}${stars}${desc}`;
    })
    .join('\n');
}

module.exports = { enrichRepos, enrichRepo, formatReposCell, apiGet };
