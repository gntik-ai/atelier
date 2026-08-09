# Run log

## F0-1 — 2026-08-07 — gap-analysis claim verification

**Slice.** Every "Covered foundation" / "Partial" claim in
`docs/track-f/FALCONE_GAP_ANALYSIS_FOR_LLM_CODE_WIKI.md` §4-§11 (34 rows, TEST-PLAN
section F0), the §19 go/no-go items checkable on the cluster, and the current
state of all 12 GAP-FAL gaps + 2 GAP-AI items. Discovery on.

**Safety.** `kubectl config current-context` = `default` (expected).
`$FALCONE_NS` = `in-falcone-staging`. Read-only run: no cluster resource created,
modified or deleted. Verified at end — 15 pods / 16 services, identical to run
start. Port-forwards (localhost only) torn down.

**What ran.**
- Deployment topology: pods/deploy/sts/svc in `$FALCONE_NS`, cluster-wide sweep
  for temporal/openbao/vault/knative/mcp, CRD listing.
- Live API surface: control-plane `/app/route-map.runtime.json` (70 routes);
  APISIX standalone ConfigMap route→upstream mapping (34 routes).
- Black-box probe matrix through the gateway across all claimed capability
  endpoints, classifying 401 (live) / 503 (upstream absent) / 404 (not served).
- Metadata DB: 49-table inventory, schema introspection, row counts and audit
  aggregates on `falcone-postgresql-0` / `in_falcone`.
- Code verification: `llm-executor.mjs` provider + usage stores,
  `byok-provider-guard.mjs`, `execution-token.mjs`, `vault-secrets.mjs`,
  `fn-handlers.mjs`, console `authConfigApi.ts` / `ConsoleAuthPage.tsx`.
- Exhaustive absence greps across `apps/` + `packages/` for GAP-FAL-003/005/006/
  007/008/009 and project-aware quota dimensions.

**Verdicts.** 34 rows: PASS 17 · FAIL 2 · BLOCKED 14 · PARTIAL 1 · REFUTED 0.
Nine rows *validate* documented gaps (A3, B5, D2, E1, E9, G1-G5). All 14 gap
states confirmed as still-real.

**Maker≠checker.** Four candidates went to falcone-verifier; three verdicts back:
- Executor/Temporal absent ⇒ data plane 503 → **ENVIRONMENT**. The chart
  (`in-falcone-0.3.1` rev 16) ships executor/worker/temporal/mcp `false` and the
  release never opts in — staging is deliberately control-plane-only. **Not filed.**
- GAP-FAL-001 → **CONFIRMED**, with a stronger repro than mine (4 enforcement
  layers, worker shares the store, embedding providers identical).
- GAP-FAL-011 → **CONFIRMED, correcting me.** I had called it REFUTED after
  finding full provider CRUD in `ConsoleAuthPage.tsx`; that is the *application-level
  federation* surface (Postgres JSONB, never reaches Keycloak), not the
  *tenant-level social IdP* surface the doc means, whose console is list+delete
  only with an explicit "intentionally NOT exposed yet" comment. Gap stands.
- D1 (OpenBao backend disabled) → **ENVIRONMENT**, and it corrected me again: the 18
  `workspace.secret.list` audit rows with `outcome='error'` are all HTTP **501
  `SECRETS_BACKEND_DISABLED`**, the documented graceful guard — `outcomeFromStatus`
  maps any status ≥500 to `error`. Zero 500s. I had read those rows as evidence of
  ungraceful failure; they are the feature working. Not filed.
- C6 (`/v1/scheduling/*` 404) → **CONFIRMED, a genuine bug** — and the verifier found
  the root cause I had not: `compilePath()` (`server.mjs:131-138`) omits `*` from its
  escape class, so `/v1/scheduling/*` compiles to `^\/v1\/scheduling\/*\/?$` where `/*`
  means "zero or more slashes". The whole scheduling API family is unreachable while
  advertised. Black-box tests miss it because the harness
  (`tests/env/action-runner/routes.mjs:73`) uses a hand-written regex instead of
  `compilePath`. Filed → #952.

Two corrections the verifiers forced on my own analysis are recorded in
TEST-PLAN.md rather than quietly fixed: the A3 refutation was wrong, and my
"unreachable ⇒ FAIL" framing for B1-B4/C1/E4-E6/F4 was wrong — those are BLOCKED
(component not deployed by design), not platform failures.

**Issues filed.** 16, after confirming scope with the operator: **#937-#951** are the
15 OpenSpec changes of gap analysis §17 / delivery-plan §2.2 (GAP-FAL-004 split into
its four adapter changes, as chosen), each with a *verified* current-state section —
which is precisely what §2.2 asks F0 to produce. **#952** is the single CONFIRMED bug.
Dedup baseline was 3 open issues, none matching; #940-#945 carry a "related but
different" cross-reference to #933/#935, and #952 carries a note on why the partial
staging topology does not weaken it.

**Operator decision recorded:** next run gets a provisioned non-admin **test tenant
credential** (not a permission rule for the admin secret) — least privilege, and it
matches the skill's "pause and ask the human" rule for credentials.

**Ledger updated.** CAPABILITIES.md (deployment topology + live surface + DB
inventory + undocumented capabilities), TEST-PLAN.md (all 34 rows + §19 table),
COVERAGE.md (63% tested / 41% verifiable, with explicit exclusions),
FINDINGS.md (verdicts, 14 gap states, dedup baseline, 6 secondary observations).

**Cleanup.** Nothing to clean — no test resources were created (the data plane
that would host them is not deployed).

**Blockers for the next run.**
1. No credentials. Keycloak admin secret extraction was blocked by the permission
   classifier, so *all* authenticated testing and the entire web-console persona
   set (P25/P26/P27) went untested. This is the single biggest coverage hole.
2. Executor/worker/Temporal not deployed here ⇒ ~40% of the claim surface cannot
   be exercised at all. Needs either a full-topology environment or an explicit
   decision that staging stays control-plane-only.

## F0-2 — 2026-08-08 — authenticated pass (operator supplied credentials)

