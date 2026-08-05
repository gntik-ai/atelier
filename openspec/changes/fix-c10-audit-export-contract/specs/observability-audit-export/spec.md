# Observability audit-export — spec delta for fix-c10-audit-export-contract

## ADDED Requirements

### Requirement: Canonical sort and filters are validated before SQL

The system SHALL validate `sort` as `eventTimestamp` or `-eventTimestamp` and SHALL validate every
public export filter before SQL; a single valid timestamp bound is permitted. Invalid values SHALL
use the existing bounded handler 4xx envelope. Aligning the global ErrorResponse schema is C-02 and
out of scope.

#### Scenario: Invalid sort or filter

- **WHEN** an export request contains an unsupported sort or malformed public filter
- **THEN** the handler returns the bounded 4xx response before any datastore call

#### Scenario: One-sided timestamp

- **WHEN** an otherwise valid request contains only one valid timestamp bound
- **THEN** validation succeeds and the bound is included in normalized filters

### Requirement: Tenant and workspace audit-export routes share one authorized, scope-bound contract

The system SHALL expose the corrected export behavior through both
`POST /v1/metrics/tenants/{tenantId}/audit-exports` and
`POST /v1/metrics/workspaces/{workspaceId}/audit-exports`. Before interpreting the request body or
querying audit rows, it SHALL authenticate the caller, resolve the path scope, and apply the existing
tenant or workspace audit-export authorization. It SHALL bind every datastore query only to
`ctx.resolvedScope` — the resolved tenant and, for the workspace route, the exact resolved workspace.
The request body SHALL NOT widen, override, or cross that scope. This change SHALL NOT add or alter a
role, permission, membership, or authorization decision.

#### Scenario: Authorized tenant export

- **WHEN** a caller with the existing tenant audit-export permission posts a valid export request for
  its resolved tenant
- **THEN** the system builds the export inside that exact tenant scope and returns no row from another
  tenant

#### Scenario: Authorized workspace export

- **WHEN** a caller with the existing workspace audit-export permission posts a valid export request
  for a resolved workspace
- **THEN** the system builds the export with both the workspace's owning tenant and the exact
  workspace predicate and returns no tenant-wide or sibling-workspace row

#### Scenario: Existing permission is absent

- **WHEN** a caller posts to either audit-export route without its existing required audit-export
  permission
- **THEN** the existing authorization denial is preserved and no audit export query executes

#### Scenario: Request body cannot widen scope

- **WHEN** an authorized caller supplies a request body naming another tenant or workspace than
  `ctx.resolvedScope`
- **THEN** the system ignores the body for scope, binds the query to `ctx.resolvedScope`, and returns
  no out-of-scope record

### Requirement: Export format is required and validated before the datastore

The system SHALL require an explicit `format` on every export request and SHALL accept only the
contract's supported ids `jsonl` and `csv`. An omitted `format` SHALL be rejected rather than
defaulted, and an unsupported `format` SHALL be rejected. Any such rejection SHALL return a coded HTTP
`400` before any datastore call and SHALL NOT be converted into a successful fallback export.

#### Scenario: Supported format is accepted

- **WHEN** an authorized caller supplies `format` equal to `jsonl` or `csv` on an otherwise valid
  request
- **THEN** the system accepts the format and may build the authorized export

#### Scenario: Format is omitted

- **WHEN** an authorized caller omits `format`
- **THEN** the system returns HTTP `400` before any datastore call and does not default the format to
  produce a successful export

#### Scenario: Format is unsupported

- **WHEN** an authorized caller supplies a `format` other than `jsonl` or `csv`
- **THEN** the system returns HTTP `400` before any datastore call and does not reinterpret the value

#### Scenario: Invalid format is not swallowed into a fallback

- **WHEN** the request `format` is missing or unsupported and the primary export builder raises the
  contractual format error
- **THEN** the system surfaces the coded HTTP `400` and does not fall through to the inline fallback to
  return a successful export

### Requirement: Export page size defaults to 500 and is bounded 1 through 10000 before the datastore

The system SHALL treat an omitted `pageSize` as 500 and SHALL otherwise require one unambiguous
integer from 1 through 10000 inclusive. A `pageSize` that is zero, negative, greater than 10000,
fractional, non-numeric, empty, or otherwise not an integer SHALL be rejected with a coded HTTP `400`
before any datastore call and SHALL NOT be silently clamped, defaulted, or truncated into a successful
export.

#### Scenario: Page size is omitted

- **WHEN** an authorized caller supplies a supported `format` without `pageSize`
- **THEN** the system normalizes the export page size to 500

#### Scenario: Page size is valid at the lower bound

- **WHEN** an authorized caller supplies integer `pageSize` equal to 1
- **THEN** the system uses that requested bound without clamping it and exports at most one record

