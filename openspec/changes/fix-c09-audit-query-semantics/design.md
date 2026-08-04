# Design: Contract-conformant audit-record query semantics

## Context

Falcone exposes tenant and workspace audit history through two guarded GET routes. The internal
query-surface contract and public OpenAPI already describe twelve filters, `page[size]`,
`page[after]`, `sort`, a default size of 25, a maximum of 200, and the two timestamp directions.
The implementation paths do not currently agree:

- `apps/control-plane/metrics-handlers.mjs::auditFiltersFromQuery` (lines 464-471) extracts only
  outcome, action category, actor ID, and the two timestamps; `auditRecords` (lines 523-540)
  silently coerces/clamps the limit, passes no cursor or sort, and catches datastore and validation
  failures as an empty `200`.
- `apps/control-plane/metrics-handlers.mjs::auditCollection` (lines 502-515) publishes only five
  filters and unconditionally returns `hasMore: false`.
- `apps/control-plane/audit-store.mjs::queryAuditEvents` (lines 160-211) accepts only those five
  filters, orders every query by `created_at DESC, id DESC`, and returns an unstructured row array.
- `packages/internal-contracts/src/observability-audit-query-surface.json` declares the complete
  query surface, while `apps/control-plane-executor/src/observability-audit-query.mjs::normalizeAuditRecordQuery`
  normalizes more of it but does not provide the live control-plane execution path or complete
  strict input validation.
- `apps/web-console/src/lib/console-metrics.ts::useConsoleAuditRecords` (lines 309-360) hard-codes
  50 descending rows and discards `page`, so `apps/web-console/src/pages/ConsoleObservabilityPage.tsx::ConsoleObservabilityPage`
  cannot continue past the first response.

The repair crosses the public handler, SQL store, internal/OpenAPI descriptions, and console. P1
is the primary investigator; P10 must retain constrained read-only behavior; P4 is an adjacent
auditor who needs deterministic evidence review; and P13 is the adversarial cross-tenant control.
Existing route authorization remains the security boundary. There is no datastore migration,
new audit producer, backfill, deployment, or cluster work in this change.

## Goals / Non-Goals

**Goals:**

- Give both guarded routes one strict, canonical query model covering all twelve declared filters,
  bounded page size, sort, and cursor.
- Apply every supplied filter as an exact, conjunctive, parameterized SQL predicate within the
  path-resolved authorized tenant/workspace.
- Return deterministic pages using `(created_at, id)` keyset ordering, truthful continuation
  metadata, and a cursor that detects query incompatibility without being treated as authority.
- Make malformed input fail with HTTP `400` before the datastore is invoked; keep a valid
  unmatched free-form filter as an ordinary empty HTTP `200`.
- Keep the console's five current filter controls while letting keyboard and assistive-technology
  users continue safely through all pages.
- Keep contracts, runtime behavior, focused tests, and reference material synchronized.

**Non-Goals:**

- C-02 error-envelope work, C-08, C-10, roles, permissions, authentication, or authorization
  policy changes.
- New event producers, historical backfill, storage-column changes, indexes, or any migration.
- New advanced visual controls for the seven other filters, saved searches, arbitrary SQL, full
  text or partial matching, export behavior, or an audit datastore redesign.
- Helm, image, gateway, cluster, installation, deployment, or live-environment work.

## Decisions

### Decision 1: Normalize and validate the complete request before datastore access

The live handler will convert either route's raw query into one canonical query value only after
the existing scope resolver and authorization guard have produced canonical tenant/workspace
identity. The normalized value contains:

```text
tenantId, optional workspaceId, queryScope,
pageSize, sort, optional cursor,
filters { occurred_after, occurred_before, subsystem, action_category,
          action_id, outcome, actor_type, actor_id, resource_type,
          resource_id, origin_surface, correlation_id }
```

`page[size]` is omitted or one unambiguous base-10 integer. Omission becomes 25; values below 1,
above 200, fractional, non-numeric, empty, or repeated ambiguously produce `400`. Sort omission
becomes `-eventTimestamp`; the only accepted explicit values are `eventTimestamp` and
`-eventTimestamp`. Both timestamp filters must be complete RFC 3339 date-times, and the inclusive
lower bound cannot be after the inclusive upper bound. The enumerated filter values are validated
against the same canonical allowlists used by internal contracts and OpenAPI. String filter
values are not reinterpreted as SQL, patterns, prefixes, alternate casing, or authorization data.

