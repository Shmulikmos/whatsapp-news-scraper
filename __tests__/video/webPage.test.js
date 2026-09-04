const {
  parsePage,
  fetchPage,
  extractMeta,
  extractJsonLd,
  extractProduct,
  extractText,
  decodeEntities,
  PageFetchError
} = require('../../src/video/webPage');

const PRODUCT_HTML = `<!DOCTYPE html><html lang="en"><head>
<title>AI Smart Glasses 8MP Camera &amp; 1080p &ndash; Vaxapack</title>
<meta name="description" content="Smart glasses with an 8MP camera and voice AI translation.">
<meta property="og:site_name" content="Vaxapack">
<meta property="og:type" content="product">
<meta property="og:image" content="https://cdn.example/img.jpg">
<meta name="keywords" content="smart glasses, AI, wearable">
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Product","name":"AI Smart Glasses",
 "brand":{"@type":"Brand","name":"Vaxapack"},"sku":"VX-1080",
 "offers":{"@type":"Offer","price":"89.99","priceCurrency":"USD",
           "availability":"https://schema.org/InStock"},
 "aggregateRating":{"ratingValue":"4.6","reviewCount":"212"}}
</script></head>
<body><script>var tracking = 1;</script><style>p { color: red }</style>
<h1>AI Smart Glasses</h1><p>Records 1080p video.</p><li>8MP camera</li>
<p>Manual at https://docs.vaxapack.com/glasses</p>
</body></html>`;

/**
 * Build a fake fetch serving canned responses per URL.
 * @param {Object} routes - URL → {status, headers, body, location}
 * @returns {Function} fetch stand-in that records the URLs it saw
 */
function fakeFetch(routes) {
  const calls = [];

  const impl = async (url) => {
    calls.push(url);
    const route = routes[url] || { status: 404, body: '' };

    return {
      ok: route.status >= 200 && route.status < 300,
      status: route.status,
      headers: {
        get: (name) => {
          const key = name.toLowerCase();
          if (key === 'location') return route.location || null;
          if (key === 'content-type') return route.contentType ?? 'text/html; charset=utf-8';
          if (key === 'content-length') return route.contentLength ?? null;
          return null;
        }
      },
      body: null,
      text: async () => route.body || ''
    };
  };

  impl.calls = calls;
  return impl;
}

/** DNS stand-in that answers with a public address for any name. */
const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

describe('decodeEntities', () => {
  test.each([
    ['a &amp; b', 'a & b'],
    ['&lt;tag&gt;', '<tag>'],
    ['caf&#233;', 'café'],
    ['&#x05E9;&#x05DC;&#x05D5;&#x05DD;', 'שלום'],
    ['1080p &ndash; HD', '1080p - HD'],
    ['&unknownentity;', '&unknownentity;']
  ])('decodes %s', (input, expected) => {
    expect(decodeEntities(input)).toBe(expected);
  });
});

describe('extractMeta', () => {
  test('reads name, property, and itemprop tags', () => {
    const meta = extractMeta(PRODUCT_HTML);
    expect(meta.description).toContain('8MP camera');
    expect(meta['og:site_name']).toBe('Vaxapack');
    expect(meta['og:type']).toBe('product');
  });

  test('returns an empty object for a page with no meta tags', () => {
    expect(extractMeta('<html><body>hi</body></html>')).toEqual({});
  });
});

describe('extractJsonLd / extractProduct', () => {
  test('extracts product facts from JSON-LD', () => {
    expect(extractProduct(extractJsonLd(PRODUCT_HTML))).toEqual({
      name: 'AI Smart Glasses',
      brand: 'Vaxapack',
      sku: 'VX-1080',
      price: '89.99',
      currency: 'USD',
      availability: 'InStock',
      rating: '4.6',
      reviewCount: '212',
      description: ''
    });
  });

  test('flattens an @graph wrapper', () => {
    const html = `<script type="application/ld+json">
      {"@graph":[{"@type":"WebSite"},{"@type":"Product","name":"X"}]}</script>`;
    expect(extractProduct(extractJsonLd(html)).name).toBe('X');
  });

  test('handles an array of top-level objects', () => {
    const html = `<script type="application/ld+json">
      [{"@type":"Organization"},{"@type":"Product","name":"Y"}]</script>`;
    expect(extractProduct(extractJsonLd(html)).name).toBe('Y');
  });

  test('accepts an @type given as an array', () => {
    const html = `<script type="application/ld+json">
      {"@type":["Thing","Product"],"name":"Z"}</script>`;
    expect(extractProduct(extractJsonLd(html)).name).toBe('Z');
  });

  test('skips a malformed JSON-LD block instead of throwing', () => {
    const html = '<script type="application/ld+json">{ not json }</script>';
    expect(extractJsonLd(html)).toEqual([]);
  });

  test('returns null when the page is not a product', () => {
    expect(extractProduct([{ '@type': 'Article' }])).toBeNull();
    expect(extractProduct([])).toBeNull();
  });
});

describe('extractText', () => {
  test('strips scripts, styles, and tags but keeps the words', () => {
    const text = extractText(PRODUCT_HTML, 10000);

    expect(text).toContain('Records 1080p video.');
    expect(text).toContain('8MP camera');
    expect(text).not.toContain('var tracking');
    expect(text).not.toContain('color: red');
    expect(text).not.toContain('<');
  });

  test('keeps URLs intact, so the entity extractor can find them', () => {
    expect(extractText(PRODUCT_HTML, 10000)).toContain('https://docs.vaxapack.com/glasses');
  });

  test('turns block boundaries into line breaks', () => {
    expect(extractText('<p>one</p><p>two</p>', 100).split('\n')).toEqual(['one', 'two']);
  });

  test('honours the character cap', () => {
    const text = extractText(`<p>${'x'.repeat(5000)}</p>`, 100);
    expect(text.length).toBeLessThan(200);
    expect(text).toContain('truncated');
  });
});

