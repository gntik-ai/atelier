# Test plan
INIT SKELETON — merge, never overwrite, if a ledger already exists.
Status values: TODO / PASS / FAIL / REFUTED / BLOCKED.

## F0 — verification of the gap-analysis claims (docs/track-f/…GAP… §4-§11)

| # | Claim to verify | Ref | Status |
|---|---|---|---|
| A1 | Keycloak registration/email login/reset/remember-me configurable per tenant | §4.1 | TODO |
| A2 | Social IdP runtime works with configured providers | §4.1 | TODO |
| A3 | Social IdP create/edit deferred from console (backend routes exist) | GAP-FAL-011 | TODO |
| A4 | Account linking + duplicate-account protection end to end | §5 | TODO |
| A5 | Tenant/workspace lifecycle + server-side isolation scoping | §5 | TODO |
| A6 | Coarse tenant roles (owner/admin/developer/viewer gates) | §5 | TODO |
| A7 | Service accounts / OAuth applications usable | §5 | TODO |
| B1 | Flows: durable execution, retry, signals, child flows, triggers | §4.2 | TODO |
| B2 | Flow cancellation is tenant-scoped and graceful | §7 | TODO |
| B3 | Flow SSE node/log monitoring streams usable events | §7 | TODO |
| B4 | Flow quotas + lifecycle audit | §7 | TODO |
| B5 | Temporal history persists execution tokens (docs warning holds) | GAP-FAL-012 | TODO |
| C1 | PostgreSQL + document API CRUD with tenant scope | §4.3 | TODO |
| C2 | Object storage read/write per workspace | §4.3 | TODO |
| C3 | Kafka events emitted/consumable | §4.3 | TODO |
| C4 | Realtime delivery to clients | §10 | TODO |
| C5 | Signed + retried webhooks; flow triggers from webhooks | §6 | TODO |
| C6 | Scheduling (cron) primitives | §4.3 | TODO |
| D1 | Workspace secrets: write-only, metadata reads, rotation, redacted audit | §4.4 | TODO |
| D2 | LLM BYOK resolves operator-mounted BYOK_* env vars only (no self-service path) | GAP-AI-002 | TODO |
| E1 | workspace_llm_providers unique per (tenant,workspace) — single connection | GAP-FAL-001 | TODO |
| E2 | allowedModels + defaultModel enforced (empty list ⇒ nothing usable) | §8 | TODO |
| E3 | Provider record persists secretRef only; request-time resolution; SSRF guard | §8 | TODO |
| E4 | OpenAI-compatible /chat/completions + streaming works | §4.5 | TODO |
| E5 | llm.complete Flow activity works | §4.5 | TODO |
| E6 | Embedding provider configurable + used | §4.5 | TODO |
| E7 | pgvector KNN search with quotas | §4.5 | TODO |
| E8 | Re-index warning on embedding provider replacement | §8 | TODO |
| E9 | Token usage rollup exists but lacks run/stage/request/batch dimensions | GAP-FAL-007 | TODO |
| F1 | Plans/quotas framework operational | §11 | TODO |
| F2 | Audit infrastructure (flows, secrets) emits records | §11 | TODO |
| F3 | Backup/restore capability exercised | §11 | TODO |
| F4 | MCP hosting present and reachable | §10 | TODO |
| G1 | NO provider batch endpoints exist → enhancement add-llm-provider-batch-execution | GAP-FAL-006 | TODO |
| G2 | NO admission queue / user-visible position → add-tenant-fair-job-admission-queue | GAP-FAL-008 | TODO |
| G3 | NO model capability catalog/discovery → add-model-capability-catalog | GAP-FAL-005 | TODO |
| G4 | NO OAuth/cloud-identity credential broker → add-provider-credential-broker | GAP-FAL-003 | TODO |
| G5 | NO monetary cost/pricing ledger → add-ai-usage-cost-ledger | GAP-FAL-007 | TODO |
