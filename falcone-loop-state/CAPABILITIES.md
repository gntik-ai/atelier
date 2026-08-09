# Capability inventory

Discovered from the live deployment ($FALCONE_NS=in-falcone-staging, context
`default`) and the repo, run F0-1 (2026-08-07). Merge, never overwrite.

## Deployment topology (DISCOVERED — was not in the inventory before)

The platform is split across three deployable units. **Only one is deployed.**

| Unit | Repo path | Deployed in staging? | Owns |
|---|---|---|---|
| control-plane | `apps/control-plane` | **YES** (1/1) | tenants, workspaces, applications + federation providers, plans/quotas, events, realtime pg-captures, webhooks, backup scope, capability catalog, config export/migrate |
| control-plane-executor | `apps/control-plane-executor` | **NO — Service `falcone-cp-executor` does not exist** | flows, functions, storage, postgres/mongo data APIs, LLM + embedding providers, api-keys, MCP, realtime SSE |
| workflow-worker | `apps/workflow-worker` | **NO** | Temporal DSL interpreter + activities (`llm.complete`, `db.query`, `storage.*`, `events.publish`, `functions.invoke`, `http.request`, `email.send`) |

Supporting infra actually running in `in-falcone-staging` (15 pods): apisix,
control-plane, documentdb, ferretdb (2), grafana, kafka, keycloak,
observability, postgresql, seaweedfs (filer/master/s3/volume), web-console.

Cluster-wide: `knative-serving` + `kourier-system` present (0 ksvc);
`vault` namespace running vault-0. **No Temporal server anywhere** (no pods,
no CRDs).

## Live API surface (control-plane runtime route map: 70 routes)

- Plans/quotas: `/v1/plans*`, `/v1/quota-dimensions`, `/v1/tenants/{id}/quota/*`,
  `/v1/workspace-sub-quotas`, `/v1/tenant/plan/*`, `/v1/workspaces/{id}/consumption`
- Identity/tenancy: `/v1/tenants/{id}`, `/auth-config`, `/users`,
  `/v1/tenants/{id}/invitations`, `/v1/workspaces/{id}/applications*`,
  `.../federation/providers` (GET/POST/PUT — no DELETE), `/service-accounts`
- Events: `/v1/events/workspaces/{ws}/topics`, `/topics/{t}/messages`, `/publish`
- Realtime: `/v1/realtime/workspaces/{ws}/pg-captures`, `/v1/workspaces/{ws}/realtime`
- Ops/admin: `/v1/admin/backup/scope`, `/v1/capability-catalog`,
  `/v1/admin/tenants/{id}/config/{export,migrate,reprovision,validate}`,
  `/v1/tenants/{id}/scope-enforcement/audit`, `/v1/async-operation-query`
- Privilege domains: `/api/workspaces/{ws}/privilege-domains(/audit)`

## Metadata DB (`in_falcone`, 49 tables)

Present: plans, tenant_plan_*, quota_*, tenants, workspaces, tenant_invitations,
service_accounts, external_applications, workspace_{buckets,databases,
mongo_databases,topics,functions,sub_quotas}, fn_{actions,action_versions,
activations}, webhook_* (owned by separate `falcone_webhook_schema` role —
least-privilege separation verified), saga_runs/steps, async_operations,
backup_scope_entries, plan_audit_events (hash-chained: prev_hash/row_hash),
scope_enforcement_denials, quota_enforcement_log, pg_capture_*,
boolean_capability_catalog, quota_dimension_catalog, deployment_profile_registry,
retry_*, idempotency_key_records, failure_code_mappings, operation_policies.

**Absent:** `workspace_llm_providers`, `workspace_llm_usage` (created lazily by
`CREATE TABLE IF NOT EXISTS` at executor startup — executor never started here).

## Secrets

OpenBao/Vault-backed workspace secrets implemented in
`apps/control-plane/vault-secrets.mjs` + `fn-handlers.mjs`, console UI in
`apps/web-console/src/services/secretsApi.ts` (metadata-only, no value field),
rotation actions present. Enabled by `BAO_ADDR`/`BAO_TOKEN` (or legacy `VAULT_*`).
**Not configured on the staging control-plane deployment → backend disabled.**

## LLM / BYOK

`apps/control-plane-executor/src/runtime/llm-executor.mjs` — OpenAI-compatible
`/chat/completions` HTTP backend + SSE streaming, provider store, usage store.
`byok-provider-guard.mjs` — fail-closed secret confinement (reserved `BYOK_`
env-var prefix allow-list) + endpoint SSRF guard (RFC1918/loopback/link-local/
metadata blocklist, DNS-rebinding revalidation). Embedding executor parallel.
`apps/workflow-worker/src/activities/llm-complete.mjs` — Flow `llm.complete`.

