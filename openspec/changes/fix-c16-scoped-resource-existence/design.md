# Design: Authoritative scope existence for metrics and workspace storage usage

## Context

See `proposal.md` for the C-16 motivation. The affected routes are authenticated control-plane reads,
but their handler-level scope resolution is inconsistent:

- `apps/control-plane/metrics-handlers.mjs::guarded` resolves a workspace before authorization, while
  its tenant branch trusts the path tenant id without calling `tenant-store.getTenant`. Privileged
  `superadmin`/`internal` actors pass `canManageTenant` for any tenant id, so all six tenant handler
  families can run against an absent tenant and degrade to a plausible `200`.
- `apps/control-plane/storage-handlers.mjs::storageWorkspaceUsage` calls
  `tenant-store.getWorkspace` only for non-privileged actors. A privileged caller therefore sends an
  absent workspace id directly into bucket-registry, object-store, and quota/default processing and
  receives an all-zero `200`.
- `apps/control-plane-executor/openapi/control-plane.openapi.json` is the unified OpenAPI source of
  truth. The eleven published metrics operations omit `404`; generated family documents, the route
  catalog, and `docs/reference/architecture/public-api-surface.md` derive from that document. The
  storage usage operation already declares `404`.
- C-02 already defines and normalizes the canonical closed `ErrorResponse`. C-16 changes the selected
  status/error class, not the envelope or its code taxonomy.

The affected operation inventory is intentionally closed:

| Surface | Operations/handlers | C-16 contract effect |
| --- | --- | --- |
| Tenant metrics runtime | quotas, overview, usage, runtime-only series, audit records, audit export | Add an authorization-then-existence gate; missing addressable tenant becomes `404` |
| Tenant metrics OpenAPI | `getTenantQuotaPosture`, `getTenantQuotaUsageOverview`, `getTenantUsageSnapshot`, `listTenantAuditRecords`, `exportTenantAuditRecords` | Add canonical `404`; do not publish tenant series |
| Workspace metrics runtime | quota posture, overview, usage, series, audit records, audit export | Preserve unknown `404` and known-foreign `403` |
| Workspace metrics OpenAPI | `getWorkspaceQuotaPosture`, `getWorkspaceQuotaUsageOverview`, `getWorkspaceUsageSnapshot`, `getWorkspaceMetricSeries`, `listWorkspaceAuditRecords`, `exportWorkspaceAuditRecords` | Add canonical `404` |
| Workspace storage runtime | `storageWorkspaceUsage` | Resolve workspace for every actor; missing becomes `404` before downstream work |
| Workspace storage OpenAPI | `getWorkspaceStorageUsage` | No change; its canonical `404` already exists |

Primary personas are the platform/superadmin administrator (P1), platform operator (P3),
security/compliance auditor (P4), and workspace operator/application DevOps user (P9). P10 is the
constrained read-only control; P7 and P12 are adjacent actors whose grants must not expand; P13 is the
adversarial cross-tenant control.

## Goals / Non-Goals

**Goals:**

- Make an authoritative registry record the boundary between a real empty/degraded scope and an absent
  scope for every affected handler.
- Preserve the existing authentication and authorization decisions while preventing tenant id
  enumeration for constrained callers.
- Short-circuit every limits/defaults/provider/audit/export or bucket/S3/quota/default dependency once
  authentication, authorization, or existence is terminal.
- Describe the corrected not-found outcome in exactly the eleven published metrics operations and all
  generated contract surfaces.
- Preserve authorized real-resource `200` schemas, degradation behavior, storage totals, and provider
  math, and ensure the console cannot retain a fabricated or stale success after a scope `404`.

**Non-Goals:**

- No new role, permission, membership rule, route, operation id, store, schema, error envelope, domain
  error taxonomy, gateway rule, rate-limit class, or deployment configuration.
- No publication of the runtime-only tenant metric-series route and no semantics change to workspace
  metric-series validation or provider queries.
- No C-01 response-shape work, C-02 envelope/schema/taxonomy change, C-04 series work, C-09 audit-query
  work, C-10 export-contract work, or remediation of another audit finding. Supplying registered-route
  context to the existing C-02 sanitizer is limited to preventing C-16 target disclosure.
- No quota or metering mutation, new domain audit event, application metric family, production console
  redesign, cluster deployment, datastore migration, or data backfill.

## Decisions

### Decision 1: Keep authentication at the runtime boundary

The route catalog continues to mark every affected route `auth: authenticated`. The control-plane
server verifies the bearer token and derives the trusted identity before invoking either local handler.
No existence or datastore operation is moved into the pre-authentication path. This preserves the
existing `401` behavior and ensures a missing or invalid token cannot probe the tenant/workspace
registry.

