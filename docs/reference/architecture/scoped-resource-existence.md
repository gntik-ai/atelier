# Scoped resource existence for metrics and storage usage

- **Document type:** Architecture reference.
- **Intended personas:** P1 platform superadministrator, P3 platform operator/SRE, P4
  security/compliance auditor, P9 workspace operator/application DevOps, P10 scoped viewer/auditor,
  and P13 cross-tenant isolation adversary.
- **Prerequisite knowledge:** Falcone's tenant/workspace scope hierarchy, bearer authentication, and
  the canonical C-02 `ErrorResponse` envelope.
- **Outcome:** Decide whether a response proves the path scope exists, distinguish absent from
  real-empty resources, and diagnose a failure without probing another tenant's resources.

This reference covers the six tenant metrics families, six workspace metrics families, and workspace
storage usage. P1/P3/P4/P9 are the operator and evidence-consumer lenses; P10 and P13 are the
constrained and isolation controls. A persona describes a journey and does not itself grant an API
permission.

The behavior described here is read-only. Confirming existence resolves scope only; it writes no data,
emits no new domain audit event, consumes no quota, and changes no rate-limit policy.

Status: C-16 corrective contract for existing v1 read operations. It is not a new Preview or
Experimental API. The behavior applies only to builds containing the OpenSpec change
`fix-c16-scoped-resource-existence`; a version number or deployment date alone does not prove that
every serving instance contains the correction. It fixes handlers that returned a plausible `200`
for a tenant or workspace that does not exist. The normative field definitions live in
`apps/control-plane-executor/openapi/control-plane.openapi.json` and the schemas under
`packages/internal-contracts/src/`; the runtime lives in `apps/control-plane/metrics-handlers.mjs` and
`apps/control-plane/storage-handlers.mjs`. This page was grounded on 2026-08-05 in that implementation,
the approved contract, generated public artifacts, console clients, and hermetic test sources (E1/E2).
No live API, UI, backend, or cluster verification was run for this documentation change. There is no
migration, deployment, or configuration change, and no cluster action is required.

## The invariant

A `200` response from an authorized, scoped read is an existence proof: an authoritative registry row
for the addressed tenant or workspace was found before any downstream work ran. An addressable scope
that is absent from the registry terminates as `404`, never as a fabricated or degraded `200`.

This makes the authoritative registry the single boundary between two states that otherwise look alike
to a metrics or storage reader:

- **Absent scope** — the tenant/workspace does not exist. Result: `404` (`TENANT_NOT_FOUND` or
  `WORKSPACE_NOT_FOUND`).