## Undocumented / notable (documentation gap candidates)

- `deployment_profile_registry`, `boolean_capability_catalog`,
  `failure_code_mappings`, `retry_semantics_profiles`, `operation_policies`,
  `manual_intervention_flags` — capability/plan machinery not described in the
  gap analysis.
- Hash-chained (tamper-evident) plan audit via `prev_hash`/`row_hash`.
- Per-role DB separation for the webhook engine (4 distinct DB roles).

## Temporal / OpenBao / Knative availability analysis (2026-08-08)

**They are not three independent components — they are one integrated stack.**
Temporal's database credentials arrive as:

```
OpenBao (platform/temporal)  ->  ESO ClusterSecretStore "openbao-backend"
  ->  ExternalSecret platform-temporal-credentials  ->  Secret in-falcone-temporal
  ->  Temporal db-bootstrap-job / schema-job / server roles
```

So "make Temporal available" necessarily means bringing up OpenBao **and** the ESO
wiring. `charts/eso/templates/external-secrets/` materialises platform-postgresql,
-s3, -keycloak, -kafka, -documentdb, **-temporal** and gateway-apisix the same way.

### Current state

| Component | Status |
|---|---|
| **Knative** | **AVAILABLE** — `knative-serving` (activator, autoscaler, controller, webhook, net-kourier) + `kourier-system` all Running, 12 CRDs, 45d old, administrator-installed. 0 ksvc because nothing has deployed one. `global.knativeRuntime` in chart 0.4.1 is *status wiring* for the managed-lifecycle feature, not a prerequisite for functions. |
| **OpenBao** | **Server available but Falcone is not wired to it.** HashiCorp Vault 1.17.2 in ns `vault`, initialized, **unsealed**, raft storage. Falcone's `vaultStoreFromEnv()` accepts legacy `VAULT_ADDR`/`VAULT_TOKEN` as a fallback, so it is usable — but the deployed control-plane sets no `BAO_*`/`VAULT_*` env, so the workspace-secrets backend answers 501. The chart instead bundles its own OpenBao StatefulSet in ns `secret-store`. |
| **Temporal** | **ABSENT** — no pods, no CRDs, nothing cluster-wide. |

### Why it is not deployed: the chart lineage diverged

- **Deployed:** `in-falcone 0.3.1`, rev 16. A *reduced* chart — 10 dependencies, **no**
  controlPlaneExecutor / workflowWorker / eso / openbao / postgresqlVector. Carries 7
  Temporal templates but gates them behind `temporal.enabled=false`. No 0.3.1 source
  exists anywhere on disk.
- **`gntik-ai/falcone-charts` `origin/main`:** `in-falcone 0.4.1` (merge of PR #9,
  managed-Knative lifecycle). 17 dependencies **including** controlPlaneExecutor,
  workflowWorker, eso, openbao, postgresqlVector. Per `make-all-services-core`, every
  per-component `enabled` toggle is **removed** — Temporal, OpenBao and the executor
  render **unconditionally**. 8 Temporal templates plus
  `knative-runtime-namespace-registration.yaml` and `openbao-auth-identities-configmap.yaml`.

So the fix is an upgrade to 0.4.1, not a toggle flip — the deployed chart has no toggle
to flip for the components that are missing entirely.

### Values migration 0.3.1 -> 0.4.1 (worked out and validated)

1. Strip `bootstrap.enabled` and `openbao.enabled` — all services are core in 0.4.1.
2. Keycloak realm login flags move flat -> nested under `realm.login` (staging carried
   `login: null`, which the new schema rejects).
3. New required block `global.knativeRuntime`.
4. **Do NOT use `--reuse-values`** — it reuses the old chart's coalesced values and
   shadows new chart defaults, producing a nil-pointer on `temporal.dbBootstrap.image`.
   Pass the extracted user config explicitly instead.

Script: `/var/tmp/f0v1/migrate-values.py`; output validated to the point of the blocker below.

### BLOCKER — this is open issue #908, and it guards shared infrastructure

`helm upgrade` to 0.4.1 fails:

```
CustomResourceDefinition "acraccesstokens.generators.external-secrets.io" exists and
cannot be imported into the current release: annotation "meta.helm.sh/release-name"
must equal "falcone": current value is "external-secrets"
```

