const {
  extractAll,
  extractLinks,
  extractGithubRepos,
  extractHandles,
  extractHashtags,
  extractTimestamps
} = require('../../src/video/entities');

describe('extractLinks', () => {
  test('extracts and de-duplicates URLs', () => {
    const text = 'see https://example.com/a and https://example.com/a and http://other.org';
    expect(extractLinks(text).map((l) => l.url)).toEqual([
      'https://example.com/a',
      'http://other.org/'
    ]);
  });

  test('reports the bare domain', () => {
    expect(extractLinks('https://www.example.com/path')[0].domain).toBe('example.com');
  });

  test('trims trailing sentence punctuation', () => {
    expect(extractLinks('go to https://example.com/x.')[0].url).toBe('https://example.com/x');
  });

  test('keeps a closing paren that has an opening partner', () => {
    const url = 'https://en.wikipedia.org/wiki/Foo_(bar)';
    expect(extractLinks(`see ${url}`)[0].url).toBe(url);
  });

  test('drops an unmatched closing paren', () => {
    expect(extractLinks('(see https://example.com/x)')[0].url).toBe('https://example.com/x');
  });

  test('ignores non-http schemes', () => {
    expect(extractLinks('mailto:a@b.com javascript:alert(1)')).toEqual([]);
  });

  test('works inside Hebrew text', () => {
    expect(extractLinks('הקישור הוא https://example.co.il/מדריך')).toHaveLength(1);
  });

  test('returns an empty array for non-string input', () => {
    expect(extractLinks(null)).toEqual([]);
  });
});

describe('extractGithubRepos', () => {
  test('extracts a repo from a full URL with high confidence', () => {
    const repos = extractGithubRepos('code at https://github.com/anthropics/claude-code');
    expect(repos).toEqual([expect.objectContaining({
      owner: 'anthropics',
      repo: 'claude-code',
      fullName: 'anthropics/claude-code',
      confidence: 'high'
    })]);
  });

  test('extracts a schemeless github.com mention', () => {
    expect(extractGithubRepos('github.com/foo/bar')[0].fullName).toBe('foo/bar');
  });

  test('strips a trailing .git', () => {
    expect(extractGithubRepos('https://github.com/foo/bar.git')[0].repo).toBe('bar');
  });

  test('accepts bare owner/repo only when GitHub is mentioned nearby', () => {
    expect(extractGithubRepos('check out vercel/next.js on github')[0].fullName).toBe('vercel/next.js');
    expect(extractGithubRepos('check out vercel/next.js')).toEqual([]);
  });

  test('marks bare shorthand as low confidence', () => {
    expect(extractGithubRepos('github: vercel/next.js')[0].confidence).toBe('low');
  });

  test('ignores prose and paths that look like owner/repo', () => {
    const text = 'on github, use and/or, read src/main and ci/cd, ui/ux, tcp/ip';
    expect(extractGithubRepos(text)).toEqual([]);
  });

  test('ignores non-repository github.com paths', () => {
    expect(extractGithubRepos('https://github.com/features/copilot')).toEqual([]);
    expect(extractGithubRepos('https://github.com/settings/tokens')).toEqual([]);
  });

  test('de-duplicates case-insensitively', () => {
    const text = 'github.com/Foo/Bar and github.com/foo/bar';
    expect(extractGithubRepos(text)).toHaveLength(1);
  });
});

describe('extractHandles', () => {
  test('extracts @handles', () => {
    expect(extractHandles('follow @some.user and @another_one')).toEqual(['some.user', 'another_one']);
  });

  test('does not treat an email domain as a handle', () => {
    expect(extractHandles('write to me@example.com')).toEqual([]);
  });
});

describe('extractHashtags', () => {
  test('extracts Latin and Hebrew hashtags', () => {
    expect(extractHashtags('#AI ו #אבטחת_מידע')).toEqual(['AI', 'אבטחת_מידע']);
  });

  test('de-duplicates', () => {
    expect(extractHashtags('#ai #ai')).toEqual(['ai']);
  });
});

describe('extractTimestamps', () => {
  test('extracts chapter markers in several written forms', () => {
    const description = ['00:00 Intro', '01:23 - Setup', '1:02:03: Deep dive', '• 05:00 Demo'].join('\n');
    expect(extractTimestamps(description)).toEqual([
      { timestamp: '00:00', label: 'Intro' },
      { timestamp: '01:23', label: 'Setup' },
      { timestamp: '1:02:03', label: 'Deep dive' },
      { timestamp: '05:00', label: 'Demo' }
    ]);
  });

  test('ignores lines with no label', () => {
    expect(extractTimestamps('00:00\n01:00   ')).toEqual([]);
  });
});

describe('extractAll', () => {
  const description = 'Repo: https://github.com/foo/bar\nDocs: https://docs.example.com\n00:00 Intro';
  const transcript = 'and also at https://extra.example.org for more';

  test('labels link provenance', () => {
    const { links } = extractAll({ title: 'T', description, transcript });
    expect(links.find((l) => l.domain === 'docs.example.com').source).toBe('description');
    expect(links.find((l) => l.domain === 'extra.example.org').source).toBe('transcript');
  });

  test('searches title, description, and transcript together', () => {
    const result = extractAll({ title: 'About #AI', description, transcript });
    expect(result.hashtags).toEqual(['AI']);
    expect(result.githubRepos).toHaveLength(1);
    expect(result.chapters).toHaveLength(1);
  });

  test('handles being called with nothing', () => {
    const result = extractAll();
    expect(result).toEqual({
      links: [], githubRepos: [], handles: [], hashtags: [], chapters: []
    });
  });
});

describe('extractHandles - edge cases', () => {
  test('keeps a dot inside a handle but drops a trailing sentence dot', () => {
    expect(extractHandles('follow @some.user.')).toEqual(['some.user']);
  });

  test('an email address is not a handle, because @ is not word-initial', () => {
    expect(extractHandles('mail me@example.com or support@corp.co.il')).toEqual([]);
  });
});
