/**
 * The executor is the ONLY code path from a proposed tool call to a handler.
 * Pipeline (none of these stages can be skipped — they are sequential code,
 * and the model participates in none of them):
 *
 *   registry lookup -> gateway-field stripping -> strict schema validation
 *   -> target extraction -> authorization -> policy -> confirmation
 *   -> idempotency -> audit(attempt) -> handler (with timeout)
 *   -> output validation -> audit(result)
 *
 * The executor never trusts: tool names, parameters, tier claims, confirmation
 * claims, or success claims originating from the model.
 */
import { GATEWAY_OWNED_FIELDS, type ActionPreview, type AuthContext } from '../types.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { AnyTool, DryRunResult } from '../tools/tool.js';
import { authorize } from '../authz/authorize.js';
import { evaluatePolicy, type PolicyDecision } from '../policy/engine.js';
import { ConfirmationService, computeActionHash, canonicalJson } from '../confirmation/service.js';
import { AuditLog } from '../audit/audit.js';
import { ConflictError, type FakeBackend } from '../backend/fake-backend.js';
import { createHash } from 'node:crypto';

export interface ToolCallProposal {
  /** As proposed by the model — treated as untrusted strings. */
  readonly tool: string;
  readonly params: unknown;
}

export interface ExecutionOptions {
  readonly correlationId: string;
  readonly influencedByUntrustedContent: boolean;
  /** Provided by the UI confirm button — never by the model. */
  readonly confirmationToken?: string;
}

export type ExecutionResult =
  | { status: 'executed'; tool: string; output: unknown; idempotencyKey: string }
  | { status: 'confirmation_required'; tool: string; preview: ActionPreview; confirmationToken: string; actionHash: string }
  | { status: 'step_up_required'; tool: string }
  | { status: 'pending_approval'; tool: string; approverRole: string; preview: ActionPreview }
  | { status: 'denied'; tool: string; reason: string; code: string }
  | { status: 'conflict'; tool: string; reason: string }
  | { status: 'unconfirmed_outcome'; tool: string; reason: string };

interface CachedExecution {
  result: ExecutionResult;
}

export class Executor {
  private executed = new Map<string, CachedExecution>();
  private inFlight = new Set<string>();

  constructor(
    private readonly registry: ToolRegistry,
    private readonly confirmations: ConfirmationService,
    private readonly audit: AuditLog,
    private readonly backend: FakeBackend,
    private readonly now: () => number = Date.now
  ) {}

