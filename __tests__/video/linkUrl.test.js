const {
  parseLinkUrl,
  assertPublicHost,
  isPublicIPv4,
  isPublicIPv6,
  InvalidLinkUrlError
} = require('../../src/video/linkUrl');

describe('isPublicIPv4', () => {
  test.each([
    ['8.8.8.8'], ['1.1.1.1'], ['104.18.32.1'], ['172.15.0.1'], ['172.32.0.1']
  ])('accepts public %s', (ip) => {
    expect(isPublicIPv4(ip)).toBe(true);
  });

  test.each([
    ['0.0.0.0'], ['10.0.0.1'], ['10.255.255.255'], ['127.0.0.1'], ['127.1.2.3'],
    ['169.254.169.254'], ['172.16.0.1'], ['172.31.255.255'], ['192.168.1.1'],
    ['100.64.0.1'], ['100.127.255.255'], ['192.0.0.1'], ['192.0.2.1'],
    ['198.18.0.1'], ['198.51.100.1'], ['203.0.113.1'], ['224.0.0.1'],
    ['239.1.1.1'], ['255.255.255.255'], ['not.an.ip.address'], ['1.2.3'], ['1.2.3.999']
  ])('rejects non-public %s', (ip) => {
    expect(isPublicIPv4(ip)).toBe(false);
  });
});

describe('isPublicIPv6', () => {
  test.each([['2606:4700:4700::1111'], ['2001:4860:4860::8888']])('accepts public %s', (ip) => {
    expect(isPublicIPv6(ip)).toBe(true);
  });

  test.each([
    ['::1'], ['::'], ['fd00::1'], ['fc00::1'], ['fe80::1'], ['ff02::1'],
    ['::ffff:127.0.0.1'], ['::ffff:10.0.0.1'], ['::ffff:192.168.0.1'],
    ['::ffff:7f00:1'], ['::ffff:a00:1'], ['::ffff:c0a8:1'], ['::ffff:a9fe:a9fe']
  ])('rejects non-public %s', (ip) => {
    expect(isPublicIPv6(ip)).toBe(false);
  });
});

describe('parseLinkUrl - accepted', () => {
  test('accepts an ordinary product URL', () => {
    const result = parseLinkUrl('https://www.vaxapack.com/products/ai-smart-glasses');

    expect(result.sourceType).toBeUndefined(); // set by the pipeline, not here
    expect(result.host).toBe('www.vaxapack.com');
    expect(result.id).toMatch(/^web:[0-9a-f]{16}$/);
  });

  test('accepts a public IP literal', () => {
    expect(parseLinkUrl('https://8.8.8.8/status').host).toBe('8.8.8.8');
  });

  test.each([
    ['utm parameters', 'https://s.com/p?utm_source=ig&utm_medium=cpc&id=7', 'https://s.com/p?id=7'],
    ['fbclid', 'https://s.com/p?id=7&fbclid=xyz', 'https://s.com/p?id=7'],
    ['instagram igsi', 'https://s.com/p?igsi=abc', 'https://s.com/p'],
    ['a fragment', 'https://s.com/p#reviews', 'https://s.com/p']
  ])('strips %s', (_label, input, expected) => {
    expect(parseLinkUrl(input).canonicalUrl).toBe(expected);
  });

  test('keeps meaningful query parameters', () => {
    expect(parseLinkUrl('https://s.com/p?variant=42&size=L').canonicalUrl)
      .toBe('https://s.com/p?variant=42&size=L');
  });

  test('gives the same id to the same page sent with different tracking', () => {
    const a = parseLinkUrl('https://s.com/p?utm_source=x&id=1');
    const b = parseLinkUrl('https://s.com/p?id=1&gclid=y');
    expect(a.id).toBe(b.id);
  });

  test('gives different ids to genuinely different pages', () => {
    expect(parseLinkUrl('https://s.com/a').id).not.toBe(parseLinkUrl('https://s.com/b').id);
  });
});

