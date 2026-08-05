# Falcone on kind (test-cluster-b)

Full Helm install of the `../falcone-charts/charts/in-falcone` chart onto the kind cluster at
**192.168.1.135** (kubeconfig: `../../kubeconfig-test-cluster-b.yaml`), namespace
**`falcone`**, plus LAN exposure of the front-doors.

## Operational origin (use this)

**http://192.168.1.132:31908** (APISIX gateway) serves BOTH the web-console SPA
(`/`) AND its real API (`/v1/*` → control-plane). Single same-origin endpoint —
point a browser there. Get a superadmin token (ROPC) for API calls:

```bash
source deploy/kind/credentials.env
curl -s -X POST http://192.168.1.132:31808/realms/in-falcone-platform/protocol/openid-connect/token \
  -d grant_type=password -d client_id=in-falcone-console \
  -d username=superadmin -d "password=$SUPERADMIN_PASSWORD" -d scope=openid | jq -r .access_token
```

## Control-plane runtime — domain (A) operational (governance/limits/RBAC)

`control-plane` is no longer a stub: `apps/control-plane/server.mjs`
validates the Keycloak JWT (JWKS), builds a trusted `callerContext` from the
verified claims, and dispatches `/v1/*` to the repo's REAL action modules
(`/repo/apps/...` and `/repo/packages/...`) with a pg Pool injected — **54 routes** loaded
(`routes.mjs` seed + `route-map.runtime.json`). Backed by the `in_falcone`
Postgres DB (migrations
073,074,075,076,078,079,080,093,097,098,100,103,104,105,114,115,117,118 applied).
Proven end-to-end through the gateway: create plan → set resource
limit (`max_workspaces` 10→42) → activate (lifecycle) → read limit profile, plus
quota-dimension catalog, plan list/get, change-history.

Operational families (A): **plans** (catalog, limits, lifecycle), **quotas**
(dimensions, overrides, sub-quotas), **entitlements/consumption/allocation**,
**effective capabilities**, **tenant-config** (export/preflight/reprovision/
validate), **async-ops query**, **scheduling**. Superadmin works fully;
tenant-scoped routes additionally need a JWT carrying `tenant_id`/`workspace_id`.

