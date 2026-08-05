# observability — spec delta for fix-c16-scoped-resource-existence

## ADDED Requirements

### Requirement: Tenant metrics authenticate, authorize, and then confirm tenant existence

The system SHALL process every tenant-scoped quota-posture, quota-usage-overview, usage-snapshot,
runtime-only metric-series, audit-record-list, and audit-export request in this order: authenticate the
request, apply the existing authorization for the addressed tenant, confirm the tenant exists through
the authoritative tenant registry, and only then perform parameter-dependent or observational work.
After authorization, an addressable tenant absent from the registry SHALL terminate as HTTP `404` with
the `TENANT_NOT_FOUND` error class before any limit/default resolution, metrics provider access, audit
query, or audit export work.

#### Scenario: Authentication remains first

- **WHEN** an unauthenticated or invalidly authenticated caller requests any tenant metrics operation,
  whether the addressed tenant exists or not
- **THEN** the system returns the existing authentication failure without authorization, tenant
  registry, limits, defaults, provider, audit-query, or export work

#### Scenario: Authorized privileged caller addresses an unknown tenant

- **WHEN** a platform/superadmin administrator (P1), platform operator (P3), security/compliance
  auditor (P4), or another caller already authorized to address the tenant invokes any of the six
  tenant metrics handler families for a tenant absent from the authoritative registry
- **THEN** the system returns HTTP `404` with the `TENANT_NOT_FOUND` error class and performs no limit,
  default, provider, audit-query, or audit-export work

#### Scenario: Authorized constrained reader addresses an unknown tenant

- **WHEN** a scoped viewer/auditor (P10) is authorized under the existing policy to address the tenant
  id but the tenant is absent from the authoritative registry
- **THEN** the read-only operation returns HTTP `404` with the `TENANT_NOT_FOUND` error class and gains
  no mutation or additional scope grant

#### Scenario: Existing authorized tenant reaches its handler

- **WHEN** authentication and existing authorization succeed and the addressed tenant exists
- **THEN** the system attaches the authoritative tenant scope and continues to the requested handler
  under the existing operation-specific validation and provider behavior

### Requirement: Tenant not-found handling preserves non-enumeration

The system SHALL NOT query tenant existence before the existing own-tenant authorization decision.
A constrained caller not authorized to address the tenant SHALL receive the same HTTP `403
FORBIDDEN` result for a foreign existing tenant and an unrelated unknown tenant, and neither denial
SHALL perform a tenant-registry read, limit/default resolution, provider access, audit query, or audit
export.

#### Scenario: Foreign existing tenant remains forbidden without probing

- **WHEN** an adversarial actor from another tenant (P13) requests any tenant metrics operation for a
  foreign tenant that exists
- **THEN** the system returns the existing HTTP `403 FORBIDDEN` without probing tenant existence or
  invoking any observational dependency

#### Scenario: Unrelated unknown tenant is indistinguishable from foreign existing

- **WHEN** the same P13 actor requests the same tenant metrics operation for an unrelated tenant id
  that does not exist
- **THEN** the status, public error class, and disclosure are indistinguishable from the foreign-
  existing denial, and no registry, limits, defaults, provider, audit-query, or export work occurs

#### Scenario: Authentication and authorization do not become an existence oracle

- **WHEN** a client compares failures across missing credentials, foreign existing tenant ids, and
  unrelated unknown tenant ids
- **THEN** authentication still determines unauthenticated outcomes, authorization still determines
  both unauthorized tenant outcomes, and only an already authorized addressable tenant can produce
  `TENANT_NOT_FOUND`

### Requirement: Workspace metrics retain their existing existence and authorization outcomes

The system SHALL preserve workspace-scoped metrics resolution: the authoritative workspace lookup
SHALL return HTTP `404 WORKSPACE_NOT_FOUND` for an unknown workspace, and an existing workspace whose
owning tenant the caller cannot manage SHALL return HTTP `403 FORBIDDEN`. Workspace metrics SHALL use
the tenant id obtained from the resolved workspace and SHALL NOT add a separate tenant-existence probe
or otherwise change their provider, validation, or success behavior.

#### Scenario: Unknown workspace metrics remain not found

- **WHEN** an authenticated caller requests any workspace metrics operation for a workspace absent
  from the authoritative registry
- **THEN** the system returns HTTP `404 WORKSPACE_NOT_FOUND` before limits, defaults, provider,
  audit-query, or export work

#### Scenario: Known foreign workspace metrics remain forbidden

- **WHEN** a constrained caller requests any workspace metrics operation for an existing workspace
  owned by another tenant
- **THEN** the system returns the existing HTTP `403 FORBIDDEN` and returns no metric, usage, audit,
  tenant, or workspace data

#### Scenario: Resolved workspace does not trigger a tenant re-probe

- **WHEN** the workspace exists and the caller passes the existing authorization for its resolved
  owning tenant
