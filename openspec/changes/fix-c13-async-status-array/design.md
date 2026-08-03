# Design: Async-operation list status-array filtering

## Context

`listOperations` in
`packages/provisioning-orchestrator/src/repositories/async-operation-query-repo.mjs` builds a list
query from a tenant predicate and optional `status`, `operationType`, and `workspaceId` filters. It
pushes each filter value onto a shared `values` array and appends a positional predicate. The
status branch is:

```js
if (params.status) {
  values.push(params.status);
  filters.push(`status = $${values.length}`);
}
```

The same `WHERE` clause and shared `values` already drive both the `COUNT` and the item `SELECT`;
the item query only appends `LIMIT`/`OFFSET`. The action
(`packages/provisioning-orchestrator/src/actions/async-operation-query.mjs`) passes
`params.filters?.status` straight through to the repository, and the console filter type already
allows `OperationStatus | OperationStatus[]`. When the reconnect sync sends
`status: ['running', 'pending']`, the array is bound as a single parameter and compared with scalar
equality, so PostgreSQL evaluates `status = '{running,pending}'` and returns no rows.

The defect is therefore a repository-boundary binding bug, not a contract, migration, or
authorization defect. The fix normalizes the status input at that one boundary while leaving the
scalar path, the shared count/select construction, ordering, pagination, the response shape, and
every cross-cutting behavior untouched.

## Goals

- Make a scalar status filter and an array status filter both correct in a single query.
- Preserve the scalar path exactly and make a singleton array equivalent to the scalar.
- Give a non-empty array set-membership semantics that ignore order and duplicates.
- Make an empty array select the empty set without widening the query.
- Keep the `COUNT` and `SELECT` queries built from one identical predicate and value set.
- Prove the binding against real PostgreSQL rather than a SQL-string mock.
- Preserve authentication, tenant isolation, superadmin scope, audit, logging, metrics, ordering,
  pagination, response shape, and read-only behavior.

## Non-Goals

- Reconciling or validating the status vocabulary (C-12); statuses are opaque text for membership.
- Any migration, column, index, constraint, trigger, backfill, or default change, or the C-11
  result schema.
- Any authorization, role, scope, or superadmin behavior change (C-14), or malformed-identifier
  handling (C-17).
- Any public OpenAPI, route-catalog, gateway, SDK, or generated-contract change.
- Any new filter, sort, cursor, or pagination model, or any change to `ORDER BY` or limit/offset.
- Any web-console redesign; the reconnect hook keeps its single array-status query.
- Any deployment, Helm/chart, Docker, or Kubernetes action.

## Decision 1: Normalize the status filter at the repository boundary

All status normalization lives in `listOperations`. The action continues to forward
`params.filters?.status` unchanged, so a single boundary owns the scalar-versus-array decision and
there is no second normalization site to drift.

The status branch resolves the provided value into exactly one of three predicate forms and appends
it to the shared `filters`/`values` builder used by both queries:

| Input `params.status` | Predicate appended | Parameter pushed |
| --- | --- | --- |
| A scalar status value | `status = $n` | the scalar value |
| A non-empty array of status values | `status = ANY($n::text[])` | the array value |
| An empty array | a constant-false predicate | none |
| Absent (`undefined`/`null`) | no status predicate | none |

An absent status continues to omit the predicate, so callers that pass no status still receive a
tenant/workspace/type-scoped list. A provided status is normalized as above; the change does not
alter the current handling of a non-array falsy value.

## Decision 2: Bind a non-empty array as parameterized text-array membership

A non-empty array is bound as a single parameter and compared with
`status = ANY($n::text[])`. node-postgres serializes the JavaScript array into a PostgreSQL array
literal, and the explicit `::text[]` cast fixes the parameter type so the driver does not have to
infer it and so `ANY` performs text membership against the `status` column. This yields:

- **Union semantics** — a row is selected when its status equals any element, so
  `['running', 'pending']` returns the union of running and pending rows.
- **Singleton equivalence** — `['completed']` selects exactly the rows that scalar `'completed'`
  selects.
- **Order and duplicate invariance** — `['a', 'b']`, `['b', 'a']`, and `['a', 'a', 'b']` select the
  same set, because membership is a set test.

`ANY($n::text[])` is the chosen safe form. An `IN (...)` expansion that pushes one parameter per
element was rejected because it complicates placeholder numbering shared with the count query and
offers no behavioral benefit. String-interpolating the values was rejected outright as an injection
risk. Statuses are not validated against an enum here; that is C-12, and binding them as text keeps
this change independent of the status vocabulary.

## Decision 3: Make an empty array an explicit false predicate

An empty JavaScript array is truthy, so the current `if (params.status)` guard would keep it and
bind `[]`, and a naive "drop falsy" rewrite would omit the status predicate and widen the list to
every status. Neither is acceptable: the empty array means "no status is acceptable", i.e. the
empty set.

The change appends an explicit constant-false predicate (for example `1 = 0`) for an empty array
and pushes no parameter. Because it consumes no positional parameter, the placeholders for any
later `operationType` and `workspaceId` filters remain correctly numbered. The false predicate is
still `AND`-composed with the tenant predicate, so an empty-array request stays tenant-scoped and
simply returns no rows with `total` `0`. The query is still executed (it is not short-circuited
before the database) so that the count and item paths remain symmetric and continue to echo the
requested pagination.

