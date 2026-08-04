# Change: Fix audit-record query filter, sort, and cursor semantics

## Why

C-09 / OBS-CONTRACT-09 is a confirmed audit-record query-semantics defect. The tenant and workspace
`audit-records` routes publish a rich query surface — twelve filter dimensions, cursor pagination,
and bidirectional timestamp sorting — through the internal audit-query contract
(`packages/internal-contracts/src/observability-audit-query-surface.json`) and the unified OpenAPI
document (`apps/control-plane-executor/openapi/families/metrics.openapi.json`:
`listTenantAuditRecords` / `listWorkspaceAuditRecords`, which already declare `page[size]`,
`page[after]`, `sort`, and a `nextCursor` on `AuditRecordCollectionResponse`). The live handler does
not honor that surface.

On base `baec64d8`, `apps/control-plane/metrics-handlers.mjs::auditRecords` forwards only five of the
twelve declared filters (`auditFiltersFromQuery` reads `outcome`, `actionCategory`, `actorId`,
`occurredAfter`, `occurredBefore` and drops `subsystem`, `actionId`, `actorType`, `resourceType`,
`resourceId`, `originSurface`, and `correlationId`); it silently coerces an invalid or out-of-range
`page[size]` (`Math.min(Math.max(Number(...) || 50, 1), 200)`) and defaults it to `50` rather than
the contract default of `25`; it never reads `page[after]` or `sort`, so cursor pagination and
ascending order are ignored; it hardcodes `page: { size: items.length, hasMore: false }` and emits no
`nextCursor`, so a caller is always told no further page exists even when older records remain; and it
advertises a five-entry `AVAILABLE_AUDIT_FILTERS` list whose types disagree with the contract enums.
The store (`apps/control-plane/audit-store.mjs::queryAuditEvents`) reads newest-first with
`ORDER BY created_at DESC, id DESC LIMIT $n` and supports only those same five predicates, with no
keyset continuation and no ascending path. The shared contract normalizer
(`apps/control-plane-executor/src/observability-audit-query.mjs`) validates a time window only when
both bounds are present and passes the cursor through unvalidated, so the two runtimes disagree on
request semantics.

The defect degrades every audit consumer. A privileged platform/superadmin administrator (P1) cannot
reliably investigate audit history because most filters silently do nothing, sort is fixed, and
pagination stops after the first page. A security/compliance auditor (P4) and a scoped viewer/auditor
(P10) receive incomplete, unpaginated results and cannot narrow by subsystem, action id, actor type,
resource, origin, or correlation id. An actor from another tenant (P13) is the adversarial isolation
control that must gain no cross-scope disclosure through a filter, a sort, or a forged cursor.

## What Changes

- Make both the tenant- and workspace-scoped `audit-records` routes enforce the same query
  semantics: every one of the twelve declared filters is applied as an exact, parameterized,
  conjunctive (`AND`) predicate evaluated inside the already-authorized tenant/workspace scope,
  against the same stored-or-derived value the response projects for that dimension.
- Validate query input before any datastore call and reject malformed input with a stable coded
  client error instead of silently coercing it: `page[size]` is an integer from 1 through 200; `sort`
  is exactly `eventTimestamp` or `-eventTimestamp`; each timestamp is RFC 3339 and, whether supplied
  alone or together, forms a valid inclusive window; each contract enum filter value is a declared
  member; and `page[after]` is a structurally valid cursor compatible with the current scope,
  filters, and sort. A well-formed free-form filter value that matches nothing returns `200` with an
  empty collection and never falls back to the unfiltered set.
- Default an omitted `page[size]` to the contract default `25` and an omitted `sort` to
  `-eventTimestamp`, and return records in a deterministic total order by event timestamp then a
  stable record-id tiebreak in the selected direction, so no record is skipped or duplicated across
  pages.
