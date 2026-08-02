# 03 — Authorization & Policy Design

## Non-negotiables

1. The agent never has more permissions than the current user — and usually fewer (tool allowlist ⊂ user capabilities).
2. Every tool call is authorized **independently, at execution time**, by deterministic code.
3. The model is never an input to an authorization decision. Nothing the model "says" — and nothing in retrieved content — changes who the user is or what they may do.
4. Tenant identity comes from the authenticated session, never from model-generated parameters.

## Identity chain

```
IdP (OIDC) ──► Session (user_id, tenant_id, roles, auth_strength, expiry)
                  │  validated on every chat request
                  ▼
        Delegated access token (per tool call)
        { sub: user_id, tenant, scope: [tool:get_customer], aud: customer-service,
          act: { sub: "agent-gateway" },  exp: now + 120s }
                  │  OAuth2 token-exchange style; short-lived; audience-restricted
                  ▼
        Application service ──► re-authorizes the USER (not the gateway) ──► DB with RLS
```

- **User authentication:** existing IdP; MFA availability recorded as `auth_strength` (`password | mfa | step_up`), with `step_up` carrying a freshness timestamp (e.g., valid 5 minutes).
- **Session validation:** every message re-validates the session server-side (revocation-aware). Expired/revoked → the agent stops mid-task; in-flight plans are abandoned, not resumed.
- **Service-to-service identity:** mTLS (e.g., SPIFFE) authenticates the *gateway*; the delegated token authorizes the *user*. Two separate questions, two separate credentials. The gateway's own identity grants transport, never data.
- **Temporary delegated permissions:** the delegated token is minted per tool call with the narrowest scope (`tool:<name>`, target audience = owning service), TTL ≈ seconds-to-minutes. Nothing standing, nothing reusable, nothing bearer-shared across tools.

## Authorization layers (all must pass)

| Layer | Question | Enforced by |
|---|---|---|
| Action-level (RBAC) | May this role invoke this tool at all? | Policy engine — role → tool allowlist |
| Attribute-level (ABAC) | Do attributes permit it now? (auth strength, region, business hours for Tier 4, account standing) | Policy engine |
| Tenant isolation | Is every target inside the session's tenant? | Delegated token scope + service check + **Postgres RLS** (`tenant_id = current_setting('app.tenant')`) — structural, survives application bugs |
| Object-level | May this user act on *this* record? (ownership, team assignment) | Owning application service |
| Row-level | Which rows may a search return? | Service query scoping + RLS |
| Field-level | Which fields may be read/written? | Per-tool, per-role field allowlists — applied on *read* (filter before model context) and on *write* (reject non-allowlisted fields) |

Defense in depth is deliberate: the gateway checks, the service re-checks, the database enforces tenancy. Any single layer failing is a bug, not a breach.

## Policy engine (PDP)

A pure, deterministic, unit-testable function — custom TypeScript in the PoC; OPA/Rego or Cedar are equally valid at scale. It is consulted twice: at **plan validation** (fail fast, cheap UX) and at **execution** (authoritative — plans can go stale).

### Decision interface

```ts
interface PolicyInput {
  user: { id: string; roles: Role[]; authStrength: 'password'|'mfa'|'step_up'; stepUpAt?: string };
  tenantId: string;
  tool: string;                    // registry name
  riskTier: 0|1|2|3|4;             // from the tool definition, not the model
  target: { resourceType: string; resourceIds: string[] };
  fields?: string[];               // fields being read/written
  dataSensitivity: 'public'|'internal'|'pii'|'financial'|'secret';
  affectedRecordCount: number;
  externalRecipients?: string[];
  financialAmount?: { value: number; currency: string };
  confirmation?: { tokenPresent: boolean; verified: boolean };
  contextFlags: { influencedByUntrustedContent: boolean };  // taints confirmation requirements upward
}

type PolicyDecision =
  | { effect: 'allow'; obligations: Obligation[] }
  | { effect: 'deny'; reason: string }
  | { effect: 'require_confirmation'; previewRequired: true }
  | { effect: 'require_step_up_auth' }
  | { effect: 'require_approval'; approverRole: Role };
```

`Obligation` examples: `mask_fields:[ssn]`, `cap_rows:50`, `audit_level:full`. Obligations are enforced by the executor; an unenforceable obligation is a deny.

### Rule ordering (deny-overrides)

1. Explicit denies (unknown tool, cross-tenant target, prohibited field, record count over cap, amount over cap).
2. Tier-based requirements (Tier 3 → confirmation; Tier 4 → confirmation + step-up and/or approval).
3. Escalators: `influencedByUntrustedContent` bumps effective tier by one; bulk recipients/records bump tier; financial amount over threshold → `require_approval`.
4. Default: **deny**. No rule matched means no.

## What the model is allowed to influence

Only: which registered tool to propose, and candidate parameter values — both of which are then schema-validated, policy-checked, and authorized. The model cannot: mint tokens, set `riskTier`, set `tenantId`, mark confirmation as satisfied, or address a tool not in the registry. Those fields are populated by the gateway from trusted sources; any model attempt to supply them is stripped and logged.