- **THEN** the system proceeds with the authoritative workspace and its resolved tenant id without a
  separate tenant registry lookup or a change to the workspace response semantics

### Requirement: Workspace storage usage resolves existence for every actor

The system SHALL resolve the addressed workspace through the authoritative workspace registry for
every workspace-storage-usage caller, including `superadmin` and `internal` actors, before bucket
registry, object-store/S3, quota, or default work. An unknown workspace SHALL terminate as HTTP `404`
with the `WORKSPACE_NOT_FOUND` error class. For constrained actors, both a foreign existing workspace
and an unknown workspace SHALL remain the same opaque HTTP `404` and SHALL disclose no ownership or
existence distinction.

#### Scenario: Privileged caller addresses unknown workspace storage

- **WHEN** a platform/superadmin administrator (P1) or internal platform operator (P3) requests
  storage usage for a workspace absent from the authoritative registry
- **THEN** the system returns HTTP `404 WORKSPACE_NOT_FOUND` before listing buckets, scanning objects,
  or resolving quota limits or defaults

#### Scenario: Constrained caller receives opaque not found for foreign workspace

- **WHEN** a workspace owner/administrator (P7), workspace operator/application DevOps user (P9),
  scoped viewer/auditor (P10), service workload (P12), or adversarial cross-tenant actor (P13) requests
  storage usage for an existing workspace outside its tenant boundary
- **THEN** the system returns the existing opaque HTTP `404 WORKSPACE_NOT_FOUND` with no bucket,
  object, quota, default, ownership, or existence disclosure

#### Scenario: Constrained caller receives the same outcome for unknown workspace

- **WHEN** the same constrained caller requests storage usage for an unknown workspace id
- **THEN** the system returns an outcome indistinguishable from the foreign-existing workspace case
  and performs no bucket-registry, object-store/S3, quota, or default work

#### Scenario: Terminal workspace result short-circuits all storage dependencies

- **WHEN** workspace resolution or the existing tenant-ownership gate returns a terminal `404`
- **THEN** the system does not list workspace buckets, list or inspect objects, calculate provider
  totals, or read quota/default configuration

### Requirement: Existing authorized resources preserve honest success semantics

The system SHALL preserve the current HTTP `200` schemas, resolved scope fields, provider calculations,
and honest empty or degraded behavior for authorized tenants and workspaces that exist. The existence
gate SHALL distinguish only an absent registry record from a real resource; it SHALL NOT reinterpret a
real resource with no limits, metrics evidence, audit records, export items, buckets, or stored objects
as not found, and SHALL NOT fabricate fresh evidence or health.

#### Scenario: Existing tenant with no metrics evidence remains an honest success

- **WHEN** an authorized caller requests tenant quota, overview, usage, or runtime-only series for an
  existing tenant whose configured limits or provider evidence are empty, degraded, or unavailable
- **THEN** the operation preserves its current schema-valid HTTP `200` empty/degraded semantics and
  provider math without reporting the tenant as absent or fabricating healthy evidence

#### Scenario: Existing tenant with no audit rows remains an honest success

- **WHEN** an authorized security/compliance auditor (P4) lists or exports audit records for an
  existing tenant with no matching records
- **THEN** the operation preserves its schema-valid HTTP `200` empty collection or empty export
  manifest rather than returning `TENANT_NOT_FOUND`

#### Scenario: Existing workspace with no storage remains a truthful zero usage success

- **WHEN** an authorized caller requests storage usage for an existing workspace with no mapped
  buckets or stored objects
- **THEN** the operation preserves its current schema-valid HTTP `200` usage snapshot and quota math,
  including truthful zero counts, without treating the workspace as absent

#### Scenario: Existing populated resource preserves calculations

- **WHEN** an authorized caller requests metrics or storage usage for an existing populated tenant or
  workspace
- **THEN** all success fields, provider-derived values, degradation rules, and quota calculations are
  identical to the pre-change behavior

### Requirement: Published metrics operations declare canonical not-found responses

The unified OpenAPI SHALL declare an HTTP `404` response whose JSON schema references the canonical
`#/components/schemas/ErrorResponse` for exactly these eleven published metrics operations: tenant
`getTenantQuotaPosture`, `getTenantQuotaUsageOverview`, `getTenantUsageSnapshot`,
`listTenantAuditRecords`, and `exportTenantAuditRecords`; and workspace
`getWorkspaceQuotaPosture`, `getWorkspaceQuotaUsageOverview`, `getWorkspaceUsageSnapshot`,
`getWorkspaceMetricSeries`, `listWorkspaceAuditRecords`, and `exportWorkspaceAuditRecords`. The
runtime-only tenant series SHALL remain unpublished, and the existing `getWorkspaceStorageUsage`
`404` declaration SHALL remain in place without creating a twelfth metrics operation change.