The existing runtime order for tenant audit export remains: bearer authentication, generic JSON-body
parsing, handler-level tenant authorization and existence, then C-10 leaf validation and export work.
Thus malformed unauthenticated input stays a `401`; a syntactically valid foreign or missing scope is
decided before format/page/filter validation; and C-16 does not reopen C-10 request semantics.

Alternative considered: make the scope guard authenticate independently. Rejected because it would
duplicate the runtime boundary, risk divergent authentication semantics, and is unnecessary for a
local handler that cannot be invoked through the HTTP router without an identity. Black-box tests still
assert that authentication is first at the public interface.

### Decision 2: Tenant metrics authorize the path tenant before the existence read

For the tenant branch only, `guarded` keeps the raw path tenant id long enough to call the existing
`canManageTenant(identity, tenantId)` policy. If authorization fails, it returns the existing `403`
immediately. If authorization succeeds, it calls `tenant-store.getTenant` exactly once:

1. authenticated identity supplied by the server;
2. `canManageTenant` against the tenant id from the tenant path;
3. `tenant-store.getTenant` through the injected pool/client;
4. `404 TENANT_NOT_FOUND` when no registry row exists;
5. attach `ctx.resolvedScope` and canonical metric attribution;
6. invoke the requested quotas/overview/usage/series/audit/export handler.

The check is placed in the shared `guarded` wrapper, not in six leaf handlers, so all six tenant
handler families inherit one ordering and a newly added handler cannot accidentally omit the gate.
Only a null/absent registry result maps to `404`; a datastore exception is not swallowed into not-found
or an empty success and follows the existing C-02-normalized server-failure path. It short-circuits the
same limits, provider, audit, and export dependencies as an absent row, while remaining observably a
server failure rather than `TENANT_NOT_FOUND`.

Alternative considered: add `getTenant` inside `resolveScopeTenant` before `canManageTenant`. Rejected
because the current guard calls scope resolution before authorization; doing so would query whether an
unrelated target exists and would give constrained callers an observable enumeration seam. Alternative
considered: keep trusting the path id and let each provider decide whether it exists. Rejected because
limits, Prometheus, and audit stores legitimately represent “no data” with empty/degraded output and
cannot authoritatively distinguish that state from a missing tenant.

### Decision 3: Leave workspace metrics ordering unchanged

The workspace branch continues to call `tenant-store.getWorkspace` first because the owning tenant is
needed for the existing `canManageTenant` decision. An absent workspace returns
`404 WORKSPACE_NOT_FOUND`; an existing foreign workspace resolves its owner and then returns the
existing `403 FORBIDDEN`. Once authorized, the resolved workspace row supplies both canonical tenant
and workspace ids.

The new tenant-existence read is guarded by the tenant-path condition (absence of `workspaceId`), so a
workspace metrics request does not call `getTenant` for the already resolved owner. This avoids changing
the required workspace outcome matrix or turning a stale referential-integrity condition into a new
response class under C-16.

Alternative considered: normalize all workspace failures to `404`. Rejected because C-16 explicitly
preserves the published/runtime known-foreign `403` behavior and is not an authorization redesign.

### Decision 4: Workspace storage usage always resolves the workspace first

`storageWorkspaceUsage` moves `tenant-store.getWorkspace` outside the privileged-actor conditional and
uses the resolved row for every caller:

1. authenticated identity supplied by the server;
2. `getWorkspace(workspaceId)` for all actors;
3. `404 WORKSPACE_NOT_FOUND` if absent;
4. for non-`superadmin`/`internal`, compare the resolved `tenant_id` with the trusted identity tenant and
   return the same opaque `404` on mismatch;
5. only after those gates, call `listBucketsForWorkspace` using the canonical resolved workspace id,
   scan objects, and calculate the existing quota/default dimensions.

This mirrors the proven existence/ownership structure of `storageProvisionBucket` while preserving
storage's deliberate no-existence-leak policy: constrained foreign-existing and unknown targets both
produce the same `404`. The handler must not perform bucket registry, S3/object, `usageLimits`, or
default work after either terminal result. As with tenant lookup, a datastore fault follows the existing
canonical server-failure path rather than being converted to “not found” or zero usage, and no bucket,
object-store, quota, or default dependency runs after that failed lookup.

Alternative considered: retain the superadmin bypass and special-case an empty bucket list. Rejected
because an existing empty workspace and an absent workspace both legitimately have no bucket rows.
Alternative considered: authorize the workspace before reading it. Rejected for storage because a
constrained identity cannot prove workspace ownership without the row; the opaque `404` after lookup
preserves the established storage boundary.

