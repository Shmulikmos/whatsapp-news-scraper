# 00 — Executive Assessment

**Question:** Can an AI agent with broad access to a web application, backend, and database be built in a way that is genuinely safe and secure for users — or does it introduce unacceptable risk?

## Direct answer

**Yes, it is feasible — but only under a specific architecture, and the architecture is not optional.**

The system is safe if and only if the AI model is treated as an **untrusted decision-making component** that can *propose* actions, while a **deterministic application layer** validates, authorizes, constrains, executes, and audits every action. The model must never hold credentials, never touch the database, never compose SQL or HTTP requests, and never be the component that decides whether a user is authorized.

If those conditions hold, the residual risk profile is comparable to shipping a new, well-reviewed application feature. If any of them are violated, the system is unsafe regardless of how good the model or its prompts are.

## Under what conditions is it safe?

1. **Every capability is a narrow, typed tool** (`get_customer`, `update_contact_details`, …) with strict input/output schemas, not a general interface. The model chooses *which* tool and *with what parameters*; deterministic code decides *whether* and *how* it runs.
2. **The agent impersonates the user, never a service account.** Every tool call is independently authorized at execution time against the *current user's* session, role, tenant, and the specific target object/row/fields. The agent can never do anything the user could not do through the UI — and for higher tiers, strictly less.
3. **Risk-tiered execution** (Tiers 0–4, see doc 04): reads auto-execute; sensitive writes require an exact, structured **action preview** and explicit user confirmation cryptographically bound to that exact action; irreversible/financial/bulk actions require step-up authentication or a second human approver.
4. **Prompt injection is contained, not "detected."** All retrieved content (records, documents, emails, files) is treated as untrusted data that can never change permissions, tools, or instructions. Detection/filtering is defense-in-depth; the *security boundary* is that injected instructions have nothing dangerous to invoke without an authorized, confirmed tool call (doc 05).
5. **Reliability engineering is present from day one:** idempotency keys, optimistic locking, timeouts, compensating transactions, and a strict planned → attempted → completed state machine. The agent never claims success the backend didn't confirm (doc 07).
6. **Everything is audited immutably** with correlation IDs, before/after values, authorization and policy decisions, and confirmation evidence (doc 08).
7. **Rollout is phased:** read-only pilot → reversible low-risk writes → confirmed sensitive writes → multi-step workflows, with explicit exit criteria and go/no-go gates (doc 11).

## What would make it unsafe?

- Giving the model a database connection, an ORM, a SQL tool, a generic HTTP client, or shell access — even "temporarily," even "read-only." A read-only SQL connection is still a mass-exfiltration and cross-tenant-leak engine.
- Running tools under a privileged service identity instead of the user's delegated identity ("confused deputy" by design).
- Letting the model decide authorization ("the user said they're an admin"), or letting conversation text count as confirmation for a sensitive action.
- Relying on prompt engineering, system-prompt "rules," or injection classifiers as the security boundary.
- Skipping the deterministic pipeline for "simple" actions, or letting the model orchestrate multi-step writes without per-step authorization.
- Launching write capabilities before the read-only phase has proven authorization, tenant isolation, and audit under real traffic.

## What should never be allowed — permanently, in any phase

| Never | Why |
|---|---|
| Arbitrary SQL / direct DB access | Bypasses every application-layer control; one injection = full breach |
| Arbitrary HTTP / network egress | Exfiltration channel + SSRF; injected content can phone home |
| Shell / code execution | Full compromise of the execution environment |
| Raw credentials or secrets in model context | Anything in context can be leaked by the model's output |
| Admin functions (role grants, security settings, user management) | Privilege escalation with catastrophic blast radius |
| Bulk destructive operations (`delete all …`) | Irreversible; no legitimate chat-driven use case justifies the risk |
| Model-decided authorization or model-skippable confirmation | The model is the untrusted component; it cannot guard itself |
| Cross-tenant queries of any kind | Tenant isolation must be structural (scoped tokens/RLS), not behavioral |

## Verdict

**Safe to proceed under defined controls — starting with a narrow read-only pilot (Phase 1) and expanding only as exit criteria are met.**

What is *technically possible* (an agent that does everything a user can) is broader than what is *safe* (tiered capabilities behind deterministic enforcement), which is broader than what is *operationally realistic on day one* (read-only + drafts). The unacceptable-risk zone is well defined: direct data-plane access, service-account execution, and model-mediated authorization. Stay out of that zone and this is a buildable, defensible product; step into it and no amount of model quality compensates.

The rest of this document set is the concrete blueprint: architecture (01), threat model (02), authorization & policy (03), risk tiers & confirmation (04), injection defenses (05), data protection (06), reliability (07), audit (08), worked scenarios (09), security test plan (10), and roadmap with metrics (11). A compiling TypeScript proof-of-concept with red-team tests lives in `poc/secure-agent-gateway/`.
