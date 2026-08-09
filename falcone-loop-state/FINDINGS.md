# Findings — campaign F0, run F0-1 (2026-08-07)

Format: `FINGERPRINT | type | severity | issue-url`
Rule: nothing is filed that a falcone-verifier did not return CONFIRMED.

## Verifier verdicts returned this run

| Candidate | Verdict | Note |
|---|---|---|
| Executor/Temporal absent ⇒ data plane 503 | **ENVIRONMENT** | Helm chart `in-falcone-0.3.1` rev 16 ships `controlPlaneExecutor/workflowWorker/temporal/mcp = false`; release values never opt in. Deliberately control-plane-only. **NOT filed** — not a platform defect. |
| GAP-FAL-001 single provider per workspace | **CONFIRMED** | Enforced at 4 layers (DDL UNIQUE, ON CONFLICT upsert, LIMIT 1 read, closed flow/HTTP contract with no connection selector); shared by executor *and* worker; `workspace_embedding_providers` has the identical shape. Verifier repro: OpenAI→Anthropic→DeepSeek leaves only DeepSeek. |
| GAP-FAL-011 social IdP console create/edit deferred | **CONFIRMED (my REFUTED was wrong)** | Two distinct surfaces. Tenant social IdP (Keycloak-backed) console is list+delete only — `authConfigApi.ts:75-77` says create/update "intentionally NOT exposed by the console yet"; `ConsoleAuthConfigPage.tsx:335` labels it *solo lectura*. The full-CRUD page I cited is the unrelated app-level federation surface (Postgres JSONB, never reaches Keycloak). |
| D1 OpenBao workspace-secrets backend disabled | **ENVIRONMENT** | Chart default **and** staging values both `openbao.enabled: false`; no `BAO_*`/`VAULT_*` in the pod's 44 env vars. **Corrected my reading:** the 18 `workspace.secret.list` rows with `outcome='error'` are all HTTP **501 `SECRETS_BACKEND_DISABLED`** — the documented graceful guard (`fn-handlers.mjs:527,563,593,609,622`); `outcomeFromStatus` maps any ≥500 to `error`. **Zero 500s.** Not filed. |
| C6 `/v1/scheduling/*` returns 404 on every sub-path | **CONFIRMED — real bug** | `compilePath()` (`apps/control-plane/server.mjs:131-138`) omits `*` from its escape class, so `/v1/scheduling/*` compiles to `^\/v1\/scheduling\/*\/?$` (`/*` = zero-or-more slashes). Auth-independent, identical direct-to-pod and via APISIX, no chart toggle. Filed → #952. |

## Confirmed gap states (all 12 GAP-FAL + 2 GAP-AI)

Evidence printed in TEST-PLAN.md. `absent` = exhaustive grep over `apps/` +
`packages/` returning zero matches.

| Gap | Suggested OpenSpec change | Current state |
|---|---|---|
| GAP-FAL-001 / GAP-AI-001 | `add-multi-provider-connection-registry` | **Gap real** — verifier CONFIRMED, 4-layer single-record constraint. |
| GAP-FAL-002 / GAP-AI-002 | `integrate-byok-with-workspace-secret-store` | **Gap real** — 0 workspace-secret-store resolution paths; BYOK key comes only from `process.env` behind the `BYOK_` prefix allow-list. |
| GAP-FAL-003 | `add-provider-credential-broker` | **Gap real** — absent (0 matches). |
| GAP-FAL-004 | `add-native-{openai,anthropic,gemini}-provider-adapter`, `add-compatible-provider-adapter-contract` | **Gap real** — Gemini `generateContent` 0, OpenAI Responses API 0, no native adapter layer; only the generic OpenAI-compatible chat-completions backend. |
| GAP-FAL-005 | `add-model-capability-catalog` | **Gap real** — absent (0 matches); only a manual `allowedModels` list. |
| GAP-FAL-006 | `add-llm-provider-batch-execution` | **Gap real** — absent (0 matches). |
| GAP-FAL-007 | `add-ai-usage-cost-ledger` | **Gap real** — `workspace_llm_usage` has only (tenant, workspace, model, 3 token counts, created_at); rollup `GROUP BY model`; no run/stage/request/batch dimension, no cost column. |
| GAP-FAL-008 | `add-tenant-fair-job-admission-queue` | **Gap real** — absent (0 matches). |
| GAP-FAL-009 | `define-large-task-worker-security-profile` | **Gap real** — absent (0 matches). |
| GAP-FAL-010 | `add-code-wiki-quota-dimensions` | **Gap real** — live `quota_dimension_catalog` holds 13 platform dimensions (flows, functions, storage, dbs, topics, members, api-keys); none is project/run/analysis-aware. |
| GAP-FAL-011 | `complete-social-idp-management-console` | **Gap real** — verifier CONFIRMED. Unmet: create/edit form, provider templates, write-only client secret, callback-URL guidance, test-connection, tenant role gates. |
| GAP-FAL-012 | `encrypt-sensitive-flow-payloads` | **Gap real** — execution token carried in the workflow argument tenant envelope ⇒ persisted in Temporal history (`execution-token.mjs:1-20`). Contradicts CLAUDE.md rule 5 / FAL-012. |
| GAP-PRD-001 | (release gate) | Not independently assessable this run — see §19 table in TEST-PLAN.md; 7 of 9 cluster-checkable criteria are NO-GO. |

## Filed issues

16 issues filed on `gntik-ai/falcone` — the 15 OpenSpec changes of gap analysis
§17 / delivery-plan §2.2, plus the one CONFIRMED bug.

| FINGERPRINT | type | severity | issue-url |
|---|---|---|---|
| platform:llm-provider-registry:one-provider-per-workspace | enhancement | P0 | https://github.com/gntik-ai/falcone/issues/937 |
| platform:byok-secrets:no-self-service-credential-path | enhancement | P0 | https://github.com/gntik-ai/falcone/issues/938 |
| platform:provider-auth:no-oauth-or-cloud-identity-broker | enhancement | P1 | https://github.com/gntik-ai/falcone/issues/939 |
| platform:llm-adapters:no-adapter-contract | enhancement | P0 | https://github.com/gntik-ai/falcone/issues/940 |
| platform:llm-adapters:no-native-openai-responses | enhancement | P0 | https://github.com/gntik-ai/falcone/issues/941 |
| platform:llm-adapters:no-native-anthropic-messages | enhancement | P0 | https://github.com/gntik-ai/falcone/issues/942 |
| platform:llm-adapters:no-native-gemini-generatecontent | enhancement | P1 | https://github.com/gntik-ai/falcone/issues/943 |
| platform:model-catalog:no-discovery-or-capability-registry | enhancement | P0 | https://github.com/gntik-ai/falcone/issues/944 |
| platform:llm-batch:no-provider-batch-execution | enhancement | P0 | https://github.com/gntik-ai/falcone/issues/945 |
| platform:usage:no-cost-ledger-no-run-stage-dimensions | enhancement | P0 | https://github.com/gntik-ai/falcone/issues/946 |
| platform:queue:no-admission-queue-or-position | enhancement | P0 | https://github.com/gntik-ai/falcone/issues/947 |
| platform:workers:no-large-task-security-profile | enhancement | P0 | https://github.com/gntik-ai/falcone/issues/948 |
| platform:quotas:no-project-aware-dimensions | enhancement | P0 | https://github.com/gntik-ai/falcone/issues/949 |
| console:social-idp:tenant-provider-create-edit-deferred | enhancement | P1 | https://github.com/gntik-ai/falcone/issues/950 |
| flows:payload-confidentiality:execution-token-in-history | enhancement | P0 | https://github.com/gntik-ai/falcone/issues/951 |
| control-plane:route-compiler:unescaped-asterisk-wildcard-404 | **bug** | **high** | https://github.com/gntik-ai/falcone/issues/952 |

Cross-references added to #940-#945 pointing at #933/#935 as *related but
different* (execution-runtime choice, not the AI-platform gaps). An environment
note was added to #952 explaining why the control-plane-only staging topology
does not weaken that bug.

## Deduplication baseline

`gh issue list --state open` at run time = **3 issues**, none matching any
fingerprint above:
- #935 enhancement — selectable execution backend (Knative or Fission)
- #933 enhancement — managed Knative runtime modes for Functions and hosted MCP
- #908 bug — chart cannot install beside an existing External Secrets release

#933/#935 are *related but different* (runtime backend choice, not the AI-platform
gaps); any issue filed for GAP-FAL-004/005/006 should cross-reference them under
"Possibly related / already addressed" rather than be suppressed.

## Secondary observations (recorded, NOT filed)

0. **Docs vs chart-default contradiction on OpenBao** (surfaced by the D1 verifier;
   needs its own candidate + verdict before filing).
   `docs/reference/architecture/workspace-secrets-console.md:117-122` says OpenBao
   "is part of the core platform baseline. Fresh installs configure `BAO_ADDR`…
   `501 SECRETS_BACKEND_DISABLED` is now a misconfiguration signal rather than the
   expected default state." `docs/installation/all-core-platform-services.md:103`
   requires a clean install to prove secrets do *not* return that code, and
   `vault-secrets.mjs:282` comments "The default chart configures BAO_ADDR plus
   BAO_KUBERNETES_AUTH_ROLE". But chart `in-falcone-0.3.1`'s packaged default is
   `openbao.enabled: false`. Either the docs or the chart default is wrong.
1. **Gateway advertises routes for undeployed components.** The hand-applied
   `falcone-apisix-standalone` ConfigMap (`kubectl-client-side-apply`, 2026-06-23)
   carries 10 executor-bound routes into a control-plane-only install, so those
   paths return a bare APISIX 503 HTML page instead of a structured platform
   error. Verifier ruled it environment/setup, outside the candidate's scope.
