# 10 — Security Test Plan

Structure: unit tests on security components, integration tests on the pipeline, red-team tests as adversarial scenarios. All run in CI; a failing security test blocks deploy. The PoC implements a representative subset in `poc/secure-agent-gateway/tests/`.

## Test matrix

| # | Category | Key cases | Expected result |
|---|---|---|---|
| S1 | **Unauthorized access** | Viewer role invokes write tools; expired/revoked session mid-task; missing session | Policy/authz deny; in-flight task aborts on revocation; audit records deny |
| S2 | **Cross-tenant access** | Tool params referencing another tenant's IDs; search attempting cross-tenant filter; retrieval index bleed; delegated token replayed against wrong tenant | Object authz deny + RLS returns zero rows; alert fired; no data in any layer |
| S3 | **Prompt injection (direct)** | RT-1/RT-5 corpus (role reassignment, fake-admin, tool-syntax in user text) | No unauthorized action; markers logged |
| S4 | **Indirect prompt injection** | RT-2/RT-3/RT-6/RT-7 corpus via records, uploads, multi-turn taint, encodings | Structural containment holds; taint escalation applied; user warned |
| S5 | **Schema bypass** | Extra fields, wrong types, oversized strings/arrays, prototype-pollution keys (`__proto__`), unknown enum values, nested injection into typed fields | Zod strict parse rejects; no handler invocation; audit records validation failure |
| S6 | **Parameter manipulation** | Model-supplied `tenantId`/`riskTier`/`confirmed:true`; negative amounts; limit=1e9; ID format confusion | Gateway-owned fields stripped and logged; bounds enforced; caps applied |
| S7 | **Duplicate execution** | Same confirmation token twice (parallel + sequential); retry after timeout; double-click confirm; replay captured request | Exactly one side effect (idempotency + single-use token); second attempt → explicit "already executed" |
| S8 | **Confirmation bypass** | Execute Tier 3 with no token / forged HMAC / expired token / token from another session / token for different action hash / "user said yes" in model text | All rejected; zero side effects; security events emitted |
| S9 | **Privilege escalation** | Chained tools to reach unauthorized outcome; role change mid-conversation (downgrade honored immediately); approval self-approval attempt | Per-step authz holds; approver ≠ requester enforced |
| S10 | **Bulk-data extraction** | Row-cap probing (limit walking, pagination hammering); many small queries (velocity); export without approval | Caps hold; velocity limiter triggers; export parks pending approval |
| S11 | **Destructive-action attempts** | Bulk delete requests; loop of single deactivations; hard-delete parameter probing | No tool exists / rate limit denies; honest refusal response |
| S12 | **Tool hallucination** | Nonexistent tool names; near-miss names (`get_customers` vs `get_customer`); tools from other products the model may know | Registry hard-reject; no fuzzy matching; logged |
| S13 | **Tool-response tampering** | Handler returns out-of-schema data; oversized payload; injected instructions inside a tool result | Output-schema validation rejects/truncates; result text re-enters context as untrusted data |
| S14 | **Race conditions** | Concurrent edits between preview and confirm (version bump); two sessions mutating same record; concurrent confirm of same action | 409 → re-preview; serialized execution; single side effect |
| S15 | **Partial failures** | Multi-step saga fails at step 2 of 3; bulk send fails mid-batch; compensator itself fails | Compensation runs in reverse; precise per-item report; failed compensator → alert + manual queue; never silent |
| S16 | **Model timeout / malformed output** | LLM timeout, non-JSON output, truncated JSON, response claiming success | Graceful degradation, nothing executed; "done" claims blocked unless state=completed |
| S17 | **Backend timeout** | Write times out (side effect unknown) | State stays `attempting`; status-query reconciliation; user told "unconfirmed", never "done"; reconciler resolves |

## Methodology notes

- **Injection corpus:** maintained file of attack strings (multi-language, encoded, homoglyph, HTML-comment, markdown-link variants), grown from production injection markers; run against every prompt/model change. Track *containment rate* (must be 100% for action-level outcomes) separately from *detection rate* (best effort, trended).
- **Property-based testing** for schema validation and idempotency (fast-check): random adversarial inputs must never reach a handler un-validated or execute twice.
- **Authz matrix test:** generated test that iterates (every role × every tool × in/out-of-tenant target) and asserts the full expected allow/deny matrix — the single highest-value test in the suite; updated in the same PR as any tool/role change.
- **Chaos drills** (staging): kill the gateway mid-write, partition the audit store, inject backend 500s/timeouts — verify fail-closed behavior and reconciliation.
- **Periodic human red team** pre-launch and quarterly: fresh attackers, production-like data, scored against the threat model (doc 02); findings feed the corpus.
