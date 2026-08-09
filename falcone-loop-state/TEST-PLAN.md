# Test plan
Status values: TODO / PASS / FAIL / REFUTED / BLOCKED.

Run F0-1 — 2026-08-07. Context `default`, ns `in-falcone-staging`, commit 39ca71bb.

**Reading the verdicts.** A claim is PASS when evidence supports it, FAIL when
evidence contradicts it, REFUTED when the documented gap no longer exists,
BLOCKED when it could not be exercised here. Each row states whether code or
runtime was checked.

**Dominant environment fact (verifier-ruled ENVIRONMENT, not a defect).**
Helm release `falcone` (chart `in-falcone-0.3.1`, rev 16) ships
`controlPlaneExecutor=false`, `workflowWorker=false`, `temporal=false`,
`mcp=false`, and the release values never opt in. Staging is **deliberately
control-plane-only**: 8 deployments present = exactly the enabled set, no drift,
no ArgoCD app. So flows / LLM / embeddings / MCP / functions / data-plane APIs
are **not deployed here** — they are BLOCKED, *not* broken. Treating them as
platform failures would be wrong.

## F0 — verification of the gap-analysis claims (docs/track-f/…GAP… §4-§11)

> **SUPERSEDED — historical snapshot of run F0-1 (2026-08-07).** This table was written against a
> **control-plane-only** deployment (chart `in-falcone-0.3.1` rev 16), where executor, workflow-worker,
> Temporal, SeaweedFS and OpenBao were all switched off — which is why 15 rows read BLOCKED. Those
> BLOCKED verdicts describe the *environment of that run*, not the platform.
>
> **For current state, read instead:** the **Run F0-5** table (full topology, chart `in-falcone-0.4.1`
> rev 20) and the **F0-5 convergence pass**, which decomposes the compound rows into atomic
> PASS/FAIL sub-claims. Where the two differ, F0-5 wins.

