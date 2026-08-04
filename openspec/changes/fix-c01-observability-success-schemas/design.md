# Design: Conformant observability quota, usage, overview, and audit success bodies

## Context

The web console Quotas and Observability pages call ten metrics operations whose `200` schemas are
published in `apps/control-plane-executor/openapi/families/metrics.openapi.json` and merged into the
canonical `control-plane.openapi.json`:

| Operation | Route | `200` schema | Closed? |
| --- | --- | --- | --- |
| `getTenantQuotaPosture` | `/v1/metrics/tenants/{tenantId}/quotas` | `QuotaPosture` | open |
| `getWorkspaceQuotaPosture` | `/v1/metrics/workspaces/{workspaceId}/quotas` | `QuotaPosture` | open |
| `getTenantQuotaUsageOverview` | `/v1/metrics/tenants/{tenantId}/overview` | `TenantQuotaUsageOverview` | closed |
| `getWorkspaceQuotaUsageOverview` | `/v1/metrics/workspaces/{workspaceId}/overview` | `WorkspaceQuotaUsageOverview` | closed |
| `getTenantUsageSnapshot` | `/v1/metrics/tenants/{tenantId}/usage` | `UsageSnapshot` | open |
| `getWorkspaceUsageSnapshot` | `/v1/metrics/workspaces/{workspaceId}/usage` | `UsageSnapshot` | open |
| `listTenantAuditRecords` | `/v1/metrics/tenants/{tenantId}/audit-records` | `AuditRecordCollectionResponse` | open |
| `listWorkspaceAuditRecords` | `/v1/metrics/workspaces/{workspaceId}/audit-records` | `AuditRecordCollectionResponse` | open |
| `exportTenantAuditRecords` | `/v1/metrics/tenants/{tenantId}/audit-exports` | `AuditExportManifest` | open |
| `exportWorkspaceAuditRecords` | `/v1/metrics/workspaces/{workspaceId}/audit-exports` | `AuditExportManifest` | open |

All ten dispatch through `apps/control-plane/metrics-handlers.mjs`, where the tenant and workspace
variants share one handler each (`quotas`, `overview`, `usage`, `auditRecords`, `auditExport`) and
scope is inferred from the path params. The `guarded` wrapper already resolves the path scope to its
owning tenant, applies the same own-tenant authorization used elsewhere, and attaches
`ctx.resolvedScope = { tenantId }` (tenant route) or `{ tenantId, workspaceId }` (workspace route).
The audit surfaces additionally read `apps/control-plane/audit-store.mjs` (`queryAuditEvents` +
`auditRowToRecord`) and lazily import the shared executor export builder
(`apps/control-plane-executor/src/observability-audit-export.mjs`).

The current producers emit legacy/minimal shapes (see the proposal). The shared executor already
contains the canonical projections this repair should reuse:
`apps/control-plane-executor/src/observability-audit-query.mjs` (`queryTenantAuditRecords` /
`queryWorkspaceAuditRecords`, building `queryScope`/`appliedFilters`/`availableFilters`/
`consoleHints` and masking items), `observability-audit-export.mjs`
(`buildAuditExportManifest`), and `observability-admin.mjs` plus
`packages/internal-contracts/src/observability-quota-usage-view.json` /
`observability-usage-consumption.json` / `observability-quota-policies.json` (posture→visual-state
maps, freshness states, provisioning summaries, and the access-/calculation-audit contracts). The
control-plane image already `COPY`s both `apps/control-plane-executor` and
`packages/internal-contracts` under `/repo`, so those projections are reachable at runtime.

## Goals

- Make every in-scope `200` body validate exactly against its published schema for populated, empty,
  and degraded results, including closed `additionalProperties`.
- Serialize with a backend allow-list projection driven by `ctx.resolvedScope`, canonical field
  names, and contractual enums.
- Degrade honestly: never fabricate consumption, health, or a successful audit outcome. Because the
  existing limit adapters collapse provider errors and an empty result to the same array, treat an
  empty result conservatively as unavailable evidence in this bounded repair.
- Give audit rows contractual `actor`/`scope`/`resource`/`result`/`origin` with honest non-sensitive
  legacy fallbacks, preserving masking.
