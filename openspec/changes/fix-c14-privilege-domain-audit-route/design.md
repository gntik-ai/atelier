# Design: Canonical privilege-domain denial audit route

## Context

C-14 joins five already-existing pieces that currently disagree:

1. The product action
   `packages/provisioning-orchestrator/src/actions/privilege-domain-audit-query.mjs::main` implements
   a read-only tenant/workspace denial query.
2. `privilege-domain-repository.mjs::queryDenials` performs a count and a list against
   `privilege_domain_denials`, applying optional tenant, workspace, required-domain, actor, and time
   predicates before `LIMIT`/`OFFSET`.
3. Both control-plane maps point that action at an unversioned
   `/api/workspaces/{workspaceId}/privilege-domains/audit` route.
4. The console audit client calls a different unversioned
   `/api/security/privilege-domains/denials` target with unauthenticated bare `fetch`, and the
   existing page has no router or navigation entry.
5. The governance bootstrap applies migration `093` and then later migrations, but skips the broad
   migration `094` that happens to define the denial table.

The web-console edge and APISIX already establish the correct versioned transport boundary. The
static edge proxies `/v1` and `/v1/*` to the gateway before SPA fallback. The APISIX workspace route
and `/v1/*` control-plane catch-all have higher priority than `/*`, so a canonical workspace `/v1`
request reaches the control plane without a new gateway alias or rewrite. Conversely, `/api/*` is
not an API transport contract and reaches the SPA catch-all.

The current action's behavior is intentional input to this design:

- It reads `params.auth.roles` and authorizes only a role list containing `platform_admin` or
  `tenant_owner`.
- The `platform_admin` branch runs first. It requires query parameter `tenantId` and returns the
  action's current `400` validation result before repository access when it is absent.
- A `tenant_owner` must have a trusted authentication tenant. An explicit `tenantId` different from
  that tenant returns the current `403` mismatch result before repository access. Otherwise the
  action replaces the requested tenant with `auth.tenantId`.
- All other role sets return the current `403` insufficient-privileges result before repository
  access. The fact that other parts of the console may treat `superadmin` broadly does not change
  this action.
- It computes the current limit value with the existing default and upper clamp, computes the
  existing offset, forwards the current filters, and returns
  `{ denials, total, limit, offset }`.
- The repository does not resolve a workspace in a registry. It applies `tenant_id` and
  `workspace_id` as historical row predicates. A correctly authorized request for an unknown or
  row-less workspace therefore returns an empty `200`, not `404`.

C-14 makes that behavior reachable and bootable. It does not redesign it.

## Goals / Non-Goals

**Goals:**

- Establish one canonical, authenticated public route at
  `GET /v1/workspaces/{workspaceId}/privilege-domains/audit` across contract, generated artifacts,
  maps, runtime, console client, and reference documentation.
- Keep action authorization and repository behavior byte-for-semantics compatible, including the
  exact two allowed role tokens, platform-admin tenant requirement, tenant-owner mismatch handling,
  historical empty-workspace result, filters, pagination, and response envelope.
- Make the existing console page discoverable only to the two allowed roles and prevent background
  data requests for every other role or when active scope is incomplete.
- Bind console requests to the active shell tenant/workspace and prevent prior-scope rows or CSV
  content from surviving a scope change, error, or superseded request.
- Make `privilege_domain_denials` available on fresh control-plane boot through one narrow,
  idempotent, dependency-safe migration without activating the unrelated content of `094`.
- Provide deterministic local proof of the public listener, transport parity, contracts,
  authorization/isolation, schema states, console client/guard/context behavior, docs, and
  validators.

**Non-Goals:**

- Any `/api` alias, redirect, gateway rewrite, or support for the existing broken URL.
- Repairing privilege-domain assignment/query clients or any other adjacent `/api` route.
- Adding a role, interpreting `superadmin` as `platform_admin`, granting platform auditors or
  workspace roles access, or changing the authorization model/RBAC.
- Adding a workspace/tenant existence lookup, changing empty history to `404`, changing the action
  identifier, or absorbing C-16.
- Input-validation, error-envelope, filter, sorting, cursor, offset, limit, pagination, data-masking,
  or CSV redesign. C-02 and other validation/pagination findings are separate.
- Running or rewriting migration `094`, creating assignment/history/view objects, altering API-key
  or endpoint-scope tables, seeding endpoint classifications, or backfilling/deleting data.
- Adding GET side effects, quota behavior, audit emission, or C-14-specific metrics.
- Deployment or Kubernetes work, audit-loop/evidence changes, or agent assets.

## Decisions

### Decision 1: Use one canonical workspace-family `/v1` operation

The public operation is:

```text
GET /v1/workspaces/{workspaceId}/privilege-domains/audit
operationId: queryPrivilegeDomainAudit
family: workspaces
scope: workspace
```

