# Secure AI-Agent Architecture

A production-grade analysis and reference design for adding a broadly-capable AI
agent to a web application **without** giving the model unrestricted access to
the database, credentials, or backend. Core principle: **treat the model as an
untrusted decision-making component — it may propose actions; a deterministic
application layer validates, authorizes, constrains, executes, and audits every
one.**

## Read in order

| # | Document | What it answers |
|---|---|---|
| 00 | [Executive assessment](00-executive-assessment.md) | Is it feasible? Under what conditions? What is never allowed? Final verdict. |
| 01 | [Reference architecture](01-reference-architecture.md) | Components, trust boundaries, Mermaid diagram, auth/tool/data/audit flows |
| 02 | [Threat model](02-threat-model.md) | STRIDE + ~25 threats, each with scenario, impact, likelihood, controls, residual risk |
| 03 | [Authorization & policy](03-authorization-and-policy.md) | RBAC/ABAC, tenant/object/row/field authz, delegated tokens, policy decision interface |
| 04 | [Risk tiers & confirmation](04-risk-tiers-and-confirmation.md) | Tier 0–4 table, action previews, signed confirmation tokens, anti-skip design |
| 05 | [Prompt-injection defenses](05-prompt-injection-defenses.md) | Direct + indirect injection; why detection is not the boundary; red-team cases |
| 06 | [Data protection](06-data-protection.md) | Minimization, masking, redaction, retention, residency, uploads, DSAR |
| 07 | [Reliability controls](07-reliability-controls.md) | Idempotency, locking, dry-run, compensations, planned/attempted/completed |
| 08 | [Observability & audit](08-observability-audit.md) | Full audit event schema, immutability, monitoring |
| 09 | [Example workflows](09-example-workflows.md) | 7 scenarios traced end-to-end, including a malicious document |
| 10 | [Security test plan](10-security-test-plan.md) | 17 test categories, methodology |
| 11 | [Roadmap & metrics](11-roadmap-and-metrics.md) | Phases 1–4 with exit criteria and go/no-go gates; metrics |

## The model everything is built around

```
User → Chat interface → Agent orchestration → Policy & authorization
     → Approved narrow tools → Existing backend & database
```

## Proof of concept

A compiling, tested TypeScript implementation lives in
[`../../poc/secure-agent-gateway/`](../../poc/secure-agent-gateway/) — 56 unit,
red-team, and integration tests, no API keys needed. It makes the documents
executable: the registry, policy engine, per-call authorization, signed
confirmation tokens, idempotent execution, and append-only audit are real code,
and the red-team suite drives a simulated *compromised* model to show it still
cannot cause an unauthorized side effect.

## Bottom line

**Safe to proceed under defined controls, starting with a narrow read-only
pilot.** The unacceptable-risk zone is specific and avoidable: direct data-plane
access (SQL/HTTP/shell), service-account execution instead of user-delegated
identity, and model-mediated authorization. Stay out of it and this is
buildable and defensible; step into it and no amount of model quality
compensates. Full reasoning in [document 00](00-executive-assessment.md).
