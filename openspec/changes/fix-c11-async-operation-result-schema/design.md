# Design: Async-operation result schema and lifecycle

## Context

The async-operation query action has four branches: list, detail, logs, and result. The first three
branches use columns and tables created by the real 073–078 migration chain. The result repository
selects `result` and `completed_at`, but the chain does not create them. Unit tests currently mock
those columns, and the PostgreSQL query integration test creates a handcrafted temporary
`async_operations` table that includes them. Those fixtures mask the production-shaped defect.

The result formatter already defines the compatibility boundary:

- `completed` maps to `resultType: "success"` and derives `summary` from a result string or the
  result object's `summary`/`message`.
- `failed` maps to `resultType: "failure"` and derives `failureReason` and `retryable` from
  `error_summary`.
- Other statuses retain the current `resultType: "pending"` behavior.
- `completedAt` uses the stored terminal timestamp for every domain-terminal status and has an
  `updated_at` compatibility fallback for legacy terminal rows. Nonterminal rows always project
  null, even if stale storage contains a timestamp.
- The raw result object is not part of the response.

The fix must make that existing projection executable against the real schema and give the new
columns a coherent write lifecycle without absorbing adjacent status, filter, malformed-ID,
authentication, telemetry, or UI work.

## Goals

- Repair the real schema with the smallest safe additive migration.
- Make all async-operation lifecycle writers maintain consistent result and completion-time data.
- Preserve the current query response, tenant/auth behavior, and audit/observability behavior.
- Prove the fix with the actual migration chain, real PostgreSQL, real repository functions, and
  the real action.
- Keep rollback non-destructive and compatible with older application code.

## Non-Goals

- Expanding or correcting status enums or result-type classification for C-12.
- Changing list filters for C-13 or malformed identifier handling for C-17.
- Returning raw result JSON through the query API.
- Redesigning the Operations console or its polling behavior.
- Adding a migration framework, migration history table, backfill, index, trigger, or new
  constraint.
- Redesigning saga execution, compensation, audit, logging, or telemetry.
- Deploying or validating against a live environment.

## Decision 1: Add migration 079 as nullable, idempotent DDL

The new file is
`packages/provisioning-orchestrator/src/migrations/079-async-operation-results.sql`. Its forward
operation is equivalent to:

```sql
ALTER TABLE async_operations
  ADD COLUMN IF NOT EXISTS result JSONB,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
```

Both columns are nullable. Neither receives an explicit or implicit default. The migration performs
no update/backfill, creates no index, and does not change a status constraint. This means:

- existing rows remain valid and receive null for both new columns;
- a fresh schema and an upgraded schema converge on the same column definitions;
- applying migration 079 repeatedly is safe; and
- no historical terminal time is fabricated during migration.

Adding the columns to migration 073 was rejected because existing environments that already ran 073
would not receive them. Selecting typed null constants in the repository was rejected because it
would hide the SQL error without giving lifecycle writers durable result data. Defaults and a
backfill were rejected because neither can reconstruct a trustworthy historical completion instant
or result.

## Decision 2: Register 079 after 078 and before 080

Migration 079 depends on the `async_operations` table created by 073 and belongs to the existing
async-operation chain. It has no dependency on 080, so numeric and dependency-safe order is:

```text
073 → 074 → 075 → 076 → 078 → 079 → 080
```

The implementation registers that order in:

- `apps/control-plane/governance-schema.mjs`, the boot-time canonical application list;
- `apps/control-plane/required-migrations.txt`, the canonical route-serving migration manifest;
  and
- `tests/env/up.sh`, the local PostgreSQL environment bootstrap.

The unit and black-box bootstrap guards are updated to assert the same placement. The kind README is
documentation, not an additional migration runner, but its listed chain must also include 079 and
must stop describing the result branch as broken.

The migration file contains forward DDL only. An executable destructive down block is intentionally
not appended because one canonical environment bootstrap feeds the complete file directly to
`psql`, and because normal rollback must retain the columns.

## Decision 3: Centralize result lifecycle in repository transitions

The async-operation repository remains the canonical write boundary. Creation and transition
functions carry the following invariants:

