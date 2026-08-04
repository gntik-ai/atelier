# Observability audit-record query — spec delta for fix-c09-audit-query-semantics

## ADDED Requirements

### Requirement: Tenant and workspace audit-record routes share one authorized query contract

The system SHALL expose the corrected query behavior through both
`GET /v1/metrics/tenants/{tenantId}/audit-records` and
`GET /v1/metrics/workspaces/{workspaceId}/audit-records`. Before interpreting continuation state
or querying audit rows, it SHALL authenticate the caller, resolve the path scope, and apply the
existing tenant or workspace audit-read authorization. It SHALL bind every datastore query to the
resolved tenant and, for the workspace route, the exact resolved workspace. This change SHALL NOT
add or alter a role, permission, membership, or authorization decision.

#### Scenario: Authorized tenant audit query

- **WHEN** a caller with the existing tenant audit-read permission requests the audit-records route
  for its resolved tenant
- **THEN** the system applies the normalized query inside that exact tenant and returns no row from
  another tenant

#### Scenario: Authorized workspace audit query

- **WHEN** a caller with the existing workspace audit-read permission requests the audit-records
  route for a resolved workspace
- **THEN** the system applies the normalized query with both the workspace's owning tenant and the
  exact workspace predicate and returns no tenant-wide or sibling-workspace row

#### Scenario: Existing permission is absent

- **WHEN** a caller requests either audit-records route without its existing required audit-read
  permission
- **THEN** the existing authorization denial is preserved and no audit-record query executes

### Requirement: All twelve audit filters use exact conjunctive semantics

The system SHALL accept the twelve public filters `filter[occurredAfter]`,
`filter[occurredBefore]`, `filter[subsystem]`, `filter[actionCategory]`, `filter[actionId]`,
`filter[outcome]`, `filter[actorType]`, `filter[actorId]`, `filter[resourceType]`,
`filter[resourceId]`, `filter[originSurface]`, and `filter[correlationId]` on both routes. Every
present filter SHALL be an exact predicate over the same canonical field returned in an audit
record, all present filters SHALL be combined with `AND`, and all SHALL be applied after the
mandatory authorized-scope predicates. String filters SHALL NOT be treated as partial matches,
case-folded aliases, regular expressions, SQL patterns, or scope authority.

#### Scenario: Occurred-after filter is applied

- **WHEN** an authorized caller supplies a valid `filter[occurredAfter]` timestamp
- **THEN** every returned record has `eventTimestamp` greater than or equal to that instant

#### Scenario: Occurred-before filter is applied

- **WHEN** an authorized caller supplies a valid `filter[occurredBefore]` timestamp
- **THEN** every returned record has `eventTimestamp` less than or equal to that instant

#### Scenario: Subsystem filter is applied

- **WHEN** an authorized caller supplies an allowed `filter[subsystem]` value
- **THEN** every returned record has exactly that canonical subsystem

#### Scenario: Action-category filter is applied

- **WHEN** an authorized caller supplies an allowed `filter[actionCategory]` value
- **THEN** every returned record has exactly that canonical action category

#### Scenario: Action-ID filter is applied

- **WHEN** an authorized caller supplies a valid free-form `filter[actionId]` value
- **THEN** every returned record has exactly that canonical action ID

#### Scenario: Outcome filter is applied

- **WHEN** an authorized caller supplies an allowed `filter[outcome]` value
- **THEN** every returned record has exactly that canonical public outcome

#### Scenario: Actor-type filter is applied

- **WHEN** an authorized caller supplies an allowed `filter[actorType]` value
- **THEN** every returned record has exactly that canonical actor type

#### Scenario: Actor-ID filter is applied

- **WHEN** an authorized caller supplies a valid free-form `filter[actorId]` value
- **THEN** every returned record has exactly that canonical actor ID

#### Scenario: Resource-type filter is applied

- **WHEN** an authorized caller supplies a valid free-form `filter[resourceType]` value
- **THEN** every returned record has exactly that canonical resource type

#### Scenario: Resource-ID filter is applied

- **WHEN** an authorized caller supplies a valid free-form `filter[resourceId]` value
- **THEN** every returned record has exactly that canonical resource ID

#### Scenario: Origin-surface filter is applied

- **WHEN** an authorized caller supplies an allowed `filter[originSurface]` value
- **THEN** every returned record has exactly that canonical origin surface

#### Scenario: Correlation-ID filter is applied

- **WHEN** an authorized caller supplies a valid free-form `filter[correlationId]` value
- **THEN** every returned record has exactly that canonical correlation ID

#### Scenario: Filters are combined

