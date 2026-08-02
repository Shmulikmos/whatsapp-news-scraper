/**
 * Core domain types for the secure agent gateway.
 *
 * Security invariant: everything in `AuthContext` comes from the authenticated
 * session (IdP + session store). Nothing here is ever populated from model
 * output or retrieved content.
 */

export type Role =
  | 'viewer'
  | 'support_agent'
  | 'support_manager'
  | 'finance_approver'
  | 'data_owner';

export type AuthStrength = 'password' | 'mfa' | 'step_up';

export type Sensitivity = 'public' | 'internal' | 'pii' | 'financial' | 'secret';

/** Risk tier is a static property of a tool definition. The model has no say. */
export type RiskTier = 0 | 1 | 2 | 3 | 4;

export interface AuthContext {
  readonly userId: string;
  readonly tenantId: string;
  readonly sessionId: string;
  readonly roles: readonly Role[];
  readonly authStrength: AuthStrength;
  /** Epoch ms of the last step-up authentication, if any. */
  readonly stepUpAt?: number;
}

/** How fresh a step-up assertion must be to satisfy Tier 4 (ms). */
export const STEP_UP_FRESHNESS_MS = 5 * 60 * 1000;

export interface ResourceTarget {
  readonly resourceType: string;
  readonly resourceIds: readonly string[];
}

/**
 * Gateway-generated action preview. Built from the system of record via the
 * tool's dry-run — never composed by the model.
 */
export interface ActionPreview {
  readonly action: string;
  readonly target: string;
  readonly fieldsChanging: readonly string[];
  readonly currentValues: Readonly<Record<string, unknown>>;
  readonly proposedValues: Readonly<Record<string, unknown>>;
  readonly externalRecipients: readonly string[];
  readonly financialImpact: string | null;
  readonly sideEffects: readonly string[];
  readonly reversible: boolean;
  readonly affectedRecordCount: number;
}

/** Fields the model is never allowed to supply; the gateway owns them. */
export const GATEWAY_OWNED_FIELDS = [
  'tenantId',
  'userId',
  'riskTier',
  'confirmed',
  'confirmationToken',
  'authStrength',
  'roles',
] as const;

export class SecurityViolation extends Error {
  constructor(
    message: string,
    readonly code:
      | 'unknown_tool'
      | 'prohibited_tool'
      | 'schema_violation'
      | 'gateway_field_injection'
      | 'authz_denied'
      | 'policy_denied'
      | 'confirmation_invalid'
      | 'tenant_violation'
      | 'registry_frozen'
  ) {
    super(message);
    this.name = 'SecurityViolation';
  }
}
