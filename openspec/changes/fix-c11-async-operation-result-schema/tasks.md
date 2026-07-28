# Tasks: Fix the async-operation result schema and lifecycle

## 1. Add and register migration 079

- [x] 1.1 Create
  `packages/provisioning-orchestrator/src/migrations/079-async-operation-results.sql` with
  idempotent forward-only DDL that adds nullable `result JSONB` and
  `completed_at TIMESTAMPTZ` to `async_operations`.
  - Do not add a default, backfill, update, index, constraint, trigger, or executable down block.
  - Keep the migration safe on a fresh schema, an upgraded schema, and repeated application.
- [x] 1.2 Register 079 immediately after 078 and before 080 in
  `apps/control-plane/governance-schema.mjs`.
- [x] 1.3 Register the same dependency-safe order in
  `apps/control-plane/required-migrations.txt` and the async-operation migration loop in
  `tests/env/up.sh`.
- [x] 1.4 Update the unit and black-box governance bootstrap guards to require 079, assert
  `078 < 079 < 080`, and assert that the boot-applied SQL contains both exact column definitions.
- [x] 1.5 Search all executable and manifest references to the 073–078 async-operation chain and
  confirm no canonical runner or list omits 079.

## 2. Make the repository lifecycle own result data

- [x] 2.1 Extend async-operation creation/model persistence so new `pending` operations have null
  `result` and `completed_at` without relying on a database default.
- [x] 2.2 Add a bounded result-sanitization boundary for terminal success data.
  - Accept only JSON-compatible operation-history output.
  - Preserve safe `summary`/`message` content used by the existing query projection.
  - Reject, remove, or redact credentials, passwords, secrets, tokens, API keys, private keys,
    connection strings, raw stack traces, internal paths, and equivalent sensitive/internal
    material before persistence.
  - Do not expose the stored raw result through the query response, logs, metrics, or audit event.
  - Require object `summary` and `message` values to be strings or null.
  - Reject common provider-token values, HTTPS userinfo, credential-key aliases, and internal
    runtime paths.
  - Reject accessors, prototype-affecting keys, and NUL or unpaired UTF-16 surrogates in field
    names or string values before any durable JSONB write.
  - Reject Proxy objects before invoking traps and ignore inherited serialization hooks while
    preserving ordinary Object/Array results.
- [x] 2.3 Update the canonical repository transition path so entering `completed` writes the
  optional sanitized result and sets `completed_at` to the same instant as the terminal
  `updated_at`.
- [x] 2.4 Update repository terminal transitions to `failed`, `timed_out`, and `cancelled` so they
  write a null result and set `completed_at` to the terminal transition instant.
- [x] 2.5 Keep `pending`, `running`, and `cancelling` lifecycle states null for both result fields.
  Preserve existing status validation, transition history, error/cancellation fields, and
  transaction boundaries.
- [x] 2.6 Ensure failure-classification and manual-intervention updates preserve existing
  `result` and `completed_at`, including when they update classification fields or `updated_at`
  after a terminal transition.
- [x] 2.7 Serialize every non-null normalized result explicitly and bind it as JSONB so safe
  objects, arrays, strings, numbers, and booleans round-trip through PostgreSQL.

## 3. Clear terminal values on every retry path

- [x] 3.1 Update `atomicResetToRetry` so an ordinary failed-operation retry atomically clears both
  `result` and `completed_at` while returning the operation to `pending`.
- [x] 3.2 Update the supervised retry-override write to clear both fields under the existing
  tenant predicate and transaction.
- [x] 3.3 Preserve retry attempt counting, correlation changes, intervention-flag handling,
  transition history, events, responses, authorization, and tenant isolation.

## 4. Converge durable saga terminal writes

- [x] 4.1 Replace the direct async-operation status SQL used by durable saga completion and failure
  in `apps/control-plane/saga.mjs` with the canonical repository lifecycle.
- [x] 4.2 On saga completion, normalize before the first durable write, pass the same safe value to
  both stores, and omit an unsafe optional value with a bounded content-free warning. On failure,
  persist and mirror the same trimmed safe error summary, bounded to 4096 UTF-8 bytes, with
  credential-free bounded code and failed-step fields detached without invoking accessors or
  Proxy traps or inherited serialization hooks.
- [x] 4.3 Ensure terminal status, result, completion time, and transition history are written once;
  remove any duplicate hand-written terminal transition insert.
- [x] 4.4 Preserve the saga-run record, compensation execution, best-effort async-operation mirror,
  operation log messages, and failure containment. Do not refactor the separate saga engine.

## 5. Preserve the result query contract and access behavior

- [x] 5.1 Keep the current result response fields and naming:
  `queryType`, `operationId`, `status`, `resultType`, `summary`, `failureReason`, `retryable`, and
  `completedAt`.
- [x] 5.2 Keep the current completed/success, failed/failure, and other-state/pending projection;
  do not expand status enums or generated/internal contracts under C-11.
- [x] 5.3 Prefer stored `completed_at` and retain `updated_at` as the read-time fallback for all
  legacy domain-terminal rows. Return no completion time for pending, running, or cancelling rows,
  even if stale data exists.
- [x] 5.4 Preserve result lookup by operation and verified tenant, missing/untrusted identity
  behavior, cross-tenant filter rejection, wrong-tenant/unknown `404` behavior, and current
  superadmin resolution.
- [x] 5.5 Preserve the existing successful-query correlation header,
  `console.async-operation.accessed` audit publication, `async_operation_query_completed`
  structured log, and query metrics. Do not add raw result data or new audit/telemetry fields.