Cursor base64url decoding, JSON/schema validation, version validation, and query-fingerprint
comparison also happen before the store call. Validation failure returns the route's existing
bounded HTTP `400` error form and does not degrade to an empty collection. Authorization and scope
errors remain governed by the existing guard and do not become query-validation responses.

A valid free-form `actionId`, `actorId`, `resourceType`, `resourceId`, or `correlationId` that has
no exact match reaches the store and returns an empty `200`. Rejecting arbitrary unmatched text
was considered and rejected because it would confuse absence with malformed input. Silent limit
clamping was rejected because it hides client errors and contradicts the declared contract.

The internal normalizer and live handler will share the same canonical names and validation rules
or be backed by one helper, so the executor-facing contract model cannot drift from the serving
path. Repeated/ambiguous query representation is rejected rather than choosing the first value.

### Decision 2: Express all canonical fields as literal parameterized SQL predicates

The store will own a fixed SQL projection for the twelve canonical filter dimensions, aligned
with `auditRowToRecord`. Every optional predicate is selected by implementation code and every
request value is appended to the driver parameter array. Client text is never concatenated into
the SQL statement, column name, JSON path, operator, `ORDER BY`, or direction.

The mappings are:

| Filter | Exact canonical predicate |
| --- | --- |
| `occurred_after` | projected `created_at >= $n::timestamptz` |
| `occurred_before` | projected `created_at <= $n::timestamptz` |
| `subsystem` | canonical subsystem expression `= $n` |
| `action_category` | the same canonical action-category expression used by the response `= $n` |
| `action_id` | canonical action identifier derived from `action_type = $n` |
| `outcome` | canonical public outcome expression, including the existing legacy normalization, `= $n` |
| `actor_type` | the same canonical actor-type expression used by the response `= $n` |
| `actor_id` | `actor_id = $n` |
| `resource_type` | the same canonical resource-type expression used by the response `= $n` |
| `resource_id` | canonical stored resource identifier expression `= $n` |
| `origin_surface` | the same canonical origin-surface expression used by the response `= $n` |
| `correlation_id` | canonical stored-or-`legacy-{id}` correlation expression `= $n` |

All present predicates are joined with `AND` after mandatory `tenant_id = $1` and, for a workspace
route, the exact canonical workspace predicate. A missing canonical value in an existing row does
not broaden the result; it simply cannot match that filter. Constant/derived dimensions must use
the public contract value (for example the tenant-control-plane subsystem and control API origin)
in both projection and filtering so metadata, filtering, and returned records do not disagree.

The fixed direction is chosen through one validated branch that emits either literal
`ORDER BY created_at ASC, id ASC` or literal `ORDER BY created_at DESC, id DESC`. A value cannot
enter that branch until it equals one of the two allowed public sort tokens. This is clearer and
safer than attempting to parameterize SQL keywords or interpolate the raw sort string.

Application-side filtering was rejected because it would make page size and `hasMore` dishonest,
could scan outside bounds, and would separate authorization scope from effective predicates.
Partial/`ILIKE` semantics were rejected because the contract calls for exact dimensions and
wildcards would make client text consequential as SQL pattern syntax.

### Decision 3: Use direction-aware `(created_at, id)` keyset pagination

The datastore query always asks for `pageSize + 1` rows, up to 201, under the mandatory scope and
all effective filters. The stable key is the pair `(created_at, id)`, matching the stored timestamp
and UUID event identifier. Cursor positions and the public `eventTimestamp` projection preserve
PostgreSQL's microsecond precision instead of round-tripping through a millisecond-only JavaScript
`Date`:

- descending first page: `ORDER BY created_at DESC, id DESC`;
- descending continuation: `AND (created_at, id) < ($cursorTimestamp, $cursorId)` with the same
  descending order;
- ascending first page: `ORDER BY created_at ASC, id ASC`; and
- ascending continuation: `AND (created_at, id) > ($cursorTimestamp, $cursorId)` with the same
  ascending order.

If the store receives more than `pageSize` rows, it returns only the first `pageSize`, sets
`hasMore: true`, and builds `nextCursor` from the last returned row. Otherwise it returns every row,
`hasMore: false`, and no `nextCursor`. Response `page.size` is the count actually returned, not the
requested bound. The handler does not infer `hasMore` from a full page, and it never creates a
cursor from the `+1` lookahead row.

