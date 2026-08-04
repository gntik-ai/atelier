# observability — spec delta for fix-c01-observability-success-schemas

## ADDED Requirements

### Requirement: Observability quota, usage, overview, and audit successes conform to their published schemas

The system SHALL make every HTTP `200` response of the tenant and workspace quota-posture,
quota-usage overview, usage-snapshot, audit-records, and audit-export operations validate exactly
against its current published schema — required fields, value types, enum members, and
`additionalProperties` — for populated, empty, and degraded results. The system SHALL emit only the
fields the schema allows (a backend allow-list projection) and SHALL NOT loosen the OpenAPI schema,
add aliases, or introduce an undeclared property where the schema is closed.

#### Scenario: Populated tenant and workspace reads validate

- **WHEN** an authorized platform operator (P3), workspace owner/administrator (P7), or workspace
  operator/application DevOps user (P9) requests quota posture, overview, usage, audit records, or an
  audit export for its resolved tenant or workspace
- **THEN** the response body validates against the operation's published schema (`QuotaPosture`,
  `TenantQuotaUsageOverview`, `WorkspaceQuotaUsageOverview`, `UsageSnapshot`,
  `AuditRecordCollectionResponse`, or `AuditExportManifest`) with all required fields, correct types,
  in-enum values, and no disallowed property

#### Scenario: Legacy minimal shapes are removed

- **WHEN** any in-scope operation returns a success body
- **THEN** it contains none of the legacy keys `measuredAt`, `metricKey`, `points`, `source`, an
  out-of-enum `overallPosture` such as `healthy` or `critical`, or a `null` `page.nextCursor`

#### Scenario: Closed overview schemas reject extra properties

- **WHEN** an overview response is validated against `TenantQuotaUsageOverview` or
  `WorkspaceQuotaUsageOverview`
- **THEN** the top-level object and each `QuotaUsageDimensionView`, `TenantProvisioningStateView`,
  `ProvisioningComponentState`, and `QuotaUsageOverviewAccessAudit` contain only their declared
  properties and pass `additionalProperties: false`

### Requirement: Quota posture responses project the full QuotaPosture contract

The system SHALL serialize each quota-posture `200` as a `QuotaPosture` containing `postureId`,
`queryScope`, `tenantId`, `workspaceId`, `evaluatedAt`, `usageSnapshotTimestamp`, `observationWindow`,
`dimensions`, `overallStatus`, `degradedDimensions`, `hardLimitBreaches`, `softLimitBreaches`,
`warningDimensions`, and `evaluationAudit`, where each dimension is a `QuotaDimensionPosture` with all
its required fields. It SHALL carry the real measured usage in `measuredValue` and SHALL set unknown
limits and their derived remainders to `null`.

#### Scenario: Quota posture is fully populated

- **WHEN** an authorized caller reads quota posture for a scope with resolvable limits
- **THEN** the response includes the resolved `tenantId`/`workspaceId`, an in-enum `overallStatus`,
  the `evaluationAudit` block, and dimensions carrying `scope`, `measuredValue`, `unit`,
  `freshnessStatus`, `policyMode`, `status`, and the warning/soft/hard limit and remainder fields

#### Scenario: Unknown limits serialize as null

- **WHEN** a dimension has no configured hard or soft limit
- **THEN** `hardLimit`, `softLimit`, and their `remainingTo*` counterparts are `null` and
  `policyMode` is `unbounded`, and the response still validates

### Requirement: Quota usage overview responses conform to their scoped closed schema

The system SHALL serialize the tenant overview as a `TenantQuotaUsageOverview` with
`queryScope: "tenant"` and a null `workspaceId`, and the workspace overview as a
`WorkspaceQuotaUsageOverview` with `queryScope: "workspace"` and the resolved string `workspaceId`.
Each dimension SHALL be a `QuotaUsageDimensionView` carrying `currentUsage` and `posture` (and
`visualState`, `usagePercentage`, `blockingState`, `blockingReasonCode`, `lastUpdatedAt`). The tenant
overview SHALL additionally carry a `provisioningState`; the closed `WorkspaceQuotaUsageOverview` SHALL
NOT emit `provisioningState`. The `provisioningState` and `accessAudit` blocks SHALL report only what
the runtime knows and SHALL be response projections, not persisted events.

