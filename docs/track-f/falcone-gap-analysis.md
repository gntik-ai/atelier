# Falcone Gap Analysis — LLM Code Wiki Platform

Draft v0.5 · 2026-08-04 · Companion to `llm-wiki-functional-requirements.md` v0.5

> **v0.4** — reconciled with the owner's evidence-based assessment `FALCONE_GAP_ANALYSIS_FOR_LLM_CODE_WIKI.md` v1.0 (repo `gntik-ai/falcone`, branch `main`, commit `9d8eec4`). That document is now the **authoritative analysis**: it inspected actual code and docs, where v0.1–v0.3 of this file reasoned from the platform's shape. This version records, per original gap, what the evidence confirmed, refined, resolved or reclassified; adopts the gaps I had missed; and keeps the items this document uniquely adds (plan entitlements for the decided Free/$1 model, payment webhooks, decided-v1 prioritization).
> **v0.5** — organizations restored to v1: no new platform gaps (tenant/workspace lifecycle and coarse roles are covered foundations per the authoritative matrix §5), but project-level RBAC, the invitation/collaboration domain and connection-scope policy become P0 product work, and the plan-entitlement anchor (per user vs per workspace) must be settled before the quota policies (GAP-FAL-010 extension) are specified.

## 1. Headline corrections from the evidence

- **Covered (I had assumed gaps or unknowns):** pgvector vector search + embedding provider with re-index warning; Kafka events + realtime delivery + Flow SSE monitoring; signed/retried inbound webhooks with Flow triggers; PostgreSQL + document API; OpenBao-backed write-only workspace secrets; OpenAI-compatible LLM executor with streaming, SSRF guards and token-usage recording; Temporal Flows with cancellation/retry/signals/audit.
- **Sharper than my framing:** the BYOK gap is not "no per-user vault" — the secret primitive exists; the executor is simply wired to operator-mounted `BYOK_*` environment variables instead of workspace secret references (GAP-AI-002). And `workspace_llm_providers` is unique per `(tenant, workspace)`, so **only one LLM provider connection can exist per workspace** — a schema constraint I hadn't identified (GAP-AI-001).
- **New release gate I lacked:** **GAP-PRD-001 — production readiness.** Falcone's own README declares early-development status; a product holding private source code, repo credentials and provider keys cannot launch on that basis. This outranks every feature gap.

## 2. Reconciliation of v0.3 gaps

| v0.3 gap | Verdict | Authoritative counterpart / suggested OpenSpec |
|---|---|---|
| GAP-01 Per-end-user BYOK credential vault | **Refined & confirmed** — primitive exists (OpenBao write-only workspace secrets); gap is the executor wiring + credential resource lifecycle | GAP-AI-002 / GAP-FAL-002 · `integrate-byok-with-workspace-secret-store` |
| GAP-02 Gateway routing + capability catalog | **Confirmed & split** — multi-connection registry, native adapters (Anthropic/Gemini/OpenAI-native), model capability catalog | GAP-FAL-001/004/005 · `add-multi-provider-connection-registry`, `add-native-*-provider-adapter`, `add-model-capability-catalog` |
| GAP-03 Batch/async LLM job primitive | **Confirmed** — no `/v1/batches`, Anthropic message-batches or Gemini batch implementation found; richer lifecycle required (items, manifests, expiry, reconciliation, usage capture) | GAP-FAL-006 · `add-llm-provider-batch-execution` |
| GAP-04 Fair queue with visible position | **Confirmed** — Temporal task queues stay internal; add a durable **admission queue** in front of workflow start (validate → durable queued record → rank by fairness/concurrency/budget → start Flow when admitted → stream rank changes) | GAP-FAL-008 · `add-tenant-fair-job-admission-queue` |
| GAP-05 End-user realtime channels | **Resolved — covered.** Events/realtime/Flow SSE evidenced; remaining work is product-side stage mapping and log redaction | — |
| GAP-06 Per-user metering & budgets | **Confirmed & expanded** — current usage rollup lacks project/run/stage/request/batch/retry dimensions and any monetary layer (pricing snapshots, currency, reservations) | GAP-FAL-007/010 · `add-ai-usage-cost-ledger`, `add-code-wiki-quota-dimensions` |
| GAP-07 Git ingestion connector | **Reclassified: application domain.** Build `repo-connector-service` in the product on Falcone secrets/webhooks/events/audit; generalize into the platform only when a second product needs it (owner Decision 1) | product epic |
| GAP-08 Managed inbound webhooks | **Resolved — covered primitive.** Signed/retried webhooks + Flow triggers exist; VCS signature verification, replay rejection and commit coalescing are product logic. Payment-provider (Stripe) webhooks ride the same primitive | — |
| GAP-09 Protected artifact serving / hosted wiki | **Reclassified: product infrastructure** (owner Decision 6). Object storage is covered; auth-aware wiki routing, static export, unlisted-token access and visibility rules belong to `wiki-renderer`/publishing. Because public share links are **decided into v1**, this product work is P0 | product epic |
| GAP-10 OAuth token brokering | **Confirmed & expanded** to a full credential broker: OAuth/PKCE with refresh locking, plus cloud identity (service accounts, workload/managed identity) and provider-specific signing | GAP-FAL-003 · `add-provider-credential-broker` |
| GAP-11 Vector search for chat | **Resolved — covered.** pgvector + embedding provider + re-index warning evidenced. Remaining product work: lexical/symbol index, hybrid retrieval, index versions bound to wiki versions | — |