Request-body validation (error semantics): a JSON request body must be a JSON
**object**. A malformed body is rejected at the parse seam with a structured
`400` BEFORE handler dispatch, uniformly across every mutating route — never a
`500`: unparseable bytes → `400 {"code":"INVALID_JSON"}`; a body that parses to a
non-object (`null`, an array, or a scalar like `false`/`42`/`"x"`) →
`400 {"code":"VALIDATION_ERROR","message":"Request body must be a JSON object"}`
(#666). An empty body is the no-payload case (dispatched as `{}`); an empty
object `{}` is passed through so the handler applies its own field-level
validation (e.g. `400 VALIDATION_ERROR` for a missing required field). A
non-JSON content type (object uploads) is never parsed as JSON.

Path-id validation (error semantics): a resource whose id is a Postgres `uuid`
column rejects a malformed (non-UUID) path id as a clean `404` BEFORE the id ever
reaches a SQL query — never a `500` leaking the database type error
`22P02 invalid input syntax for type uuid`. This covers every by-id webhook
subscription route (`GET`/`PATCH`/`DELETE`, `…/pause`, `…/resume`,
`…/rotate-secret`, `…/deliveries`, `…/deliveries/{deliveryId}`): a non-UUID id is
treated identically to a nonexistent or cross-tenant id —
`404 {"code":"NOT_FOUND"}` with no malformed-vs-absent disclosure (#672).

## Domain (B) — tenant lifecycle, users, console login (BUILT)

The repo only stubs these (`apps/control-plane-executor/src/workflows/wf-con-002.mjs`:
`createKeycloakRealm` just returns a snapshot), so they were written fresh as
control-plane modules: `kc-admin.mjs` (real Keycloak admin client),
`tenant-store.mjs` (the `tenants` registry table — no in-repo migration creates
it), `b-handlers.mjs` (tenant + user lifecycle), `auth-handlers.mjs` (console
login). Proven end-to-end through the gateway with a real superadmin JWT:

- `POST /v1/tenants` → creates a Keycloak realm + the 11 standard realm roles +
  a public `<slug>-app` client (ROPC + auth-code, an un-forgeable `tenant_id` claim) +
  an owner user + a DB record (+ optional plan assignment); compensating cleanup
  on failure. A duplicate slug returns `409 SLUG_TAKEN` — both the sequential case (the
  `slugTaken` pre-check) and the concurrent race: the `slug` pre-check is a TOCTOU read, so two
  same-slug creates can both pass it, and the `tenants_slug_key` UNIQUE constraint is the real
  guard; the loser's `23505` is mapped to the SAME `409 SLUG_TAKEN` (never a `502` leaking the raw
  Postgres constraint text) and its partial realm/client/owner-user are rolled back by the saga
  (#665, the tenant twin of the workspace `409 WORKSPACE_SLUG_CONFLICT` fix #634). `GET /v1/tenants`,
  `GET /v1/tenants/{id}`. The `<slug>-app` client's
  redirect-URI / web-origin allow-list is NON-wildcard and deployment-configured via
  `TENANT_APP_REDIRECT_URIS` / `TENANT_APP_WEB_ORIGINS` (comma-separated; `+` web-origin =
  "origins of the registered redirect URIs"), and PKCE (`S256`) is enabled — so the
  authorization endpoint rejects a foreign `redirect_uri` (auth-code interception hardening,
  #670). A wildcard (`*`) entry is ignored; when unset the defaults are still non-wildcard.
  Every provisioned realm also has Keycloak **brute-force detection** ON (`bruteForceProtected`),
  so repeated wrong-password attempts for a user are throttled / temporarily locked instead of
  unlimited (#668). Keycloak defaults this OFF; the control-plane stamps it on at realm-create
  with env-configurable thresholds: `REALM_BRUTE_FORCE_PROTECTED` (default `true`),
  `REALM_BRUTE_FORCE_FAILURE_FACTOR` (default `10` — stricter than Keycloak's default 30),
  `REALM_BRUTE_FORCE_MAX_WAIT_SECONDS` (default `900`, the temporary lockout window), and
  `REALM_BRUTE_FORCE_PERMANENT_LOCKOUT` (default `false`, so a locked account auto-recovers). A
  malformed value falls back to its default; protection is disabled only by an explicit `false`.
  See `docs/reference/architecture/realm-brute-force-protection.md`.
- `POST /v1/tenants/{id}/users` (create user in the tenant realm + assign realm
  roles), `GET /v1/tenants/{id}/users`.
- `POST /v1/tenants/{id}/workspaces` (workspace record), `GET /v1/workspaces`,
  `GET /v1/tenants/{id}/workspaces`, `GET /v1/workspaces/{id}`.
- `POST /v1/workspaces/{id}/service-accounts` (= a confidential Keycloak client
  with serviceAccountsEnabled in the tenant realm), `GET` list/get, and
  `credential-issuance` / `credential-rotations` / `credential-revocations`
  (the client secret). Verified: the issued credential authenticates via
  `grant_type=client_credentials` against Keycloak (→ 200, a real machine token).
- `POST /v1/auth/login-sessions` (ROPC login → the SPA's ConsoleLoginSession),
  `.../refresh`, `DELETE .../{id}` (logout), `GET /v1/auth/signups/policy`,
  `POST /v1/auth/signups` (self-service registration). The signup minimum password length
  is `CONSOLE_SIGNUP_PASSWORD_MIN_LENGTH` (default `8`); it is BOTH advertised by the policy
  endpoint AND enforced by signup (sub-minimum → 400, no user created), and fails closed to
  `8` if unset/invalid — it can never disable enforcement (#669).
- **Offboarding (cascade).** `DELETE /v1/tenants/{id}` soft-deletes (reversible);
  `POST /v1/tenants/{id}/purge` is the hard cascade that removes EVERY resource the tenant
  owns — workspaces, per-workspace `wsdb_*` Postgres databases, the Keycloak realm, buckets,
  topics, registry rows, async-op rows — and `DELETE /v1/workspaces/{id}` is the per-workspace
  counterpart. The purge/delete response reports what was torn down under `removed`. **The
  FerretDB document store cascades too (#682):** a mongo database provisioned via
  `POST /v1/workspaces/{id}/databases {engine:"mongodb"}` is recorded in
  `workspace_mongo_databases`, and on purge/delete the tenant's documents are deleted **by
  `{tenantId}`** across that db's collections. Because FerretDB is ONE shared cluster keyed
  only by a `tenantId` document field (db/collection names are caller-supplied and shared
  across tenants), a database is physically `dropDatabase()`-ed **only when it is empty across
  ALL tenants** — a same-named db that still holds another tenant's documents is **retained**
  (only the purged tenant's docs are removed; the drop is reported under
  `removed.mongoDatabases`, retained dbs under `removed.mongoDatabasesRetained`). A naïve
  drop-by-name would be cross-tenant data loss, so it is deliberately avoided.

Full lifecycle verified: create tenant → create+activate plan → assign plan →
set resource limit → create user → the tenant's effective entitlements reflect
the assigned plan (`source: plan`). **The browser console login works**: open
`http://192.168.1.132:31908`, log in as `superadmin` / `SUPERADMIN_PASSWORD`
(from `credentials.env`); the admin pages populate from the control-plane.

Engine note: transactional actions get a DEDICATED pooled connection per request
(a Pool spreads BEGIN/INSERT/COMMIT across connections → writes silently roll
back). Two real product defects surfaced + worked around in the deploy DB:
`tenant_plan_quota_impacts` value columns are `INTEGER` (overflow on
`max_storage_bytes` 5GiB → widened to BIGINT); and the dedicated-connection
requirement above.

## Domain (B) — data plane, durable saga, fine-grained IAM (BUILT)

Second wave (`saga.mjs`, `dataplane.mjs`, extended `kc-admin.mjs`/`b-handlers.mjs`),
verified end-to-end through the gateway with a real superadmin JWT:

- **Workspace database provisioning (REAL).** `POST /v1/workspaces/{id}/database`
  creates an actual Postgres database on `falcone-postgresql` (catalog-level
  isolation; `REVOKE CONNECT … FROM PUBLIC`), records it in `workspace_databases`,
  returns the connection DSN. When the control-plane DB role has `CREATEROLE` it
  also mints a **dedicated, db-scoped login role + password** (`mode:
  dedicated_role`) that OWNS the workspace database. The `cp-executor-setup`
  bootstrap Job now runs `ALTER ROLE falcone CREATEROLE` (#686), so on this deploy
  the `falcone` role CAN create those per-workspace roles and newly provisioned
  workspaces get `mode: dedicated_role` with an independently rotatable credential.
  The grant is `CREATEROLE` only — `falcone` stays `NOSUPERUSER`/`NOBYPASSRLS`, and
  under PG17 a non-superuser CREATEROLE grantee can administer only roles it itself
  creates (no superuser escalation). `GET …/database`. Verified: `wsdb_…` exists in
  `pg_database`, PUBLIC connect revoked.
- **Workspace DB credential rotation (REAL).**
  `POST /v1/workspaces/{id}/database/credential-rotations` rotates a
  **`dedicated_role`** workspace's password (`ALTER ROLE … PASSWORD`) and returns
  `201` with the new credential/DSN — the OLD password is then rejected by Postgres
  and the NEW one accepted. A workspace still in **`shared`** mode (provisioned
  before the `CREATEROLE` grant, or with no dedicated credential) has nothing to
  rotate, so rotation returns a non-success **`409 DB_SHARED_MODE`** carrying the
  reason — NOT a misleading `200 {rotated:false}` (#686). Pre-existing shared-mode
  databases are not retro-migrated; re-provision a workspace to obtain a dedicated,
  rotatable credential.
- **Workspace function registry.** `POST /v1/workspaces/{id}/functions` /
  `GET …/functions`. Registers function metadata; reports
  `runtimeStatus: pending_data_plane` — execution needs the Knative data plane,
  so no fake "deployed" claim until the function is deployed as a ksvc.
- **Durable saga + compensation.** `saga_runs` + `saga_steps` persist each forward
  step with a SERIALIZABLE compensation (`{type,args}`); `createTenant` and DB
  provisioning record steps. On failure the recorded compensations replay
  newest-first (verified: a bad `planId` rolled back BOTH the `tenants` row and the
  Keycloak realm). On startup `recoverSagas()` sweeps orphaned `running` sagas —
  atomic claim (`status running→recovering`) so concurrent replicas process each
  exactly once, and an orphan window (5 min) so an in-flight saga on a live replica
  is never swept. Verified by restart: orphan `recovered`/`compensated` once (no
  double-fire), a fresh in-flight saga left untouched.
- **Fine-grained IAM.** Per-realm role/group CRUD plus role-assignment and group
  membership: `…/users/{uid}/role-assignments` (POST/DELETE), `…/users/{uid}/roles`
  (GET), `…/users/{uid}/groups/{gid}` (PUT/DELETE), `…/groups/{gid}/members`,
  `…/users/{uid}/groups`. Verified: assign/remove realm roles, add/remove group
  member, list members + a user's groups.

## Console SPA pages wired to the control-plane (web-console 0.2.11)

The repo's SPA (`apps/web-console`) was built for a richer/camelCase backend than
this control-plane serves. To make the shell usable end-to-end:
- The control-plane list endpoints (`GET /v1/tenants`, `GET /v1/workspaces`,
  `…/tenants/{id}/workspaces`) now emit the SPA's `{items:[{tenantId/workspaceId,
  displayName,slug,state,…}],page}` shape (keeping the snake_case columns too for
  the existing API callers) and accept `filter[tenantId]` + `page[size]`. So the
  header **tenant/workspace selectors populate** from real data.
- Three purpose-built pages call the new endpoints (router + sidebar nav):
  - **Workspace DB** (`/console/database`) — provision / view / rotate the
    workspace's real Postgres database.
  - **Functions (Registry)** (`/console/functions-registry`) — register / list
    functions (shows `pending_data_plane`).
  - **IAM Access** (`/console/iam-access`, superadmin) — pick a user in the active
    tenant realm; assign/remove roles and add/remove group membership.
- The repo's **Plans** pages (`/console/plans`, `/plans/new`, `/plans/:id`,
  `/console/my-plan`) are wired: `apps/web-console/src/services/planManagementApi.ts` used a bare `fetch`
  with NO bearer token (every call 401'd) — it now routes through
  `requestConsoleSessionJson` (auth + 401-refresh), and `listPlans` normalizes the
  control-plane's `{plans}` envelope to the SPA's `{items}`. These hit the REAL
  domain-A actions (plan-list/get/create/lifecycle/limits, assign, entitlements),
  whose item shapes already match. Verified: catalog lists 7 plans; plan detail
  (Acme Plan / active) renders Info/Capabilities/Limits/Tenants tabs.
- The repo's **Quotas** page (`/console/quotas`) is wired: it calls
  `/v1/metrics/{tenants|workspaces}/{id}/quotas|overview`, which the repo leaves
  unimplemented (`module=NONE`). New control-plane `metrics-handlers.mjs` SYNTHESIZES
  the `QuotaPostureResponse`/`QuotaOverviewResponse` from the real
  `tenant-effective-entitlements-get` + `workspace-consumption-get` actions (limits
  are real; usage is shown as `unavailable` where the data-plane usage tables aren't
  populated — honest). Verified: posture table renders 8 dimensions (API keys 20,
  functions 50, …) with overall `healthy`. NOTE: `ConsoleQuotasPage` was lazy-loaded
  and threw React #426 (suspend-on-click) — converted to an eager import in `router.tsx`.
- The repo's **Operations** page (`/console/operations` + detail) is wired to the
  **real `async_operations` tables**. The endpoint (`POST /v1/async-operation-query`,
  the real `async-operation-query` action) was already in the route map, and boot
  applies the async-operation migration chain
  (073, 074, 075, 076, 078, 079) before the server declares schema readiness.
  Durable saga (`saga.mjs`) records a real async
  operation (+ transition + log) on start/complete/fail. `createTenant` →
  `tenant.create`, DB provisioning → `workspace.database.provision`. Verified:
  created tenants + a DB + a deliberately failing tenant → the list shows
  `tenant.create` (completed + failed) and `workspace.database.provision`
  (completed); detail returns status/type/sagaId/`errorSummary`. Migration 079
  adds the nullable lifecycle result and completion-time columns used by
  `queryType=result`; completed, failed, and pending result reads retain the
  existing safe response projection instead of failing on missing columns.
  Pages were lazy (React #426) → eager.
- The repo's **Kafka / Events** page (`/console/kafka`) is wired to the **REAL
  Kafka** broker (`falcone-kafka:9092`, PLAINTEXT). `kafka-handlers.mjs` uses
  `kafkajs` (added to the image; `KAFKA_BROKERS` env). Endpoints (`/v1/events/*`):
  topic inventory, provision topic (real `createTopics`), topic detail
  (`describeConfigs`/metadata), access policy (empty — broker has no authorizer,
  reported `nativeAclSupport:false`, honest), live metadata (partition offsets via
  `fetchTopicOffsets`), publish (real producer), and a **live SSE stream** (a per-
  request consumer; needed a `stream:true` route flag so the handler owns the
  response in `server.mjs`). Topics map to a stable `resourceId` via `workspace_topics`.
  Verified: provisioned `ws.primary.orders-events` (3 partitions), published 3 events
  → inventory/detail/metadata show them, and the SSE stream replays all 3 with
  keys/payloads/partitions/offsets. `ConsoleKafkaPage` was lazy (React #426) → eager.
- The repo's **Functions** page (`/console/functions`) is wired to **REAL function
  EXECUTION on KNATIVE**. (History: full Apache OpenWhisk was attempted —
  openwhisk-deploy-kube — but its Python2/old-ansible init images are incompatible
  with this host kernel (7.0.0): findmnt hangs, then the ansible `command` module
  busy-loops at 99% CPU. A k8s-Job executor was an interim step. Final design =
  **Knative Serving** (v1.22.1 + Kourier, installed cluster-wide; see
  `deploy/kind/knative/`).) Each function is a **Knative Service** (ksvc): deploy
  creates/updates a cluster-local ksvc running the `fn-runtime` image (node:22 HTTP
  server, source injected via `FN_SRC`); invoke is an HTTP POST to the ksvc's
  `*.svc.cluster.local` URL (scale-from-zero, scale-to-zero). `function-executor.mjs`
  manages the ksvc via the k8s API (in-cluster SA token+CA, `node:https`); the SA is
  granted `serving.knative.dev/services` RBAC (`executor-rbac.yaml`). `fn-handlers.mjs`
  serves `/v1/functions/*`. Verified: deployed `multiplier`, invoked → the ksvc ran
  `{engine:"knative", product:42, greeting:"hola Falcone"}` with `console.log`
  captured; warm invoke ~60ms; pods scale to zero when idle. KIND NOTE: set Knative
  `config-deployment.registries-skipping-tag-resolving` to include `localhost:30500`
  (the controller can't reach the node's containerd mirror to resolve digests; the
  kubelet still pulls it). The runtime image is `FN_RUNTIME_IMAGE` env (Harbor path
  in prod). `ConsoleFunctionsPage` was lazy (React #426) → eager.
- The repo's **PostgreSQL** data-browser (`/console/postgres`) is wired to **REAL
  Postgres** (read-only introspection). `pg-handlers.mjs` answers from
  `pg_catalog`/`information_schema` via the `pg` driver (a short-lived Client per
  target database — catalogs are per-db; the database list is cluster-wide on the
  shared pool, mapped to workspaces via `workspace_databases`). Endpoints: databases,
  schemas (+object counts), tables (+columnCount), columns, indexes (method/unique/
  keys), policies + security (RLS enabled/forced/policyCount), views, materialized
  views. Verified: browsed `in_falcone` → `public` (36 tables / 119 indexes) → table
  columns + indexes (incl. a compound index) + RLS flags. (Distinct from my custom
  "Workspace DB" page which provisions a per-workspace DB.) `ConsolePostgresPage` was
  lazy (React #426) → eager import.
- The repo's **MongoDB-compatible document** page (`/console/mongo`) is wired to
  **REAL FerretDB over DocumentDB** (`falcone-ferretdb:27017`). `mongo-handlers.mjs`
  uses the official `mongodb` driver against the MongoDB wire protocol (`MONGO_*`
  env via secretKeyRef). Endpoints: list databases (system dbs hidden, real
  `db.stats()`), collections (real counts/sizes/validation),
  collection detail, indexes, views, and documents (skip/limit cursor, BSON made
  JSON-safe — ObjectId→hex, Date→ISO). The **documents** view is workspace-addressed
  (`/v1/mongo/workspaces/{workspaceId}/data/{db}/collections/{col}/documents`) and is scoped
  per **workspace within the tenant** (#661): the find filters by BOTH the owning `tenantId`
  AND the addressed workspace's canonical UUID (matching the data-API write path, which stamps
  both), so browsing one workspace never returns a sibling workspace's (or stage's) documents of
  the same tenant — and a cross-tenant workspace is a 404. The list/collection/index/view
  endpoints are NOT workspace-addressed (no `{workspaceId}` in their routes) and stay
  tenant-scoped. `POST /v1/workspaces/{id}/databases` is an
  engine-dispatched provisioner (`postgresql`|`mongodb`) — the SPA's
  ProvisionDatabaseWizard target. A `mongodb` provision also records a
  `workspace_mongo_databases` registry row (idempotent) so tenant-purge / workspace-delete can
  discover and tear down the document data isolation-safely (#682; see the Offboarding note
  above). Verified: provisioned `wsdemo` + 2 collections,
  seeded 3 users / 2 orders / a `email_unique` index → the page shows the database
  (350 B / 2 collections / 3 indexes), collection counts, indexes, and the documents.
  `ConsoleMongoPage` was lazy (React #426) → eager import.
- The repo's **Storage** page (`/console/storage`) is wired to **REAL SeaweedFS** — a
  true data-plane page. `storage-handlers.mjs` is a from-scratch S3 client
  (AWS **SigV4** via `node:crypto`, no SDK) against the SeaweedFS S3 gateway
  `falcone-seaweedfs-s3:8333` (path-style; `STORAGE_S3_*` env via secretKeyRef).
  Endpoints: list buckets (joined with a new
  `workspace_buckets` map so the page's `bucket.workspaceId===activeWorkspaceId`
  filter works), list objects (ListObjectsV2), object metadata (HEAD), per-workspace
  usage (aggregated), and `POST …/workspaces/{id}/buckets` to provision a real
  bucket. Verified: provisioned `ws-primary-assets`, seeded 3 objects → the page
  shows the bucket, usage **2.1 KB / 3 objects**, and the object list
  (`readme.txt`, `config/app.json`, `images/logo.bin`) + connection snippets.
  `ConsoleStoragePage` was lazy (React #426) → eager import.
  Reading or downloading a **missing object** in a bucket the tenant owns returns a clean,
  structured **`404 OBJECT_NOT_FOUND`** (`{"code":"OBJECT_NOT_FOUND","message":"The requested
  storage object was not found."}`) for both `GET …/objects/{key}` and
  `GET …/objects/{key}/metadata` — it never echoes the SeaweedFS backend's raw S3 error payload
  (the `NoSuchKey` XML, `RequestId`, S3 resource path, or the internal physical bucket name
  `ws-<hash>-…`). Any other backend failure returns the operation's stable failure code
  (`STORAGE_GET_FAILED` / `STORAGE_HEAD_FAILED`) with a generic message; the upstream detail is
  written to the control-plane log only, never to the response (#675).
- **Per-bucket scoped storage credentials (#673).** Provisioning a bucket
  (`POST …/workspaces/{id}/buckets`) issues a SeaweedFS S3 identity scoped to **exactly that one
  bucket** — keyed on the physical bucket name (`seaweedfs-identity.mjs::bucketIdentityName` →
  `falcone-s3-<hash>`), not on the workspace. The seed Job does **delete-then-apply**, so a
  re-provision is a clean rotate (exactly one active key per bucket; a given bucket's identity
  never accumulates grants or keys). The returned `storageCredential`
  (`identityName`/`accessKey`/`secretKey`/`bucket`/`actions`) authenticates against the gateway for
  ITS bucket only and is `AccessDenied` (403) on every other bucket — including a sibling bucket in
  the same workspace, not just another tenant's bucket. (Previously one per-workspace identity
  accumulated a grant for every bucket in the workspace, so a credential "scoped to bucket A" could
  read sibling buckets B/C.) Two kind-only, ownership-gated (non-owner → `404`, superadmin bypass)
  credential endpoints manage the lifecycle:
  - `POST   /v1/storage/buckets/{bucketId}/credentials` — **rotate**: re-issues the bucket's
    identity (delete-then-apply) and returns a fresh `storageCredential`; the prior access key no
    longer authenticates. Also deletes the bucket's legacy per-workspace identity (see below).
  - `DELETE /v1/storage/buckets/{bucketId}/credentials` — **revoke**: deletes the bucket's
    identity and all its keys (`{ revoked: true }`); the prior access key is rejected. Also deletes
    the bucket's legacy per-workspace identity (see below).
  These routes are not in the public route catalog (which carries only storage object routes), so
  there is no SDK/OpenAPI change. Per-bucket identity issuance is on by default and can be
  disabled with `STORAGE_TENANT_IDENTITIES=0` (then rotate returns `409
  STORAGE_IDENTITIES_DISABLED`).

  **Upgrade / legacy-credential migration (existing tenants).** The per-bucket switch is
  forward-only: any credential issued BEFORE this fix used a single, over-granted per-workspace
  identity (`falcone-ws-<workspaceId>`) that — left in place — keeps authenticating with cross-bucket
  access after the deploy, including against a re-created, deterministically-named bucket (so a
  bucket name "never accumulating" is true only for credentials issued under the fix). On startup the
  control-plane therefore runs a **one-shot, best-effort, idempotent migration** that deletes EVERY
  legacy `falcone-ws-*` identity — enumerated from the **live** SeaweedFS config (`weed shell
  s3.configure`), so it also removes orphaned identities whose workspace/buckets were already deleted.
  It is delete-only (no wildcard/admin grant is ever introduced), never blocks or crashes boot, and
  no-ops once the legacy identities are gone (and when run outside the cluster). **Pre-fix
  credentials are invalidated by this migration; affected tenants must re-provision the bucket or
  call the rotate endpoint to obtain a new per-bucket credential.** Operators NOT redeploying the
  control-plane can run the same delete manually for each legacy workspace identity:

  ```bash
  # delete one legacy per-workspace identity (repeat per workspaceId; list them with
  # `printf 's3.configure\n' | weed shell -master=<seaweedfs-master>:9333`)
  printf 's3.configure -delete -apply -user falcone-ws-<workspaceId>\n' \
    | weed shell -master=falcone-seaweedfs-master.falcone:9333
  ```
- The repo's **Service Accounts** page (`/console/service-accounts`) is wired: it
  calls the workspace SA collection endpoint as its list source of truth, so a
  fresh browser/session shows the same workspace service accounts as any other
  session. The control-plane returns `serviceAccountId` on create, the
  `ConsoleServiceAccount` list/detail shape (`iamBinding`/`credentialStatus`/
  `accessProjection`/`credentials`), and `credentialId`/`secret`/`expiresAt` on
  issuance/rotation (the SA = a confidential Keycloak client; secret is the real
  client secret). Verified: create → row appears (`enabled`/`active`/`granted`) → reveal
  current credential → real secret shown. `ConsoleServiceAccountsPage` was lazy (React #426) → eager import.
- The repo's **Observability** page (`/console/observability`) is wired: `console-metrics.ts`
  calls `/v1/metrics/{tenants|workspaces}/{id}/{overview,usage,series,audit-records,audit-exports}`.
  The control-plane `metrics-handlers.mjs` now serves the full family — `overview` carries
  real limit `dimensions` (+posture), `usage` carries real `currentUsage`, while `series`
  and `audit-records` are empty (no metrics time-series data plane / audit-record store in
  this deploy — the repo's own audit `defaultLoader` also returns empty) and `audit-exports`
  is accepted (202). Verified: metric dimension rows render (API keys 0/20, functions 0/50);
  overall `healthy`. `ConsoleObservabilityPage` was also lazy (React #426) → eager import.
- The repo's **Members** page (`/console/members`) is now wired too: it resolves the
  realm from `tenant.identityContext.consoleUserRealm` (added to `/v1/tenants`),
  lists users + roles from `/v1/iam/realms/{realm}/users|roles` (enriched with
  `userId`/`realmRoles`/`roleName` so its tables populate), and its
  invite-wizard button was replaced with an inline create-user form that POSTs to
  `/v1/tenants/{tenantId}/users` (creates the user in the tenant realm + assigns a
  role). Verified: create → 201 → new user appears with its role.

  Sources: `apps/web-console/src/pages/Console{WorkspaceDatabase,FunctionRegistry,
  IamAccess}Page.tsx` + `ConsoleMembersPage.tsx`. Verified by real headless-Chromium runs
  (`ui-verify-pages.mjs`, `ui-verify-members.mjs`):
  login → select tenant+workspace → each page renders live data. Note: the SPA's
  other pre-existing pages (Postgres/Mongo/Kafka/Events/Functions-actions/…) target
  the repo's intended data-plane API and are NOT backed by this control-plane.

  Build path: `npx vite build` in `apps/web-console` (esbuild transpile — the repo's
  `tsc -b` baseline is already red on unrelated files), then build the release image
  from `apps/web-console/Dockerfile` after `apps/web-console/dist` exists.

### Honest gaps (domain B — still to build)
- **Function execution** runs on the Knative data plane (each function is a ksvc;
  see the Functions section above) — both the registry and the runtime are real.
- **Dedicated per-workspace DB credentials** need `CREATEROLE`/superuser on
  Postgres. As of #686 the `cp-executor-setup` bootstrap grants `falcone`
  `CREATEROLE` (only — still `NOSUPERUSER`), so newly provisioned workspaces get a
  dedicated, rotatable `mode: dedicated_role` credential and rotation is real.
  Workspaces provisioned BEFORE the grant remain `mode: shared` (not retro-migrated)
  and their credential-rotation returns `409 DB_SHARED_MODE`; re-provision to get a
  dedicated, rotatable credential.
- **iam-tenant-roles** (custom-role CRUD) expects a custom store, not a pg Pool —
  excluded until an adapter is written.
- **secret-rotation** needs OpenBao wiring; **data-plane consoles**
  (postgres/mongo/storage/events) need live data sources.
- Migration `094` (broad admin/data privilege separation) is NOT applied by governance
  boot — it alters `api_keys` (not created by the registered migration set) and
  `endpoint_scope_requirements` (created by registered migration `093`), then seeds
  endpoint classifications. C-14 bootstraps ONLY the denial-history table via the dedicated
  `122-privilege-domain-denial-history.sql`, so the canonical denial-audit route
  `GET /v1/workspaces/{workspaceId}/privilege-domains/audit` boots and returns its history
  (an authorized query for an unknown/denial-free workspace is an empty `200`, not `404`).
  The adjacent privilege-domain ASSIGNMENT routes still read 094-only objects
  (`privilege_domain_assignments`/`_history`/`workspace_structural_admin_count`) and stay
  out of scope, so they may still 500 until 094 is provisioned.
- The UI data contract is verified by a REAL headless Chromium run (see
  "Chromium / Playwright" below) plus direct gateway replays of the SPA's
  requests.
- One-time Keycloak fixes applied to make tokens carry identity: enabled the
  `superadmin` user + assigned the `superadmin` realm role; added the standard
  `basic`/`roles`/`profile` client scopes to `in-falcone-console` (the bootstrap
  had replaced them with only custom scopes, so tokens lacked `sub`/`realm_access`).

## What is deployed

Release `falcone` (`helm status falcone -n falcone` → `deployed`). Core pods Running:

| Component | Kind | Image used (overridden in `values-kind.yaml`) |
|---|---|---|
| postgresql | StatefulSet | `bitnamilegacy/postgresql:17.2.0` |
| documentdb | StatefulSet | `ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0` |
| ferretdb | Deployment | `ghcr.io/ferretdb/ferretdb:2.7.0` |
| kafka (KRaft, 1 broker) | StatefulSet | `bitnamilegacy/kafka:3.9.0` |
| seaweedfs | StatefulSet/Deployment | `chrislusf/seaweedfs:4.33` |
| keycloak | Deployment | `quay.io/keycloak/keycloak:26.1.0` |
| apisix (gateway) | Deployment | `apache/apisix:3.10.0-debian` |
| observability (Prometheus) | Deployment | `prom/prometheus:v3.2.1` |
| control-plane | Deployment | `in-falcone-control-plane:0.6.2` (real runtime: domain B, saga, quota+metrics, REAL SeaweedFS/MongoDB-wire/Postgres/Kafka + KNATIVE functions) |
| web-console | Deployment | `in-falcone-web-console:0.2.11` (real SPA: ALL console pages backed by real services) |
| functions (Knative Serving + Kourier) | cluster-wide (v1.22.1) | per-function ksvc on `fn-runtime` (see Functions section) |
| registry (helper) | Deployment | `registry:2` — in-cluster image registry on NodePort 30500 |

## LAN access

kind does **not** publish NodePorts to the host LAN, this cluster has **no
ingress controller / LoadBalancer**, and the kind host (.135) is not SSH-reachable
from here. So access is provided via `kubectl port-forward --address 0.0.0.0`
from **this machine (192.168.1.132)**, which is on the same home network — reach
the services from any LAN device at `http://192.168.1.132:<port>`:

| Service | URL |
|---|---|
| Web Console (SPA) | http://192.168.1.132:31300 |
| API gateway (APISIX) | http://192.168.1.132:31908 |
| Keycloak | http://192.168.1.132:31808 |
| Control-plane (stub) | http://192.168.1.132:31818 |
| SeaweedFS filer UI | http://192.168.1.132:31901 |
| Prometheus | http://192.168.1.132:31909 |

**Start / restart the forwards:**

```bash
bash deploy/kind/lan-forward.sh   # foreground; Ctrl-C stops all
```

The forwards run on whatever host executes the script (use a host on the home
LAN). They live for the lifetime of that process — run under `tmux`/`nohup`/a
systemd unit for a long-lived endpoint. NodePort `-lan-*` services were also
created in the namespace and will work directly from the host once the kind node
publishes those ports (host-side `extraPortMappings` / a host-run port-forward).

## Credentials

Generated, gitignored: `deploy/kind/credentials.env` (chmod 600). Keycloak admin,
SeaweedFS S3 access/secret keys, Postgres/Mongo, APISIX admin key, platform superadmin password.
Keycloak realm `in-falcone-platform` is provisioned (roles, client scopes,
`in-falcone-console` / `in-falcone-gateway` clients, `superadmin` user).

## Honest deferrals (kind profile)

- **control-plane**: the repo ships control-plane *modules* but no HTTP server
  entrypoint (the real one is in the deployment wrapper, not this repo), so a
  clearly-labeled stub serves health/info on :8080 and 501s API routes.
- **functions runtime**: full Apache OpenWhisk was abandoned on this profile
  (`openwhisk/standalone` requires the host docker socket to spawn action containers
  and exits without it; `openwhisk-deploy-kube`'s Python2/old-ansible init images are
  incompatible with this host kernel). Functions now run on **Knative Serving + Kourier**
  (installed cluster-wide, each function a ksvc) — see the Functions section above.
- **APISIX routes**: APISIX runs `APISIX_STAND_ALONE=true` (no Admin API), so
  routes are loaded from a mounted `apisix.yaml` rather than pushed at runtime.
  All 22 chart routes are wired in `deploy/kind/apisix/apisix.yaml` (ConfigMap
  `falcone-apisix-standalone`, mounted via `apisix.extraVolumes` in
  `values-kind.yaml`): `/` → web-console, `/auth/*` → Keycloak (with a
  proxy-rewrite that strips `/auth` since KC 26 serves at root), `/control-plane/*`
  + `/realtime/*` + `/v1/*` → control-plane, `/_native/keycloak/admin/*` → KC.
  **Gateway-enforced auth plugins were intentionally dropped** (`openid-connect`,
  `authz-keycloak`, `client-control`, `request-validation`, `limit-count`,
  `http-logger`) — they need secrets/endpoints/custom plugins that don't resolve
  in this standalone profile and would break config load; only `cors` and the
  `/auth` `proxy-rewrite` are kept. So `/v1/*` reaches the backend but the backend
  is the **control-plane stub** (501). Re-apply after editing routes:
  `deploy/kind/apply-apisix-routes.sh`.
- **Keycloak issuer behind the gateway**: the OIDC discovery served via the
  gateway reports `issuer: http://…:9080/realms/…` (APISIX's in-pod port) rather
  than the browser URL, because `KC_HOSTNAME` is unset. Real browser login flows
  would need `KC_HOSTNAME`/`KC_PROXY` tuning; the discovery + routing themselves
  work.
- **bootstrap hook**: bootstrap is now core and always rendered. In the standalone
  APISIX kind profile, `values-kind.yaml` keeps the Keycloak phase active and gives
  the APISIX reconcile phase only a non-active placeholder route so Helm converges
  without calling the absent Admin API.
- **images**: chart-pinned Bitnami/apisix/seaweedfs/prometheus tags were purged from
  public registries; `values-kind.yaml` repins to working equivalents.

## Chromium / Playwright (ubuntu 26.04)

This host has no Chromium build Playwright supports (`Executable doesn't exist …
does not support chromium on ubuntu26.04-x64`). Solution: run the verification in
the **official Playwright Docker image** — it bundles the browser + all OS deps, so
it is independent of the host distro:

```bash
docker run --rm --network host \
  -e GW=http://192.168.1.132:31908 -e SUPERADMIN_PASSWORD \
  -v "$PWD/deploy/kind/ui-verify.mjs:/ui.mjs" \
  -v "$PWD/deploy/kind/.uiout:/out" \
  mcr.microsoft.com/playwright:v1.50.0-noble \
  bash -c "cd /tmp && npm i -q playwright@1.50.0 && node /ui.mjs"
```

`--network host` lets the container reach the port-forwarded gateway. `ui-verify.mjs`
loads the SPA, logs in through the real form (`POST /v1/auth/login-sessions → 201`),
opens `/console/tenants`, and writes screenshots to `.uiout/`. This is the same
recipe the real-stack E2E suite can use on a non-Playwright-supported host.

## Files

- `values-kind.yaml` — all install overrides (images, security contexts, kafka
  single-broker, keycloak memory, bootstrap disable, realm payload fix).
- `web-console/`, `control-plane/`, `svc-stub/` — Dockerfiles for the app SPA and
  the two stubs (pushed to the in-cluster registry on :30500).
- `control-plane/{server,routes,kc-admin,tenant-store,b-handlers,auth-handlers,saga,dataplane}.mjs`
  — the control-plane runtime (JWT verify + dispatch, domain B, durable saga, data plane).
- `ui-verify.mjs` — headless-Chromium console check (run via the Docker recipe above).
- `lan-forward.sh` — LAN exposure via port-forward.
- `credentials.env`, `tls/` — secrets (gitignored).