  async execute(ctx: AuthContext, proposal: ToolCallProposal, opts: ExecutionOptions): Promise<ExecutionResult> {
    const base = {
      correlationId: opts.correlationId,
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      sessionId: ctx.sessionId,
    };

    // 1. Registry: exact-match allowlist. Unknown/hallucinated tool -> reject.
    const tool = this.registry.get(proposal.tool);
    if (!tool) {
      this.audit.append({ ...base, stage: 'security_event', decision: 'deny', reason: `unknown tool "${proposal.tool}"` });
      return { status: 'denied', tool: proposal.tool, reason: 'Unknown tool', code: 'unknown_tool' };
    }

    // 2. Strip gateway-owned fields. The model may not set identity, tier,
    //    or confirmation state; attempts are logged as security signals.
    const { cleaned, strippedFields } = stripGatewayFields(proposal.params);
    if (strippedFields.length > 0) {
      this.audit.append({
        ...base, stage: 'security_event', tool: tool.name,
        decision: 'stripped_params', reason: `model attempted to set: ${strippedFields.join(', ')}`,
      });
    }

    // 3. Strict schema validation (unknown keys rejected, bounds enforced).
    const parsed = tool.input.safeParse(cleaned);
    if (!parsed.success) {
      this.audit.append({
        ...base, stage: 'security_event', tool: tool.name,
        decision: 'deny', reason: `schema violation: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
      });
      return { status: 'denied', tool: tool.name, reason: 'Invalid parameters', code: 'schema_violation' };
    }
    const input: unknown = parsed.data;

    // 4. Deterministic derivation of authz/policy facts from validated input.
    const target = tool.targets(input);
    const writeFields = tool.writableFields ? requestedWriteFields(input, tool) : [];
    const recipients = tool.externalRecipients ? tool.externalRecipients(input) : [];
    const amount = tool.financialAmount ? tool.financialAmount(input) : undefined;
    const affected = tool.affectedRecordCount ? tool.affectedRecordCount(input) : target.resourceIds.length;

    // 5. Authorization — before any preview is built or data is touched.
    const authz = authorize(ctx, tool, target, writeFields, this.backend);
    this.audit.append({ ...base, stage: 'authorization', tool: tool.name, decision: authz.result, reason: authz.reason });
    if (authz.result === 'deny') {
      return { status: 'denied', tool: tool.name, reason: authz.reason ?? 'Not authorized', code: 'authz_denied' };
    }

    // 6. Dry run (tier >= 3): current state + versions for the preview/hash.
    let dryRun: DryRunResult | undefined;
    if (tool.dryRun) {
      try {
        dryRun = await tool.dryRun(input, ctx, this.backend);
      } catch (e) {
        return { status: 'denied', tool: tool.name, reason: errMessage(e), code: 'precondition_failed' };
      }
    }
    const resourceVersions = dryRun?.resourceVersions ?? {};
    const actionHash = computeActionHash({
      tool: tool.name,
      params: input,
      resourceVersions: { ...resourceVersions },
      userId: ctx.userId,
      tenantId: ctx.tenantId,
    });

    // 7. Confirmation status — a token is only "verified" if the confirmation
    //    service validates AND consumes it for THIS exact action hash.
    let confirmationVerified = false;
    if (opts.confirmationToken !== undefined) {
      const check = this.confirmations.validateAndConsume(opts.confirmationToken, actionHash, ctx.userId, ctx.sessionId);
      if (!check.ok) {
        this.audit.append({ ...base, stage: 'security_event', tool: tool.name, decision: 'deny', reason: `confirmation rejected: ${check.reason}` });
        if (check.reason === 'wrong_action') {
          // Includes the stale-version case: record changed since preview.
          return { status: 'conflict', tool: tool.name, reason: 'Action changed since preview — a fresh preview is required' };
        }
        return { status: 'denied', tool: tool.name, reason: `Confirmation invalid (${check.reason})`, code: 'confirmation_invalid' };
      }
      confirmationVerified = true;
      this.audit.append({ ...base, stage: 'confirmation_consumed', tool: tool.name, decision: 'verified' });
    }

    // 8. Policy — the authoritative decision, from trusted inputs only.
    const decision: PolicyDecision = evaluatePolicy({
      user: { id: ctx.userId, roles: ctx.roles, authStrength: ctx.authStrength, ...(ctx.stepUpAt !== undefined ? { stepUpAt: ctx.stepUpAt } : {}) },
      tenantId: ctx.tenantId,
      tool: tool.name,
      riskTier: tool.riskTier,
      dataSensitivity: tool.sensitivity,
      affectedRecordCount: affected,
      externalRecipients: recipients,
      ...(amount !== undefined ? { financialAmount: amount } : {}),
      confirmation: { tokenPresent: opts.confirmationToken !== undefined, verified: confirmationVerified },
      influencedByUntrustedContent: opts.influencedByUntrustedContent,
      now: this.now(),
    });
    this.audit.append({
      ...base, stage: 'policy', tool: tool.name, riskTier: tool.riskTier,
      decision: decision.effect, reason: 'reason' in decision ? decision.reason : undefined,
      securityFlags: { influencedByUntrustedContent: opts.influencedByUntrustedContent },
    });

    switch (decision.effect) {
      case 'deny':
        return { status: 'denied', tool: tool.name, reason: decision.reason, code: 'policy_denied' };
      case 'require_confirmation': {
        if (!dryRun) return { status: 'denied', tool: tool.name, reason: 'No preview available', code: 'policy_denied' };
        const token = this.confirmations.issue(actionHash, ctx.userId, ctx.sessionId);
        this.audit.append({ ...base, stage: 'confirmation_issued', tool: tool.name, decision: 'preview_shown' });
        return { status: 'confirmation_required', tool: tool.name, preview: dryRun.preview, confirmationToken: token, actionHash };
      }
      case 'require_step_up_auth':
        return { status: 'step_up_required', tool: tool.name };
      case 'require_approval': {
        if (!dryRun) return { status: 'denied', tool: tool.name, reason: 'No preview available', code: 'policy_denied' };
        this.audit.append({ ...base, stage: 'approval', tool: tool.name, decision: 'queued', reason: `requires ${decision.approverRole}` });
        return { status: 'pending_approval', tool: tool.name, approverRole: decision.approverRole, preview: dryRun.preview };
      }
      case 'allow':
        break;
    }

    // 9. Idempotency: same action content -> exactly one side effect.
    // Deliberately excludes resource versions (those live in actionHash, whose
    // job is stale-preview detection). Dedup must survive legitimate retries.
    const idempotencyKey = createHash('sha256')
      .update(canonicalJson({ userId: ctx.userId, tool: tool.name, params: input }))
      .digest('hex');
    const cached = this.executed.get(idempotencyKey);
    if (cached) return cached.result;
    if (this.inFlight.has(idempotencyKey)) {
      return { status: 'denied', tool: tool.name, reason: 'Duplicate in-flight execution', code: 'duplicate_in_flight' };
    }
    this.inFlight.add(idempotencyKey);

    // 10-12. Write-ahead audit, timed execution, output validation, result audit.
    try {
      this.audit.append({
        ...base, stage: 'execution_attempt', tool: tool.name, riskTier: tool.riskTier,
        params: asRecord(input), executionState: 'attempting',
      });

      let rawOutput: unknown;
      try {
        rawOutput = await withTimeout(
          tool.handler(input, ctx, this.backend, { idempotencyKey, resourceVersions }),
          tool.timeoutMs
        );
      } catch (e) {
        if (e instanceof ConflictError) {
          this.audit.append({ ...base, stage: 'execution_result', tool: tool.name, executionState: 'failed', error: e.message });
          return { status: 'conflict', tool: tool.name, reason: e.message };
        }
        if (e instanceof TimeoutError) {
          // A timed-out write is AMBIGUOUS — never report success or failure,
          // and never blind-retry. State stays "attempting" for reconciliation.
          this.audit.append({ ...base, stage: 'execution_result', tool: tool.name, executionState: 'failed', error: 'timeout (outcome unconfirmed)' });
          return { status: 'unconfirmed_outcome', tool: tool.name, reason: 'Backend timeout — the outcome is unconfirmed and will be reconciled' };
        }
        this.audit.append({ ...base, stage: 'execution_result', tool: tool.name, executionState: 'failed', error: errMessage(e) });
        return { status: 'denied', tool: tool.name, reason: errMessage(e), code: 'execution_failed' };
      }

      const outParsed = tool.output.safeParse(rawOutput);
      if (!outParsed.success) {
        // Tool-response tampering / drift: out-of-contract data never leaves.
        this.audit.append({ ...base, stage: 'security_event', tool: tool.name, decision: 'deny', reason: 'output schema violation' });
        return { status: 'denied', tool: tool.name, reason: 'Tool output failed validation', code: 'output_violation' };
      }

      this.audit.append({
        ...base, stage: 'execution_result', tool: tool.name, executionState: 'completed',
        before: dryRun ? asRecord(dryRun.preview.currentValues) : undefined,
        after: dryRun ? asRecord(dryRun.preview.proposedValues) : undefined,
      });

      const result: ExecutionResult = { status: 'executed', tool: tool.name, output: outParsed.data, idempotencyKey };
      this.executed.set(idempotencyKey, { result });
      return result;
    } finally {
      this.inFlight.delete(idempotencyKey);
    }
  }
}

// ---------------------------------------------------------------------------

function stripGatewayFields(params: unknown): { cleaned: unknown; strippedFields: string[] } {
  if (params === null || typeof params !== 'object' || Array.isArray(params)) {
    return { cleaned: params, strippedFields: [] };
  }
  const stripped: string[] = [];
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
    if ((GATEWAY_OWNED_FIELDS as readonly string[]).includes(k)) {
      stripped.push(k);
    } else {
      cleaned[k] = v;
    }
  }
  return { cleaned, strippedFields: stripped };
}

function requestedWriteFields(input: unknown, tool: AnyTool): string[] {
  if (input !== null && typeof input === 'object' && 'fields' in (input as Record<string, unknown>)) {
    const fields = (input as Record<string, unknown>)['fields'];
    if (fields !== null && typeof fields === 'object') return Object.keys(fields as Record<string, unknown>);
  }
  return tool.writableFields ? [...tool.writableFields] : [];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) return { ...(value as Record<string, unknown>) };
  return undefined;
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export class TimeoutError extends Error {
  constructor() {
    super('execution timed out');
    this.name = 'TimeoutError';
  }
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError()), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