- Paginate with keyset (seek) continuation, selecting one record beyond `page[size]` to compute a
  truthful `page.hasMore`, reporting the number of records actually returned in `page.size`, and
  emitting `page.nextCursor` (from the last returned record) only when a further page exists.
  Following `nextCursor` returns the immediately subsequent, non-overlapping records under the
  identical scope, filters, and sort.
- Define the cursor as a versioned, base64url token carrying the last-seen sort position and a
  fingerprint of the authorized scope, the canonical applied filters, and the sort. The cursor is
  continuation state and an incompatibility/format detector, never an authorization boundary: every
  request — first page and each continuation — independently re-resolves and re-authorizes the path
  tenant/workspace scope, so a forged, foreign, or replayed cursor cannot read outside or widen the
  caller's scope; an incompatible cursor is rejected with a coded error.
- Advertise all twelve canonical filter dimensions in `availableFilters` (each with its contract id,
  param, label, type, and allowed values) in place of the current five, and echo only the canonical
  effective filters in `appliedFilters`, keeping the declared response shape (`items`, `page`,
  `queryScope`, `appliedFilters`, `availableFilters`, `consoleHints`) and per-item projection.
- Bring the runtime handler, the store adapter, and the shared contract normalizer into agreement
  with the twelve-filter, cursor, and sort surface already declared by the internal audit-query
  contract and the OpenAPI document, and align the console type and the audit-record-filters
  reference with the same surface.
- Preserve the console's existing filter controls and add an accessible continuation action that
  loads the next page via `nextCursor` and appends it. Reset the accumulated records and the cursor
  whenever tenant/workspace scope, filters, sort, or an explicit reload changes, and discard
  responses from a superseded query so a stale or out-of-order response never appends to a newer
  query's result set.
- Keep the `GET` query read-only with no write side effect for any caller, keep every query scoped to
  the caller's path-authorized tenant/workspace, and give an actor from another tenant identical
  no-leakage behavior on the first page and on every cursor continuation.
- Prove the fix through the public handler harness and an in-memory audit dataset, plus focused
  assertions over the emitted parameterized PostgreSQL SQL and cursor encoding, console
  continuation/reset/stale-guard regressions, and the existing contract tests. Live PostgreSQL and
  cluster verification remain outside this local-only remediation run.

## Personas and Observable Outcomes

- P1 (privileged platform/superadmin administrator) can investigate audit history end to end: all
  twelve filters narrow results, ascending and descending sort both work, and pagination continues
  past the first page with a truthful `hasMore` and a working `nextCursor`.
- P4 (security/compliance auditor) receives complete, precisely filtered results and can page through
  the full matching set with deterministic, non-overlapping pages under a stable order.
- P10 (scoped viewer/auditor) stays read-only and tenant/workspace-scoped. Continuation adds no
  mutation, quota, or cross-scope capability, and a well-formed filter that matches nothing returns an
  empty page rather than the unfiltered set.
- P13 (actor from another tenant) cannot use a filter, a sort, or a cursor to escape isolation. Filter
  values are bound parameters, the scope predicate is always `AND`-composed, and the cursor is
  re-authorized on every request, so a forged or foreign cursor yields no foreign record, count, or
  existence signal on the first page or any continuation.

## Non-Goals

- No C-02 `ErrorResponse` envelope repair, no C-08 change, and no C-10 audit-export or masking
  remediation. This change repairs only the audit-record list query semantics.
- No change to roles, permissions, or the authorization model. The existing own-tenant guard
  (`canManageTenant`) and the `authenticated` route auth are unchanged; a cursor never becomes an
  authorization grant.
- No new audit event producer, no backfill, and no database migration, column, index, constraint,
  trigger, or default. The fix reuses `plan_audit_events` and its `created_at`/`id` ordering keys.
- No advanced or visual filter-builder redesign. The console keeps its current controls and gains only
  an accessible continuation action.
- No new public route, gateway policy, or SDK surface. The `audit-records` routes, `page[size]`,
  `page[after]`, and `sort` are already published; C-09 makes the runtime honor them.