Offset pagination was rejected because concurrent appends and tied timestamps cause shifting
pages. Timestamp-only keysets were rejected because ties could be duplicated or skipped.

### Decision 4: Make cursors versioned, query-bound continuation state—not authority

The cursor is UTF-8 JSON encoded with unpadded base64url. Version 1 has a bounded object shape:

```json
{
  "v": 1,
  "position": { "createdAt": "2026-08-04T12:00:00.000Z", "id": "event-id" },
  "fingerprint": "<bounded query fingerprint>"
}
```

The expected fingerprint is deterministically derived from a canonical serialization of the
resolved query scope (`tenantId`, optional `workspaceId`, `queryScope`), lexically ordered
canonical filters, and normalized sort. Page size is deliberately excluded so a caller can choose
a different valid bound for the next page without changing which records belong to the sequence.
The implementation may use a standard hash such as SHA-256 to keep the token bounded, but no
claim of signature, secrecy, unforgeability, or authorization is made.

On every continuation, the route still authenticates the caller, resolves the path scope, applies
authorization, rebuilds the canonical query, and compares the cursor fingerprint. Invalid
base64url, invalid JSON, extra/absent fields, unsupported version, a non-UUID event position,
malformed timestamp position, or a fingerprint for another tenant, workspace, filter set, or sort
returns `400` before SQL.

The store receives scope independently of the decoded cursor and retains mandatory scope
predicates. It uses only the validated position for its keyset predicate. Consequently even a
caller who edits or recreates a cursor cannot use it to widen scope or remove filters. Signing the
cursor was considered but is unnecessary for this repair because the cursor is not a security
boundary; existing route authorization and mandatory SQL scope are. Treating a cursor as proof of
access was rejected categorically.

Changing page size remains compatible; changing scope, any filter, or sort requires a first-page
request. Unsupported future cursor versions fail closed so version migrations remain explicit.

### Decision 5: Return complete canonical query metadata

Every successful tenant or workspace response includes:

- `items`: masked canonical records;
- `page.size`: actual number of returned items;
- `page.hasMore`: the lookahead result;
- `page.nextCursor`: present only when `hasMore` is true;
- `queryScope`: `tenant` or `workspace` from the route;
- `appliedFilters`: only effective filters, using all twelve canonical snake-case IDs and their
  normalized string values; and
- `availableFilters`: exactly the twelve contract entries with canonical ID, public parameter,
  type, label, and allowed values where defined.

Omitted filters are absent from `appliedFilters`; scope, cursor, sort, and page size are not
misreported as filters. An unmatched valid filter remains present because it was applied even
when `items` is empty. The existing `consoleHints` remains conformant. Internal contract,
OpenAPI parameter enums/formats/defaults and page schema, runtime response, and TypeScript client
type will be updated together.

Keeping the current five-entry metadata list was rejected because clients use `availableFilters`
to discover the supported surface. Returning raw camel-case query keys in `appliedFilters` was
rejected because the canonical internal contract already defines stable snake-case IDs.

### Decision 6: Extend the existing console query state with safe continuation

The console retains Actor, Category, Result, From, and To controls and continues using descending
timestamp order. The hook will retain `records`, `hasMore`, `nextCursor`, first-page loading/error,
and continuation loading/error. A visible button such as “Cargar más” is rendered only when
`hasMore` and a cursor exist; it is a real keyboard-focusable button with a programmatic name,
busy/disabled state during the request, and an `aria-live` status for appended counts or errors.
It does not rely on scroll position, pointer-only input, color, or an inaccessible infinite-scroll
sentinel.

The first-page query identity comprises tenant ID, workspace ID, the five filter values, and sort.
Any identity change, filter edit, explicit reload, or context transition immediately invalidates
the prior cursor and accumulated rows, then starts a fresh first-page request. A monotonically
increasing generation/request identity (and cancellation when available) ensures late responses
from an old scope/filter and duplicate continuation clicks cannot append to the current list.
Continuation appends only the accepted response for the current generation and de-duplicates by
event ID defensively while preserving server order.

The UI uses the server's `hasMore`/`nextCursor` rather than guessing from a 50-row cap. The console
can keep a size of 50 explicitly; API omission still defaults to 25. Adding visual controls for the
remaining seven filters is deliberately deferred, because API completeness and pagination do not
require an advanced filter-builder redesign.

