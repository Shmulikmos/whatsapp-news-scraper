/**
 * Confirmation service: HMAC-signed, single-use, short-TTL tokens bound to the
 * EXACT action (tool + canonical params + resource versions + user + tenant).
 *
 * Why not "the user said yes in chat"? Chat text is forgeable by prompt
 * injection, ambiguous, and replayable. A signed token delivered through the
 * UI's confirm button is none of those. The model never sees the token.
 */
import { createHmac, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

export interface ConfirmationPayload {
  readonly tokenId: string;
  readonly actionHash: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly iat: number;
  readonly exp: number;
}

export type ConfirmationCheck =
  | { ok: true; payload: ConfirmationPayload }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'wrong_session' | 'wrong_action' | 'already_used' };

/** Stable stringify so hashing is canonical regardless of key order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export function computeActionHash(action: {
  tool: string;
  params: unknown;
  resourceVersions: Record<string, number>;
  userId: string;
  tenantId: string;
}): string {
  return createHash('sha256').update(canonicalJson(action)).digest('hex');
}

export class ConfirmationService {
  private consumed = new Set<string>();

  constructor(
    private readonly secret: Buffer,
    private readonly ttlMs: number = 120_000,
    private readonly now: () => number = Date.now
  ) {}

  issue(actionHash: string, userId: string, sessionId: string): string {
    const payload: ConfirmationPayload = {
      tokenId: randomBytes(16).toString('hex'),
      actionHash,
      userId,
      sessionId,
      iat: this.now(),
      exp: this.now() + this.ttlMs,
    };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${body}.${this.sign(body)}`;
  }

  /**
   * Validate AND consume atomically. A token is spendable exactly once,
   * only within its TTL, only by the session it was issued to, and only
   * for the exact action hash it was bound to (which includes resource
   * versions — a record edited since preview invalidates the token).
   */
  validateAndConsume(token: string, expectedActionHash: string, userId: string, sessionId: string): ConfirmationCheck {
    const parts = token.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'malformed' };
    const [body, sig] = parts;

    const expectedSig = this.sign(body);
    const a = Buffer.from(sig);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'bad_signature' };

    let payload: ConfirmationPayload;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as ConfirmationPayload;
    } catch {
      return { ok: false, reason: 'malformed' };
    }

    if (this.now() > payload.exp) return { ok: false, reason: 'expired' };
    if (payload.userId !== userId || payload.sessionId !== sessionId) return { ok: false, reason: 'wrong_session' };
    if (payload.actionHash !== expectedActionHash) return { ok: false, reason: 'wrong_action' };
    if (this.consumed.has(payload.tokenId)) return { ok: false, reason: 'already_used' };

    this.consumed.add(payload.tokenId); // consume-on-success; replay -> already_used
    return { ok: true, payload };
  }

  private sign(body: string): string {
    return createHmac('sha256', this.secret).update(body).digest('base64url');
  }
}