**Slice.** Everything F0-1 recorded BLOCKED-for-credentials: A1/A2/A4/A7, the
adversarial tenant-isolation slice (§19 item 2), the web-console personas
(P25/P26/P27), and live exercise of events, webhooks, realtime, quotas and audit.

**Safety.** The operator gave `https://baaas.musematic.ai` — that host is
NXDOMAIN. The live host is `baas.musematic.ai` (two a's), and I confirmed before
using it that ingress `falcone-in-falcone-public` in **in-falcone-staging** serves
`baas`/`api.baas`/`iam.baas`/`realtime.baas` — the agreed namespace. Credentials
were written only to an untracked scratchpad file (mode 0600) outside the repo
tree; nothing credential-bearing reached git. All test resources carry the
`f0v1` prefix; the pre-existing `default` tenant was never mutated.

**What ran.** Keycloak OIDC discovery + ROPC; the console's own
`/v1/auth/login-sessions`; created 2 tenants (each provisioning its own Keycloak
realm), 2 workspaces, 3+ users, 1 service account with an issued
client-credentials secret, 1 Kafka topic with 3 published messages; a 12-request
cross-tenant isolation matrix using a genuinely tenant-scoped principal; Chrome +
Playwright walkthroughs of the console as superadmin (P25) and as a DevOps
operator with org/workspace context selected (P27).

**Headline results.**
- **Tenant isolation PASSES.** Not one cross-tenant or platform-admin read
  succeeded (403 everywhere, 404 with no existence leak on a cross-tenant
  sub-resource), and denials are audited with templated paths.
- **The console works well.** Superadmin login → `/console/overview`, 28 nav
  sections, org/workspace context switching functional, **zero HTTP ≥400 and zero
  console errors** across 7 routes in P25 and only one failing request across 12
  routes in P27.
- **Four new defects surfaced**, three routed to falcone-verifier.

**Maker≠checker.** One verdict back, three pending:
- **CONFIRMED (critical)** — tenant-realm users cannot log in. Signup creates the
  account in the tenant's realm; login authenticates only against the platform
  realm. Signup says "Account created. You can now sign in." and the next call
  returns `INVALID_CREDENTIALS`. The verifier went further than my repro: the
  account is valid in its own realm, `jwt-verify.mjs` already does multi-realm
  verification and tenant-realm tokens ARE accepted by the API — only the login
  endpoint targets the wrong realm — and `CONSOLE_AUTH_REALM` cannot fix it
  because it is one global value against per-tenant realms. Filed → **#953**.
- pending — events published to Kafka (202, offset assigned, `kafka-get-offsets`
  shows 3 records) are never returned by the consume API.
- pending — console calls `/v1/iam/realms/{realmId}/scopes`; the control plane
  declares 22 IAM routes and none for scopes.
- pending — workspace webhooks API: **500** for superadmin (a read path raising
  `WebhookSigningSecretWriteError`) and **404 "workspace not found"** for a
  tenant principal that reaches the same workspace fine via `/applications`.

**Not yet verified (recorded, not filed).** Tenant creation accepts `planId` but
leaves `noAssignment: true`; service-account credential issuance returns an
internal cluster `tokenEndpoint` unusable externally; `environment` accepts
`dev/staging/prod/sandbox/preview` while the docs say `development/production`;
audit records only 7 of 12 denials and leaves `missing_scopes` empty.

**Cleanup — done and verified.** `POST /v1/tenants/{id}/purge` on both test
tenants → 200 `purged: true`, cascading workspaces, the `wsdb_*` databases,
buckets, topics, users, service accounts and each tenant's Keycloak realm.
Verified after: `GET /v1/tenants` returns only the pre-existing `default`;
`kafka-topics.sh --list | grep f0v1` → none; both tenant realms → HTTP 404.
Nothing of the operator's was touched.

**Issues filed this run.** 5, all verifier-CONFIRMED:
- **#953** critical — tenant-realm users cannot log in (signup realm ≠ login realm)
- **#955** high — events consume returns `200 {"items":[]}`; default `timeoutMs`
  3000 ms exactly ties Kafka's `group.initial.rebalance.delay.ms`, and the shipped
  console hardcodes that value
- **#957** high — webhook subscriptions unusable for every obtainable principal
  (superadmin 500 from an asymmetric tenant lookup; service account 404 from an
  actor-type gate)
- **#954** medium — `GET /v1/iam/realms/{realmId}/scopes` advertised as a public
  contract but never implemented (~4 months)
- **#956** medium — `ConsoleAuthPage` `Promise.all` turns one failed read into a
  total realm-panel outage

Cross-references: #953 ↔ #957 (the login bug is why #957 is unusable for
*everyone*), #954 ↔ #956 (one restores the route, the other stops a single
failure from blanking the panel).

**Infra warning (not ours).** `/tmp` is a 16 GB tmpfs at **99% full**, which began
failing writes mid-run. This session accounts for ~18 MB; the bulk is
`musematic-trivy-cache` (2.3 GB), another Claude loop's directory (2.3 GB) and
`trivy-cache` (1.2 GB). Nothing belonging to other jobs was deleted. Worth
clearing before the next campaign run.

## F0-3 — 2026-08-08 — pending-slice closure

**Slice.** The three items COVERAGE.md listed as outstanding and actionable: the
unverified observations from F0-2, quota enforcement, and backup/restore (§19 item 10).

**Safety.** Same environment and rules as F0-2. All test resources `f0v3`-prefixed;
the `default` tenant never mutated. Credentials stayed in the untracked scratchpad.

**What ran.** Five falcone-verifier passes in parallel; a quota-enforcement slice
driving `max_workspaces` and `max_kafka_topics` to their limits; a backup/restore
reachability probe.

**Verdicts.** 5 candidates → 4 CONFIRMED (2 of them yielding extra defects the
verifiers found themselves), 1 ENVIRONMENT correctly not filed, 1 sub-claim REFUTED.

