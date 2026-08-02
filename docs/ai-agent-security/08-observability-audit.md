# 08 — Observability & Audit

## Audit event schema

One event per pipeline stage, all sharing a `correlation_id` per user request (and `task_id` for multi-step plans). Canonical schema (JSON):

```jsonc
{
  "event_id": "uuidv7",                    // time-ordered, unique
  "correlation_id": "req_8f3a…",           // one user request end-to-end
  "task_id": "task_02c1…",                 // multi-step plan grouping (nullable)
  "sequence": 4,                           // order within correlation
  "timestamp": "2026-08-02T10:31:22.113Z",
  "stage": "authorization",                // request|plan|retrieval|policy|authorization|
                                           // confirmation_issued|confirmation_consumed|
                                           // approval|execution_attempt|execution_result|response
  "actor": {
    "user_id": "u_991", "tenant_id": "acme-prod", "session_id": "s_7bc2…",
    "roles": ["support_agent"], "auth_strength": "mfa",
    "on_behalf_of": null                   // delegation chain if any
  },
  "agent": { "agent_version": "gw-1.4.2", "model": "claude-sonnet-5", "prompt_version": "p-2026-07-30" },
  "request": { "user_message_hash": "sha256:…", "user_message_ref": "conv_store:…" },  // content by reference, not inline
  "action": {
    "proposed_by_model": true,
    "tool": "update_contact_details",
    "risk_tier": 3,
    "params_redacted": { "customerId": "C-10422", "phone": "***-0177" },   // sensitivity-tag redaction
    "params_hash": "sha256:…",             // full-fidelity hash for dispute resolution
    "target": { "type": "customer", "ids": ["C-10422"], "resource_versions": {"C-10422": 17} }
  },
  "decisions": {
    "policy": { "effect": "require_confirmation", "rules_fired": ["tier3_confirm"], "obligations": ["mask:ssn"] },
    "authorization": { "result": "allow", "checks": ["rbac","tenant","object","field"] }
  },
  "confirmation": {
    "token_id": "ct_55ae…", "action_hash": "sha256:…",
    "issued_at": "…", "consumed_at": "…", "channel": "ui_button", "step_up": { "method": "webauthn", "at": "…" }
  },
  "approval_chain": [ { "approver_id": "u_104", "role": "support_manager", "decision": "approved", "at": "…" } ],
  "execution": {
    "state": "completed",                  // attempting|completed|failed|compensated
    "idempotency_key": "sha256:…",
    "backend_service": "customer-service", "backend_status": 200, "duration_ms": 184,
    "before": { "phone": "***-0100" }, "after": { "phone": "***-0177" },   // redacted; full values in restricted vault by reference
    "verification": { "read_back": true, "matched": true }
  },
  "error": null,                            // { code, message, retriable } on failure
  "security_flags": { "influenced_by_untrusted_content": false, "injection_markers": [] },
  "prev_event_hash": "sha256:…"            // hash chain for tamper evidence
}
```

Design notes:
- **Sensitive values are redacted at write time** via sensitivity tags; full before/after values needed for rollback live in a separately access-controlled vault, referenced by ID. Audit readers see masked values by default.
- `params_hash` + `action_hash` make disputes resolvable ("what exactly was confirmed?") without storing raw sensitive params in the main store.
- Model in/out payloads are stored **by reference** into the short-retention prompt-capture store (doc 06), keeping the audit store long-retention-safe.

## Immutability

- Audit store is **append-only**: object-lock/WORM storage or an insert-only table with no UPDATE/DELETE grants for any runtime identity; schema migrations via break-glass only.
- **Hash chain** (`prev_event_hash`) per tenant stream + periodic anchoring of the head hash to an external system makes tampering evident.
- Writes are part of the execution path: Tier ≥2 execution **fails closed** if the audit write fails (buffered local WAL covers brief outages for Tier ≤1).
- Retention per compliance class (e.g., 7 years financial, 2 years general), redaction-by-design so retention doesn't fight erasure duties.

## Monitoring & alerting

| Signal | Alert condition |
|---|---|
| Policy denial rate | Spike per user/tenant (probing) |
| Authz denial on object/tenant checks | Any cross-tenant attempt (page security) |
| Injection markers | High-confidence marker on Tier ≥3 flow |
| Confirmation anomalies | Token replay attempts, expired-token spikes, confirm-cancel rate jump |
| Execution integrity | `attempting` records older than timeout; verification mismatches; audit-coverage gap (actions without events = **page immediately** — this metric existing is itself a control) |
| Volume anomalies | Retrieval rows/user/hour, Tier 4 executions/day, spend per tenant |
| Reconciler queue | Unresolvable ambiguous actions > 0 for > 1h |

Dashboards track the product metrics from doc 11 (success rate, confirmation rates, block rates, latency, cost). Security events stream to the SIEM with the same `correlation_id`, so an analyst can replay any incident end-to-end: what the user asked → what the model proposed → what policy said → what the user saw and confirmed → what actually executed → what changed.