#### Scenario: Tenant overview carries a null workspace and tenant scope

- **WHEN** an authorized caller reads the tenant overview
- **THEN** `queryScope` is `tenant`, `workspaceId` is `null`, dimensions expose `currentUsage` and
  `posture`, and `provisioningState`/`accessAudit` are present and schema-valid

#### Scenario: Workspace overview carries the resolved workspace scope

- **WHEN** an authorized caller reads the workspace overview for a resolved workspace
- **THEN** `queryScope` is `workspace`, `workspaceId` is the resolved id, and every dimension and the
  overview object validate against the closed workspace overview schema

#### Scenario: Tenant provisioning state is not fabricated

- **WHEN** the tenant overview is served and the runtime has not evaluated per-component provisioning
  health
- **THEN** the tenant `provisioningState` reports a schema-valid degraded placeholder component, a
  required `lastCheckedAt`, and a reason that provisioning was not evaluated by the metrics source,
  rather than asserting readiness it did not verify, while the closed workspace overview omits
  `provisioningState` entirely

### Requirement: Usage snapshot responses use canonical UsageSnapshot fields

The system SHALL serialize each usage `200` as a `UsageSnapshot` with `snapshotId`, `queryScope`,
`tenantId`, `workspaceId`, `snapshotTimestamp`, `observationWindow`, `dimensions`,
`degradedDimensions`, and `calculationCycle`, where each `UsageDimensionSnapshot` carries `value`,
`unit`, `scope`, `freshnessStatus`, `sourceMode`, `sourceRef`, and `observedAt`. It SHALL NOT emit the
legacy `measuredAt`, `metricKey`, `measuredValue`, or `points` keys.

#### Scenario: Usage snapshot exposes canonical timestamp and value

- **WHEN** an authorized caller reads a usage snapshot
- **THEN** the response carries `snapshotTimestamp` at the top level and per-dimension `value`, and
  validates against `UsageSnapshot`

#### Scenario: Degraded usage dimensions are marked, not zeroed

- **WHEN** a usage dimension cannot be measured freshly
- **THEN** it is marked `freshnessStatus: degraded` or `unavailable` and listed in
  `degradedDimensions` rather than reported as a fresh zero value

### Requirement: Observability successes degrade honestly without fabricated health or usage

The system SHALL degrade unresolved quota/usage evidence to a still schema-valid `200` that reports
`evidence_unavailable` or `evidence_degraded` posture, `unavailable` or `degraded` freshness, and an
`unknown` or `degraded` visual state, and SHALL NOT fabricate `within_limit`, `healthy`, or
zero-consumption values. When the existing adapter returns an empty array and cannot distinguish an
unconfigured scope from a swallowed source error, the system SHALL conservatively report
`policiesConfigured: false` with `evidence_unavailable`. It SHALL emit empty collections as
schema-valid bodies.

#### Scenario: Unresolved evidence is reported honestly

- **WHEN** the underlying limits or consumption cannot be resolved for an authorized read
- **THEN** the response reports `evidence_unavailable`/`evidence_degraded` posture and
  `unavailable`/`degraded` freshness, presents no fabricated healthy posture or zero usage, and still
  validates against its schema

#### Scenario: Empty source result is conservative

- **WHEN** the current limit adapter returns no dimensions and supplies no source-status metadata
- **THEN** the overview reports `policiesConfigured: false` and `evidence_unavailable`, without
  asserting that the scope is healthy or intentionally unbounded

#### Scenario: Empty audit-record collection is schema-valid

- **WHEN** an audit-records read has no matching rows
- **THEN** the response returns `items: []`, a `page` with `hasMore: false` and no `null` cursor, and
  the contractual `queryScope`, `appliedFilters`, `availableFilters`, and `consoleHints`, and
  validates

#### Scenario: Empty audit export is schema-valid