The `workspaces` public family is selected because its declared prefix is `/v1/workspaces`, and the
operation is addressed by a workspace path. The operation remains implemented by the existing
provisioning-orchestrator IAM/governance action; public family classification does not move or
rewrite the action.

The unified OpenAPI operation will describe:

- required path parameter `workspaceId`;
- existing query parameters `tenantId`, `requiredDomain`, `actorId`, `from`, `to`, `limit`, and
  `offset`;
- the conditional authorization semantics that `tenantId` remains required for `platform_admin`
  and optional/owned by trusted auth context for `tenant_owner`;
- the existing success envelope and all denial fields (`id`, `tenantId`, nullable `workspaceId`,
  `actorId`, `actorType`, nullable `credentialDomain`, `requiredDomain`, `httpMethod`, `requestPath`,
  nullable `sourceIp`, `correlationId`, and `deniedAt`);
- the existing public error boundary for authentication, validation, authorization, gateway
  resilience, and unexpected failures without introducing C-02 changes; and
- explicit documentation that a valid, authorized workspace history query with no matching rows
  returns an empty `200` and does not produce a resource-not-found outcome.

OpenAPI remains the source for generated artifacts. Running the repository generator updates the
workspace-family document, internal public route catalog, and public API surface reference. The
operation carries only the broad public audience labels needed by the taxonomy; its description
and the runtime action define the exact role gate. The generated catalog must not be treated as an
independent authorization grant.

Both `apps/control-plane/route-map.json` and `apps/control-plane/route-map.runtime.json` will replace
the audit entry's `/api` template with the canonical template while preserving:

```text
module: packages/provisioning-orchestrator/src/actions/privilege-domain-audit-query.mjs
export: main
invoke: params-auth-overrides
deps: db/pg as represented by the respective map
auth: authenticated
mergeQueryIntoParams: true in the runtime map
```

The route remains coarse-authenticated at dispatch because a broader server route auth token such as
`tenant_owner` currently admits aliases and platform roles that do not match the action's exact
policy. The action remains the final authorization boundary.

No `/api` audit entry is retained in either map, OpenAPI, generated artifact, client, router, or
documentation. An alias was rejected because it would preserve an unversioned public surface, would
not repair the unauthenticated client, and would contradict the established `/v1` same-origin edge.

### Decision 2: Reuse existing `/v1` gateway behavior without changing APISIX

No new APISIX route is required. The canonical request already matches the higher-priority
`/v1/workspaces/*` control-plane route and the general `/v1/*` control-plane fallback. The SPA edge
already forwards it to APISIX. C-14 will prove this by reading the shipped gateway configuration and
by a local production-shaped HTTP path, not by contacting a cluster.

The parity checker will compare the canonical method/path across unified OpenAPI, generated family,
generated route catalog, both control-plane maps, and the client URL constructor. It will also
assert that:

- the static edge classifies `/v1` before SPA fallback;
- APISIX gives `/v1/workspaces/*` higher priority than `/*` and targets the control-plane runtime;
- the runtime map imports the existing action with the preserved invocation contract; and
- no C-14 `/api` audit alias appears on any checked public/runtime/client surface.

Changing gateway routing was rejected because the current `/v1` precedence is correct and a C-14
specific route would duplicate it. Running a live APISIX/Kubernetes probe was rejected by the
local-only constraint.

### Decision 3: Treat the existing action and repository semantics as invariants

C-14 does not require a behavioral edit to
`privilege-domain-audit-query.mjs` or `privilege-domain-repository.mjs`. The canonical route passes
the path workspace and flattened query to the existing action, with trusted `params.auth` built from
the verified identity.

The exact authorization matrix is:

| Trusted role list and request | Outcome before repository access | Repository scope on success |
| --- | --- | --- |
| Contains `platform_admin`, `tenantId` present | allowed | requested tenant + path workspace |
| Contains `platform_admin`, `tenantId` absent | `400` | no query |
| Contains both `platform_admin` and `tenant_owner` | platform-admin branch takes precedence | same as platform admin |
| Contains `tenant_owner`, trusted auth tenant present, requested tenant absent or equal | allowed | trusted auth tenant + path workspace |
| Contains `tenant_owner`, trusted auth tenant absent | `403` | no query |
| Contains `tenant_owner`, requested tenant differs | `403` | no query |
| Only `superadmin`, `platform_auditor`, another tenant role, or workspace roles | `403` | no query |

The list inclusion rule means a principal carrying an allowed token plus another token is authorized
according to the existing branch order. It does not mean a principal is authorized merely because a
generic helper labels it an administrator.

For an authorized request, the repository continues to build one parameterized predicate list and
reuse it for both count and list queries:

