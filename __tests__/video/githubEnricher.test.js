const { enrichRepo, enrichRepos, formatReposCell } = require('../../src/video/githubEnricher');

/**
 * Build a fake fetch that serves canned responses per URL.
 * @param {Object} routes - URL → {status, body, location}
 * @returns {Function} fetch stand-in that records the URLs it was called with
 */
function fakeFetch(routes) {
  const calls = [];

  const impl = async (url) => {
    calls.push(url);
    const route = routes[url];

    if (!route) {
      return {
        ok: false,
        status: 404,
        headers: { get: () => null },
        json: async () => ({})
      };
    }

    return {
      ok: route.status >= 200 && route.status < 300,
      status: route.status,
      headers: { get: (name) => (name.toLowerCase() === 'location' ? route.location || null : null) },
      json: async () => route.body
    };
  };

  impl.calls = calls;
  return impl;
}

const REPO_BODY = {
  full_name: 'anthropics/claude-code',
  html_url: 'https://github.com/anthropics/claude-code',
  description: 'Claude Code CLI',
  stargazers_count: 1234,
  forks_count: 56,
  language: 'TypeScript',
  license: { spdx_id: 'MIT' },
  topics: ['cli', 'ai'],
  homepage: 'https://claude.com/code',
  archived: false,
  pushed_at: '2026-08-30T10:00:00Z',
  default_branch: 'main'
};

describe('enrichRepo', () => {
  test('returns live metadata for a repository that exists', async () => {
    const fetchImpl = fakeFetch({
      'https://api.github.com/repos/anthropics/claude-code': { status: 200, body: REPO_BODY }
    });

    const result = await enrichRepo(
      { owner: 'anthropics', repo: 'claude-code', fullName: 'anthropics/claude-code', confidence: 'high' },
      { fetchImpl }
    );

    expect(result).toMatchObject({
      exists: true,
      stars: 1234,
      language: 'TypeScript',
      license: 'MIT',
      description: 'Claude Code CLI'
    });
  });

  test('marks a missing repository as not existing', async () => {
    const result = await enrichRepo(
      { owner: 'nobody', repo: 'nothing', fullName: 'nobody/nothing', confidence: 'low' },
      { fetchImpl: fakeFetch({}) }
    );

    expect(result.exists).toBe(false);
    expect(result.error).toBe('not found');
  });

  test('follows a rename redirect that stays on the API host', async () => {
    const fetchImpl = fakeFetch({
      'https://api.github.com/repos/old/name': {
        status: 301,
        location: 'https://api.github.com/repos/new/name'
      },
      'https://api.github.com/repos/new/name': { status: 200, body: REPO_BODY }
    });

    const result = await enrichRepo(
      { owner: 'old', repo: 'name', fullName: 'old/name', confidence: 'high' },
      { fetchImpl }
    );

    expect(result.exists).toBe(true);
    expect(fetchImpl.calls).toHaveLength(2);
  });

  test('T8 - refuses a redirect that leaves the API host', async () => {
    const fetchImpl = fakeFetch({
      'https://api.github.com/repos/foo/bar': {
        status: 302,
        location: 'https://attacker.example.com/steal'
      }
    });

    const result = await enrichRepo(
      { owner: 'foo', repo: 'bar', fullName: 'foo/bar', confidence: 'high' },
      { fetchImpl }
    );

    expect(result.exists).toBe(false);
    expect(fetchImpl.calls).toEqual(['https://api.github.com/repos/foo/bar']);
  });

  test('T8 - refuses a protocol-downgrade redirect', async () => {
    const fetchImpl = fakeFetch({
      'https://api.github.com/repos/foo/bar': {
        status: 307,
        location: 'http://api.github.com/repos/foo/bar'
      }
    });

    const result = await enrichRepo(
      { owner: 'foo', repo: 'bar', fullName: 'foo/bar', confidence: 'high' },
      { fetchImpl }
    );

    expect(result.exists).toBe(false);
  });

  test('rejects a malformed repository name without any network call', async () => {
    const fetchImpl = fakeFetch({});

    const result = await enrichRepo(
      { owner: '../etc', repo: 'passwd', fullName: '../etc/passwd', confidence: 'low' },
      { fetchImpl }
    );

    expect(result.exists).toBe(false);
    expect(result.error).toBe('invalid repository name');
    expect(fetchImpl.calls).toEqual([]);
  });

  test('reports a network failure instead of throwing', async () => {
    const fetchImpl = async () => {
      throw new Error('ECONNREFUSED');
    };

    const result = await enrichRepo(
      { owner: 'foo', repo: 'bar', fullName: 'foo/bar', confidence: 'high' },
      { fetchImpl }
    );

    expect(result.exists).toBe(false);
    expect(result.error).toContain('ECONNREFUSED');
  });
});

describe('enrichRepos', () => {
  test('drops unverified low-confidence guesses but keeps high-confidence URLs', async () => {
    const fetchImpl = fakeFetch({
      'https://api.github.com/repos/anthropics/claude-code': { status: 200, body: REPO_BODY }
    });

    const result = await enrichRepos([
      { owner: 'anthropics', repo: 'claude-code', fullName: 'anthropics/claude-code', confidence: 'high' },
      { owner: 'made', repo: 'up', fullName: 'made/up', confidence: 'low' },
      { owner: 'also', repo: 'missing', fullName: 'also/missing', confidence: 'high' }
    ], { fetchImpl });

    expect(result.map((r) => r.fullName)).toEqual(['anthropics/claude-code', 'also/missing']);
    expect(result[0].exists).toBe(true);
    expect(result[1].exists).toBe(false);
  });

  test('returns nothing for an empty input', async () => {
    expect(await enrichRepos([])).toEqual([]);
    expect(await enrichRepos(null)).toEqual([]);
  });
});

describe('formatReposCell', () => {
  test('renders verified repos with stars and description', () => {
    const cell = formatReposCell([
      { fullName: 'a/b', exists: true, stars: 10, description: 'thing' },
      { fullName: 'c/d', exists: false }
    ]);

    expect(cell).toBe('a/b (★10) — thing\nc/d (unverified)');
  });

  test('handles an empty list', () => {
    expect(formatReposCell([])).toBe('');
    expect(formatReposCell(null)).toBe('');
  });
});