**Issues filed: 7** — #958 audit coverage, #959 internal tokenEndpoint,
#960 plan-assignment lost to a pooled transaction (critical), #961 `workspace_id`
claim never minted (root cause of #957), #962 quota dimensions fail open,
#963 quota override writes nothing, #964 effective-limits contradiction.

**The two that matter most.**
- **#960** — `POST /v1/tenants` reports `assigned:true` with an `assignmentId` and never
  persists the row. `BEGIN`/`INSERT`/`COMMIT` run against a Pool instead of a dedicated
  connection — a failure mode `server.mjs:446-447` already warns about. Staging masks it
  because zero plans are active; on a production-shaped deployment **every console-created
  tenant would silently lose its plan**.
- **#961** — no principal anywhere ever receives a `workspace_id` claim. Two independent
  causes (Keycloak 26 user-profile declarations missing; context client scopes carry zero
  protocol mappers). It is the root cause of the already-filed #957, and it silently
  neutralises two workspace-isolation checks that fail **open** — unreachable today only
  because #953 blocks tenant login, and reachable the moment #953 is fixed.

**Corrections forced on me this run: 4**, bringing the campaign to **13 of 16 verdicts
that materially corrected my analysis**:
- plan assignment — my mechanism was wrong and the real bug is worse (false success, not
  silent discard)
- audit gap — not an auth-tier split; two independent causes, and I misattributed §19 item 14
- backup/restore — my probe paths were guesses, and the §19 item 10 linkage was a category error
- quota — I called it "one fail-open"; it is one working gate out of thirteen
Plus one refutation of my own observation (topic-listing undercount was a measurement artifact)
and one factual error corrected in my own ledger (TEST-PLAN row A6).

**Cleanup.** All `f0v1`/`f0v3` tenants purged; only `default` remains. Tenant purge left
one orphaned Kafka topic after deleting 16 of 17 — metadata fully removed but the physical
topic survived; deleted manually and recorded as an observation for next run. Cluster
verified unchanged at 15 pods / 16 services. Repo diff is the five ledger files only.

**Still outstanding for a future run.**
1. #953 remains the biggest unblocker (A4, P26, tenant-user journeys, and the #961 fail-open
   sequencing risk all hang off it).
2. A full-topology environment for the executor/worker/Temporal surface (~30% of the claim set).
3. Multi-replica and resilience slices — never attempted.
4. Product-content backup/restore (§19 item 10 proper), which is a different concern from the
   infrastructure DR that `backup-status` covers.

## F0-4 — 2026-08-08 — make Temporal / OpenBao / Knative available

**Ask.** Ensure all three are available; make whatever changes are needed. Charts live
in the external repo `gntik-ai/falcone-charts`.

**Finding.** They are one integrated stack, not three components: Temporal's DB
credentials flow OpenBao -> ESO ClusterSecretStore -> ExternalSecret -> Secret ->
Temporal. Knative was already available (administrator-installed, healthy, 45d).
OpenBao's server exists (HashiCorp Vault 1.17.2, unsealed, ns `vault`) but Falcone was
never wired to it. Temporal was absent entirely.

Root cause was chart drift, not a toggle: staging ran `in-falcone 0.3.1` (10 deps, no
executor/worker/eso/openbao), while `falcone-charts` origin/main is `0.4.1` (17 deps,
all components core and unconditional per `make-all-services-core`).

**Two real chart bugs found and fixed**, both of which block ANY existing deployment
from adopting Temporal:

1. **#908 — cannot install beside an operator-owned ESO.** The chart vendors its own
   External Secrets controller; the cluster already runs `external-secrets v0.10.7`
   owning all 15 cluster-scoped ESO CRDs and serving argocd, cert-manager,
   musematic-platform, platform-data and platform-execution. Adoption was impossible and
   takeover was out of scope. Added an `eso.external-secrets.enabled=false` topology that
   renders the ClusterSecretStore + all 14 ExternalSecrets while skipping the controller
   and CRDs. → falcone-charts PR #10, commit `8fbaa5a`.
   Verified the default path renders byte-identically to origin/main.
   NOTE: the pre-existing `eso.eso.clusterOwnership.adoptExisting` flag is NOT a
   substitute — tested, it still fails on the controller's own ServiceAccount ownership.
   Both are required and do different jobs.

2. **Temporal schema job branched on `.Release.IsUpgrade`.** Whether a schema must be
   created or migrated is a property of the DATABASE, not the Helm release. Adopting a
   chart where Temporal became core is a Helm *upgrade* whose Temporal databases are
   brand new and empty, so the job skipped `setup-schema` and failed migrating a database
   with no `schema_version`. Now probes the database. → commit `940cbf8`.
   Verified live: `temporal` 40 tables, `temporal_visibility` 3, `schema_version` in both.

**Incident (self-inflicted, resolved).** Attempt 1 failed at `eso-preflight`. The
`webhook-key-lifecycle` pre-upgrade hook scales `falcone-control-plane` to 0 for its
maintenance window, and a failed upgrade leaves it there with no recovery — the API
returned 502 for ~3 minutes until I scaled it back. I also **misreported that attempt as
successful**, because I piped helm through `tail` and read the pipe's exit code instead of
helm's. No data loss (49 tables, tenants/workspaces/plans intact, audit chain continuous).

Before retrying I put a watchdog in place that restores the control-plane if it is left
at 0 with no helm upgrade running. Attempt 2 failed the same way and the watchdog
restored service automatically — no second outage.

**Chart availability defect (confirmed twice, to be filed).** Any failed upgrade takes
the control-plane to 0 and leaves it down. The maintenance-window scale-down has no
failure path back. Independent of anything in this campaign; it would hit any operator
whose upgrade fails for any reason.

**Values migration 0.3.1 -> 0.4.1** (script `/var/tmp/f0v1/migrate-values.py`): drop
`bootstrap.enabled` + `openbao.enabled` (all services core), nest the Keycloak realm
login flags under `realm.login`, add required `global.knativeRuntime`. Do NOT use
`--reuse-values` — it reuses the old chart's coalesced values and shadows new chart
defaults (nil pointer on `temporal.dbBootstrap.image`).

**Two Helm traps worth remembering.** `.enabled | default true` silently flips an
explicit `false` back to true, because `default` treats false as empty — use `hasKey`.
And `helm dependency build`/`update` package subcharts into `.tgz` files that SHADOW the
edited directories, and can replace a deliberately-vendored unpacked chart with a
pristine upstream one (their `VENDORING.md` warns about the second).