```text
tenant_id = tenant scope
AND workspace_id = path workspace
AND optional required_domain
AND optional actor_id
AND optional denied_at lower/upper bounds
```

The existing default/upper clamp for `limit`, numeric conversion for `offset`, ordering by
`denied_at DESC`, and row projection remain unchanged. C-14 does not impose new validation or
normalize edge inputs differently. The response remains:

```json
{
  "denials": [],
  "total": 0,
  "limit": 50,
  "offset": 0
}
```

with populated denial objects when rows match.

No tenant/workspace registry lookup will be inserted. The history table is the only data read. Thus
an authorized tenant-plus-workspace predicate with zero rows, whether because the workspace is
unknown, has no denials, or the filters match nothing, returns the same empty `200`. This is an
explicit compatibility control and distinguishes C-14 from C-16. Cross-tenant ownership is decided
before either SQL statement, so the empty-result rule cannot be used to probe another tenant.

The GET adds no audit writer, denial writer, quota check, new metric instrument, backfill, or write.
Existing generic transport/error normalization and HTTP telemetry remain outside C-14 and are not
redesigned.

### Decision 4: Bootstrap only the denial table through a dedicated forward migration

A new next-order provisioning-orchestrator migration dedicated to the C-14 bootstrap will contain
the denial table definition already embedded in `094` and only the indexes directly associated with
that table. The expected table contract is:

| Column/constraint | Existing contract preserved |
| --- | --- |
| `id` | UUID primary key with `gen_random_uuid()` default |
| `tenant_id` | non-null UUID |
| `workspace_id` | nullable UUID |
| `actor_id` | non-null text |
| `actor_type` | non-null text, existing four-value check |
| `credential_domain` | nullable text, existing three-value check |
| `required_domain` | non-null text, existing two-value check |
| `http_method`, `request_path` | non-null text |
| `source_ip` | nullable `INET` |
| `correlation_id` | non-null text with the existing uniqueness constraint |
| `denied_at` | non-null timestamp with time zone and `now()` default |

The migration also creates, with stable names and `IF NOT EXISTS`, the existing tenant/time,
workspace/time partial, and required-domain/time indexes used by denial history access. It contains
no foreign key because the historical denial record deliberately does not depend on a live
workspace row.

The dedicated migration is registered in `GOVERNANCE_MIGRATIONS` after migrations that establish
its direct UUID-generation prerequisite and after the current governance sequence. The boot applier
continues to execute each forward migration with the existing search-path reset. Migration `094`
remains unchanged and unregistered.

Idempotence is defined for three states:

- **Fresh:** no denial table exists; the migration creates the exact table, constraints, and indexes.
- **Rerun:** the migration has already run; a second run succeeds without duplicate objects or row
  changes.
- **Pre-existing correct table:** the same table may already exist because an operator previously
  completed `094` or provisioned it manually; boot succeeds, required named indexes exist, and all
  existing rows remain unchanged.

The migration must not attempt to repair an arbitrary incompatible hand-written table by rewriting
rows or broadening into a general schema reconciler. It performs no `INSERT`, `UPDATE`, `DELETE`,
`TRUNCATE`, or `DROP`, and no assignment/history/API-key/endpoint-scope statement. Tests inspect the
actual migration and exercise all three supported states in an isolated local schema harness.

Running `094` was rejected because its assignment/history, view, API-key, endpoint-scope, and seed
effects are materially outside this read-route fix. Copying the entire file under a new name was
rejected for the same reason.

### Decision 5: Bind the existing page to authenticated shell scope

Only `queryPrivilegeDomainDenials` changes transport. Other functions in
`privilege-domain-api.ts` are adjacent assignment-surface findings and remain untouched.

The denial client accepts the authoritative workspace identifier separately from filter/query
values and calls:

```text
requestConsoleSessionJson(
  /v1/workspaces/${encodeURIComponent(activeWorkspaceId)}/privilege-domains/audit?...)
```

The active tenant is included as `tenantId`, satisfying the platform-admin branch and making the
selected tenant explicit. The path workspace overrides any legacy free-form workspace notion; page
input must not be allowed to replace the active tenant or workspace scope. Existing non-scope
filters and `limit`/`offset` are serialized as today. `requestConsoleSessionJson` supplies the bearer
session, version and correlation headers, and existing single refresh/retry behavior.

The page is mounted at `/console/privilege-domain-audit`. One shared helper determines visibility
and route access:

```text
roles.includes('platform_admin') || roles.includes('tenant_owner')
```

The helper contains no `superadmin`, auditor, tenant-admin, workspace-role, capability, or generic
write/admin shortcut. The navigation item uses the helper. The route guard uses the same helper and
returns an access-denied state without rendering the page when false. Because the child page is not
mounted, direct navigation by a disallowed principal cannot trigger its effect or request.