- **WHEN** an authorized caller supplies two or more valid filters
- **THEN** every returned record satisfies every supplied filter within the authorized scope and
  the system does not apply union or fallback semantics

#### Scenario: Valid free-form value has no match

- **WHEN** an authorized caller supplies a syntactically valid free-form action, actor, resource,
  or correlation value that matches no row in the authorized scope
- **THEN** the system returns HTTP `200` with `items: []`, `page.size: 0`, `page.hasMore: false`, no
  `page.nextCursor`, and the unmatched canonical filter in `appliedFilters`

### Requirement: Enumerated filters use one contractual allowlist

The system SHALL validate enumerated filter values before datastore access. `subsystem` SHALL
accept exactly `iam`, `postgresql`, `mongodb`, `kafka`, `openwhisk`, `storage`, `quota_metering`,
`tenant_control_plane`, and `mcp`. `actionCategory` SHALL accept exactly `resource_creation`,
`resource_deletion`, `configuration_change`, `access_control_modification`, `quota_adjustment`,
`privilege_escalation`, `secret_rotation`, `policy_override`, `backup_restore`, and
`provider_reconciliation`. `outcome` SHALL accept exactly `succeeded`, `failed`, `denied`,
`partial`, and `accepted`. `actorType` SHALL accept exactly `platform_user`, `tenant_user`,
`workspace_user`, `service_account`, `system`, and `provider_adapter`. `originSurface` SHALL accept
exactly `control_api`, `console_backend`, `internal_reconciler`, `provider_adapter`,
`bootstrap_job`, and `scheduled_operation`.

#### Scenario: Enumerated value is allowed

- **WHEN** a caller supplies a filter value present in that filter's canonical allowlist
- **THEN** the system preserves the canonical value and may execute the authorized datastore query

#### Scenario: Enumerated value is unknown

- **WHEN** a caller supplies a subsystem, action category, outcome, actor type, or origin surface
  outside its canonical allowlist
- **THEN** the system returns HTTP `400` before any datastore call and does not reinterpret the
  value as a free-form match

### Requirement: Audit query input is validated before the datastore

The system SHALL treat omitted `page[size]` as 25 and SHALL otherwise require one unambiguous
base-10 integer from 1 through 200 inclusive. It SHALL treat omitted `sort` as
`-eventTimestamp` and SHALL otherwise accept only `eventTimestamp` or `-eventTimestamp`. Supplied
time bounds SHALL be complete RFC 3339 date-times, and `occurredAfter` SHALL be less than or equal
to `occurredBefore` when both are supplied. It SHALL strictly validate a supplied `page[after]`
cursor's base64url encoding, bounded versioned object shape, position, and query compatibility.
Any validation failure SHALL return HTTP `400` before datastore access and SHALL NOT be silently
clamped, defaulted, ignored, or converted into an empty HTTP `200`.

#### Scenario: A supported query control is repeated

- **WHEN** a caller supplies `page[size]`, `page[after]`, `sort`, or any declared `filter[*]`
  parameter more than once in the raw HTTP query
- **THEN** the system returns HTTP `400` before any datastore call rather than choosing a value
  from an ambiguous representation

#### Scenario: A declared filter is present but empty

- **WHEN** a caller supplies an empty timestamp, enum, or free-form `filter[*]` value
- **THEN** the system returns HTTP `400` before any datastore call rather than treating the filter
  as omitted and widening the query

#### Scenario: Query parameters are omitted

- **WHEN** an authorized first-page request omits `page[size]`, `sort`, all filters, and
  `page[after]`
- **THEN** the datastore query uses a page size of 25 and total descending timestamp order

#### Scenario: Page size is valid at either bound

- **WHEN** an authorized caller supplies integer `page[size]` equal to 1 or 200
- **THEN** the system uses that requested bound without clamping it

#### Scenario: Page size is not an integer in range

- **WHEN** `page[size]` is zero, negative, greater than 200, fractional, non-numeric, empty, or
  repeated ambiguously
- **THEN** the system returns HTTP `400` and performs no datastore query

#### Scenario: Sort is invalid

- **WHEN** `sort` is empty, repeated ambiguously, or differs from `eventTimestamp` and
  `-eventTimestamp`
- **THEN** the system returns HTTP `400` and performs no datastore query

#### Scenario: Timestamp is not RFC 3339

- **WHEN** either time filter is not a complete valid RFC 3339 date-time
- **THEN** the system returns HTTP `400` and performs no datastore query

#### Scenario: Time window is reversed

- **WHEN** valid `filter[occurredAfter]` is later than valid `filter[occurredBefore]`
- **THEN** the system returns HTTP `400` and performs no datastore query

