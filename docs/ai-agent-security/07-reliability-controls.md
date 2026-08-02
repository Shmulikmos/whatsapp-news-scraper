# 07 — Reliability Controls

Reliability is a security property here: a duplicated refund or a half-completed multi-step task is an integrity incident. Core rule: **the agent never claims success the backend didn't confirm.**

## Action state machine

Every consequential action is a persisted record moving through explicit states:

```
planned → validated → authorized → awaiting_confirmation → confirmed
        → attempting → completed | failed | compensated | expired
```

- `planned`: structured plan exists; nothing has touched a backend.
- `attempting` is written **before** the side effect (write-ahead), so a crash mid-call leaves evidence and enables recovery/reconciliation instead of silent duplication.
- `completed` is set only from the backend's confirmed response (and, for critical writes, a post-action read-back).
- User-facing language maps 1:1: "I plan to…", "I attempted… but couldn't confirm the result", "Done — confirmed." The model summarizes from the state record, and the gateway cross-checks: a "done" summary for a non-`completed` action is blocked and rewritten.

## Controls

| Control | Implementation |
|---|---|
| **Idempotency keys** | `idempotency_key = SHA-256(user, tool, canonical_params, confirmation_nonce)` sent to backend on every write; backend dedups within a retention window (≥24h). Same confirmed action retried → same result, one side effect. |
| **Duplicate-action prevention** | Beyond the key: single-use confirmation tokens (double-click safe); gateway-side in-flight lock per `idempotency_key`; velocity rules ("second refund to same order within 24h" → policy escalates). |
| **Transaction boundaries** | A single tool = a single service call = a single DB transaction where possible. Multi-step plans do **not** share a distributed transaction; each step commits individually with compensations defined (see below). |
| **Dry-run mode** | Every write tool implements `dryRun: true` — full validation + authz + precondition evaluation, no side effect. Used to build previews (returns the exact before/after diff) and in CI. |
| **Precondition checks** | Declared per tool, evaluated server-side at execution: record exists, status permits the transition (can't cancel a shipped order), balance sufficient, recipient verified. Failed precondition → clean, explained failure — never "best effort." |
| **Optimistic locking / version checks** | Reads return `resource_version` (row version/updated_at). Previews embed it in the action hash; execution sends `If-Match`. Version mismatch → 409 → fresh preview → re-confirm. No lost updates, no acting on stale state. |
| **Retry rules** | Retries only for idempotent operations (reads always; writes only with idempotency key honored by the backend). Bounded exponential backoff + jitter, budgeted per task. Non-retryable: 4xx validation/authz failures, precondition failures. **Timeouts are ambiguous** — a timed-out write is `attempting`, and the next step is a status query, not a blind retry. |
| **Timeout handling** | Per-tool execution timeouts (defaults: read 5s, write 10s) + overall task budget. On model timeout: safe degradation, nothing executed. On backend timeout: reconcile via read-back before reporting anything. |
| **Rollback / compensating transactions** | Each Tier ≥3 tool declares its compensator (`update_contact_details` → restore prior values from audit; `cancel_order` → reinstate; `request_refund` → void request). Truly uncompensable operations are redesigned into staged/soft forms — that's a Tier-4 admission requirement, not a nice-to-have. |
| **Partial-failure handling (multi-step)** | Saga pattern: steps execute sequentially, each independently authorized; on failure, the orchestrator runs compensators for completed steps in reverse order, reports exactly which steps completed/compensated/never-ran, and never continues past a failed step. Bulk operations chunk with a per-item outcome ledger — "37 of 40 emails sent, 3 failed: …" — no silent partial success. |
| **Post-action verification** | For Tier ≥3: read the resource back (or consume the service's confirmation event) and diff against intent before setting `completed`. Mismatch → `failed` + alert + compensator. |

## Recovery & reconciliation

A background reconciler sweeps stale `attempting` records: queries the backend by idempotency key, resolves to `completed` or `failed`, alerts on unresolvable ones. This converts crashes and network partitions from "unknown side effects" into a bounded, observable queue.