### Decision 5: Preserve real-resource success and provider behavior byte-for-semantics

The existence gates only decide whether an authoritative tenant/workspace registry row is present.
After a positive result, the existing leaf handlers, inputs, response projections, error/degradation
fallbacks, schemas, and calculations remain unchanged:

- a real tenant with no configured limits or unavailable evidence retains its schema-valid degraded or
  empty `200` rather than becoming a fabricated healthy response;
- a real tenant with no audit records retains its empty collection/export-manifest `200`;
- a real workspace with no buckets or objects retains a truthful zero-valued storage snapshot;
- populated metrics series, usage, audit, storage byte/object/bucket totals, and remaining-capacity math
  retain the same provider inputs and formulas.

Success fixtures must explicitly create the tenant/workspace registry records they address. This makes
the fixture intent honest and prevents old tests from depending on the C-16 bug while leaving their
expected bodies unchanged.

### Decision 6: Reuse the C-02 envelope and current domain classes

The shared handlers continue to return their local terminal shape with status `404` and domain class
`TENANT_NOT_FOUND` or `WORKSPACE_NOT_FOUND`. The existing C-02 response normalizer remains the sole HTTP
serializer and projects that class into the canonical closed `ErrorResponse`, including its current
bounded `GW_` code, sanitization, request/correlation ids, timestamp, and safe resource behavior.

C-16 adds no schema, alternate envelope, unbounded detail, or exception-message echo. Focused handler
tests may assert the local domain class; HTTP/contract tests assert the canonical on-wire body. This
separation avoids weakening either the precise handler outcome or the public envelope contract.

### Decision 7: Update the unified OpenAPI once and regenerate derivatives

The authoritative edit is limited to the `responses["404"]` entry of exactly the eleven operation ids
listed in the context table. “Exactly eleven” describes the C-16 diff, not the global set of metrics
operations that declare `404`: `getTenantAuditCorrelation` and `getWorkspaceAuditCorrelation` already
declare it and remain byte-for-semantics unchanged. Each new response describes not-found and uses
`content.application/json.schema.$ref: "#/components/schemas/ErrorResponse"`. No path, method,
operation id, parameter, success response, error schema, security requirement, tag, or rate-limit
extension changes.

`npm run generate:public-api` regenerates the metrics family document, public route catalog, and public
API reference from the unified OpenAPI. A focused contract test discovers operations by operation id
and asserts all of the following as sets, rather than relying on line positions:

- the exact eleven C-16 operation ids, and no other operation id, gain or change a `404` in this diff;
- every pre-existing metrics `404`, including both audit-correlation operations, remains unchanged;
- tenant series remains absent from the unified and generated public surfaces;
- `getWorkspaceStorageUsage` still has its pre-existing canonical `404`;
- regeneration produces no unrelated family/catalog/document drift.

Alternative considered: edit `metrics.openapi.json` directly. Rejected because it is generated and
would be overwritten. Alternative considered: publish tenant series so it can declare `404`. Rejected
because runtime-only series is explicitly outside the public contract.

### Decision 8: Prove console stale/error behavior without redesign

The quota, metrics, audit, and storage console clients already use rejected HTTP promises as the error
boundary. Focused Vitest regressions exercise a successful selection followed by a scope `404` and
assert that:

- `useConsoleQuotas` clears tenant and workspace posture;
- `useConsoleMetrics` clears the prior normalized overview/usage/series;
- `useConsoleAuditRecords` clears records and pagination, and an export failure yields no success
  manifest;
- `ConsoleStoragePage` clears its prior usage snapshot and displays the existing error state.

If a regression exposes stale state, the minimal state-reset/error-classification fix is permitted in
the existing client or page. No navigation, layout, component-library, localized interaction, or visual
design change is part of C-16. The console continues to consume the canonical C-02 envelope through the
shared request client.

### Decision 9: Keep data governance, audit, telemetry, and quota behavior neutral