- Share one conformant projection/manifest between the primary and fallback export paths.
- Keep the console visually and functionally compatible on canonical fields.
- Preserve authentication, authorization, isolation, GET/read-only semantics, routes, status codes,
  rate-limit classes, and the absence of persistence/side effects.

## Non-Goals

- The C-04 workspace metric-series operation, the C-02 `ErrorResponse` envelope, C-09 filter/cursor/
  sort semantics, C-10 export request/page-size semantics, and C-16 tenant-existence behavior.
- Any OpenAPI schema edit, alias, or relaxation; any role/permission/membership/gateway change; any
  new route, method, status, or rate-limit class.
- Any new persistence, quota consumption, audit event, or metering side effect.
- Any console redesign beyond consuming canonical fields; any shared/staging/production deployment or
  chart change.

## Decision 1: One allow-list serializer per operation, bound to `ctx.resolvedScope`

Each handler returns a body assembled by an explicit serializer that writes only the fields the
published schema allows and reads scope solely from `ctx.resolvedScope`:

- `tenantId` is `ctx.resolvedScope.tenantId`; `workspaceId` is `ctx.resolvedScope.workspaceId ?? null`.
- `queryScope` is `"workspace"` when `ctx.resolvedScope.workspaceId` exists, otherwise `"tenant"`.
- For the closed overview schemas the serializer selects the correct schema per scope:
  `TenantQuotaUsageOverview` requires `queryScope: "tenant"` and `workspaceId: null`;
  `WorkspaceQuotaUsageOverview` requires `queryScope: "workspace"` and a string `workspaceId`.

No response field is derived from a raw path segment, request query/body, or an unverified identity
claim. The serializer never substitutes `identity.tenantId` for the resolved owner. Closed schemas
receive exactly their allowed keys; open schemas receive only the contractual keys (no legacy
`measuredAt`, `metricKey`, `points`, `status: "completed"`, `source`, or other undeclared property is
introduced by these serializers).

## Decision 2: Honest posture, freshness, and visual-state mapping

`overallStatus` (`QuotaPosture`) and `overallPosture` (overview) share one enum:
`within_limit`, `warning_threshold_reached`, `soft_limit_exceeded`, `hard_limit_reached`,
`evidence_degraded`, `evidence_unavailable`, `unbounded`. The legacy `healthy`/`critical` values are
removed. The serializer maps real limit/consumption evidence to this enum and never emits an
out-of-enum value:

- resolved, fresh, no breach, at least one enforced dimension → `within_limit`;
- resolved with a warning/soft/hard breach → `warning_threshold_reached` / `soft_limit_exceeded` /
  `hard_limit_reached` respectively (hard dominates soft dominates warning);
- resolved but every dimension unbounded / no policy configured → `unbounded` with
  `policiesConfigured: false`;
- some dimensions resolved but stale/partial → `evidence_degraded`;
- limits/consumption unresolved (the existing `tenantLimits`/`workspaceLimits` catch path) →
  `evidence_unavailable`.

Per-dimension `freshnessStatus` is `fresh` only when the measurement is real and current;
unavailable evidence is `unavailable`, partial/stale is `degraded`. `visualState`
(`healthy`/`warning`/`elevated`/`critical`/`degraded`/`unknown`) is derived from the posture via the
shared `observability-quota-usage-view` posture→visual-state map, not reinvented; unresolved evidence
maps to `unknown` or `degraded`, never `healthy`. The serializer must not present unavailable
evidence as `within_limit`/`healthy`/`0` usage — the honest-degradation requirement.

The existing adapters return the same empty array for an unconfigured scope and for a swallowed
provider error/timeout, so C-01 cannot distinguish those cases without a broader source contract.
This repair therefore maps an empty result to `policiesConfigured: false` plus
`evidence_unavailable`, keeps the current `200`-with-degradation behavior, and does not invent an
unbounded or healthy state.

## Decision 3: `QuotaPosture` projection (quotas)