#### Scenario: Time bounds differ below millisecond precision

- **WHEN** valid RFC 3339 bounds use four through nine fractional digits
- **THEN** the system preserves their precision for comparison and SQL binding, and rejects a
  sub-millisecond reversed window before the datastore

#### Scenario: Cursor encoding or shape is invalid

- **WHEN** `page[after]` is not valid base64url JSON, exceeds the supported bounded shape, has an
  unsupported version, omits a required position/fingerprint field, adds an unexpected field, or
  contains a malformed timestamp or ID position
- **THEN** the system returns HTTP `400` and performs no datastore query

#### Scenario: Cursor event position is not a datastore UUID

- **WHEN** an otherwise compatible cursor contains a non-UUID event ID position
- **THEN** the system returns HTTP `400` before PostgreSQL can evaluate the keyset tuple

### Requirement: Sorting is total and deterministic

The system SHALL map public `eventTimestamp` order to the stored pair `(created_at, id)`. For
`eventTimestamp` it SHALL order both fields ascending; for `-eventTimestamp` it SHALL order both
fields descending. The event ID SHALL be the deterministic tie-breaker for records with equal
timestamps. The raw sort input SHALL NOT be interpolated into SQL.

#### Scenario: Descending order includes a timestamp tie

- **WHEN** a caller requests `sort=-eventTimestamp` and two visible records have the same
  timestamp but distinct event IDs
- **THEN** records are returned by `created_at DESC, id DESC`, with the higher ID first at the tie

#### Scenario: Ascending order includes a timestamp tie

- **WHEN** a caller requests `sort=eventTimestamp` and two visible records have the same timestamp
  but distinct event IDs
- **THEN** records are returned by `created_at ASC, id ASC`, with the lower ID first at the tie

#### Scenario: Sort direction changes

- **WHEN** the same static scoped and filtered dataset is requested once in each supported sort
  direction
- **THEN** the returned total order is reversed without changing the membership of the dataset

### Requirement: Cursor pagination uses versioned query-bound keyset state

The system SHALL encode `page[after]` as unpadded base64url JSON containing a supported version,
the last returned `(created_at, id)` position, and a deterministic fingerprint of the resolved
tenant/workspace query scope, canonical effective filters, and normalized sort. Page size SHALL
NOT be part of that fingerprint. The system SHALL compare the fingerprint with the newly
authorized and normalized request before using the position. A cursor SHALL be continuation state
only; it SHALL NOT authenticate a caller, authorize a scope, supply a missing scope, or remove a
mandatory scope/filter predicate.

#### Scenario: Descending continuation is applied

- **WHEN** a compatible descending cursor is supplied after a prior page
- **THEN** the datastore adds a strict `(created_at, id) < (cursor timestamp, cursor ID)` predicate
  and retains descending total order plus every authorized-scope and filter predicate

#### Scenario: Ascending continuation is applied

- **WHEN** a compatible ascending cursor is supplied after a prior page
- **THEN** the datastore adds a strict `(created_at, id) > (cursor timestamp, cursor ID)` predicate
  and retains ascending total order plus every authorized-scope and filter predicate

#### Scenario: Page size changes on continuation

- **WHEN** a caller uses a compatible cursor with a different valid `page[size]`
- **THEN** the system accepts the continuation because scope, filters, and sort are unchanged and
  applies the new page bound after the cursor position

#### Scenario: Cursor filter or sort is incompatible

- **WHEN** a cursor is replayed with any effective filter added, removed, or changed, or with the
  opposite sort direction
- **THEN** the system returns HTTP `400` before the datastore and does not reinterpret the cursor
  under the new query

#### Scenario: Cursor scope is incompatible

- **WHEN** a cursor minted for another tenant, workspace, or route scope is supplied on an
  otherwise authorized path
- **THEN** the system returns HTTP `400` before the datastore and exposes no record, count,
  position, or scope metadata from the cursor's original query

#### Scenario: Cursor is presented as proof of access

- **WHEN** a caller presents a structurally valid cursor but lacks authorization for the requested
  path scope
- **THEN** the existing authorization boundary denies the request before query continuation and
  the cursor grants no access

### Requirement: Page metadata is derived from limit-plus-one lookahead

The datastore SHALL select at most `page[size] + 1` ordered rows after all scope, filter, and
cursor predicates. It SHALL return at most `page[size]` items. It SHALL set `page.hasMore` true and
emit a `page.nextCursor` from the last returned item if and only if the lookahead row exists;
otherwise it SHALL set `page.hasMore` false and omit `page.nextCursor`. `page.size` SHALL equal the
number of items actually returned.