- [x] 5.6 Defensively type-guard summary and failure-message projection so legacy non-string JSON
  returns null and stays compatible with the internal response contract.
- [x] 5.7 Keep `/healthz` as database liveness; return `503` from `/readyz` and mapped routes until
  schema/recovery succeeds; preserve non-zero exit after migration retry exhaustion.
- [x] 5.8 Protect server-owned identity/method/path action parameters from flattened request
  defaults, query, body, and matched path values, with a route-construction regression.
- [x] 5.9 Project `failureReason` and `retryable` only for failed results, including legacy rows
  with stale error metadata.

## 6. Replace masking fixtures with real PostgreSQL regression coverage

- [x] 6.1 Refactor the PostgreSQL async-operation query integration setup so it applies the actual
  073, 074, 075, 076, 078, and 079 migration files in order to an isolated real PostgreSQL
  database/schema. Remove the handcrafted `CREATE TEMP TABLE async_operations` definition that
  already declares the missing columns.
- [x] 6.2 Apply the real chain twice and assert both runs succeed. Query PostgreSQL catalogs to
  verify exact types, nullability, no defaults, no dedicated index, and canonical placement after
  078/before 080.
- [x] 6.3 Where the harness can checkpoint before 079, assert the real
  `getOperationResult` fails with SQLSTATE `42703`, then apply only 079 and prove the unchanged
  repository call succeeds. Do not emulate the error with a mock.
- [x] 6.4 Use the real repository lifecycle and actual PostgreSQL rows to cover:
  - create/pending and running with both fields null;
  - completed with safe result, stable summary, and terminal timestamp;
  - failed with null result, failure projection, and terminal timestamp;
  - timed-out and cancelled terminal writers with null result and terminal timestamp;
  - a legacy terminal null `completed_at` row using `updated_at`; and
  - later failure classification preserving terminal values.
- [x] 6.5 Exercise ordinary retry and supervised retry override against real PostgreSQL and assert
  both return the operation to `pending` with null `result` and null `completed_at`.
- [x] 6.6 Exercise durable saga completion and failure and assert they use the repository
  lifecycle, produce one terminal transition, and retain the existing saga/log behavior.
- [x] 6.7 Exercise the real async-operation query action and repository for completed, failed, and
  pending result responses. Assert exact `200` response shape and no raw result field.
- [x] 6.8 Retain real-action controls proving detail and logs return `200`, while a wrong-tenant
  operation ID and an unknown operation ID each return the same `404` behavior.
- [x] 6.9 Capture existing successful access side effects with injected local collectors: the
  correlation header, access-audit payload, structured completion log, and metric annotations must
  remain present and must not include the stored result.
- [x] 6.10 Add adversarial result cases proving sensitive keys and values cannot be stored or
  returned. Keep these cases local and deterministic.
- [x] 6.11 Retain mock-backed unit tests only for pure model/projection edge cases; do not treat
  mocks or handcrafted tables as migration/schema acceptance evidence.
- [x] 6.12 Add a dedicated package command that fails clearly without a database URL, and run it
  unconditionally in CI against a PostgreSQL 16 service.
- [x] 6.13 Add an accessor-backed result regression proving validation and durable serialization
  cannot observe different values.
- [x] 6.14 Add regressions for safe authentication prose, actual authorization credentials,
  prototype-affecting keys, PostgreSQL-incompatible text, and canonical bounded saga failures.

## 7. Update only directly relevant documentation

- [x] 7.1 Update `docs/reference/architecture/console-operations-polling.md` with migration 079,
  terminal result/completion persistence, legacy `updated_at` fallback, and the focused
  PostgreSQL verification command while retaining the existing bounded polling/retry behavior.
- [x] 7.2 Update `deploy/kind/README.md` to list 079 in the async-operation chain and replace the
  known result-schema-gap note with the verified result-query outcome.
- [x] 7.3 Update the stale `tests/env/README.md` result-schema statement while preserving the
  separate idempotency-path deferral.
- [x] 7.4 Qualify rollback documentation: retaining the columns is schema-safe, but retry code that
  does not clear terminal fields is not mixed-version lifecycle-safe.
- [x] 7.5 Confirm no general API, SDK, UI design, authentication, telemetry, installation, or
  unrelated reference document changes are included.

## 8. Validate and review

- [x] 8.1 Run focused async-operation unit tests for model transitions, repository projection,
  retry, retry override, timeout/cancel/orphan writers, and saga behavior.
- [x] 8.2 Run the focused real-PostgreSQL migration/repository/action suite with its database
  connection configured and record completed, failed, pending, legacy, isolation, and
  idempotency results.
- [x] 8.3 Run governance schema unit and black-box bootstrap tests.
- [x] 8.4 Run `openspec validate fix-c11-async-operation-result-schema --strict`.
- [x] 8.5 Run Markdown lint on the changed OpenSpec and directly relevant documentation files,
  then run `git diff --check`.
- [x] 8.6 Review the final diff and confirm it changes only the additive migration and canonical
  registrations, async-operation lifecycle/query writers, schema readiness, the dedicated CI
  regression, focused tests, this OpenSpec package, and directly relevant references.
- [x] 8.7 Confirm C-12, C-13, C-17, authentication/telemetry redesign, production UI redesign,
  unrelated changes, destructive rollback, live deployment, and Kubernetes access remain
  excluded.

> Live deployment and Kubernetes verification are outside this change and SHALL NOT be run as part
> of C-11 implementation.
