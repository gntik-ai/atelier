# Tasks: Fix async-operation list status-array filtering

## 1. Keep the change bounded to C-13

- [x] 1.1 Keep the proposal, design, and `async-operations` delta aligned with C-13 /
  OBS-CONTRACT-13 only: scalar-versus-array status filtering in the operation list query.
  - Paths: `openspec/changes/fix-c13-async-status-array/`.
- [x] 1.2 Do not change the status vocabulary (C-12), the async-operation result schema/migration
  (C-11), the operation-read authorization surface (C-14), malformed-identifier handling (C-17),
  any other audit finding, the public OpenAPI/route-catalog/SDK contract, or any migration, index,
  constraint, or default.
- [x] 1.3 Do not deploy, touch a cluster, or change Helm/chart, loop-state, or audit evidence. A
  disposable local PostgreSQL container may be used only for the focused integration suite and
  must be removed after the run.

## 2. Author the black-box acceptance first (TDD)

- [x] 2.1 Before changing the repository, add failing black-box coverage through the query action
  and the `listOperations` repository for scalar, non-empty array, singleton, reordered, duplicated,
  and empty status filters.
- [x] 2.2 Assert the intended semantics: scalar equality preserved; non-empty array returns the
  union; singleton array equals the scalar; order and duplicates do not change the set; empty array
  returns the empty set with `total` `0`.
- [x] 2.3 Assert the cross-cutting invariants up front: tenant/workspace/type `AND` composition,
  identical `COUNT`/`SELECT` predicate and shared values, unchanged ordering/pagination/response
  shape, and a single per-request audit/log/metrics side effect.

## 3. Normalize the status filter in the repository

- [x] 3.1 In
  `packages/provisioning-orchestrator/src/repositories/async-operation-query-repo.mjs`, normalize
  the `status` filter at the repository boundary so a scalar and an array are both handled in a
  single query. Keep the action forwarding `params.filters?.status` unchanged.
- [x] 3.2 Bind a scalar status value as `status = $n` equality, preserving the current SQL shape and
  rows.
- [x] 3.3 Bind a non-empty array as a single parameterized membership predicate
  (`status = ANY($n::text[])`, or an equally safe parameterized text-array equivalent) so the query
  returns the union; ensure a singleton array equals the scalar and that order and duplicates do
  not change the set.
- [x] 3.4 Translate an empty array into an explicit constant-false predicate that consumes no
  positional parameter and does not omit or widen the status filter.
- [x] 3.5 Append the normalized status predicate to the existing shared `filters`/`values` builder
  so the `COUNT` and item `SELECT` use the identical `WHERE` clause and identical shared parameter
  values, with only pagination appended to the item query.
- [x] 3.6 Keep the tenant/workspace/type `AND` composition, `ORDER BY created_at DESC`, the limit
  default/cap, offset flooring, and the `{ queryType, items, total, pagination }` response and
  per-item projection unchanged.
- [x] 3.7 Treat status values as opaque bound text; do not validate them against a status enum or
  interpolate any value into SQL.

## 4. Add unit and contract coverage for the SQL shape

- [x] 4.1 In `tests/unit/async-operation-query-repo.test.mjs`, retain the scalar `status = $n`
  assertion and add assertions that a non-empty array emits a single parameterized `ANY` text-array
  predicate and that an empty array emits a constant-false predicate with no bound parameter.
- [x] 4.2 Assert placeholder numbering is consistent when the status filter precedes workspace and
  operation-type filters, including the empty-array case that consumes no parameter.
- [x] 4.3 Assert the `COUNT` and item `SELECT` carry the identical status/scope predicate and shared
  parameter values, differing only by appended pagination.
- [x] 4.4 In `tests/contract/async-operation-query-reconnect.contract.test.mjs`, assert that the
  reconnect request carries `status: ['running', 'pending']` with trusted identity. Retain the
  unauthorized-without-trusted-headers outcome in the focused trusted-context black-box suite.

## 5. Prove binding and isolation on real PostgreSQL

- [x] 5.1 Extend `tests/integration/async-operation-query-integration.test.mjs` to seed operations
  across multiple statuses for a tenant in the existing isolated real-PostgreSQL schema and exercise
  the repository and action.