- No change to the other metrics handlers (quotas, overview, usage, series) or to any audit finding
  other than C-09.
- No shared, staging, or production deployment, no Helm/chart change, no Kubernetes access, and no
  loop-state or audit-evidence change.

## Exit Criteria

- Both `audit-records` routes accept and apply all twelve declared filters as parameterized,
  conjunctive predicates within the authorized scope; a well-formed filter value that matches nothing
  returns an empty page and never the unfiltered set.
- Malformed `page[size]`, `sort`, timestamps (single or paired), enum filter values, and incompatible
  cursors are rejected with a stable coded error before any datastore call, not silently coerced.
- An omitted `page[size]` defaults to `25` and an omitted `sort` to `-eventTimestamp`; results are in
  a deterministic total order by event timestamp then record id in the selected direction.
- Keyset pagination computes a truthful `page.hasMore` from a `page[size] + 1` lookahead, reports the
  returned record count in `page.size`, and emits `page.nextCursor` only when a further page exists;
  following `nextCursor` returns the next non-overlapping page under the identical scope, filters, and
  sort.
- The cursor is a versioned base64url token fingerprinting scope, filters, and sort; an incompatible
  cursor is rejected, and every first-page and continuation request independently re-authorizes the
  path scope so a forged or foreign cursor cannot cross or widen it.
- `availableFilters` lists all twelve canonical dimensions and `appliedFilters` echoes only the
  effective filters; the response shape and per-item projection are unchanged; and the handler, store,
  contract normalizer, OpenAPI, console type, and reference agree on the surface.
- The console preserves its filter controls, adds an accessible continuation action, resets records
  and cursor on scope/filter/sort/reload change, and discards superseded responses.
- The `GET` query performs no write for any caller including P10; an actor from another tenant sees no
  foreign data on the first page or any continuation.
- The public-handler regression proves filter completeness and conjunction, input validation,
  defaults, deterministic ascending/descending ordering, keyset continuation, cursor incompatibility
  rejection, and cross-tenant isolation on first-page and cursor requests. Focused store tests assert
  the literal PostgreSQL predicates, parameter numbering, direction-aware tuple comparison, and
  cursor encoding without requiring a deployment or database URL.
- `openspec validate fix-c09-audit-query-semantics --strict` passes.

## Risks and Rollback

The primary correctness risk is keyset pagination on real PostgreSQL: the seek predicate over
`(created_at, id)` must be consistent with the `ORDER BY` direction so pages neither overlap nor skip
records, especially across equal timestamps. The local handler regression exercises non-overlapping,
gap-free pages in both directions and the store regression checks the literal PostgreSQL tuple
predicate and parameters; executing those statements against live PostgreSQL remains a residual
verification item because this remediation is explicitly local-only.

The second risk is cursor safety. The cursor encodes a position and a fingerprint but must never
authorize: if an implementation trusted the cursor's embedded scope, a forged cursor could cross
tenants. The change re-resolves and re-authorizes the path scope on every request and binds the cursor
only as continuation state and a compatibility check, proven with a foreign-cursor isolation control.

The third risk is validation regressions: tightening `page[size]`, `sort`, timestamp, and enum
handling from silent coercion to coded rejection changes responses for previously-tolerated malformed
input. The change specifies coded client errors, keeps well-formed-but-nonmatching filters returning
an empty `200`, and updates the console to send only contract-valid input and to paginate.

The fourth risk is console state coherence: appending pages must reset on scope/filter/sort/reload
change and must ignore superseded responses, or rows from an old query could bleed into a new one. The
change specifies reset and stale-response discarding and tests both.

Rollback reverts the handler, store, normalizer, console, focused tests, and the reference note. There
is no schema, datastore, migration, or published-contract change to reverse; reverting simply
reintroduces the C-09 five-filter, no-cursor, always-`hasMore:false` behavior.
