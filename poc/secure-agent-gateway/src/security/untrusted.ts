/**
 * Untrusted-content handling.
 *
 * Everything retrieved (records, documents, uploads, tool results re-entering
 * context) is DATA, never instructions. The envelope + taint flag implement
 * that stance; detection of injection markers is telemetry only — the security
 * boundary is structural (see docs/ai-agent-security/05).
 */

export interface UntrustedBlock {
  readonly source: string; // e.g. "upload:F-3321", "ticket:T-991"
  readonly content: string;
  readonly injectionMarkers: readonly string[];
}

/** Heuristic markers — for logging/alerting, NOT for enforcement. */
const INJECTION_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'ignore_previous', re: /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i },
  { name: 'role_reassignment', re: /\byou\s+are\s+now\s+(an?\s+)?(admin|administrator|system|root)\b/i },
  { name: 'system_prompt_spoof', re: /^\s*(SYSTEM|ASSISTANT)\s*:/im },
  { name: 'exfil_address', re: /\bsend\b[\s\S]{0,80}\b(all|every)\b[\s\S]{0,80}\b(records?|data|customers?)\b[\s\S]{0,120}@/i },
  { name: 'tool_syntax', re: /\b(execute_sql|http_request|run_shell|eval)\s*\(/i },
];

export function detectInjectionMarkers(content: string): string[] {
  return INJECTION_PATTERNS.filter((p) => p.re.test(content)).map((p) => p.name);
}

/**
 * Wrap content for model context with provenance, escaping delimiter
 * collisions so content cannot fake its own envelope boundaries.
 */
export function wrapUntrusted(source: string, content: string): UntrustedBlock {
  const escaped = content
    .replace(/<untrusted_data/gi, '&lt;untrusted_data')
    .replace(/<\/untrusted_data>/gi, '&lt;/untrusted_data&gt;');
  return { source, content: escaped, injectionMarkers: detectInjectionMarkers(content) };
}

export function renderUntrustedForContext(block: UntrustedBlock): string {
  return `<untrusted_data source="${block.source}">\n${block.content}\n</untrusted_data>`;
}