The cluster already runs `external-secrets v0.10.7` (release `external-secrets`, ns
`external-secrets`) owning **all 15 ESO CRDs**, and it serves **argocd, cert-manager,
musematic-platform, platform-data and platform-execution** plus ClusterSecretStores
`vault-backend` and `vault-musematic`. Adopting or removing it would break other teams'
workloads, so that is out of scope under the campaign safety rule.

The 0.4.1 chart vendors its own `external-secrets` and `validate.yaml:361` forbids
`installCRDs=false`, so there is currently no supported way to install beside an existing
ESO — exactly what #908 describes. Note the *controller* is what collides; the
ClusterSecretStore and ExternalSecret resources would reconcile fine against the
cluster's existing controller.

### RESOLVED 2026-08-08 — all three components now available

Staging upgraded `in-falcone 0.3.1` -> **0.4.1** (falcone-charts) at revision 20, `deployed`.

| Component | State | Evidence |
|---|---|---|
| **Temporal** | **WORKING** | 5 roles Running (frontend/history/matching/worker/web). Schema installed (`temporal` 40 tables, `temporal_visibility` 3, `schema_version` in both). Namespace `falcone-flows` registered with the ADR-11 search attributes (tenantId, workspaceId, flowId, flowVersion, triggerType). `workflow-worker READY namespace=falcone-flows taskQueue=flows-main`, worker state RUNNING. |
| **OpenBao** | **WORKING** | `openbao-0` Running in ns `secret-store`. Control plane wired: `BAO_ADDR`, `BAO_KUBERNETES_AUTH_ROLE=workspace-secrets-role`, `BAO_KV_MOUNT=secret`. Workspace secrets API returns **200** (was 501 `SECRETS_BACKEND_DISABLED`). |
| **Knative** | **WORKING** | Was already installed cluster-wide. 1 ksvc now exists; the executor ServiceAccount can create `services.serving.knative.dev` in the namespace. Functions inventory API returns 200. |

Also now deployed: `control-plane-executor` (2 replicas) and `workflow-worker` (2 replicas) —
the data plane that F0-1 recorded as entirely absent. `/v1/flows/...` went **503 -> 401**
(reachable, auth-gated) after the gateway fix below.

**Four defects had to be fixed to get here** — all filed:
1. falcone-charts **PR #10** — chart could not install beside an operator-owned ESO (issue #908).
2. falcone-charts commit `940cbf8` — Temporal schema job branched on `.Release.IsUpgrade`
   instead of probing the database, so adding Temporal to an existing release always failed.
3. falcone **#965** — `control-plane-executor` and `workflow-worker` images use non-numeric
   `USER node`, so they can never start under `runAsNonRoot: true`. Worked around with
   `runAsUser: 1000`; the images still need `USER 1000`.
   **[FIXED 2026-08-09 — see FINDINGS.md "Fix run — #965", verifier CONFIRMED-FIXED.]** Both
   Dockerfiles now declare `USER 1000` (as does `mcp-runtime`, a third instance of the same
   defect), guarded by `tests/blackbox/nonroot-numeric-uid.test.mjs`. The `runAsUser: 1000`
   workaround on the two Deployments is still in place and still masks the defect — it can only
   be removed after images built from this commit are published.
4. falcone-charts **#11** — a failed upgrade leaves `falcone-control-plane` scaled to 0
   with no recovery path (hit twice; caused a ~3 min outage).

**Two configuration traps, both fixed in the staging values:**
- `controlPlane.env` was overridden wholesale, and **Helm replaces lists rather than merging
  them**, silently dropping 12 chart-provided vars including `BAO_KUBERNETES_AUTH_ROLE`
  *and* `TEMPORAL_ADDRESS`/`TEMPORAL_NAMESPACE`. This is why OpenBao stayed disabled after
  being deployed, and would have stopped the control plane finding Temporal.
- The hand-applied (NOT helm-managed) `falcone-apisix-standalone` ConfigMap routed the whole
  data plane to `falcone-cp-executor`, a Service name the chart never creates — the chart
  names it `falcone-control-plane-executor`. 20 upstream references corrected; backup at
  `/var/tmp/f0v1/apisix-cm.backup.yaml`. **This remains unmanaged and will drift again.**

**Known stragglers (no outage, existing pods still serving):**
- `falcone-postgresql-vector-0` Pending — unbound PVC, no matching storage class.
- A new `falcone-ferretdb` replica fails its `wait-for-documentdb` init container with the
  same non-root problem as #965 ("image will run as root").