All affected operations remain reads. The new registry checks return only existence/identity metadata
needed for scope resolution; they do not persist or export new data. C-16 adds no audit writer: its new
existence-selected `404` outcomes emit no domain audit event and retain no attacker-supplied target id.
The existing `recordRouteDenial` path for attributable handler `403` results remains unchanged, as
required by C-02; it is not a new C-16 side effect. No terminal result consumes quota/metering or reaches
bucket/object/provider work. Existing bounded HTTP request telemetry and correlation continue to record
the selected route/status without a new metric family, raw target-scope attribution, or an existence
label. After one of the exact thirteen affected handlers matches, the server derives the public error
resource from registered parameter positions (retaining C-02's generic `{id}` placeholder) and the
counter/histogram route label from the bounded registered template. This prevents even short arbitrary
targets from entering either surface during `401`, `403`, `404`, or registry-failure `500` outcomes,
without changing normalization for any route outside C-16. C-02 request/correlation IDs remain in error
and enforcement-audit surfaces, not Prometheus labels. Counters retain method, bounded route, status,
trusted tenant, and optional canonical workspace labels; histograms retain only method and bounded
route. Existing successful reads retain their current telemetry and calculations.

### Decision 10: Local verification only, with independent maker/checker boundaries

Implementation begins with black-box tests that reproduce the pre-fix fabricated `200` behavior, then
adds focused handler/ordering, registry-failure, storage short-circuit, OpenAPI, generated-family,
existing-success, and console regressions. A hermetic real HTTP/server seam proves authentication for
all tenant metrics handlers and workspace storage before any registry call, as well as canonical C-02
normalization for not-found and registry-failure responses. Verification uses local repository quality
gates only. C-16 does not install, upgrade, or mutate a Kubernetes cluster and adds no chart or gateway
configuration.

The implementation maker does not approve its own work. Independent verifier, contract,
authorization/isolation, console UX/accessibility, documentation, and final-review checkers receive the
requirements, diff, and fresh reproduction commands; the OpenSpec critic reviews this proposal before
implementation.

## Risks / Trade-offs

- **Tenant enumeration from the new lookup** → Keep `canManageTenant` strictly before `getTenant` on
  tenant paths; assert that foreign-existing and unrelated-unknown both stop at identical `403` without
  any registry/provider call.
- **Breaking workspace metrics semantics** → Limit tenant existence checks to tenant paths and retain
  workspace lookup-then-authorization ordering; assert unknown `404`, known-foreign `403`, and no
  tenant re-probe.
- **Over-correcting real empty scopes to `404`** → Define presence exclusively by the authoritative
  registry row and update success fixtures to seed it; retain leaf handler output assertions for empty,
  degraded, and populated resources.
- **Downstream work after a terminal result** → Use early returns in the shared guard/storage handler
  and injection spies that fail if limits/default/provider/audit/export/bucket/S3/quota work runs.
- **Store failure misreported as absence** → Map only a null/absent registry result to `404`; assert
  exceptions follow existing C-02-normalized server failure with zero downstream work.
- **OpenAPI drift beyond eleven operations** → Assert the exact set newly modified by C-16, preserve
  pre-existing metrics `404` responses, regenerate from the unified document, and inspect the diff.
- **Canonical envelope confusion** → Test local domain classes separately from the C-02-normalized HTTP
  `ErrorResponse`; do not edit the canonical envelope schemas.
- **Console stale data or misleading zero state** → Test success-to-`404` transitions and export
  rejection in hooks/pages; make only minimal state-reset fixes if required.
- **One additional registry read on authorized tenant metrics** → Accept the bounded indexed lookup in
  exchange for truthful scope semantics; it occurs once per request and before substantially more
  expensive provider/audit work. No cache is introduced because stale negative/positive cache entries
  would complicate deletion correctness and isolation.
- **Rollback restores misleading behavior** → Document that rollback is code/contract-only but
  deliberately reintroduces the confirmed fabricated-`200` defect; use it only if the new lookup causes
  an operational regression that cannot be forward-fixed safely.

## Migration Plan

There is no datastore, data, API-version, gateway, or deployment migration and no backfill. The change
is implemented and verified locally in this order:

1. Land pre-fix black-box reproduction tests and preserved-success fixtures.
2. Add the tenant and storage existence gates with ordering/short-circuit coverage.
3. Add the eleven unified OpenAPI `404` responses and regenerate/validate the public API artifacts.
4. Add console regressions and any minimal stale-state correction they require.
5. Update detailed architecture/API documentation and run local focused and repository quality gates.
6. Obtain independent checks, then commit the scoped change and open a draft PR; do not deploy or
   merge as part of the implementation task.

Compatibility is intentionally narrow: existing real-resource successes and all authorization grants
are backward compatible; only the erroneous response for an addressable absent tenant or privileged
absent workspace changes from `200` to `404`. Clients relying on the published OpenAPI gain the missing
response declaration, and console clients already process non-`2xx` through the shared error path.

Rollback is a single change revert covering the shared metrics guard, storage handler, eleven OpenAPI
responses and regenerated artifacts, focused console/test/docs edits, and this OpenSpec change. It
requires no data restoration and no downgrade job. The rollback must be documented as restoring the
C-16 fabricated-success defect. No cluster action belongs to this change.
