import { describe, it, expect } from 'vitest';
import { evaluatePolicy, POLICY_LIMITS, type PolicyInput } from '../../src/policy/engine.js';

const NOW = 1_750_000_000_000;

function input(overrides: Partial<PolicyInput> = {}): PolicyInput {
  return {
    user: { id: 'u1', roles: ['support_agent'], authStrength: 'mfa' },
    tenantId: 'acme',
    tool: 't',
    riskTier: 1,
    dataSensitivity: 'internal',
    affectedRecordCount: 1,
    externalRecipients: [],
    confirmation: { tokenPresent: false, verified: false },
    influencedByUntrustedContent: false,
    now: NOW,
    ...overrides,
  };
}

describe('policy engine', () => {
  it('allows tier 0-2 without confirmation', () => {
    expect(evaluatePolicy(input({ riskTier: 1 })).effect).toBe('allow');
    expect(evaluatePolicy(input({ riskTier: 2 })).effect).toBe('allow');
  });

  it('requires confirmation for tier 3', () => {
    expect(evaluatePolicy(input({ riskTier: 3 })).effect).toBe('require_confirmation');
  });

  it('tier 4 with confirmation still requires fresh step-up', () => {
    const d = evaluatePolicy(input({ riskTier: 4, confirmation: { tokenPresent: true, verified: true } }));
    expect(d.effect).toBe('require_step_up_auth');
  });

  it('stale step-up does not count', () => {
    const d = evaluatePolicy(
      input({
        riskTier: 4,
        user: { id: 'u1', roles: ['support_agent'], authStrength: 'step_up', stepUpAt: NOW - 6 * 60 * 1000 },
        confirmation: { tokenPresent: true, verified: true },
      })
    );
    expect(d.effect).toBe('require_step_up_auth');
  });

  it('financial amount above threshold escalates to human approval', () => {
    const d = evaluatePolicy(
      input({
        riskTier: 4,
        financialAmount: POLICY_LIMITS.refundAutoApproveMax + 1,
        user: { id: 'u1', roles: ['support_agent'], authStrength: 'step_up', stepUpAt: NOW - 1000 },
        confirmation: { tokenPresent: true, verified: true },
      })
    );
    expect(d.effect).toBe('require_approval');
    if (d.effect === 'require_approval') expect(d.approverRole).toBe('finance_approver');
  });

  it('untrusted-content taint escalates tier (2 -> confirmation required)', () => {
    const clean = evaluatePolicy(input({ riskTier: 2 }));
    expect(clean.effect).toBe('allow');
    const tainted = evaluatePolicy(input({ riskTier: 2, influencedByUntrustedContent: true }));
    expect(tainted.effect).toBe('require_confirmation');
  });

  it('bulk recipients escalate tier 3 to tier-4 treatment (step-up)', () => {
    const d = evaluatePolicy(
      input({
        riskTier: 3,
        externalRecipients: Array.from({ length: POLICY_LIMITS.bulkRecipientThreshold + 1 }, (_, i) => `r${i}@x.com`),
        affectedRecordCount: POLICY_LIMITS.bulkRecipientThreshold + 1,
        confirmation: { tokenPresent: true, verified: true },
      })
    );
    expect(d.effect).toBe('require_step_up_auth');
  });

  it('denies over the absolute record cap regardless of anything else', () => {
    const d = evaluatePolicy(input({ riskTier: 1, affectedRecordCount: POLICY_LIMITS.maxAffectedRecords + 1 }));
    expect(d.effect).toBe('deny');
  });

  it('large export requires data-owner approval even after step-up', () => {
    const d = evaluatePolicy(
      input({
        riskTier: 4,
        affectedRecordCount: POLICY_LIMITS.exportApprovalThreshold + 1,
        user: { id: 'u1', roles: ['data_owner'], authStrength: 'step_up', stepUpAt: NOW - 1000 },
        confirmation: { tokenPresent: true, verified: true },
      })
    );
    expect(d.effect).toBe('require_approval');
    if (d.effect === 'require_approval') expect(d.approverRole).toBe('data_owner');
  });
});