- **WHEN** an audit-export read has no matching rows
- **THEN** the manifest returns `items: []`, `itemCount: 0`, `maskedItemCount: 0`, and the required
  `exportId`, `queryScope`, `format`, `maskingProfileId`, `correlationId`, `generatedAt`, and
  `appliedFilters`, and validates against `AuditExportManifest`

### Requirement: Observability successes bind to the resolved tenant and workspace

The system SHALL populate `queryScope`, `tenantId`, and `workspaceId` in every in-scope response from
`ctx.resolvedScope` produced by the existing guard, and SHALL NOT derive any scope identifier from a
raw path segment, request query/body, or an unverified identity claim.

#### Scenario: Scope fields come from the resolved scope

- **WHEN** an authorized tenant or workspace read completes
- **THEN** `tenantId`, `workspaceId`, and `queryScope` match `ctx.resolvedScope` — a tenant read
  carries the tenant with a null/absent workspace, and a workspace read carries the resolved
  workspace and its owning tenant

#### Scenario: Client-supplied scope is not trusted

- **WHEN** a caller includes a tenant or workspace identifier in a query parameter, request body, or
  untrusted header
- **THEN** the system ignores it for response scoping and derives scope only from the resolved,
  authorized path scope

### Requirement: Audit records project contractual actor, scope, resource, result, and origin

The system SHALL project each audit row into an `actor` with `actorId` and an in-enum `actorType`, a
`scope` with an in-enum `scopeMode`, a `resource` with `subsystemId` and `resourceType`, a `result`
with an in-enum `outcome`, an `origin` with `originSurface` and `emittingService`, and a non-null
string `correlationId`. It SHALL supply honest, non-sensitive fallbacks for legacy rows and SHALL
preserve field masking.

#### Scenario: Populated audit record is contractual

- **WHEN** an audit row carries a captured actor type, workspace, resource, outcome, and correlation
- **THEN** the projected record validates against `AuditRecord` with the real values in `actor`,
  `scope`, `resource`, `result`, and `origin`

#### Scenario: Legacy audit row uses honest fallbacks

- **WHEN** a readable audit row lacks a captured actor type, scope mode, resource, terminal outcome,
  or correlation id
- **THEN** the record supplies a non-null fallback `actorId`, a contractual `actorType`, a derived
  `scopeMode`, a non-sensitive
  `subsystemId`/`resourceType`, an in-enum `outcome` that asserts neither success nor denial, an
  `emittingService`, and a non-null `correlationId`, without fabricating a more privileged actor or
  revealing a masked value

#### Scenario: Stored error and unknown outcomes map into the enum

- **WHEN** a row's stored outcome is `error`, empty, or otherwise outside the published enum
- **THEN** the projected `result.outcome` is an in-enum value (`error` maps to `failed`; an
  unrecognized value maps to a single fixed contractual value) and never the invalid `unknown`

#### Scenario: Masking is preserved

- **WHEN** an audit row's `detail` contains sensitive fields
- **THEN** those fields are masked in the projected record and the masking metadata is populated, and
  no unmasked sensitive value appears in any success or export body

### Requirement: Audit record collections conform to AuditRecordCollectionResponse

The system SHALL serialize each audit-records `200` as an `AuditRecordCollectionResponse` with
`items`, a `page` object, `queryScope`, `appliedFilters` (string→string), `availableFilters`, and
`consoleHints`. It SHALL omit the `page.nextCursor` key when there is no further page rather than
emitting `null`.

#### Scenario: Collection carries console and filter metadata

- **WHEN** an authorized caller lists audit records
- **THEN** the response includes the resolved `queryScope`, the applied string filters,
  `availableFilters`, and a `consoleHints` object with `scopeId`, `defaultColumns`, `savedPresets`,
  and `states`, and validates

#### Scenario: Last page omits the cursor

- **WHEN** a listing returns the final or only page of results
- **THEN** `page` contains `size` and `hasMore: false` and does not contain a `null` `nextCursor`

### Requirement: Audit export manifests conform across the primary and fallback paths

