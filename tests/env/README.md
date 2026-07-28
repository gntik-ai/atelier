# Falcone test environment (`tests/env`)

A `docker compose` stack of the **real backing services** Falcone runs in-cluster,
so changes can be exercised against real infrastructure instead of mocks. This is
the preferred local integration target (lighter than a throwaway Kubernetes).

## What it provides

| Service  | Host endpoint                                   | Notes |
|----------|-------------------------------------------------|-------|
| Postgres | `postgres://falcone:falcone@localhost:55432/falcone_test` | ephemeral (tmpfs); backup-status + scheduling-engine migrations applied on `up` |
| Keycloak | `http://localhost:8081` (admin `admin`/`admin`) | internal IdP; tenants map 1:1 to realms; also hosts the slice realm `falcone-e2e` |
| Redpanda | `localhost:19092` (`KAFKA_BROKERS`) | Kafka API broker (events, audit, CDC change streams); auto-creates topics |
| MongoDB  | `mongodb://localhost:57017/?replicaSet=rs0&directConnection=true` (`MONGO_URI` / `MONGO_TEST_URI`) | document store; single-node replica set `rs0` (**required** for CDC change streams); ephemeral (tmpfs); `rs.initiate()` + wait-for-PRIMARY on `up` |
| SeaweedFS | `http://localhost:58333` S3 API (path-style; `falconedev`/`falconedevsecret`) | S3-compatible object storage (`S3_ENDPOINT`), replaces MinIO (ADR-13); ephemeral (tmpfs); bucket `falcone-test` (`S3_SDK_BUCKET`) created on `up` |
| OpenBao  | `http://localhost:58200` (token `root`) (`BAO_ADDR`/`BAO_TOKEN`, legacy `VAULT_ADDR`/`VAULT_TOKEN` also honored) | dev mode (auto-unsealed); file audit device → host-mounted log at `tests/env/openbao/audit/openbao-audit.log` (`BAO_AUDIT_LOG_PATH`, legacy `VAULT_AUDIT_LOG_PATH` fallback), tailed by `secret-audit-handler` |

### What each new service is for

- **MongoDB** — the document store collected by `provisioning-orchestrator`
  (`collectors/mongo-collector.mjs`) and the source of CDC change streams consumed
  by `mongo-cdc-bridge` (`src/index.mjs`, reads `MONGO_TEST_URI`/`MONGO_URI`).
  MongoDB change streams require a replica set, so the node runs as single-node
  `rs0` and `up.sh` initiates it and waits until it is PRIMARY.
- **SeaweedFS** — S3-compatible object storage (replaces MinIO — ADR-13) for workspace
  SDK artifacts (`openapi-sdk-service`, reads `S3_ENDPOINT` / `S3_ACCESS_KEY` /
  `S3_SECRET_KEY` / `S3_SDK_BUCKET`) and storage-config export (`provisioning-orchestrator`
  `collectors/s3-collector.mjs`). All-in-one `server` (master+volume+filer+S3) on the
  spike-validated 4.33 image; `up.sh` creates the `falcone-test` bucket via `weed shell`.
- **OpenBao** — secret store (the open-source Vault fork; CLI `bao`, image
  `openbao/openbao`). Its only test-relevant job is emitting a **file** audit log to a
  host-mounted path that `secret-audit-handler` (`src/index.mjs`, reads
  `BAO_AUDIT_LOG_PATH` with a `VAULT_AUDIT_LOG_PATH` fallback) tails and republishes.
  `up.sh` enables the file audit device and generates an audit entry so the host log
  file exists. OpenBao's file-audit JSON is Vault-schema-compatible, so the parser is unchanged.

### Bootstrap performed by `up.sh` (idempotent)

- **MongoDB**: `rs.initiate({_id:'rs0', members:[{host:'mongodb:27017'}]})` if the
  set is not already configured, then waits until `rs.status().myState == 1`
  (PRIMARY).
- **SeaweedFS**: `s3.bucket.create -name falcone-test` via the in-container `weed shell`
  (check-then-create, idempotent).
- **OpenBao**: `bao audit enable file file_path=/openbao/audit/openbao-audit.log`
  ("already enabled" is ignored), then a `bao kv get` / `bao token lookup` to
  guarantee the host-visible audit log file is non-empty.

### Out of scope (these stay on the Kubernetes/Helm path)

