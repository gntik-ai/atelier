# Console Operations Polling

The web console reads async-operation data through `POST /v1/async-operation-query` from
`apps/web-console/src/lib/console-operations.ts`.

`useOperations`, `useOperationDetail`, `useOperationLogs`, and `useOperationResult` use the shared
`useAsyncResource` helper. Resource execution is keyed by the semantic query dependency key plus an
explicit manual reload token. Callers may pass object literals for filters or pagination, but those
object identities must not cause a request loop when the query result updates React state.

For list polling, the console schedules the next successful refresh only when the returned operation
list contains an active operation. The canonical active set is `pending`, `running`, and
`cancelling`; terminal statuses are `completed`, `failed`, `timed_out`, and `cancelled`. Detail,
logs, and result queries do not poll by default. The reconnect synchronisation described below uses
the same active set, so an operation being cancelled remains visible until it reaches a terminal
state.

## C-12 status vocabulary and lifecycle model

The authoritative catalog is
`packages/internal-contracts/src/async-operation-status-vocabulary.json`. Its fixed migration-076
order is:

| Status | Classification | Cancellable | Console label |
| --- | --- | --- | --- |
| `pending` | active | yes | `Pendiente` |
| `running` | active | yes | `En curso` |
| `completed` | terminal | no | `Completada` |
| `failed` | terminal | no | `Fallida` |
| `timed_out` | terminal | no | `Expirada` |
| `cancelling` | active | no | `Cancelando` |
| `cancelled` | terminal | no | `Cancelada` |

The catalog is the single source for the seven values, the active/terminal/cancellable subsets,
labels, and the existing transition graph. The graph is unchanged: `pending` may move to `running`
or `cancelled`; `running` may move to `completed`, `failed`, `timed_out`, or `cancelling`; and
`cancelling` may move to `cancelled` or `failed`. Terminal states have no outgoing edge.
`cancelling` is deliberately active for polling and indexing but is not cancellable again.

Each catalog entry declares `value`, the `active`/`terminal`/`cancellable` booleans, the ordered
`transitions` targets, the Spanish `consoleLabel`, and a bounded `consoleTone`
(`neutral`, `progress`, `success`, `danger`, or `warning`), under a top-level `version` marker.

The generator renders the following committed artifacts from that catalog; they are not independent
vocabularies. Each carries a provenance marker (a warning header for generated code, an
`x-falcone-generated-status-vocabulary` annotation for the managed JSON) and is owned by the
generator. Do not edit them by hand:

- `packages/provisioning-orchestrator/src/generated/async-operation-status-vocabulary.mjs`: the
  backend ordered values, membership sets, lifecycle subsets, and transition map.
- `apps/web-console/src/lib/generated/async-operation-status-vocabulary.mjs` and its adjacent
  `.d.mts` declaration: the console ordered values, membership sets, labels, tone tokens, and the
  exact `OperationStatus` union and readonly value/map types.
- the status enum nodes inside `packages/internal-contracts/src/async-operation-query-response.json`
  (`/definitions/OperationStatus/enum`) and
  `packages/internal-contracts/src/async-operation-state-changed.json`
  (`/properties/previousStatus/enum` and `/properties/newStatus/enum`). The generator owns only these
  nodes and the annotation; the rest of each schema stays hand-maintained.

Regenerate and verify with:

```bash
pnpm generate:async-operation-status-vocabulary
pnpm validate:async-operation-status-vocabulary
```

The second command is a no-write drift check. It recomputes deterministic bytes and reports every
stale generated path without rewriting it; repository validation and CI run this check. If a stale
artifact is found, update the catalog (if the intended change is normative), regenerate, inspect the
diff, and rerun the check. Never “fix” a stale generated file manually or commit a generated file
without its catalog change. Generation is local and deterministic (no network, clock, locale, or
filesystem-order dependency), so running it twice must produce identical output.

The generated schema enums widen only the existing `OperationStatus`, `previousStatus`, and
`newStatus` nodes. Response/event routes, fields, topics, authentication, authorization, tenant and
workspace isolation, retry behavior, metrics, audit semantics, and provider-error redaction remain
unchanged. C-11's `resultType`/`completedAt` projection is unchanged, as are C-13's status-array
filter semantics and C-17's operation-ID validation. Migration
`packages/provisioning-orchestrator/src/migrations/076-timeout-cancel-recovery.sql` is immutable. The
parity check reads only its executable SQL: the `async_operations_status_check` constraint, compared
in order to the seven catalog values, and the `idx_async_ops_status_updated` active partial-index
predicate, compared as a set to the three active values `running`, `pending`, and `cancelling`, plus
the generated transition behavior. It does not rewrite, reformat, or replace the migration, and
finding anything other than exactly one matching constraint or index is itself a failure.

For the P3/P17 console, `cancelling` must render the accessible badge text **Cancelando** and appear
in the status filter. Every status has a non-empty Spanish label and a text-bearing badge; color or
animation is never the only distinction. Reconnect and count queries use the active set
`[pending, running, cancelling]` as one status-array predicate. Terminal operations are not polled.

### Local and CI checks

These run with no Kubernetes cluster and no Playwright. Pair the no-write drift and migration-076
parity check with the focused contract, backend, and console regressions:

```bash
# Drift + migration-076 parity (no-write) and the C-12 vocabulary/contract/graph black-box matrix.
pnpm validate:async-operation-status-vocabulary
node --test tests/blackbox/async-operation-status-vocabulary.test.mjs

# Internal-contract AJV coverage (every status, every transition edge, unknown rejected) plus the
# backend transition graph and classification.
node --test \
  tests/contract/async-operation-query-response.test.mjs \
  tests/contract/async-operation-state-changed.test.mjs \
  tests/unit/async-operation-states.test.mjs

# Console type/runtime parity: every OperationStatus consumer accepts `cancelling` with no cast.
pnpm --filter @in-falcone/web-console typecheck
```

The isolated real-PostgreSQL suite applies the actual migration chain, persists and transitions every
canonical status through legitimate graph paths, and proves the migration-076 constraint rejects an
unknown value. It uses a disposable local or CI database and never contacts a cluster:

```bash
TEST_DATABASE_URL=postgres://… pnpm test:integration:async-operation-real-pg
```

The full `pnpm validate:repo` (which CI runs through `pnpm lint`) includes the drift check, and
`openspec validate fix-c12-async-status-vocabulary --strict` gates the change package. A failed check
naming generated paths is a stale-artifact condition, not permission to edit output directly:
regenerate from the catalog, review the canonical order and classifications, and rerun all checks
before opening a change.

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
`filters.status: ['pending', 'running', 'cancelling']`, the generated active subset (C-12) that now
includes `cancelling`. A scalar status keeps exact-equality semantics, while a non-empty array
selects the union of its status values. A singleton array is therefore equivalent to the same
scalar; reordering or repeating values does not change the result or duplicate rows. Because array
membership is order-invariant, adopting the canonical active order changes no C-13 selection
semantics, and the request is never split into one call per status. An empty array deliberately
matches no operations and is different from omitting `filters.status`, which leaves the list
unfiltered by status.

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
