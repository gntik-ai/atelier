# Console Operations Polling

The web console reads async-operation data through `POST /v1/async-operation-query` from
`apps/web-console/src/lib/console-operations.ts`.

`useOperations`, `useOperationDetail`, `useOperationLogs`, and `useOperationResult` use the shared
`useAsyncResource` helper. Resource execution is keyed by the semantic query dependency key plus an
explicit manual reload token. Callers may pass object literals for filters or pagination, but those
object identities must not cause a request loop when the query result updates React state.

For list polling, the console schedules the next successful refresh only when the returned operation
list contains active operations (`pending` or `running`). Detail, logs, and result queries do not
poll by default.

## Operation identifier validation (C-17)

This boundary is relevant to P1 platform superadministrators and P3 platform operators/SREs
investigating an operation, and to P10 constrained viewers and P13 callers from another tenant.
It is an action/API safety rule, not a change to polling cadence or UI controls. For `detail`,
`logs`, and `result`, `operationId` must be a JavaScript string matching the canonical,
case-insensitive hexadecimal form `8-4-4-4-12` (for example,
`01234567-89ab-cdef-0123-456789abcdef`). No UUID version or variant is required: nil, future-version,
uppercase, and lowercase canonical values are accepted. Inputs are not trimmed, stringified,
repaired, de-braced, or otherwise coerced. Missing, empty, whitespace-only, wrong-type, truncated,
overlong, unhyphenated, braced, SQL-like, or any other non-canonical value is invalid.

The action validates the identifier after trusted caller identity and query-type checks, but before
tenant-scope resolution and any repository method or database query. An invalid operation-bearing
request ends with action code `VALIDATION_ERROR` and status `400`; no PostgreSQL query, write, successful
`console.async-operation.accessed` audit publication, completion log, or success metric annotation
is produced. At the HTTP boundary, the existing C-02 envelope exposes status `400` and public code
`GW_VALIDATION_ERROR`, with no SQLSTATE `22P02`, SQL text, bound value, provider/connection detail,
or stack trace. Ordinary bounded HTTP request metrics may still record the 400.

| Request and identifier | Result | Scope and telemetry meaning |
| --- | --- | --- |
| Unauthenticated or untrusted identity, even with malformed input | `401` | Authentication keeps precedence; no persistence or access telemetry. |
| Authenticated `detail`, `logs`, or `result` with missing/non-canonical input | Action `VALIDATION_ERROR`/`400`; HTTP `GW_VALIDATION_ERROR` | Client input fault; validation stops before tenant resolution and persistence. |
| Canonical ID with an explicit conflicting tenant filter | `403 TENANT_ISOLATION_VIOLATION` | Existing isolation denial remains before lookup. |
| Canonical absent or foreign ID without a conflicting filter | Non-leaking `404 NOT_FOUND` | Lookup is constrained to the verified tenant; no foreign existence or metadata is disclosed. |
| Canonical existing, authorized ID | Existing `200` projection | Correlation header, one successful access audit, completion log, and query metric annotations remain unchanged; reads stay read-only. |
| `list`, with or without an irrelevant `operationId` | Existing list behavior | No operation-ID requirement; filters, pagination, ordering, isolation, projection, and side effects are unchanged. |

For P1/P3, this makes a malformed copied link distinguishable from a backend outage. For P10, it
adds no permission or mutation capability. For P13, malformed values cannot become a provider-error
oracle, while canonical foreign IDs remain indistinguishable from absent IDs. If a request is both
malformed and has a conflicting tenant filter, the existing action ordering applies; C-17 does not
define a new combined-error contract.

### Focused verification

Run the C-17 black-box matrix through the action's public entrypoint:

```bash
node --test tests/blackbox/async-operation-id-validation.test.mjs
```

The isolated real-PostgreSQL regression uses the repository's disposable local database harness;
provide a local `TEST_DATABASE_URL` when required by that harness:

```bash
TEST_DATABASE_URL=postgres://… pnpm test:integration:async-operation-real-pg
```

These focused checks require no Kubernetes cluster and do not contact a shared or deployed
environment. They cover malformed classes and no-side-effect guarantees, 401/403/404 controls,
canonical existing 200 projections, and unchanged list behavior.

## Reconnect status filtering

After the browser reconnects or the tab becomes visible again,
`useReconnectStateSync` issues one list request with
`filters.status: ['running', 'pending']`. A scalar status keeps exact-equality semantics, while a
non-empty array selects the union of its status values. A singleton array is therefore equivalent
to the same scalar; reordering or repeating values does not change the result or duplicate rows.
An empty array deliberately matches no operations and is different from omitting `filters.status`,
which leaves the list unfiltered by status.

The repository applies the status predicate together with the existing tenant, workspace, and
operation-type predicates. The count and paginated item queries reuse the same predicates and
parameter values, and item ordering remains `created_at DESC`. Status values remain bound database
parameters; clients cannot supply SQL fragments. The request remains read-only and keeps the
existing response, pagination, authentication, authorization, and cross-tenant isolation behavior.
A successful list request still produces one access-audit publication and one structured log with
the existing query metrics, regardless of the number of requested statuses. It does not publish
once per status and does not add status values as metric labels.

This behavior does not change the canonical async-operation state vocabulary or role permissions.
Those are separate contract and authorization concerns.

Result reads require provisioning-orchestrator migration
`079-async-operation-results.sql`, applied after the existing 073–078 async-operation chain.
Completed lifecycle transitions may persist a safe JSON summary and record `completed_at`; failed,
timed-out, and cancelled transitions record the terminal time without a result. The result response
keeps its existing bounded projection and never returns the stored raw JSON. For any legacy
domain-terminal row (`completed`, `failed`, `timed_out`, or `cancelled`) whose `completed_at` is
null, the query uses `updated_at` as its read-time fallback. Pending, running, and cancelling rows
always return no completion time, even if stale storage contains a timestamp.
Failure reason and retryability are returned only for failed operations; stale legacy error
metadata on successful or nonterminal rows is ignored. The control-plane dispatch also assigns
verified identity and transport context after flattening request fields, so JSON body or query keys
cannot replace the tenant identity used by the result action.

When an async-operation query fails, the helper performs a small bounded retry sequence with backoff:
one retry after 1 second and one retry after 3 seconds. If the query still fails, the hook exposes the
error and stops automatic retries. The operations page renders that error state with the existing
manual **Reintentar** action. Manual retry clears any pending timer and starts a fresh bounded
attempt sequence.

This behavior prevents a backend outage or migration error from amplifying into an unbounded browser
request burst against the gateway or control plane.

The focused PostgreSQL regression can be run with an isolated test database:

```bash
TEST_DATABASE_URL=postgres://… pnpm test:integration:async-operation-real-pg
```

The hermetic reconnect regression and repository checks do not require PostgreSQL:

```bash
node --test \
  tests/blackbox/async-operation-status-array.test.mjs \
  tests/unit/async-operation-query-repo.test.mjs \
  tests/contract/async-operation-query-reconnect.contract.test.mjs
```