- **Real but empty/degraded scope** — the tenant/workspace exists but has no configured limits, no
  metrics evidence, no audit rows, or no buckets/objects. Result: the existing honest `200` with zeros,
  an empty collection, or degraded evidence (see [Real-empty versus absent](#real-empty-versus-absent)).

A datastore **failure** during the existence read is neither of these; it is a server error (see
[Registry failure is not absence](#registry-failure-is-not-absence)).

## Affected operation inventory

The affected set is closed. No other operation changes.

| Method and path | Runtime handler | Public operation ID | C-16 contract effect |
| --- | --- | --- | --- |
| `GET /v1/metrics/tenants/{tenantId}/quotas` | `metricsTenantQuotas` | `getTenantQuotaPosture` | Add canonical `404` |
| `GET /v1/metrics/tenants/{tenantId}/overview` | `metricsTenantOverview` | `getTenantQuotaUsageOverview` | Add canonical `404` |
| `GET /v1/metrics/tenants/{tenantId}/usage` | `metricsTenantUsage` | `getTenantUsageSnapshot` | Add canonical `404` |
| `GET /v1/metrics/tenants/{tenantId}/series` | `metricsTenantSeries` | None; runtime-only and unpublished | Preserve runtime gate; do not publish |
| `GET /v1/metrics/tenants/{tenantId}/audit-records` | `metricsTenantAudit` | `listTenantAuditRecords` | Add canonical `404` |
| `POST /v1/metrics/tenants/{tenantId}/audit-exports` | `metricsTenantAuditExport` | `exportTenantAuditRecords` | Add canonical `404` |
| `GET /v1/metrics/workspaces/{workspaceId}/quotas` | `metricsWorkspaceQuotas` | `getWorkspaceQuotaPosture` | Add canonical `404` |
| `GET /v1/metrics/workspaces/{workspaceId}/overview` | `metricsWorkspaceOverview` | `getWorkspaceQuotaUsageOverview` | Add canonical `404` |
| `GET /v1/metrics/workspaces/{workspaceId}/usage` | `metricsWorkspaceUsage` | `getWorkspaceUsageSnapshot` | Add canonical `404` |
| `GET /v1/metrics/workspaces/{workspaceId}/series` | `metricsWorkspaceSeries` | `getWorkspaceMetricSeries` | Add canonical `404` |
| `GET /v1/metrics/workspaces/{workspaceId}/audit-records` | `metricsWorkspaceAudit` | `listWorkspaceAuditRecords` | Add canonical `404` |
| `POST /v1/metrics/workspaces/{workspaceId}/audit-exports` | `metricsWorkspaceAuditExport` | `exportWorkspaceAuditRecords` | Add canonical `404` |
| `GET /v1/storage/workspaces/{workspaceId}/usage` | `storageWorkspaceUsage` | `getWorkspaceStorageUsage` | Preserve its pre-existing canonical `404` |

All twelve metrics handlers use the shared `guarded` wrapper. The tenant metric-series runtime route
is listed only to document its handler ordering: it is deliberately absent from the unified OpenAPI,
generated metrics family, public route catalog, SDK-facing contract, and generated API reference.
External clients must not infer publication or support from its runtime presence.

## Roles, permissions, and scopes

C-16 adds no role, permission, scope, or grant. It reuses the existing authorization gates.

- **Tenant and workspace metrics** authorize with `canManageTenant` (`apps/control-plane/tenant-scope.mjs`):
  `superadmin` and `internal` may address any tenant; `tenant_owner` and `tenant_admin` may address
  only their own tenant; every other identity is denied. For workspace metrics the check runs against
  the resolved workspace's owning tenant.
- **Workspace storage usage** authorizes on a tenant match: `superadmin`/`internal`, or any verified
  identity whose tenant owns the workspace (`ws.tenant_id === identity.tenantId`). This is the
  implemented tenant-level gate; C-16 neither adds a workspace-role check nor promises that a persona
  label maps to an accepted runtime identity.

Authorization always uses the tenant/workspace derived from the **verified** identity and the path,
never a request body or spoofable header.

Every affected route is `auth: authenticated`, and every published operation declares bearer
authentication. C-16 adds no plan/capability requirement, OAuth scope, membership rule, credential
type, or service-account grant. P4, P9, and P10 receive these response semantics only when the
existing runtime policy already authorizes their verified identity; being an affected persona is not
an authorization grant.

## Resolution order per surface

### Tenant metrics: authenticate, authorize, then confirm existence

The shared `guarded` wrapper enforces one order for all six tenant families, so no leaf handler can
omit the gate:

1. **Authenticate** — the control-plane server verifies the bearer token before the handler runs. A
   missing or invalid token is the existing `401`, before any registry, limit, provider, audit, or
   export work.
2. **Authorize** — `canManageTenant(identity, pathTenantId)` runs against the raw path tenant id. A
   caller not authorized for that tenant receives `403 FORBIDDEN` with no registry read.
3. **Confirm existence** — exactly one `tenant-store.getTenant(pool, tenantId)` read. A `null` row is
   `404 TENANT_NOT_FOUND`.
4. **Proceed** — only now is the authoritative scope attached, canonical metric attribution applied,
   and the requested quotas/overview/usage/series/audit/export leaf handler invoked.

Because authorization precedes the existence read, only an already-authorized caller can ever observe
`TENANT_NOT_FOUND`: `superadmin`/`internal` for any absent tenant, or a `tenant_owner`/`tenant_admin`
for their own tenant id when that row is absent.

For **tenant audit export** specifically, the runtime order is: bearer authentication → generic JSON
body parsing → the tenant authorization and existence gates above → the operation's own format,
page-size, filter, and masking validation. Malformed input from an unauthenticated caller stays a
`401`; a syntactically valid object for a foreign or missing tenant is decided by scope before any
field-level validation. C-16 does not move or reinterpret the request parser or the export validation
contract.

### Workspace metrics: existence first, then authorization

Workspace metrics keep their existing order, because the owning tenant needed for authorization is only
known after the workspace row is read:

1. **Authenticate** — as above (`401`).
2. **Resolve workspace** — `tenant-store.getWorkspace(pool, workspaceId)`. An unknown workspace is
   `404 WORKSPACE_NOT_FOUND`, before authorization and before any downstream work.
3. **Authorize** — `canManageTenant(identity, resolvedWorkspace.tenant_id)`. A known workspace owned by
   another tenant is `403 FORBIDDEN`.
4. **Proceed** — the resolved workspace supplies both the canonical tenant and workspace ids; there is
   no separate tenant-existence re-probe.

### Workspace storage usage: resolve for every actor, stay opaque

`storageWorkspaceUsage` resolves the workspace for **every** caller — including `superadmin` and
`internal` — before touching buckets, objects, quota, or defaults. It mirrors the existing
`storageProvisionBucket` structure while preserving storage's deliberate no-existence-leak policy:

1. **Authenticate** — as above (`401`).
2. **Resolve workspace** — `tenant-store.getWorkspace(pool, workspaceId)` for all actors. An absent
   workspace is `404 WORKSPACE_NOT_FOUND`.
3. **Opaque ownership check** — for non-`superadmin`/`internal` callers, a resolved workspace whose
   `tenant_id` does not match the caller's tenant returns the **same** `404 WORKSPACE_NOT_FOUND`. A
   constrained caller cannot distinguish a foreign-but-existing workspace from an unknown one.
4. **Proceed** — only after a positive, in-scope lookup does the handler call
   `listBucketsForWorkspace`, scan objects with `listObjects`, and compute quota dimensions with
   `usageLimits`/`dimensionStatus`.

## Why the surfaces differ (non-enumeration)

Tenant metrics and storage usage deliberately close their respective enumeration seams. Workspace
metrics preserve an older outcome matrix that distinguishes an unknown workspace from a known foreign
one; C-16 documents but does not redesign that boundary:

- **Tenant metrics** authorize *before* reading existence. A constrained or cross-tenant caller (P13)
  therefore receives an identical `403 FORBIDDEN` for a foreign tenant that exists and for an unrelated
  tenant that does not, and neither denial performs a registry, limit, provider, audit, or export read.
  `TENANT_NOT_FOUND` is reachable only past authorization, so it never reveals whether some other
  tenant exists.
- **Storage usage** cannot authorize a constrained caller without first reading the workspace row (the
  caller must prove tenant ownership). It therefore reads the row and then collapses both the
  foreign-existing and the unknown case to the **same opaque** `404`, disclosing no ownership or
  existence distinction.
- **Workspace metrics** return `404` for an unknown workspace and `403` for a known foreign workspace.
  This is the pre-existing behavior, preserved unchanged by C-16; the owning tenant must be resolved to
  authorize, so an unknown workspace has no tenant to authorize against and stops at `404`.

## Real-empty versus absent

The existence gate distinguishes only an absent registry row from a real resource. A real resource with
no data keeps its current honest `200`. C-16 fabricates no evidence or health.

| Read | Absent scope | Real scope with no data |
| --- | --- | --- |
| Tenant/workspace quotas | `404` | `200` `QuotaPosture` with `evidence_unavailable` when no dimensions exist (never `within_limit`/healthy) |
| Tenant/workspace overview | `404` | `200` overview with unavailable/degraded posture preserved |
| Tenant/workspace usage | `404` | `200` `UsageSnapshot` with truthful values and `degradedDimensions` preserved |
| Tenant runtime-only series | `404` after tenant authorization | Existing runtime `200` with real or empty/degraded points; the route remains unpublished |
| Workspace series | `404` (unknown) / `403` (foreign) | `200` series with real or empty request/error-rate points |
| Tenant/workspace audit records | `404` | `200` empty `AuditRecordCollectionResponse` |
| Tenant/workspace audit export | `404` | `200` empty `AuditExportManifest` (`itemCount: 0`) |
| Workspace storage usage | `404` | `200` usage snapshot with truthful zero bytes/objects and full quota math |

The absent column assumes the request reaches that surface's existence decision. Tenant authorization
can return opaque `403` before lookup, and a known foreign workspace metrics target remains `403`, as
defined by the outcome ordering above.

Populated resources are unaffected: every success field, provider-derived value, degradation rule,
storage total, and remaining-capacity calculation is identical to the pre-C-16 behavior.

## Registry failure is not absence

A failed existence read is a server failure, not a not-found. If `getTenant` or `getWorkspace` throws
or fails (rather than returning an absent row), the request follows the existing canonical
server-failure path and short-circuits all downstream observational work. It never returns
`TENANT_NOT_FOUND`, `WORKSPACE_NOT_FOUND`, or a zero/degraded `200`, and it runs no
limit/default/provider/audit/export or bucket/object-store/quota/default dependency.

Only a `null`/absent registry result maps to `404`.

## On-the-wire responses

Handlers return a local `{ statusCode, body: { code, message } }` result; the shared canonical error
normalizer (`apps/shared/error-envelope.mjs`, the C-02 envelope) is the sole HTTP serializer. C-16 adds
no second envelope, schema, error family, or code taxonomy.

| Condition | Handler-level status/class | Public HTTP status/code |
| --- | --- | --- |
| Authorized missing tenant | `404 TENANT_NOT_FOUND` | `404 GW_TENANT_NOT_FOUND` |
| Missing or storage-opaque workspace | `404 WORKSPACE_NOT_FOUND` | `404 GW_WORKSPACE_NOT_FOUND` |
| Metrics authorization denial | `403 FORBIDDEN` | `403 GW_FORBIDDEN` |
| Registry exception | Server-failure path | `500 GW_CONTROL_PLANE_ERROR` |

The handler classes `TENANT_NOT_FOUND` and `WORKSPACE_NOT_FOUND` are approved classes, so they cross
the boundary as `GW_`-prefixed public codes. Clients must branch on HTTP status and the wire `GW_*`
code, not an internal handler message or the legacy two-field body. For the thirteen routes in this
reference, after the registered route matches, its parameter positions—not identifier-shape heuristics—
produce the existing generic `{id}` segments in `resource.path`. This also protects syntactically valid
short targets such as `pin`; routes outside C-16 keep their previous normalization behavior.

The examples below are contract-valid illustrations derived from the C-02 serializer; they were not
captured from a live cluster. The server generates the identifiers and timestamp per request.

Authorized tenant read against an absent tenant:

```json
{
  "status": 404,
  "code": "GW_TENANT_NOT_FOUND",
  "message": "Resource not found",
  "detail": { "reason": "TENANT_NOT_FOUND" },
  "requestId": "req-c16-example-001",
  "correlationId": "corr-c16-example-001",
  "timestamp": "2026-08-05T00:00:00.000Z",
  "resource": { "path": "/v1/metrics/tenants/{id}/quotas" }
}
```

Absent (or, for a constrained storage caller, foreign) workspace:

```json
{
  "status": 404,
  "code": "GW_WORKSPACE_NOT_FOUND",
  "message": "Resource not found",
  "detail": { "reason": "WORKSPACE_NOT_FOUND" },
  "requestId": "req-c16-example-002",
  "correlationId": "corr-c16-example-002",
  "timestamp": "2026-08-05T00:00:00.000Z",
  "resource": { "path": "/v1/storage/workspaces/{id}/usage" }
}
```

Unauthorized tenant read (foreign-existing and unknown are indistinguishable):

```json
{
  "status": 403,
  "code": "GW_FORBIDDEN",
  "message": "Request forbidden",
  "detail": { "reason": "FORBIDDEN" },
  "requestId": "req-c16-example-003",
  "correlationId": "corr-c16-example-003",
  "timestamp": "2026-08-05T00:00:00.000Z",
  "resource": { "path": "/v1/metrics/tenants/{id}/quotas" }
}
```

Registry failure during the existence read:

```json
{
  "status": 500,
  "code": "GW_CONTROL_PLANE_ERROR",
  "message": "Internal server error",
  "detail": {},
  "requestId": "req-c16-example-004",
  "correlationId": "corr-c16-example-004",
  "timestamp": "2026-08-05T00:00:00.000Z",
  "resource": { "path": "/v1/metrics/tenants/{id}/quotas" }
}
```

## Published contract (OpenAPI)

The unified OpenAPI declares a `404` response referencing `#/components/schemas/ErrorResponse` for
exactly these eleven metrics operations:

- Tenant: `getTenantQuotaPosture`, `getTenantQuotaUsageOverview`, `getTenantUsageSnapshot`,
  `listTenantAuditRecords`, `exportTenantAuditRecords`.
- Workspace: `getWorkspaceQuotaPosture`, `getWorkspaceQuotaUsageOverview`, `getWorkspaceUsageSnapshot`,
  `getWorkspaceMetricSeries`, `listWorkspaceAuditRecords`, `exportWorkspaceAuditRecords`.

The following are intentionally unchanged:

- The runtime-only tenant metric-series route stays absent from the unified OpenAPI, the generated
  metrics family, the public route catalog, the SDK-facing contract, and the published public API
  reference.
- `getWorkspaceStorageUsage` keeps its pre-existing canonical `404` (no twelfth change).
- Every metrics `404` that predates C-16 — including `getTenantAuditCorrelation` and
  `getWorkspaceAuditCorrelation` — is preserved.
- Registry failures continue to use each operation's pre-existing OpenAPI `default` response with the
  canonical `ErrorResponse`; C-16 adds no explicit `500` response or alternate error schema.

The generated metrics family document, public route catalog, and
`docs/reference/architecture/public-api-surface.md` are derived from the unified OpenAPI by
`npm run generate:public-api`; do not edit them by hand.

## Data governance, telemetry, and quota

- An existence-selected `404` emits **no** domain audit event and persists **no** attacker-supplied
  target identifier. The existence read returns only the metadata needed to resolve scope.
- The existing attributable `403` enforcement-denial write (`scope_enforcement_denials`) is unchanged;
  it is not a new C-16 side effect.
- No terminal authentication, authorization, or existence result consumes quota or metering, and none
  reaches bucket/object/provider work.
- For the thirteen affected routes, ordinary bounded request telemetry uses the registered template
  (for example, `{tenantId}` or `{workspaceId}`), never a raw path target. Counter labels retain method,
  route, status, trusted-identity tenant and, only after canonical resolution, optional workspace;
  histogram labels retain method and route. Request/correlation IDs remain in the C-02 error envelope
  and attributable enforcement audit, never Prometheus labels. This rule applies equally to `401`,
  `403`, existence-selected `404`, and registry-failure `500` outcomes. C-16 introduces no metric
  family or existence label; routes outside C-16 keep their previous normalization, and pre-existing
  caller-scope attribution remains governed by the request-metric boundary.
- The existence gate reads only canonical identity/ownership metadata needed for resolution. It adds no
  secret, credential, PII, raw target identifier, provider locator, or registry row to a public body.
  Clients must keep bearer tokens out of paths, examples, logs, screenshots, and support evidence.

## Console behavior

The web console treats a scope `404` from an affected metrics, quota, audit, or workspace
storage-usage request as a not-found/unavailable failure for the selected scope. It clears the success
state tied to that request and renders the existing error/unavailable state rather than a misleading
success:

- quota posture (tenant and workspace) is cleared;
- normalized metrics overview/usage/series state is cleared;
- audit records and pagination are cleared and an export failure yields no success manifest;
- the storage usage snapshot (including any prior zero/stale values) is cleared.

The console keeps its existing retry/error affordances, localized copy, accessibility semantics,
navigation, and layout. C-16 includes no console page, navigation, or visual redesign.

## Compatibility and rollback

Compatibility is intentionally narrow. Every authorized real-resource `200` and every authorization
grant is backward compatible; the only behavior that changes is the erroneous response for an
addressable absent tenant, or a privileged absent workspace on storage usage, which becomes `404`
instead of a fabricated `200`. Clients that consume the published OpenAPI gain the previously missing
`404` declaration; console clients route non-`2xx` responses through the shared error path. During a
mixed-version rollout, an older serving instance can retain the pre-C-16 fabricated-success behavior.
Treat `200` as the C-16 existence guarantee only after every instance serving the path contains the
correction.

Rollback is a single revert of the change (the shared metrics guard, the storage handler, the eleven
OpenAPI responses and regenerated artifacts, the focused console/test/doc edits, and the OpenSpec
change). It needs no data restoration or downgrade job, and it deliberately reintroduces the confirmed
fabricated-`200` defect — use it only if the existence read causes an operational regression that
cannot be forward-fixed safely. No cluster action belongs to this change.

The local checks below are read-only or deterministic generation/validation steps and are safe to
rerun. They create no tenant, workspace, audit export, bucket, object, credential, or cluster resource.
No cleanup is required. A second public-API generation must be clean; unexpected generated drift is a
contract problem to review, not an artifact to hide.

## Troubleshooting and safe recovery

| Symptom | Meaning | Safe check and recovery |
| --- | --- | --- |
| `401` before a scope outcome | Authentication failed at the HTTP boundary | Repair the supported credential/session flow. Do not compare target IDs to infer existence. |
| Tenant metrics returns `403` for both a foreign-existing and unrelated-unknown tenant | Expected non-enumeration for a constrained caller | Verify the trusted tenant context and existing role. Do not retry guessed IDs or expect `404`. |
| Workspace metrics returns `404` | The workspace registry returned no row | Refresh the supported workspace inventory/context and remove the stale selection before retrying. |
| Workspace metrics returns `403` | A row exists, but its owning tenant failed the existing metrics authorization | Verify the trusted identity and intended tenant; do not expose resolved ownership to the caller. |
| Storage usage returns `404` to a constrained caller | The workspace is absent or foreign; the result is intentionally opaque | Refresh only the caller's own workspace context. Do not query buckets/S3 to distinguish the cases. |
| An affected read returns canonical `500` | The registry failed or another operational server failure occurred | Preserve `requestId` and `correlationId`, escalate to P3, and inspect authorized internal registry health. Do not create a replacement resource or reinterpret the failure as absence. |
| A real scope returns `200` with empty/degraded metrics | The canonical row exists, while downstream evidence is empty or degraded | Inspect freshness/collection status and existing provider health. Do not convert the response to `404` or healthy zeroes. |
| A known-missing scope still returns plausible `200` | A pre-C-16 or mixed-version instance may be serving the request | Confirm the release evidence through the supported installation workflow, complete the rollout, and rerun the same authorized check. No cluster command was executed for this page. |
| Console retains data from a prior scope after `404` | Console/runtime versions are incompatible or the stale-state regression failed | Stop using the stale value as evidence, reload a supported context, and run the focused console tests before release. |
| One of the eleven OpenAPI operations lacks `404` | Unified OpenAPI and generated artifacts are out of sync | Generate from the unified source, run the focused contract test and validators, and confirm tenant series remains unpublished. |

## Local validation (no deployment required)

From the repository root:

```bash
node --check apps/control-plane/metrics-handlers.mjs
node --check apps/control-plane/storage-handlers.mjs
node --test tests/blackbox/scoped-resource-existence-c16.test.mjs
node --test tests/blackbox/scoped-resource-existence-c16-http.test.mjs
node --test tests/blackbox/metrics-tenant-authorization.test.mjs
node --test tests/contracts/scoped-resource-existence.contract.test.mjs
node --test tests/blackbox/metrics-success-schema-conformance.test.mjs
node --test tests/blackbox/storage-quota-handlers.test.mjs
pnpm --dir apps/web-console exec vitest run \
  src/lib/console-quotas.test.ts \
  src/lib/console-metrics.test.ts \
  src/pages/ConsoleObservabilityPage.test.tsx \
  src/pages/ConsoleStoragePage.test.tsx
npm run generate:public-api
npm run generate:public-api
npm run validate:public-api
npm run validate:openapi
openspec validate fix-c16-scoped-resource-existence --strict
pnpm exec markdownlint-cli2 \
  docs/reference/architecture/scoped-resource-existence.md \
  docs/reference/architecture/observability-success-response-contracts.md \
  docs/reference/architecture/storage-capacity-quotas.md
```

Expected result: every command exits zero; the second generation makes no further change; the C-16
tests prove the ordering, opacity, canonical `404` contract, registry-failure `500`, and zero downstream
work; real-resource tests preserve honest `200` results; console tests clear stale state; and
markdownlint reports no errors. These checks do not deploy or mutate a Kubernetes cluster. This list
is the release verification procedure, not a claim that the documentation author ran every product
test.

## Related references

- [Observability success-response contracts](observability-success-response-contracts.md) — the `200`
  schemas and honest empty/degraded semantics preserved here.
- [Storage capacity quotas (bucket count and total bytes)](storage-capacity-quotas.md) — the storage
  usage dimensions returned after a positive workspace lookup.
- [Observability metrics time range](observability-metrics-time-range.md) — the workspace metric-series
  read and its existing `404`/`403` scope behavior.
- [Structural write role gates](structural-write-role-gates.md) — the sibling `404 WORKSPACE_NOT_FOUND`
  no-existence-leak convention for workspace-scoped writes.
- [Unified OpenAPI](../../../apps/control-plane-executor/openapi/control-plane.openapi.json),
  [generated metrics family](../../../apps/control-plane-executor/openapi/families/metrics.openapi.json),
  and [generated public API reference](public-api-surface.md) — published machine and human contracts.
- [Metrics handlers](../../../apps/control-plane/metrics-handlers.mjs),
  [storage handlers](../../../apps/control-plane/storage-handlers.mjs),
  [tenant store](../../../apps/control-plane/tenant-store.mjs), and
  [C-02 error normalizer](../../../apps/shared/error-envelope.mjs) — runtime sources.
- [C-16 proposal](../../../openspec/changes/fix-c16-scoped-resource-existence/proposal.md),
  [design](../../../openspec/changes/fix-c16-scoped-resource-existence/design.md), and
  [observability requirements](../../../openspec/changes/fix-c16-scoped-resource-existence/specs/observability/spec.md)
  — approved behavior and acceptance scenarios.
- [C-16 handler regression](../../../tests/blackbox/scoped-resource-existence-c16.test.mjs),
  [C-16 HTTP regression](../../../tests/blackbox/scoped-resource-existence-c16-http.test.mjs), and
  [C-16 contract regression](../../../tests/contracts/scoped-resource-existence.contract.test.mjs) —
  hermetic verification sources.

The unified OpenAPI is authoritative for published paths, operation IDs, schemas, security, and
responses. Generated files and this reference follow that source; do not repair drift by editing a
generated family document. The runtime route table is authoritative only for the explicitly
unpublished tenant-series presence described above.