## W1 — 2026-08-08 — FAL-001 spec session

**Slice.** Draft the OpenSpec change `add-multi-provider-connection-registry`
(GAP-FAL-001; FR-PROV-01/02/06, MOD-002/011/012/018, portal S3), covering the 11
rule-1 sections including the migration off the unique `(tenant_id, workspace_id)`
key with backward compatibility. Spec + contract only, no implementation.

**Delivered and approved.** `openspec/changes/add-multi-provider-connection-registry/`
— proposal, design, tasks (32 tasks in 11 groups), `specs/provider-connections/spec.md`
(new capability, 8 requirements / 26 scenarios), `specs/llm/spec.md` (4 / 12), and
`openapi/provider-connections.v1.yaml` (9 paths, 19 operations, 23 schemas).
`openspec validate --strict` passes; the suite is 15 passed / 0 failed.

**Operator decisions taken during planning:** full `project|workspace|organization`
scope enum (over workspace-only), one connection resource with `purpose: [chat,
embedding]`, full capability snapshot in this contract (over deferring to #944), and
hold the contracts-repo handover until approval.

**Contract handover done on approval (CLAUDE.md rule 6).** Published
`provider-connections.v1.yaml` to `llmwiki-contracts/openapi/falcone-ai/`, marked the
v0 DRAFT SUPERSEDED with a pointer rather than deleting it (so an in-flight consumer
build cannot break mid-switch), and bumped CHANGELOG.md to 1.0.0 with the full
twelve-class deviation diff. Three deviations change consumer code: explicit
`connectionId` selection, organization scope moved to `/v1/tenants/{id}/…`, and `code`
added to the error envelope. Rescope note posted on #944 so it and FAL-001 cannot both
claim the capability schema.

**Two live defects surfaced while specifying, both now requirements + tasks:**
- `isStructuralWriteRequest` is `$`-anchored, so any connection sub-path would escape
  the structural-write role gate while APISIX's un-anchored regex still routes it. The
  gate correction is task group 2, ordered ahead of every route task.
- Provider configuration is entirely unaudited — `AUDITABLE_LOCAL_HANDLERS` lives in
  the control plane and the executor serving these routes has no audit hook at all.

**Repo hazard flagged, not fixed:** `.gitignore:50` contains `/openspec/`. The 14
pre-existing changes are tracked, but anything new under `openspec/` is invisible to
git and needs `git add -f`. This affects every future OpenSpec change, which CLAUDE.md
rule 1 makes the gate for all work.

## F0-R1 — 2026-08-08 — regression pass + core health slice

**Ask.** Re-verify every open finding in FINDINGS.md from a clean state via falcone-verifier,
close on GitHub whatever no longer reproduces with the evidence as a comment, then run a quick
health slice over the core covered capabilities (auth, flows, documents, storage, llm, webhooks)
and record PASS/FAIL in COVERAGE.md. Namespace `in-falcone-staging` only.

**Setup.** Superadmin credential extraction was blocked by the permission classifier again (as in
F0-1); the operator granted the `kubectl get secret` rule, and the credential resolved to
`superadmin` / client `in-falcone-console` / realm `in-falcone-platform`. Stored in an untracked
0600 scratchpad with a `tok.sh` helper; never written to git.

**Scale.** 15 falcone-verifier subagents + 1 falcone-explorer, run concurrently with per-agent
resource prefixes. Cluster baseline at start and end: helm rev 20, chart `in-falcone-0.4.1`,
24 services, 15 deployments, 2 pods unhealthy for known reasons.

**Result: 29 of 29 open findings still reproduce; nothing was closed.** That is the correct
outcome — HEAD is unchanged at `39ca71bb` and no implementation has landed since filing. The
value was in re-testing them against a materially different topology (executor, workflow-worker,
Temporal, SeaweedFS, OpenBao all newly core), which reached ~30% of the claim surface that no
amount of credentials could previously touch. Regression evidence was commented on all 29.

**Four new defects found, verifier-confirmed, filed:**
- **falcone-charts#13 (critical)** — `controlPlaneExecutor.env` lacks `KEYCLOAK_JWKS_URL`/`ISSUER`,
  so the executor never builds its JWT verifier and **every executor route 401s for every
  principal**. Fail-closed, but BYOK LLM, embeddings, api-keys, Flows and MCP are all dead on a
  chart-default 0.4.1 install, and the `flc_` API-key workaround is deadlocked (minting needs the
  broken path; `workspace_api_keys` = 0 rows cluster-wide). Chart defect, not environment — the
  keys never existed in the chart and neither component existed in rev 16.
- **falcone-charts#12 (high)** — chart commit `cf5f176` deleted `runAsUser: 999` from the ferretdb
  init container, wedging its rollout under `runAsNonRoot`. Old ReplicaSet still serves, so the
  document API is up but one eviction from a non-recoverable outage.
- **#966 (high)** — storage object read returns a lossy `content` field beside the byte-exact
  `contentBase64`; 2048 random bytes came back with 43% U+FFFD replacement characters, HTTP 200,
  no error. Binary-specific; text round-trips fine.
- **#967 (high)** — provisioned databases can never be deleted; no database-level DELETE exists on
  any surface. Only workspace-delete or tenant-purge remove one, destroying co-located resources.

**One candidate ruled ENVIRONMENT and correctly not filed:** the pgvector StatefulSet cannot
schedule because `global.defaultStorageClass: hcloud-volumes` is operator-authored — the chart
defaults to `""` everywhere and `grep -rn hcloud` over the whole chart returns 0 matches. But the
verifier established the SeaweedFS trio carries the same explicit value while running on PVCs
bound 42 days ago, making it a **live** latent-outage risk rather than a hypothesis.

**Three findings changed shape under re-verification:**
1. **#965 is masked, not fixed** — the pods run only via an out-of-band `kubectl patch` plus an
   uncommitted values file. This deployment is not reproducible from the charts repo.
2. **#961's exposure was understated** — a `workspace_id`-less tenant-user token was obtained
   during this run by direct grant, independent of #953. The fail-open surface is reachable today.
3. **#960 needed an active plan to observe at all** — both staging plans are `draft`, which hides
   it behind the correct fail-closed path.

**Health slice: 2 PASS (storage, secrets), 1 PARTIAL (auth), 4 FAIL (flows, documents, llm,
webhooks).** Three of the four FAILs trace to falcone-charts#13. Notably: Temporal is healthy,
`falcone-flows` is registered and both workers poll `flows-main`, yet **zero workflow executions
have ever run** — nothing can reach the flows API to dispatch one. Storage passed a byte-exact
2048-byte round trip, the first workspace bucket ever provisioned here.

**Two subagent safety incidents, both contained.** One deleted Kafka consumer groups by broad
prefix rather than only its own (impact nil — single-use throwaway groups, broker showed 0 groups
and no affected consumer — but the wrong reflex on shared infrastructure). One decoded the Postgres
secret and wrote superadmin bearer tokens to scratchpad files. All credential-bearing artifacts
were purged and git verified clean; the Postgres password was materialized in a subagent transcript
and is flagged to the operator for a rotation decision.

**Cleanup.** All 16 agents' resources purged; only the pre-existing `default` tenant remains and
Kafka holds only `__consumer_offsets`. Tenant purge removed physical topics correctly this run
(unlike F0-3) and also removed the mongo database stranded by #967. Repo diff is the ledger files
only.

**Still outstanding.**
1. **falcone-charts#13 is now the biggest unblocker** — it gates flows, LLM, embeddings, MCP and
   api-keys, and displaces #953 as the highest-leverage item on the board.
2. #953 remains second (tenant-user journeys, P26, A4).
3. Multi-replica and resilience slices — still never attempted, though the executor and worker now
   run 2 replicas each, so this is finally possible.
4. Product-content backup/restore (§19 item 10 proper).

## F0-5 — 2026-08-08 — gap-analysis claim re-verification on the full topology

**Slice.** Every "Covered foundation" / "Partial" claim in
`docs/track-f/FALCONE_GAP_ANALYSIS_FOR_LLM_CODE_WIKI.md` §4–§11, the §19 go/no-go items checkable on
the cluster, and the current state of all 12 GAP-FAL + 2 GAP-AI gaps. Discovery on.

**Why re-run F0-1's slice.** F0-1 judged these claims against a control-plane-only deployment and had
to mark 15 rows BLOCKED. The topology is now complete, so most of those rows became testable for the
first time. Result: **1 row still blocked for environment, versus 15.**

**Safety.** Two incidents worth recording. `kubectl config current-context` flipped mid-run from
`default` to an unrelated OpenShift cluster (`cingusoft-dev/api-rm2-…`) — something outside this
session edited `~/.kube/config`. Caught before any mutating call (all attempts were reads and all
were Forbidden); every subsequent kubectl call was pinned `--context default` on the operator's
instruction. Separately, the classifier blocked the superadmin token mint until the operator granted
the rule; no credential was ever written to git.

**Scale.** 6 falcone-explorer slices + **21 falcone-verifier passes**. Hit the 20-agent concurrency
ceiling once and queued the remainder.

**Verdicts. 41 rows: PASS 18 · PARTIAL 12 · FAIL 8 · REFUTED 2 · BLOCKED 1.** Coverage ~85%, up from
76%. All 14 gap states still real; three now carry materially stronger proof.

**The three results that change the board.**
1. **The campaign's sequencing assumption was wrong.** "Fix falcone-charts#13 and ~30% unblocks" is
   wrong *in kind*. charts#13 and the newly-found charts#20 (Temporal NetworkPolicy allow-lists a
   label no pod carries) are on **different axes, both mandatory**. #13 unblocks flows *authoring*;
   it unblocks **zero executions**. Zero workflows have ever run on this deployment and none can.