#### Scenario: Eleven metrics operations publish ErrorResponse for 404

- **WHEN** the canonical unified OpenAPI and generated metrics-family contract are inspected
- **THEN** each of the eleven named operation ids has a `404` JSON response referencing
  `#/components/schemas/ErrorResponse`, with no named operation omitted and no additional metrics
  operation changed by C-16

#### Scenario: Runtime-only tenant series stays unpublished

- **WHEN** public API generation and focused contract validation complete
- **THEN** no tenant metric-series path or operation id appears in the unified OpenAPI, generated
  metrics family, route catalog, SDK-facing contract, or published public API documentation

#### Scenario: Storage usage retains its existing declaration

- **WHEN** `getWorkspaceStorageUsage` is inspected after the metrics contract update
- **THEN** its existing `404` response still references the canonical `ErrorResponse` and is not
  removed, duplicated, or otherwise changed by C-16

### Requirement: C-16 not-found responses reuse the canonical error envelope

The system SHALL serialize the tenant and workspace not-found classes through the existing canonical
C-02 `ErrorResponse` envelope and SHALL NOT introduce a second envelope, schema, error family, or error
code taxonomy. The handler-level classes `TENANT_NOT_FOUND` and `WORKSPACE_NOT_FOUND` SHALL retain their
meaning, while the public HTTP serialization SHALL apply the existing canonical normalization,
correlation, sanitization, and bounded-code rules.

#### Scenario: Tenant not found uses the existing envelope

- **WHEN** an authorized HTTP request terminates because the addressed tenant does not exist
- **THEN** the response status is `404`, its class is derived from `TENANT_NOT_FOUND`, and its body
  validates against the canonical closed `ErrorResponse` without a legacy `{ code, message }` body or
  a new C-16-specific field

#### Scenario: Workspace not found uses the existing envelope

- **WHEN** an in-scope HTTP request terminates because the addressed workspace does not exist or must
  remain opaque to a constrained caller
- **THEN** the response status is `404`, its class is derived from `WORKSPACE_NOT_FOUND`, and its body
  validates against the same canonical `ErrorResponse` with the existing sanitization and correlation
  behavior

### Requirement: Scope-existence correction is read-only and governance-neutral

The system SHALL add no role, permission, membership, route, method, store, persisted field,
datastore migration, gateway or deployment configuration, domain audit event, application metric
family, quota policy, metering write, or rate-limit change for C-16. A terminal authentication,
authorization, or existence result SHALL consume no domain quota and emit no domain audit event, while
ordinary request telemetry and correlation SHALL retain their existing behavior and shall not encode
new tenant/workspace existence detail.

#### Scenario: Terminal result has no domain side effect

- **WHEN** an in-scope request terminates with authentication failure, `403`, or scope `404`
- **THEN** no domain audit record, quota consumption, metering write, provider query, or application
  data mutation occurs, and existing request telemetry records only its already-approved bounded
  route/status/correlation dimensions

#### Scenario: Successful read remains non-mutating

- **WHEN** an authorized metrics or storage-usage read for an existing resource completes
- **THEN** it preserves existing request telemetry and performs no new audit, quota, metering, or
  persistence side effect

#### Scenario: Adjacent personas gain no capability

- **WHEN** a workspace owner/administrator (P7), service workload (P12), scoped viewer/auditor (P10),
  or any other adjacent persona invokes an affected operation
- **THEN** its existing authorization and read-only boundary remains unchanged and C-16 grants no new
  route, scope, mutation, or cross-tenant access

### Requirement: Console scope errors cannot leave fabricated or stale success state

The web console SHALL treat an HTTP `404` from an affected metrics, audit, quota, or workspace-storage-
usage request as a not-found/unavailable failure for the requested scope. It SHALL clear success data
associated with that failed request, SHALL NOT render a healthy, empty-audit, successful-export, or
zero-storage success for the missing resource, and SHALL retain the existing retry/error interaction
without a production page, navigation, or visual redesign.

#### Scenario: Metrics 404 clears prior overview data

- **WHEN** a console metrics or quota client previously rendered data and a subsequent request for the
  selected tenant or workspace returns scope `404`
- **THEN** the client clears the stale overview/usage/series success state and the page renders its
  existing error or unavailable state rather than the prior metrics or an empty healthy display

#### Scenario: Audit 404 clears records and does not fabricate export success

- **WHEN** an audit list or export request for the selected scope returns `404`
- **THEN** the console clears records and pagination associated with the failed scope, exposes the
  existing error feedback, and does not present an empty audit history or successful export manifest

#### Scenario: Storage usage 404 clears zero-valued or stale usage

- **WHEN** the workspace storage-usage request returns `404` after usage from a prior selection was
  present
- **THEN** the console clears the prior usage snapshot and renders the existing error state instead of
  displaying zero or stale bucket, object, byte, or capacity values
