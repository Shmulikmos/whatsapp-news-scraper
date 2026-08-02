/**
 * Append-only, hash-chained audit log with redaction at write time.
 * In production this is WORM storage; here an in-memory analog that preserves
 * the two key properties: append-only (no update/delete API) and tamper
 * evidence (hash chain verifiable end-to-end).
 */
import { createHash } from 'node:crypto';
import { canonicalJson } from '../confirmation/service.js';
import { redactRecord } from '../security/redact.js';

export type AuditStage =
  | 'request'
  | 'plan'
  | 'retrieval'
  | 'policy'
  | 'authorization'
  | 'confirmation_issued'
  | 'confirmation_consumed'
  | 'approval'
  | 'execution_attempt'
  | 'execution_result'
  | 'security_event'
  | 'response';

export interface AuditEventInput {
  correlationId: string;
  stage: AuditStage;
  userId: string;
  tenantId: string;
  sessionId: string;
  tool?: string;
  riskTier?: number;
  /** Redacted automatically before storage. */
  params?: Record<string, unknown>;
  decision?: string;
  reason?: string;
  executionState?: 'attempting' | 'completed' | 'failed' | 'compensated';
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  securityFlags?: { influencedByUntrustedContent?: boolean; injectionMarkers?: string[] };
  error?: string;
}

export interface AuditEvent extends AuditEventInput {
  readonly eventId: string;
  readonly sequence: number;
  readonly timestamp: number;
  readonly prevEventHash: string;
  readonly eventHash: string;
}

export class AuditLog {
  private events: AuditEvent[] = [];
  private seq = 0;

  constructor(private readonly now: () => number = Date.now) {}

  append(input: AuditEventInput): AuditEvent {
    this.seq += 1;
    const prev = this.events[this.events.length - 1];
    const base = {
      ...input,
      params: input.params ? redactRecord(input.params) : undefined,
      before: input.before ? redactRecord(input.before) : undefined,
      after: input.after ? redactRecord(input.after) : undefined,
      eventId: `evt_${this.seq.toString(36)}_${this.now().toString(36)}`,
      sequence: this.seq,
      timestamp: this.now(),
      prevEventHash: prev ? prev.eventHash : 'genesis',
    };
    const eventHash = createHash('sha256').update(canonicalJson(base)).digest('hex');
    const event: AuditEvent = Object.freeze({ ...base, eventHash });
    this.events.push(event);
    return event;
  }

  /** Read-only view; there is deliberately no update or delete. */
  all(): readonly AuditEvent[] {
    return this.events;
  }

  byCorrelation(correlationId: string): readonly AuditEvent[] {
    return this.events.filter((e) => e.correlationId === correlationId);
  }

  /** Tamper evidence: recompute the chain and compare. */
  verifyChain(): boolean {
    let prevHash = 'genesis';
    for (const e of this.events) {
      if (e.prevEventHash !== prevHash) return false;
      const { eventHash, ...rest } = e;
      const recomputed = createHash('sha256').update(canonicalJson(rest)).digest('hex');
      if (recomputed !== eventHash) return false;
      prevHash = eventHash;
    }
    return true;
  }
}
