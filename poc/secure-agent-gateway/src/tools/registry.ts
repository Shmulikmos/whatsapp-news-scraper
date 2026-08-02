/**
 * Secure tool registry.
 *
 * Properties:
 *  - Compile-time allowlist: tools are registered at startup, then the registry
 *    is frozen. Nothing can add capabilities at runtime.
 *  - Exact-match lookup only. No fuzzy matching, no aliases — a hallucinated
 *    near-miss name ("get_customers") is a hard reject, never a best guess.
 *  - A denylist of categorically prohibited capabilities that refuses
 *    registration outright, so a future refactor cannot quietly add them.
 */
import { SecurityViolation } from '../types.js';
import type { AnyTool } from './tool.js';

/**
 * Capabilities that must never exist, in any phase (see docs 00/02).
 * `execute_sql` / `run_query`: arbitrary read = mass exfiltration engine,
 *   arbitrary write = full integrity loss; bypasses every application control.
 * `http_request` / `fetch_url`: generic egress = exfiltration channel + SSRF.
 * `run_shell` / `eval_code`: full environment compromise.
 * `admin_*`: privilege-granting surface with catastrophic blast radius.
 */
export const PROHIBITED_TOOL_NAMES: ReadonlySet<string> = new Set([
  'execute_sql',
  'run_query',
  'http_request',
  'fetch_url',
  'run_shell',
  'exec',
  'eval_code',
  'admin_grant_role',
  'admin_update_security_settings',
  'delete_all',
  'bulk_delete',
]);

const TOOL_NAME_RE = /^[a-z][a-z0-9_]{2,40}$/;

export class ToolRegistry {
  private tools = new Map<string, AnyTool>();
  private frozen = false;

  register(tool: AnyTool): void {
    if (this.frozen) {
      throw new SecurityViolation('registry is frozen; runtime registration is forbidden', 'registry_frozen');
    }
    if (PROHIBITED_TOOL_NAMES.has(tool.name)) {
      throw new SecurityViolation(`tool "${tool.name}" is categorically prohibited`, 'prohibited_tool');
    }
    if (!TOOL_NAME_RE.test(tool.name)) {
      throw new SecurityViolation(`invalid tool name "${tool.name}"`, 'schema_violation');
    }
    if (this.tools.has(tool.name)) {
      throw new SecurityViolation(`duplicate tool "${tool.name}"`, 'schema_violation');
    }
    if (tool.riskTier >= 3 && !tool.dryRun) {
      throw new SecurityViolation(
        `tool "${tool.name}" is tier ${tool.riskTier} but has no dryRun; previews are mandatory for tier >= 3`,
        'schema_violation'
      );
    }
    this.tools.set(tool.name, tool);
  }

  freeze(): void {
    this.frozen = true;
  }

  /** Exact match or undefined. Callers must treat undefined as a hard reject. */
  get(name: string): AnyTool | undefined {
    return this.tools.get(name);
  }

  list(): string[] {
    return [...this.tools.keys()].sort();
  }
}
