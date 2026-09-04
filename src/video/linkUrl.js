/**
 * Link URL Module
 * Validation for arbitrary web links, as opposed to the closed platform
 * allowlist in urlParser.js.
 *
 * Accepting any host reopens SSRF, which the video path avoided entirely by
 * allowlisting two domains. So this module does the work that allowlist used to
 * do for free: reject private, loopback, link-local, and otherwise internal
 * destinations - by literal IP *and* by what the hostname actually resolves to.
 *
 * Residual risk: DNS rebinding. We resolve, validate, then hand the hostname to
 * fetch, which resolves again - a hostile resolver could answer differently the
 * second time. Closing that fully requires pinning the connection to a
 * validated IP, which Node's fetch does not expose. Every redirect hop is
 * re-validated, which is the practical mitigation.
 */

const dns = require('dns').promises;
const crypto = require('crypto');

class InvalidLinkUrlError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidLinkUrlError';
  }
}

/** Hostnames that always mean "this machine" or "this network". */
const BLOCKED_HOSTNAMES = new Set([
  'localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback',
  'broadcasthost', 'metadata', 'metadata.google.internal', 'instance-data'
]);

/** Suffixes reserved for local or internal naming. */
const BLOCKED_SUFFIXES = [
  '.localhost', '.local', '.internal', '.intranet', '.private',
  '.corp', '.home', '.lan', '.localdomain'
];

const CONTROL_OR_SPACE = new RegExp('[\\s\\u0000-\\u001F\\u007F-\\u009F]');

/**
 * Test whether an IPv4 address is routable on the public internet.
 * @param {string} address - Dotted-quad address
 * @returns {boolean} True when the address is public
 */
function isPublicIPv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }

  const [a, b] = parts;

  if (a === 0) return false;                          // 0.0.0.0/8 "this network"
  if (a === 10) return false;                         // private
  if (a === 127) return false;                        // loopback
  if (a === 169 && b === 254) return false;           // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false;  // private
  if (a === 192 && b === 168) return false;           // private
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
  if (a === 192 && b === 0) return false;             // IETF protocol assignments / TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51) return false;            // TEST-NET-2
  if (a === 203 && b === 0) return false;             // TEST-NET-3
  if (a >= 224) return false;                         // multicast, reserved, broadcast

  return true;
}

/**
 * Test whether an IPv6 address is routable on the public internet.
 * @param {string} address - IPv6 address
 * @returns {boolean} True when the address is public
 */