The system SHALL make the primary export builder and the inline fallback share one conformant record
projection and emit an `AuditExportManifest` with `exportId`, `queryScope`, `format`,
`maskingProfileId`, `correlationId`, `generatedAt`, `appliedFilters`, `itemCount`, `maskedItemCount`,
and `items`, where each item is a valid `AuditExportedRecord`. The fallback SHALL mask sensitive
fields inside the object-typed `detail`, SHALL populate the masking metadata, and SHALL NOT expose
more than the profile-masked primary path.

#### Scenario: Primary export manifest is conformant

- **WHEN** the shared export builder is available and an authorized caller previews an export
- **THEN** the manifest validates against `AuditExportManifest` and each item validates against
  `AuditExportedRecord` with `maskingApplied`, `maskedFieldRefs`, and `sensitivityCategories`

#### Scenario: Fallback export manifest is equally conformant

- **WHEN** the shared export builder cannot be resolved and the inline fallback produces the manifest
- **THEN** the manifest includes `format`, `maskingProfileId`, and `correlationId`, its items keep an
  object-typed masked `detail`, and it validates against the same schema as the primary path

#### Scenario: Fallback never over-exposes

- **WHEN** a record contains a field the profile would mask
- **THEN** the fallback masks at least that field and reveals no value the profile-masked primary
  path would have hidden

### Requirement: Observability successes preserve authorization, isolation, and persona boundaries

The system SHALL preserve the existing authentication, authorization, workspace membership,
actor-type, superadmin, and denial behavior for these operations and SHALL NOT expand any role. The
corrected serialization SHALL apply only after the caller has passed the existing boundary, and
cross-scope reads SHALL remain denied without leaking scope data.

#### Scenario: Privileged and read-only personas read under existing grants

- **WHEN** a privileged platform/superadmin administrator (P1) or a security/compliance auditor (P4)
  reads an in-scope operation permitted by the existing policy
- **THEN** the caller receives the conformant body and is granted no additional operation

#### Scenario: Constrained reader stays read-only

- **WHEN** a scoped viewer/auditor (P10) invokes an in-scope operation under its existing
  authorization
- **THEN** the operation is read-only, performs no quota or audit mutation, and returns only the
  permitted contract fields

#### Scenario: Adjacent machine persona is not newly granted

- **WHEN** a service workload (P12) lacks permission under the existing policy
- **THEN** the existing denial remains and this change does not reinterpret its grant, credential, or
  actor type

#### Scenario: Cross-tenant or unknown-workspace read fails closed

- **WHEN** an actor from another tenant (P13) presents a foreign workspace, or any caller requests an
  unknown workspace
- **THEN** the system preserves the existing `403 FORBIDDEN` (known foreign) or `404
  WORKSPACE_NOT_FOUND` (unknown) outcome, returns no series, dimension, count, or scope metadata, and
  performs no cross-tenant read

### Requirement: Observability successes remain read-only and governance-neutral

The system SHALL keep the ten operations as non-mutating reads that emit no domain audit event, write
no application or metric data, consume or change no quota, and change no route, status code, or
rate-limit class. The response audit/evaluation/calculation projections SHALL NOT be persisted. The
shared executor/internal-contracts projections SHALL remain packaged in the control-plane image so
the primary conformant path is reachable, and the inline fallbacks SHALL be conformant.

#### Scenario: Authorized read has no side effect

- **WHEN** an authorized in-scope read completes successfully or degrades honestly
- **THEN** normal request telemetry records the request and no domain audit record, data write, quota
  consumption, quota-policy change, route change, or status-code change occurs

#### Scenario: Contract surface is unchanged

- **WHEN** the canonical OpenAPI and public API artifacts are validated after the change
- **THEN** no route, method, operation id, status, rate-limit class, or schema is loosened or added,
  and the in-scope operations still reference their existing schemas

#### Scenario: Shared projection is packaged with a conformant fallback

- **WHEN** the control-plane image is built and the metrics handlers resolve their projections
- **THEN** `apps/control-plane-executor` and `packages/internal-contracts` are present so the primary
  conformant projection is reachable, and if a shared module is absent the inline fallback still
  produces a schema-valid body
