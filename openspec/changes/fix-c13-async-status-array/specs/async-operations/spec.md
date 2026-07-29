# async-operations — spec delta for fix-c13-async-status-array

## ADDED Requirements

### Requirement: Operation list status filter supports scalar and array membership

The operation list query SHALL accept the `status` filter as either a scalar status value or an
array of status values in a single query. A scalar value SHALL be bound as `status = $n` equality,
preserving the current behavior. A non-empty array SHALL be evaluated as set membership through a
single parameterized predicate (`status = ANY($n::text[])`) so the query returns the union of rows
whose status is any element of the array. A singleton array SHALL select exactly the same rows as
its scalar value, and array element order and duplicate values SHALL NOT change the selected set.
Status values SHALL be treated as opaque text for membership and SHALL NOT be validated against a
status enum by this change.

#### Scenario: Scalar status preserves equality

- **WHEN** a P3 or P9 caller lists operations with scalar `status: "completed"`
- **THEN** the query binds `status = $n` and returns the same completed operations and `total` as
  the current scalar behavior

#### Scenario: Multi-status array returns the union

- **WHEN** a caller lists operations with `status: ["running", "pending"]`
- **THEN** a single query returns every operation whose status is `running` or `pending` under the
  same response shape, ordering, and pagination

#### Scenario: Singleton array equals the scalar

- **WHEN** a caller lists operations with `status: ["completed"]`
- **THEN** the returned rows and `total` are identical to the scalar `status: "completed"` request

#### Scenario: Order and duplicates do not change the set

- **WHEN** a caller lists operations with `["running", "pending"]`, `["pending", "running"]`, or
  `["running", "running", "pending"]`
- **THEN** each request returns the same set of rows and the same `total`, independent of element
  order and duplicates

### Requirement: Empty status array selects the empty set

An empty `status` array SHALL be translated into a constant-false predicate that selects the empty
set. The empty array SHALL NOT be dropped, treated as an omitted status filter, or otherwise widen
the query to additional statuses, and the false predicate SHALL consume no positional parameter.
The empty-array request SHALL remain scoped by the caller's tenant, workspace, and operation-type
predicates and SHALL echo the requested pagination.

#### Scenario: Empty array returns no rows

- **WHEN** a P10 caller lists operations with `status: []`
- **THEN** the query returns no operations, `total` is `0`, and the requested pagination is echoed

#### Scenario: Empty array does not widen the list

- **WHEN** a caller supplies `status: []` while operations of other statuses exist in the caller's
  tenant
- **THEN** the response remains empty and the status filter is not silently omitted to return an
  unfiltered list

#### Scenario: Empty array stays tenant-scoped

- **WHEN** a non-superadmin caller supplies `status: []`
- **THEN** the constant-false predicate is `AND`-composed with the tenant predicate, so the result
  is an empty tenant-scoped set and never another tenant's rows

### Requirement: Status filter is parameterized and composed by AND

The status predicate SHALL be built only from bound parameters, and array values SHALL be bound as
a text array rather than interpolated into SQL. The status predicate SHALL be `AND`-composed with
the tenant, workspace, and operation-type predicates. Placeholder numbering SHALL remain consistent
across all predicates, including when an empty-array false predicate that consumes no parameter
precedes a workspace or operation-type filter.

#### Scenario: Array values are bound, not interpolated

- **WHEN** a P13 caller supplies a status array whose values contain SQL metacharacters or
  injection-like text
- **THEN** the values are bound parameters treated as literal data, match nothing outside their
  literal set, and cannot alter the query structure

#### Scenario: Status combines with tenant, workspace, and type

- **WHEN** a caller lists operations with a status array together with a workspace and an
  operation-type filter under a tenant scope
- **THEN** the query selects only rows that satisfy the tenant predicate `AND` the workspace
  predicate `AND` the operation-type predicate `AND` status membership

#### Scenario: Placeholder numbering is preserved

- **WHEN** an empty status array is combined with a workspace or operation-type filter
- **THEN** the empty-array false predicate consumes no positional parameter and the remaining
  filters bind to correctly numbered placeholders

### Requirement: List count and item queries share one predicate and value set

The list `COUNT` query and the item `SELECT` query SHALL be built from the identical `WHERE` clause
and the identical shared parameter values, with only the pagination parameters appended to the item
query. The `total` SHALL be computed over the same filtered set as the returned `items`.

#### Scenario: Total matches the filtered items

- **WHEN** a caller lists operations with any scalar, array, or empty-array status filter under a
  tenant, workspace, and type scope
- **THEN** the `COUNT` and item `SELECT` carry the same status and scope predicates and the same
  shared parameters, and `total` reflects the same set that `items` is paginated from

#### Scenario: Pagination applies only to items

- **WHEN** a caller lists operations with a status array and a limit smaller than the matching set
- **THEN** `items` is bounded by the limit and offset while `total` reports the full matching count
  for the same predicate

### Requirement: List response shape, ordering, and pagination are unchanged

Only the `status`-filter semantics change. The list response SHALL keep its
`{ queryType, items, total, pagination }` shape and per-item projection, SHALL keep
`ORDER BY created_at DESC`, and SHALL keep the current limit default and cap and offset behavior.
The scalar status path SHALL remain byte-for-byte compatible.