### Decision 7: Preserve authorization, isolation, read-only GET, and error boundaries

The existing guarded route resolves and authorizes tenant/workspace scope before query execution.
This change neither adds permissions nor interprets cursor/filter content as scope. The store
requires `tenantId`, adds a workspace predicate for the workspace route, and rejects a missing or
incoherent scope before any SQL call. First pages and continuations follow the same path.

P10 receives corrected results only under existing read permission and remains unable to mutate,
export, or cross scopes. P4 gains no adjacent privilege. A P13 other-tenant caller cannot obtain a
foreign event, count, position, filter inference, or cursor through first-page, forged-cursor, or
replayed-cursor attempts. Existing non-enumerating authorization behavior remains unchanged.

The operation remains GET and performs no application write, audit write, quota mutation, or
cursor persistence. Normal access logging/HTTP telemetry may still observe the request. A `400`
validation request makes no datastore call; an authorized valid read makes one bounded SELECT.
Datastore unavailability remains an operational error handled by the established route policy,
but must not be confused with an invalid request or a valid unmatched filter. The previous broad
catch-to-empty behavior is removed where it hides those distinctions.

### Decision 8: Verify the public-to-SQL-to-console chain with focused local tests

Implementation is test-first. Public black-box handler tests exercise both routes, all twelve
individual filters, conjunction, unmatched free text, defaults, invalid-input short-circuiting,
direction/ties, page continuation, cursor incompatibility, and response metadata. Store tests
capture literal SQL and parameter arrays, verify mandatory tenant/workspace predicates precede all
optional predicates, verify no request value appears in SQL text, and check both keyset directions
plus `limit + 1` page assembly.

Contract tests compare internal filter definitions and OpenAPI for both operation IDs, validate
public-handler `200` collection semantics and bounded coded `400` errors without absorbing the
separate C-02 error-envelope repair, and prevent route/runtime drift. Console component/hook
tests cover the five controls, accessible continuation, loading/error recovery, reset on context or
filter change, stale-response rejection, duplicate-click suppression, and no fetch for a persona
without existing audit-read permission. Authorization/isolation tests include P10 read-only and P13
foreign first-page, replayed-cursor, and forged/incompatible-cursor controls. A read-only spy proves
successful GET performs no write or domain-audit call.

Focused test commands and strict OpenSpec validation are sufficient for this design phase. No
browser against a live cluster, external service, credential, deployment, Helm action, or cluster
mutation belongs to this change.

## Risks / Trade-offs

- **[Derived fields can drift between projection and predicates]** → Centralize or reuse each
  canonical SQL expression and cover it with row-to-record plus filter tests for every dimension.
- **[Unsigned cursors can be edited]** → Treat every decoded field as untrusted, strictly validate
  it, recompute query compatibility, keep mandatory authorized-scope predicates, and document that
  the cursor is continuation state rather than authority.
- **[Concurrent inserts change what a later page can observe]** → Use a stable keyset and promise
  no duplicate/skip within the traversed ordered sequence, not a transactional snapshot of future
  writes. Newly inserted rows are obtained by restarting from the first page.
- **[ASC and DESC branches diverge]** → Generate both from the same normalized sort enum and test
  equal-timestamp IDs, first/middle/final pages, and literal comparator/order pairs.
- **[Broad catch-to-empty masks regressions]** → Separate validation, authorized empty results, and
  operational failures; assert no datastore call for `400` and a real empty SELECT for valid no-match.
- **[Console responses race during context changes]** → Bind every response to an immutable query
  generation, cancel when possible, and append only once for the active generation.
- **[Contract allowlists drift]** → Establish one canonical source or contract-conformance test
  across internal contract, OpenAPI tenant/workspace operations, handler metadata, and normalizer.

## Migration Plan

No schema, data, index, cursor persistence, deployment, or cluster migration is required. Existing
rows are queried through derived canonical expressions. Cursors created by the corrected runtime
start at version 1; malformed or unknown-version cursors receive `400`, so no legacy token is
silently reinterpreted. Implementation and contract changes should be released as one application
change. A code rollback restores the prior reader behavior without transforming stored data; new
versioned cursors will then cease to be accepted and clients must restart at the first page.

## Open Questions

None. The public parameter names, allowed enums, defaults, ordering key, cursor role, personas, and
out-of-scope boundaries are fixed by this change.