#### Scenario: Another page exists

- **WHEN** the bounded scoped query yields more than the requested page size
- **THEN** the response contains only the first requested number of rows, reports their count,
  sets `hasMore: true`, and emits a cursor positioned at the last returned row rather than the
  lookahead row

#### Scenario: Exact full page is terminal

- **WHEN** the bounded scoped query yields exactly the requested page size and no lookahead row
- **THEN** the response includes all rows, sets `hasMore: false`, and omits `nextCursor`

#### Scenario: Partial or empty page is terminal

- **WHEN** the bounded scoped query yields fewer rows than requested, including zero
- **THEN** `page.size` equals the returned row count, `hasMore` is false, and `nextCursor` is absent

#### Scenario: Multiple pages contain tied timestamps

- **WHEN** an authorized caller traverses multiple pages of a static dataset whose page boundary
  contains equal timestamps
- **THEN** every matching event appears once in total `(created_at, id)` order with no duplicate or
  skipped event across pages

#### Scenario: Adjacent rows differ below millisecond precision

- **WHEN** matching rows have PostgreSQL timestamps in the same millisecond but different
  microseconds and the caller traverses either sort direction
- **THEN** the public `eventTimestamp` and cursor preserve each row's database timestamp precision,
  and continuation returns every row exactly once without a gap or duplicate

### Requirement: SQL construction keeps scope and values literal-safe

The datastore SHALL require resolved tenant scope, SHALL add an exact workspace predicate for a
workspace request, and SHALL express every optional filter and cursor value as a database-driver
parameter. SQL operators, canonical column/JSON expressions, tuple comparator, order direction,
and limit syntax SHALL be selected only from implementation-owned literals after validation. A
request value SHALL NOT appear in SQL text.

#### Scenario: SQL-like filter text is supplied

- **WHEN** an authorized caller supplies a valid free-form filter containing quotes, percent or
  underscore characters, comments, parentheses, or SQL keywords
- **THEN** the literal SQL statement remains unchanged, the full value appears only in the
  parameter array as an exact-match value, and scope cannot be widened

#### Scenario: All filters and a cursor are supplied

- **WHEN** a valid authorized request contains all twelve filters and a compatible cursor
- **THEN** captured SQL contains mandatory tenant/workspace predicates, twelve conjunctive
  implementation-owned filter predicates, one direction-correct tuple predicate, one literal
  total order, and a parameterized `page[size] + 1` limit

#### Scenario: Required tenant scope is absent at store boundary

- **WHEN** internal code attempts to invoke the audit store without a resolved tenant ID
- **THEN** the store returns no cross-tenant data and executes no unscoped SELECT

### Requirement: Successful responses expose canonical filter metadata

Every successful response SHALL include `items`, `page`, `queryScope`, `appliedFilters`,
`availableFilters`, and `consoleHints`. `availableFilters` SHALL contain exactly twelve entries
whose IDs are `occurred_after`, `occurred_before`, `subsystem`, `action_category`, `action_id`,
`outcome`, `actor_type`, `actor_id`, `resource_type`, `resource_id`, `origin_surface`, and
`correlation_id`, each paired with its canonical public parameter, type, label, and contractual
allowed values where applicable. `appliedFilters` SHALL contain only present effective filters
under those canonical IDs and their normalized string values.

#### Scenario: Unfiltered first page is returned

- **WHEN** an authorized valid request supplies no filter
- **THEN** `appliedFilters` is empty and `availableFilters` advertises all twelve canonical entries

#### Scenario: Filtered empty page is returned

- **WHEN** an authorized valid request applies filters but no row matches
- **THEN** the successful response retains every effective canonical filter in `appliedFilters`
  and still advertises all twelve `availableFilters`

#### Scenario: Non-filter query controls are present

- **WHEN** a valid request supplies page size, cursor, or sort
- **THEN** those controls affect query execution but are not misreported as entries in
  `appliedFilters`

### Requirement: Internal contract, OpenAPI, and runtime remain aligned

The system SHALL keep the canonical internal audit-query contract, both OpenAPI operation
parameter sets, runtime validation, datastore semantics, and response schemas aligned on the same twelve
filters, enum allowlists, RFC 3339 bounds, `page[size]` default 25 and range 1 through 200,
`page[after]` cursor, two sort values with descending default, deterministic pagination metadata,
and HTTP `400` invalid-input behavior. Neither route SHALL declare a query control that its runtime
ignores.

#### Scenario: Tenant and workspace OpenAPI operations are compared