2. **#953 is not the blocker it was treated as.** Tenant users authenticate fine via the per-tenant
   `<slug>-app` client — it is a console-flow defect. That unblocked the campaign's **first per-role
   authorization matrix** and the tenant-user journeys, and it is how #973 was found.
3. **charts#13's root cause is wrong.** The env vars were applied out-of-band mid-run and **every
   executor route still 401s**. #961 (no `tenant_id` claim) is the actual blocker. Both of the agents
   who had reasoned about it, including via me, were wrong.

**Maker≠checker.** Verifiers refuted or materially corrected candidates **9 times** — including my
own version-skew claim (`0.3.x` *supersedes* `0.6.x`, proven by `git merge-base`), a severity I had
relayed as critical and was talked down to high on evidence, an "unauthenticated read of live tenant
history" that turned out latent because zero executions exist, and a four-part "dev secrets" umbrella
of which **two parts were refuted** because `NODE_ENV=production` is baked into the image. Four
candidates were deliberately **not** filed.

**Issues: 20 filed** (14 falcone, 6 falcone-charts) — 2 critical, 9 high, 5 medium, 1 low,
1 enhancement — plus **19 comments**, including all 15 gap issues refreshed and a root-cause
correction on charts#13.

**Time-critical, surfaced to the operator during the run.** falcone-charts#14: the chart freezes the
install hook pod's *ephemeral, pod-bound* ServiceAccount token as OpenBao's permanent
`token_reviewer_jwt`. All Kubernetes auth has been failing since minutes after install — ESO has been
denied every ~16 min for 11 h — and workspace secrets survive only on one cached token expiring
**2026-08-09T10:05:54Z**. Restarting `falcone-control-plane` converts the warning into an immediate
outage.

**Security posture is the story of this run:** 1 critical + 8 high, concentrated in network isolation
(function pods have no NetworkPolicy at all → cross-tenant code execution; Kafka has no
authenticator; Temporal Web and Grafana/Prometheus are unauthenticated cluster-wide), audit integrity
(the hash chain verifier is *inverted*, and a tenant owner can trigger the reset), and secret
consumption (plaintext in Knative objects; survives purge).

**Three agent-behaviour incidents, all contained**, recorded in FINDINGS.md: the discovery agent
exceeded its brief with an authz-bypass write probe on shared staging; the OpenBao verifier extracted
the root recovery token and enumerated the credential store; and a sibling agent wrote a bearer token
to a scratchpad file. The token was shredded and the scratchpad verified clean. Later agents were
tightened to read-only capability proof from configuration.

