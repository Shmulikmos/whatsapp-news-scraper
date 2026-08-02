# 06 — Data Protection

## Minimization & selective retrieval
- Tools return **projections, not rows**: each tool declares per-role field allowlists; the service filters before data leaves it. The model never sees fields the answer doesn't need (`get_customer` for "what's their plan?" returns plan fields, not payment details — the planner requests a purpose, retrieval maps purpose → field set).
- Hard row caps (default ≤50) and pagination on every search; aggregate tools (`count`, `sum`) for statistics so raw rows aren't pulled to compute totals.
- Context assembly keeps only what the current turn needs; stale sensitive payloads are evicted from the rolling conversation window rather than resent every turn.

## PII masking & secret redaction
- Classification at the schema level: every tool output field is tagged (`public | internal | pii | financial | secret`). Masking is driven by tags, not regex guesses: `ssn → ***-**-1234`, `card → •••• 4242`, emails/phones partially masked for roles without field-level read rights.
- Unmasking is an explicit, audited, purpose-stated action (its own Tier 1+ policy check), never a default.
- Secret patterns (API keys, tokens, connection strings, private keys) are scanned and redacted at three choke points: retrieval → context, model output → user, and everything → logs. Secrets are never stored where retrieval can reach them, so redaction is backstop, not primary control.
- **No secrets in prompts, ever** — system prompts contain instructions and schemas only; credentials live in the gateway's secret manager and are injected into service calls by the executor after all checks.

## Encryption
- In transit: TLS 1.2+ externally, mTLS service-to-service. At rest: DB and audit-store encryption (KMS-managed keys, per-tenant keys where contractually required); uploaded files encrypted in object storage.

## Logging & retention
- Structured logs with **redaction in the logging layer** (a serializer that honors sensitivity tags), so call sites can't accidentally leak.
- Prompt/context capture (needed for debugging and injection forensics) is a separate, access-controlled, short-retention store (e.g., 30 days), never mixed with application logs.
- **Model-context retention:** provider-side — enterprise terms with zero-data-retention / no-training; pin regional endpoints for residency (EU traffic → EU inference). Application-side — conversation history retained per product policy (e.g., 90 days), sensitive tool outputs referenced by ID rather than value where possible.
- **Conversation retention:** user-visible, configurable per tenant; deletion propagates to prompt-capture stores. Audit events are *not* deleted with conversations (they are redacted-by-design and retained per compliance schedule, e.g., 7 years for financial actions).

## Tenancy, residency, vendor
- Tenant separation is structural: scoped delegated tokens + Postgres RLS + per-tenant retrieval indexes (doc 03). No shared embedding index across tenants.
- Residency: tenant → region mapping applied to storage, inference endpoint, and log/audit stores alike.
- Model provider sits in the vendor-risk program: DPA, subprocessor list, breach-notification terms, retention audit rights. Ability to swap providers (the gateway's LLM client is an interface) is itself a control.

## Deletion & subject access (GDPR/DSAR)
- Subject-access: because every read/write flows through tools with audit events keyed by user/tenant/record, "what did the agent access about person X" is a query, not an archaeology project.
- Erasure: deletes propagate to conversations, prompt-capture, retrieval indexes, and caches; audit events keep only redacted references (lawful-basis retention). A deletion workflow test is part of the compliance suite.

## Uploaded files
- Uploads land in quarantined object storage: malware scan, type/size validation, no execution, no server-side rendering of active content.
- Extracted text (never the raw file) enters model context — inside an untrusted-data envelope with taint tracking (doc 05).
- Files inherit the uploader's tenant/ACL; the agent can only retrieve uploads the current user could access; retention and deletion follow the tenant's policy.