| Lifecycle event | `result` | `completed_at` |
| --- | --- | --- |
| Create as `pending` | `NULL` | `NULL` |
| Enter or remain `pending`, `running`, or `cancelling` | `NULL` | `NULL` |
| Enter `completed` | Optional sanitized JSONB | Terminal transition timestamp |
| Enter `failed`, `timed_out`, or `cancelled` | `NULL` | Terminal transition timestamp |
| Retry terminal operation to `pending` | `NULL` | `NULL` |
| Update failure classification/intervention metadata | Preserve existing value | Preserve existing value |

The terminal timestamp and `updated_at` for a terminal transition are derived from the same
transition instant. The repository update, transition-history insert, and existing transaction
boundary remain atomic where they are atomic today.

Completion accepts an optional result. Before persistence, that value must be a safe,
JSON-compatible projection intended for operation history. The domain boundary must reject,
remove, or redact credentials, passwords, secrets, tokens, API keys, private keys, connection
strings, raw stack traces, internal filesystem paths, and equivalent sensitive/internal material.
It constructs a detached canonical value from enumerable data properties in one pass and rejects
accessors and prototype-affecting keys, so validation and serialization cannot observe different
values or mutate the detached value's prototype. Object field names and string values containing
NUL or unpaired UTF-16 surrogates are rejected because PostgreSQL JSONB cannot represent them.
Canonical containers do not inherit `toJSON`, so an in-process source cannot replace validated
data through a prototype serialization hook; Proxy objects are rejected before invoking traps, and
the returned value is rehydrated as ordinary JSON.
The safe persisted value may be an object, array, string, number, or boolean. Every non-null value
is explicitly serialized and cast as JSONB at the repository boundary so PostgreSQL does not
interpret a JavaScript string as raw JSON syntax. An object's `summary` or `message`, when present,
must be a string or null because those fields feed the internal response contract. No terminal
writer may bypass this boundary to store a raw action result.

Failures, timeouts, and cancellations always clear result because a partial output is not a
successful operation result. Their existing safe error/cancellation fields continue to explain the
outcome.

Ordinary retry currently uses `atomicResetToRetry`, while supervised retry override performs a
separate direct update. Both updates must explicitly clear `result` and `completed_at`. This
prevents a retried pending operation from presenting a stale success result or terminal time.

Failure classification and manual-intervention updates may change classification fields and
`updated_at`, but must not clear, replace, or recompute a terminal result or `completed_at`.
Keeping `completed_at` independent of later classification work prevents the terminal instant from
drifting.

## Decision 4: Durable saga terminal writes use the repository lifecycle

`apps/control-plane/saga.mjs` mirrors a durable saga into `async_operations`. Its current
completion/failure helper updates status and error data with direct SQL and writes transition
history separately. That path cannot reliably enforce the new result lifecycle.

Saga completion and failure will call the same repository lifecycle used by other operation
writers:

- completion passes the optional safe saga result and enters `completed`;
- failure passes the existing sanitized error summary and enters `failed`;
- the repository writes the result/completion fields and transition history once; and
- saga logging remains best-effort and retains its current log messages.

The hand-written status update and duplicate transition insert are removed from the saga terminal
path. The saga-run record and compensation behavior remain unchanged. This is not a broader saga
engine refactor.

## Decision 5: Preserve the result response and access boundary

`getOperationResult` continues to select the operation by both `operation_id` and `tenant_id`. The
action continues to resolve the operation through `getOperationById` before querying its result.
The following behavior remains stable:

- the response fields remain `queryType`, `operationId`, `status`, `resultType`, `summary`,
  `failureReason`, `retryable`, and `completedAt`;
- raw JSONB `result` is never returned;
- completed/failed/pending result classification does not change;
- for all domain-terminal statuses, a stored `completed_at` is preferred and a legacy null value
  falls back to `updated_at`;
- pending, running, and cancelling rows have no completion time even if stale data exists;
- failure reason and retryability are projected only for failed rows, so stale legacy
  `error_summary` data cannot leak into success or pending projections;
- summary and failure-message projection defensively returns null for non-string legacy values;
- missing or untrusted identity remains unauthorized;
- server-owned trusted headers, method, path, query, and body containers are assigned after
  flattened request values and cannot be replaced by attacker-controlled reserved keys;
- a tenant caller is scoped to its verified tenant;
- wrong-tenant and unknown operation resources remain indistinguishable `404` responses;
- current superadmin tenant resolution remains unchanged; and
- successful access retains the correlation header, access-audit event, structured completion log,
  and query metrics.