| # | Claim to verify | Ref | Status | Evidence |
|---|---|---|---|---|
| A1 | Keycloak registration/email login/reset/remember-me configurable per tenant | §4.1 | PASS (code) / runtime BLOCKED | `PUT /v1/tenants/{id}/auth-config` allow-list is exactly `['registrationAllowed','loginWithEmailAllowed','resetPasswordAllowed','rememberMe','verifyEmail']` — `apps/control-plane/b-handlers.mjs:1496`. Route live (401). `REALM_BRUTE_FORCE_*` set on deployment. No credentials ⇒ no end-to-end run. |
| A2 | Social IdP runtime works with configured providers | §4.1 | BLOCKED | Tenant social-IdP surface is Keycloak-backed (`setSocialProvider` → `kc.upsertIdentityProvider`, `b-handlers.mjs:1509`). No provider configured in staging; no credentials to exercise. |
| A3 | Social IdP create/edit deferred from console (backend routes exist) | GAP-FAL-011 | **PASS — gap is real** | I initially called this REFUTED; **verifier CONFIRMED the gap and corrected me.** Falcone has *two* IdP surfaces. Tenant social IdP (what the doc means): `apps/web-console/src/services/authConfigApi.ts:75-77` states create/update is "intentionally NOT exposed by the console yet"; module exports only get/update-config/delete; `ConsoleAuthConfigPage.tsx:335` labels the card *"solo lectura"*. The full-CRUD `ConsoleAuthPage.tsx` I found is the **unrelated application-level federation surface** (Postgres JSONB, never reaches Keycloak). Gap stands. |
| A4 | Account linking + duplicate-account protection end to end | §5 | BLOCKED | Doc itself rates this "Needs validation/extension". Not exercisable without credentials. |
| A5 | Tenant/workspace lifecycle + server-side isolation scoping | §5 | PASS (partial) | Live: 1 tenant, 2 workspaces, 43 `saga_runs`; audit shows 20 `tenant.create`, 23 `workspace.create`, 19 `tenant.purge`, 15 `tenant.delete`, all `succeeded`. Isolation: 331 `SCOPE_INSUFFICIENT` rows in `scope_enforcement_denials`. Adversarial pen-test still outstanding (doc's own gate). |
| A6 | Coarse tenant roles (owner/admin/developer/viewer gates) | §5 | PASS (partial) | **CORRECTION (F0-3): my original evidence for this row was false.** I wrote that `scope_enforcement_denials` records `required_scopes`/`presented_scopes`/`missing_scopes`. The columns exist but are **always empty** — 0 of 340 rows carry scope data, because `recordRouteDenial` passes no arrays (`audit-writer.mjs:185-194`) and the only call site that could is a gateway plugin shipped disabled. The 331-denial count is also an undercount of unknown size (see #958). The role gates themselves *do* work — proven independently by the F0-2 isolation matrix — but not by the evidence I first cited. Per-role matrix not exercised. **Note:** verifier found `router.tsx:296` gates `ConsoleAuthPage` behind `RequireSuperadminRoute` while the backend permits `tenant_owner/admin` — a console/backend role mismatch. |
| A7 | Service accounts / OAuth applications usable | §5 | BLOCKED | `service_accounts` table exists, **0 rows**; route 401. `external_applications` present. Never exercised here. |
| B1 | Flows: durable execution, retry, signals, child flows, triggers | §4.2 | BLOCKED (not deployed) | `/v1/flows/...` → **503**; upstream `falcone-cp-executor` unresolvable (APISIX: `failed to parse domain … dns server error: 3 name error`). No Temporal cluster-wide. Chart disables both by default. Code exists (`apps/workflow-worker`, @temporalio/* 1.18.1). |
| B2 | Flow cancellation is tenant-scoped and graceful | §7 | BLOCKED (not deployed) | Same. |
| B3 | Flow SSE node/log monitoring streams usable events | §7 | BLOCKED (not deployed) | `2016-rt` realtime-SSE route → 503 unconditionally. |
| B4 | Flow quotas + lifecycle audit | §7 | BLOCKED (not deployed) | `quota_enforcement_log` has **0 rows**. |
| B5 | Temporal history persists execution tokens (docs warning holds) | GAP-FAL-012 | **PASS — gap is real** | `apps/workflow-worker/src/activities/execution-token.mjs:1-20`: control-plane "mints a short-lived token at flow start and carries it in the **workflow argument's tenant envelope**". Workflow arguments persist in Temporal history ⇒ credential material in history. Contradicts CLAUDE.md rule 5 (FAL-012). Code-level. |
| C1 | PostgreSQL + document API CRUD with tenant scope | §4.3 | BLOCKED (not deployed) | Corrected by verifier: `/v1/postgres/databases` and `/v1/mongo/databases` return **401** unauthenticated and **503 only with an `apikey: flc_*` header** (routes `2005-key`/`2006-key` match on that header). So the data plane is executor-owned and simply absent — not unconditionally broken. `workspace_databases`=2 provisioned, unused. |
| C2 | Object storage read/write per workspace | §4.3 | BLOCKED / not exercised | `/v1/storage/workspaces/{ws}/buckets` → 404 from control-plane. `workspace_buckets` = **0 rows**. SeaweedFS healthy; no workspace bucket ever provisioned. |
| C3 | Kafka events emitted/consumable | §4.3 | PASS (surface) / not exercised | `/v1/events/workspaces/{ws}/topics` → 401 (control-plane serves it). Kafka pod healthy. `workspace_topics` = **0 rows**. |
| C4 | Realtime delivery to clients | §10 | PARTIAL | `/v1/realtime/workspaces/{ws}/pg-captures` → 401 (control-plane, live). SSE change-stream → executor → 503 (not deployed). `pg_capture_configs` = 0 rows. |
| C5 | Signed + retried webhooks; flow triggers from webhooks | §6 | PASS (surface) | `/v1/webhooks/*` → 401. `packages/webhook-engine` present; `webhook_*` tables under a dedicated `falcone_webhook_schema` role — **4-role least-privilege split verified** (schema/writer/runtime/lifecycle; `permission denied` proves separation). Signing key configured (`MODE=legacy`, `MANAGED=false`). Flow triggers unreachable. |
| C6 | Scheduling (cron) primitives | §4.3 | **FAIL — verifier CONFIRMED (real bug)** | Root cause found: `apps/control-plane/server.mjs:131-138` `compilePath()` omits `*` from its escape class, so the two follow-up replacements (which search for an *escaped* `\*`) never fire and the raw `*` survives as a regex quantifier. `/v1/scheduling/*` compiles to `^\/v1\/scheduling\/*\/?$` — `/*` means "zero or more slashes". Result: `/v1/scheduling` → 401 (matches) but `/v1/scheduling/jobs`, `/config`, `/summary` → **404 `NO_ROUTE`**, identical via APISIX and direct-to-pod, auth-independent (matching precedes the auth gate). Handler present in image; no chart toggle gates scheduling. Black-box tests miss it because `tests/env/action-runner/routes.mjs:73` uses a hand-written regex instead of `compilePath`. Entire scheduling API family unreachable. |
| D1 | Workspace secrets: write-only, metadata reads, rotation, redacted audit | §4.4 | PASS (code) / BLOCKED (disabled here) — verifier: **ENVIRONMENT** | Implementation is real and complete (5 routes, tenant-isolation-before-role-gate ordering, metadata-only output). Backend is off by explicit config: chart default **and** staging values both `openbao.enabled: false`; no `BAO_*`/`VAULT_*` in the pod's 44 env vars. **I misread the corroboration** — the 18 `workspace.secret.list` audit rows with `outcome='error'` are all HTTP **501 `SECRETS_BACKEND_DISABLED`**, the documented graceful guard (`fn-handlers.mjs:527,563,593,609,622`); `outcomeFromStatus` maps any ≥500 to `error`. Zero 500s. Not a defect. The `vault-0` pod is a separate Helm release, never wired to Falcone. |
| D2 | LLM BYOK resolves operator-mounted BYOK_* env vars only (no self-service path) | GAP-AI-002 | **PASS — gap is real** | `byok-provider-guard.mjs:29-59`: key resolvable **only** from `process.env[name]` where name matches a reserved-prefix allow-list (default `BYOK_`); empty prefix explicitly filtered. No workspace-secret-reference path exists. |
| E1 | workspace_llm_providers unique per (tenant,workspace) — single connection | GAP-FAL-001 | **PASS — gap is real** | `llm-executor.mjs:214-224` `UNIQUE (tenant_id, workspace_id)`; `:247-258` `ON CONFLICT … DO UPDATE` (2nd provider **overwrites** the 1st); `:267-271` read is `LIMIT 1`; in-memory store keyed identically. Table absent from live DB (created lazily at executor start; executor never ran). Verifier verdict: see FINDINGS.md. |
| E2 | allowedModels + defaultModel enforced (empty list ⇒ nothing usable) | §8 | PASS (code) | `sanitizeProviderConfig` persists `allowedModels[]` + `defaultModel`; `llm-complete.mjs:16` maps violation to non-retryable 422 `MODEL_NOT_ALLOWED`. Runtime unverified. |
| E3 | Provider record persists secretRef only; request-time resolution; SSRF guard | §8 | PASS (code) | `sanitizeProviderConfig:176-185` strips `apiKey`/`secret`/`key`, persists `secretRef` only. SSRF guard: RFC1918/loopback/link-local/ULA/CGNAT/metadata blocklist + DNS-rebinding revalidation before fetch. |
| E4 | OpenAI-compatible /chat/completions + streaming works | §4.5 | BLOCKED (not deployed) | Code present (`llm-executor.mjs:63` posts OpenAI-style, parses SSE). `/v1/workspaces/{ws}/llm-provider` → 503. |
| E5 | llm.complete Flow activity works | §4.5 | BLOCKED (not deployed) | Activity present; worker not deployed, no Temporal. |
| E6 | Embedding provider configurable + used | §4.5 | BLOCKED (not deployed) | `/v1/workspaces/{ws}/embedding-provider` → 503. |
| E7 | pgvector KNN search with quotas | §4.5 | BLOCKED | No vector table in live DB; executor absent. |
| E8 | Re-index warning on embedding provider replacement | §8 | BLOCKED | Cannot trigger provider replacement. |
| E9 | Token usage rollup exists but lacks run/stage/request/batch dimensions | GAP-FAL-007 | **PASS — gap is real** | `llm-executor.mjs:326-338`: `workspace_llm_usage(tenant_id, workspace_id, model, prompt_tokens, completion_tokens, total_tokens, created_at)`; rollup `GROUP BY model` only. **No** run/stage/request/batch dimension, **no** monetary cost column. |
| F1 | Plans/quotas framework operational | §11 | PASS | Live: `plans`=2, `quota_dimension_catalog`=13, `tenant_plan_assignments` populated, 151 `plan_audit_events`. Full plan/quota route family live. `quota_enforcement_log`=0 (never triggered). |
| F2 | Audit infrastructure (flows, secrets) emits records | §11 | PASS (partial) | `plan_audit_events`=151, **hash-chained** (`prev_hash`/`row_hash`) ⇒ tamper-evident; `scope_enforcement_denials`=331 with correlation IDs. Flow audit absent (not deployed). Secret audit present but erroring (D1). |
| F3 | Backup/restore capability exercised | §11 | PASS (surface) / restore NOT exercised | `backup_scope_entries`=21 with RPO/RTO ranges, granularity, preconditions, air-gap notes; `/v1/admin/backup/scope` → 401. No restore performed. §19 item 10 open. |
| F4 | MCP hosting present and reachable | §10 | BLOCKED (not deployed) | `/v1/mcp/servers` → 503 (route `2018-mcp` → absent executor); chart `mcp=false`. `apps/mcp-runtime` + `packages/mcp-server-sdk` exist. Related open issues #933, #935. |
| G1 | NO provider batch endpoints exist → add-llm-provider-batch-execution | GAP-FAL-006 | **PASS — absence confirmed** | `grep -rniE 'provider.*batch\|batch.*provider\|/v1/.*batches' apps packages` (excl. tests) → **0 matches**. |
| G2 | NO admission queue / user-visible position → add-tenant-fair-job-admission-queue | GAP-FAL-008 | **PASS — absence confirmed** | `grep -rniE 'queue_?position\|admission_?queue\|aheadCount\|admissionRank\|fair.?admission' apps packages` → **0 matches**. |
| G3 | NO model capability catalog/discovery → add-model-capability-catalog | GAP-FAL-005 | **PASS — absence confirmed** | `grep -rniE 'model_?catalog\|modelCatalog\|capabilityRegistry\|contextWindow\|maxOutputTokens' apps packages` → **0 matches**. |
| G4 | NO OAuth/cloud-identity credential broker → add-provider-credential-broker | GAP-FAL-003 | **PASS — absence confirmed** | `grep -rniE 'credential_?broker\|refresh_?token.*provider\|provider.*oauth\|workload_?identity' apps packages` → **0 matches**. |
| G5 | NO monetary cost/pricing ledger → add-ai-usage-cost-ledger | GAP-FAL-007 | **PASS — absence confirmed** | `grep -rniE 'cost_?ledger\|price_?per_?token\|unit_?price\|costUsd\|monetary' apps packages` → **0 matches**. |

### Tally (34 rows)
PASS 17 · FAIL 1 · BLOCKED 15 · PARTIAL 1 · REFUTED 0

Every "gap is real" row (A3, B5, D2, E1, E9, G1-G5) **validates** the gap
analysis — the document holds up well under test. Exactly **one** genuine
platform defect was found in this run: C6, the `compilePath()` wildcard bug.
Everything else that looked broken turned out to be a deliberately disabled
component (verifier-ruled ENVIRONMENT) or my own misreading.

## §19 go/no-go items checkable on the cluster

> **SUPERSEDED for criteria 1–8 — historical snapshot of run F0-1 (2026-08-07).** This table was
> written against the **control-plane-only** deployment. Criteria 1–8 were re-rated on the full
> topology in **Run F0-6** (below); where the two differ, F0-6 wins. Criteria 9–15 have **not** been
> re-rated — the F0-6 slice that owned them did not complete, so the rows below remain the current
> record for those, with all their F0-1 caveats.

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Supported release/build for the beta environment | NOT VERIFIABLE HERE | Chart `in-falcone-0.3.1` *supports* the full topology; staging simply does not enable it. Says nothing about beta-readiness of the build. |
| 2 | Tenant isolation tested across all resources used by the product | **NO-GO** | Scope enforcement demonstrably active (331 denials), but flows/storage/data/LLM are not deployed here, so "across all resources" is untested — and no adversarial test was run. |
| 3 | Credentials self-service, write-only, rotated, revocable, never in workflow history | **NO-GO** | Self-service absent (D2); secrets backend disabled in staging (D1); execution token rides in Temporal workflow args (B5). |
| 6 | At least two LLM connections can coexist in one workspace | **NO-GO** | Schema forbids it (E1). |
| 8 | Batch mode correct for every advertised provider | **NO-GO** | No batch implementation at all (G1). |
| 9 | Queue position honest and tenant-fair | **NO-GO** | No admission queue at all (G2). |
| 10 | Snapshots/artifacts/indexes have tested deletion and restore | **NO-GO** | Backup scope catalog exists; no restore exercised (F3). |
| 13 | Cost estimates, usage, budget blocks, retry/batch accounting tested | **NO-GO** | No cost ledger (G5); usage lacks dimensions (E9). |
| 14 | Audit and support diagnostics contain no secrets | PARTIAL-GO | Redaction verified in code (`tenant-config-export.mjs`, `routes.mjs:60`, `b-handlers.mjs:691`); audit hash-chained. Not runtime-verified. |

Items 4, 5, 7, 11, 12, 15 are product-domain or process items — not checkable on
this cluster in this run.

## Observation carried forward (not filed)

The hand-applied `falcone-apisix-standalone` ConfigMap (applied
`kubectl-client-side-apply`, 2026-06-23) advertises **10 executor-bound routes**
into a control-plane-only deployment, so those paths fail as a bare APISIX 503
HTML page rather than a structured platform error. The verifier ruled this an
environment/setup mismatch, outside the scope of the candidate defect. It is a
reasonable hardening candidate but was **not** filed as a bug.


---

# Run F0-2 — 2026-08-08 — AUTHENTICATED pass

The operator supplied superadmin credentials and the public URL, which unblocked
everything F0-1 recorded as BLOCKED-for-credentials. Endpoint: the ingress
`falcone-in-falcone-public` in `in-falcone-staging` serves `baas.musematic.ai`,
`api.baas.musematic.ai`, `iam.baas.musematic.ai`, `realtime.baas.musematic.ai`
— the agreed namespace, so safety held. (The URL given was `baaas` with three
a's; that host is NXDOMAIN. The live host is `baas`.)

Credentials live only in an untracked scratchpad file at mode 0600, outside the
repo tree. Nothing credential-bearing was written to git.

## Revised verdicts (supersede F0-1 where they differ)

| # | Claim | Status | Evidence |
|---|---|---|---|
| A1 | Tenant auth config (registration/email login/reset/remember-me/verify) | **PASS (live)** | `GET /v1/tenants/{id}/auth-config` → 200 `{registrationAllowed:false, loginWithEmailAllowed:true, resetPasswordAllowed:true, rememberMe:true, verifyEmail:false, identityProviders:[]}` — exactly the five documented flags, on the tenant's own realm. `GET /v1/auth/signups/policy` → `{selfServiceEnabled:true, mode:"self_service", passwordPolicy:{minLength:8}}`. |
| A2 | Social IdP runtime | **BLOCKED (nothing configured)** | `identityProviders: []` on every tenant — no provider exists to exercise. Not a defect; the capability is simply unconfigured here. |
| A4 | Account linking + duplicate-account protection | **BLOCKED (upstream defect)** | Cannot be tested: tenant-realm users cannot obtain a session at all (see #953). |
| A5 | Tenant/workspace lifecycle + isolation | **PASS (live, end to end)** | Created 2 tenants → each provisioned its **own Keycloak realm** named by tenant UUID (realm-per-tenant confirmed), then a workspace in each (201), users in each realm (201), a service account (201) and a topic (201). Full provisioning chain works. |
| A6 | Coarse tenant roles | **PASS (live)** | See the isolation matrix below — a tenant-scoped principal is denied every cross-tenant and every platform-admin route. |
| A7 | Service accounts / OAuth applications | **PASS (live)** | `POST /v1/workspaces/{ws}/service-accounts` → 201, bound to a Keycloak client **in the tenant's realm** (`sa-<ws>-<name>`), with `credentialStatus`, `accessProjection`, and expiry. `POST .../credential-issuance` → 201 issuing a `client_credentials` secret; that credential really works — it minted a token at the tenant realm. |
| C3 | Kafka events | **PARTIAL → read path suspect** | Create topic → 201 with tenant-scoped physical name `evt.<workspaceId>.<topic>` (isolation by naming). Publish → **202** `{status:"accepted", acceptedPartition:0, offset:"0"}` ×3. **Consume → `{"items":[]}` every time** (5 polls; also with `fromBeginning`, `offset=0`, `partition=0&offset=0`). Kafka itself holds the records: `kafka-get-offsets.sh` reports `evt.<ws>.f0v1-topic:0:3`. Publish works, read path returns nothing. Verifier verdict pending. |
| F1 | Plans/quotas | **PASS (surface) — with a caveat** | `/v1/plans` → 200 (2 plans, both `draft`); `/v1/quota-dimensions` → 200 (13 dimensions). **Caveat:** tenant creation accepts `planId` and returns 201, but `GET /v1/tenants/{id}/plan` then reports `{"noAssignment":true}` — and the pre-existing `default` tenant reports the same, so no tenant on this deployment has a plan assignment. Not yet verified as a defect. |
| F3 | Backup scope | **PASS (live)** | `GET /v1/tenants/{id}/backup/scope` → 200 with `activeProfile:"standard"` and real component entries. `planId:"unknown"` (consistent with the F1 caveat). Restore still never exercised. |
| **P25** | Web console, superadmin persona | **PASS (live, browser)** | Chrome + Playwright against `https://baas.musematic.ai/login`: superadmin logs in, redirects to `/console/overview`, renders a full admin shell with a "Superadmin" badge, org/workspace context selectors and **28 nav sections**. **Zero HTTP ≥400 and zero console/page errors** across `/console/{overview,tenants,workspaces,plans,auth,members,iam-access}`. Screenshot: `p25-02-postlogin.png`. |
| **P27** | Web console, DevOps persona | **PASS (live, browser) — 1 defect found** | Selected org `f0v1-a` and workspace `f0v1-ws-a` from the context selectors; both applied and every page then showed the active context. Walked 12 operational routes (overview, tenants, workspaces, members, my-plan, tenant-auth, auth, observability, operations, kafka, postgresql, storage) — all rendered. Exactly **one** failing request in the whole walkthrough: `404 GET /v1/iam/realms/{realm}/scopes?page[size]=100` (see below). The nav is also honest about the partial topology, labelling functions "ejecución pendiente del plano de datos". |
| **P26** | Developer building on the BaaS | **BLOCKED** | The developer journey needs a tenant user session, which #953 makes impossible. Data-plane APIs are also executor-gated (not deployed). |

## Adversarial tenant-isolation matrix (§19 item 2) — **PASS**

Principal: a service-account token minted at **tenant A's own realm** (a genuinely
tenant-scoped principal, not superadmin).

| Target | Result |
|---|---|
| own `/v1/tenants/{A}` | 200 |
| own `/v1/workspaces/{wsA}/applications` | 200 |
| own `/v1/tenants/{A}/users`, `/v1/workspaces/{wsA}`, `/service-accounts` | 403 (least privilege — SA lacks those scopes) |
| **cross** `/v1/tenants/{B}`, `/users`, `/backup/scope`, `/quota/overrides` | **403** |
| **cross** `/v1/workspaces/{wsB}`, `/service-accounts` | **403** |
| **cross** `/v1/workspaces/{wsB}/applications` | **404 — no existence leak** |
| **platform-admin** `/v1/tenants`, `/v1/plans`, `/v1/admin/backup/scope` | **403** |

Not one cross-tenant or platform-admin read succeeded. Denials are audited to
`scope_enforcement_denials` with **templated** paths (`/v1/tenants/{tenantId}` —
no tenant id leaked into the audit record).

**Audit-coverage gap observed:** 12 denials were issued but only **7** were
logged. The superadmin-gated routes (`/v1/tenants` list, `/v1/plans`,
`/v1/admin/backup/scope`, `/v1/tenants/{id}/backup/scope`,
`/v1/tenants/{id}/quota/overrides`) denied **without** writing a denial record.
`missing_scopes` is also empty on every row, which weakens diagnosability.
Recorded as an observation — not yet verifier-ruled.

## New findings this run

| Finding | Verdict | Issue |
|---|---|---|
| Tenant-realm users cannot log in — signup creates in the tenant realm, login authenticates against the platform realm | **CONFIRMED (verifier)** — severity critical | #953 |
| Events published to Kafka (202, offset assigned, records present at offset 3) are never returned by the consume API | verifier pending | — |
| Console calls `/v1/iam/realms/{realmId}/scopes`, which the control plane does not route (22 IAM routes, none for scopes) | verifier pending | — |
| Tenant creation accepts `planId` but leaves the tenant with `noAssignment: true` | not yet verified | — |
| Service-account credential issuance returns `tokenEndpoint: http://falcone-keycloak:8080/...` — an **internal cluster URL** unusable by any external consumer | not yet verified | — |
| Workspace `environment` accepts `dev/staging/prod/sandbox/preview`, but the gap analysis and docs describe stages as `development/staging/production` | doc/API mismatch | — |

---

# Run F0-3 — 2026-08-08 — pending-slice closure

Picks up the three items COVERAGE.md listed as outstanding and actionable:
quota enforcement, backup/restore, and the unverified observations from F0-2.

## Quota enforcement — **PASS (F1 upgraded from "surface" to verified end to end)**

F0-1 recorded `quota_enforcement_log` = 0 rows and flagged that no quota had ever
tripped. It now has, and the behaviour is correct.

Created tenant `f0v3q` and created workspaces until refused:

```
workspace 1 -> 201
workspace 2 -> 201
workspace 3 -> 201
workspace 4 -> 402  {"code":"QUOTA_EXCEEDED",
                     "message":"workspace quota reached (max_workspaces): 3/3"}
```

Recorded correctly in `quota_enforcement_log`:

| dimension_key | attempted_action | current_usage | effective_limit | quota_type | source | decision |
|---|---|---|---|---|---|---|
| max_workspaces | workspace.create | 3 | 3 | hard | **default** | hard_blocked |

**The important result is `source=default`.** This tenant has *no plan assignment*
(`noAssignment: true`) and `effectiveLimits: []`, yet a hard limit was still
enforced. The platform **fails closed** when no plan is in force rather than
granting unlimited resources — the safe behaviour, and worth recording explicitly
because the empty `effectiveLimits` response initially suggested the opposite.

**One inconsistency (candidate, unverified):**
`GET /v1/tenants/{id}/quota/effective-limits` returns `{"noAssignment":true,
"effectiveLimits":[]}` while a `max_workspaces` limit of 3 is demonstrably in force
from `source=default`. An operator cannot see the limits that actually apply.
`GET /v1/tenants/{id}/plan/consumption` likewise reports most dimensions as
`usageStatus:"unknown"`, `usageUnknownReason:"NO_QUERY_MAPPING"`.

## Backup / restore (§19 item 10) — verifier verdict pending

Correcting my own first read: restore **is** implemented. `packages/backup-status/src`
ships `initiate-restore`, `confirm-restore`, `trigger-restore`, `trigger-backup`,
`list-snapshots`, `get-operation`, `query-audit` and `restore-simulation.service`,
with `OperationType = 'backup' | 'restore'`. My initial grep filtered to `.mjs` and
missed the TypeScript.

The problem is reachability. `route-map.json` declares only 4 backup paths — none of
them an operations/restore route — and the **deployed** runtime map has 3 of those.
Live as superadmin, every operations path 404s while the scope matrix returns 200:

```
/v1/backups/status  /v1/backups/snapshots  /v1/backups/operations
/v1/admin/backup/{operations,restore,trigger}
/v1/tenants/{id}/backup/{snapshots,restore}          -> all 404
/v1/admin/backup/scope                               -> 200 (real data)
```

**Verifier verdict: ENVIRONMENT — not filed.** And it corrected me twice.

1. **My probe paths were mostly wrong.** I guessed plural `/v1/backups/*` and invented
   `/v1/admin/backup/{restore,trigger}`. The authoritative paths come from
   `deploy/gateway-config/routes/backup-*-routes.yaml` and are **singular**
   `/v1/backup/{status,snapshots,trigger,restore,operations/*,audit}`, all with
   `openwhisk-*` upstreams. Probing the derived paths gives the same 404s, so the
   conclusion survives — but my evidence was guesswork.
2. **My §19 item 10 linkage was a category error.** Item 10 covers *product* content —
   repo source snapshots, generated wiki pages, vector indexes, generation histories.
   `packages/backup-status` is *component-level infrastructure DR* (Postgres, Kafka,
   Keycloak, Mongo, S3). Item 10 remains NO-GO here, but **not because backup-status is
   unrouted**, and my "high for release-readiness" severity rested on that bad linkage.

Why ENVIRONMENT rather than a defect: `backup-status` has **no chart toggle at all** — no
values key, no template, no Dockerfile, no image, no workload, and it is absent from
`/repo/packages/` in the running pod. It is an OpenWhisk-hosted service this chart cannot
deploy. That is categorically different from `controlPlaneExecutor`/`workflowWorker`/
`temporal`/`mcp`, which are first-class components deliberately set `false` and which
answer **503**; backup routes answer **404** because they were never built in. Also ruled
out: #952's `compilePath` wildcard bug cannot explain these 404s (no bare-prefix match
anywhere, so no wildcard route is loaded at all).

The one live surface, `GET /v1/admin/backup/scope`, is a **static catalog, not an
operational capability** — every entry reports `operationalStatus: "unknown"`, and Kafka
reads `backupGranularity: "none"`, *"Platform does not manage Kafka backup; operator
responsibility"*.

**Two repo-hygiene defects recorded, not filed** (neither is a live failure):
1. `route-map.json` declares `GET /v1/backups/status → packages/backup-status/...js`, a
   route the control plane can never serve — same class as #954.
2. Path inconsistency: gateway config and the console client
   (`apps/web-console/src/services/backupStatusApi.ts:49`) use **singular**
   `/v1/backup/status`; `route-map.json` and the test harness use **plural**
   `/v1/backups/status`. Whichever surface ships first will mismatch.

---

# Run F0-R1 — 2026-08-08 — regression + health slice

Full topology for the first time (chart `in-falcone-0.4.1` rev 20). Rows below supersede
their F0-1/F0-2 equivalents where they differ.

| # | Claim | Status | Evidence |
|---|---|---|---|
| A1 | Tenant auth config | **PASS (live)** | Unchanged from F0-2. `GET /v1/auth/signups/policy` → 200 `{selfServiceEnabled:true, mode:"self_service", passwordPolicy:{minLength:8}}`. |
| A4 | Account linking / duplicate protection | **BLOCKED (product defect)** | Still gated by #953 — re-confirmed critical this run; no supported path to a tenant-user session exists. |
| B1 | Flows: durable execution, retry, signals | **FAIL (unreachable)** | Upgraded from BLOCKED. Temporal 1.31.1 live, namespace `falcone-flows` registered, both workers polling `flows-main` — and `CountWorkflowExecutions` = **0**, ever. `/v1/flows/workspaces/{ws}/flows` → 401 for every principal (falcone-charts#13). The substrate is ready; the door is locked. |
| B5 | Execution token in Temporal history | **PASS — gap is real** | #951 re-confirmed against live Temporal: no PayloadCodec/DataConverter anywhere in chart rev 20 or the repo. Would place the token in cleartext history the instant a workflow runs. |
| C1 | Postgres + document API CRUD | **FAIL (partial)** | Upgraded from BLOCKED. Provision → 201, reads → 200, **writes impossible**: control-plane mongo routes are all GET/export/import; the executor's write route is 401-walled. Also: provisioned DBs can never be deleted (#967). |
| C2 | Object storage read/write per workspace | **PASS (live, end to end)** | Upgraded from BLOCKED/not-exercised. First workspace bucket ever provisioned here; 2048-byte object round-tripped sha256-exact; delete verified. One defect found: lossy `content` field (#966) — **CLOSED, verifier CONFIRMED-FIXED, `192c8cd0`…`cf4f8a45`**; the write half found later (#994) is closed by the same commits. |
| C3 | Kafka events emitted/consumable | **FAIL** | #955 re-confirmed: clean step function at the 3000 ms tie (≤3000 → 0 items, ≥3200 → all 3); `limit`/`offset`/`partition`/`fromBeginning` still silently ignored; 1:1 consumer-group leak. |
| C5 | Signed + retried webhooks | **FAIL** | #957 re-confirmed: superadmin 500, service account 404. Unusable for every obtainable principal. |
| C6 | Scheduling (cron) primitives | **FAIL** | #952 re-confirmed; deployed image byte-identical to HEAD; still the only wildcard route of 70. |
| D1 | Workspace secrets | **PASS (live)** | **Upgraded from ENVIRONMENT-disabled.** OpenBao wired in 0.4.1; create/list/get/delete round-trip works and reads carry no plaintext `value`. |
| D2 | BYOK resolves operator env only | **PASS — gap is real** | #938: the secret store is now live, but BYOK still resolves only `env[secretRef.name]` behind the `BYOK_` allow-list. Store working ≠ gap closed. |
| E1 | Single provider per workspace | **PASS — gap is real** | 4-layer constraint unchanged; live probe blocked by falcone-charts#13, code evidence dispositive. |
| E4/E6 | LLM completions / embedding provider | **FAIL (unreachable)** | Upgraded from BLOCKED. Routes exist and are registered; 401 for superadmin, tenant-realm SA and apikey alike. |
| E7 | pgvector KNN search | **BLOCKED (environment)** | `falcone-postgresql-vector-0` unschedulable — PVC requests storage class `hcloud-volumes`, absent on this cluster. Operator values issue, ruled ENVIRONMENT, not filed. |
| F4 | MCP hosting present and reachable | **FAIL (unreachable)** | Upgraded from BLOCKED. `/v1/mcp/*` registered on the executor, 401 for every principal. |
| P26 | Developer building on the BaaS | **BLOCKED** | Now doubly blocked: #953 (no tenant session) *and* falcone-charts#13 (no data-plane access even with one). |

## What "unreachable" means here, and why it is worse than "not deployed"

F0-1 correctly recorded the executor-owned surface as BLOCKED because the components did not
exist — a topology fact, not a defect. That is no longer the situation. The components are
deployed, healthy, and registered at the gateway, and every one of their routes rejects every
principal because the chart never gave the executor its Keycloak OIDC configuration
(falcone-charts#13). A capability that is shipped and claimed but reachable by nobody is a
worse state than one that is honestly absent, and it is the single highest-leverage fix on the
board — ahead of #953.

## New capability surface discovered this run

Executor routes (all currently 401-walled): `/v1/flows/workspaces/{ws}/{flows,schedules,task-types}`,
`/v1/flows/triggers/webhooks/{id}` (**HMAC-authenticated per-trigger secret, not OIDC** — likely the
one flows entry point *not* blocked by falcone-charts#13; worth a dedicated slice),
`/v1/workspaces/{ws}/{llm/completions,llm-usage,embedding-provider}`, `/v1/realtime/workspaces/...`
change streams for both Postgres tables and Mongo collections.

Control-plane: `POST /v1/workspaces/{ws}/databases` — engine-dispatched provisioning
(`postgresql|mongodb`), the only route that creates a Mongo database. Full service-account
credential lifecycle (`credential-issuance` / `-rotations` / `-revocations`). Storage extras:
multipart upload, presign, credential rotate/revoke, bucket export/import.

## Positive security results worth recording

- Gateway identity headers are **not spoofable**: `x-tenant-id`/`x-workspace-id` supplied by a
  client (with and without a bearer) are stripped and rejected — 401, no bypass.
- Service-account credential **revocation takes effect immediately** (revoked SA's credential → 401).
- The executor's auth failure is **fail-closed** — every `resolveIdentity` branch that cannot
  establish identity returns `{tenantId: undefined}`; no fail-open path exists.

---

# Run F0-5 — 2026-08-08 — gap-analysis claim re-verification on the FULL topology

Context `default` (pinned `--context default` on every call), ns `in-falcone-staging`,
commit `39ca71bb`, chart `in-falcone-0.4.1` helm rev 20.

**Why re-run F0-1's slice.** F0-1 judged these claims against a control-plane-only deployment and
had to mark 15 rows BLOCKED. The topology is now complete (executor x2, workflow-worker x2,
Temporal, SeaweedFS, OpenBao), so most of those rows became testable for the first time.

## A — identity, tenancy, collaboration (§4.1, §5)

| # | Claim | F0-5 verdict | Evidence |
|---|---|---|---|
| A1 | Per-tenant Keycloak auth config | **PASS (upgraded — proven into Keycloak)** | PUT flipped all 5 flags; realm X's login page then showed a registration link, **no** reset link, **no** rememberMe box, label `Username`; untouched realm Y showed the inverse and `Username or email`. Allow-list holds: `bruteForceProtected:false` + `sslRequired:"none"` were silently ignored — realm stayed `bruteForceProtected: true`, `sslRequired: external`. |
| A2 | Social IdP runtime | **PASS — exercised for the first time in the campaign** | Configured a dummy OIDC IdP, followed the broker link: `303 → https://idp.example.invalid/authorize?...client_id=…&redirect_uri=…/broker/f0v5a-oidc/endpoint&state=…&nonce=…`. Real brokering. Deleted after. |
| A3 | Console create/edit deferred, backend exists | **PASS — gap real**, and the backend half is now *proven working* (A2), not merely asserted | `authConfigApi.ts:75-77`. → refreshed #950 |
| A4 | Account linking + duplicate protection | **DECOMPOSED → A4a PASS · A4b FAIL** (was PARTIAL; see the convergence pass below) | Duplicate protection works (`duplicateEmailsAllowed:false`; duplicate email and username → 409). Linking runs on Keycloak defaults (`trustEmail:false`, `linkOnly:false`, no `firstBrokerLoginFlowAlias`) and the platform exposes **no** control over them — `kc-admin.mjs:261` hardcodes 5 fields. Matches the doc's own "needs extension". |
| A5 | Org/workspace lifecycle + isolation | **PASS** | Full create→provision→purge; purge removed 3 workspaces, 3 DBs, 2 realms, 4 buckets, 3 topics; 0 rows across 8 tables after. |
| A6 | Coarse tenant roles | **PASS with a scoping gap** — first per-role matrix in the campaign | owner/admin full own-tenant read+write; developer/viewer 403 on all tenant-admin reads and every write; all 4 roles 403 cross-tenant, 403 platform-admin, 403 on own-tenant DELETE. **Unblocked by discovering tenant users authenticate via the per-tenant `<slug>-app` client — #953 is a console-flow defect, not a realm defect.** Scoping gap → #973. |
| A7 | Service accounts / OAuth applications | **SPLIT: service accounts PASS · OAuth applications FAIL** | The §5 row bundles two capabilities on the strength of a *listing*. Service accounts verified live (201 + real Keycloak client + working credential). OAuth applications → #969. **This corrects F0-2's A7 "PASS (live)", whose evidence exercised service accounts only.** |
| A8 | Invitation and membership audit | **FAIL** | Write-only stub; no list/get/accept/revoke route exists and the record is never read → #975. Creation is also unaudited → #971. |
| A9 | Support access controls | **FAIL — nothing exists** | `platform_break_glass` is declared in `authorization-model.json:218` (requires `reason_code`, optional `ticket_ref`, rule `deny_break_glass_without_reason`) with **0 runtime references**. The one runtime hit is a reserved-role-name blocklist (`postgresql-admin.mjs:53`). No grant endpoint, no TTL, no expiry, no audit. |

**§19 item 2 — adversarial cross-tenant matrix: PASS.** ~60 probes both directions across tenants ·
workspaces · users · auth-config · IdPs · invitations · service accounts · storage buckets+objects ·
secrets · topics · databases · flows. **Zero cross-tenant reads/writes/deletes succeeded; zero marker
leaks.** 403 for tenant-addressed routes, 404 for bare-id resources, and cross-tenant 404s are
byte-identical to nonexistent-id 404s — **no existence oracle**. Tenant isolation is the strong
boundary and it holds. The *workspace* tier is where it fails (#973).

## B — durable workflows (§4.2, §7)

| # | Claim | F0-5 verdict | Evidence |
|---|---|---|---|
| B1 | Durable execution, retries, branches, timers, signals, child flows, triggers | **DECOMPOSED → B1a/B1b PASS · B1c/B1d/B1e FAIL** (was PARTIAL; see the convergence pass below) | Definition plane PASS: all 7 node types, create/list/get/update/delete/validate/publish/versions work; semantic validation fires correctly (`FLW-E001/E003/E006/E008` → 422). Execution plane FAIL: `POST .../executions` → **503 TEMPORAL_UNAVAILABLE**. |
| B2 | Cancellation tenant-scoped and graceful | **DECOMPOSED → B2a PASS · B2b FAIL** (was PARTIAL; see the convergence pass below) | Tenant scoping PASS (`403 CROSS_TENANT_VIOLATION`; viewer write → 403). "Graceful" unverifiable — no execution can exist. |
| B3 | Flow SSE node/log monitoring | **DECOMPOSED → FAIL** (was BLOCKED; see the convergence pass below) | Route registered (`server.mjs:721`, `{sse:true}`); no run can exist. |
| B4 | Flow quotas + lifecycle audit | **FAIL — verifier CONFIRMED both halves** | Quotas: **0 of 5 declared flow dimensions enforced**; 29 versions published against a limit of 20, zero 429s; the gate is constructed `undefined` and the evaluator endpoint it calls **does not exist** (dead code, no route) → #988, distinct from #962. Audit: topic `falcone.audit.flow-lifecycle` absent, auto-create disabled by chart policy, nothing in either repo provisions it ⇒ **zero flow audit records can exist in any deployment** → charts#21. |
| B5 | Execution tokens persist in Temporal history | **PASS — gap real, now DEMONSTRATED LIVE** | Token decoded out of persisted history with no key and no codec. → refreshed #951 |
| B6 | Queue durability | **PASS** | `describeTaskQueue(flows-main)`: 2 WORKFLOW + 2 ACTIVITY pollers; namespace `falcone-flows` registered, retention 604800s. |
| B7 | Run entity + durable orchestration, version pinning | **DECOMPOSED → B7a PASS · B7b FAIL** (was PARTIAL; see the convergence pass below) | Version pinning PASS (47 immutable versions, `flowVersion` search attribute, start pins `pinned.version`). Durable orchestration **UNPROVEN**: `CountWorkflowExecutions` = **0, ever**. |
| B8 | Server-stamped tenant search attributes | **PASS** | All five registered and queryable; `tenantId="…"` → 1, different tenantId → 0. Built from the *verified identity*, never client input (`flow-executor.mjs:745-753`). |

## C — storage, events, realtime, functions, data (§4.3, §6, §10)

| # | Claim | F0-5 verdict | Evidence |
|---|---|---|---|
| C1 | Postgres + document API CRUD | **DECOMPOSED → C1a/C1b/C1c PASS · C1d/C1e FAIL** (was PARTIAL; see the convergence pass below) | A write path exists and works: `POST …/mongo/…/collections/default/imports` → 200, docs read back. But it is **append-only bulk import, not CRUD** — per-document POST/PUT/PATCH/DELETE are 404 (cp) / 401 (exec). Postgres plane is read-only for every reachable principal. Isolation holds (own physical `wsdb_*`). |
| C2 | Object storage read/write | **PASS (byte-exact)** | 2 KB raw PUT → GET `contentBase64` sha256 MATCH; usage metering live. |
| C3 | Kafka events emitted + consumable | **PASS — with a defective default** | Ground truth `…:0:3`. `timeoutMs=3000` → `[]`; **`8000` and `15000` return all 3 records.** The capability works; the default is the defect (#955). |
| C4 | Realtime delivery | **DECOMPOSED → C4a PASS · C4b/C4c/C4d FAIL** (was PARTIAL; see the convergence pass below) | `features.realtime:false`; `pg-captures` 401; `mongo-captures` / change-streams **404 NO_ROUTE**. The one working realtime path is the **events SSE stream** (below). |
| C5 | Signed + retried webhooks | **FAIL (#957, no drift)** | `GET/POST /v1/webhooks/subscriptions` → 500; root cause in logs: `WebhookSigningSecretWriteError … requireScope (webhook-db.mjs:112)`. |
| C6 | Scheduling (cron) | **FAIL (#952, no drift)** | `/v1/scheduling` 401 but `/jobs`,`/config`,`/summary` 404. The alternative — functions `cron-/kafka-/storage-triggers` — is **also 404**. No working scheduling primitive exists anywhere. |
| C7 | Functions incl. production Knative path | **PASS (sync exec) / PARTIAL overall** | Real Knative `ksvc` + 2/2 pods; blocking invocation executed JS and returned a correct result. **Production Knative path CONFIRMED.** But trigger/rule/cron automation is 404, and cross-tenant network isolation fails → #972. |
| C8 | Source-snapshot object storage | **PASS** | 3 MiB raw and 6 MiB two-part multipart both sha256-exact; `Range: bytes=0-99` → 206 correct; presign → 200. |
| C9 | Webhook deduplication / idempotency | **REFUTED as a reachable primitive** | Flows OpenAPI advertises `Idempotency-Key` (24 h replay, `X-Idempotency-Replayed`), but **no APISIX plugin and no server middleware implement it**. Two identical keyed POSTs both executed (offsets 64 and 65), no replay header. |
| C10 | Notification event transport | **DECOMPOSED → C10a/C10b PASS · C10c/C10d FAIL** (was PARTIAL; see the convergence pass below) | Kafka + SSE PASS; the delivery and timing legs a notification system needs — webhooks (#957) and scheduling (#952) — are the broken ones. |

## D/E — secrets, LLM, embeddings (§4.4, §4.5, §8)

| # | Claim | F0-5 verdict | Evidence |
|---|---|---|---|
| D1 | Workspace secrets write-only, OpenBao-backed | **DECOMPOSED → D1a–D1e PASS · D1f–D1i FAIL** (was PARTIAL; see the convergence pass below) | Full round trip green; value proven in OpenBao and **absent from all 18 Postgres DBs**. But resolved values are re-materialized as plaintext into Knative objects (#970), rotation/delete are unaudited (#971/#974), and the backend's Kubernetes auth is broken (falcone-charts#14). |
| D2 | BYOK env-only, no self-service | **PASS — gap real** | Unchanged at HEAD. → refreshed #938 |
| E1 | One provider per workspace | **PASS — gap real (live DDL)** | `workspace_llm_providers_tenant_id_workspace_id_key UNIQUE btree (tenant_id, workspace_id)`. **`workspace_embedding_providers` carries the identical constraint** — gap is wider than written. → refreshed #937 |
| E2 | allowedModels fails closed | **DECOMPOSED → E2a PASS · E2b FAIL** | `llm-executor.mjs:411-420`; empty list means nothing permitted. Caveat: no config-time validation — `allowedModels: []` with a non-member `defaultModel` saves 200 then 422s every completion. |
| E3 | secretRef only + SSRF guard | **PASS — SSRF proven live** | **19/20 blocked**: loopback, `localhost`, `[::1]`, `169.254.169.254`, decimal `2852039166`, hex `0xa9fea9fe`, 10/8, 192.168/16, 172.16/12, CGNAT, ULA, link-local, `::ffff:127.0.0.1`, `0.0.0.0`, in-cluster, `file:`/`gopher:`, and a DNS-rebind resolving to the metadata IP. Not blocked: multicast/broadcast; no port restriction. |
| E4 | OpenAI-compatible completions + streaming | **DECOMPOSED → FAIL** (was BLOCKED; see the convergence pass below) | Code correct; route 401 for every principal. Endpoint used as-is — `/chat/completions` never appended. |
| E5 | `llm.complete` Flow activity | **DECOMPOSED → E5a PASS · E5b FAIL** | `catalog.mjs:32`; worker polling. No business flow has ever executed. |
| E6 | Embedding provider | **FAIL (unreachable)** | 401 for superadmin *and* tenant-realm SA; control test: same SA gets 200 on a control-plane route. |
| E7 | pgvector / vector search + KNN | **REFUTED as "Covered foundation"** | Three independent failures; capability dead by construction → #983. |
| E8 | Re-index warning on provider replacement | **DECOMPOSED → E8a PASS · E8b FAIL** | `embedding-executor.mjs:94-98`. Fires on *any* pre-existing row; nothing blocks a dimension change that silently invalidates stored vectors. **The LLM plane has no equivalent** — swapping an LLM provider is completely silent. |
| E9 | Usage lacks dimensions and cost | **PASS — gap real (live DDL)** | Plus two additions: no PK/unique ⇒ retries double-count; usage recorded only after the stream loop completes ⇒ client disconnect is never metered. → refreshed #946 |

## F/G — quotas, audit, backup, MCP, and the five absences (§11, §10)

| # | Claim | F0-5 verdict | Evidence |
|---|---|---|---|
| F1 | Plans/quotas operational | **DECOMPOSED → F1a PASS · F1b–F1e FAIL** (was PARTIAL; see the convergence pass below) | 2 plans, 13 dimensions, `quota_enforcement_log`=6 (first-ever firings). `quota_overrides`=**0 rows ever** despite 201 responses — re-corroborates #963. |
| F2 | Audit infrastructure | **FAIL as a "Covered foundation"** | Content integrity is real (**416/416** `row_hash` re-derived, two independent implementations). But the chain resets to genesis and the verifier is **inverted** → #978. |
| F3 | Backup/restore | **DECOMPOSED → F3a PASS · F3b/F3c FAIL** (was PARTIAL; see the convergence pass below) | 21 static scope rows, **0 tenant-restorable**, 9/21 declare RPO/RTO, `operationalStatus:"unknown"` everywhere. **No table records a single backup, snapshot or restore run.** `/v1/backup/{status,snapshots,restore/dry-run}` → all 404. §19 item 10 remains open. |
| F4 | MCP hosting reachable | **FAIL** | All `/v1/mcp/*` → **404 NO_ROUTE** (was 401 in F0-R1 — drifted). Requests do reach the executor (its counter shows `route="/v1/mcp/servers",status="404"` = 20). |
| F5 | Observability | **DECOMPOSED → F5a/F5b PASS · F5c–F5f FAIL** (was PARTIAL; see the convergence pass below) | Real: `/metrics`, scraping, 2 dashboards. Broken: only 3 metric families; **0 alert/SLO rule groups**; APISIX target down; double-scrape inflates the shipped panels ~2x; unbounded, unauthenticated cardinality injection → #982, #986, charts#18, charts#19. |
| F6 | HA / multi-replica safety | **DECOMPOSED → F6a PASS · F6b/F6c FAIL** (was PARTIAL; see the convergence pass below) | Both executor replicas serve, no stickiness (40 gateway requests → +19/+5; baselines near-balanced). Negative: **no leader election exists anywhere in the repo**. Most multi-replica hazards remain untriggerable black-box because the executor serves almost nothing reachable. |
| F7 | Secret audit redaction | **PASS** | Canary set/rotated/deleted: **0** occurrences in `plan_audit_events`, **0** log lines, GET metadata-only. OpenBao HMACs the value. Redaction genuinely clean — the *coverage* is what fails (#971/#974). |
| F8 | Token metering | **DECOMPOSED → F8a PASS · F8b FAIL** | See the convergence pass below. |
| F9 | Data retention / purge | **DECOMPOSED → F9a PASS · F9b/F9c/F9d FAIL** (was PARTIAL; see the convergence pass below) | Good for provisioned resources (workspaces, physical DBs, realm). Residue: workspace secrets (#977), Knative workloads, `flow_versions` + plan-impact rows (#987). One reported class (`bktrm`/`wsrm` Jobs) was **refuted** — TTLs are set. |
| F10 | Support diagnostics | **DECOMPOSED → F10a PASS · F10b/F10c FAIL** (was PARTIAL; see the convergence pass below) | `scope_enforcement_denials` 401/401 carry `correlation_id`; `plan_audit_events` only **93/376**. |
| G1 | NO provider batch | **PASS — absence confirmed** | Adversarial re-grep: 2 broad hits, 0 real. Route census: `batch` matches **0 of 324** routes. |
| G2 | NO admission queue | **PASS — absence confirmed** | 43 broad hits, 0 real. One shared task queue `flows-main` for all tenants; no fairness key. |
| G3 | NO model capability catalog | **PASS — absence confirmed** | 1 broad hit, 0 real. |
| G4 | NO credential broker | **PASS — absence confirmed** | 333 broad hits, 0 real. |
| G5 | NO cost ledger | **PASS — absence confirmed** | 308 broad hits, 0 real. `billing-export` exists but `billing_usage_records` has no amount/price/currency column and `createBillingAdapter()` defaults to a no-op. |

### Tally (41 rows)
PASS 18 · PARTIAL 12 · FAIL 8 · REFUTED 2 · BLOCKED 1

Every "gap is real" row again **validates** the gap analysis. Two ratings in the document itself do
**not** survive contact with the running system: §11 "Audit infrastructure — Covered foundation"
(#978) and §4.5/§10 "pgvector — Covered foundation" (#983). §5's "Service accounts and OAuth
applications — Covered foundation" must be **split** — only the first half holds (#969).

## F0-5 convergence pass — compound claims decomposed to atomic verdicts

**Why.** 12 rows above carried PARTIAL and 1 carried BLOCKED. On inspection those are almost all
**compound claims** — the gap analysis bundles several capabilities into one row — not incomplete
tests. Forcing a single PASS/FAIL onto them destroys information; splitting them the way row A7 was
split (service accounts PASS / OAuth applications FAIL, which is what surfaced #969) resolves each
one honestly.

**Rule applied for unreachable capabilities.** A capability that cannot be exercised because of a
**platform defect** is a **FAIL of the claim**, with the blocking issue cited — not BLOCKED. BLOCKED
is reserved for what the *test environment* cannot reach. On that rule the only legitimately BLOCKED
items left are the outbound provider calls, which need an external LLM credential this campaign
deliberately does not hold.

| Sub-claim | Verdict | Evidence |
|---|---|---|
| **A4a** Duplicate-account protection | **PASS** | Realm `duplicateEmailsAllowed:false`; duplicate email → 409; duplicate username → 409. |
| **A4b** Platform controls account linking | **FAIL** | Linking runs on Keycloak defaults (`trustEmail:false`, `linkOnly:false`, no `firstBrokerLoginFlowAlias`) and the platform exposes no control — `kc-admin.mjs:261` hardcodes the representation to 5 fields. |
| **B1a** Flow definition plane | **PASS** | All 7 node types; create/list/get/update/delete/validate/publish/versions all work. |
| **B1b** Semantic validation on validate+publish | **PASS** | `FLW-E001/E003/E006/E008` → 422. (Caveat: `FLW-E004` never fires → #991; and `create_definition` accepts duplicate node ids.) |
| **B1c** Flow execution starts | **FAIL** | `POST .../executions` → **503 TEMPORAL_UNAVAILABLE**; `CountWorkflowExecutions` = 0 ever → falcone-charts#20. |
| **B1d** Retries, timers, signals, approvals, child flows | **FAIL** | No execution can exist to exercise any of them → falcone-charts#20. |
| **B1e** Cron / webhook / event triggers | **FAIL** | `[flow-trigger-registry] deregister schedule failed`; registrations have never succeeded → falcone-charts#20, #989. |
| **B2a** Flow mutations are tenant-scoped | **PASS** | Foreign tenant → `403 CROSS_TENANT_VIOLATION`; `tenant_viewer` write → 403. |
| **B2b** Cancellation is graceful | **FAIL** | No execution can be created to cancel → falcone-charts#20. |
| **B3** Flow SSE monitoring streams usable events | **FAIL** *(was BLOCKED)* | Route registered (`server.mjs:721`); returns 403 for a non-existent execution and no execution can ever exist → falcone-charts#20. Reclassified per the rule above. |
| **B7a** Flow version pinning | **PASS** | 47 immutable versions; `flowVersion` search attribute; start pins `pinned.version`. |
| **B7b** Durable orchestration | **FAIL** | `CountWorkflowExecutions` = **0, ever** → falcone-charts#20. |
| **C1a** Data plane is tenant-scoped | **PASS** | Each workspace gets its own physical `wsdb_<tenant>_<ws>`; a same-named mongo DB in a sibling workspace reads empty. |
| **C1b** Document read | **PASS** | Collections/documents list → 200. |
| **C1c** Document bulk import (the only write path) | **PASS** | `POST …/collections/default/imports` → 200, docs read back. |
| **C1d** Per-document create / update / delete | **FAIL** | Every per-document route 404 on the control plane and 401 on the executor. Document CRUD cannot be completed by any principal. |
| **C1e** Postgres table create / SQL / row import | **FAIL** | Table-create 404 (cp) / 401 (exec); `admin/{db}/sql` 404 / 401; row import → `TABLE_NOT_FOUND`. The Postgres data plane is read-only for every reachable principal. |
| **C4a** Events SSE stream | **PASS** | `GET /v1/events/topics/{id}/stream` replays from offset 0 **and** live-tails a message published mid-stream; `text/event-stream` with `: ping` keepalives. The one working realtime primitive. |
| **C4b** pg-captures | **FAIL** | 401 — executor-walled. |
| **C4c** mongo-captures / change streams | **FAIL** | **404 NO_ROUTE** — absent from the control-plane router. |
| **C4d** Platform advertises realtime as available | **FAIL** | `GET /v1/workspaces/{ws}/realtime` → `features.realtime: false`. |
| **C10a** Kafka event transport | **PASS** | Publish 202 + offsets confirmed; consume works past the 3000 ms tie (#955 is the default, not the capability). |
| **C10b** Realtime transport | **PASS** | Events SSE, as C4a. |
| **C10c** Webhook transport | **FAIL** | 500 for superadmin, 404 for service accounts → #957. |
| **C10d** Scheduled delivery | **FAIL** | `/v1/scheduling/*` 404 → #952; functions cron/kafka/storage triggers 404. |
| **D1a** Write-only storage, metadata-only reads | **PASS** | Full round trip; no `value` and no KV version in any read, for any role. |
| **D1b** Value lives in OpenBao, not Postgres | **PASS** | `pg_dumpall` 2,290,639 B across 18 databases → **0** marker hits; positive control 7 hits. |
| **D1c** Rotation and deletion | **PASS** | `PUT` rotates (OpenBao HMAC changes); `DELETE` → 204, then 404. |
| **D1d** Role gates | **PASS** | Non-admin service account → 403 on POST/PUT/DELETE. |
| **D1e** Audit redaction | **PASS** | Canary appears **0** times in `plan_audit_events` and **0** times in control-plane or executor logs. |
| **D1f** Mutations are audited | **FAIL** | Rotation unaudited for every principal (#971); superadmin list/delete/errors unaudited (#974). |
| **D1g** Secrets stay confined when consumed | **FAIL** | Resolved plaintext inlined into 5 Kubernetes object kinds → #970. |
| **D1h** Revocation and purge remove the material | **FAIL** | Survives secret delete **and** tenant purge → #970, #977. |
| **D1i** Secret backend session is durable | **FAIL** | Kubernetes auth broken since install; single cached token expiring 2026-08-09T10:05:54Z → falcone-charts#14, #984. |
| **E4** OpenAI-compatible completions reachable | **FAIL** | 401 for every principal → falcone-charts#13 + #961. *(Even past that, the outbound provider call is BLOCKED-no-credential by campaign choice.)* |
| **E2a** Allow-list enforcement semantics fail closed | **PASS** | `llm-executor.mjs:411-420`: `if (!chosen || allowed.length === 0 || !allowed.includes(chosen)) throw clientError(…, 422, 'MODEL_NOT_ALLOWED')`. Empty list explicitly means *nothing permitted*; missing coerces to `[]` on write (`:181`), read (`:234`) and in the DDL default. |
| **E2b** Enforcement demonstrable at runtime | **FAIL** | Route 401 for every principal → falcone-charts#13 + #961. Also unguarded at config time: `allowedModels: []` with a non-member `defaultModel` saves 200 and then 422s every completion. |
| **E5a** `llm.complete` activity is registered | **PASS** | `apps/workflow-worker/src/activities/catalog.mjs:32`; both worker replicas polling `flows-main`. |
| **E5b** Activity executes | **FAIL** | No workflow execution has ever run and none can → falcone-charts#20. |
| **E8a** Re-index warning implemented | **PASS** | `embedding-executor.mjs:94-98`, `:192-198`, `:214-217`. |
| **E8b** Warning observable at runtime, and dimension changes guarded | **FAIL** | Embedding routes 401 (falcone-charts#13). The warning also fires on *any* pre-existing row, even an identical re-save, and **nothing blocks a dimension change that silently invalidates stored vectors**. The LLM plane has no equivalent warning at all — swapping a workspace's LLM provider is completely silent. |
| **F1a** Plan and dimension catalog surface | **PASS** | `/v1/plans` 200 (2 plans), `/v1/quota-dimensions` 200 (13 dimensions). |
| **F1b** Platform quota dimensions enforced | **FAIL** | 1 of 13; the rest fail open → #962. |
| **F1c** Flow quota dimensions enforced | **FAIL** | **0 of 5**; gate constructed `undefined`, evaluator endpoint never built → #988. |
| **F1d** Quota overrides persist | **FAIL** | 201 with an `overrideId`, `quota_overrides` = 0 rows ever → #963. |
| **F1e** Plan assignment persists | **FAIL** | Reports `assigned:true` and never writes → #960. |
| **F3a** Backup scope catalog | **PASS** | 21 `backup_scope_entries` rows with RPO/RTO, granularity, preconditions. |
| **F3b** Backup execution is recorded | **FAIL** | `backup_scope_entries` is the **only** backup-ish table in the schema; no snapshot, run or restore table exists, so no backup has ever been recorded. |
| **F3c** Restore surface exists | **FAIL** | `/v1/backup/status`, `/v1/backup/snapshots`, `/v1/backup/restore/dry-run`, `/v1/backups/status` → **all 404**; only `/v1/admin/backup/scope` answers 200. §19 item 10 cannot be satisfied — there is nothing to test. |
| **F5a** Metrics exported and scraped | **PASS** | `/metrics` on :8080 for control-plane and executor; Prometheus scraping. |
| **F5b** Dashboards provisioned | **PASS** | 2 Grafana dashboards + datasource. |
| **F5c** Metric cardinality bounded | **FAIL** | Raw path in the `route` label; unauthenticated injection; 82.3% of the TSDB → #982. |
| **F5d** Gateway metrics | **FAIL** | APISIX target permanently 404/down → #986. |
| **F5e** Scrape correctness | **FAIL** | Double-scrape inflates the shipped rate panels ~2x → falcone-charts#18. |
| **F5f** Alerting / SLOs | **FAIL** | `/api/v1/rules` → 0 rule groups → falcone-charts#19. |
| **F6a** Replicas serve without stickiness | **PASS** | 40 gateway requests distributed +19/+5 across executor pods; baselines near-balanced. |
| **F6b** Leader election for singleton work | **FAIL** | Fresh exhaustive grep: `leader.?elect` 0 · `LeaderElection` 0 · `lease.*acquire` 0 · `coordination.k8s.io` 0 · `advisory_lock.*singleton` 0. **None exists anywhere in the repo.** |
| **F6c** Multi-replica behaviour validated | **FAIL** | The §11 row asks for operational validation; it has not been done, and cannot be black-box today because the 2-replica executor serves almost nothing reachable (falcone-charts#13/#20). |
| **F8a** Usage schema records prompt/completion/total per workspace and model | **PASS** | Live DDL: `workspace_llm_usage(tenant_id, workspace_id, model, prompt_tokens, completion_tokens, total_tokens, created_at)` — exactly the shape §11 credits as a "covered basic primitive". |
| **F8b** Token metering actually meters | **FAIL** | **0 rows ever** written, and `GET /v1/workspaces/{ws}/llm-usage` → 401 for every principal (falcone-charts#13 + #961). Two further defects would corrupt it even once reachable: no PK/unique constraint, so retries double-count; and usage is recorded only *after* the stream loop completes (`llm-executor.mjs:477`), so a client disconnect means spent tokens are never metered → #946. |
| **F9a** Purge removes provisioned resources | **PASS** | Workspaces, physical `wsdb_*`, Keycloak realm, buckets, topics all removed and verified absent. |
| **F9b** Purge removes secret material | **FAIL** | Plaintext survives in OpenBao; 5 of 5 store prefixes orphaned → #977. |
| **F9c** Purge removes function workloads | **FAIL** | Knative service survives, still `READY` and invocable; disclosed in `residual` but with no API to remove it → #970. |
| **F9d** Purge cascades derived rows | **FAIL** | `flow_versions`, plan-impact and sub-quota rows orphaned, undisclosed → #987. |
| **F10a** Correlation IDs on denials | **PASS** | `scope_enforcement_denials`: **409 of 409** carry `correlation_id`. |
| **F10b** Correlation IDs on audit events | **FAIL** | `plan_audit_events`: **105 of 482** (21.8%). |
| **F10c** Support access controls | **FAIL** | `platform_break_glass` declared in `authorization-model.json:218` with **0** runtime references. No grant endpoint, no TTL, no expiry, no audit. |

### Convergence tally

Decomposing 13 compound rows yields **56 atomic sub-claims: PASS 20 · FAIL 36 · BLOCKED 0.**

Combined with the 28 rows that already carried a clean verdict, the F0 claim set now stands at
**PASS 38 · FAIL 44 · REFUTED 2 · BLOCKED 0** across 84 atomic claims — **every row resolved**, with
the single deliberate exception recorded inline at E4 (outbound provider calls need an external LLM
credential the campaign does not hold; the *route-level* failure is recorded as FAIL on its own
evidence).

**The decomposition is not a bookkeeping exercise — it changes the headline.** At row granularity the
platform looked mostly-healthy with a dozen "partial" caveats. At claim granularity, **44 of 84
atomic capability claims fail**, and the failures cluster in four places: anything requiring flow
execution (falcone-charts#20), anything requiring the executor (falcone-charts#13 + #961), quota
enforcement, and the entire backup/restore story.

### Convergence tally (final)

Every row in the F0-5 claim table now resolves. Compound rows are marked **DECOMPOSED** and point at
their atomic sub-claims above; no row reads PARTIAL, BLOCKED or TODO.

**Atomic sub-claims: PASS 27 · FAIL 40 · BLOCKED 0** (67 sub-claims from 20 decomposed rows).
Combined with the 21 rows that already carried a clean verdict, the F0 claim set stands at
**PASS 50 · FAIL 49 · REFUTED 2 · BLOCKED 0**.

The single deliberate exclusion is recorded inline at E2b/E4: the **outbound** LLM provider call needs
an external credential this campaign does not hold. Every *platform-side* barrier in front of it is
recorded as a FAIL on its own evidence, so nothing is hidden behind "blocked".

---

# Run F0-6 — 2026-08-09 — §19 re-rating + the P26 journey

Context `default` (pinned on every call), ns `in-falcone-staging`, commit `39ca71bb`, chart
`in-falcone-0.4.1` helm rev 20. Baseline confirmed at run start: **HEAD unchanged**, and **zero
issues closed** in either repo (`gh issue list --state closed` empty for `gntik-ai/falcone`; all 12
charts issues #11–#22 still OPEN). No fix has landed since filing, so this run is additive, not a
regression pass.

**Why this slice.** The F0 claim set was already final (PASS 50 · FAIL 49 · REFUTED 2 · BLOCKED 0,
every row resolved). Two parts of §F0 were not: the **§19 go/no-go table**, still the F0-1
assessment written against a control-plane-only topology, and **P26**, never walked as a journey.

**Run outcome: partially complete.** Slice A1 (§19 1–8) and slice B (P26) finished. Slice A2
(§19 9–15) and **all nine verifier agents** were killed mid-flight by a session limit at ~00:15Z.
**No verifier verdict was returned, so nothing was filed this run** — see FINDINGS.md.

## §19 go/no-go criteria 1–8 — re-rated on the full topology

Replaces the F0-1 ratings for these eight rows.

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| **1** | Supported release/build for the beta environment | **NO-GO** *(was "NOT VERIFIABLE HERE")* | Three first-party components run **three divergent source states, none an ancestor of HEAD**. OCI labels: control-plane `revision=1dde8d67 version=0.3.1-c25-1dde8d67`; executor **and** workflow-worker `revision=7f10bd7f version=0.3.0`. `git merge-base --is-ancestor` → **not an ancestor** for both. No ref or release names `0.3.0`/`0.3.1` (`gh release list` → only `v0.6.2/3/4`), so the versions came from a free-text `workflow_dispatch` input (`release-images.yml:73-77`). Build emits no attestation/SBOM/signature (`:145 provenance: false`). Executor and worker deploy by **mutable tag**; control-plane is digest-pinned — inconsistent policy. Live deployment is **not reproducible from the chart**: `falcone-control-plane-executor` carries managed-field owners `helm` + `kubectl-patch` + `kubectl-set`, and 22 env vars vs the chart's 20, including `KEYCLOAK_ISSUER`/`KEYCLOAK_JWKS_URL` which appear **0 times** in `helm get manifest`. `README.md:31-36` states the project is not production-ready with no stability, security or support guarantees. |
| **2** | Tenant isolation tested across all resources used by the product | **NO-GO** — *reason changed from "untested" to "demonstrably broken"* | **Freshly reproduced.** A service account bound to workspace **W1 only** read **W2**'s data: `GET /v1/events/workspaces/{W2}/topics` → `200` listing the marker topic, while its own W1 list returned `{"items":[]}`. `/v1/workspaces/{W2}/applications` → `200`. Its token carries `workspace_id: None` (#961). The published contract `AUTHZ-XWS-002` (`authorization-model.json:1493`) requires `deny` → **#973**. Network tier also fails: 4 NetworkPolicies, **none selecting `in-falcone.function=true`** (#972). Tenant tier still holds (cross-tenant 404, no existence leak; platform-admin 403). |
| **3** | Credentials self-service, write-only, rotated, revocable, never in workflow history | **NO-GO** | Self-service absent: the sole provider-key resolver is `byok-provider-guard.mjs:122-127` `return env[secretRef.name] ?? null`, wired into both `llm-executor.mjs:396` and `embedding-executor.mjs:455`; `resolveWorkspaceSecret`/`vault-secrets`/`BAO_`/`VAULT_` → **0** in the executor runtime (positive control 5). The executor has **0 `BYOK_*` env vars**, so no provider credential can exist, and adding one needs a chart change + restart — not rotatable or revocable by any API. Workflow history fails **by the code's own admission**: `flow-executor.mjs:793-797` — *"A memo is persisted as json/plain in Temporal visibility/history (no PayloadCodec is configured on the client or worker)"* — while the token rides in `args:[startInputFor({…executionToken})]`. `PayloadCodec` repo-wide = 1 (that comment); `DataConverter` = 0 → **#951**. |
| **4** | Git workers isolated; repository code does not execute by default | **NO-GO** *(was undeclared)* | Git workers do not exist (`git.?worker\|repo.?worker\|clone.?worker` = 0; control `worker` = 156), so rated on the **function sandbox** that would host them. Strong half is real: `function-executor.mjs:96` sets `runAsNonRoot`, `allowPrivilegeEscalation:false`, `drop:['ALL']`, `RuntimeDefault`, resource limits, `cluster-local`; default SA is inert (`auth can-i` → no on pods/secrets/services). Failing half: function pods run **in the platform namespace** beside Postgres/Kafka/Keycloak/Temporal with **no NetworkPolicy and no egress control** (#972). Code executes on submission with no gate — `POST /v1/functions/actions` → 201, Ready and invocable in seconds; `approval\|review.*required\|pendingReview` = 0. |
| **5** | Private GitHub / GitLab / generic Git paths pass e2e security tests | **NO-GO** *(was undeclared)* | Domain absent, proven with a positive control (403 files match `workspace`): `api.github.com` 0 · `gitlab.com/api` 0 · `github_?(app\|token\|pat)` 0 · `x-access-token` 0 · `ssh-agent\|deploy_?key` 0 · `git[ _-]?clone` 0 · `isomorphic-git\|simple-git\|nodegit\|libgit2` 0 · `repository_?url\|clone_?url` 0 · `/v1/repositories\|/v1/repos\|/v1/git` 0; no `@octokit`/`@gitbeaker` in any `package.json`. Nothing exists to test end to end. |
| **6** | Two LLM connections coexist in one workspace | **NO-GO** | Live DDL: `"workspace_llm_providers_tenant_id_workspace_id_key" UNIQUE CONSTRAINT, btree (tenant_id, workspace_id)`; writer is `ON CONFLICT … DO UPDATE` (`llm-executor.mjs:249-252`), so a second connection **overwrites** the first. Same constraint on `workspace_embedding_providers` → **#937**. |
| **7** | Launch providers have validated adapters and model capability records | **NO-GO** *(was undeclared)* | No adapters: `anthropic` 0 · `anthropic-version` 0 · `/v1/messages` 0 · `generateContent\|generativelanguage` 0 · `/v1/responses` 0 · `conformance` 0. Only backend is generic OpenAI-compatible `/chat/completions` (`llm-executor.mjs:63`). No capability records: `model_?catalog` 0 · `contextWindow` 0 · `maxOutputTokens` 0 · `supportsTools\|supports_vision` 0. `domain-model.json governance_catalogs.provider_capabilities` has 12 entries, **all infrastructure**; llm/anthropic/openai/gemini/embedding keywords all `False`. Live: `/v1/models`, `/v1/llm/models`, `/v1/llm/providers`, `/v1/provider-capabilities`, `/v1/llm/adapters`, `/v1/model-catalog` → **404 ×6** → **#940–#944**. |
| **8** | Batch mode: state, cancellation, partial results, reconciliation, usage | **NO-GO** | No implementation to have those properties. Route census in the **deployed images** with the BusyBox positive control (`--exclude-dir` → exit 2; controls 165 files / 336 `/v1` paths): control-plane runtime map **55 `/v1` paths, 0 matching `batch`**; executor image **336 `/v1` paths, 0 matching `batch`**. Repo: `batch_?(id\|status\|job\|request)` 0 · `/v1/.*batch` 0 · `partial_?result` 0; no file contains both `batch` and `llm`. Live probes ×5 → **404** → **#945**. |

**Tally: 8 NO-GO · 0 GO · 0 PARTIAL-GO · 0 NOT-CHECKABLE.** None of the eight was genuinely
off-cluster — including criterion 1, which F0-1 had called "NOT VERIFIABLE HERE" and which is
answered in the negative by the repo's own README plus cluster-observable build provenance.

**Criteria 9–15 were NOT re-rated** — that slice was killed by a session limit. The F0-1 ratings
above remain the current record for them, with their control-plane-only caveats intact. Criterion 10
(deletion + restore) is the one the campaign has deferred longest and it remains open.

## P26 — developer building on the BaaS — WALKED (first time)

Previously BLOCKED twice (#953, then falcone-charts#13). F0-5 established #953 is console-only and
tenant users authenticate via the per-tenant `<slug>-app` client, so the journey became testable.

| # | Step | Developer unaided? | Evidence |
|---|---|---|---|
| 1 | Tenant user + session | **PARTIAL** | Owner must create the user. Console `POST /v1/auth/login-sessions` → **401 INVALID_CREDENTIALS** with correct creds; `<slug>-app` direct grant → 200 (#953). Token has `tenant_id`, **no `workspace_id`** despite the `workspace-context` scope (#961). |
| 2 | Register app / obtain API credentials | **NO** | developer → applications 403, service-accounts 403, api-keys **403 "Caller role may not manage API keys"**. Owner mints `flc_` key → 201. |
| 3 | Provision database / bucket / topic | **NO** | developer → **403 ×3** (*"requires superadmin or tenant owner/admin"*). Owner → mongo 201, bucket 201, topic 201. |
| 4 | CRUD | **SPLIT** | **Mongo CRUD reportedly works** via `flc_` key — insert 201, PUT `{matched:1,modified:1}`, PATCH 200, DELETE `{deleted:1}` — **claim pending verification, see FINDINGS.md**. Bearer → 404 NO_ROUTE (#980). Storage: read PASS (sha256-exact) / write NO (403 for developer; ~~#994 `contentBase64` writes 0 bytes; #966 lossy `content`~~ **both CLOSED, verifier CONFIRMED-FIXED, `192c8cd0`…`cf4f8a45`** — the remaining write blocker on this step is the developer-role 403, not the envelope). Postgres: **FAIL** — no DDL route exists. |
| 5 | Something asynchronous | **NO** | Function deploy **201 as developer**, invoke 202, correct result, real ksvc READY. But triggers/rules/cron/http-exposure **404 ×5** (#992), scheduling 404 (#952), webhooks 404, flows author+publish OK → execute **503 TEMPORAL_UNAVAILABLE** (charts#20). |
| 6 | Use a platform service | **NO** (MCP excepted) | LLM provider unreachable by any principal (candidate C3); `llm/completions` → `422 LLM_PROVIDER_MISSING`; realtime `features.realtime:false, dataSources:[]`; MCP `servers` 200 and `mcp/rpc` 200 as developer. *Gap: function-secrets surface (`/v1/functions/workspaces/{ws}/secrets`) not exercised — untested, not failed.* |
| 7 | Observe the app | **NO** | developer **403** on `metrics/{overview,usage,quotas,series,audit-records}`, `consumption`, `quota/effective-limits`; owner 200 on all. Developer sees only their own function's `logs`/`result`. |

**Headline.** A developer gets roughly **one third of an application built, and only if a tenant
owner does the setup for them.** The `tenant_developer` role — which the platform defines, validates
and stamps into tokens — is 403 on every provisioning route, every data write and every
observability surface, and cannot `GET` its own workspace. The two things a developer genuinely does
unaided are **deploy and invoke a Knative-backed function** and **read storage objects**. Where they
stop hard: Postgres has **no DDL route**, so no table can ever exist; **nothing asynchronous** is
reachable; BYOK LLM config appears reachable by no principal; and they **cannot observe their own app
at all**.