Inside the permitted route, the page reads `activeTenantId` and `activeWorkspaceId` from
`useConsoleContext`. If either is absent, it renders the existing style of context-required state and
does not call the API. The shell's context controls are the authoritative scope mechanism; the
remaining filter bar, table columns, denial badge, previous/next offset controls, and CSV format are
not redesigned.

Request state follows this transition model:

```text
allowed role + complete context
  -> clear rows/total/row-derived CSV
  -> start request keyed by tenant + workspace + current filters
  -> success from current key: replace rows/total
  -> failure from current key: keep rows/total/CSV cleared and show error
  -> response from superseded key: discard
```

Clearing occurs synchronously with a scope change rather than waiting for the next response. CSV is
always derived from the current rows (or disabled/empty when no current rows), so a prior tenant or
workspace cannot remain downloadable after an error. Filter changes preserve existing page
behavior, but scope changes are specifically tested as an isolation boundary.

Mounting the page for every authenticated principal and relying only on the backend was rejected
because it would expose a dead navigation surface and issue avoidable forbidden background requests.
Using a generic superadmin/platform helper was rejected because it would contradict the action.

### Decision 6: Verify every boundary locally and independently

The regression chain is intentionally layered:

1. **Public HTTP black-box:** start the real control-plane listener seam with a production-shaped
   route table built from the runtime entry, a deterministic verified-token stub, and an isolated
   database double. Exercise the canonical GET through HTTP rather than invoking only `main`.
2. **Gateway/runtime parity:** compare OpenAPI, generated artifacts, both maps, console client, static
   edge classification, and shipped APISIX route priority/target. Assert no C-14 `/api` alias.
3. **Contract:** assert operation, query parameters, success schema/envelope, exact generated-family
   parity, public catalog/docs presence, error schema references, and absence of a `404`/alias.
4. **Authorization/isolation:** direct action and public tests cover both allowed roles, every named
   denied role class, platform-admin missing tenant, tenant-owner trusted-tenant absence/mismatch,
   query-before-denial counters, filter/limit/offset forwarding, and tenant-plus-workspace SQL.
5. **Historical absence:** prove an authorized unknown workspace makes count/list queries and returns
   the stable empty `200`, while a cross-tenant owner makes zero queries.
6. **Schema:** apply the actual narrow migration in fresh, rerun, and pre-existing-correct-table
   states; verify object shape/indexes, row preservation, registration/order, and the absence of all
   `094`-only objects and data statements.
7. **Console client:** prove the encoded canonical URL, active tenant query, bearer/session helper,
   version/correlation behavior, and absence of bare audit `fetch` or `/api`.
8. **Router/navigation/context:** cover exact role sets, direct URL guard, no mount/request for denied
   roles, no request with incomplete context, active scope use, immediate clear on tenant/workspace
   change and error, CSV clearing, and stale-response discard.
9. **Docs and validators:** regenerate/check public API artifacts, validate OpenAPI/public API and
   relevant service/route checks, run focused tests, and run strict OpenSpec validation.
10. **Independent checkers:** one verifier reruns the proof and reviews the forbidden-scope diff; a
    different reviewer evaluates requirement coverage, security invariants, schema narrowness, and
    local-only evidence before handoff.

All network activity in these tests is loopback-only. No checker runs `kubectl`, Helm, a deployment,
or a live gateway/cluster probe. Test doubles must record query calls so pre-query authorization is
observable, and contract checks must discover operations by method/path or operation ID rather than
fragile line positions.

## File and Ownership Boundaries

Expected implementation surfaces are limited to:

- unified OpenAPI plus its generated workspace family, route catalog, and public API reference;
- `apps/control-plane/route-map.json` and `apps/control-plane/route-map.runtime.json`;
- one dedicated denial-table migration and `apps/control-plane/governance-schema.mjs` registration;
- the privilege-domain denial client, existing audit page, console route/guard, shared exact access
  helper, and navigation item;
- focused runtime/contract/action/schema/client/router/page tests; and
- focused existing migration/deployment references that currently claim `094` is required or the
  audit route necessarily fails.

The implementation diff must not include product changes to the existing audit action/repository,
other privilege-domain clients/routes, assignment or enforcement behavior, APISIX route behavior,
Kubernetes manifests, unrelated docs/tests, loop-state/evidence, or agent assets.

## Rollback Design

Rollback removes the canonical route exposure, generated contract entries, and console access
wiring, and unregisters the dedicated migration for future boots. It does not run down SQL, drop
`privilege_domain_denials`, remove indexes needed by existing writers/readers, or delete denial
history. It does not add the old `/api` routes back. The product action and repository are unchanged,
so no authorization/data rollback is necessary.