- **OpenWhisk / functions** — too heavy to run under docker compose.
- **The Falcone app + APISIX gateway containers** — there are no Dockerfiles for
  them; in these tests the Falcone microservices run **in-process** (specs import
  the service `.mjs` and hit this live backing infra).
- **Observability** (metrics/tracing/logging stack).

These remain covered by the Helm chart / real-stack E2E (`tests/e2e`).
| action-runner | `http://localhost:8090` (`/healthz`) | TEST-ONLY HTTP shim that runs real product actions with per-route dependency injection (HTTP-slice only) |
| APISIX   | `http://localhost:9080` (`/v1/scheduling/*`, `/v1/async-operations`, `/v1/admin/config/format-versions`, `/v1/plans`, `/v1/plans/change-history`, `/v1/quota-dimensions`, `/v1/tenant/entitlements`, `/v1/workspace-sub-quotas`, `/v1/backups/status`) | API gateway: validates the Keycloak JWT and injects identity headers (HTTP-slice only). **Exception:** `/v1/backups/status` is a **plain proxy** — that family authenticates **in-action** (see below). |

### Keycloak model (matches production)

In Falcone the **Keycloak realm name equals the `tenantId`** (see
`packages/provisioning-orchestrator/src/reprovision/identifier-map.mjs::deriveIamRealm`),
and a realm's **`displayName`** is the authoritative human-readable tenant name.

`up.sh` provisions a master-realm **admin service account** (`falcone-admin`,
secret `falcone-admin-secret`, granted the realm `admin` role) — the same
client-credentials → admin-API pattern `provisioning-orchestrator` uses, and what
the chart provisions as the `in-falcone-keycloak-admin` secret.

Seeded tenant realms (`keycloak/import/*.json`):

| tenantId (realm)                         | displayName        |
|------------------------------------------|--------------------|
| `11111111-1111-1111-1111-111111111111`   | Acme Corporation   |
| `22222222-2222-2222-2222-222222222222`   | Globex Industries  |

## Lifecycle

```bash
bash tests/env/up.sh      # start, wait for health, provision Keycloak, migrate Postgres
source tests/env/env.sh   # export DB_URL / KEYCLOAK_* / seeded tenant ids into your shell
bash tests/env/run.sh     # run the real-stack tests against the live env
bash tests/env/down.sh    # tear down (containers + ephemeral data)
```

`up.sh` is idempotent. `env.sh` is the single source of truth for the endpoints
and credentials; tests and ad-hoc probes should `source` it.

## Writing real-stack tests

Place them under a service's `test/integration/` and **gate them on the env marker**
so the normal unit suite stays green when the env is not running:

```ts
const RUN = process.env.FALCONE_TESTENV === '1' && !!process.env.KEYCLOAK_BASE_URL
describe.skipIf(!RUN)('... vs REAL Keycloak', () => { /* uses real fetch, no mocks */ })
```

Reference: `packages/backup-status/test/integration/tenant-name-resolver.keycloak.test.ts`
drives the actual `createKeycloakTenantNameResolver` against the live Keycloak
(real client-credentials flow + admin API) and asserts the fail-closed contract.

## HTTP request-chain slice (multiple action families)

`up.sh` also boots an **API-level vertical slice** that runs Falcone's real HTTP
request chain end-to-end for several action families:

```text
Keycloak (JWT)  ->  APISIX (auth + identity-header inject)  ->  action-runner shim
                ->  product action (real, imported as-is)  ->  Postgres
```

Families behind the gateway (each exercised by the smoke test):