## F0-R1 additions (2026-08-08) — merge, do not overwrite

**Status corrections to earlier sections of this file:**
- The "Secrets … Not configured → backend disabled" note is **superseded**. OpenBao is wired in
  chart 0.4.1; the workspace-secrets API is live and returns 201/200/204 with write-only
  semantics (no plaintext `value` on reads). Verified twice, on two workspaces.
- The "**Absent:** `workspace_llm_providers`, `workspace_llm_usage`" note is **superseded** —
  both now exist in the live DB, created at executor startup. `workspace_llm_usage` has exactly
  7 columns (tenant, workspace, model, 3 token counts, created_at), no cost column, 0 rows.

**Executor route families (deployed, registered at the gateway, currently 401 for every
principal — falcone-charts#13):**
- `/v1/flows/workspaces/{ws}/{flows,schedules,task-types}`
- `/v1/flows/triggers/webhooks/{id}` — **HMAC-authenticated via a per-trigger secret, not OIDC.**
  Likely the only flows entry point not blocked by falcone-charts#13. Untested; worth its own slice.
- `/v1/workspaces/{ws}/{llm-provider,llm/completions,llm-usage,embedding-provider,api-keys}`
- `/v1/mcp/*`
- `/v1/realtime/workspaces/...` — change streams for **both** Postgres tables and Mongo collections.

**Control-plane capabilities not previously inventoried:**
- `POST /v1/workspaces/{ws}/databases` — engine-dispatched provisioning (`postgresql|mongodb`);
  the only route that creates a Mongo database, and the console wizard's target.
- Service-account credential lifecycle: `credential-issuance`, `-rotations`, `-revocations`
  (revocation verified effective immediately).
- Storage: multipart upload, presign, credential rotate/revoke, bucket export/import.
- `DELETE /v1/workspaces/{id}` cascades database drops — a second remover alongside tenant purge.

**Gateway/auth architecture (discovered, previously undocumented):**
APISIX routes `2003-llm`, `2003-embedding`, `2003-keys`, `2017-flows`, `2018-mcp` **strip**
`x-tenant-id`/`x-workspace-id` to `""` via `proxy-rewrite` while injecting `x-gateway-auth`, and
delegate identity entirely to the executor's own JWT verification. The ConfigMap states this
explicitly: *"the executor verifies the JWT itself (KEYCLOAK_JWKS_URL) … the executor is the auth
authority here."* Data-plane families (`/v1/postgres/*`, `/v1/mongo/*`, `/v1/events/*`,
`/v1/functions/*`) carry **two** routes each — a bearer one to control-plane and an
`apikey: flc_*`-gated one (`-key` suffix) to the executor.

**Temporal (deployed, never exercised):** namespaces `temporal-system` and `falcone-flows`; both
workflow-worker replicas poll task queue `flows-main`; `CountWorkflowExecutions` on
`falcone-flows` = 0. No PayloadCodec/DataConverter configured anywhere.