The legacy fallback is a read-time compatibility rule, not a backfill. It prevents old terminal
rows from losing a completion time while avoiding a migration-time guess. The status vocabulary
and result-type mapping are not expanded as part of this change.

## Decision 6: Gate HTTP readiness on schema and recovery

Database liveness and schema readiness are distinct. `/healthz` continues to execute `SELECT 1`
without depending on migration state. `/readyz` returns `503` until the complete schema bootstrap
and saga recovery succeed, and mapped routes return `503` during the same interval. Migration retry
exhaustion still exits the process so the runtime cannot serve indefinitely against an unusable
schema.

## Decision 7: Use real PostgreSQL and the actual migration chain for acceptance

The regression suite must not define its own `async_operations` columns. The PostgreSQL integration
harness will create an isolated test database or schema, apply the actual forward migrations in
this exact order, and exercise them twice:

```text
073-async-operation-tables.sql
074-async-operation-log-entries.sql
075-idempotency-retry-tables.sql
076-timeout-cancel-recovery.sql
078-retry-semantics-intervention.sql
079-async-operation-results.sql
```

The test also asserts that the canonical boot list places 079 before 080. PostgreSQL catalog checks
verify exact types, nullability, absence of defaults, and absence of a result/completion-specific
index. A pre-079 checkpoint may execute the real result repository and assert SQLSTATE `42703`;
after 079, the same unchanged query must succeed. The acceptance proof then uses real repository
creation/transitions and the real query action.

Required data-path cases are:

- create/nonterminal null values;
- completed with a sanitized optional result and terminal timestamp;
- failed with error projection, null result, and terminal timestamp;
- pending result response with null summary/failure/completion values;
- a legacy terminal row with null `completed_at` using `updated_at`;
- timed-out and cancelled writers setting terminal time with null result;
- ordinary retry and retry override clearing both fields;
- later classification/intervention updates preserving terminal fields;
- saga completion and failure using repository lifecycle;
- successful detail and log controls;
- successful result access producing the existing audit/log/metric effects;
- wrong-tenant and unknown-operation `404` controls; and
- adversarial result content not being persisted or returned.

Mock-backed unit tests remain useful for pure projection edge cases, but they are not accepted as
proof that the schema and action are compatible. The existing handcrafted PostgreSQL setup that
predeclares `result` and `completed_at` must be replaced or refactored to consume the real
migrations.

The suite has a dedicated package command that fails when neither `TEST_DATABASE_URL` nor
`DATABASE_URL` is configured. CI provides a PostgreSQL 16 service and always invokes that command,
so the schema regression cannot silently become a skipped test.

## Decision 8: Keep documentation bounded

Only three existing references directly describe the affected behavior:

- `docs/reference/architecture/console-operations-polling.md` will state that result reads depend on
  migration 079, describe stored/fallback completion-time semantics, and retain the current bounded
  client retry behavior.
- `deploy/kind/README.md` will list 079 in the applied chain and replace the known-schema-gap note
  with the verified result-query behavior.
- `tests/env/README.md` will replace its stale result-schema deferral while retaining the separate
  idempotency-path limitation.

No general API, SDK, UI design, authentication, telemetry, or unrelated installation documentation
is changed.

## Rollout and Compatibility

The boot schema applier runs before the control plane declares schema readiness, so it applies 079
before new lifecycle writers serve traffic. Local/test bootstrap follows the same relative order.
The DDL is schema-compatible with older code because extra nullable columns do not change its
existing inserts or reads.

Normal rollback reverts application behavior and documentation while retaining both columns and
their data. Retaining the columns is schema-safe, but rolling back to code that can retry a terminal
operation without clearing `result` and `completed_at` is not mixed-version lifecycle-safe. Such a
rollback must prevent those retry paths or use a revision that preserves the clearing invariant.
Dropping either column is an exceptional destructive operation that is unsafe until every deployed
reader and writer referencing it has been removed. It also recreates C-11 if the current result
query is still reachable.

## Open Questions

None are blocking for this change. The status-contract mismatch tracked separately as C-12 remains
deliberately unresolved, including any decision to expand result-type classification for extended
terminal statuses.
