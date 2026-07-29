# Change: Fix async-operation list status-array filtering

## Why

C-13 / OBS-CONTRACT-13 is a confirmed operation-list filtering defect. The console reconnect sync
sends `filters.status: ['running', 'pending']` as a single array in one `list` query
(`apps/web-console/src/lib/hooks/use-reconnect-state-sync.ts`), but the repository binds that array
as a scalar equality. `listOperations` pushes `params.status` as one bound value and builds
`status = $n`, so PostgreSQL compares the text `status` column against a serialized array literal
(`{running,pending}`) that no single row value can equal. The active-operations sync therefore
silently returns an empty set even when pending and running operations exist.

The finding was independently reproduced live twice without mutation on the audited revision:
`list` with scalar `status: "completed"` returned `1`; with array `status: ["completed"]` returned
`0` for the same value; and `status: ["running", "pending"]` returned `0`. The scalar positive
control worked. The same binding is present on base `faf797c6`:
`packages/provisioning-orchestrator/src/repositories/async-operation-query-repo.mjs` pushes the raw
`params.status` and constructs `status = $n`, while
`apps/web-console/src/lib/console-operations.ts` already declares the request filter type as
`status?: OperationStatus | OperationStatus[]`, so an array is an accepted client input shape.

The defect blocks the workspace operator / application DevOps persona (P9) whose console cannot
recover its in-flight operation state after a reconnect. Platform operators (P3) who list
operations by more than one status are adjacent, a constrained scoped viewer/auditor (P10) must
keep the same read-only tenant boundary, and an actor from another tenant (P13) is the adversarial
isolation and injection control.

## What Changes

- Normalize the `status` filter inside
  `packages/provisioning-orchestrator/src/repositories/async-operation-query-repo.mjs` so it
  supports both a scalar status value and an array of status values in a single query.
- Keep a scalar status value bound as `status = $n` equality, preserving the current behavior and
  SQL shape.
- Bind a non-empty status array as a single parameterized membership predicate
  (`status = ANY($n::text[])`) so the query returns the union of rows whose status is in the array.
  A singleton array is equivalent to the scalar form, and array order and duplicate values do not
  change the selected set.
- Treat an empty status array as a constant-false predicate that selects the empty set. The empty
  array SHALL NOT be silently dropped and widened into an unfiltered list; it consumes no
  positional parameter, so downstream placeholder numbering stays aligned.
- Keep the status predicate composed with the tenant, workspace, and operation-type predicates by
  `AND`, and keep the `COUNT` and item `SELECT` queries built from the identical `WHERE` clause and
  the identical shared parameter values, with only pagination appended to the item query.
- Preserve the existing list response shape (`queryType`, `items`, `total`, `pagination`),
  `ORDER BY created_at DESC`, limit default/cap, and offset semantics. Only the status-filter
  semantics change.
- Preserve the console reconnect behavior: it continues to issue one `list` query per page carrying
  `status: ['running', 'pending']`, paginates as it does today, and consumes the returned union
  without being split into per-status queries or any UX redesign.
- Preserve authentication, tenant isolation, superadmin scope resolution, the existing single
  access-audit event, single structured completion log, correlation header, and single query
  metrics observation per request, and read-only `POST` query semantics.
- Replace mock-only coverage as the binding proof with a real-PostgreSQL regression through the
  repository and action that exercises scalar, singleton, multi-status, reordered, duplicated, and
  empty status filters, plus a unit assertion of the emitted SQL shape, a frontend reconnect
  regression, and the existing reconnect contract test.
- Update only the existing console operations polling reference that directly describes list
  filtering and the reconnect sync.

## Personas and Observable Outcomes

- P9 regains reconnect recovery: after the fix, the active-operations sync returns the union of the
  caller's `pending` and `running` operations instead of an empty set, so the reconciliation delta
  reflects real in-flight work.
- P3 can list operations filtered by more than one status in a single query and receives every row
  whose status is in the requested set, with a `total` that matches that same set.
- P10 remains read-only and tenant-scoped. A multi-status array filter still evaluates under the
  caller's verified tenant predicate, adds no mutation, quota, or cross-tenant capability, and an
  empty array returns an empty tenant-scoped set rather than another tenant's rows.
- P13 cannot use the array to escape isolation or inject SQL. Array elements are bound parameters,
  never interpolated; the status predicate is always `AND`-composed with the tenant predicate; and
  an empty array cannot widen the result beyond the empty set.
- Backend maintainers can prove against real PostgreSQL that a singleton array equals the scalar
  filter, that array order and duplicates do not change the set, and that an empty array selects no
  rows.

## Non-Goals