- **WHEN** contract tests inspect `listTenantAuditRecords` and `listWorkspaceAuditRecords`
- **THEN** both operations expose equivalent query semantics and their enums/defaults/formats match
  the canonical internal contract

#### Scenario: Runtime success is schema-validated

- **WHEN** an unfiltered, filtered, empty, first-page, or continuation HTTP `200` body is validated
  against `AuditRecordCollectionResponse`
- **THEN** all required fields and truthful page metadata conform to the public schema

#### Scenario: Runtime validation failure is schema-validated

- **WHEN** a malformed page, sort, timestamp, enum, or cursor request returns HTTP `400`
- **THEN** its response conforms to the route's declared error contract and the datastore was not
  invoked

### Requirement: Console continuation is accessible and resistant to stale responses

The console SHALL preserve its existing Actor, Category, Result, From, and To controls and SHALL
send them through the corresponding public filters. It SHALL retain server-provided `hasMore` and
`nextCursor`, render a keyboard-focusable continuation button only when continuation is available,
and expose a programmatic name, busy/disabled state, and live status or error feedback. It SHALL
append only the active query's next page in server order. It SHALL reset accumulated records and
cursor on tenant/workspace, filter, sort, or explicit reload changes, and SHALL prevent stale or
overlapping responses from appending into a superseded query.

#### Scenario: User continues with keyboard or assistive technology

- **WHEN** the current audit response has `hasMore: true` and a non-empty `nextCursor`
- **THEN** P1, P10, or P4 can focus and activate the named continuation button, observe its busy
  state, and receive the next page appended with a live result-count update

#### Scenario: Terminal page is displayed

- **WHEN** the active response has `hasMore: false` and no `nextCursor`
- **THEN** the console does not offer a misleading continuation action

#### Scenario: Filter or scope changes during continuation

- **WHEN** a continuation is pending and the user changes one of the five controls or the active
  tenant/workspace changes
- **THEN** the console clears the old accumulated rows and cursor, begins a new first-page query,
  and ignores any late continuation response from the previous query

#### Scenario: Explicit reload occurs

- **WHEN** the user retries or reloads the current audit query
- **THEN** the console resets pagination and requests the first page for the current immutable
  scope/filter/sort identity

#### Scenario: Continuation is activated repeatedly

- **WHEN** a user activates continuation again while the same next-page request is in flight
- **THEN** the action remains disabled or the duplicate request is otherwise suppressed and no
  event is appended twice

#### Scenario: Continuation fails

- **WHEN** the next-page request fails for the active query
- **THEN** existing records remain available, an accessible error with retry is exposed, and the
  cursor is not advanced or replaced by stale state

### Requirement: Audit-record GET remains read-only across constrained and adversarial personas

The audit-record query SHALL remain a read-only GET. It SHALL perform no application-data write,
domain-audit write, cursor persistence, quota mutation, export creation, or permission change.
P10 SHALL retain only its existing constrained audit-read access. P4 SHALL gain no adjacent
permission. P13 SHALL receive no foreign record, count, event position, continuation token, filter
inference, or datastore side effect through first-page, replayed-cursor, forged-cursor, or
concurrent requests.

#### Scenario: P10 reads an allowed scope

- **WHEN** P10 has the existing audit-read permission and performs a valid first-page or
  continuation GET within its allowed scope
- **THEN** P10 receives the corrected read result and gains no write, export, permission, or
  cross-scope capability

#### Scenario: P4 is not authorized by an adjacent role

- **WHEN** P4 lacks the existing audit-read permission for the requested scope
- **THEN** the existing denial remains in force and the corrected query semantics do not grant
  access

#### Scenario: P13 requests a foreign path scope

- **WHEN** P13 supplies another tenant's tenant ID or workspace ID on a first-page or cursor request
- **THEN** the existing authorization boundary denies the request without querying or exposing
  foreign audit state

#### Scenario: P13 replays a foreign cursor on its own scope

- **WHEN** P13 supplies a cursor from another scope on a path it is authorized to read
- **THEN** cursor compatibility validation returns HTTP `400` before the datastore and reveals no
  foreign record, count, position, or filter information

#### Scenario: Successful GET is observed for writes

- **WHEN** an authorized audit-record GET succeeds with records, an empty page, or a continuation
- **THEN** the system performs only bounded read activity plus normal request telemetry and invokes
  no application write, domain-audit writer, quota mutation, export, or cursor store

#### Scenario: Invalid GET is observed for side effects

- **WHEN** an audit-record GET fails query validation
- **THEN** the system may record normal HTTP telemetry but invokes neither the audit datastore nor
  any write-side service
