/**
 * Web Page Module
 * Fetches an arbitrary web link and extracts the structured content worth
 * archiving: title, description, Open Graph tags, JSON-LD (which is where
 * product price, brand, rating and availability actually live), and the
 * readable body text.
 *
 * Security: every hop is re-validated against the SSRF rules in linkUrl.js,
 * because a redirect is the classic way to turn an allowed URL into an internal
 * one. The response is size-capped and content-type-checked before it is read.
 */

const config = require('../config');
const logger = require('../logger');
const { redact } = require('./redact');
const { parseLinkUrl, assertPublicHost, InvalidLinkUrlError } = require('./linkUrl');

/** Browser-ish UA: many sites serve a stub or a block page to unknown clients. */
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

class PageFetchError extends Error {
  constructor(message, { cause } = {}) {
    super(message);
    this.name = 'PageFetchError';
    if (cause) {
      this.cause = cause;
    }
  }
}

/**
 * Decode the HTML entities that actually show up in titles and descriptions.
 * @param {string} text - Raw text
 * @returns {string} Decoded text
 */
function decodeEntities(text) {
  return String(text || '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
      const named = {
        amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
        ndash: '-', mdash: '-', hellip: '...', rsquo: "'", lsquo: "'",
        rdquo: '"', ldquo: '"', trade: '™', reg: '®', copy: '©', deg: '°'
      };

      if (entity.startsWith('#x') || entity.startsWith('#X')) {
        return String.fromCodePoint(parseInt(entity.slice(2), 16));
      }
      if (entity.startsWith('#')) {
        return String.fromCodePoint(parseInt(entity.slice(1), 10));
      }
      return Object.prototype.hasOwnProperty.call(named, entity.toLowerCase())
        ? named[entity.toLowerCase()]
        : match;
    });
}

/**
 * Read every `<meta>` tag into a name/property keyed map.
 * @param {string} html - Page HTML
 * @returns {Object} Meta values, keyed lowercase
 */
function extractMeta(html) {
  const meta = {};

  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const key = tag.match(/\b(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i);
    const value = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i);

    if (key && value) {
      meta[key[1].toLowerCase()] = decodeEntities(value[1]).trim();
    }
  }

  return meta;
}

/**
 * Parse the JSON-LD blocks a page publishes.
 * This is where e-commerce pages put price, currency, brand, and availability.
 * @param {string} html - Page HTML
 * @returns {Array<Object>} Parsed JSON-LD objects, flattened out of @graph
 */
function extractJsonLd(html) {
  const blocks = html.match(
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  ) || [];

  const results = [];

  for (const block of blocks) {
    const body = block.replace(/^<script\b[^>]*>/i, '').replace(/<\/script>$/i, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      continue; // A malformed block is a site bug, not our problem.
    }

    for (const entry of Array.isArray(parsed) ? parsed : [parsed]) {
      if (entry && typeof entry === 'object') {
        results.push(...(Array.isArray(entry['@graph']) ? entry['@graph'] : [entry]));
      }
    }
  }

  return results;
}

/**
 * Pull product facts out of JSON-LD, when the page is a product page.
 * @param {Array<Object>} jsonLd - Parsed JSON-LD objects
 * @returns {Object|null} Product facts, or null when the page is not a product
 */