| Family | Route(s) | Product action (imported as-is) | Invoke style / deps |
|--------|----------|---------------------------------|---------------------|
| scheduling | `/v1/scheduling/*` | `scheduling-engine/actions/scheduling-management.mjs` | `params-pg` — `params.pg` = pg Pool |
| async-operation | `POST/GET /v1/async-operations`, `GET /v1/async-operations/{id}` | `provisioning-orchestrator/src/actions/async-operation-create.mjs` + `async-operation-query.mjs` | `params-overrides` — `main(params, overrides)`, `overrides.db` = pg Pool |
| tenant-config formats | `GET /v1/admin/config/format-versions` | `provisioning-orchestrator/src/actions/tenant-config-format-versions.mjs` | `params-only` — pure GET, no DB |
| plan catalog | `POST /v1/plans`, `GET /v1/plans` | `provisioning-orchestrator/src/actions/plan-create.mjs` + `plan-list.mjs` | `params-callercontext-overrides` — `main(params, overrides)`, `overrides.db` = pg Pool, `params.callerContext` built from headers; **superadmin only** |
| plan lifecycle/removal | `POST /v1/plans/{planId}/lifecycle`, `DELETE /v1/plans/{planId}` | `provisioning-orchestrator/src/actions/plan-lifecycle.mjs` + `plan-delete.mjs` | `params-callercontext-overrides` — lifecycle is forward-only (`draft -> active -> deprecated -> archived`); delete hard-removes only never-assigned plans and returns `PLAN_HAS_ASSIGNMENT_HISTORY` for active or historical assignments; **superadmin only** |
| quota dimensions | `GET /v1/quota-dimensions` | `provisioning-orchestrator/src/actions/quota-dimension-catalog-list.mjs` | `params-callercontext-overrides` — db via `overrides.db`, identity via `params.callerContext`; **superadmin only** |
| plan change-history | `GET /v1/plans/change-history?tenantId=<id>` | `provisioning-orchestrator/src/actions/plan-change-history-query.mjs` | `params-callercontext-overrides` — db via `overrides.db`, identity via `params.callerContext`, `?tenantId`/`?page` flattened (`mergeQueryIntoParams`); **superadmin/internal only** — reads `tenant_plan_change_history` (per-tenant plan-change audit trail) |
| workspace sub-quota | `POST /v1/workspace-sub-quotas`, `GET /v1/workspace-sub-quotas` | `provisioning-orchestrator/src/actions/workspace-sub-quota-set.mjs` + `workspace-sub-quota-list.mjs` | `params-callercontext-overrides` — db via `overrides.db`, identity via `params.callerContext` (body merged for set, query for list); **tenant-scoped write** — a `tenant_owner` sets only within its own tenant (cross-tenant body `tenantId` → 403), an allocation over the tenant's effective limit → 422; writes `workspace_sub_quotas` (migration 105) |
| tenant entitlements | `GET /v1/tenant/entitlements` | `provisioning-orchestrator/src/actions/tenant-effective-entitlements-get.mjs` | `params-callercontext-overrides` — db via `overrides.db`, identity via `params.callerContext`, `?tenantId` flattened (`mergeQueryIntoParams`); **first tenant-scoped family** — a `tenant_owner` reads only its own tenant (cross-tenant `?tenantId` → 403); superadmin may cross-scope |
| backup-status | `GET /v1/backups/status` | `backup-status/src/api/backup-status.action.js` | `params-owhttp` — `main(params)`, **in-action JWKS auth** (NOT gateway headers): the action reads the Bearer token itself and verifies the JWT signature against `KEYCLOAK_JWKS_URL`, then derives tenant + scopes from the token's own claims; uses the product's OWN module-level pg client (shim primes it via `setClient`, `setClientModule`); `?tenant_id` flattened (`mergeQueryIntoParams`). **First in-action-auth family** — tenant/scope matrix: own-tenant `read:own` vs global `read:global` (cross-tenant `?tenant_id` → 403; global view without `read:global` → 403) |