## Decision 4: Reuse one predicate and value set for COUNT and SELECT

The repository already constructs the `WHERE` clause and `values` once and passes `values` to the
count query and `[...values, limit, offset]` to the item query. The normalized status predicate is
appended to that same shared builder before either query is issued, so:

- both queries carry the identical status predicate and identical shared parameter values;
- only the item query appends the two pagination parameters; and
- `total` and `items` are computed over the same filtered set.

The implementation must not build a second `WHERE` clause or re-derive values for the count query.
A unit test asserts that the emitted count and item SQL carry the same status predicate and that the
parameter positions are consistent.

## Decision 5: Preserve ordering, pagination, response shape, and scalar compatibility

Only the status predicate semantics change. The item query keeps `ORDER BY created_at DESC`, the
limit normalization (default `20`, cap `100`), and the offset normalization (floored at `0`). The
action keeps returning `{ queryType: 'list', items, total, pagination }` with the existing per-item
projection. The scalar path stays byte-for-byte compatible, so existing scalar callers and the
current unit assertion of `status = $2` continue to hold.

## Decision 6: Preserve authentication, isolation, and single per-request side effects

The tenant predicate, superadmin scope resolution, and missing/untrusted-identity behavior are
unchanged. The status array is only ever an additional `AND` term; it cannot remove or bypass the
tenant predicate, so a non-superadmin caller stays scoped to its verified tenant and a cross-tenant
caller receives no foreign rows. A malicious status value is bound data and cannot alter the query.

The action continues to emit exactly one `console.async-operation.accessed` audit event, one
`async_operation_query_completed` log, one correlation header, and one query-metrics observation
per request. An implementation must not fan out into one query or one side effect per status value.
The operation stays a read-only `POST` query that performs no writes and touches no quota.

## Decision 7: Prove the fix against real PostgreSQL

A SQL-string mock cannot prove that node-postgres binds a JavaScript array as `text[]` or that
`ANY` performs membership; only real PostgreSQL can. The regression extends the existing real-PG
integration suite (`tests/integration/async-operation-query-integration.test.mjs`), which already
applies the real migrations into an isolated schema and is gated on `TEST_DATABASE_URL`/
`DATABASE_URL`. It seeds operations across multiple statuses for a tenant and asserts, through the
repository and the action:

- scalar `completed` returns the same set as before;
- `['completed']` returns exactly the scalar set (singleton equivalence);
- `['running', 'pending']` returns the union of running and pending rows;
- reordered and duplicated arrays return the same set and the same `total`;
- an empty array returns no rows and `total` `0` while staying tenant-scoped;
- the status predicate `AND`-composes with workspace and operation-type filters; and
- a cross-tenant caller cannot read another tenant's rows with any status form.

The dedicated command `scripts/run-async-operation-real-pg-tests.mjs` runs this suite in CI and
already fails rather than skips without a database URL, so the C-13 membership proof cannot silently
become a skipped test. Focused unit tests
(`tests/unit/async-operation-query-repo.test.mjs`) assert the emitted SQL and parameter numbering
for each status form, and remain valid only for SQL-shape assertions — not as binding proof.

## Decision 8: Keep the frontend and contract regressions honest

The reconnect hook already sends the array in one query, so no product frontend change is required.
The change adds/strengthens a regression in
`apps/web-console/src/lib/hooks/use-reconnect-state-sync.test.ts` asserting that the sync issues one
`list` request per page carrying `status: ['running', 'pending']` and does not split into per-status
queries, and preserves the existing tenant-isolation reconnect regression. The existing reconnect
contract test (`tests/contract/async-operation-query-reconnect.contract.test.mjs`) keeps asserting
the request shape and its current unauthorized-without-trusted-headers outcomes.

## Decision 9: Keep documentation bounded

Only `docs/reference/architecture/console-operations-polling.md` directly describes the list
polling and active-operation filtering behavior. It gains a focused note that the list `status`
filter accepts a scalar or an array, that an array selects the union (order/duplicate independent),
that an empty array selects the empty set, and that the reconnect sync uses a single
`['running', 'pending']` query to recover active operations. No API, SDK, UI-design, or unrelated
reference is changed.

## Rollout and Compatibility

The change is a pure code fix with no schema, datastore, migration, or contract change. Scalar
callers are unaffected. Array callers that previously received an empty set now receive the correct
union; because the old behavior returned nothing, there is no ambiguous prior data to reconcile.
The producer and reader are the same repository function, so there is no mixed-version ordering
concern.

Rollback reverts the repository normalization, the focused tests, and the documentation note, and
reintroduces the C-13 scalar-binding behavior. No data cleanup is required.

## Risks

- **Array binding/cast** — the driver must bind the array as `text[]`; proven on real PostgreSQL.
- **Placeholder drift** — the empty-array false predicate must not consume a parameter and the
  count/select predicate and values must stay identical; asserted by unit and integration tests.
- **Empty-array widening** — an empty array must select the empty set, not an unfiltered or
  mis-scoped list; asserted under a tenant scope.
- **Per-status fan-out** — membership must be one query with one set of side effects, not one per
  status value; asserted at the action boundary.
- **Isolation** — the status term must never displace the tenant predicate; asserted with a
  cross-tenant control.

## Open Questions

None are blocking. The status-vocabulary reconciliation tracked separately as C-12 and the
operation-read authorization surface tracked as C-14 remain deliberately out of scope.