describe('parseLinkUrl - SSRF rejections', () => {
  test.each([
    ['loopback name', 'http://localhost/x'],
    ['loopback name with domain', 'http://localhost.localdomain/x'],
    ['loopback IPv4', 'http://127.0.0.1/x'],
    ['loopback IPv4, alternate', 'http://127.99.1.2/x'],
    ['loopback IPv6', 'http://[::1]/x'],
    ['cloud metadata IP', 'http://169.254.169.254/latest/meta-data/'],
    ['GCP metadata name', 'http://metadata.google.internal/computeMetadata/v1/'],
    ['private 10/8', 'http://10.1.2.3/admin'],
    ['private 172.16/12', 'http://172.20.0.1/admin'],
    ['private 192.168/16', 'http://192.168.0.1/admin'],
    ['carrier-grade NAT', 'http://100.100.0.1/x'],
    ['IPv6 unique-local', 'http://[fd00::1]/x'],
    ['IPv6 link-local', 'http://[fe80::1]/x'],
    ['IPv4-mapped loopback', 'http://[::ffff:127.0.0.1]/x'],
    ['IPv4-mapped private', 'http://[::ffff:192.168.1.1]/x'],
    ['IPv4-mapped metadata', 'http://[::ffff:169.254.169.254]/x'],
    ['.internal suffix', 'http://vault.internal/secrets'],
    ['.local suffix', 'http://printer.local/'],
    ['.corp suffix', 'http://wiki.corp/'],
    ['single-label host', 'http://intranet/'],
    ['non-standard port', 'https://example.com:2375/containers'],
    ['SSH port', 'https://example.com:22/'],
    ['file protocol', 'file:///etc/passwd'],
    ['gopher protocol', 'gopher://example.com/'],
    ['javascript protocol', 'javascript:alert(1)'],
    ['embedded credentials', 'https://user:pass@example.com/'],
    ['leading dash', '-oflag'],
    ['empty', ''],
    ['not a URL', 'hello world']
  ])('rejects %s', (_label, url) => {
    expect(() => parseLinkUrl(url)).toThrow(InvalidLinkUrlError);
  });

  test('rejects non-string input', () => {
    expect(() => parseLinkUrl(null)).toThrow(InvalidLinkUrlError);
    expect(() => parseLinkUrl(42)).toThrow(InvalidLinkUrlError);
  });
});

describe('assertPublicHost', () => {
  test('accepts a hostname that resolves only to public addresses', async () => {
    const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
    await expect(assertPublicHost('example.com', { lookup })).resolves.toHaveLength(1);
  });

  test('rejects a hostname that resolves to a private address', async () => {
    const lookup = async () => [{ address: '10.0.0.7', family: 4 }];
    await expect(assertPublicHost('sneaky.example.com', { lookup }))
      .rejects.toThrow(/non-public address/);
  });

  test('rejects when only one of several answers is internal', async () => {
    const lookup = async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 }
    ];
    await expect(assertPublicHost('mixed.example.com', { lookup }))
      .rejects.toThrow(/non-public address/);
  });

  test('rejects an IPv6 answer in the unique-local range', async () => {
    const lookup = async () => [{ address: 'fd00::1', family: 6 }];
    await expect(assertPublicHost('v6.example.com', { lookup }))
      .rejects.toThrow(/non-public address/);
  });

  test('rejects a host that resolves to nothing', async () => {
    await expect(assertPublicHost('void.example.com', { lookup: async () => [] }))
      .rejects.toThrow(/resolved to no addresses/);
  });

  test('reports a resolution failure as an error', async () => {
    const lookup = async () => {
      throw new Error('ENOTFOUND');
    };
    await expect(assertPublicHost('gone.example.com', { lookup }))
      .rejects.toThrow(/Could not resolve/);
  });

  test('checks a literal address without any DNS call', async () => {
    const lookup = jest.fn();

    await expect(assertPublicHost('8.8.8.8', { lookup })).resolves.toEqual([
      { address: '8.8.8.8', family: 4 }
    ]);
    await expect(assertPublicHost('127.0.0.1', { lookup })).rejects.toThrow(/non-public/);
    expect(lookup).not.toHaveBeenCalled();
  });
});
