/**
 * Policy engine (PDP): a pure, deterministic, unit-testable decision function.
 * Deny-overrides; default deny. Consulted at plan time (UX) and again at
 * execution time (authoritative).
 */
import type { AuthStrength, RiskTier, Role, Sensitivity } from '../types.js';
import { STEP_UP_FRESHNESS_MS } from '../types.js';

export interface PolicyInput {
  readonly user: {
    readonly id: string;
    readonly roles: readonly Role[];
    readonly authStrength: AuthStrength;
    readonly stepUpAt?: number;
  };
  readonly tenantId: string;
  readonly tool: string;
  /** From the tool definition — never from the model. */
  readonly riskTier: RiskTier;
  readonly dataSensitivity: Sensitivity;
  readonly affectedRecordCount: number;
  readonly externalRecipients: readonly string[];
  readonly financialAmount?: number;
  readonly confirmation: { readonly tokenPresent: boolean; readonly verified: boolean };
  /** Taint: this turn's context included attacker-controllable content. */
  readonly influencedByUntrustedContent: boolean;
  readonly now: number;
}

export type Obligation =
  | { kind: 'cap_rows'; max: number }
  | { kind: 'audit_level'; level: 'full' }
  | { kind: 'notify_user' };

export type PolicyDecision =
  | { effect: 'allow'; effectiveTier: RiskTier; obligations: Obligation[] }
  | { effect: 'deny'; reason: string }
  | { effect: 'require_confirmation'; effectiveTier: RiskTier }
  | { effect: 'require_step_up_auth'; effectiveTier: RiskTier }
  | { effect: 'require_approval'; effectiveTier: RiskTier; approverRole: Role };

export const POLICY_LIMITS = {
  maxAffectedRecords: 10_000,
  bulkRecipientThreshold: 25,
  bulkRecordEscalationThreshold: 25,
  refundAutoApproveMax: 500,
  exportApprovalThreshold: 1_000,
} as const;

function escalate(tier: RiskTier, by: number): RiskTier {
  return Math.min(4, tier + by) as RiskTier;
}

export function evaluatePolicy(input: PolicyInput): PolicyDecision {
  // --- 1. Explicit denies (deny-overrides) ---------------------------------
  if (input.affectedRecordCount > POLICY_LIMITS.maxAffectedRecords) {
    return { effect: 'deny', reason: `affects ${input.affectedRecordCount} records (max ${POLICY_LIMITS.maxAffectedRecords})` };
  }
  if (input.financialAmount !== undefined && input.financialAmount <= 0) {
    return { effect: 'deny', reason: 'financial amount must be positive' };
  }

  // --- 2. Runtime tier escalation (never de-escalation) --------------------
  let tier = input.riskTier;
  if (input.influencedByUntrustedContent && tier >= 1) tier = escalate(tier, 1);
  if (input.externalRecipients.length > POLICY_LIMITS.bulkRecipientThreshold) tier = escalate(tier, 1);
  if (input.affectedRecordCount > POLICY_LIMITS.bulkRecordEscalationThreshold && input.riskTier >= 2) {
    tier = escalate(tier, 1);
  }

  // --- 3. Tier requirements ------------------------------------------------
  if (tier <= 2) {
    return {
      effect: 'allow',
      effectiveTier: tier,
      obligations: tier === 2 ? [{ kind: 'notify_user' }, { kind: 'audit_level', level: 'full' }] : [],
    };
  }

  // Tier 3+: explicit structured confirmation is mandatory.
  if (!input.confirmation.verified) {
    return { effect: 'require_confirmation', effectiveTier: tier };
  }

  if (tier === 4) {
    const stepUpFresh =
      input.user.authStrength === 'step_up' &&
      input.user.stepUpAt !== undefined &&
      input.now - input.user.stepUpAt <= STEP_UP_FRESHNESS_MS;
    if (!stepUpFresh) {
      return { effect: 'require_step_up_auth', effectiveTier: tier };
    }
    // Financial threshold: a second human must approve.
    if (input.financialAmount !== undefined && input.financialAmount > POLICY_LIMITS.refundAutoApproveMax) {
      return { effect: 'require_approval', effectiveTier: tier, approverRole: 'finance_approver' };
    }
    if (input.affectedRecordCount > POLICY_LIMITS.exportApprovalThreshold) {
      return { effect: 'require_approval', effectiveTier: tier, approverRole: 'data_owner' };
    }
  }

  return {
    effect: 'allow',
    effectiveTier: tier,
    obligations: [{ kind: 'audit_level', level: 'full' }, { kind: 'notify_user' }],
  };
}