function extractProduct(jsonLd) {
  const node = jsonLd.find((entry) => {
    const type = entry['@type'];
    return type === 'Product' || (Array.isArray(type) && type.includes('Product'));
  });

  if (!node) {
    return null;
  }

  const offers = Array.isArray(node.offers) ? node.offers[0] : node.offers;
  const rating = node.aggregateRating || {};
  const brand = typeof node.brand === 'object' ? node.brand?.name : node.brand;

  return {
    name: node.name || '',
    brand: brand || '',
    sku: node.sku || node.mpn || '',
    price: offers?.price ?? offers?.lowPrice ?? null,
    currency: offers?.priceCurrency || '',
    availability: String(offers?.availability || '').replace(/^https?:\/\/schema\.org\//, ''),
    rating: rating.ratingValue ?? null,
    reviewCount: rating.reviewCount ?? rating.ratingCount ?? null,
    description: node.description || ''
  };
}

/**
 * Reduce a page to its readable text.
 * @param {string} html - Page HTML
 * @param {number} maxChars - Character cap
 * @returns {string} Plain text
 */
function extractText(html, maxChars) {
  const stripped = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // Keep block boundaries as newlines so lists and paragraphs stay readable.
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|br)\s*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  const text = decodeEntities(stripped)
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .trim();

  return text.length > maxChars ? `${text.slice(0, maxChars)}\n[... truncated ...]` : text;
}

/**
 * Fetch a URL, re-validating the destination on every redirect hop.
 * @param {string} startUrl - Validated starting URL
 * @param {Object} [deps] - Injected dependencies (for testing)
 * @param {Function} [deps.fetchImpl] - fetch implementation
 * @param {Function} [deps.lookup] - dns lookup implementation
 * @returns {Promise<{html: string, finalUrl: string, status: number, contentType: string}>}
 * @throws {PageFetchError|InvalidLinkUrlError} On a bad status, type, size, or hop
 */
async function fetchPage(startUrl, deps = {}) {
  const { fetchImpl = globalThis.fetch, lookup } = deps;
  const maxHops = 5;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.video.pageTimeoutMs);

  try {
    let current = startUrl;

    for (let hop = 0; hop < maxHops; hop++) {
      // Every hop, including the first, is validated. A redirect is the usual
      // way an allowed URL is turned into an internal one.
      const descriptor = parseLinkUrl(current);
      await assertPublicHost(descriptor.host, lookup ? { lookup } : {});

      const response = await fetchImpl(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'he,en;q=0.9'
        }
      });

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) {
          throw new PageFetchError(`Redirect with no Location header (HTTP ${response.status})`);
        }
        current = new URL(location, current).toString();
        continue;
      }

      if (response.status === 403 || response.status === 407) {
        throw new PageFetchError(
          `Blocked before reaching the site (HTTP ${response.status}) - a proxy or egress policy refused it`
        );
      }

      if (!response.ok) {
        throw new PageFetchError(`Site returned HTTP ${response.status}`);
      }

      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      if (!/text\/html|application\/xhtml|text\/plain/.test(contentType)) {
        throw new PageFetchError(`Unsupported content type: ${contentType || '(none)'}`);
      }

      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > config.video.maxPageBytes) {
        throw new PageFetchError(
          `Page is ${declaredLength} bytes, over the ${config.video.maxPageBytes} byte limit`
        );
      }

      const html = await readCapped(response, config.video.maxPageBytes);

      return { html, finalUrl: current, status: response.status, contentType };
    }

    throw new PageFetchError(`Too many redirects (more than ${maxHops})`);
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new PageFetchError(`Timed out after ${config.video.pageTimeoutMs}ms`);
    }
    if (error instanceof PageFetchError || error instanceof InvalidLinkUrlError) {
      throw error;
    }
    throw new PageFetchError(`Could not fetch the page: ${redact(error.message)}`, { cause: error });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read a response body, stopping once the cap is exceeded.
 * A Content-Length header is advisory; this enforces the limit on what arrives.
 * @param {Object} response - Fetch response
 * @param {number} maxBytes - Byte cap
 * @returns {Promise<string>} Decoded body
 * @throws {PageFetchError} When the body exceeds the cap
 */
async function readCapped(response, maxBytes) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) {
      throw new PageFetchError(`Page body exceeded the ${maxBytes} byte limit`);
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new PageFetchError(`Page body exceeded the ${maxBytes} byte limit`);
    }

    chunks.push(value);
  }

  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