function isPublicIPv6(address) {
  const normalized = address.toLowerCase().split('%')[0];

  if (normalized === '::1' || normalized === '::') {
    return false;
  }

  // IPv4-mapped and IPv4-compatible forms carry a v4 address that must be
  // checked as v4. Node normalizes ::ffff:127.0.0.1 to the hex form
  // ::ffff:7f00:1, so both spellings have to be recognised.
  const dotted = normalized.match(/^(?:::ffff:|::)((?:\d{1,3}\.){3}\d{1,3})$/);
  if (dotted) {
    return isPublicIPv4(dotted[1]);
  }

  const hex = normalized.match(/^(?:0*:)*:?(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex && /(^|:)ffff:/.test(normalized)) {
    const high = parseInt(hex[1], 16);
    const low = parseInt(hex[2], 16);
    const v4 = `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
    return isPublicIPv4(v4);
  }

  const head = normalized.split(':')[0];
  if (head.startsWith('fc') || head.startsWith('fd')) return false; // unique local fc00::/7
  if (/^fe[89ab]/.test(head)) return false;                        // link-local fe80::/10
  if (head.startsWith('ff')) return false;                         // multicast

  return true;
}

/**
 * Test whether a literal IP address is public.
 * @param {string} address - IPv4 or IPv6 address
 * @param {number} [family] - 4 or 6; inferred when omitted
 * @returns {boolean} True when the address is public
 */
function isPublicAddress(address, family) {
  const resolvedFamily = family || (address.includes(':') ? 6 : 4);
  return resolvedFamily === 6 ? isPublicIPv6(address) : isPublicIPv4(address);
}

/**
 * Validate a web link's shape, without touching the network.
 * @param {string} rawUrl - User-supplied URL
 * @returns {{url: URL, canonicalUrl: string, host: string, id: string}} Descriptor
 * @throws {InvalidLinkUrlError} When the URL is malformed or obviously internal
 */
function parseLinkUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    throw new InvalidLinkUrlError('URL is required');
  }

  const trimmed = rawUrl.trim();

  if (trimmed.startsWith('-')) {
    throw new InvalidLinkUrlError('URL must not start with "-"');
  }

  if (CONTROL_OR_SPACE.test(trimmed)) {
    throw new InvalidLinkUrlError('URL must not contain whitespace or control characters');
  }

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    throw new InvalidLinkUrlError(`Not a valid URL: ${trimmed}`);
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new InvalidLinkUrlError(`Unsupported protocol: ${url.protocol}`);
  }

  if (url.username || url.password) {
    throw new InvalidLinkUrlError('URLs with embedded credentials are not accepted');
  }

  // Only the default ports; anything else is far more likely an internal service.
  if (url.port && url.port !== '80' && url.port !== '443') {
    throw new InvalidLinkUrlError(`Only ports 80 and 443 are accepted, got ${url.port}`);
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');

  if (hostname === '') {
    throw new InvalidLinkUrlError('URL has no host');
  }

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new InvalidLinkUrlError(`Refusing to fetch an internal host: ${hostname}`);
  }

  if (BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new InvalidLinkUrlError(`Refusing to fetch an internal host: ${hostname}`);
  }

  // A bare hostname with no dot is a local network name, not a public site.
  const isIpLiteral = /^[\d.]+$/.test(hostname) || hostname.startsWith('[') || hostname.includes(':');
  if (!isIpLiteral && !hostname.includes('.')) {
    throw new InvalidLinkUrlError(`Refusing to fetch a single-label host: ${hostname}`);
  }

  // An IP written directly into the URL is checked here; names are checked
  // after resolution, in assertPublicHost.
  const literal = hostname.replace(/^\[|\]$/g, '');
  if (/^[\d.]+$/.test(literal) || literal.includes(':')) {
    if (!isPublicAddress(literal)) {
      throw new InvalidLinkUrlError(`Refusing to fetch a non-public address: ${literal}`);
    }
  }

  // Strip tracking parameters so the same page sent twice dedupes to one record.
  const canonical = new URL(url.toString());
  canonical.hash = '';
  for (const param of [...canonical.searchParams.keys()]) {
    if (/^(utm_[a-z_]*|fbclid|gclid|igsh|igsi|mc_eid|mc_cid|ref|ref_src|si|spm|_ga|yclid|msclkid)$/i.test(param)) {
      canonical.searchParams.delete(param);
    }
  }

  const canonicalUrl = canonical.toString();
  const digest = crypto.createHash('sha256').update(canonicalUrl).digest('hex').slice(0, 16);

  return {
    url: canonical,
    canonicalUrl,
    host: hostname,
    platform: 'web',
    videoId: digest,
    id: `web:${digest}`
  };
}

/**
 * Resolve a hostname and assert every address it answers with is public.
 * @param {string} hostname - Hostname to resolve
 * @param {Object} [deps] - Injected dependencies (for testing)
 * @param {Function} [deps.lookup] - dns.promises.lookup stand-in
 * @returns {Promise<Array<{address: string, family: number}>>} Resolved addresses
 * @throws {InvalidLinkUrlError} When resolution fails or any address is internal
 */
async function assertPublicHost(hostname, { lookup = dns.lookup } = {}) {
  const bare = hostname.replace(/^\[|\]$/g, '');

  // A literal address was already checked in parseLinkUrl; no DNS needed.
  if (/^[\d.]+$/.test(bare) || bare.includes(':')) {
    if (!isPublicAddress(bare)) {
      throw new InvalidLinkUrlError(`Refusing to fetch a non-public address: ${bare}`);
    }
    return [{ address: bare, family: bare.includes(':') ? 6 : 4 }];
  }

  let addresses;
  try {
    addresses = await lookup(bare, { all: true });
  } catch (error) {
    throw new InvalidLinkUrlError(`Could not resolve ${bare}: ${error.message}`);
  }

  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new InvalidLinkUrlError(`${bare} resolved to no addresses`);
  }

  // Every answer must be public: one internal address is enough to be abused.
  for (const entry of addresses) {
    if (!isPublicAddress(entry.address, entry.family)) {
      throw new InvalidLinkUrlError(
        `${bare} resolves to a non-public address (${entry.address}) - refusing to fetch`
      );
    }
  }

  return addresses;
}

module.exports = {
  parseLinkUrl,
  assertPublicHost,
  isPublicAddress,
  isPublicIPv4,
  isPublicIPv6,
  InvalidLinkUrlError
};
