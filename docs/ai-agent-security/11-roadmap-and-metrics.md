# 11 — Implementation Roadmap & Metrics

Each phase ships only after the previous phase's exit criteria are met and a go/no-go review passes. The gateway, policy engine, audit pipeline, and test harness are built in Phase 1 at full rigor — write capability is later *enabled through* them, never bolted on.

## Phase 1 — Read-only assistant, limited scope (≈ 6–8 weeks)

- **Capabilities:** Tier 0–1 only. `explain_feature`, `get_customer`, `get_order`, `search_orders`, `search_customers`, `generate_report`. One or two pilot tenants, opt-in users.
- **Security requirements (all mandatory before first user):** full pipeline (validate → policy → authz → execute → audit); delegated tokens + RLS; field-level filtering + masking; row caps; untrusted-data envelopes + taint tracking; append-only audit; rate limits + spend budgets; injection corpus in CI; authz matrix test; provider ZDR contract.
- **Metrics to watch:** authz/policy denial rates, injection-marker rate, retrieval volume/user, answer accuracy (sampled human eval), latency, cost/task.
- **Risks:** data leakage via over-retrieval (mitigate: caps + field filters); wrong answers eroding trust (mitigate: provenance display).
- **Exit criteria / go-no-go:** 0 cross-tenant incidents; 0 unauthorized-data incidents; audit coverage 100% of tool calls; injection containment 100% in CI + no action-level escapes in prod; ≥70% helpful-answer rate; support ticket deflection measurable. **No-go:** any tenant-isolation bug → freeze and fix architecture, not the symptom.

## Phase 2 — Drafts & reversible low-risk writes (≈ 4–6 weeks after exit 1)

- **Capabilities:** + Tier 2: `add_note`, `create_draft`, `create_support_ticket`, `update_preference`. All undoable; visible undo in UI.
- **Security additions:** idempotency infrastructure live end-to-end; action state machine + reconciler; undo/compensator framework; dry-run mode on every write tool; write-path audit with before/after.
- **Metrics:** duplicate-action rate (target 0), undo rate, incorrect-action rate (sampled), write success rate, reconciler queue size.
- **Risks:** silent wrong writes (mitigate: notifications on every write + undo); duplicate side effects (mitigate: idempotency tests + chaos drills).
- **Exit / go-no-go:** duplicate-action rate = 0 over 30 days; incorrect-action rate < 1% with all cases undone; reconciler resolves 100% of ambiguous states < 1h. **No-go:** any unaudited write.

## Phase 3 — Sensitive writes with confirmation & step-up (≈ 6–8 weeks after exit 2)

- **Capabilities:** + Tier 3: `update_contact_details`, `send_approved_email` (single/small-batch), `update_workflow_status`, `assign_task`.
- **Security additions:** confirmation service (signed single-use tokens, action-hash binding, optimistic-lock integration); native preview UI; step-up auth (WebAuthn/TOTP); taint-based tier escalation live; DLP on outbound messages; template-only external sends with verified recipients.
- **Metrics:** confirmation rate, confirmation-cancellation rate (healthy band ~2–10%: near-0 means users rubber-stamp, high means bad previews or model errors), preview-accuracy complaints, step-up failure rate, time-to-confirm.
- **Risks:** confirmation fatigue (mitigate: keep Tier 3 actions rare, previews ≤8 lines, measure); stale-state writes (mitigate: version checks — watch 409 rate).
- **Exit / go-no-go:** 0 confirmation bypasses (incl. quarterly red team); cancellation rate in healthy band; 0 sends to unverified recipients; rollback executed successfully in ≥1 real incident drill. **No-go:** evidence users confirm without reading (cancel rate ≈ 0 while incorrect-action complaints > 0).

## Phase 4 — Multi-step workflows, approvals, advanced monitoring (≈ 8–12 weeks after exit 3)

- **Capabilities:** + Tier 4: `request_refund`, `cancel_order`, `export_customer_records`, `deactivate_account`; multi-step saga plans (each step independently authorized); approval queues with second approver; scheduled/bulk operations with ledgers.
- **Security additions:** approval workflow service (requester ≠ approver, full chain audit); saga compensation engine; per-tenant anomaly detection (volume, velocity, spend); SIEM integration + incident runbooks; quarterly external red team; watermarked exports.
- **Metrics:** approval turnaround, saga compensation rate, Tier 4 volume/user, financial-error rate (target 0), anomaly alert precision, human escalation rate, user trust score (survey), cost per completed task.
- **Risks:** compensator gaps (mitigate: Tier 4 admission requires proven compensator in staging chaos test); approval rubber-stamping (mitigate: approver-side sampling audits).
- **Exit = steady state:** this phase's exit criteria become the permanent operating bar: 0 financial errors, 0 unapproved Tier 4 executions, compensation success 100%, audit coverage 100%.

## Metrics (tracked from Phase 1, dashboarded)

| Metric | Definition / target direction |
|---|---|
| Tool-call success rate | completed / attempted; > 99% excluding user cancels |
| Unauthorized-action block rate | blocked unauthorized attempts / attempts; expect > 0 (proves probing is caught); any *unblocked* = incident |
| Confirmation rate | confirmed / previews shown |
| Confirmation cancellation rate | canceled / previews; healthy 2–10% |
| Incorrect-action rate | sampled human eval of executed actions; < 0.5%, all remediated |
| Duplicate-action rate | 0, hard target |
| Policy-denial rate | trend per tenant; spikes = probing or bad UX |
| Security alert rate & precision | alerts/week, true-positive % |
| Data-leak incidents | 0, hard target |
| Human escalation rate | tasks handed to humans / total; watch for both extremes |
| User trust score | in-product survey, trend up |
| Avg execution latency | p50/p95 per tier; Tier 1 p95 < 3s |
| Cost per completed task | LLM + infra / completed task; trend down |
| Audit coverage | actions with complete event chain / actions; 100%, alarmed |

## Standing go/no-go principle

Any incident in the "never allowed" list (doc 00) — cross-tenant leak, unaudited write, confirmation bypass, model-held credential — halts phase progression and triggers architecture review. Feature pressure never overrides a red exit criterion; the phased structure exists precisely so the blast radius of a failed criterion is the *current* phase's capability set, not the full product vision.
