/**
 * The tool contract. A tool is the ONLY way the agent can touch the backend.
 *
 * Everything security-relevant (risk tier, roles, field allowlists, row caps,
 * target extraction) is declared statically here and enforced by the executor —
 * the model can influence only which tool is proposed and the candidate
 * parameter values, both of which are validated before anything runs.
 */
import type { z } from 'zod';
import type { AuthContext, ActionPreview, ResourceTarget, RiskTier, Role, Sensitivity } from '../types.js';
import type { FakeBackend } from '../backend/fake-backend.js';

export interface ToolDefinition<I = unknown, O = unknown> {
  readonly name: string;
  readonly description: string;
  /** Static. Policy may escalate at runtime; nothing may lower it. */
  readonly riskTier: RiskTier;
  /** Strict schema — unknown keys are rejected, not stripped silently. */
  readonly input: z.ZodType<I>;
  readonly output: z.ZodType<O>;
  readonly requiredRoles: readonly Role[];
  readonly sensitivity: Sensitivity;
  readonly timeoutMs: number;
  readonly reversible: boolean;
  /** For write tools: the only fields this tool may modify. */
  readonly writableFields?: readonly string[];
  /** For read tools: hard row cap applied regardless of requested limit. */
  readonly maxRows?: number;

  /** Deterministic extraction of authz targets from validated input. */
  targets(input: I): ResourceTarget;
  externalRecipients?(input: I): string[];
  financialAmount?(input: I): number | undefined;
  affectedRecordCount?(input: I): number;

  /**
   * Full validation + current-state read with NO side effects.
   * Used to build the gateway-generated action preview and capture
   * resource versions for optimistic locking. Required for tier >= 3.
   */
  dryRun?(input: I, ctx: AuthContext, backend: FakeBackend): Promise<DryRunResult>;

  handler(input: I, ctx: AuthContext, backend: FakeBackend, exec: ExecutionMeta): Promise<O>;
}

export interface DryRunResult {
  readonly preview: ActionPreview;
  /** resourceId -> version at preview time; bound into the confirmation hash. */
  readonly resourceVersions: Readonly<Record<string, number>>;
}

export interface ExecutionMeta {
  readonly idempotencyKey: string;
  /** Versions captured at preview time; write handlers must enforce them. */
  readonly resourceVersions: Readonly<Record<string, number>>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTool = ToolDefinition<any, any>;
