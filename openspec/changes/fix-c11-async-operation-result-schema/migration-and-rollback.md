# Migration and rollback note

## Forward migration

Migration 079 is an additive schema repair:

```sql
ALTER TABLE async_operations
  ADD COLUMN IF NOT EXISTS result JSONB,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
```

The implementation file is
`packages/provisioning-orchestrator/src/migrations/079-async-operation-results.sql`. It is applied
after `078-retry-semantics-intervention.sql` and before `080-pg-capture-config.sql`.

The migration has these deliberate properties:

- both columns are nullable;
- neither column has a default;
- existing rows are not updated or backfilled;
- no index, constraint, or trigger is added;
- rerunning the migration is safe because both additions use `IF NOT EXISTS`; and
- existing domain-terminal rows retain null `completed_at` and use the query's `updated_at`
  compatibility fallback.

The migration file must contain forward DDL only. It must not contain an executable down section
because `tests/env/up.sh` passes complete migration files directly to `psql`, and normal rollback
does not drop the columns.

## Pre-rollout checks

Before application code that writes the new fields serves traffic, the schema application path
SHALL verify:

1. migration 079 is present in every canonical list;
2. its position is after 078 and before 080;
3. the actual 073–079 chain succeeds against PostgreSQL;
4. a second application succeeds without modifying existing values; and
5. PostgreSQL reports `result` as nullable `jsonb` with no default and `completed_at` as nullable
   `timestamp with time zone` with no default.

The control-plane boot path applies the migration set before schema readiness. A failed migration
must therefore keep `/readyz` and mapped routes at `503`; retry exhaustion exits the process rather
than serving lifecycle writers against the old shape. `/healthz` remains a database-liveness probe.

## Normal rollback

Normal rollback leaves `async_operations.result` and `async_operations.completed_at` in place.
Rollback may revert the application lifecycle changes, tests, and focused documentation, but it
does not reverse the additive DDL.

This is the safe posture because:

- older application revisions ignore extra nullable columns;
- retaining the columns preserves any operation result and terminal timestamp already written;
- no default, index, trigger, or constraint remains active against older code; and
- the current result repository continues to select both columns.

No data restoration step is required when rolling back only the application because no historical
rows were rewritten by migration 079.

Retaining the columns is schema-safe, but it does not make every older application revision
mixed-version lifecycle-safe. In particular, code that moves a terminal operation back to
`pending` without clearing `result` and `completed_at` can leave stale success data and a stale
terminal timestamp visible during retry. An application rollback must therefore disable terminal
retry paths until all writers preserve the clearing invariant, or roll back only to a revision that
already clears both fields.

## Exceptional destructive removal

Dropping either column is not a normal rollback. It destroys stored lifecycle data and recreates the
schema mismatch while any result reader or lifecycle writer still references the fields.

If a separate, explicitly approved destructive change ever removes the columns, all of the
following SHALL be true first:

- all deployed result readers and lifecycle writers that reference either column have been removed
  or disabled;
- stored values have been backed up or formally accepted as disposable;
- the operation-result endpoint has a compatible schema-independent implementation or is
  unavailable by an approved contract change;
- the destructive DDL is reviewed and run as its own migration; and
- post-removal verification proves the result route does not execute the current selecting query.

The destructive statement would be equivalent to:

```sql
ALTER TABLE async_operations
  DROP COLUMN IF EXISTS result,
  DROP COLUMN IF EXISTS completed_at;
```

It is intentionally absent from migration 079. Executing it while the current
`getOperationResult` remains reachable will restore the HTTP `500`/SQLSTATE `42703` failure.

## Verification and recovery

Forward verification uses a real PostgreSQL catalog and the real result repository/action. It
checks completed, failed, pending, all domain-terminal legacy-null fallbacks, forced nonterminal
null timestamps, and tenant-scoped `404` controls. The dedicated package command fails clearly
without a database URL, and CI runs it against PostgreSQL 16.

If migration application fails before the columns exist, correct the migration registration or
database error and rerun the idempotent migration before restoring service readiness. Do not
substitute a handcrafted schema or a query that returns constant null fields as a recovery, because
either approach hides the lifecycle compatibility defect rather than repairing it.