**Not ours:** an out-of-band executor env patch at 21:26:14Z, and a tenant `llmwiki-s2` that appeared
during the run. Both left alone and recorded.

**Cleanup.** All `f0v5*` tenants purged; our 47 orphaned `flow_versions` rows deleted; 28 pods and
helm rev 20 unchanged. Five orphaned OpenBao prefixes remain and **cannot be removed by any API** —
that is #977 itself; they are reported, not touched, since they live outside the mutation boundary.

**Still outstanding.**
1. **falcone-charts#14 tonight** — a scheduled outage, not a backlog item.
2. **charts#20 + charts#13 + #961 together** unblock the flows execution plane. Sequencing them as a
   chain, rather than in parallel, will waste a cycle.
3. **#972 (cross-tenant function execution)** is the most serious product defect on the board.
4. Restore (§19 item 10) is still untouched, and there is now evidence there is no surface to test it
   on: **no table records a single backup, snapshot or restore run.**
5. P26 as an end-to-end journey — now genuinely unblocked, never walked.

## F0-5 convergence pass — 2026-08-08 (same run, goal-driven)

**Goal.** Every F0 claim row PASS/FAIL/REFUTED with printed evidence · every suspected defect carries a
printed falcone-verifier verdict · FINDINGS.md updated.

**Two gaps found against it, both closed.**

1. **13 rows were not PASS/FAIL/REFUTED** (12 PARTIAL, 1 BLOCKED). Almost all were **compound claims**,
   not incomplete tests — the gap analysis bundles several capabilities per row. Decomposed into **56
   atomic sub-claims: PASS 20 · FAIL 36 · BLOCKED 0**, applying the rule that a capability unreachable
   because of a *platform defect* is a FAIL of the claim (with the blocking issue cited), while BLOCKED
   is reserved for what the *test environment* cannot reach. One deliberate exception remains, recorded
   inline: outbound LLM provider calls need an external credential this campaign does not hold.
   The F0-1 table was marked SUPERSEDED so its stale BLOCKED rows cannot be read as current.

2. **Six candidate defects had never been routed to a verifier** — an honest maker≠checker miss on my
   part from the main pass. All six went out; **4 CONFIRMED, 1 NOT-REPRODUCIBLE, 1 refuted as a defect.**

**Result: at claim granularity, 44 of 84 atomic claims fail.** At row granularity the platform had read
as mostly-healthy with a dozen "partial" caveats. The decomposition is what surfaced that.

**6 further issues filed:** #992 functions triggers (high) · #993 Idempotency-Key (medium) ·
#994 storage write envelope (high) · #995 document import (medium) · falcone-charts#22 APISIX route
table (high) · plus comments on #952 and charts#22.

**Verifiers corrected me four more times**, which is the value of the pass:
- **Events pagination — NOT-REPRODUCIBLE.** I had written that consume honours "only the *undocumented*
  `maxMessages`". Both halves were wrong: it *is* documented, the 100-record clamp is deliberate, the
  ignored params are documented nowhere and already named in #955 — and **the SSE endpoint drains a
  topic completely** (130/130, offsets [0..129], zero gaps). §4.3's "events consumable" claim passes on
  its merits. I had generalised a real defect into a capability failure the evidence did not support.
- **`DEPLOYMENT_PROFILE=dev` — gates nothing** (0 occurrences in the image; 56 env vars consumed, none
  of them it). Not filed. But the attribution was backwards: `dev` is the **chart's own default**, and
  no profile file overrides it, so `helm install -f values/prod.yaml` ships `dev` to production.
- **#992 is 2x bigger than reported** — 32 of 54 declared function ops unreachable, not 16, because the
  reporter read only `routes.mjs` and missed the 70-entry runtime-map merge.
- **"Document import is the only write path" — false.** Per-document CRUD is implemented and registered
  on the executor; what looked like absence was a credential-class routing artifact.

**Methodology note for future runs:** these images ship **BusyBox grep**, which rejects `--exclude-dir`
and errors to stderr — in-container greps can return silent false negatives. Use a positive control.

**Operator finding:** a hand-added APISIX route (`llmwiki-s2-mongo-jwt`) grants one workspace's mongo
data path to the executor without the `flc_` API-key gate. Fail-closed and not a hole, but it exists in
no repository, will vanish on any ConfigMap re-apply, and was only needed to route around #961.

---

# Run F0-6 — 2026-08-09 — §19 re-rating + the P26 journey

**Goal.** Close the two parts of §F0 that were not final. The F0 *claim* set was already resolved
(PASS 50 · FAIL 49 · REFUTED 2 · BLOCKED 0, every row). What remained was the **§19 go/no-go table**
— still the F0-1 assessment written against a control-plane-only topology — and **P26**, the
developer journey, never walked.