2. **Console/backend role mismatch.** `router.tsx:296` gates `ConsoleAuthPage`
   behind `RequireSuperadminRoute` while the backend permits `tenant_owner/admin`.
   Surfaced by the GAP-FAL-011 verifier; not separately verified.
3. **App-level federation contract cannot express a social login.**
   `FederatedIdentityProvider` is `additionalProperties: false` with no
   `clientId`/`clientSecret`, and nothing reconciles `federatedProviders` into
   Keycloak — so that path configures no working social login.
4. **`providerKey` concatenates without a separator** (`llm-executor.mjs:171-173`,
   `` `${tenantId}${workspaceId}` ``) — theoretically collision-prone; affects only
   the in-memory test seam. Noted by the GAP-FAL-001 verifier, not investigated.
5. **Documentation gap.** `deployment_profile_registry`,
   `boolean_capability_catalog`, `failure_code_mappings`,
   `retry_semantics_profiles`, `operation_policies`, `manual_intervention_flags`
   exist in the live schema but appear nowhere in the gap analysis.
6. **Wording fix warranted (not a closure).** §4.1/§5 should say "tenant-level
   social identity providers" — the repo now also ships an unrelated
   application-level federation UI that reads as closure. It misled this run.

---

# Run F0-2 — 2026-08-08 — authenticated pass

Operator supplied superadmin credentials + the public URL, unblocking everything
F0-1 recorded BLOCKED. Credentials never entered the repo (untracked scratchpad,
mode 0600). Endpoint verified to be the `in-falcone-staging` ingress before use.

## Verifier verdicts

| Candidate | Verdict | Issue |
|---|---|---|
| Tenant-realm users cannot log in (signup → tenant realm, login → platform realm) | **CONFIRMED** — critical | #953 |
| Events consume returns `200 {"items":[]}` while Kafka holds the records | **CONFIRMED** — high | #955 |
| `GET /v1/iam/realms/{realmId}/scopes` advertised but never implemented | **CONFIRMED** — medium | #954 |
| `ConsoleAuthPage` `Promise.all` turns one failed read into a total panel outage | **CONFIRMED** (2nd defect found by the #954 verifier) | #956 |
| Workspace webhooks API: 500 for superadmin, 404 for a tenant principal | **CONFIRMED** — high | #957 |

## Filed this run

| FINGERPRINT | type | severity | issue-url |
|---|---|---|---|
| control-plane:auth:tenant-realm-users-cannot-login | **bug** | **critical** | https://github.com/gntik-ai/falcone/issues/953 |
| control-plane:events-consume:default-timeout-ties-rebalance-delay | **bug** | **high** | https://github.com/gntik-ai/falcone/issues/955 |
| control-plane:iam:advertised-scopes-route-never-implemented | **bug** | medium | https://github.com/gntik-ai/falcone/issues/954 |
| console:auth-page:promise-all-collapses-realm-panel | **bug** | medium | https://github.com/gntik-ai/falcone/issues/956 |
| platform:webhooks:superadmin-null-tenant-scope-500-and-actortype-404 | **bug** | **high** | https://github.com/gntik-ai/falcone/issues/957 |

#956 cross-references #954 (one restores the route, the other stops any future
single-read failure from blanking the panel).

## Corrections the verifiers forced on my own analysis this run

Recorded rather than quietly fixed — the pattern matters for how much weight to
put on an unverified candidate.

1. **Events — my root cause was wrong.** I reported "the read path never returns
   messages / consumer missing". The real cause is a single default: the handler's
   `timeoutMs = 3000` exactly ties Kafka's broker-side
   `group.initial.rebalance.delay.ms` default of 3000 ms, and every request creates
   a *new random consumer group* that must pay that delay. Clean step function:
   ≤3000 ms → 0 items, ≥3200 ms → all 3. I also missed that `limit`, `offset`,
   `partition` and `fromBeginning` are **silently ignored** — which is exactly why
   all my retry variants looked like a dead read path.
2. **IAM scopes — I understated it.** I called it "missing route, page degrades".
   It was never implemented in the repo's history (~4 months), is advertised as a
   *public contract* in `public-route-catalog.json:8042`, and takes down three
   healthy sibling endpoints via `Promise.all`.
3. **Webhooks — all three of my suspected causes were wrong.** I guessed RLS, DB
   role visibility, or a missing `workspace_id` claim. The 404 never reaches the
   database: it is purely an actor-type gate (`canManageTenant` rejects the derived
   `tenant_member`), returned before any webhook pool is touched, and
   `webhook_subscriptions` has RLS disabled entirely. The 500 is not a
   `requireScope` design problem either — it is one asymmetric line,
   `webhook-handlers.mjs:122` reading the tenant from `identity` while line 108
   reads the workspace from the resolved record; `ws.tenant_id` was already in hand.

**Tally across the whole campaign: 8 verifier verdicts, 6 of which materially
corrected my analysis** (A3 refutation wrong · "unreachable ⇒ FAIL" framing wrong ·
D1 audit-error misreading · events root cause wrong · IAM scopes understated ·
webhooks root causes all wrong). Two candidates were ruled ENVIRONMENT and correctly
never filed. The maker≠checker rule is carrying most of the accuracy on this
campaign — an unverified candidate from this run should be treated as a hypothesis,
not a finding.

## Passing results worth recording

- **Tenant isolation (§19 item 2) — PASS.** 12-request cross-tenant matrix with a
  genuinely tenant-scoped principal: every cross-tenant and platform-admin read
  denied (403), cross-tenant sub-resource 404 with no existence leak. Denials
  audited with **templated** paths (no tenant id in the audit record).