## 3. Gaps adopted that v0.3 lacked

- **GAP-PRD-001 — Production readiness (Critical, release gate).** Supported release, threat model + independent security review, tenant-isolation tests across every used API and background path, secret-lifecycle procedures, backup/restore + DR rehearsals with application data, HA/upgrade/migration guarantees. Private repositories must not be accepted before this closes (go/no-go list in the authoritative doc, §19).
- **GAP-FAL-004 — Native provider adapters.** OpenAI-compatible mode is not a provider abstraction: native Anthropic/Gemini semantics (auth, request shape, caching, batch, usage) need adapters; DeepSeek/Kimi start on a *tested* compatible adapter — compatibility is verified, never assumed.
- **GAP-FAL-009 — Large-task worker profile.** Cloning/parsing needs ephemeral disk, process isolation, egress allow-lists, no inherited secrets, no code execution by default — a dedicated worker runtime coordinated by Flows, not ordinary function invocations.
- **GAP-FAL-011 — Social IdP management UX.** Corrects my earlier "social login = non-gap": the Keycloak runtime and configured providers are covered, but console create/edit of identity providers is deferred — either finish the Falcone console or ship it in product admin.
- **GAP-FAL-012 — Flow payload confidentiality.** Temporal history persists execution tokens; secrets must never enter workflow inputs (opaque references only), plus payload codec/encryption and restricted history access.

## 4. What this document still adds

- **Plan entitlements for the decided freemium model.** Free (limits, 1 concurrent run proposed) vs single $1 Paid plan (max 2 concurrent runs) expressed as per-user quota policies the platform enforces at admission — an extension riding GAP-FAL-008 (admission) + GAP-FAL-010 (quota dimensions). The authoritative doc's plan framework (ADM-003) is the anchor; monetization itself was left open there (baseline §29.5) and is now decided.
- **Payment processing stays app-level** (Stripe checkout/dunning) — a non-gap by design; its inbound webhooks use the covered signed-webhook primitive.
- **Decided-v1 pressure on priorities:** public share links in v1 make the GAP-09 product work (unlisted-token access, public/source separation) P0 rather than deferrable; chat in v1 makes hybrid retrieval + index versioning P0 product work even though the vector primitive is covered.
- **Organizations in v1 (2026-08-04).** Platform side is a covered foundation (tenancy, workspaces, coarse roles, service accounts); the v1 cost lands on the product: project-level RBAC evaluated together with verified Falcone identity, invitation/membership UX, comments/review/activity domain, and explicit connection scoping (project/workspace/org). The Free/$1 plan anchor (per user vs per workspace) is now an open question that shapes the quota-policy dimensions.

## 5. Likely non-gaps — updated

- Run cancellation/retry mechanics: Temporal Flows (confirmed by evidence).
- Checkpoint/resume: Flow durability + idempotent activities; app design work, not platform change.
- Index/artifact persistence: PostgreSQL + document API + object storage (confirmed).
- Realtime progress transport and inbound signed webhooks (confirmed — moved here from the gap list).
- Vector search + embeddings (confirmed — moved here).
- Payments (Stripe) — app-level by design.
- ~~Social login as pure configuration~~ → revised: runtime covered, console management UX is GAP-FAL-011.

## 6. Priority summary (aligned to the authoritative backlog)

| Track | Content |
|---|---|
| **P0-A · Release gate** | GAP-PRD-001 production-readiness program + GAP-FAL-012 payload confidentiality — before any private repository is accepted |
| **P0-B · Falcone AI platform** | GAP-FAL-001 multi-connection registry · GAP-FAL-002 self-service credentials · GAP-FAL-004 native adapters · GAP-FAL-005 capability catalog · GAP-FAL-006 batch execution · GAP-FAL-007 usage/cost ledger |
| **P0-C · Reusable execution platform** | GAP-FAL-008 admission queue with position · GAP-FAL-009 worker profile · plan-entitlement quota policies (Free/$1, GAP-FAL-010 extension) |
| **P0-D · Product domain (not Falcone core)** | repo-connector-service · analysis workers + code intelligence · wiki generation/rendering/versioning · hybrid search + grounded chat · project-level RBAC + collaboration domain (orgs in v1) · publication/share-link infrastructure (ex-GAP-09) · notifications · Stripe billing |
| **P1** | GAP-FAL-003 credential broker (P0 only if a launch provider requires OAuth/cloud identity) · GAP-FAL-011 IdP console UX · GAP-FAL-010 remaining quota dimensions |

## 7. Next step

Unchanged in spirit, sharper in scope: the authoritative assessment was static (no live deployment exercised). Run the falcone-testing capability loop on the shared cluster (default context, Falcone namespace) against its "Covered/Partial" claims and the go/no-go list (§19) to convert them into verified evidence, then file the 15 suggested OpenSpec changes (`add-multi-provider-connection-registry`, `integrate-byok-with-workspace-secret-store`, `add-provider-credential-broker`, `add-model-capability-catalog`, native adapter set, `add-llm-provider-batch-execution`, `add-ai-usage-cost-ledger`, `add-tenant-fair-job-admission-queue`, `add-code-wiki-quota-dimensions`, `encrypt-sensitive-flow-payloads`, `complete-social-idp-management-console`, `define-large-task-worker-security-profile`) as CONFIRMED findings rather than assumptions.