The `quotas` serializer emits every `QuotaPosture` required field:
`postureId` (a stable non-persisted id for this evaluation), `queryScope`, `tenantId`, `workspaceId`,
`evaluatedAt`, `usageSnapshotTimestamp`, `observationWindow` (`{ startedAt, endedAt }`),
`dimensions`, `overallStatus`, `degradedDimensions`, `hardLimitBreaches`, `softLimitBreaches`,
`warningDimensions`, and `evaluationAudit` (`QuotaEvaluationAudit` with `evaluationId`, `queryScope`,
`overallStatus`, `hardLimitBreaches`, `softLimitBreaches`, `warningDimensions`, `evaluatedAt`). Each
`QuotaDimensionPosture` includes `dimensionId`, `displayName`, `scope`, `measuredValue`, `unit`,
`freshnessStatus`, `policyMode`, `status`, `warningThreshold`, `softLimit`, `hardLimit`,
`remainingToWarning`, `remainingToSoftLimit`, `remainingToHardLimit`, and `usageSnapshotTimestamp`.
`measuredValue` continues to carry the real `currentUsage` from the entitlement/consumption action;
unknown limits are `null`, and `remainingTo*` are `null` when the corresponding limit is `null`.
`QuotaPosture` is open, but the serializer still emits only contractual keys.

## Decision 4: Overview projection with honest provisioning and access metadata