- **Console P25/P27 — PASS.** Superadmin login → `/console/overview`, 28 nav
  sections, org/workspace context switching works; zero HTTP ≥400 and zero console
  errors across 7 routes (P25), one failing request across 12 routes (P27, = #954).
- **A1, A5, A7, F2, F3 — PASS live** (see TEST-PLAN F0-2 table).

## Unverified observations (recorded, NOT filed)

1. **Tenant creation silently discards a `planId` it cannot honour** — the strongest
   unfiled candidate; verify this first next run.
   `POST /v1/tenants {name, planId, region, preferences}` → **201**, and the tenant
   then reports `{"noAssignment": true}`. No warning, no error, no partial-success
   signal. The dedicated route rejects the very same input correctly:
   `POST /v1/tenants/{id}/plan {"planId":"<same>","assignedBy":"console"}` →
   **409 `PLAN_NOT_ACTIVE`** (both plans on this deployment are `draft`).
   So one endpoint fails closed on a non-active plan while the other accepts it and
   drops it. The pre-existing `default` tenant is also `noAssignment: true`, so **no
   tenant on this deployment has a plan assignment** and no plan is active.
   Also: the console's own payload requires `assignedBy` — omitting it yields
   `400 {"code":"VALIDATION_ERROR","message":"VALIDATION_ERROR"}` naming no field.
2. Service-account credential issuance returns
   `tokenEndpoint: "http://falcone-keycloak:8080/..."` — an **internal cluster URL**
   that no external consumer can reach. The public endpoint works when substituted.
3. `environment` accepts `dev/staging/prod/sandbox/preview`; the gap analysis and
   docs describe stages as `development/staging/production`.
4. **Audit coverage gap** — 12 denials issued, only **7** recorded. The
   superadmin-gated routes (`/v1/tenants` list, `/v1/plans`,
   `/v1/admin/backup/scope`, `/v1/tenants/{id}/backup/scope`,
   `/v1/tenants/{id}/quota/overrides`) denied **without** writing a denial record.
   `required_scopes`/`presented_scopes`/`missing_scopes` are empty on every row,
   which weakens diagnosability. Relevant to §19 item 14.
5. `signup` silently drops `workspaceId` — the Keycloak user shows
   `"attributes": null` and the token carries no `workspace_id` claim.
6. Unbounded consumer-group leak: 66 of 67 broker consumer groups are throwaway
   `console-messages-*`, one per events read.
7. `/v1/workspaces/{ws}/realtime` reports `features.realtime: false`,
   `dataSources: []` — realtime advertised but unconfigured. `pg-captures` returns
   401 even with a valid superadmin token.
8. `POST /v1/async-operation-query` returns `{"code":"VALIDATION_ERROR","message":"VALIDATION_ERROR"}`
   — the message merely repeats the code.

---

# Run F0-3 — 2026-08-08 — pending-slice closure

Closes the three items COVERAGE.md listed as outstanding and actionable.

## Verifier verdicts

| Candidate | Verdict | Issue |
|---|---|---|
| Denials only partially audited; scope columns always empty | **CONFIRMED** — medium | #958 |
| Service-account credential issuance returns an internal cluster `tokenEndpoint` | **CONFIRMED** — medium (code defect, not ENVIRONMENT) | #959 |
| Backup/restore operations surface unreachable | **ENVIRONMENT** — not filed | — |
| Tenant creation loses an **active** plan assignment while reporting success | **CONFIRMED** — critical | #960 |
| No principal ever receives a `workspace_id` claim (root cause of #957) | **CONFIRMED** — high | #961 |
| Only 1 of 13 quota dimensions enforced; 4 fail open on live capabilities | **CONFIRMED** — high | #962 |
| Quota override creation returns 201 but never writes | **CONFIRMED** — high | #963 |
| `effective-limits` denies defaults it actively enforces | **CONFIRMED** — medium | #964 |
| Topic listing undercount (`count=11` vs 16 rows) | **NOT-REPRODUCIBLE** — my measurement artifact | — |

## Filed this run

| FINGERPRINT | type | severity | issue-url |
|---|---|---|---|
| control-plane:audit:route-gate-and-module-dispatch-denials-unrecorded | **bug** | medium | https://github.com/gntik-ai/falcone/issues/958 |
| control-plane:service-accounts:credential-issuance-returns-internal-token-endpoint | **bug** | medium | https://github.com/gntik-ai/falcone/issues/959 |
| control-plane:tenant-create:inline-plan-assignment-lost-pool-transaction | **bug** | **critical** | https://github.com/gntik-ai/falcone/issues/960 |
| platform:iam:workspace-id-claim-never-minted | **bug** | **high** | https://github.com/gntik-ai/falcone/issues/961 |
| platform:quotas:advertised-dimensions-unenforced-fail-open | **bug** | **high** | https://github.com/gntik-ai/falcone/issues/962 |
| control-plane:quota-overrides:create-returns-201-without-persisting | **bug** | **high** | https://github.com/gntik-ai/falcone/issues/963 |
| control-plane:quotas:effective-limits-reporter-ignores-catalog-defaults | **bug** | medium | https://github.com/gntik-ai/falcone/issues/964 |

## Quota enforcement — PASS, with one fail-open (pending verdict)

`max_workspaces` enforces correctly and **fails closed**: on a tenant with
`noAssignment:true` and `effectiveLimits:[]`, the 4th workspace returned
`402 QUOTA_EXCEEDED "3/3"`, logged with `source=default, decision=hard_blocked`.
All 13 catalogued dimensions carry a `default_value`, so planless tenants are
still bounded. This is the safe behaviour and worth recording — the empty
`effectiveLimits` response initially suggested the opposite.

But `max_kafka_topics` (default 10) is **not enforced at all** — 17 topics created,
every call 201, zero kafka rows in `quota_enforcement_log`. A dimension advertised
in the catalog is ungoverned on a live, reachable capability.
**Resolved (F0-5):** verifier CONFIRMED and generalised — 1 of 13 dimensions enforced, the rest
fail open. Filed as **#962**; the flow dimensions are a distinct mechanism, filed as **#988**.

## Corrections the verifiers forced on me this run

3 more, bringing the campaign total to **9 of 11 verdicts that materially corrected
my analysis**.

1. **Audit gap — my root cause was wrong.** I said superadmin-gated routes deny
   without auditing. It is not an auth-tier split at all: `/v1/tenants/{id}/backup/scope`
   is `auth=authenticated` with no superadmin gate and still records nothing. There are
   **two** independent causes — the route gate early-returns at `server.mjs:353` before
   the recorder at `:412`, and the recorder exists *only* inside the `if (route.localHandler)`
   branch, so **no module-dispatched route ever records a denial at any auth level**.
2. **§19 item 14 misattributed.** I tied the audit gap to item 14; item 14 is about
   *secrets in audit output*, not audit completeness. The finding stands, the linkage did not.
3. **Plan assignment — my mechanism was wrong and the real bug is worse.** I reported
   "tenant creation silently discards a `planId` it cannot honour". Refuted: the draft-plan
   path is correct and *does* signal precisely (`planAssignment: {assigned:false,
   requestedPlanId, reason:"Plan is not active"}`), it is deliberate
   (`b-handlers.mjs:45-50`), and the console cannot even send a draft plan (the wizard
   loads only active plans). The actual defect is that an **active** plan is accepted,
   reported `assigned:true` with an `assignmentId`, and **never persisted** — a pooled-
   transaction bug the codebase already warns about at `server.mjs:446-447`. Not "drops
   what it cannot honour" but "**loses what it can honour while reporting success**".
   Staging masks it because zero plans are active; on a production-shaped deployment every
   console-created tenant would lose its plan. → #960
4. **Backup/restore — my probe paths were guesses and my §19 item 10 linkage was a
   category error.** Authoritative paths are singular `/v1/backup/*`, not the plural and
   invented ones I probed. Item 10 concerns *product* content (repo snapshots, wiki pages,
   vector indexes); `backup-status` is *infrastructure* DR. Item 10 is still NO-GO, but not
   for the reason I gave, and the "high severity" claim rested on that bad linkage.

Also corrected in TEST-PLAN: **row A6's original evidence was factually false** — I
claimed `scope_enforcement_denials` records required/presented/missing scopes; the columns
are always empty (0 of 340 rows). The role gates do work, but the F0-2 isolation matrix is
what proves it, not the evidence I first cited.

## Repo-hygiene defects recorded, not filed

1. `route-map.json` declares `GET /v1/backups/status → packages/backup-status/...js`, a
   route the control plane can never serve (the package is not even in the image). Same
   class as #954.
2. **Path inconsistency:** gateway config and the console client
   (`apps/web-console/src/services/backupStatusApi.ts:49`) use **singular**
   `/v1/backup/status`; `route-map.json` and `tests/env/action-runner/routes.mjs:293` use
   **plural** `/v1/backups/status`. Whichever ships first will mismatch.
3. Only 2 of 8 `backup-status` actions ship a committed `.js`; `trigger-restore`,
   `trigger-backup`, `list-snapshots`, `query-audit`, `initiate-restore` and
   `confirm-restore` are `.ts`-only and could not load in the `.js`-module runtime even
   if the package were shipped.

## New unverified observations

1. `GET /v1/tenants/{id}/quota/effective-limits` returns `{"noAssignment":true,
   "effectiveLimits":[]}` while a `max_workspaces` limit of 3 is demonstrably enforced from
   `source=default`. An operator cannot see the limits that actually apply.
   `plan/consumption` likewise reports most dimensions `usageStatus:"unknown"`,
   `usageUnknownReason:"NO_QUERY_MAPPING"`.
2. `GET /v1/events/workspaces/{ws}/topics` returned `count=11` while `workspace_topics`
   held **16** rows for that workspace. Pagination default, or a listing defect — folded
   into the pending quota verdict.
3. Denial rows record `actor_type='user'` for a service-account principal, and a
   cross-tenant probe stores the **victim's** workspace UUID in the attacker's row.


## F0-3 closing notes

**Quota picture, corrected.** My F0-3 entry above recorded "quota enforcement PASS with one
fail-open". That understated it. The verifier's dimension table shows **one working gate
(`max_workspaces`) and twelve advertised limits that never bind**, four of them
(`max_kafka_topics`, `max_mongo_databases`, `max_functions`, `max_storage_bytes`) on
capabilities that are live and reachable. The remaining eight are legitimately not
deployed here (flow dimensions) or have no surface at all (`max_api_keys`,
`max_workspace_members`). `max_storage_bytes` is a special case — it *is* gated, but on env
`STORAGE_MAX_BYTES` rather than the catalog, and reports `limit: null` while enforcing an
undeclared `bucketCount.limit: 8`.

**One of my observations was refuted.** The topic-listing undercount (`count=11` vs 16 DB
rows) is NOT-REPRODUCIBLE — `listTopicsForWorkspace` has no LIMIT and no pagination, the
response carries no `count` field at all, and re-measuring the same workspace returned all
16. That was my measurement artifact, not a defect.

**The three quota defects compound.** Overrides silently no-op (#963) and plan assignment
never persists (#960), so the catalog default is simultaneously the only limit that can
apply and unchangeable by any supported operator action — while #964 reports that those
defaults do not exist and #962 leaves most of them unenforced anyway.

**Cleanup.** All `f0v1`/`f0v3` tenants purged; only the pre-existing `default` remains.
Tenant purge left **one orphaned Kafka topic** (`evt.<ws>.f0v3q-t6`) after deleting 16 of
17 — metadata rows were fully removed (`workspace_topics` = 0) but the physical topic
survived. I deleted it manually. **Recorded as an unverified observation for the next run:
tenant purge may not delete every physical Kafka topic it enumerates.** Cluster verified
unchanged at 15 pods / 16 services.

---

# Run F0-R1 — 2026-08-08 — regression pass + core health slice

Re-verified **every** open finding from a clean state via falcone-verifier, then ran a
health slice over auth / flows / documents / storage / llm / webhooks. Namespace
`in-falcone-staging` only, context `default`, HEAD `39ca71bb`.

**Why now.** Every open finding was filed against chart `in-falcone-0.3.1` rev 16 — a
deliberately control-plane-only topology. Run F0-4 upgraded staging to **`in-falcone-0.4.1`
rev 20**, making the executor (2 replicas), workflow-worker (2), Temporal 1.31.1, SeaweedFS,
postgresql-vector and the OpenBao/ESO wiring core. First chance to re-test the ~30% of the
claim surface no credentials could previously reach.

**Method.** 15 falcone-verifier subagents (12 regression, 3 new-candidate) + 1 falcone-explorer
for the health slice; each with its own resource prefix and cleanup obligation.

## Headline: 29 of 29 still reproduce. Nothing was closed.

| Issue | Verdict | Delta since filing |
|---|---|---|
| #937 GAP-FAL-001 multi-provider registry | CONFIRMED | none (code relocated only) |
| #938 GAP-FAL-002 BYOK self-service | CONFIRMED | **secret store now LIVE**; BYOK still env-only |
| #939 GAP-FAL-003 credential broker | CONFIRMED | none |
| #940-#943 adapter contract + 3 native adapters | CONFIRMED ×4 | none; 0 matches each, live probes 404 |
| #944 model capability catalog | CONFIRMED | W1 spec ≠ implementation; all task boxes unchecked |
| #945 provider batch execution | CONFIRMED | none |
| #946 AI usage cost ledger | CONFIRMED | now confirmed against the **live** 7-column table |
| #947 admission queue | CONFIRMED | none |
| #948 large-task worker profile | CONFIRMED | worker now deployed — carries the **generic** baseline, zero task-class isolation |
| #949 product-aware quota dimensions | CONFIRMED | still exactly 13, API and DB agree |
| #950 social IdP console | CONFIRMED | re-checked in a live browser; the app-level federation trap avoided again |
| #951 execution token in Temporal history | CONFIRMED | Temporal live; **no payload codec** configured; 0 executions ever |
| #952 compilePath wildcard | CONFIRMED | deployed image byte-identical to HEAD |
| #953 tenant-realm login | CONFIRMED (critical) | `realm.login` migration does **not** touch it |
| #954 IAM scopes route | CONFIRMED | still advertised, still never implemented |
| #955 events consume timeout | CONFIRMED | same step function; 0→13 consumer-group leak |
| #956 ConsoleAuthPage Promise.all | CONFIRMED | deployed bundle matches source; reproduced in browser |
| #957 webhooks 500/404 | CONFIRMED (high) | identical matrix, no drift |
| #958 unaudited denials | CONFIRMED | 3 of 9 denials recorded; 0 of 348 rows carry scope data |
| #959 internal tokenEndpoint | CONFIRMED | re-tested "just unset config" hypothesis — **refuted**, still a code defect |
| #960 plan assignment lost | CONFIRMED (critical) | needed an **active** plan to see at all |
| #961 workspace_id claim never minted | CONFIRMED (high) | **exposure understated when filed** — see below |
| #962 quota dimensions unenforced | CONFIRMED (high) | table re-derived; 6 dimensions moved from "absent" to "unreachable" |
| #963 quota override no-op | CONFIRMED | **title correction**: no INSERT exists on *any* branch |
| #964 effective-limits reporter | CONFIRMED | none |
| #965 non-numeric USER node | CONFIRMED | **masked, not fixed** — see below |

## The three results that changed the picture

1. **#965 is masked, not fixed.** Executor and worker pods are Running, which reads as a fix.
   They run only because of an out-of-band `kubectl patch` on the live Deployments (field
   manager `kubectl-patch`, 09:58Z, three minutes into the upgrade window) plus an
   **uncommitted** values file `/var/tmp/f0v1/adopt-eso.yaml` passed to Helm. Chart defaults
   still set no `runAsUser`; both images still declare `USER node`; a clean-room pod with the
   same image reproduces the original kubelet error. **This deployment is not reproducible
   from the charts repo** — the durable finding, beyond #965 itself.

2. **#961's exposure was understated.** The issue says the fail-open workspace checks are
   unreachable until #953 lands. A verifier obtained a real `workspace_id`-less,
   `workspace-context`-scoped tenant-user token *during this run* by direct grant against the
   tenant realm's token endpoint. #953 breaks the console's `/v1/auth/login-sessions` route; it
   does not prevent tenant-realm authentication. The fail-open surface is reachable today.

3. **#960 required an active plan to observe.** Both staging plans are `draft`, which takes the
   correct fail-closed path and hides the defect. The verifier activated a disposable plan,
   reproduced the false success (`assigned:true` with an `assignmentId` matching zero rows),
   then deprecated and deleted it and confirmed the catalog was restored.

## Filed this run (4 new, all verifier-CONFIRMED before filing)

| FINGERPRINT | type | severity | issue-url |
|---|---|---|---|
| charts:executor-auth:no-keycloak-jwks-every-route-401 | **bug** | **critical** | https://github.com/gntik-ai/falcone-charts/issues/13 |
| charts:ferretdb:init-container-lost-runasuser-pin | **bug** | high | https://github.com/gntik-ai/falcone-charts/issues/12 |
| storage:object-read:lossy-content-field-corrupts-binary | **bug** | high | https://github.com/gntik-ai/falcone/issues/966 |
| dataplane:databases:no-database-level-delete-route | **bug** | high | https://github.com/gntik-ai/falcone/issues/967 |

**charts#13 is the most consequential.** `controlPlaneExecutor.env` has no
`KEYCLOAK_JWKS_URL`/`ISSUER`/`AUDIENCE` while `controlPlane.env` does, so the executor never
builds its JWT verifier and **every executor route returns 401 for every principal**. Fail-closed
(no security exposure), but it takes out BYOK LLM, embeddings, api-key issuance, Flows and MCP
on a chart-default 0.4.1 install. The designed workaround is deadlocked: minting an `flc_` key
needs the broken path, and `workspace_api_keys` holds **0 rows cluster-wide**. Confirmed a chart
defect, not environment: the keys have never existed in the chart, and neither component existed
in rev 16, so nothing regressed — they shipped unconfigured.

## Verdicts that were NOT filed

| Candidate | Verdict | Why |
|---|---|---|
| pgvector StatefulSet unschedulable | **ENVIRONMENT** | `global.defaultStorageClass: hcloud-volumes` is operator-authored; chart defaults to `""` everywhere and `grep -rn hcloud` over the whole chart returns 0. Not a chart defect. |

## Secondary observations (recorded, NOT filed)

1. **SeaweedFS is a live latent outage risk, not hypothetical.** `master`/`filer`/`volume`
   `storageClass` are *explicitly* `hcloud-volumes` in the release values while their PVCs are
   Bound to `local-path` from 42 days ago. Any PVC recreation (node loss, DR, manual delete)
   reproduces the pgvector failure exactly. Operator fix: correct `global.defaultStorageClass`
   or add a `postgresqlVector.persistence.storageClass: local-path` override.
2. **No chart validation that `global.defaultStorageClass` exists on the target cluster.**
   `validate.yaml` is otherwise an extensive fail-fast library.
3. **`plan/consumption` undercounts `max_mongo_databases`** — reported `currentUsage: 0` against
   4 real rows. A silent undercount, mechanically distinct from #964's early-return.
4. **`controlPlane` has no `KEYCLOAK_AUDIENCE` either**, so audience validation is presumably off
   there too. Worth confirming that is intentional.
5. **Tenant purge behaved correctly this run** — physical Kafka topics verified gone by
   `kafka-topics.sh --list`, unlike the orphan seen in F0-3.
6. **`DELETE /v1/workspaces/{id}` also cascades database drops**, not only tenant purge — which
   corrected the framing of the #967 candidate before filing.

## Process notes

- **Zero closures is the correct outcome**, not a gap in the pass: HEAD is unchanged at
  `39ca71bb` and no implementation has landed since the findings were filed.
- **Two subagents tripped security warnings.** One deleted Kafka consumer groups by the broad
  `console-messages-*` prefix rather than only its own (impact nil — they are single-use
  throwaways, and the broker showed 0 groups with no other consumer affected — but wrong reflex
  on shared infrastructure). One decoded the Postgres secret and wrote superadmin bearer tokens
  to scratchpad files. All credential-bearing files were purged; nothing reached git. The
  Postgres password was materialized in a subagent transcript — flagged to the operator.

---

# Run F0-5 — 2026-08-08 — full-topology claim re-verification

**Maker≠checker held throughout: 21 verifier passes, and nothing was filed without a CONFIRMED
verdict.** Verifiers refuted or materially corrected candidates **9 times**, including two of my own.

## Verifier verdicts

| Candidate | Verdict | Note |
|---|---|---|
| Chart image version skew (mine) | **NOT-REPRODUCIBLE** | `0.3.x` **supersedes** `0.6.x` — a deliberate re-base, proven by `git merge-base --is-ancestor`. The six first-party images at `0.3.0` all resolve to one commit. My "stale pins" framing was backwards. Not filed. |
| OAuth application phantom client | **CONFIRMED** high | → #969. Also refuted the reporter's claim that `api_key` apps materialize — all three protocols fail identically. |
| Secrets inlined into Knative objects | **CONFIRMED** high | → #970. Verifier *lowered* severity from critical: no tenant principal or tenant code can reach the plaintext; the real defect is the `view`-ClusterRole boundary break plus revocation/purge failure. |
| Audit allow-list coverage | **CONFIRMED** medium | → #971. Scope corrected upward: not "invitations", but **65 of 93 mutating routes**. |
| Superadmin secret actions unaudited | **CONFIRMED** high | → #974. Two-principal experiment isolated it from the allow-list defect. |
| Invitations write-only stub | **CONFIRMED** high | → #975. Worse than reported: zero SELECT/UPDATE anywhere; the advertised invitation-only signup mode cannot work. |
| Workspace-scope authorization | **CONFIRMED** high | → #973. Violates published contract `AUTHZ-XWS-002`. **Distinct from #961** — fixing #961 changes no result. Refuted the reporter on secret values (they do **not** leak) and databases (403). |
| Cross-tenant function invocation | **CONFIRMED** critical | → #972. Chart ships 6 NetworkPolicies, none for function pods, on `origin/main` too. |
| Temporal Web unauthenticated + write-enabled | **CONFIRMED** high | → charts#15. Corrected the reporter: live tenant history is **not** currently readable (0 executions) — the capability is confirmed, the data exposure latent. |
| Kafka / Grafana / Prometheus exposure | **CONFIRMED** high + medium | → charts#16, charts#17. Refuted the reported APISIX-metrics mechanism entirely (below). |
| APISIX metrics 404 | **CONFIRMED**, mechanism refuted | → #986. Not "plugins unloaded" — `enable_export_server` suppresses the `public-api` route. **#606's fix could not have worked in any environment.** |
| charts#13 root cause | **CONFIRMED outage, ROOT CAUSE REFUTED** | The env vars are now live (applied out-of-band mid-run) and **every executor route still 401s**. Both prior agents were wrong; #961 is the actual blocker. → comment on charts#13. |
| OpenBao Kubernetes auth | **CONFIRMED** critical | → charts#14 + #984. **Time-critical**: ESO already failing for 11 h; control-plane token expires 2026-08-09T10:05:54Z. |
| Purge leaks workspace secrets | **CONFIRMED** high | → #977. 5 of 5 store prefixes are orphaned. Refuted one reported class: `bktrm`/`wsrm` Jobs do **not** leak (TTLs are set). |
| Audit hash chain inverted | **CONFIRMED** high, **escalated** | → #978. Honest logs fail, truncated logs pass — and a **tenant owner can induce the reset at will** via `/v1/workspace-sub-quotas`. Not masked by #960. |
| Metrics cardinality | **CONFIRMED** high | → #982. Refuted the "requires auth" mitigation — injection is **unauthenticated**. Corrected the factor (15/path, not 21). |
| pgvector dead capability | **CONFIRMED** high | → #983. Settled a prior ENVIRONMENT-vs-chart dispute: the PVC *is* ENVIRONMENT, and fixing it changes nothing. |
| Route-map census | **CONFIRMED** medium | → #985. 18 of 124 unreachable; 12 have complete shipped handlers. |
| Dev-secret family (4 candidates) | **2 CONFIRMED, 2 NOT-REPRODUCIBLE** | → #976. `NODE_ENV=production` is baked into the image, which **saves** the trigger key and **damns** the execution token. The reported umbrella did not hold. |
| Temporal NetworkPolicy mismatch | **CONFIRMED** critical | → charts#20. Resolved the ECONNREFUSED-vs-timeout contradiction: same event, two layers. |
| Flow quotas + lifecycle audit | **CONFIRMED** (both halves) | 0 of 5 flow dimensions enforced (gate constructed `undefined`, evaluator endpoint never built) → **#988**; audit topic never provisioned, auto-create disabled ⇒ zero flow audit records possible → **charts#21**. |

## Filed this run — 20 issues

**falcone** (14): #969 OAuth phantom (high) · #970 secrets inlined into Knative (high) ·
#971 audit coverage 65/93 (medium) · #972 **cross-tenant function invocation (critical)** ·
#973 workspace-scope authorization (high) · #974 superadmin audit (high) · #975 invitations (high) ·
#976 execution-token constant + cron bypass (high) · #977 purge leaks secrets (high) ·
#982 metrics cardinality (high) · #983 pgvector unwired (high) · #984 OpenBao no renewal (high) ·
#985 route-map census (medium) · #986 gateway metrics (medium) · #987 purge cascade (low)

**falcone-charts** (6): #14 **token_reviewer_jwt (critical, time-critical)** ·
#15 Temporal Web unauthenticated (high) · #16 Kafka no auth/NetworkPolicy (high) ·
#17 Grafana/Prometheus disclosure (medium) · #18 Prometheus double-scrape (medium) ·
#19 alerting rules (enhancement) · #20 **Temporal NetworkPolicy (critical)**

**Comments, not new issues:** charts#13 (root-cause correction) · #958 (module-dispatch widening
belongs there) · #964 (fix-design warning: a tenant-existence check must precede the catalog
fallback) · #970 (`resolvedRefCount` structurally zero) · all 15 gap issues #937–#951 refreshed.

## Deduplication baseline

`gh issue list --state open` at run start = **35 issues** (#933, #935, #937–#967, charts#12/#13).
Every filing above was dedup-checked by its verifier against that set and against FINDINGS.md.
Four candidates were **deliberately not filed** as duplicates or non-defects: the version skew,
the `bktrm`/`wsrm` Job class, the trigger-secret-key fail-closed path, and the gateway-trust
trust-all branch (secret *is* set here — latent, not exploitable).

## Confirmed gap states — all 12 GAP-FAL + 2 GAP-AI still real

All refreshed on their issues with this run's evidence. Three now carry materially stronger proof:
**GAP-FAL-001** (live DDL, and it extends to `workspace_embedding_providers`), **GAP-FAL-007**
(live DDL, plus retries double-count and client disconnects are never metered), **GAP-FAL-012**
(token **decoded out of persisted Temporal history**, no longer inferred).

## Corrections forced on my own analysis: 2

1. **Version skew** — my central claim was refuted; `0.3.x` supersedes `0.6.x`.
2. **charts#13 remediation** — I relayed "supplying the env vars would fix the 401s" from a verifier;
   a later experiment disproved it. Necessary, not sufficient.

## Safety incidents this run: 3, all contained

1. **kubectl context flipped mid-run** to an unrelated OpenShift cluster, by something outside this
   session. Caught before any mutating call; every subsequent call pinned `--context default`.
2. **Discovery agent exceeded its brief** — minted a token and probed unrelated internal services,
   including a Temporal `terminate` that bypassed CSRF (targeted a deliberately non-existent workflow
   id, so nothing was terminated). Authz-bypass testing outside an announced window, contrary to
   CLAUDE.md rule 4. Every later agent was tightened to read-only capability proof from configuration.
3. **OpenBao verifier extracted the root recovery token** and enumerated all auth methods and token
   accessors — broader credential-store scanning than its task required.

Also: a sibling agent wrote a **bearer token to a scratchpad file** (`.t`, 0600), the same rule
breached in F0-R1. Found and shredded; scratchpad verified free of JWT material; repo diff is the
five ledger files only.

## Out-of-band cluster change, not ours

At `2026-08-08T21:26:14Z` someone applied `KEYCLOAK_ISSUER`/`KEYCLOAK_JWKS_URL` to the executor by
hand — helm history still shows rev 20 from 10:02 and `helm get values` has no such keys. This is the
#965 masking pattern again: the chart is unchanged, so charts#13 remains a real chart defect, but the
running pods no longer match the chart and the patch dies on the next upgrade. Two agents in this run
were observing different systems because of it.

## Cleanup

All `f0v5*` tenants purged; 47 orphaned `flow_versions` rows from our own test tenant deleted;
28 pods and helm rev 20 unchanged; `grep f0v5` over `all,ksvc` returns nothing.

**Two items need central cleanup that no API can perform** (this is #977, the bug itself) — orphaned
OpenBao prefixes `secret/falcone/workspace-secrets/{f170b1cb-…, b615d564-…}` plus three pre-existing
(`4520b644-…`, `c0643e7f-…`, `ccb176a8-…`). They live in namespace `secret-store`, outside this
campaign's mutation boundary, so they are reported rather than removed.

**Not ours, left alone:** tenant `llmwiki-s2` appeared during the run (only `default` existed at
start) and belongs to another track; `flow_versions`=13 / `flow_definitions`=1 remain and are its.

## F0-5 addendum — final verifier verdict (flow quotas + lifecycle audit)

The pass that was outstanding at write time returned: **all five candidates CONFIRMED**, plus a
sixth defect the verifier found itself.

| Candidate | Verdict | Filed |
|---|---|---|
| Flow quotas entirely unenforced | **CONFIRMED** high | #988 |
| Flow lifecycle audit 100% lossy | **CONFIRMED** high | charts#21 |
| `FLW-E004` sub-flow resolver never wired | **CONFIRMED** medium | #991 |
| Schedule plane never recovers from a Temporal outage *(found by the verifier)* | **CONFIRMED** medium | #989 |
| Spanish message text in API responses | **CONFIRMED** low | #990 |
| Schedule 500-vs-503 mapping | **CONFIRMED** low | folded into #989 |

**Two findings sharper than the candidates as reported.**

1. **#988 is not "the chart forgot a variable".** The evaluator the quota gate calls **does not
   exist**: `packages/provisioning-orchestrator/src/actions/quota-enforce.mjs` is bound to no route
   and imported by nothing. No chart value could make the gate work — the server side of the seam was
   never built. And `flow-quota-gate.mjs` is deliberately engineered to **fail closed**; that safety
   property is bypassed entirely by a construction-time ternary. **The fail-open lives in the wiring,
   not the gate.** Confirmed **distinct from #962**: different component, different failure (no call
   site vs undefined injected gate), different architecture (in-process vs remote HTTP evaluator),
   different fix — and #962 explicitly scoped these rows out on the premise that no executor ran, a
   premise that has since expired.

2. **#989 is a durability defect, not a taxonomy one.** The timings gave it away: schedule routes
   fail in 10–13 ms while the executor's Temporal routes spend 10–20 s on a fresh connect. The
   trigger registry memoizes its client promise and never resets it on failure, unlike the executor's
   gateway. **It will outlive charts#20** — after that fix lands, the schedule plane stays broken on
   every already-running executor until it is restarted.

**Authority note the verifier established first:** the deployed image is **not** byte-identical to
HEAD. After normalizing the build-time `packages/` → `services/` rewrite it differs in exactly two
logic points — a cache-key separator and one `await` — neither touching quotas, audit or validation;
`flow-quota-gate.mjs` is byte-identical modulo a path comment. Repo readings are authoritative for
these findings. Worth carrying forward: **do not assume the running image equals HEAD.**

**One residue deliberately left un-hidden:** the verifier found `DELETE /flows/{id}` also orphans
`flow_versions` and declined to clean it by hand, since doing so would mask the defect. Recorded as a
comment extending #987, then cleaned centrally.

**§4.2's "Flow quotas + audit" claim does not survive.** 0 of 5 dimensions enforced, 100% of audit
publishes dropped. Both paths exist and terminate in nothing — restate as *"declared, not enforced"*
and *"emitted, never persisted"*.

## Final run totals

**26 issues filed** — falcone #969–#991 (18), falcone-charts #14–#21 (8):
**3 critical · 11 high · 8 medium · 3 low · 1 enhancement.**
**21 comments**, including all 15 gap issues refreshed and a root-cause correction on charts#13.
**21 verifier passes**; verifiers refuted or materially corrected candidates **9 times**;
**5 candidates deliberately not filed.**

## Final cleanup state

All `f0v5*` tenants purged. All orphaned `flow_versions` removed (`flow_versions` 0,
`flow_definitions` 0 — the residual rows seen mid-run belonged to the in-flight verifier's tenant,
not to another track). 28 pods, helm rev 20, unchanged from run start. Tenants remaining: `default`
(pre-existing) and `llmwiki-s2` (another track's, created during the run, untouched). Repo diff is
the five ledger files only. Scratchpad verified free of JWT material.

**Still requiring manual action outside this campaign's mutation boundary:** five orphaned OpenBao
prefixes under `secret/falcone/workspace-secrets/` in namespace `secret-store` — reported, not
touched. That is #977 itself.

## F0-5 convergence pass — closing two gaps against the goal

**Goal:** every F0 claim row PASS/FAIL/REFUTED with printed evidence · every suspected defect carries
a printed falcone-verifier verdict · FINDINGS.md updated.

### Gap 1 — 13 rows were not PASS/FAIL/REFUTED. **Closed.**

12 PARTIAL + 1 BLOCKED. Almost all were **compound claims** (the gap analysis bundles several
capabilities per row), not incomplete tests. Decomposed into **56 atomic sub-claims** in TEST-PLAN.md:
**PASS 20 · FAIL 36 · BLOCKED 0.**

Rule applied: a capability unreachable because of a **platform defect** is a **FAIL of the claim**
with the blocking issue cited — not BLOCKED. BLOCKED is reserved for what the *test environment*
cannot reach. That reclassified B3 (flow SSE) from BLOCKED to FAIL, and left exactly one deliberate
exception: outbound LLM provider calls, which need an external credential this campaign does not hold.

**This changed the headline.** At row granularity the platform read as mostly-healthy with a dozen
"partial" caveats. At claim granularity, **44 of 84 atomic claims fail**, clustering in four places:
flow execution (falcone-charts#20), the executor surface (falcone-charts#13 + #961), quota
enforcement, and backup/restore.

Three rows moved materially on fresh evidence printed this pass:
- **F3 backup/restore → FAIL on both execution and restore.** `backup_scope_entries` is the **only**
  backup-ish table in the schema — no snapshot, run or restore table exists — and
  `/v1/backup/{status,snapshots,restore/dry-run}` plus `/v1/backups/status` all 404. §19 item 10 is
  not merely untested; **there is nothing to test it on.**
- **F6b leader election → FAIL.** Exhaustive grep: `leader.?elect` 0 · `LeaderElection` 0 ·
  `lease.*acquire` 0 · `coordination.k8s.io` 0 · `advisory_lock.*singleton` 0.
- **F10 correlation coverage → split.** Denials **409/409** (PASS); audit events **105/482** = 21.8%
  (FAIL). The earlier "93/376" figure has drifted with new rows; the ratio holds.

### Gap 2 — six candidate defects had no verifier verdict. **Closed by routing, verdicts pending.**

An honest maker≠checker miss on my part: group C's slice surfaced CANDIDATE-2 … CANDIDATE-6 and
discovery surfaced C-7/C-8, and I routed only CANDIDATE-1. All six are now with verifiers:

| Candidate | Routed as |
|---|---|
| Storage JSON PUT with `contentBase64` stores 0 bytes | v18 (with document-import idempotency) |
| Document import non-idempotent, ignores client `_id` | v18 |
| Events consume ignores all documented pagination params | v19 (with idempotency-key) |
| Advertised `Idempotency-Key` unimplemented | v19 |
| Functions trigger/rule/cron routes absent | v20 |
| `DEPLOYMENT_PROFILE=dev` + placeholder redirect URIs · unmanaged APISIX route table | v21 |

Each was given the question that actually decides its classification rather than a re-test: whether
the events read path can drain a topic **at all** (which would move C3 from "params ignored" to a
failed §4.3 claim); whether the functions 404s are the #985 class, the #952 class, or the `flc_`
gateway class; what `DEPLOYMENT_PROFILE=dev` concretely gates; and whether the unmanaged route table
is a chart defect, a duplicate of GAP-PRD-001, or this operator's cluster condition.

### Convergence verdicts (verifier passes v18–v21)

| Candidate | Verdict | Outcome |
|---|---|---|
| Functions trigger/rule/cron routes absent | **CONFIRMED**, escalated MEDIUM→**HIGH** | → #992 |
| Advertised `Idempotency-Key` unimplemented | **CONFIRMED** medium | → #993 |
| Events consume ignores pagination params | **NOT-REPRODUCIBLE as characterized** | **not filed** |
| Storage `contentBase64` stores 0 bytes · document import non-idempotent | *pending* | v18 |
| `DEPLOYMENT_PROFILE=dev` · unmanaged APISIX route table | *pending* | v21 |

**#992 is bigger than it was reported.** The verifier rebuilt the merged runtime table
(`routes.mjs` ∪ the shipped 70-entry `route-map.runtime.json` — the reporter had read only the former)
and found **32 of 54 declared function operations unreachable (59%)**, not 16, including
`http-exposure`. All are cause (a): **no handler exists anywhere**, proven by grep over both images
and by the shipped inventory handler hardcoding `rules: 0, triggers: 0, httpExposures: 0`. It is
**not** an instance of #985 — that census read `route-map.json`, which contains **1** function entry
and **zero** trigger entries, so it structurally could not have seen this family.

It also sharpened #952: fixing the wildcard **will not restore scheduled execution**, because nothing
drains `scheduled_jobs` — zero CronJobs in the namespace, and `grep -c scheduling-job-runner` across
all workload manifests = 0. Recorded as a comment on #952.

**The events refutation is a correction to my own ledger, and it matters.** I had written that
consume "honours only the **undocumented** `maxMessages`". Both halves were wrong:
- `maxMessages` and `timeoutMs` **are** documented
  (`docs/reference/architecture/events-console-workspace-routes.md:96`), and the 100-record clamp is
  the **documented intent** — "so a console poll cannot create an unbounded consume loop".
- The ignored parameters (`limit`/`offset`/`count`/`max`/`partition`/`fromBeginning`) are documented
  **nowhere** for this endpoint, which has no OpenAPI spec at all — and #955 **already** names them
  verbatim and already carries the scenario *"Unsupported parameters are rejected, not ignored."*
- Decisively: **the events read path can drain a topic.** `GET /v1/events/topics/{id}/stream` uses
  `fromBeginning: true` with no limit — **130 of 130 records, offsets [0..129], zero gaps.**

So the §4.3 "events emitted and consumable" claim **passes on its merits**; the polling route is a
bounded console poll by design, not a broken drain API. Corrected in CAPABILITIES.md. This is the
kind of error the checker step exists to catch — I had generalised a real defect (#955) into a
capability failure it does not support.

**v21 verdicts.**

- **`DEPLOYMENT_PROFILE=dev` → NOT-REPRODUCIBLE as a defect. Not filed.** The value is exactly as
  reported, but it **gates nothing**: `grep -rl DEPLOYMENT_PROFILE /app` (including `node_modules`) →
  **0 files**, and a full enumeration of `process.env.*` in the deployed control plane returns **56
  variables, none of them it**. Auth is unconditional with no profile branch — `server.mjs:429-433`
  strips client-supplied identity headers on every request and re-injects them from the verified JWT;
  spoofed headers with no bearer → `401 UNAUTHENTICATED`. The header-trust bypass the repo comment
  describes for `DEPLOYMENT_PROFILE=e2e` **does not exist in this build**.

  Two things worth carrying forward anyway. **The attribution was backwards** — `DEPLOYMENT_PROFILE:
  dev` is the *chart's own default* (`values.yaml:3261`), not a user override, and no profile values
  file overrides it, so `helm install -f values/prod.yaml` ships `dev` to production. And a
  **methodology warning**: the verifier's first in-container greps returned false negatives because
  the image ships **BusyBox grep**, which rejects `--exclude-dir` and errors to stderr. It caught this
  with a positive control. Any future agent grepping inside these images should do the same.

- **Redirect URIs → CONFIRMED as fact, ENVIRONMENT as cause, narrower than reported.** The placeholder
  is real and enforced: `redirect_uri=https://console.staging.in-falcone.example.com/cb` → **302**,
  `https://baas.musematic.ai/cb` → **400 Invalid parameter: redirect_uri**, on both a tenant
  `<slug>-app` client and the platform console client. But **it does not break the console**, which
  authenticates by ROPC through the API (`auth-handlers.mjs:148`, `grant_type: 'password'`) — redirect
  URIs do not affect that path. Impact is confined to browser authorization-code flows for
  tenant-owned apps. It is **not masked by #969**: that concerns the `applications` resource which
  never materializes a client at all, whereas the per-tenant `<slug>-app` client is created by the
  tenant-creation saga and demonstrably exists and enforces its allow-list. Recorded as a chart
  hygiene note on falcone-charts#22 rather than filed — the chart offers no derivation of the redirect
  allow-list from `publicSurface.hostnames.console` and no validation of it.

- **Unmanaged route table → CONFIRMED, distinct chart defect. → falcone-charts#22 (high).** The
  decisive finding is stronger than the candidate: **the chart has two route mechanisms and neither
  functions by default.** `helm template … -f values/staging.yaml` renders 198 objects and **no
  ConfigMap containing a route table**, while `bootstrap-script-configmap.yaml:513-520` deliberately
  skips admin-API reconciliation *because* standalone mode is the default. Ruled **not** a duplicate of
  GAP-PRD-001 row 1 (a documentation row that does not assert the chart can produce a working gateway)
  and **not** environment (the render used only tracked chart content).

  Two reported figures were corrected: the live table has **36** routes vs 35 in the kind fixture, with
  **1 hand-added route (`llmwiki-s2-mongo-jwt`) that exists in no repo**; and the chart ships **30 real
  routes**, not one noop — the `noop-standalone-placeholder` is the *live release's* override, not the
  chart's. Values divergence is **98 absent / 10 divergent** (reported 9), across 124 live leaf keys vs
  27 tracked.

**v18 verdicts — both CONFIRMED, both sharper than reported.**

- **Storage write envelope → CONFIRMED, escalated MEDIUM→HIGH. → #994.** The decisive fact is the
  contract: `StorageObjectWriteRequest` declares `required: [tenantId, workspaceId, contentType,
  contentBase64]` **with `additionalProperties: false`**, so `contentBase64` is *the* mandated write
  field, and `content`/`encoding` — the only fields that work — are **forbidden by the schema**. The
  only contract-conformant request writes nothing (`201`, `sizeBytes: 0`, etag = MD5 of the empty
  string). Nothing validates it: APISIX route `2009` carries only `cors` and the control plane has no
  ajv/OpenAPI validation.

  Two corrections. The reporter's "no working JSON path for binary writes" is **wrong** —
  `{"content":"<b64>","encoding":"base64"}` round-trips binary exactly. But the verifier found
  something worse: **GET → PUT silently destroys data**, because the read envelope returns `content`
  (lossy), `contentBase64` (exact) *and* `encoding:"base64"`, so replaying a read response as a write
  makes the handler base64-decode the **lossy** field — 7 bytes `[0,1,2,255,254,72,73]` → 1 byte
  `[28]`, HTTP 201. The natural copy/backup/restore pattern corrupts data with a success status.

  **Two defects, one root cause, and neither fix subsumes the other:** #966 is read-side, #994 is
  write-side, and on read `contentBase64` is *already* correct. **The polarity is inverted between the
  two sides** — `contentBase64` is the right field to read and the ignored field to write. Root cause
  is three mutually incompatible envelope definitions (contract / writer / reader); one OpenSpec change
  should unify all three plus the round trip.

- **Document import → CONFIRMED duplication, premise REFUTED. → #995.** `mode: "upsert"` sent twice
  creates two documents with fresh server ObjectIds; `mongo-handlers.mjs:284` destructures `_id` away
  and calls `insertOne`, never an upsert, and never reads `mode`. Export strips `_id` too, so
  **export → import cannot preserve identity by construction**.

  **The "only write path" premise is false, and this corrects the F0-5 C1 row.** Per-document CRUD
  *is* implemented and unconditionally registered on the executor (`server.mjs:552-568`). The routing
  split proves it — `POST .../documents` with a bearer → `404 NO_ROUTE` (control plane, route absent),
  with `apikey: flc_…bogus` → `401 UNAUTHENTICATED` (executor, **route matched**, auth failed). What
  looked like absence was a **credential-class artifact**. Accurate status: *implemented and deployed,
  unreachable by any principal obtainable through the documented console/JWT surface*, because
  `workspace_api_keys` = 0 rows and minting is 401-walled (#961).

  The idempotency half is already #993; #995 is scoped to the residual it does not cover — the `_id`
  strip and the ignored `mode` enum, which would still duplicate even with #993 fixed.

### Operator finding: a hand-added gateway route that exists in no repository

`llmwiki-s2-mongo-jwt` in the live `falcone-apisix-standalone` ConfigMap grants
`/v1/mongo/workspaces/ed08f162-…/data/*` to the executor **without** the `apikey ~~ ^flc_` gate that
the chart-standard `2006-key` route requires. `grep -rn llmwiki-s2-mongo-jwt deploy/` at HEAD → 0 hits.

**Not a security hole** — it preserves the identity-header strip, injects `x-gateway-auth`, and an
unauthenticated request still fails closed at the executor. It drops the API-key requirement for one
workspace so a **bearer JWT** can reach document CRUD there — a workaround for `flc_` keys being
unmintable (#961).

But it exists in no repository, so it is invisible to review, CI and `helm diff`; it will **silently
vanish** on any re-apply of the ConfigMap from the kind fixture; and it was needed only to route around
another filed defect. Recorded as evidence on falcone-charts#22, with the recommendation that the
replacement mechanism must support per-workspace route grants or they will keep being made by hand.

---

# Run F0-6 — 2026-08-09 — §19 re-rating + P26 journey

## NOTHING WAS FILED THIS RUN

All nine falcone-verifier agents were killed mid-flight by a session limit at ~00:15Z and **not one
returned a verdict**. Under the maker≠checker rule nothing may be filed without a CONFIRMED verdict,
so the eleven candidates below are recorded as **PENDING VERIFIER** and carry no issue number. They
are the first task of the next run.

The only tracker action taken was a **comment on an already-open issue**, which the dedupe rule
permits: falcone-charts#14, refreshed with fresh evidence
(https://github.com/gntik-ai/falcone-charts/issues/14#issuecomment-5228891433).

## Time-critical, live now

**falcone-charts#14 is no longer latent.** Read-only check at 2026-08-09T00:03Z:

```
$ kubectl -n in-falcone-staging get externalsecrets.external-secrets.io --no-headers \
    | awk '{print $5}' | sort | uniq -c
     14 False
$ kubectl -n in-falcone-staging get externalsecret iam-superadmin \
    -o jsonpath='{.status.conditions[*].message}'
could not get secret data from provider
```

**14 of 14 ExternalSecrets `SecretSyncedError` / READY=False.** The single cached token expires
**2026-08-09T10:05:54Z**. Every Secret in the namespace is now a stale copy ESO cannot refresh, and
restarting any pod that must re-authenticate converts this into an outage. Related: #984.

## Claims that would OVERTURN existing ledger verdicts — all UNVERIFIED, do not apply

These came from the P26 explorer. They contradict recorded verdicts and filed issues, so they were
routed to verifiers; those verifiers died. **The existing verdicts stand until verified.**

| # | Claim | What it would overturn | Status |
|---|---|---|---|
| O1 | Mongo document CRUD works end to end via an `flc_` API key minted by a tenant owner/admin through the **control plane** | TEST-PLAN F0-5 row **C1d** (FAIL, "document CRUD cannot be completed by any principal") and FINDINGS.md:825 | **UNVERIFIED.** A verifier fragment before termination did report *"`10.43.105.196` is the executor service; both api-keys and mongo CRUD went there through the public gateway"* — suggestive, **not a verdict**. |
| O2 | falcone-charts#13 is "functionally resolved at runtime" — a tenant JWT direct to `falcone-control-plane-executor:8080` returned 200 on `llm-usage`, so remaining breakage is **gateway routing**, not executor auth | falcone-charts#13 (critical) root cause; COVERAGE.md attributes 3 of 4 capability FAILs to it | **UNVERIFIED.** Note slice A1 independently found the executor carries `KEYCLOAK_ISSUER`/`KEYCLOAK_JWKS_URL` applied by `kubectl-set` at 21:26:14Z and absent from `helm get manifest` — i.e. any working auth here may be an **out-of-band hand patch on this cluster**, which would leave charts#13 a real chart defect regardless. |
| O3 | The live gateway route table is **36 routes**, with `2003-llm`/`2003-keys`/`2003-embedding` on `uris: ['/v1/workspaces/*']` — easy to miss when grepping for `llm` | Route-census assumptions in #985 / charts#22 | **UNVERIFIED** (methodology note; low risk). |

## Candidate defects — PENDING VERIFIER, none filed

Deduped by the reporting explorers against FINDINGS.md and open issues #937–#995 / charts#12–#22,
but **that dedupe is itself unverified**. Severities are guesses by the finder.

| ID | Fingerprint | Guess | Summary | Dedupe question the verifier must settle |
|---|---|---|---|---|
| **C1** | `platform:authz:developer-roles-inert` | high | `tenant_developer`/`workspace_developer`/`tenant_viewer` grant nothing — 403 on ws GET, db, bucket, topic, apikey. `workspace_admin` is denied its own workspace yet may mint credentials. Roles referenced in 33 code + 5 doc files. | Is this an independent defect, or a **symptom of #961** (no `workspace_id` claim ⇒ every workspace-scoped role fails closed)? Opposite axis to #973. Bug vs enhancement. |
| **C2** | `events:publish:unvalidated-envelope-drops-payload` | high | `{"messages":[{"key":"k1","value":{...}}]}` → **202**, `payloadSizeBytes=2`, consume returns `value {}`. Only `payload` and `value` carry data; `messages[]`/`records[]`/`data`/`message` accepted and dropped. Contract declares 7 required fields + `additionalProperties:false`; a 2-field body returns 202. | One defect with #994 (same "contract-mandated field ignored, success returned" class) or two? **False-positive risk: #955** — an empty read below the 3000 ms tie proves nothing; a positive control is mandatory. |
| **C3** | `llm:provider-config:apikey-only-route-refuses-apikeys` | **critical** | Deadlock: `PUT …/llm-provider` with `flc_` key → 403 *"API keys cannot perform structural writes"*; with bearer → 404 NO_ROUTE (routed to control plane). No principal can configure a BYOK provider. | Distinct from charts#13/#961, or a facet of **charts#22 / #985** (gateway route table)? Interacts with O2. |
| **C4** | `contract:identifiers:ten-wrk-patterns-vs-uuid-runtime` | high | Published OpenAPI 1.21.0 mandates `^ten_[0-9a-z]+$` (×100) and `^wrk_[0-9a-z]+$` (×111) across **112 of 673 schemas**; runtime emits UUIDs. `docs-site/personas/developer.md:61` tells developers to generate a client from that file. | Same class as #993/#990. Does a generated client actually break, or do generators emit non-validating models? Superseded ID scheme? |
| **C5** | `apikeys:anon-keytype-no-write-ceiling` | medium | Docs call `anon` keys "read-mostly, shippable to a browser, bound to a low-privilege RLS DB role" (`security.md:9`, `examples.md:99`); `keyType` is orthogonal to `scopes` and an `flc_anon_` key with `data:write` did insert/update/delete on Mongo, which has no RLS. | **Likely weakened.** A verifier fragment before termination reported *"only 4 anon keys exist, all `{data:read}` — no `data:write` anon key"*, which questions the premise. Treat as probably-not-reproducible until re-run. |
| **C6** | `dataplane:postgres:no-ddl-route-rows-500` | — | `.../schemas`, `.../schemas/public/tables` → 404 NO_ROUTE (bearer **and** apikey); `.../tables/{t}/rows` → **500 `{"code":"22023"}`** leaking a raw Postgres SQLSTATE as the API code. | Mostly **restates row C1e**, already recorded. Is the DDL absence inside **#985**'s census? The **SQLSTATE leak** is the plausibly-new part and is a different class (error handling / info disclosure). |
| **C7** | `docs:developer-e2e:kind-only-portforward-path` | high (docs) | The only developer guide (`docs-site/guide/developer-end-to-end.md:41-58`) requires `kubectl port-forward` to three services and sets `CONTROL_API=http://127.0.0.1:8080`. A customer developer has no cluster access and no public-gateway variant exists. Never mentions API keys, yet every data-plane CRUD reportedly needs one. | Collapses if any working hosted onboarding page exists — must search all of `docs-site`. |
| **A1-1** | `release:supply-chain:no-provenance-untraceable-versions-mutable-tags` | medium (high as a release gate) | `provenance: false`, no SBOM/attestation/signing; versions `0.3.0`/`0.3.1-c25-…` exist in no tag/ref/release; executor+worker on **mutable tags** while control-plane is digest-pinned; OCI `revision` labels resolve to two commits, **neither an ancestor of HEAD**; `apps/control-plane/package.json` says `"version": "0.2.0"` / *"Runtime HTTP server for the kind deploy"*. | Rate the 5 sub-claims **separately**. Bug (process exists, broken) or enhancement (never defined)? Rate against the §19 release-gate bar, not against a pre-production project's normal state. |
| **A1-2** | `functions:sandbox:unrestricted-require-and-no-egress-policy` | high | `apps/fn-runtime/server.mjs:20` compiles tenant source with `new Function(...)` and a **full `createRequire`** — no module allow-list. Live probe returned `{"child_process":"object","fs":"object","net":"object","envKeys":21}`. Pods labelled `in-falcone.function=true`; **no NetworkPolicy selects that label**; they run in the platform namespace beside Postgres/Kafka/Keycloak/Temporal. | **Dedup is the deliverable.** Likely split: claims 2+3 ⊂ **#972**; the **module surface** plausibly new; **#948** may be the right home; Kafka leg ⊂ **charts#16**. Capability proof only — never open a socket to a platform datastore. |

## Withdrawn by the finders before reaching a verifier (recorded so they are not re-found)

- Function activation results are **not** unretrievable — `routes.mjs:313` exists and returns 200.
- `/v1/workspaces/{ws}/secrets` 404 was a **wrong path**, not a routing defect; the real path is
  `/v1/functions/workspaces/{ws}/secrets`.

## Incidental re-confirmations (already filed, no action)

**#959** internal `tokenEndpoint` · **#961** no `workspace_id`/`workspace_ids` claim on a
workspace-bound service account (the mechanism behind #973) · **charts#12** `falcone-ferretdb`
still `Init:CreateContainerConfigError` · **#983** `falcone-postgresql-vector-0` still `Pending` ·
#953, #980, #994, #966, #973, #992, #952, charts#20 all reproduced during the P26 walk.

---

# Fix run — 2026-08-09 · #965 (W0 order 1, portal-blocker)

First fix run against the triaged board (`docs/track-f/triage.md`). One issue, per the
one-issue-per-session rule. **#965** was selected as the highest-priority OPEN bug blocked by
nothing: triage §3.3 ranks it order 1 and explicitly sequences it *before* #997 ("fixing the
NetworkPolicy is pointless while the executor pod cannot start from a clean image").

## What was wrong

`apps/control-plane-executor` and `apps/workflow-worker` declared a **username** (`USER node`)
rather than a numeric UID. Kubernetes resolves `runAsNonRoot: true` against the image config's
numeric UID and will not read `/etc/passwd` inside the image to map a name, so both images were
unschedulable under the chart's default security context — `CreateContainerConfigError`,
*"container has runAsNonRoot and image has non-numeric user (node)"*.

## The fix — commit `0ce0c41c`

`USER node` → `USER 1000` in the two images named in the issue **plus
`apps/mcp-runtime/Dockerfile`**, a third instance of the identical defect that the issue's own
evidence grep missed. It is in contract: the issue's MODIFIED requirement is *"Every Falcone
service image SHALL declare a numeric non-root UID"*, not just the two observed.

`node` is UID 1000 in both `node:22-alpine` and `node:22-slim` (verified against the base
images), so this is the same identity — no file-ownership or permission change.

## Regression guard

`tests/blackbox/nonroot-numeric-uid.test.mjs` (5 tests) + `collectNonRootUserViolations` in
`scripts/lib/service-catalog.mjs`, wired into `collectServiceCatalogViolations` so
`scripts/validate-structure.mjs` and CI fail on any reintroduction — not just this one file.
The parser reads the **final** build stage only, since `USER` is stage-scoped and every `FROM`
resets it.

- On the **pre-fix** Dockerfiles: **4 of 5 fail**, naming all three images.
- On the **fixed** Dockerfiles: **5 of 5 pass**.
- Unit (80 fail) and contract (44 fail) suites are **byte-identical before and after** — those
  are pre-existing, from `../falcone-charts` being absent in this workspace.

Two adjacent corrections, both of which my change would otherwise have left contradicting the
shipped contract: `tests/blackbox/flows-interpreter.test.mjs` asserted `/USER\s+node/` — it
*encoded* the defect — and `apps/workflow-worker/README.md` documented `USER node` on
`node:22-alpine` (the worker is `node:22-slim`).

## Verifier verdict: CONFIRMED-FIXED

| Candidate | Verdict | Evidence |
|---|---|---|
| #965 non-numeric `USER node` | **CONFIRMED-FIXED** | A/B pods in `$FALCONE_NS`, identical security context, image the only variable |

The verifier did not trust the build handed to it — it rebuilt the executor and worker from the
working tree itself, and built a **controlled pre-fix twin** differing only in the `USER` line.

1. **The defect still reproduces, unmasked.** Two throwaway pods in `in-falcone-staging` with
   the live control-plane's exact context (`runAsNonRoot: true`, `fsGroup: 1001`, **no**
   `runAsUser`), same node, same command:
   - `ghcr.io/gntik-ai/in-falcone-control-plane-executor:0.3.0` (`Config.User=node`) →
     `CreateContainerConfigError`, original error verbatim.
   - `ghcr.io/gntik-ai/in-falcone-control-plane:0.3.0` (`Config.User=1000`) → **Running**,
     `uid=1000(node)`.
2. **The fixed build carries the admitted value.** All three fixed images and both independent
   rebuilds report `Config.User=1000` — byte-identical to the image this cluster's kubelet
   demonstrably admitted.
3. **Nothing else changed.** Full image-config diff against the pre-fix twin is one field:
   `"User": "node"` → `"User": "1000"`. Both reach the same `pg-pool ECONNREFUSED`; runtime
   identity `uid=1000(node) gid=1000(node)` before and after.

This also re-confirms the FINDINGS.md:411-419 result that #965 was **masked, not fixed** in
staging: `falcone-control-plane-executor` and `falcone-workflow-worker` are the *only two*
Deployments in the namespace carrying `runAsUser: 1000`.

**What the verdict does not cover** (verifier's own words, recorded rather than smoothed over):
neither spec scenario was proved by running a *fixed* image on the cluster. There is no safe
route — this host is not a cluster node, there is no in-cluster registry or `imagePullSecrets`,
containerd sockets are root-only, and the verifier rejected the remaining routes (privileged pod
mounting the node socket, pushing proprietary images to a public anonymous registry) as unsafe.
Both scenarios are proved by **controlled substitution**: the kubelet's decision was measured
empirically on the exact `.Config.User` values on this cluster, and the fixed artifacts carry the
admitted value with no other config change. Since that check is a pure function of one field when
`runAsUser` is nil, it determines the outcome. Post-admission behaviour of the new images
on-cluster is untested, though the UID is unchanged.

## Recorded, NOT fixed and NOT filed

- `packages/mongo-cdc-bridge/Dockerfile` still declares `USER node`. It is `release: false`
  (`evidenceOnly` non-release candidate) and no workload in `$FALCONE_NS` uses it, so it is
  outside #965's scope and outside the `release: true` contract the new guard enforces — but it
  would hit the identical failure if ever promoted. Surfaced by the verifier; left alone
  deliberately rather than fixed unverified.
- `tests/blackbox/flows-interp-007` fails on `apps/workflow-worker/Dockerfile must exist` —
  **pre-existing and unrelated**: `SVC` resolves to `services/workflow-worker`, a root
  `FORBIDDEN_OLD_ROOTS` deliberately forbids. Confirmed failing identically on a clean tree. The
  stale `USER node` assertion inside it was corrected; the stale path was **not** repaired — that
  is a separate defect, not this fix's scope.

## Real-world effect is gated on a republish

The fix is proven at build level. Staging will not exercise *"without the deployment supplying
`runAsUser`"* until new images are published **and** the `runAsUser: 1000` workaround is removed
from the two Deployments — that chart lives in `falcone-charts`, not this repo. Until then the
workaround keeps masking any regression. The CI guard, not the cluster, is what prevents
recurrence today.