#### Scenario: Ordering is preserved

- **WHEN** a caller lists operations with a status array
- **THEN** the returned operations are ordered by `created_at` descending exactly as before

#### Scenario: Limit and offset behavior is preserved

- **WHEN** a caller lists operations with a status array and a limit above the cap or a negative
  offset
- **THEN** the limit is normalized to the existing cap and default and the offset is floored,
  unchanged from current behavior

#### Scenario: Scalar path stays compatible

- **WHEN** an existing scalar-status caller lists operations
- **THEN** the emitted status predicate and response are identical to the current behavior

### Requirement: Console reconnect issues a single array-status query

The console reconnect state sync SHALL submit its `status` array through the existing single list
query path per page without a frontend redesign or response-contract change. It SHALL NOT be split
into one query per status value, and the client filter type SHALL keep allowing a scalar status or
a status array.

#### Scenario: Reconnect sends one array query

- **WHEN** the P9 reconnect sync runs
- **THEN** it issues one `list` request per page carrying `status: ['running', 'pending']` and does
  not issue a separate request per status value

#### Scenario: Reconnect recovers active operations

- **WHEN** the P9 reconnect sync queries active operations after the fix
- **THEN** the response returns the union of the caller's `pending` and `running` operations and the
  reconciliation delta reflects real in-flight work instead of an empty set

#### Scenario: Client filter type is preserved

- **WHEN** the console builds a list request filter
- **THEN** the `status` filter still accepts either a scalar status or a status array with no
  contract change

### Requirement: Status filtering preserves authentication, isolation, and side effects

The list query SHALL preserve current caller-context validation, tenant resolution, superadmin
scope behavior, and missing/untrusted-identity handling for every scalar, array, singleton, and
empty status form. A status array SHALL only ever add an `AND` term and SHALL NOT remove or bypass
the tenant predicate. A successful list request SHALL emit exactly one existing access-audit event,
one structured completion log, one correlation header, and one query-metrics observation,
regardless of the number of statuses, and SHALL NOT introduce a per-status-value side effect or
label. The operation SHALL remain a read-only query that performs no write and consumes no quota.

#### Scenario: Non-superadmin stays tenant-scoped with an array

- **WHEN** a non-superadmin P9 or P10 caller lists operations with a status array
- **THEN** the query evaluates under the caller's verified tenant predicate and returns only that
  tenant's matching operations

#### Scenario: Cross-tenant caller sees no foreign rows

- **WHEN** a P13 caller from another tenant lists operations with any status form targeting rows
  outside its tenant
- **THEN** the tenant predicate prevents disclosure and no foreign operation, count, or existence
  detail is returned

#### Scenario: Superadmin scope is unchanged

- **WHEN** a superadmin lists operations with a status array under the tenant resolution allowed by
  the current action
- **THEN** the existing superadmin scope behavior is retained with no new bypass or restriction

#### Scenario: Missing identity remains unauthorized

- **WHEN** a request lacks the trusted caller identity required by the action and supplies any
  status form
- **THEN** the action returns its existing unauthorized response and performs no query or write

#### Scenario: Side effects are per request, not per status

- **WHEN** a successful list request contains multiple, duplicated, or reordered statuses
- **THEN** the action emits exactly one access-audit event, one completion log, one correlation
  header, and one metrics observation, and performs no write or status-value-specific label

### Requirement: Regression proof uses real PostgreSQL through the repository and action

The C-13 acceptance proof SHALL run against actual PostgreSQL through the real repository and query
action and SHALL NOT rely on a SQL-string mock as evidence that the array binds and matches. It
SHALL cover scalar, singleton, multi-status, reordered, duplicated, and empty status filters, plus
`AND` composition and cross-tenant isolation, against real rows. A focused unit test MAY assert the
emitted SQL and parameter numbering for each status form but SHALL NOT be accepted as binding proof.
The dedicated real-PostgreSQL command SHALL fail rather than skip when neither `TEST_DATABASE_URL`
nor `DATABASE_URL` is configured.

#### Scenario: Real PostgreSQL proves membership semantics

- **WHEN** the real-PostgreSQL regression seeds operations across multiple statuses for a tenant and
  queries them through the repository and action
- **THEN** it proves scalar equality, singleton equivalence, multi-status union, order and duplicate
  invariance, and an empty-array empty set against actual rows

#### Scenario: Unit test asserts SQL shape

- **WHEN** the focused unit test exercises scalar, non-empty array, and empty array filters
- **THEN** it asserts `status = $n` for a scalar, a single parameterized `ANY` text-array predicate
  for a non-empty array, a constant-false predicate with no parameter for an empty array, and
  consistent placeholder numbering shared by the count and item queries

#### Scenario: Isolation control runs on the same schema

- **WHEN** the regression runs a cross-tenant control against the migrated PostgreSQL schema
- **THEN** a caller cannot read another tenant's operations with any status form and the tenant
  predicate remains `AND`-composed with the status predicate

#### Scenario: Dedicated command lacks a database URL

- **WHEN** the dedicated real-PostgreSQL command runs without `TEST_DATABASE_URL` or `DATABASE_URL`
- **THEN** it exits non-zero with a clear configuration error instead of reporting skipped tests