#### Scenario: Page size exceeds the list maximum

- **WHEN** an authorized caller supplies integer `pageSize` equal to 201
- **THEN** the system accepts it and may export more than 200 records, exceeding the audit-records
  list maximum without clamping to 200

#### Scenario: Page size is the contract default

- **WHEN** an authorized caller supplies integer `pageSize` equal to 500
- **THEN** the system uses 500 as the export bound

#### Scenario: Page size is at the upper bound

- **WHEN** an authorized caller supplies integer `pageSize` equal to 10000
- **THEN** the system honors up to 10000 records and does not truncate the export to 200

#### Scenario: Page size is zero or negative

- **WHEN** `pageSize` is 0 or a negative integer
- **THEN** the system returns HTTP `400` and performs no datastore query

#### Scenario: Page size exceeds the maximum

- **WHEN** `pageSize` is 10001 or greater
- **THEN** the system returns HTTP `400` and performs no datastore query

#### Scenario: Page size is fractional

- **WHEN** `pageSize` is a fractional value such as 1.5
- **THEN** the system returns HTTP `400` and performs no datastore query

#### Scenario: Page size is non-numeric

- **WHEN** `pageSize` is a non-numeric string such as `abc` or is empty
- **THEN** the system returns HTTP `400` and performs no datastore query

### Requirement: The store honors export size up to 10000 without altering the list query

The datastore SHALL provide an export read mode whose maximum is the contractual 10000, returning up
to the validated `pageSize` rows after the mandatory tenant and exact-workspace scope predicates. The
export mode SHALL NOT change the audit-records list query path, which SHALL keep its page-size maximum
of 200. Both modes SHALL retain the mandatory tenant scope and SHALL never return a cross-tenant row.

#### Scenario: Export mode returns beyond the list cap

- **WHEN** an authorized export with `pageSize` up to 10000 has enough matching rows in the authorized
  scope
- **THEN** the store returns up to that many rows and does not truncate the export to 200

#### Scenario: List cap is preserved

- **WHEN** a caller uses the audit-records list route regardless of any export change
- **THEN** the list query still returns no more than 200 records per page

#### Scenario: Export mode retains mandatory scope

- **WHEN** the export store path runs for a workspace export or is invoked without a resolved tenant
- **THEN** it retains both the owning-tenant and exact-workspace predicates for a workspace export and
  executes no unscoped SELECT when a tenant is absent

### Requirement: Invalid export requests never reach the datastore and contractual errors are never swallowed

The system SHALL complete scope binding, `format`, `pageSize`, and any window validation before any
audit datastore query. A contractual validation failure SHALL return a coded HTTP `400` and SHALL NOT
be silently coerced, defaulted, truncated, or converted into a successful export. An operational
datastore failure SHALL NOT be reported as an empty successful export.

#### Scenario: Invalid format performs no datastore call

- **WHEN** an export request has a missing or unsupported `format`
- **THEN** the system returns HTTP `400` and the audit datastore is not queried

#### Scenario: Invalid page size performs no datastore call

- **WHEN** an export request has a `pageSize` outside 1 through 10000 or not an integer
- **THEN** the system returns HTTP `400` and the audit datastore is not queried

#### Scenario: Contractual error is not converted to a successful export

- **WHEN** an export request fails contractual validation whether or not the primary export builder is
  available
- **THEN** the system returns the coded HTTP `400` from the shared normalization and never returns a
  successful fallback manifest for that invalid request

#### Scenario: Operational failure is not masked as an empty export

- **WHEN** the audit datastore is unavailable for an otherwise valid authorized export
- **THEN** the system surfaces the operational error under the established route policy and does not
  return an empty successful export in place of it

### Requirement: Principal and fallback export paths share one normalized request and masking

The system SHALL pass one normalized request — the validated `format`, the export page limit, the
resolved scope, and the masking profile — to both the principal export builder and the inline
fallback. Both paths SHALL mask through the profile so that no unmasked credential-material or
provider-locator value appears in any successful export body, and the fallback SHALL be no less
conservative than the principal. Both paths SHALL keep the C-01 `AuditExportManifest` shape and the
`AuditExportedRecord` item projection.

#### Scenario: Fallback receives the identical normalized request

- **WHEN** the principal export builder is unavailable and the inline fallback is selected for a valid
  authorized request
- **THEN** the fallback uses the same validated `format`, export limit, resolved scope, and masking
  profile as the principal path would have used

#### Scenario: Principal path masks sensitive detail

- **WHEN** an authorized export includes records carrying credential-material or provider-locator
  fields and the principal builder produces the manifest
- **THEN** those fields are masked and no unmasked sensitive value appears in the export body

