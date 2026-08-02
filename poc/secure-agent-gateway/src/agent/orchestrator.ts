/**
 * Agent orchestrator: the fixed pipeline around the (untrusted) model.
 *
 * The model's entire influence on the world is the JSON it returns, which is
 * schema-validated into exactly two shapes: say(text) or propose(tool call).
 * There is no third shape, and a proposed tool call only reaches a handler
 * through Executor.execute() with all its checks.
 */
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { AuthContext, ActionPreview } from '../types.js';
import type { Executor, ExecutionResult, ToolCallProposal } from '../execution/executor.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { AuditLog } from '../audit/audit.js';
import { buildSystemPrompt } from '../prompts/system-prompt.js';
import { wrapUntrusted, renderUntrustedForContext, type UntrustedBlock } from '../security/untrusted.js';
import { scrubSecrets } from '../security/redact.js';

const ModelOutputSchema = z.union([
  z.object({ type: z.literal('say'), text: z.string().max(20_000) }).strict(),
  z.object({ type: z.literal('tool_call'), tool: z.string().max(64), params: z.unknown() }).strict(),
]);
export type ModelOutput = z.infer<typeof ModelOutputSchema>;

/** The LLM boundary. Implementations return UNTRUSTED data. */
export interface LLMClient {
  complete(req: { system: string; userMessage: string; contextBlocks: string[] }): Promise<unknown>;
}

export interface Attachment {
  readonly source: string;
  readonly content: string;
}

export type AgentResponse =
  | { kind: 'message'; text: string; securityNotice?: string }
  | {
      kind: 'confirmation_required';
      preview: ActionPreview;
      confirmationToken: string;
      /** Echoed back on confirm so the gateway re-runs the FULL pipeline. */
      pendingAction: ToolCallProposal;
    }
  | { kind: 'step_up_required'; pendingAction: ToolCallProposal }
  | { kind: 'pending_approval'; approverRole: string; preview: ActionPreview }
  | { kind: 'refused'; reason: string }
  | { kind: 'error'; reason: string };

export class ConversationState {
  /** Sticky until a fresh, attachment-free user turn: see docs 05 (taint). */
  tainted = false;
}

export class Orchestrator {
  constructor(
    private readonly llm: LLMClient,
    private readonly executor: Executor,
    private readonly registry: ToolRegistry,
    private readonly audit: AuditLog
  ) {}

  async handleMessage(
    ctx: AuthContext,
    state: ConversationState,
    userMessage: string,
    attachments: Attachment[] = []
  ): Promise<AgentResponse> {
    const correlationId = `req_${randomUUID()}`;
    const base = { correlationId, userId: ctx.userId, tenantId: ctx.tenantId, sessionId: ctx.sessionId };
    this.audit.append({ ...base, stage: 'request' });

    // Untrusted-content envelopes + taint tracking.
    const blocks: UntrustedBlock[] = attachments.map((a) => wrapUntrusted(a.source, a.content));
    if (blocks.length > 0) state.tainted = true;
    else if (attachments.length === 0 && blocks.length === 0 && !state.tainted) state.tainted = false;

    const markers = blocks.flatMap((b) => b.injectionMarkers.map((m) => `${b.source}:${m}`));
    if (markers.length > 0) {
      this.audit.append({
        ...base, stage: 'security_event', decision: 'injection_markers',
        securityFlags: { injectionMarkers: markers, influencedByUntrustedContent: true },
      });
    }

    // Model call — output is untrusted and strictly parsed.
    let raw: unknown;
    try {
      raw = await this.llm.complete({
        system: buildSystemPrompt(this.registry.list()),
        userMessage,
        contextBlocks: blocks.map(renderUntrustedForContext),
      });
    } catch {
      return { kind: 'error', reason: 'The assistant is unavailable right now. Nothing was executed.' };
    }
    const parsed = ModelOutputSchema.safeParse(raw);
    if (!parsed.success) {
      this.audit.append({ ...base, stage: 'security_event', decision: 'malformed_model_output' });
      return { kind: 'error', reason: 'The assistant returned an invalid response. Nothing was executed.' };
    }
    const output = parsed.data;

    if (output.type === 'say') {
      const scrubbed = scrubSecrets(output.text);
      this.audit.append({ ...base, stage: 'response' });
      const notice =
        markers.length > 0
          ? 'Note: attached content contained text attempting to issue instructions to the assistant. It was treated as data and flagged for security review.'
          : undefined;
      return { kind: 'message', text: scrubbed.text, ...(notice ? { securityNotice: notice } : {}) };
    }

    // Proposed tool call -> the deterministic pipeline.
    const proposal: ToolCallProposal = { tool: output.tool, params: output.params };
    this.audit.append({ ...base, stage: 'plan', tool: proposal.tool });
    const result = await this.executor.execute(ctx, proposal, {
      correlationId,
      influencedByUntrustedContent: state.tainted,
    });
    return this.toResponse(result, proposal);
  }

  /**
   * Called by the UI confirm button (never by the model). Re-runs the FULL
   * pipeline — authz and policy are re-evaluated at execution time; the token
   * only satisfies the confirmation requirement for this exact action.
   */
  async confirmPending(ctx: AuthContext, state: ConversationState, pending: ToolCallProposal, confirmationToken: string): Promise<AgentResponse> {
    const correlationId = `req_${randomUUID()}`;
    const result = await this.executor.execute(ctx, pending, {
      correlationId,
      influencedByUntrustedContent: state.tainted,
      confirmationToken,
    });
    return this.toResponse(result, pending);
  }

  private toResponse(result: ExecutionResult, proposal: ToolCallProposal): AgentResponse {
    switch (result.status) {
      case 'executed':
        // Success is claimed ONLY from the backend-confirmed result.
        return { kind: 'message', text: `Done — ${result.tool} completed and confirmed by the system.` };
      case 'confirmation_required':
        return {
          kind: 'confirmation_required',
          preview: result.preview,
          confirmationToken: result.confirmationToken,
          pendingAction: proposal,
        };
      case 'step_up_required':
        return { kind: 'step_up_required', pendingAction: proposal };
      case 'pending_approval':
        return { kind: 'pending_approval', approverRole: result.approverRole, preview: result.preview };
      case 'denied':
        return { kind: 'refused', reason: result.reason };
      case 'conflict':
        return { kind: 'refused', reason: result.reason };
      case 'unconfirmed_outcome':
        return { kind: 'error', reason: result.reason };
    }
  }
}