| Piece | Where | What it does |
|-------|-------|--------------|
| action-runner shim | `action-runner/` (`server.mjs`, `routes.mjs`, `Dockerfile`) | node:http server. Adapts a plain HTTP request into the OpenWhisk-style `params` actions read (`__ow_headers`, `method`, `path`, `query`, `body`) and invokes each **product action as-is** (imported from the repo bind-mounted read-only at `/repo`), returning its `{statusCode, headers?, body}`. The route table (`routes.mjs`) is data-driven AND declares **per-route dependency injection** (`invoke` style + `deps`) so actions with different DI models — `params.pg`, `main(params, overrides)`, or no deps — coexist behind one shim. Routes can also opt into OpenWhisk-style flattening of the query string / JSON body into top-level params (`mergeQueryIntoParams` / `mergeBodyIntoParams`) and supply `defaults` (e.g. `queryType`). |
| APISIX | `apisix/config.yaml` (standalone YAML mode), `apisix/apisix.yaml` (routes) | Gateway for all slice routes. For most routes: `openid-connect` (bearer-only) validates the Keycloak access token; a `serverless-pre-function` then strips any client-supplied `x-*` identity headers and re-injects them from the **verified** token claims; `proxy-rewrite` forwards to the shim. The same plugin chain is inlined per route (APISIX's tinyyaml parser does not support YAML anchors). **Exception — `/v1/backups/status`:** a **plain proxy** with NO `openid-connect` and NO identity injection, because the backup-status action validates the Bearer JWT itself (JWKS) and reads its own claims. APISIX forwards the `Authorization` header upstream unchanged by default, so the action receives the raw token. |
| Keycloak realm | `keycloak-e2e-provision.sh` | Realm `falcone-e2e`, public ROPC client `falcone-e2e-client`, and two users: `e2e-user`/`e2e-password` (role `scheduling.admin`, attributes `actor_type=tenant_owner` + `actor_scopes=platform:admin:config:export` + `backup_scopes=["backup-status:read:own"]`) for the scheduling/async-operation/tenant-config families, **the tenant-scoped entitlements family** (a `tenant_owner` reads only its own tenant), **and the backup-status family** (own-tenant `read:own`), and `e2e-superadmin`/`e2e-superadmin-password` (`actor_type=superadmin` + `backup_scopes=["backup-status:read:global","backup-status:read:technical"]`) for the plan/quota families (superadmin cross-scope entitlements reads, and the backup-status **global** view). Both reuse the same client claim mappers (see below), plus a dedicated `scopes` mapper (multivalued array, from `backup_scopes`) that ONLY the backup-status family consumes. |

### Boot + hit the API

```bash
bash tests/env/up.sh          # boots backing services + the slice, provisions Keycloak
source tests/env/env.sh        # exports APISIX_BASE_URL, E2E_REALM/CLIENT/USER/PASSWORD, E2E_TENANT_ID/...

# 1) get an access token (Resource Owner Password grant)
TOKEN=$(curl -s -X POST \
  "$KEYCLOAK_BASE_URL/realms/$E2E_REALM/protocol/openid-connect/token" \
  -d grant_type=password -d "client_id=$E2E_CLIENT_ID" \
  -d "username=$E2E_USERNAME" -d "password=$E2E_PASSWORD" | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')

# 2) call the gateway (no token -> 401)
curl -s -o /dev/null -w '%{http_code}\n' "$APISIX_BASE_URL/v1/scheduling/jobs"           # 401

# 3) enable scheduling, create a job, list it (authenticated)
curl -s -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -X PATCH "$APISIX_BASE_URL/v1/scheduling/config" -d '{"schedulingEnabled":true}'
curl -s -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -X POST  "$APISIX_BASE_URL/v1/scheduling/jobs"   -d '{"name":"nightly","cronExpression":"0 2 * * *","targetAction":"reports/build"}'   # 201
curl -s -H "Authorization: Bearer $TOKEN" "$APISIX_BASE_URL/v1/scheduling/jobs"          # lists it
```

### Smoke tests

```bash
bash tests/env/e2e-smoke/run.sh        # curl/node: per family 401 -> token -> create -> read-back
( cd tests/env/e2e-smoke && npm install && npx playwright test )   # same flows via @playwright/test request API
```

The smoke run covers all seven families end-to-end:
- **scheduling** — 401 unauthenticated, then `POST /v1/scheduling/jobs` → 201, then listed.
- **async-operation** — 401 unauthenticated, `POST /v1/async-operations` → 200 (the
  action's `formatCreateResponse` contract returns **200**, not 201), then
  `GET /v1/async-operations/{id}` detail returns it, then it appears in the list.
- **tenant-config formats** — 401 unauthenticated, then
  `GET /v1/admin/config/format-versions` → 200 with `current_version` + non-empty `versions`.
- **plan catalog** — 401 unauthenticated, then a **negative authZ probe** (the
  `tenant_owner` user `POST /v1/plans` → **403**, proving the superadmin gate is
  real), then the `e2e-superadmin` user `POST /v1/plans` → 201 and the created plan
  appears in `GET /v1/plans`.
- **quota dimensions** — 401 unauthenticated, then the `e2e-superadmin` user
  `GET /v1/quota-dimensions` → 200 with the seeded catalog (≥ 8 dimensions,
  including `max_workspaces`, from migration `098-plan-base-limits.sql`).
- **plan change-history** (superadmin-only per-tenant **audit trail**) — `up.sh`
  gives tenant A a realistic change trail without disturbing its active plan:
  a prior, superseded `e2e-starter-plan` assignment plus two
  `tenant_plan_change_history` rows (an `initial_assignment` onto starter and an
  `upgrade` starter → pro; the active plan stays `e2e-pro-plan`). 401
  unauthenticated, then the **authz probe** — the `tenant_owner` `e2e-user`
  `GET /v1/plans/change-history?tenantId=<A>` → **403** (the action allows only
  `superadmin`/`internal`), then the `e2e-superadmin`
  `GET /v1/plans/change-history?tenantId=<A>` → 200 whose `items` (`total` ≥ 2)
  include both an `initial_assignment` and an `upgrade` `changeDirection`. The
  Playwright mirror is `plan-change-history-http-slice.spec.ts`.
- **workspace sub-quota** (tenant-scoped **write** family with an **IDOR probe**
  AND a **quota-enforcement probe**) — allocates a per-workspace slice of a tenant
  quota dimension. 401 unauthenticated; then the `tenant_owner` `e2e-user`
  `POST /v1/workspace-sub-quotas` for `max_workspaces=10` (≤ tenant A's
  plan-derived limit of 50) → **2xx** (`201` on first create, `200` on re-run —
  the set is idempotent-but-stateful, so the smoke asserts any 2xx + the stored
  value); then the **limit probe** `max_workspaces=999` (> 50) → **422**
  (`SUB_QUOTA_EXCEEDS_TENANT_LIMIT`); then the **IDOR probe** — the same
  `tenant_owner` POSTing with a body `tenantId` = `<TENANT_B>` → **403** (it may
  write only within its own tenant); then `GET /v1/workspace-sub-quotas` → 200
  whose `items` include the `max_workspaces=10` allocation. Needs migration
  `105-effective-limit-resolution` (the `workspace_sub_quotas` table). The
  Playwright mirror is `workspace-sub-quota-http-slice.spec.ts`.
- **tenant entitlements** (the **first tenant-scoped family**, with a cross-tenant
  **IDOR probe**, over **real plan-derived limits**) — `up.sh` assigns plan
  `e2e-pro-plan` (`quota_dimensions={"max_workspaces":50}`) to tenant A, so the
  resolution path is exercised end-to-end (plan → `tenant_plan_assignments` →
  `resolveUnifiedEntitlements`). 401 unauthenticated, then the `tenant_owner`
  `e2e-user` `GET /v1/tenant/entitlements` → 200 whose `quantitativeLimits` are
  **plan-derived, not catalog defaults**: `planSlug:"e2e-pro-plan"` and the
  `max_workspaces` dimension resolves to `source:"plan"` with `effectiveValue:50`
  (vs the `catalog_default`/`planSlug:null` fallback for an unassigned tenant);
  then the **IDOR probe** `GET /v1/tenant/entitlements?tenantId=<TENANT_B>` → **403**
  (a `tenant_owner` may read only its own tenant; the action throws `FORBIDDEN`
  before any DB access, so `TENANT_B` need not exist), then the `e2e-superadmin`
  `GET /v1/tenant/entitlements?tenantId=<own tenant>` → 200 (a superadmin may
  cross-scope and sees the same `planSlug:"e2e-pro-plan"`). The Playwright mirror
  is `tenant-entitlements-http-slice.spec.ts`.
- **backup-status** (the **first in-action-auth family**, with a cross-tenant
  **IDOR probe**, a **scope probe**, AND a **data-layer leak probe** over seeded
  fixtures) — `up.sh` seeds `backup_status_snapshots` with a tenant-A OWN row
  (`tenant-a-primary-db`, non-shared) and a tenant-B **SHARED** row
  (`shared-platform-objectstore`). First the minted `tenant_owner` token is
  decoded and asserted to carry the `scopes:["backup-status:read:own"]` claim
  (Keycloak unmanaged-attribute → claim mapping is finicky, so this is verified
  empirically); then **no bearer token** `GET /v1/backups/status` → **401** *from
  the action's own validator* (the route is a plain proxy with no gateway
  jwt-auth); then the `tenant_owner` `e2e-user`
  `GET /v1/backups/status?tenant_id=<A>` → 200 with
  `deployment_backup_available:true` and the own component `tenant-a-primary-db`
  present; then the **data-layer leak probe** — that same response MUST NOT
  contain `shared-platform-objectstore` (`getByTenant(includeShared:false)` →
  `WHERE tenant_id=$1 AND is_shared_instance=FALSE`, plus two in-action belts —
  proving the *data* layer, not just the auth gate, keeps tenants apart); then the
  **IDOR probe** `GET /v1/backups/status?tenant_id=<TENANT_B>` → **403** (a
  `tenant_owner` lacks `read:global`, so it cannot read another tenant's backup
  status); then the **scope probe** `GET /v1/backups/status` with no `tenant_id`
  → **403** (the global view requires `read:global`, which a `tenant_owner`
  lacks); then the `e2e-superadmin` (`read:global` + `read:technical`)
  `GET /v1/backups/status` with no `tenant_id` → 200 (`tenant_id:null`) whose
  components contain **both** `tenant-a-primary-db` **and**
  `shared-platform-objectstore` — the contrast that shared rows are visible to a
  platform/technical caller (`getAll(includeShared:true)`) but invisible to a
  tenant-scoped one. The Playwright mirror is `backup-status-http-slice.spec.ts`.

### How identity flows (claims -> headers)

Most actions derive identity **only** from trusted gateway-injected headers
(`scheduling-management.mjs::parseIdentity`, `async-operation` `caller-context.mjs`,
`tenant-config` `parseConfigIdentity`). The **plan/quota** actions instead read a
pre-built `params.callerContext.actor` object directly — they do **not** re-derive
it from `__ow_headers`. In the real system a trusted HTTP handler builds that
object from the gateway headers before dispatch; the slice's shim does the same in
its `params-callercontext-overrides` invoke style (`buildCallerContextFromHeaders`
in `action-runner/server.mjs`), **overwriting** any client-supplied `callerContext`
so the request body can never spoof identity. The slice produces the headers like this:

- **Keycloak mappers** (`keycloak-e2e-provision.sh`) put these on the *access token*:
  - `tenant_id`, `workspace_id` — `oidc-usermodel-attribute-mapper` from the user's
    `tenant_id` / `workspace_id` attributes (realm has `unmanagedAttributePolicy=ENABLED`
    so Keycloak 26 does not strip them).
  - `actor_roles` — `oidc-usermodel-realm-role-mapper` (multivalued, unprefixed), includes `scheduling.admin`.
  - `actor_type` — `oidc-usermodel-attribute-mapper` from the user's `actor_type`
    attribute. `e2e-user` is `tenant_owner` (required by the async-operation create
    model, which only accepts `{workspace_admin, tenant_owner, superadmin,
    tenant_member}`); `e2e-superadmin` is `superadmin` (required by the plan/quota
    actions, which compare `actor.type === 'superadmin'`). `superadmin` is the one
    value identical across both conventions, so a single superadmin user satisfies
    both contracts.
  - `actor_scopes` — `oidc-usermodel-attribute-mapper` (multivalued) from the user's
    `actor_scopes` attribute (`platform:admin:config:export`; required by the
    tenant-config format-versions action).
  - `scopes` — `oidc-usermodel-attribute-mapper` (**multivalued ARRAY**) from the
    user's `backup_scopes` attribute. **Consumed ONLY by the backup-status family**,
    which validates the token in-action and reads `claims.scopes` itself (NOT the
    gateway's `actor_scopes`). `e2e-user` carries `["backup-status:read:own"]`;
    `e2e-superadmin` carries `["backup-status:read:global","backup-status:read:technical"]`. (The gateway never sees
    this claim — its `serverless-pre-function` does not inject it.)
  - `sub` — standard subject.
- **APISIX** (`apisix/apisix.yaml`): `openid-connect` validates the token, then the
  `serverless-pre-function` decodes the verified token and sets upstream headers
  `X-Tenant-Id <- tenant_id`, `X-Workspace-Id <- workspace_id`,
  `X-Auth-Subject <- sub`, `X-Actor-Roles <- actor_roles` (joined),
  `X-Actor-Type <- actor_type`, `X-Actor-Scopes <- actor_scopes` (joined). It first
  deletes any caller-supplied `X-*` identity headers, so a client cannot spoof identity.

### In-action JWKS auth (backup-status — a different auth model)

Every family above trusts the **gateway** as the auth boundary: APISIX validates
the JWT and the action consumes pre-injected identity headers. The **backup-status**
family is deliberately different — it is the first family that authenticates
**in-action**:

- Its APISIX route (`backup-status-get`) is a **plain proxy**: NO `openid-connect`
  plugin and NO identity-header injection. APISIX forwards the `Authorization`
  header upstream unchanged (its default behavior — nothing in the route strips it).
- The product action (`backup-status.action.js::main`, `params-owhttp` invoke)
  reads the Bearer token from `params.__ow_headers.authorization` and **verifies the
  JWT signature itself** against the realm JWKS, using the action-runner container
  env `KEYCLOAK_JWKS_URL=http://keycloak:8080/realms/falcone-e2e/protocol/openid-connect/certs`
  (a JWKS Bearer-JWT validator, via the action's `jose` + `jwks-rsa` imports). No /
  invalid token → **401 from the action** (not the gateway).
- It derives identity from the **token's own claims**: `tenantId <- tenant_id`,
  `scopes <- scopes` (array) or `scope` (space-split). It does NOT read the gateway
  `x-*` headers or the `actor_scopes` claim at all.
- Authorization matrix (over `?tenant_id=`, flattened by `mergeQueryIntoParams`):
  - `tenant_id` present → requires `read:global` OR (`claims.tenantId === tenant_id`
    AND `read:own`); a different tenant without `read:global` → **403** (cross-tenant
    IDOR blocked).
  - `tenant_id` absent → requires `read:global`; otherwise → **403** (global view).
- DB: the action queries snapshots via its **own** module-level pg client. The
  COMPILED `.js` repository (`db/repository.js`) reads a module-level `_client`
  directly — it does NOT lazily build a Pool from `DB_URL` the way the `.ts`
  `getClient()` does — so the shim primes it once via the repository's exported
  `setClient(pool)` (declared on the route as `setClientModule`). Without that,
  every authorized request would 500 with "No DB client injected". `DB_URL` is also
  set on the container (`postgres://falcone:falcone@postgres:5432/falcone_test`,
  the in-network host/port) for completeness.
- **`KEYCLOAK_ISSUER` / `KEYCLOAK_AUDIENCE` are intentionally NOT set** on the
  container: the action applies those claim checks only when present, and ROPC
  tokens' issuer/audience would otherwise mismatch. The JWKS signature is the real
  gate. `TEST_MODE` is NOT set (the action refuses it whenever a JWKS URL is
  configured); `NODE_ENV` is `test` (non-production).

The smoke decodes the minted token's payload (base64url middle segment) and asserts
the `scopes` claim is actually present before running the matrix, because Keycloak's
unmanaged-attribute → array-claim mapping is finicky.

### Scope / deferred (honest)

- **Families covered: scheduling, async-operation, tenant-config format-versions,
  plan catalog (create/list), quota dimension catalog (list), tenant effective
  entitlements (get), backup-status (get).** The route table
  (`action-runner/routes.mjs`) is data-driven with per-route DI; other actions can
  be added the same way (declare `invoke` + `deps`).
- **backup-status — first in-action-auth family + IDOR probe + scope probe + no
  snapshot seeding.** It is the only family that authenticates itself (JWKS) rather
  than trusting gateway headers, and the only one that uses the product's own
  module-level pg client (primed by the shim via `setClient`). See "In-action JWKS
  auth" above. **No backup snapshots are seeded**, so the positive 200 responses
  carry `deployment_backup_available:false` (and a Spanish `message`); that is
  sufficient to prove the auth matrix end-to-end — the IDOR/scope 403s fire before
  any query, and the own/global 200s only need a reachable, empty snapshots table
  (created by migration `001_backup_status_snapshots.sql`, applied by `up.sh`).
  Issuer/audience claim checks are intentionally not enabled (signature is the gate).
- **backup-status dep resolution (test-env wiring, not a product change).** The repo
  is bind-mounted from a git **worktree** that has no `node_modules`, and the
  backup-status action imports `jose` + `jwks-rsa` (unlike the other families, whose
  graphs are builtins + local `.mjs` + `pg`). Node's ESM resolver does not honor
  `NODE_PATH` for static bare imports, so the action-runner image installs those
  deps (added to `action-runner/package.json`) and exposes them at the filesystem
  root `/node_modules` (a symlink in the `Dockerfile`), the final candidate the ESM
  resolver checks when walking up from `/repo`. Product source under `/repo` is
  untouched.
- **tenant effective entitlements — first tenant-scoped family + IDOR probe.**
  Every prior family is either tenant-agnostic or superadmin-only; this is the
  first family whose authorization is **per-tenant** (a `tenant_owner` may read
  only its own tenant). The action reads `params.callerContext.actor` and rejects a
  cross-tenant `?tenantId` mismatch with `FORBIDDEN`/403 **before any DB access**,
  so the smoke's IDOR probe (`?tenantId=22222222-…` as `e2e-user`) proves
  cross-tenant isolation without seeding a second tenant. The positive own-tenant
  read exercises the **real** resolution path: `up.sh` assigns plan `e2e-pro-plan`
  (`quota_dimensions={"max_workspaces":50}`) to tenant A, so
  `resolveUnifiedEntitlements` (LEFT JOINing the catalog/plan-assignment/override
  tables) returns `planSlug:"e2e-pro-plan"` with the `max_workspaces` dimension at
  `source:"plan"`/`effectiveValue:50` — not the `catalog_default`/`planSlug:null`
  fallback an unassigned tenant would get.
  This family needs three more migrations than the plan/quota families —
  `100-plan-change-impact-history` (loop dependency ordering), `103-hard-soft-quota-overrides`
  (the `quota_overrides` table the entitlements query LEFT JOINs), and
  `104-plan-boolean-capabilities` (the optional `boolean_capability_catalog`; its
  `42P01` is caught, but seeding it exercises the full capability-resolution path)
  — all applied idempotently by `up.sh` after 097/098.
- **plan/quota identity model.** Unlike the other families, the plan/quota actions
  read `params.callerContext.actor` directly instead of re-deriving it from
  `__ow_headers`. The shim builds `callerContext` from the trusted gateway headers
  (`params-callercontext-overrides`) and overwrites any client value — faithful to
  the gateway-as-trust-boundary model. The smoke includes a negative probe
  (`tenant_owner` → 403 on `POST /v1/plans`) so the superadmin gate is verified, not
  assumed.
- **quota-override-list / quota-effective-limits-get: deferred.** Their repositories
  (`quota-override-repository.mjs::listOverrides`, `quota-enforcement-repository.mjs`)
  operate on an **in-memory store** (`db._quotaOverrides`, `ensureStores(db)`) rather
  than issuing SQL against a pg Pool, so they are not wireable end-to-end through the
  shim's shared Pool without a fake-db adapter. `quota-dimension-catalog-list` was
  chosen for the quota family precisely because its repository issues real SQL
  (`SELECT … FROM quota_dimension_catalog`) against the Pool. `plan-get` (superadmin
  or tenant-owner, real SQL) is wireable too but was left out to keep the slice to
  one create+list pair per family.
- **async-operation result schema: covered; idempotency-key path: deferred.**
  Migration 079 adds `result` and `completed_at` after the existing 073–078 chain,
  and the dedicated C-11 PostgreSQL suite verifies the real result repository and
  action. The HTTP smoke remains scoped to create (without an idempotency key),
  `detail`, and `list`. The idempotency-key create path still runs
  `BEGIN`/`COMMIT` across a shared pool without a single-connection guarantee, so
  that separate path remains deferred from this slice.
- **Custom scope-enforcement Lua plugin: deferred** (out of scope for this slice).
  APISIX here does AuthN + identity-header injection, not the fine-grained
  per-resource scope checks the production gateway plugin performs.
- **Web-console UI: deferred** — the console backend is not present in this repo,
  so the slice is API-level only.

## Extending

- **More backing services**: add them to `docker-compose.yml`, expose host ports
  with a healthcheck consistent with the existing services (so `up.sh`'s health
  loop works), wire any bootstrap into `up.sh`, and export their endpoints in
  `env.sh`. (Postgres, Keycloak, Redpanda, MongoDB, SeaweedFS and Vault are already
  provided.)
- **More backing services** (Vault, SeaweedFS, MongoDB): add them to
  `docker-compose.yml`, expose host ports, and export their endpoints in `env.sh`.
- **More slice routes**: add a `{ name, methods, pathRegex, module, exportName, invoke, deps? }`
  entry to `action-runner/routes.mjs` (the shim imports the module from the
  bind-mounted repo) and an APISIX route in `apisix/apisix.yaml`. Pick the `invoke`
  style that matches how the action takes its dependencies (`params-pg`,
  `params-overrides` + `deps: ['db']`, `params-callercontext-overrides`,
  `params-only`, or `params-owhttp` for an action that does its OWN auth + DB —
  add `setClientModule` if it keeps its pg client in a module-level singleton that
  needs priming via an exported `setClient`), and set `mergeQueryIntoParams` /
  `mergeBodyIntoParams` / `defaults` if the action reads flat top-level params
  (OpenWhisk web-action style). If the action has external npm deps not present in
  the bind-mounted worktree, add them to `action-runner/package.json` (they become
  resolvable at `/node_modules` for the `/repo`-imported action).
- **More seeded tenants**: drop another `keycloak/import/<id>-realm.json` (realm
  name = tenantId, with a `displayName`).
- **Full API integration** (tests that need a service's HTTP API, e.g. the
  backup-status `test/integration/*-api.test.ts`): also start the service pointed
  at `DB_URL` / `KEYCLOAK_*` and export `API_BASE_URL` + test tokens.