- No C-12 status-vocabulary reconciliation. Status values are treated as opaque text for
  membership; this change adds no status enum, no `cancelling`/`timed_out`/`cancelled` validation,
  and no canonical-enum generation.
- No C-11 result-schema, migration, or lifecycle change, and no new or altered database migration,
  column, index, constraint, trigger, backfill, or default.
- No C-14 authorization redesign. The operation-read authorization boundary, roles, scopes, and the
  superadmin cross-scope behavior are unchanged.
- No C-17 malformed-identifier handling change.
- No public OpenAPI, route-catalog, gateway-policy, SDK, or generated-contract change. The
  scalar-or-array request shape is already an accepted client input; C-13 repairs only the runtime
  binding of the array.
- No new list filter, sort option, cursor, or pagination model, and no change to `ORDER BY`,
  limit/offset semantics, or the response envelope.
- No web-console route, page, component, polling cadence, interaction, copy, accessibility, or
  visual redesign. The reconnect hook keeps issuing a single array-status query.
- No authentication, audit, logging, metrics, or telemetry redesign, and no new audit or telemetry
  field.
- No remediation of any audit finding other than C-13.
- No shared, staging, or production deployment, no Helm/chart change, no Docker environment startup,
  no Kubernetes access, and no loop-state or audit-evidence change.

## Exit Criteria

- A scalar `status` value produces the unchanged `status = $n` equality predicate and the same rows
  as before.
- A non-empty `status` array produces a single parameterized membership predicate and returns the
  union of rows whose status is in the array; a singleton array returns exactly the scalar result;
  and reordering or duplicating array values does not change the selected set.
- An empty `status` array selects the empty set with `total` `0`, echoes the requested pagination,
  and does not widen the query into an unfiltered list.
- The status predicate is `AND`-composed with the tenant, workspace, and operation-type predicates,
  and the `COUNT` and item `SELECT` queries share the identical `WHERE` clause and identical shared
  parameter values, differing only by appended pagination.
- The list response shape, `created_at DESC` ordering, limit default/cap, and offset behavior are
  unchanged, and the scalar path is byte-for-byte compatible.
- Array values are bound parameters and never interpolated; a status value containing SQL
  metacharacters is treated as literal data and matches nothing outside its literal set.
- The reconnect sync still issues one `list` query per page with `status: ['running', 'pending']`,
  and after the fix that query returns the caller's pending and running operations.
- Non-superadmin callers remain tenant-scoped with an array filter, a cross-tenant caller receives
  no foreign rows, superadmin scope resolution is unchanged, and missing/untrusted identity remains
  unauthorized.
- The successful list query retains its correlation header, `console.async-operation.accessed`
  access audit, `async_operation_query_completed` log, and query metrics, emitting exactly one of
  each per request regardless of the number of statuses, with no raw or new fields.
- The real-PostgreSQL regression proves scalar/singleton/multi/reordered/duplicated/empty behavior
  against actual rows; the unit test asserts the emitted SQL shape and parameter numbering; and the
  dedicated real-PG command fails rather than skips when no database URL is configured.
- The focused console operations polling reference documents the scalar/array/empty-array list
  filtering semantics and the reconnect union behavior.
- `openspec validate fix-c13-async-status-array --strict` passes.

## Risks and Rollback

The primary correctness risk is the array binding and cast. node-postgres must bind a JavaScript
array as a PostgreSQL `text[]` for `status = ANY($n::text[])`; a mock that only string-matches SQL
cannot prove this. The regression therefore runs against real PostgreSQL and asserts the union,
singleton equality, and set-invariance to order and duplicates on actual rows.

The second risk is placeholder numbering. The empty-array false predicate must not consume a bound
parameter, and any status predicate must keep the shared `WHERE` clause and values identical for
`COUNT` and `SELECT`, or the two queries would filter differently or bind the wrong positions. A
unit test asserts the emitted predicate and parameter positions, and the real-PostgreSQL test
asserts that `total` matches the item set.

The third risk is accidental widening of the empty-array case. Because an empty JavaScript array is
truthy, a naive guard would keep it as a filter or drop it entirely; either mistake could return an
unfiltered or mis-scoped list. The change specifies an explicit constant-false predicate and tests
that an empty array under a tenant scope returns an empty tenant-scoped set.

The fourth risk is a per-status fan-out. An implementer must not satisfy membership by issuing one
query or emitting one audit/log/metric side effect per status value; the change keeps a single
query and single set of side effects per request and tests this invariant.

Rollback is a revert of the repository normalization, the focused tests, and the documentation
note. There is no schema, datastore, migration, or contract change to reverse, and reverting simply
reintroduces the C-13 scalar-binding behavior.
