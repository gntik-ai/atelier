# Tasks: Workspace Scheduling & Automation (US-DX-02-T02)

**Feature Branch**: `086-workspace-scheduling-automation`
**Spec**: `specs/086-workspace-scheduling-automation/spec.md`
**Plan**: `specs/086-workspace-scheduling-automation/plan.md`
**Task**: US-DX-02-T02 — Implementar scheduling/automatizaciones cuando el subsistema esté habilitado en el diseño final
**Epic**: EP-17 — Realtime, webhooks y experiencia de desarrollador
**Status**: Ready for implementation

## Format: `[ID] [P?] [Story?] Description with exact file path`

- **[P]**: Parallelizable (different files, no shared state dependency)
- **[US#]**: Maps to user story in spec.md
- All paths relative to repo root

---

## File-Path Map (Implementation Reference)

| File | Purpose | Phase |
|---|---|---|
| `services/scheduling-engine/package.json` | ESM package manifest for scheduling-engine | 1 |
| `services/scheduling-engine/src/cron-validator.mjs` | Cron expression parsing, validation, next-run calculation | 2 |
| `services/scheduling-engine/src/job-model.mjs` | Pure-functional scheduled job entity model and state transitions | 2 |
| `services/scheduling-engine/src/execution-model.mjs` | Execution entity model helpers | 2 |
| `services/scheduling-engine/src/quota.mjs` | Quota evaluation helpers (max jobs, interval floor) | 2 |
| `services/scheduling-engine/src/audit.mjs` | Audit event builders for Kafka publication | 2 |
| `services/scheduling-engine/src/config-model.mjs` | SchedulingConfiguration read/write helpers | 2 |
| `services/scheduling-engine/migrations/001-scheduling-tables.sql` | DDL for scheduling_configurations, scheduled_jobs, scheduled_executions | 2 |
| `services/scheduling-engine/actions/scheduling-management.mjs` | OpenWhisk action: CRUD + lifecycle management + config + summary | 3 |
| `services/scheduling-engine/actions/scheduling-trigger.mjs` | OpenWhisk action: cron-driven wake-up, due-job detection, missed-window logging | 4 |
| `services/scheduling-engine/actions/scheduling-job-runner.mjs` | OpenWhisk action: invokes target function, records execution, failure tracking | 5 |
| `tests/unit/cron-validator.test.mjs` | Unit tests for cron-validator | 2 |
| `tests/unit/job-model.test.mjs` | Unit tests for job-model state machine | 2 |
| `tests/unit/execution-model.test.mjs` | Unit tests for execution-model helpers | 2 |
| `tests/unit/quota.test.mjs` | Unit tests for quota helpers | 2 |
| `tests/unit/audit.test.mjs` | Unit tests for audit event builders | 2 |
| `tests/unit/config-model.test.mjs` | Unit tests for config-model | 2 |
| `tests/integration/scheduling-management-action.test.mjs` | Integration tests: job + config lifecycle with PG | 3 |
| `tests/integration/scheduling-trigger.test.mjs` | Integration tests: due-job detection, missed windows, duplicate prevention | 4 |
| `tests/integration/scheduling-job-runner.test.mjs` | Integration tests: execution recording, failure tracking, auto-errored transition | 5 |
| `tests/contracts/scheduling-api.contract.test.mjs` | Contract tests: request/response shapes and error envelopes | Polish |
| `tests/e2e/workspace-scheduling/README.md` | E2E scenario matrix documentation | Polish |
| `deploy/apisix/routes/scheduling.yaml` | APISIX route manifest for `/v1/scheduling/**` | Polish |
| `deploy/helm/scheduling-engine-values.yaml` | Helm values: env vars, secrets, OpenWhisk action/alarm manifests | Polish |

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish the `scheduling-engine` service skeleton and confirm ESM project tooling.

- [ ] T001 Create `services/scheduling-engine/` directory structure (`src/`, `actions/`, `migrations/`) and `services/scheduling-engine/package.json` with `"type": "module"`, `node:test` runner config, and declared dependencies (`pg`, `kafkajs`, `cron-parser` or equivalent, `node:crypto`)
- [ ] T002 [P] Add `services/scheduling-engine/` entry to pnpm workspace config in `pnpm-workspace.yaml` so the new package is recognized by the monorepo
- [ ] T003 [P] Create `services/scheduling-engine/.eslintrc.cjs` inheriting the repo ESLint config and add a `lint` script to `package.json`

**Checkpoint**: `pnpm install` resolves without errors; `pnpm --filter scheduling-engine lint` runs (no source yet — just confirming tooling).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Database schema and all pure-functional modules that every action depends on. No user story work can start until this phase is complete.

**⚠️ CRITICAL**: All actions (Phases 3–5) depend on these files and the migration being applied.

- [ ] T004 Create PostgreSQL migration `services/scheduling-engine/migrations/001-scheduling-tables.sql` with `CREATE TABLE IF NOT EXISTS` DDL for all three tables (`scheduling_configurations`, `scheduled_jobs`, `scheduled_executions`) and all indexes defined in plan.md §4.1; use `IF NOT EXISTS` guards on all `CREATE INDEX` statements; apply to dev/CI database
- [ ] T005 [P] Create `services/scheduling-engine/src/cron-validator.mjs` — export `validateCronExpression(expr)` (5-field UNIX only; rejects 6-field seconds-precision; returns `{valid, error}`), `nextRunAt(expr, fromDate)` (returns next ISO8601 timestamp), `minimumIntervalSeconds(expr)` (returns the minimum possible interval in seconds between any two consecutive triggers for the given expression), `assertAboveFloor(expr, floorSeconds)` (throws descriptive error if `minimumIntervalSeconds(expr) < floorSeconds`)
- [ ] T006 [P] Create `services/scheduling-engine/src/job-model.mjs` — export `buildJobRecord(input, context)` (constructs persisted record with defaults), `VALID_TRANSITIONS` map, `canTransition(currentStatus, targetStatus)`, `applyTransition(job, targetStatus)` (throws on invalid transition), `incrementFailureCount(job)` (returns updated job; sets status to `errored` when `consecutive_failure_count >= max_consecutive_failures`), `resetFailureCount(job)`, `applyNextRunAt(job, expr, fromDate)` (recalculates `next_run_at` from cron expression)
- [ ] T007 [P] Create `services/scheduling-engine/src/execution-model.mjs` — export `buildExecutionRecord(job, scheduledAt, correlationId)` (status: `running`), `buildMissedExecutionRecord(job, scheduledAt)` (status: `missed`), `resolveOutcome(startedAt, finishedAt, openWhiskResult)` (returns `succeeded | failed | timed_out`), `finalizeExecution(record, outcome, errorSummary)` (returns updated record with `finished_at`, `duration_ms`, `status`)
- [ ] T008 [P] Create `services/scheduling-engine/src/quota.mjs` — export `checkJobCreationQuota(currentActiveCount, maxActiveJobs)` (returns `{allowed, reason}`), `checkResumeQuota(currentActiveCount, maxActiveJobs)` (same shape), `assertCronFloor(expr, minIntervalSeconds)` (delegates to `cron-validator.mjs`), `getActiveJobCount(pg, tenantId, workspaceId)` (SQL count query, excludes deleted)
- [ ] T009 [P] Create `services/scheduling-engine/src/audit.mjs` — export builders: `jobCreatedEvent`, `jobUpdatedEvent`, `jobPausedEvent`, `jobResumedEvent`, `jobDeletedEvent`, `jobErroredEvent`, `executionSucceededEvent`, `executionFailedEvent`, `executionTimedOutEvent`, `executionMissedEvent`, `capabilityToggledEvent`, `quotaExceededEvent` — each returns Kafka message with `{tenantId, workspaceId, actorId, action, resourceId, timestamp}` and NO job payload or sensitive data
- [ ] T010 [P] Create `services/scheduling-engine/src/config-model.mjs` — export `getConfig(pg, tenantId, workspaceId)` (returns workspace config if exists, falls back to tenant-wide row, falls back to env-var defaults), `upsertConfig(pg, tenantId, workspaceId, patch)`, `isSchedulingEnabled(config)`, `getActiveJobsToSuspend(pg, tenantId, workspaceId)` (returns IDs of all `active` jobs in the workspace for bulk pause on disable)
- [ ] T011 [P] Write `tests/unit/cron-validator.test.mjs` — unit tests covering: valid 5-field expressions parse without error; invalid expressions (wrong field count, out-of-range values, bad syntax) are rejected with descriptive errors; 6-field seconds-precision expressions are rejected explicitly; `nextRunAt` is deterministic given reference time + expression; expressions below floor are rejected by `assertAboveFloor`; `minimumIntervalSeconds` returns correct value for daily/hourly/every-5-minutes expressions
- [ ] T012 [P] Write `tests/unit/job-model.test.mjs` — unit tests covering: job construction with required fields; status transitions active→paused, paused→active, active→errored, any→deleted; invalid transitions (e.g., deleted→active) throw; `consecutive_failure_count` increments on failure; auto-errored transition fires at threshold; `next_run_at` recalculated on `applyNextRunAt`; `resetFailureCount` zeroes the counter
- [ ] T013 [P] Write `tests/unit/execution-model.test.mjs` — unit tests covering: `buildExecutionRecord` shape; `buildMissedExecutionRecord` sets status `missed`; `resolveOutcome` correctly maps OpenWhisk success/error/timeout; `finalizeExecution` sets `finished_at`, `duration_ms`, `status` correctly
- [ ] T014 [P] Write `tests/unit/quota.test.mjs` — unit tests covering: count-based create check (at-limit returns `{allowed:false}`, under-limit returns `{allowed:true}`); resume quota check same semantics; `assertCronFloor` delegates to validator correctly; env-var-driven default values
- [ ] T015 [P] Write `tests/unit/audit.test.mjs` — unit tests covering: all twelve builders return required fields (`tenantId`, `workspaceId`, `actorId`, `action`, `resourceId`, `timestamp`); no job `payload` or target function arguments appear in any audit message; `capabilityToggledEvent` includes `{enabled, pausedJobCount}` in metadata but not payloads
- [ ] T016 [P] Write `tests/unit/config-model.test.mjs` — unit tests covering: `getConfig` returns workspace override when present; falls back to tenant-wide default when no workspace row; falls back to env-var defaults when no DB rows; `isSchedulingEnabled` returns correct boolean; `getActiveJobsToSuspend` returns only `active` (not `paused`/`errored`) job IDs

**Checkpoint**: All unit tests pass (`pnpm --filter scheduling-engine test`); ≥90% line coverage on all `src/` modules; migration applies cleanly to a fresh database with no errors.

---

## Phase 3: User Story 1 & 2 — Job CRUD and Lifecycle Management (Priority: P1) 🎯 MVP

**Goal**: Developers can create, read, update, pause, resume, and delete scheduled jobs. Workspace admins can enable/disable scheduling and view a summary.

**Independent Test**: POST /v1/scheduling/jobs returns 201 with next `nextRunAt`; subsequent GET /v1/scheduling/jobs returns paginated list; PATCH config `{schedulingEnabled: false}` pauses all active jobs.

- [ ] T017 [US1,US4] Implement `services/scheduling-engine/actions/scheduling-management.mjs` — OpenWhisk action handler with routing by `method`+`path`; implement `POST /jobs` handler: extract `tenantId`/`workspaceId` from JWT claims (never trust body), validate cron expression via `cron-validator.mjs`, check quota via `quota.mjs`, check scheduling enabled via `config-model.mjs`, validate `targetAction` exists in workspace function catalogue, insert into `scheduled_jobs` with `next_run_at` pre-computed, publish `jobCreatedEvent` to Kafka, return 201 with full job resource
- [ ] T018 [US1] Add `GET /jobs` handler to `scheduling-management.mjs` — paginated list using cursor (job `id` ordering), optional `status` filter (`active|paused|errored`); all SQL queries include `WHERE tenant_id = $1 AND workspace_id = $2 AND deleted_at IS NULL`; returns items with `nextRunAt`, `lastTriggeredAt`, `consecutiveFailureCount`, timestamps
- [ ] T019 [US1] Add `GET /jobs/:id` handler to `scheduling-management.mjs` — returns full job detail including `payload`; returns 404 if not found or belongs to different workspace/tenant
- [ ] T020 [US2] Add `PATCH /jobs/:id` handler to `scheduling-management.mjs` — allows updating `name`, `cronExpression`, `targetAction`, `payload`; re-validates cron expression and floor on change; recalculates `next_run_at` on cron change; publishes `jobUpdatedEvent`; returns 200 with updated resource
- [ ] T021 [US2] Add `POST /jobs/:id/pause` handler to `scheduling-management.mjs` — transitions `active` → `paused` via `job-model.mjs`; returns `409 JOB_NOT_ACTIVE` if not active; publishes `jobPausedEvent`; returns 200 with updated resource
- [ ] T022 [US2] Add `POST /jobs/:id/resume` handler to `scheduling-management.mjs` — transitions `paused` → `active`; checks scheduling still enabled (`403 SCHEDULING_DISABLED` if not); checks quota won't be exceeded (`409 QUOTA_EXCEEDED` if so); recalculates `next_run_at`; returns `409 JOB_NOT_PAUSED` if not paused; publishes `jobResumedEvent`; returns 200 with updated resource
- [ ] T023 [US2] Add `DELETE /jobs/:id` handler to `scheduling-management.mjs` — soft-delete: sets `deleted_at = now()`, `status = 'deleted'`; publishes `jobDeletedEvent`; returns 204
- [ ] T024 [US3] Add `GET /summary` handler to `scheduling-management.mjs` — returns aggregate counts of active/paused/errored/deleted jobs plus quota used/limit and `schedulingEnabled` flag for the workspace
- [ ] T025 [US4] Add `GET /config` handler to `scheduling-management.mjs` — returns current `scheduling_configurations` row for workspace (or tenant default); requires workspace admin role claim
- [ ] T026 [US4] Add `PATCH /config` handler to `scheduling-management.mjs` — partial update of `schedulingEnabled`, `maxActiveJobs`, `minIntervalSeconds`, `maxConsecutiveFailures`; on `schedulingEnabled: false`, synchronously bulk-pause all active jobs via `getActiveJobsToSuspend` + batch UPDATE, include paused count in `capabilityToggledEvent`; on `schedulingEnabled: true`, emit toggle event only (jobs must be manually resumed); requires tenant-owner or platform-admin role claim
- [ ] T027 [US1,US2,US3,US4] Write `tests/integration/scheduling-management-action.test.mjs` — integration tests with PG: full lifecycle (create→read→update→pause→resume→delete); quota enforcement with jobs at limit; concurrent creates respect quota (advisory lock or `SELECT FOR UPDATE`); creating with scheduling disabled returns `403 SCHEDULING_DISABLED`; disabling scheduling synchronously pauses all active jobs; resuming with capability disabled returns `403 SCHEDULING_DISABLED`; updating cron expression recalculates `next_run_at`; wrong tenant/workspace returns 404; `GET /summary` returns correct aggregate counts; audit Kafka events emitted for all operations

**Checkpoint**: Integration tests for US1/US2/US3/US4 pass. Full job and config lifecycle verified; tenant isolation confirmed.

---

## Phase 4: Scheduling Trigger Action (Priority: P1) 🎯 MVP

**Goal**: The scheduler wake-up action correctly detects due jobs, logs missed executions, prevents duplicates, and updates `next_run_at`.

**Independent Test**: Seeding a job with `next_run_at <= now()` and invoking the trigger action results in a `running` execution row and updated `next_run_at`; a paused job is not picked up.

- [ ] T028 [US1] Implement `services/scheduling-engine/actions/scheduling-trigger.mjs` — OpenWhisk action invoked by alarm feed; queries `scheduled_jobs WHERE status = 'active' AND next_run_at <= now() AND deleted_at IS NULL`; for each due job: inserts `scheduled_executions` row with `INSERT ... ON CONFLICT (job_id, scheduled_at) DO NOTHING` (duplicate prevention); asynchronously invokes `scheduling-job-runner` per due job; updates `next_run_at` and `last_triggered_at` on each triggered job; checks `SCHEDULING_ENGINE_ENABLED` env var (exit early if `false`)
- [ ] T029 [US3] Add missed-window detection to `scheduling-trigger.mjs` — for each active job, if `last_triggered_at` is not null and the gap between `last_triggered_at` and now contains one or more skipped cron windows, insert a `missed` status execution row for each skipped window (up to a configurable cap to avoid flooding on long downtime); emit `executionMissedEvent` per missed window
- [ ] T030 [US1,US3] Write `tests/integration/scheduling-trigger.test.mjs` — integration tests with PG: due jobs with `next_run_at <= now()` are picked up; future jobs (`next_run_at > now()`) are skipped; `paused` and `deleted` jobs are not triggered; `ON CONFLICT DO NOTHING` prevents duplicate execution rows if trigger fires twice in the same window; `next_run_at` updated after trigger; missed-window detection inserts `missed` rows when `last_triggered_at` is far in the past; jobs from other tenants/workspaces not triggered by a single invocation (isolation); `SCHEDULING_ENGINE_ENABLED=false` causes early exit without DB writes

**Checkpoint**: Integration tests for trigger action pass. Due-job detection, duplicate prevention, missed-window logging, and early-exit gate all verified.

---

## Phase 5: Job Runner Action (Priority: P1) 🎯 MVP

**Goal**: Each job invocation is recorded as an execution with accurate outcome, duration, and failure tracking; auto-errored transition fires at threshold.

**Independent Test**: Invoking `scheduling-job-runner` with a job that has a valid target function records a `succeeded` execution; invoking with a function that throws records `failed` and increments `consecutive_failure_count`; at threshold the job transitions to `errored`.

- [ ] T031 [US1,US3] Implement `services/scheduling-engine/actions/scheduling-job-runner.mjs` — OpenWhisk action receiving `{jobId, executionId, scheduledAt, correlationId}`; fetches job record; verifies job still `active` (exits cleanly if deleted/paused/errored mid-flight); marks `scheduled_executions` row `started_at = now()`; invokes target OpenWhisk function with job `payload` and `correlation_id` header; on success: finalizes execution `succeeded`, resets `consecutive_failure_count`, publishes `executionSucceededEvent`; on failure/timeout: finalizes execution `failed` or `timed_out`, increments `consecutive_failure_count` via `job-model.mjs`; if threshold reached transitions job to `errored` and publishes `jobErroredEvent`; publishes `executionFailedEvent` or `executionTimedOutEvent` as appropriate
- [ ] T032 [US1,US3] Write `tests/integration/scheduling-job-runner.test.mjs` — integration tests with PG (OpenWhisk invocations mocked): successful invocation sets execution `succeeded`, `duration_ms` populated, `consecutive_failure_count` reset to 0; failed invocation sets `failed`, increments count; timeout sets `timed_out`, increments count; after `max_consecutive_failures` failures, job transitions to `errored` and `jobErroredEvent` emitted; execution row has correct `started_at`, `finished_at`, `duration_ms`; job already deleted/paused at run time exits cleanly without error

**Checkpoint**: Integration tests for job-runner pass. Execution lifecycle, failure escalation, and auto-errored transition all verified.

---

## Phase 6: Polish, Contracts & Deployment (Priority: P2)

**Purpose**: Contract tests, E2E scenario matrix, APISIX route manifest, and Helm values for deployment.

- [ ] T033 Write `tests/contracts/scheduling-api.contract.test.mjs` — contract assertions: POST /jobs request/response shape (all fields, correct types, `nextRunAt` ISO8601); GET /jobs pagination shape (`nextCursor` opaque string, `items` array with all documented fields); GET /jobs/:id includes `payload` field; GET /jobs/:id/executions pagination shape with all execution fields; GET /summary aggregate field types; PATCH /config `schedulingEnabled: false` side-effect returns updated config with no error; all documented error codes appear in `{code, message, details}` envelope shape
- [ ] T034 [P] Write `tests/e2e/workspace-scheduling/README.md` — documents all 13 E2E scenarios from plan.md §7.4 with: Scenario name, Setup steps, Test steps, Expected outcome, Kafka events expected — covering: happy path single execution, cron validation, interval below floor, quota exceeded, scheduling disabled create rejected, disable with active jobs, re-enable and resume, pause/resume lifecycle, consecutive failure auto-errored, missed execution on recovery, tenant isolation, cross-workspace isolation, delete cancels future triggers
- [ ] T035 [P] Create `deploy/apisix/routes/scheduling.yaml` — APISIX route manifest for `/v1/scheduling/**` pointing to `scheduling-management` OpenWhisk action with Keycloak JWT validation plugin; mirrors pattern established in `deploy/apisix/routes/` for prior services
- [ ] T036 [P] Create `deploy/helm/scheduling-engine-values.yaml` — Helm values with all env vars from plan.md §4.3 (`SCHEDULING_DEFAULT_MAX_ACTIVE_JOBS`, `SCHEDULING_DEFAULT_MIN_INTERVAL_SECONDS`, `SCHEDULING_DEFAULT_MAX_CONSECUTIVE_FAILURES`, `SCHEDULING_TRIGGER_INTERVAL_SECONDS`, `SCHEDULING_JOB_RUNNER_TIMEOUT_MS`, `SCHEDULING_EXECUTION_HISTORY_MAX_DAYS`, `SCHEDULING_ENABLED_BY_DEFAULT`, `SCHEDULING_ENGINE_ENABLED`), OpenWhisk action deploy manifests for all three actions, alarm feed registration for `scheduling-trigger` at `SCHEDULING_TRIGGER_INTERVAL_SECONDS` cadence

**Checkpoint**: Contract tests pass. E2E README documents all 13 scenarios. APISIX and Helm manifests ready to apply (validated as syntactically correct YAML). Branch passes CI lint and test suite.

---

## Dependency Order Summary

```text
Phase 1 (T001–T003)
    └─▶ Phase 2 (T004–T016) — all parallelizable within phase
            └─▶ Phase 3 (T017–T027) — CRUD + config
            └─▶ Phase 4 (T028–T030) — trigger action
            └─▶ Phase 5 (T031–T032) — job runner
                    └─▶ Phase 6 (T033–T036) — polish (all parallelizable within phase)
```

Phases 3, 4, and 5 can be worked in parallel once Phase 2 migrations and pure-functional modules are complete.

---

## Done Criteria (from plan.md §12)

- [ ] All three PostgreSQL tables exist and migration applies cleanly with no errors to a fresh database
- [ ] All pure-functional modules pass unit tests with ≥90% line coverage
- [ ] Management action integration tests pass the full job lifecycle (create, read, update, pause, resume, delete) and config lifecycle (enable, disable, re-enable)
- [ ] Disabling scheduling via PATCH config synchronously pauses all active jobs; resumed jobs require explicit resume call after re-enabling
- [ ] Trigger action integration tests confirm: due jobs are picked up, paused/deleted jobs are skipped, missed windows produce "missed" execution rows, duplicate invocations do not create duplicate execution rows
- [ ] Job-runner tests confirm: success → succeeded, error/timeout → failed or timed_out, consecutive failure threshold triggers auto-errored transition and emits audit event
- [ ] Contract tests pass for all documented request/response shapes and error envelopes
- [ ] E2E scenario README documents all 13 scenarios with setup, steps, and expected outcomes
- [ ] APISIX route for `/v1/scheduling/**` validated or documented in Helm values as a ready-to-apply route manifest
- [ ] OpenWhisk alarm feed for trigger action configured and verifiably firing at the expected cadence in CI
- [ ] Zero cross-tenant or cross-workspace data returned in any test scenario
- [ ] All management and execution lifecycle operations produce Kafka audit events with actor, action, resourceId, tenantId, workspaceId, and timestamp
- [ ] No job payload or sensitive data appears in any Kafka audit event
- [ ] Branch `086-workspace-scheduling-automation` passes CI lint and test suite
