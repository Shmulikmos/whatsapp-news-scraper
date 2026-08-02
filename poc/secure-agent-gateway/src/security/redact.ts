/**
 * Redaction/masking helpers. Applied at three choke points: retrieval -> model
 * context, model output -> user, and everything -> logs/audit. Driven by field
 * names (PoC) — production drives this from schema sensitivity tags.
 */

const SENSITIVE_FIELDS = new Set(['ssn', 'card', 'password', 'secret', 'apiKey', 'token']);
const PARTIAL_MASK_FIELDS = new Set(['phone', 'email']);

const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9]{16,}/g, // API-key-shaped
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, // AWS access key ids
  /\bpostgres(?:ql)?:\/\/\S+:\S+@\S+/g, // connection strings with credentials
];

export function maskValue(field: string, value: unknown): unknown {
  if (typeof value !== 'string') return SENSITIVE_FIELDS.has(field) ? '[REDACTED]' : value;
  if (SENSITIVE_FIELDS.has(field)) {
    return value.length > 4 ? `***${value.slice(-4)}` : '[REDACTED]';
  }
  if (PARTIAL_MASK_FIELDS.has(field)) {
    return value.length > 4 ? `${'*'.repeat(Math.max(0, value.length - 4))}${value.slice(-4)}` : value;
  }
  return value;
}

export function redactRecord(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = redactRecord(v as Record<string, unknown>);
    } else {
      out[k] = maskValue(k, v);
    }
  }
  return out;
}

/** Scrub secret-shaped strings from any outbound text (DLP backstop). */
export function scrubSecrets(text: string): { text: string; found: boolean } {
  let found = false;
  let out = text;
  for (const re of SECRET_PATTERNS) {
    if (re.test(out)) {
      found = true;
      out = out.replace(re, '[REDACTED_SECRET]');
    }
    re.lastIndex = 0;
  }
  return { text: out, found };
}
