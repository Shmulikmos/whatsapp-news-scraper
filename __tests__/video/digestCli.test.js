const { parseArgs, probeHost } = require('../../bin/digest');

describe('parseArgs', () => {
  test('separates URLs from flags', () => {
    const { urls, flags } = parseArgs(['https://youtu.be/aaa', '--force', 'https://youtu.be/bbb']);

    expect(urls).toEqual(['https://youtu.be/aaa', 'https://youtu.be/bbb']);
    expect(flags.has('--force')).toBe(true);
  });

  test('ignores blank arguments', () => {
    expect(parseArgs(['  ', 'https://youtu.be/aaa']).urls).toEqual(['https://youtu.be/aaa']);
  });

  test('returns no URLs when only flags are given', () => {
    expect(parseArgs(['--check']).urls).toEqual([]);
  });
});

describe('probeHost', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test('reports a reachable host', async () => {
    globalThis.fetch = async () => ({ status: 200 });
    expect(await probeHost('https://example.com/')).toEqual({
      ok: true,
      detail: 'reachable (HTTP 200)'
    });
  });

  test.each([403, 407])('reports HTTP %s as a proxy or egress denial', async (status) => {
    globalThis.fetch = async () => ({ status });
    const result = await probeHost('https://example.com/');

    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/blocked by a proxy or egress policy/);
  });

  test('reports a connection failure as unreachable', async () => {
    globalThis.fetch = async () => {
      throw new Error('ENOTFOUND');
    };

    const result = await probeHost('https://example.com/');
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('ENOTFOUND');
  });

  test('reports an abort as a timeout', async () => {
    globalThis.fetch = async () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    };

    expect((await probeHost('https://example.com/')).detail).toContain('timed out');
  });
});
