/**
 * PROHIBITED-TOOL EXAMPLE — this file exists to document what must never be
 * built, and to feed the test that proves the registry refuses it.
 *
 * `execute_sql` is the canonical unsafe tool. Why it can never be made safe:
 *
 *  1. Authorization becomes string analysis. Object/row/field-level permission
 *     checks require understanding an arbitrary query's semantics — equivalent
 *     to building a SQL firewall, which decades of WAF history show is
 *     bypassable (comments, casts, dialect quirks, views, CTEs).
 *  2. Tenant isolation collapses to hoping the WHERE clause is right. One
 *     hallucinated or injected `OR 1=1` is a full cross-tenant breach.
 *  3. Even "read-only" is mass exfiltration: SELECT over any table at any
 *     volume, no field-level filtering, no row caps, no purpose binding.
 *  4. Prompt injection gets a direct data plane: any attacker string that
 *     reaches the model can now reach the database.
 *  5. Auditability inverts: instead of "which typed action ran", forensics
 *     must reconstruct intent from raw SQL text.
 *
 * The same argument kills `http_request` (arbitrary egress = exfiltration +
 * SSRF) and `run_shell` (total environment compromise). The safe alternative
 * is always the same: a NARROW typed tool per business capability, whose
 * implementation the platform owns.
 */
import { z } from 'zod';
import type { ToolDefinition } from '../tool.js';

/** Never register this. The registry's denylist throws if anyone tries. */
export const executeSqlToolNEVER: ToolDefinition<{ query: string }, unknown> = {
  name: 'execute_sql',
  description: 'UNSAFE BY CONSTRUCTION — see file header.',
  riskTier: 4,
  input: z.object({ query: z.string() }).strict(),
  output: z.unknown(),
  requiredRoles: ['data_owner'],
  sensitivity: 'secret',
  timeoutMs: 10_000,
  reversible: false,
  targets: () => ({ resourceType: 'database', resourceIds: ['*'] }),
  async dryRun() {
    throw new Error('unreachable');
  },
  async handler() {
    throw new Error('unreachable');
  },
};