/**
 * Turn page HTML into the normalized metadata shape the pipeline archives.
 * Deliberately mirrors the video metadata shape, so archive, Sheets, and Q&A
 * need no branching on source type.
 * @param {string} html - Page HTML
 * @param {string} finalUrl - URL after redirects
 * @returns {Object} Normalized metadata
 */
function parsePage(html, finalUrl) {
  const meta = extractMeta(html);
  const jsonLd = extractJsonLd(html);
  const product = extractProduct(jsonLd);

  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = meta['og:title'] || meta['twitter:title'] || (titleTag ? decodeEntities(titleTag[1]).trim() : '');

  const description =
    meta.description || meta['og:description'] || meta['twitter:description'] || product?.description || '';

  const published = meta['article:published_time'] || meta['og:updated_time'] || meta.date || '';
  const publishedAt = /^\d{4}-\d{2}-\d{2}/.test(published) ? published.slice(0, 10) : null;

  const text = extractText(html, config.video.maxPageTextChars);

  return {
    title: title.replace(/\s+/g, ' ').trim(),
    description: description.replace(/\s+/g, ' ').trim(),
    channel: meta['og:site_name'] || new URL(finalUrl).hostname.replace(/^www\./, ''),
    channelUrl: new URL(finalUrl).origin,
    publishedAt,
    durationSec: null,
    author: meta.author || meta['article:author'] || '',
    thumbnail: meta['og:image'] || meta['twitter:image'] || '',
    pageType: meta['og:type'] || (product ? 'product' : 'website'),
    language: (html.match(/<html[^>]*\blang\s*=\s*["']([^"']+)["']/i) || [])[1] || meta['og:locale'] || null,
    product,
    tags: (meta.keywords || '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 30),
    categories: [],
    chapters: [],
    availableSubtitles: [],
    availableAutoCaptions: [],
    text
  };
}

/**
 * Derive provisional metadata from the URL alone, for when the page cannot be
 * fetched. A saved link is more useful than a lost one, and a slug like
 * `/products/ai-smart-glasses-8mp-camera` carries real information.
 *
 * Everything here is a guess from the URL, never observed page content, and the
 * record says so: `fetched: false`.
 * @param {string} url - Canonical URL
 * @returns {Object} Normalized metadata, marked as unfetched
 */
function metadataFromUrl(url) {
  const parsed = new URL(url);
  const lastSegment = parsed.pathname.split('/').filter(Boolean).pop() || '';

  const provisionalTitle = decodeURIComponent(lastSegment)
    .replace(/\.(html?|php|aspx?)$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return {
    title: provisionalTitle,
    description: '',
    channel: parsed.hostname.replace(/^www\./, ''),
    channelUrl: parsed.origin,
    publishedAt: null,
    durationSec: null,
    author: '',
    thumbnail: '',
    pageType: 'website',
    language: null,
    product: null,
    tags: [],
    categories: [],
    chapters: [],
    availableSubtitles: [],
    availableAutoCaptions: [],
    text: '',
    fetched: false,
    titleSource: 'url-slug'
  };
}

/**
 * Fetch and parse a web page.
 * @param {string} url - Validated URL
 * @param {Object} [deps] - Injected dependencies (for testing)
 * @returns {Promise<{metadata: Object, finalUrl: string, html: string}>} Page content
 */
async function fetchAndParse(url, deps = {}) {
  logger.info(`Fetching page ${url}`);

  const { html, finalUrl } = await fetchPage(url, deps);
  const metadata = parsePage(html, finalUrl);

  logger.success(
    `Fetched "${metadata.title || '(untitled)'}" - ${metadata.text.length} chars of text` +
    (metadata.product ? `, product page (${metadata.product.currency} ${metadata.product.price})` : '')
  );

  return { metadata: { ...metadata, fetched: true }, finalUrl, html };
}

module.exports = {
  fetchAndParse,
  metadataFromUrl,
  fetchPage,
  parsePage,
  extractMeta,
  extractJsonLd,
  extractProduct,
  extractText,
  decodeEntities,
  PageFetchError
};