- [x] 5.2 Prove against real rows: scalar equality; singleton equivalence; multi-status union;
  reordered and duplicated arrays returning the same set and `total`; and an empty array returning
  no rows with `total` `0` while staying tenant-scoped.
- [x] 5.3 Prove `AND` composition of the status predicate with workspace and operation-type filters
  selects only rows satisfying all predicates, and that `total` matches the paginated item set.
- [x] 5.4 Add a cross-tenant control proving a caller cannot read another tenant's operations with
  any status form and that the tenant predicate stays `AND`-composed with status membership.
- [x] 5.5 Confirm the dedicated command `scripts/run-async-operation-real-pg-tests.mjs` exercises the
  C-13 cases and continues to fail (not skip) when neither `TEST_DATABASE_URL` nor `DATABASE_URL`
  is configured; keep mock-only tests as SQL-shape assertions, not binding proof.

## 6. Preserve authentication, isolation, audit, and metrics invariants

- [x] 6.1 Confirm caller-context validation, tenant resolution, superadmin scope behavior, and
  missing/untrusted-identity handling are unchanged for scalar, array, singleton, and empty status
  forms; add regression assertions where needed.
- [x] 6.2 Confirm a status array only ever adds an `AND` term and cannot remove or bypass the tenant
  predicate.
- [x] 6.3 Confirm a successful list request emits exactly one `console.async-operation.accessed`
  audit event, one `async_operation_query_completed` log, one correlation header, and one
  query-metrics observation regardless of the number of statuses, with no per-status side effect or
  label and no new audit/telemetry field.
- [x] 6.4 Confirm the operation remains a read-only query that performs no write and consumes no
  quota, and that unauthorized/forbidden requests keep their existing responses.

## 7. Verify the frontend reconnect behavior

- [x] 7.1 In `apps/web-console/src/lib/hooks/use-reconnect-state-sync.test.ts`, assert the sync
  issues one `list` request per page carrying the exact `status: ['running', 'pending']` array and
  is not split into per-status queries.
- [x] 7.2 Assert that after the fix the reconnect delta reflects the union of the caller's `pending`
  and `running` operations, and preserve the existing reconnect tenant-isolation regression.
- [x] 7.3 Confirm no console route, page, component, polling cadence, interaction, copy,
  accessibility, or visual change is introduced and that the client filter type keeps allowing a
  scalar status or a status array.

## 8. Update only directly relevant documentation

- [x] 8.1 Update `docs/reference/architecture/console-operations-polling.md` to document that the
  list `status` filter accepts a scalar or an array, that an array selects the union independent of
  order and duplicates, that an empty array selects the empty set, and that the reconnect sync uses
  a single `['running', 'pending']` query to recover active operations.
- [x] 8.2 Confirm no general API, SDK, UI-design, authentication, telemetry, installation, or
  unrelated reference document is changed.

## 9. Validate and review

- [x] 9.1 Run the focused async-operation query unit tests for scalar, array, singleton, empty, and
  SQL-shape/placeholder assertions.
- [x] 9.2 Run the focused real-PostgreSQL migration/repository/action suite with its database
  connection configured and record scalar, union, singleton, order/duplicate, empty, composition,
  and cross-tenant results.
- [x] 9.3 Run the reconnect contract test and the frontend reconnect regression.
- [x] 9.4 Run `openspec validate fix-c13-async-status-array --strict`.
- [x] 9.5 Run Markdown lint on the changed OpenSpec and the directly relevant documentation file,
  then run `git diff --check`.
- [x] 9.6 Review the final diff against `origin/codex-integration` and confirm it changes only the
  repository status normalization, the focused unit/contract/integration tests, the frontend
  reconnect regression, this OpenSpec package, and the single documentation reference.
- [x] 9.7 Confirm C-12, C-11, C-14, C-17, other findings, contract/migration changes, live
  deployment, and Kubernetes access remain excluded.

> Live deployment and Kubernetes verification are outside this change and SHALL NOT be run as part
> of C-13 implementation.
