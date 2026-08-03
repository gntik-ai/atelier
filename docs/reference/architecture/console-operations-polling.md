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