**Documentation gap candidates added this run:**
- ~~`content` is returned on storage object reads but appears in no OpenAPI document and is
  asserted by no test (→ #966).~~ **No longer true — CLOSED by `192c8cd0`…`cf4f8a45`, verifier
  CONFIRMED-FIXED.** The field is gone from the read envelope and `getObject()` no longer computes
  it; `StorageObjectPayload` is `additionalProperties: false` and never declared it. The read
  envelope now carries exactly one payload representation, `contentBase64`, and the write path
  honours the same field (→ #994). Documented in
  `docs/reference/architecture/storage-object-io.md` and pinned by
  `tests/blackbox/storage-object-write-envelope.test.mjs`. **LIVE ON STAGING** since 2026-08-09: image `0.6.6-main-d9cd0f6b` (`sha256:26bb5ff1`), verified in the running pod (`decodeBase64Exact` present, `content: o.content` zero occurrences).
- There is no documented route for deleting a provisioned database because none exists (→ #967).
- The `flc_` API-key authentication path is real and load-bearing but has no issuance path that
  works today (`workspace_api_keys` = 0 rows cluster-wide).

## F0-5 additions (2026-08-08) — merge, do not overwrite

Discovered against chart `in-falcone-0.4.1` helm rev 20 (full topology), repo HEAD `39ca71bb`.

### The inventory was undercounting the platform by ~3.4x

| Surface | Inventory said | Actual at rev 20 |
|---|---|---|
| Control-plane routes | 70 | **238 distinct** (193 seed + 70 route-map, deduped) |
| Executor routes | never inventoried | **86** |
| APISIX routes | 34 | **35**, 4 distinct upstream hosts |
| `in_falcone` tables | 49 | **59** |
| Console nav / router paths | 28 | **31 nav / 48 router paths** |
| CRDs installed by the chart | — | **0** (depends on 5 externally-owned CRD sets) |

**Root cause of the undercount — `route-map.runtime.json` is NOT the route table.** It is an
optional overlay (`ROUTE_MAP_FILE`) merged *over* a seed table in `apps/control-plane/routes.mjs`,
whose own header says so. Every family the old inventory listed (`/v1/tenants`, `/v1/storage`,
`/v1/functions`, `/v1/iam`, …) lives in the **seed** table, not the 70-route map. Any document or
test treating 70 as the control-plane surface is wrong by a factor of 3.4.

### Capabilities newly added to the inventory

| Capability | Where | Reached via | Documented? |
|---|---|---|---|
| Keycloak realm admin proxy (16 routes: realms/users/groups/roles/assignments/status) | control-plane seed | APISIX `2004-iam`, bearer | no OpenAPI |
| Self-service signup + login-session broker (`/v1/auth/signups`, `/login-sessions`, `/refresh`) | control-plane seed | public; policy answers **200 unauthenticated** | partial |
| Metering/observability API (`/v1/metrics/{tenants,workspaces}/…/{overview,usage,quotas,series,audit-records}`, `audit-exports`) | control-plane seed | APISIX `2010` | `series` undocumented |
| Function secrets (`/v1/functions/workspaces/{ws}/secrets`) — distinct from workspace secrets | control-plane seed | APISIX `2008` | undocumented as distinct |
| Function versioning / import-export / rollback | control-plane seed | APISIX `2008` | partial |
| Workspace clone + environment promotion (`/clone`, `/promotions`, `/environments`) | control-plane seed | APISIX `2003`/`2002` | ~none |
| Data import/export (postgres tables, mongo collections, storage buckets, tenant exports) | control-plane seed | `2005`/`2006`/`2009`/`2002` | partial |
| Events topic surface (`/v1/events/topics/{id}/{access,metadata,stream,publish}`, `/inventory`) | control-plane seed | APISIX `2007` | partial |
| **Events SSE stream** `GET /v1/events/topics/{id}/stream` — replays from offset 0 AND live-tails | control-plane | APISIX `2007` | no |
| `ANY /v1/scheduling/*` (`packages/scheduling-engine`) | route-map | APISIX `5000` | **no OpenAPI** |
| `POST /v1/internal/scope-enforcement/denials` — *internal*-named, published on the public gateway | control-plane seed | APISIX `5000` | no |
| Platform MCP JSON-RPC `POST /v1/mcp/rpc` | executor | APISIX `2018-mcp` | **0 doc hits** |
| Postgres DDL plane (`schemas/tables/columns/indexes/vector-indexes/policies/security`) | executor | `2005-key` (`apikey: flc_*`) only | partial |
| Vector search + embedding mapping (`/search`, `/embedding-mapping`, `/vector-indexes`) | executor | `2005-key` / `2003-embedding` | 1 doc hit |
| Flow schedules, run SSE monitoring, execution control (cancel/retry/signal/validate/versions) | executor | `2017-flows` | partial |
| `GET /v1/workspaces/{ws}/llm-usage` | executor | `2003-llm` | **0 doc hits** |
| Function **action/activation** surface (`POST /v1/functions/actions` → real Knative ksvc, `/invocations`, `/activations/{id}/{result,logs}`) | control-plane | APISIX `2008` | absent from route-map.json |
| `POST /v1/async-operation-query`, `POST /v1/tenants/{id}/quota/overrides`, `GET /v1/console/session` | control-plane seed | various | ~none |
| 4th public host `realtime.baas.musematic.ai` (own TLS cert) | ingress | public | not inventoried |

**14 DB tables never described:** `falcone_mcp_state`, `flow_definitions`, `flow_versions`,
`flow_trigger_registrations`, `flow_trigger_secrets` (AES `cipher`+`iv`; key custody/rotation
documented nowhere), `workspace_embedding_{mappings,providers}`, `workspace_llm_{providers,usage}`,
`workspace_api_keys`, `endpoint_scope_requirements` (3 rows), `async_operation_{log_entries,transitions}`,
`manual_intervention_flags`. Also: `temporal`, `temporal_visibility`, `seaweedfs_filer` and
`keycloak` are **co-tenanted in the same Postgres instance** as `in_falcone` and every `wsdb_*`.

### Corrections to earlier inventory entries

- **Workspace creation auto-provisions a Postgres database** (`wsdb_<tenant>_<ws>`) — no explicit
  provision call is needed. Earlier notes implying a separate provisioning step were wrong.
- **`plan_audit_events` is the platform-wide audit sink**, not a plan-domain table (19 distinct
  `action_type`s: `tenant.*`, `workspace.*`, `iam.*`, `workspace.secret.*`). There is no
  `platform_audit_events` table.
- **Per-tenant public Keycloak client `<slug>-app`** with direct-access grants is the supported
  path to a tenant-user token. This is the workaround that unblocks tenant-user testing despite
  #953 — #953 is a **console-flow** defect, not a realm defect.
- The wired OpenBao is **`openbao-0` in namespace `secret-store`**, NOT the `vault/vault-0`
  release, which is an unrelated 11-day-old install. Kubernetes auth, role `workspace-secrets-role`.
  It has a **file audit device** at `/openbao/audit/openbao-audit.log` that HMAC-SHA256s every
  secret value — a strong, previously unrecorded forensic surface.
- `POST /v1/functions/actions` (`fnDeploy`) is the real Knative deploy path and the only route that
  resolves workspace secrets; `POST /v1/workspaces/{ws}/functions` is registry-only
  (`runtime_status: pending_data_plane`). Easy to confuse; they are different capabilities.
- **Functions production runtime is genuinely Knative Serving** — `fn-<ws>-<name>-<hash>` ksvc +
  kourier, `runtime: nodejs:22`, `fetch` present, no platform secrets in the sandbox env, egress to
  internet and kube-api blocked.
- Storage supports **multipart upload, SigV4 presign, and HTTP `Range`** against SeaweedFS S3;
  3 MiB single-part and 6 MiB two-part multipart both round-trip sha256-exact.
- Events consume honours `maxMessages` and `timeoutMs`, which **are documented**
  (`docs/reference/architecture/events-console-workspace-routes.md:96`) and are clamped to a
  bounded batch (max 100) **by design**, so a console poll cannot create an unbounded consume loop.
  **Corrected 2026-08-09 (triage batch):** the bound is real but **inert**. Per **#955** the handler's
  default `timeoutMs` (3000 ms) exactly ties Kafka's `group.initial.rebalance.delay.ms` default, and
  every request creates a fresh random consumer group that must pay that delay — so the shipped
  console button returns `200 {"items":[]}` deterministically. The "by design" reading of the clamp
  stands; the claim that the poll works at its shipped default does not.
  `limit`/`offset`/`partition`/`fromBeginning`/`count`/`max` are ignored, but they are documented
  nowhere for this endpoint — that residual is already #955, not a separate defect.
  **Correction to an earlier F0-5 note:** the polling route is a bounded console poll, not a drain
  API. The drain path is `GET /v1/events/topics/{id}/stream` (SSE), which uses `fromBeginning:true`
  with **no limit** — verified 130/130 records, offsets [0..129], zero gaps.
- `/metrics` is served on port **8080** by control-plane and executor; Prometheus is
  `falcone-observability:9090`; Grafana ships 2 provisioned dashboards + datasource.

### Documentation gaps recorded this run

1. **104 of 238 live control-plane routes have no OpenAPI operation** (417 operations documented,
   path-normalised comparison). Undocumented families include all of `/v1/webhooks/*`, `/v1/plans*`,
   `/v1/quota-dimensions`, `/v1/tenants/{id}/quota/*`, `/v1/admin/backup/scope`,
   `/v1/capability-catalog`, `/v1/console/session`, `/v1/tenants/{id}/environments`,
   `/v1/metrics/…/series`, and `ANY /v1/scheduling/*`. This directly undercuts CLAUDE.md rule 6 —
   the portal is supposed to consume versioned contracts only.
2. `route-map.runtime.json` is misleading as a contract (see above).
3. Self-service signup is **on** (`selfServiceEnabled: true`) on the public beta API, and neither
   the capability nor its policy is described as a beta-surface decision in `docs/track-f/`.
4. `flow_trigger_secrets` holds per-trigger HMAC credentials with no documented key custody.
5. Console pages with no documented backing capability: `/console/{kafka,observability,functions-registry,iam-access,operations}`,
   a router-only `mcp/servers/:id` page with no nav entry, and **two parallel secret UIs**
   (`secrets` and `workspace-secrets`).
