import type { AuthContext } from '../src/types.js';
import type { LLMClient } from '../src/agent/orchestrator.js';
import { buildGateway, type Gateway } from '../src/gateway.js';

export const supportAgent: AuthContext = {
  userId: 'u_991',
  tenantId: 'acme',
  sessionId: 's_1',
  roles: ['support_agent'],
  authStrength: 'mfa',
};

export const viewer: AuthContext = {
  userId: 'u_500',
  tenantId: 'acme',
  sessionId: 's_2',
  roles: ['viewer'],
  authStrength: 'password',
};

export const globexAgent: AuthContext = {
  userId: 'u_777',
  tenantId: 'globex',
  sessionId: 's_3',
  roles: ['support_agent'],
  authStrength: 'mfa',
};

export function withStepUp(ctx: AuthContext, at: number): AuthContext {
  return { ...ctx, authStrength: 'step_up', stepUpAt: at };
}

/**
 * Scripted LLM: returns queued outputs in order. Used both for benign flows
 * and to SIMULATE A FULLY COMPROMISED MODEL — the strongest attacker position
 * for red-team tests (whatever injection achieves, it at most controls model
 * output; these tests hand the attacker that control directly).
 */
export class MockLLM implements LLMClient {
  readonly requests: Array<{ system: string; userMessage: string; contextBlocks: string[] }> = [];
  private queue: unknown[] = [];

  respondWith(...outputs: unknown[]): void {
    this.queue.push(...outputs);
  }

  async complete(req: { system: string; userMessage: string; contextBlocks: string[] }): Promise<unknown> {
    this.requests.push(req);
    if (this.queue.length === 0) return { type: 'say', text: 'no scripted response' };
    return this.queue.shift();
  }
}

export function testGateway(opts: { now?: () => number; confirmationTtlMs?: number } = {}): { gw: Gateway; llm: MockLLM } {
  const llm = new MockLLM();
  const gw = buildGateway(llm, opts);
  return { gw, llm };
}
