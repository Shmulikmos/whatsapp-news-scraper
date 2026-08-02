# secure-agent-gateway (proof of concept)

A compiling, tested TypeScript reference implementation of the architecture in
[`../../docs/ai-agent-security/`](../../docs/ai-agent-security/). It demonstrates
the core thesis: **the LLM proposes, a deterministic gateway validates,
authorizes, confirms, executes, and audits.** The model holds no credentials,
reaches no database, and cannot self-authorize.

## Run it

```bash
cd poc/secure-agent-gateway
npm install
npm run typecheck   # tsc --noEmit, strict
npm test            # 56 tests: unit + red-team + integration
npm run test:redteam
```

No API keys required — the LLM is behind an interface and mocked in tests. The
mock can also play a **fully compromised model** to prove that total control of
model output still cannot cause an unauthorized side effect.

## Where the security boundaries live

| Concern | File |
|---|---|
| Single choke point (only path model → handler) | `src/execution/executor.ts` |
| Allowlist registry (exact-match, frozen, denylist) | `src/tools/registry.ts` |
| Policy decisions (allow/deny/confirm/step-up/approve) | `src/policy/engine.ts` |
| Per-call authorization (RBAC + tenant + object + field) | `src/authz/authorize.ts` |
| Signed single-use confirmation tokens | `src/confirmation/service.ts` |
| Append-only, hash-chained audit + redaction | `src/audit/audit.ts` |
| Untrusted-content envelopes + taint + injection markers | `src/security/untrusted.ts` |
| Fixed pipeline around the untrusted model | `src/agent/orchestrator.ts` |
| Sample tools (read / write / sensitive / bulk / prohibited) | `src/tools/definitions/` |

## What the tests prove (mapped to `docs/.../10-security-test-plan.md`)

- Cross-tenant reads/writes denied without existence disclosure (S2)
- Viewer role blocked from every write tool; field-level writes constrained (S1/S9)
- Tier-3 never executes without a valid signed token; forged/expired/wrong-session/
  wrong-action/replayed tokens all rejected (S8)
- `execute_sql` and other prohibited tools refused at registration; hallucinated
  tool names hard-rejected (S11/S12)
- Indirect injection from an uploaded document cannot exfiltrate — the malicious
  recipient dies at verification, taint escalates the tier, the user is warned (S3/S4)
- Strict schemas reject unknown/oversized/mistyped params; gateway-owned fields
  (`tenantId`, `riskTier`, `confirmed`) stripped from model input (S5/S6)
- Optimistic locking turns concurrent edits into conflicts, not lost updates (S14)
- Backend timeout yields `unconfirmed_outcome`, never a false success claim (S17)
- Audit chain is complete and tamper-evident; sensitive values redacted at write time

This is a PoC: the backend, IdP, and step-up flow are in-memory analogs. It is
structured so each analog maps to a real component (application services + RLS,
OIDC session, WebAuthn) without changing the security model.