describe('parsePage', () => {
  test('normalizes a product page into the archive shape', () => {
    const metadata = parsePage(PRODUCT_HTML, 'https://www.vaxapack.com/products/x');

    expect(metadata.title).toBe('AI Smart Glasses 8MP Camera & 1080p - Vaxapack');
    expect(metadata.channel).toBe('Vaxapack');
    expect(metadata.pageType).toBe('product');
    expect(metadata.language).toBe('en');
    expect(metadata.product.price).toBe('89.99');
    expect(metadata.tags).toEqual(['smart glasses', 'AI', 'wearable']);
    expect(metadata.durationSec).toBeNull();
  });

  test('falls back to the hostname when there is no og:site_name', () => {
    const metadata = parsePage('<html><head><title>T</title></head></html>', 'https://www.shop.co.il/a');
    expect(metadata.channel).toBe('shop.co.il');
  });

  test('prefers og:title over the title tag', () => {
    const html = '<head><title>Tab title</title><meta property="og:title" content="Real title"></head>';
    expect(parsePage(html, 'https://a.com/').title).toBe('Real title');
  });

  test('copes with a page that has almost nothing', () => {
    const metadata = parsePage('<html></html>', 'https://a.com/');
    expect(metadata.title).toBe('');
    expect(metadata.product).toBeNull();
    expect(metadata.text).toBe('');
  });
});

describe('fetchPage', () => {
  test('fetches a page and returns its HTML', async () => {
    const fetchImpl = fakeFetch({
      'https://example.com/p': { status: 200, body: PRODUCT_HTML }
    });

    const result = await fetchPage('https://example.com/p', { fetchImpl, lookup: publicLookup });
    expect(result.html).toContain('AI Smart Glasses');
    expect(result.finalUrl).toBe('https://example.com/p');
  });

  test('follows a redirect to another public host', async () => {
    const fetchImpl = fakeFetch({
      'https://example.com/p': { status: 301, location: 'https://shop.example.org/p' },
      'https://shop.example.org/p': { status: 200, body: '<title>Moved</title>' }
    });

    const result = await fetchPage('https://example.com/p', { fetchImpl, lookup: publicLookup });
    expect(result.finalUrl).toBe('https://shop.example.org/p');
    expect(fetchImpl.calls).toHaveLength(2);
  });

  test.each([
    ['loopback', 'http://127.0.0.1/admin'],
    ['cloud metadata', 'http://169.254.169.254/latest/meta-data/'],
    ['private network', 'http://10.0.0.1/admin'],
    ['file protocol', 'file:///etc/passwd']
  ])('refuses a redirect to %s', async (_label, target) => {
    const fetchImpl = fakeFetch({
      'https://example.com/p': { status: 302, location: target }
    });

    await expect(fetchPage('https://example.com/p', { fetchImpl, lookup: publicLookup }))
      .rejects.toThrow();

    // The hostile hop was never requested.
    expect(fetchImpl.calls).toEqual(['https://example.com/p']);
  });

  test('refuses a redirect to a name that resolves internally', async () => {
    const fetchImpl = fakeFetch({
      'https://example.com/p': { status: 307, location: 'https://rebind.example.net/x' }
    });

    const lookup = async (host) =>
      (host === 'rebind.example.net'
        ? [{ address: '192.168.1.10', family: 4 }]
        : [{ address: '93.184.216.34', family: 4 }]);

    await expect(fetchPage('https://example.com/p', { fetchImpl, lookup }))
      .rejects.toThrow(/non-public address/);
    expect(fetchImpl.calls).toEqual(['https://example.com/p']);
  });

  test('stops after too many redirects', async () => {
    const fetchImpl = fakeFetch({
      'https://example.com/p': { status: 302, location: 'https://example.com/p' }
    });

    await expect(fetchPage('https://example.com/p', { fetchImpl, lookup: publicLookup }))
      .rejects.toThrow(/Too many redirects/);
  });

  test('rejects a non-HTML content type', async () => {
    const fetchImpl = fakeFetch({
      'https://example.com/f.pdf': { status: 200, body: '%PDF', contentType: 'application/pdf' }
    });

    await expect(fetchPage('https://example.com/f.pdf', { fetchImpl, lookup: publicLookup }))
      .rejects.toThrow(/Unsupported content type/);
  });

  test('rejects a page that declares a size over the cap', async () => {
    const fetchImpl = fakeFetch({
      'https://example.com/big': { status: 200, body: 'x', contentLength: String(50 * 1024 * 1024) }
    });

    await expect(fetchPage('https://example.com/big', { fetchImpl, lookup: publicLookup }))
      .rejects.toThrow(/over the/);
  });

  test('names a proxy denial rather than reporting a site error', async () => {
    const fetchImpl = fakeFetch({ 'https://example.com/p': { status: 403 } });

    await expect(fetchPage('https://example.com/p', { fetchImpl, lookup: publicLookup }))
      .rejects.toThrow(/proxy or egress policy/);
  });

  test('surfaces an ordinary HTTP error', async () => {
    const fetchImpl = fakeFetch({ 'https://example.com/p': { status: 500 } });

    await expect(fetchPage('https://example.com/p', { fetchImpl, lookup: publicLookup }))
      .rejects.toThrow(PageFetchError);
  });

  test('rejects a redirect with no Location header', async () => {
    const fetchImpl = fakeFetch({ 'https://example.com/p': { status: 302 } });

    await expect(fetchPage('https://example.com/p', { fetchImpl, lookup: publicLookup }))
      .rejects.toThrow(/no Location header/);
  });
});
