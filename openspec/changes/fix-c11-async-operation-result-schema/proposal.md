# Change: Fix the async-operation result schema and lifecycle

## Why

C-11 is a confirmed schema-to-query defect. The real provisioning-orchestrator migration chain at
the current HEAD applies migrations 073, 074, 075, 076, and 078, but none of those migrations
creates `async_operations.result` or `async_operations.completed_at`.
`getOperationResult` nevertheless selects both columns. PostgreSQL therefore rejects the result
query with SQLSTATE `42703`, and the action surfaces an HTTP `500`.

The current-HEAD reproduction was run twice against actual PostgreSQL. In both runs, the result
query returned `500`/`42703`; the detail and log controls returned `200`; and the wrong-tenant and
unknown-operation controls returned `404`. Adding only nullable `result JSONB` and
`completed_at TIMESTAMPTZ` columns made the unchanged result action return `200`. This isolates the
root cause to the missing additive schema.

The failure affects the backend contract consumed by task-owning administrators and developers
(P1, P7, and P9) and platform operators (P3). It also produces a visible error for the adjacent
Operations console experience (P4), while tenant-scoped access (P10) and safe handling of
adversarial result content (P13) must remain intact.

## What Changes

- Add the idempotent additive migration
  `packages/provisioning-orchestrator/src/migrations/079-async-operation-results.sql`.
  It adds nullable `result JSONB` and `completed_at TIMESTAMPTZ` columns with no default,
  backfill, or index.
- Register migration 079 immediately after 078 and before 080 in every canonical migration
  application list and environment bootstrap.
- Make the async-operation repository lifecycle own result and terminal-time persistence:
  creation and nonterminal states have both fields null; completion stores an optional
  safe/sanitized result and a terminal timestamp; failure, timeout, and cancellation store a
  terminal timestamp and a null result.
- Make both ordinary retry and supervised retry override clear `result` and `completed_at` when
  returning an operation to `pending`.
- Keep later failure-classification and intervention updates from changing terminal result or
  completion-time values.
- Route durable saga completion and failure through the repository lifecycle instead of updating
  async-operation status with separate direct SQL.
- Preserve the current result-query response shape and classification, including the existing
  `updated_at` fallback for every legacy domain-terminal row whose `completed_at` is null and a
  forced null completion time for nonterminal rows.
- Gate `/readyz` and mapped control-plane routes on successful schema bootstrap and saga recovery
  while retaining `/healthz` as database liveness.
- Preserve current authentication, tenant scoping, wrong-tenant/unknown `404` behavior,
  superadmin behavior, access-audit publication, structured logging, and metrics.
- Replace schema-masking integration setup with an actual migration-chain test against real
  PostgreSQL and exercise the real repository and action through a non-skippable CI command.
- Update only the existing Operations polling reference, kind deployment note, and local test
  environment note that directly describe this query and migration chain.

## Personas and Observable Outcomes

- P1, P3, P7, and P9 can query completed, failed, and pending operation results without a
  schema-originated `500`. Completed operations expose the same safe summary projection and
  completion time; failed operations expose the same failure projection and completion time; and
  nonterminal operations remain pending with no result or completion time.
- P10 retains the current access boundary: an operation outside the caller's tenant is
  indistinguishable from an unknown operation through the operation result resource, and both
  return `404`.
- P4 sees the existing Operations console and result hook recover from the backend schema defect;
  no page, route, polling, copy, or visual redesign is required.
- P13 cannot use a completion payload to persist or return credentials, secrets, tokens,
  connection strings, stack traces, or equivalent sensitive/internal material.
- Backend operators can verify that the real migration chain is ordered and rerunnable and that
  the result branch no longer emits SQLSTATE `42703`.
- Successful result reads retain the current async-operation access audit event, structured
  completion log, correlation header, and query metrics. This change adds no audit or telemetry
  schema.

## Non-Goals

- No C-12 status-enum, terminal-status classification, or public/internal contract expansion.
- No C-13 operation-list filtering or pagination change.
- No C-17 malformed-operation-ID handling change.
- No authentication, authorization, tenant-isolation, audit, logging, metrics, tracing, or
  telemetry redesign.
- No public API route, response-field, raw-result exposure, SDK, or generated-contract change.
- No production web-console route, component, polling, interaction, copy, accessibility, or visual
  redesign.
- No new default, historical backfill, data rewrite, constraint, trigger, or index on the two
  columns.
- No unrelated migration cleanup, repository refactor, saga redesign, or status-machine change.
- No destructive rollback in the normal rollback path.
- No live deployment, Docker environment startup, or Kubernetes access.

## Exit Criteria

- The real migration chain contains 079 after 078 and before 080 everywhere canonical.
- Applying the chain to actual PostgreSQL creates nullable `result` (`jsonb`) and `completed_at`
  (`timestamp with time zone`) columns without defaults or a dedicated index, and applying the
  chain a second time succeeds without changing existing values.
- The unchanged result-query shape returns `200` through the real action for completed, failed, and
  pending rows created and transitioned through the real repository.
- Completed lifecycle writes persist an optional safe/sanitized result and terminal timestamp;
  failed, timed-out, and cancelled writes persist a null result and terminal timestamp.
- Both retry paths clear `result` and `completed_at`; failure classification preserves terminal
  values; and saga completion/failure uses the same repository lifecycle.
- Every legacy domain-terminal row with null `completed_at` returns the `updated_at` fallback;
  nonterminal rows return null even when stale storage contains `completed_at`.
- `/readyz` and mapped routes return `503` until schema/recovery succeeds, while `/healthz`
  continues to report database liveness and exhausted migration retries still exit.
- Detail and log controls remain `200`; wrong-tenant and unknown-operation result controls remain
  `404`; missing/untrusted authentication and cross-tenant filter behavior remain unchanged.
- Successful result reads preserve the current response fields, correlation header, access audit,
  structured log, and metrics without returning the stored raw result.
- The PostgreSQL acceptance test uses the actual migrations, repository, and action rather than a
  handcrafted table definition that already contains the missing columns.
- The focused documentation no longer describes the result branch as a known schema gap.
- `openspec validate fix-c11-async-operation-result-schema --strict` passes.

## Risks and Rollback

The forward schema change is additive and nullable. The main rollout risk is deploying lifecycle
writers before the migration is applied in a schema path, or registering 079 after a consumer that
expects it. Canonical ordering checks and a real PostgreSQL test pin 079 between 078 and 080 and
exercise the complete read/write path.

Persisted operation results can carry sensitive content if terminal writers bypass sanitization.
The repository lifecycle is therefore the single terminal-write boundary, and adversarial tests
cover both stored and returned data. The result API continues to return only its existing summary
projection, not the raw JSONB value.

Normal application rollback SHALL leave both columns in place. That retention is schema-safe
because older code ignores additive nullable columns. It is not, by itself, mixed-version
lifecycle-safe: a rolled-back writer that retries a terminal row without clearing `result` and
`completed_at` can expose stale terminal data. Rollback must disable that path or use code that
preserves the clearing invariant. Dropping the columns is destructive, discards terminal data, and
immediately reintroduces the C-11 `500` while `getOperationResult` still selects them. The detailed
migration and rollback posture is recorded in `migration-and-rollback.md`.