#### Scenario: Fallback path masks at least as much

- **WHEN** the inline fallback produces the manifest for the same records
- **THEN** it masks at least the fields the principal masks, exposing no unmasked sensitive value, and
  may be more conservative

#### Scenario: Manifest stays C-01 conformant on both paths

- **WHEN** either the principal or the fallback path returns a successful export
- **THEN** the manifest includes the required `exportId`, `queryScope`, `format`, `maskingProfileId`,
  `correlationId`, `generatedAt`, `appliedFilters`, `itemCount`, `maskedItemCount`, and `items`, and
  each item keeps the `AuditExportedRecord` projection

### Requirement: Audit export stays read-only and isolation-safe across constrained and adversarial personas

The audit export SHALL perform no application-data write, domain-audit write, artifact or export
persistence, domain event, quota mutation, or permission change. P1, P4, and P10 SHALL receive the
corrected export within their existing authorized scope. A constrained P10 viewer or developer without
the export permission SHALL retain its existing denial. P12 machine callers SHALL be bound by the same
contract. P13 SHALL receive no foreign record, count, existence signal, or masked value through a
foreign path scope or a body naming a foreign scope. Authorization denial SHALL be evaluated in the
existing order, before body, `format`, or `pageSize` validation.

#### Scenario: Successful export performs no write

- **WHEN** an authorized audit export succeeds with records or an empty page
- **THEN** the system performs only bounded read and masking activity plus normal request telemetry
  and invokes no application write, domain-audit writer, quota mutation, domain event, or export
  persistence

#### Scenario: P10 exports within an allowed scope

- **WHEN** a P10 workspace auditor with the existing audit-export permission posts a valid export
  within its allowed scope
- **THEN** it receives the corrected read-only export and gains no write, persistence, permission, or
  cross-scope capability

#### Scenario: Constrained persona without export permission is denied

- **WHEN** a constrained P10 viewer or developer without the audit-export permission posts an export
- **THEN** the existing denial remains in force and the corrected contract does not grant access

#### Scenario: P13 targets a foreign path scope

- **WHEN** P13 posts to another tenant's or workspace's audit-export route
- **THEN** the existing authorization boundary denies the request without querying or exposing foreign
  audit state

#### Scenario: Cross-tenant denial precedes request validation

- **WHEN** P13 targets a foreign path scope with a request that also has a missing or invalid `format`
  or `pageSize`
- **THEN** the authorization denial occurs first, before body validation and before any datastore
  call, and reveals no format or page-size validation signal

### Requirement: The console sends a contract-valid export request

The console export client SHALL send an explicit `format` defaulting to `jsonl` and an explicit
`pageSize` defaulting to 500, together with the default masking profile and its existing filter
controls, so that an authorized console export satisfies the required-format and bounded-page-size
contract.

#### Scenario: Console serializes an explicit format and page size

- **WHEN** the console triggers an audit export
- **THEN** the request body carries `format` equal to `jsonl` and `pageSize` equal to 500

#### Scenario: Console uses the default masking profile

- **WHEN** the console triggers an audit export without a chosen masking profile
- **THEN** the request uses the contract default masking profile

#### Scenario: Console export is accepted by the required-format contract

- **WHEN** an authorized console export request reaches the API
- **THEN** it is not rejected for a missing `format`, because the console supplies an explicit
  `format`

### Requirement: Internal contract, OpenAPI, and runtime remain aligned on the export surface

The system SHALL keep the canonical internal audit-export contract, both OpenAPI operation request
schemas, the runtime request normalization, the datastore export mode, and the manifest response
schema aligned on the same required `format` enum (`jsonl`, `csv`), `pageSize` default 500 and range 1
through 10000, and `AuditExportManifest`/`AuditExportedRecord` shapes. Neither route SHALL declare a
request field its runtime ignores nor enforce a bound its contract does not declare.

#### Scenario: Tenant and workspace export operations are compared

- **WHEN** contract tests inspect `exportTenantAuditRecords` and `exportWorkspaceAuditRecords`
- **THEN** both operations expose equivalent request semantics whose required `format`, `pageSize`
  default and range, and manifest shape match the canonical internal contract

#### Scenario: Runtime normalization uses the contractual default and maximum

- **WHEN** the runtime normalizes an export request
- **THEN** it derives the default page size of 500 and the maximum of 10000 from the contractual
  source rather than a divergent local constant

#### Scenario: Malformed-input rejection remains bounded

- **WHEN** an export request with a missing or invalid `format` or `pageSize` returns HTTP `400`
- **THEN** it uses the existing coded handler 4xx response and the datastore was not invoked; this
  change makes no claim that the response conforms to the global `ErrorResponse`, whose alignment is
  the separate C-02 repair
