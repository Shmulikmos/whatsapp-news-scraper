/**
 * Redaction Module
 * Strips credential-shaped strings before anything is logged, archived, or sent
 * to a spreadsheet. Applied at every output boundary - a subprocess that echoes
 * its own argv, or a stack trace carrying a URL, must not leak a key.
 */

/** Patterns that look like credentials, most specific first. */
const SECRET_PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g,        // Anthropic API keys
  /sk-[A-Za-z0-9]{20,}/g,             // Generic provider keys
  /gh[pousr]_[A-Za-z0-9]{16,}/g,      // GitHub tokens
  /github_pat_[A-Za-z0-9_]{20,}/g,    // GitHub fine-grained PATs
  /AIza[A-Za-z0-9_-]{20,}/g,          // Google API keys
  /ya29\.[A-Za-z0-9_-]{10,}/g,        // Google OAuth access tokens
  /-----BEGIN[^-]*PRIVATE KEY-----[\s\S]*?-----END[^-]*PRIVATE KEY-----/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g // JWTs
];

/**
 * Replace credential-shaped substrings with a placeholder.
 * @param {*} value - Any value; non-strings are returned untouched
 * @returns {*} Redacted value
 */
function redact(value) {
  if (typeof value !== 'string') {
    return value;
  }

  let output = value;
  for (const pattern of SECRET_PATTERNS) {
    output = output.replace(pattern, '[REDACTED]');
  }

  return output;
}

/**
 * Redact every string in a structure, recursively.
 * @param {*} value - Object, array, or primitive
 * @returns {*} Deeply redacted copy
 */
function redactDeep(value) {
  if (Array.isArray(value)) {
    return value.map(redactDeep);
  }

  if (value && typeof value === 'object') {
    const output = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = redactDeep(entry);
    }
    return output;
  }

  return redact(value);
}

module.exports = { redact, redactDeep, SECRET_PATTERNS };