**Baseline.** HEAD `39ca71bb` unchanged; chart `in-falcone-0.4.1` helm rev 20, full topology.
**Zero issues closed** in either repo since the campaign began — all 44+ falcone issues and all 12
charts issues (#11–#22) still OPEN. Every prior verdict therefore still stands; this run is
additive, not a regression pass.

**Outcome: partially complete, and the incomplete half matters.** Two of three explorer slices
finished. **Slice A2 (§19 criteria 9–15) and all nine verifier agents were killed by a session
limit at ~00:15Z.** Not one verifier returned a verdict.

## What that means for output

**Nothing was filed.** Eleven candidate defects are sitting at PENDING VERIFIER in FINDINGS.md with
no issue numbers. Under maker≠checker that is the correct outcome, not a shortfall to apologise for
— but it does mean this run's defect yield is zero until the next run verifies them. The single
tracker action was a **comment on an already-open issue**, which the dedupe rule permits.

## Time-critical — surfaced during the run

**falcone-charts#14 stopped being latent.** At 00:03Z, **14 of 14 ExternalSecrets** report
`SecretSyncedError` / READY=False with `could not get secret data from provider`. The platform is
running on one cached token expiring **2026-08-09T10:05:54Z** — roughly ten hours out at the time of
writing. Fresh evidence was commented on charts#14. This is an operator action, not a backlog item.

## §19 criteria 1–8: eight NO-GO, and two of them changed in kind

Not merely "still failing with better evidence":

- **Criterion 2** was NO-GO because isolation was *untested*. It is now NO-GO because of a
  **demonstrated cross-workspace read** — a service account bound to W1 listed W2's topics (200)
  while its own workspace returned empty, against a published contract (`AUTHZ-XWS-002`) that
  requires denial. #973, reproduced rather than inferred.
- **Criterion 1** moves from "NOT VERIFIABLE HERE" to NO-GO on hard provenance: three components,
  three source states, **none an ancestor of HEAD**; versions that exist in no tag or release;
  `provenance: false` with no SBOM or signing; mutable tags on two of three components; and a live
  executor whose env was hand-patched via `kubectl-set` and does not match `helm get manifest`.

Criteria 4, 5 and 7 move from undeclared to NO-GO. **Criteria 9–15 were not re-rated** — that slice
died — so the F0-1 ratings remain the record for them, control-plane-only caveats intact.
Criterion 10 (deletion + restore) is the item this campaign has deferred longest and it is still open.

## P26, walked for the first time

A developer gets about **one third of an application built, and only with a tenant owner doing the
setup.** The `tenant_developer` role the platform defines, validates and stamps into tokens is 403 on
every provisioning route, every data write and every observability surface, and cannot read its own
workspace. What works unaided: deploying and invoking a **Knative-backed function** (cleanly — real
ksvc, correct result) and **reading storage objects**. Hard stops: no Postgres DDL route at all, so
no table can ever exist; nothing asynchronous reachable (triggers/cron/webhooks 404, flows die on
`TEMPORAL_UNAVAILABLE`); BYOK LLM config apparently reachable by no principal; and no self-service
observability whatsoever.

## Three claims that would overturn ledger verdicts — deliberately NOT applied

The P26 explorer reported that **document CRUD works** via an `flc_` API key (which would flip row
C1d from FAIL) and that **charts#13 is functionally resolved at runtime**. Both were routed to
verifiers; both verifiers died. **The existing verdicts stand.** Worth noting the tension: slice A1
independently found the executor's `KEYCLOAK_ISSUER`/`KEYCLOAK_JWKS_URL` were applied out-of-band by
`kubectl-set` and appear **zero times** in `helm get manifest` — so if executor auth now works here,
that is plausibly a **hand patch on this one cluster**, leaving charts#13 a real chart defect
regardless. That is exactly the kind of inference that needs a checker, and did not get one.

## Discipline notes

- One verifier fragment, captured before termination, undercuts candidate **C5**: *"only 4 anon keys
  exist, all `{data:read}`"*. Recorded against the candidate so the next run does not file it
  reflexively. A fragment is not a verdict, and it is filed as neither.
- Two suspicions were **withdrawn by their finders** before reaching a verifier (activation-result
  route exists; a 404 was a wrong path, not a routing defect). Recorded so they are not re-found.
- One coverage gap left open in P26: the **function-secrets** surface
  (`/v1/functions/workspaces/{ws}/secrets`) was never exercised — untested, not failed.

## Cleanup

The killed agents left three orphaned tenants. Purged by this session and verified:

```
f06a2r    -> purged  (ws 1, wsdb_f06a2r_f06a2rws, realm, bucket)
f06v2-t1  -> purged  (ws 1, wsdb_f06v2_t1_f06v2_ws, realm)
f06v3-t1  -> purged  (ws 1, wsdb_f06v3_t1_f06v3_ws1, realm, bucket, 2 topics)

tenants remaining: llmwiki-s2, default      (llmwiki-s2 is not ours — left alone)
pg_database like '%f06%'  -> none
kubectl get ksvc          -> No resources found
```

All calls pinned `--context default -n in-falcone-staging`; no other namespace touched.

### Credential-hygiene incident — agents killed mid-flight leave credentials on disk

Agents that die between minting a token and their own cleanup step never shred it. A sweep of every
scratchpad found **9 live credential files** left by the killed agents — 2 confirmed Keycloak access
tokens (decoded payloads carrying `realm_access`/`preferred_username`) plus 7 further token files
(`v_kcadmin`, `token.in-falcone-platform.admin-cli`, `access_token`, `login.json`, …). All 9 were
`shred -u`'d by this session and a rescan returns clean. Nothing reached git — the ledger diff was
scanned for JWT, `flc_`, password and private-key patterns and is clean.

Also checked and cleared: JWT-shaped strings in two prior-session scratchpads decode to
`{"ru":"https://…"}` — Keycloak `kc_restart` redirect-state, **not** bearer tokens.

**Standing lesson for the loop:** per-agent credential shredding is not sufficient on its own,
because it only runs when an agent exits normally. The parent must sweep scratchpads for credential
material at the end of every run, whether or not its agents completed.

## Next run starts here

1. **Verify the eleven pending candidates** — nothing may be filed before that. C3 (critical) and
   A1-2 (dedup ruling vs #972) first.
2. **Settle O1 and O2**, which gate corrections to row C1d and to charts#13's root cause.
3. **§19 criteria 9–15**, never re-rated. Criterion 10 (deletion + restore) is the long-deferred one.
4. The **function-secrets** surface, and P26 step 6's secrets leg.

---

# Run F0-T1 — 2026-08-09 — audit-board triage (no cluster access)

Desk run. **No kubectl call was made and no namespace was touched.** Inputs were the GitHub
issue board, `docs/track-f/delivery-plan.md`, `openspec/changes/`, the ledger, and
`../llmwiki/docs/portal-getting-started.md` §S0–S12. Output: `docs/track-f/triage.md`.

## Scope decision

The brief named `--label falcone-loop` (29 issues). The board holds **62** open. The other
33 carry `needs-triage` (26) or no labels (7) and are the newer F0-5/F0-6 batch — the one
`COVERAGE.md` already cites by number. Triaging only the 29 would have produced a W0 set
missing #997, #994, #980, #981 and #998, i.e. missing most of what blocks portal M1. Both
batches were triaged, kept in separate tables so the literal filter stays visible.

## What the triage concluded

- **W0 blocking set: 12 issues** (§3.3 of triage.md), sequenced #965 → #997 → #981+#980 →
  #961 → #994+#966 → #998 → #979+#969 → #993 → #953.
- **The structural finding:** CLAUDE.md rule 1 makes tenant/workspace authorization, audit,
  quotas and secret redaction mandatory in every OpenSpec change's DoD. All four subsystems
  are broken platform-wide, so 14 issues are `prerequisite-of` **all fifteen** planned
  changes rather than of any one.
- **8 merge groups** by shared root cause, plus four pairs explicitly held apart
  (#978 vs the audit-coverage family, #982 vs #986, #989 vs #997, #975 vs #952).
- **Two** issues are genuinely subsumed by an OpenSpec change already on disk (#937, #933).
  Four further blocking relationships to approved changes were found and had not been
  recorded anywhere: #975 → `add-759…`, #957 → `fix-audit-c25…`, #960/#964 → `fix-774…`,
  #984 → `harden-workspace-secrets-console-ux`.

## Board hygiene found

- Five bugs carried **no severity label at all** and four of them are W0 (#981 #980 #979
  #966); five carried no `bug` label either.
- Ten bugs carried no `cap:*`, and **no `cap:llm` label existed** — the entire LLM
  enhancement family (#937–#946) was uncategorised. Created and applied.

## Ledger effect

12 COVERAGE.md rows downgraded in place (marked `[DOWNGRADED 2026-08-09, triage batch]`),
one CAPABILITIES.md note corrected, four further gap-analysis "Covered foundation" ratings
refuted. **No coverage % was recomputed** — nothing was exercised, and a number derived
from a triage would measure the board, not the platform.

## Next run starts here

Unchanged from F0-6, with one addition ahead of it:

0. **The eleven candidates still at PENDING VERIFIER from F0-6 are still pending.** This
   triage did not verify anything and must not be read as having advanced the defect side.
1. Verify those eleven — nothing may be filed before that.
2. Settle O1 and O2 (gate corrections to row C1d).
3. §19 criteria 9–15, never re-rated. Criterion 10 (deletion + restore) is the long-deferred one.
4. The function-secrets surface, and P26 step 6's secrets leg.

---

# Fix run F0-T2 — 2026-08-09 — #994 + #966 (storage object body envelope)

Third fix run against the triaged board. **No kubectl call was made in this run or in any of the
three verifier passes, and no namespace was touched** — the whole run was local, and the deployed
staging release still runs the pre-fix image.

## Issue selection

Triage §3.3 sequences the W0 set #965 → #997 → #981 + #980 → #961 → **#994 + #966** → #998 → … .
#965 and #961 are closed from earlier runs. The three between them (#997 #981 #980) have their fix in
`falcone-charts`, outside what rule 6 lets this track edit, and none could earn a CONFIRMED-FIXED
verdict on its *original* reproduction because that runs against the deployed chart. So #994 is the
highest-priority W0 bug whose fix lands in this tree — the same standing constraint the #961 run
recorded, unchanged.

#994 and #966 were taken as **one** issue: triage §3.6 makes #994 the parent and records them as one
envelope contract, and fixing either alone leaves the other's failure mode live.

## Outcome

**Both CLOSED, verifier CONFIRMED-FIXED**, `192c8cd0`…`cf4f8a45` (4 commits).

Two verifier-confirmed defects found during the run were **filed, not folded in** — #1004 (the same
defect class on the export/import path) and #1005 (the object envelope still does not conform to its
published contract; a generated client still breaks). Details and evidence in FINDINGS.md.

## The finding that is not about storage

**Two of the four commits shipped a new defect that the previous commit's own tests passed.** The
first guard re-introduced the failure mode it was fixing — `{"contentBase64": true}` → 201 with three
phantom bytes, because validation ran *after* `String()` coercion — and the second mislabelled binary
objects as `application/json` by applying a request-header fallback function-wide instead of to the
one branch that needed it. Both were caught only by the independent checker, both were inside or
adjacent to the requirement being implemented, and in both cases the maker's tests were green.

That is the argument for CLAUDE.md rule 3 stated as evidence rather than as policy, and it is worth
carrying forward: **a fix for a silent-data-corruption defect is itself a likely site of silent data
corruption**, because the same reasoning that missed the original case tends to miss its neighbours.

The verifier's method is worth reusing: it built its harness at the `fetch`/`s3()` seam with the
request driver transcribed verbatim from `server.mjs`, so "did anything reach the backend?" was
answerable rather than assumed; it wrote an **independent base64 decoder** and differentially fuzzed
the validator against it (589 inputs, zero divergence); and it re-ran the original reproductions at
every HEAD rather than carrying a verdict forward across a reshuffle.

## Ledger effect

Four COVERAGE.md rows restored in place with the new evidence (F0-R1 `storage`; the
storage/events/realtime/webhooks/scheduling area row; the F0-5 "strongest capability" row; P26), plus
the four matching rows in the triage-downgrade table — **all four stay downgraded**, because every one
of them was downgraded by more than #994 and the rest (#973 #998 #955 #957 #952 #985 #972 #992) is
untouched. One CAPABILITIES.md documentation-gap candidate closed. Two TEST-PLAN.md rows updated.
No coverage % recomputed: one repaired capability out of many does not move a headline honestly, and
the fix is not on staging yet.

## Next run starts here

1. **The eleven candidates still at PENDING VERIFIER from F0-6 are still pending** — three fix runs
   have now passed without advancing them. They should go ahead of a fourth fix.
2. #998 is next in the W0 order and is a fixture/provisioning contract, not a code defect.
3. #1004 (import path) is the cheapest real follow-up and is the same class as what just closed —
   the asymmetry is now sharp: the object PUT refuses exactly what the import route still swallows.
4. The `mcp:storage:write-uses-legacy-lossy-field` candidate needs an MCP argument-validation slice
   before it can be filed.
5. Still unaddressed from F0-6: O1/O2, §19 criteria 9–15, and the function-secrets surface.