The `overview` serializer emits the closed `TenantQuotaUsageOverview` / `WorkspaceQuotaUsageOverview`
required fields. Both carry `overviewId`, `queryScope`, `tenantId`, `workspaceId`, `generatedAt`,
`policiesConfigured`, `dimensions`, `overallPosture`, `warningDimensions`, `softLimitDimensions`,
`hardLimitDimensions`, and `accessAudit`; the tenant schema additionally requires `provisioningState`,
which the closed workspace schema does not declare and the workspace serializer therefore must not
emit. Each dimension is a closed
`QuotaUsageDimensionView` with `dimensionId`, `displayName`, `scope`, `currentUsage`, `unit`,
`warningThreshold`, `softLimit`, `hardLimit`, `usagePercentage`, `posture`, `visualState`,
`freshnessStatus`, `lastUpdatedAt`, `blockingState`, and `blockingReasonCode` — note `currentUsage`
and `posture` (not the posture schema's `measuredValue`/`status`). Because both the overview and its
dimension objects are closed, no extra key may appear.

`provisioningState` (`TenantProvisioningStateView`, tenant overview only) reports only what the
metrics runtime actually knows. It emits a synthetic `tenant_provisioning` component as `degraded`
with a reason explaining that provisioning state is not available from the metrics limit source;
the summary is therefore `state: degraded`, `visualState: degraded`, and lists that component in
`degradedComponents`, rather than asserting readiness it did not verify. `accessAudit`
(`QuotaUsageOverviewAccessAudit`) describes this read — `eventType`, `queryScope`, `tenantId`,
`workspaceId`, `permissionId`, `routeOperationId`, `requestedBy` (the caller's own subject),
`generatedAt` — and is a response projection, not a persisted event. `blockingState` defaults to a
safe `allowed`/`advisory` unless a real enforcement decision is known; `blockingReasonCode` is `null`
absent a real reason. Where the shared `observability-quota-usage-view` contract supplies the
posture→visual-state map, access-audit event type, and provisioning summaries, the serializer reuses
them rather than hardcoding.

## Decision 5: `UsageSnapshot` projection (usage)

The `usage` serializer emits `snapshotId`, `queryScope`, `tenantId`, `workspaceId`,
`snapshotTimestamp` (not the legacy `measuredAt`), `observationWindow`, `dimensions`,
`degradedDimensions`, and `calculationCycle` (`UsageCalculationCycleAudit` with `cycleId`,
`cadenceSeconds`, `processedScopes`, `degradedDimensions`, `snapshotTimestamp`). Each
`UsageDimensionSnapshot` carries `dimensionId`, `displayName`, `value` (the real `currentUsage`),
`unit`, `scope`, `freshnessStatus`, `sourceMode` (`control_plane_inventory` for control-plane
inventory-derived usage, `business_metric_family` only when truly sourced from a business metric),
`sourceRef`, and `observedAt`. The legacy `metricKey`, `measuredValue`, and `points` keys are dropped.
Degraded or unavailable dimensions are marked with `freshnessStatus: degraded`/`unavailable` and
listed in `degradedDimensions`, never emitted as fresh zeros.

## Decision 6: Contractual audit row projection with honest legacy fallbacks

`auditRowToRecord` in `audit-store.mjs` is the single seam feeding both the audit-records items and
the audit-export items. It is corrected to project every contractual object:

- `actor`: `{ actorId, actorType, displayName? }`. The legacy store does not capture actor type, so a
  row with an actor id is conservatively classified as `workspace_user` when workspace-scoped and
  `tenant_user` otherwise; a row without an actor id uses `system`. None is a privileged platform
  identity.
- `scope`: `{ scopeMode, tenantId?, workspaceId? }`. `scopeMode` is `tenant_workspace` when a
  workspace is present, `tenant` when only a tenant is present, and `platform` otherwise.
- `resource`: `{ subsystemId, resourceType, resourceId?, resourceDisplayName? }`, both required
  fields derived from the action family with non-sensitive defaults (`subsystemId: control-plane`,
  `resourceType` derived from the action noun or `action`).
- `result`: `{ outcome, message?, errorCode? }`. `outcome` maps faithfully to the enum
  (`succeeded`/`failed`/`denied`/`partial`/`accepted`), maps a stored `error` to `failed`, and maps
  a missing/unrecognized outcome to a single fixed contractual value that asserts neither success nor
  denial (design: `partial`), never the invalid `unknown`.
- `correlationId`: a non-null string; a legacy row without a captured correlation id emits
  `legacy-<eventId>` rather than `null`.
- `origin`: `{ originSurface, emittingService }` — `originSurface` stays the in-enum `control_api`
  and `emittingService` is the fixed emitting service id (design: `control-plane`).

The projection keeps the real `detail` object for masking (never a string) and may retain the
tamper-evidence `rowHash`/`prevHash` extras (audit schemas are open). Masking is applied by the
shared masker so sensitive `detail` fields are replaced and `maskingApplied`/`maskedFieldRefs`/
`sensitivityCategories` are populated; no masked value is revealed by a fallback.

## Decision 7: Conformant collections and manifests via the shared projection, with a conformant fallback

- **Audit records** use an explicit local allow-list projection over `auditRowToRecord`, so list
  items contain only the published `AuditRecord` fields and never the raw `detail` or hash extras.
  The collection advertises only the five filters this runtime actually supports, adds the required
  `queryScope`, string `appliedFilters`, `availableFilters`, and `consoleHints`, and emits an empty
  page as `{ size, hasMore: false }` with no `null` `nextCursor`.
- **Audit export** keeps lazily loading `buildAuditExportManifest` for the primary manifest and
  passes `records: rows.map(auditRowToRecord)` so items become valid `AuditExportedRecord`s. The
  inline fallback is rebuilt to share the same conformant record projection and to emit every
  `AuditExportManifest` required field — `exportId`, `queryScope`, `format` (from the request or the
  default `jsonl`), `maskingProfileId` (`default_masked`), `correlationId`
  (`ctx.callerContext.correlationId ??` a generated id), `generatedAt`, `appliedFilters`,
  `itemCount`, `maskedItemCount`, `items`. The fallback masks by replacing sensitive fields inside
  the object-typed `detail` and setting `maskingApplied`/`maskedFieldRefs`/`sensitivityCategories`;
  it never replaces `detail` with a string and never exposes more than the profile-masked primary
  path. The legacy extra `status` key is dropped and the console does not depend on it.

## Decision 8: Web console consumes canonical fields, unchanged behavior

`apps/web-console/src/lib/console-metrics.ts` and `apps/web-console/src/lib/console-quotas.ts` read
the canonical fields:

- usage: `snapshotTimestamp` (replacing `measuredAt`) and per-dimension `value`;
- overview: per-dimension `currentUsage` (replacing `measuredValue`) and `posture`, and the mapped
  `overallPosture` enum;
- quota posture: continues to read `measuredValue`/`hardLimit` from `QuotaDimensionPosture`, now
  fully populated;
- audit: the loose reader keeps its `?? 'unknown'` fallbacks but now receives contractual
  `actorType`, `scopeMode`, `resourceType`, and in-enum `outcome`.

The console maps the canonical `overallPosture`/`posture` enums to its existing warning/critical
visual cues so the Quotas and Observability pages render identically (same values, same breach
badges, same empty/degraded states). No page, route, navigation, copy, or visual redesign is added.
Types are tightened toward the published schemas without breaking the existing loose tolerance for a
degraded runtime.

## Decision 9: Preserve GET/read-only, isolation, and governance neutrality

The ten operations remain non-mutating reads behind the existing `guarded` boundary:

- no application/metric datastore write, no domain audit event, no quota consumption or policy change,
  no rate-limit class change, and no new route or status code;
- the existing foreign-workspace `403` and unknown-workspace `404` outcomes are preserved and expose
  no owning tenant, dimension, count, or provider detail, and cross-tenant reads remain denied;
- normal HTTP request/latency telemetry continues; the C-04 workspace-series metric labeling is
  untouched;
- no secret, credential, subject, raw header, or provider payload is added to a response beyond the
  caller's own `requestedBy` subject in `accessAudit`.

## Decision 10: Shared executor/contracts packaging verification (no deployment)

The change verifies, without deploying, that the primary conformant path is reachable in the
control-plane image: `apps/control-plane/metrics-handlers.mjs` and `apps/control-plane/audit-store.mjs`
remain `COPY`d, and `apps/control-plane-executor` and `packages/internal-contracts` remain `COPY`d
under `/repo` (so the shared export builder and its contract readers resolve). Serializers stay
inside the already-`COPY`d `metrics-handlers.mjs`/`audit-store.mjs`; if any new module is introduced,
it is appended to the `apps/control-plane/Dockerfile` `COPY` list so boot does not `ERR_MODULE_NOT_FOUND`.
The inline export fallback guarantees conformance if the shared export module is absent. Verification is a build
and a static import/resolution check only — no cluster rollout.

## Decision 11: Prove conformance with an exact real-handler Ajv test

A dedicated black-box contract test loads the canonical OpenAPI, compiles each in-scope `200` schema
with Ajv (required/type/enum/`additionalProperties` enforcement plus a local `date-time` format
validator), invokes the real handlers with
injected fakes (a fake pool/store, a fake entitlement/consumption action, an injected audit reader,
and injected time), and asserts every body validates for:

- populated tenant and workspace results;
- empty collections and empty/unavailable quota/usage;
- degraded/unavailable evidence (honest enums, no fabricated health/usage);
- legacy audit rows (missing actor type, scope mode, resource, outcome, correlation) projecting to
  contractual fallbacks with masking preserved;
- the audit-export primary and inline-fallback manifests and their `AuditExportedRecord` items;
- cross-tenant/unknown-workspace controls returning the existing `403`/`404` without scope data; and
- a P10 read returning only permitted contract fields with no mutation.

The test is hermetic: no external network, Prometheus, Docker, credential, fixed port, or cluster.

## Documentation

Add `docs/reference/architecture/observability-success-response-contracts.md` with: the ten
operations and their schemas; the honest posture/freshness/visual-state mapping and the conservative
empty-result behavior; the canonical
console fields; the audit legacy-row fallbacks and masking; the shared primary/fallback export
projection; and the focused local validation commands. Do not add audit evidence, loop-state
artifacts, credentials, or shared/staging deployment instructions.

## Rollout and Compatibility

The change is code-only: serializers, the audit row projection, the console client/types/tests, the
contract/focused tests, and this OpenSpec change. It ships without a schema, datastore, or data
migration and adds no persisted state, so producer and consumer changes release together. Because the
console reader already tolerated missing fields, a mixed-version console keeps rendering; the
corrected backend simply supplies canonical values. Rollback reverts these files and reintroduces the
C-01 non-conforming bodies with no data cleanup.

## Risks

- **Scope substitution:** deriving a scope id from an untrusted source; bound by `ctx.resolvedScope`,
  the existing `guarded` boundary, and cross-tenant tests.
- **Fabricated health:** presenting unresolved evidence as healthy; bound by the honest-degradation
  enums and dedicated empty/degraded tests.
- **Masking regression:** the export fallback leaking sensitive detail; bound by one shared
  conservatively masking projection and fallback masking tests.
- **Closed-schema drift:** an extra key on a closed overview object; bound by Ajv
  `additionalProperties` assertions.
- **Packaging gap:** the shared projection missing from the image; bound by the packaging check and a
  conformant inline fallback.

## Open Questions

None. The C-02 error envelope, C-04 workspace series, C-09/C-10 request semantics, C-16 tenant
existence, role reconciliation, and any deployment remain assigned to other findings or later work.
