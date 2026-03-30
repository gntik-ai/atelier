# Implementation Plan: US-DX-02-T02 — Workspace Scheduling & Automation

**Feature Branch**: `086-workspace-scheduling-automation`
**Spec**: `specs/086-workspace-scheduling-automation/spec.md`
**Task**: US-DX-02-T02
**Epic**: EP-17 — Realtime, webhooks y experiencia de desarrollador
**Story**: US-DX-02 — Webhooks, scheduling, documentación por workspace, OpenAPI/SDKs y catálogo de capacidades
**Status**: Ready for implementation
**Created**: 2026-03-30

---

## 1. Scope Summary

This task implements the workspace-scoped scheduling subsystem for the BaaS multi-tenant platform. It covers:

- Scheduled job lifecycle: create, read, update, pause, resume, soft-delete.
- Cron expression validation (5-field UNIX-style) with configurable minimum-interval floor.
- Trigger resolution and execution dispatch to registered serverless functions (Apache OpenWhisk actions).
- Execution history per job: status (succeeded / failed / timed-out / missed), duration, error summary.
- Quota enforcement: max active jobs per workspace; minimum interval per tenant.
- Tenant/workspace-level enablement toggle with automatic pause of active jobs on disable.
- Automatic transition to "errored" status after configurable consecutive failure count.
- Missed-execution detection on recovery (recorded as "missed", no back-filling).
- Full tenant/workspace isolation for all scheduling data.
- Audit events for all lifecycle transitions.

Out of scope for this task: outbound webhook delivery (T01), per-workspace documentation generation (T03), OpenAPI/SDK generation (T04), API key rotation (T05), capability catalogue (T06), and console UI (companion UI task).

---

## 2. Dependency Map

| Prior dependency | What this task consumes |
|---|---|
| US-DX-02-T01 — Outbound Webhooks | Established pattern for OpenWhisk action layout, Kafka audit publication, and PostgreSQL migration conventions; reused verbatim |
| US-GW-01 — API Gateway (APISIX) | Routes management API calls; enforces Keycloak JWT validation at gateway layer |
| Keycloak IAM | Authenticates and authorises management API callers; `tenantId` / `workspaceId` extracted from JWT |
| Apache OpenWhisk | Hosts scheduler-trigger action, execution dispatcher, and job-runner actions |
| Kafka event bus | Publishes all lifecycle and execution audit events; scheduler-trigger may also consume platform events if event-driven triggers are added in future |
| PostgreSQL | Persists scheduled jobs, execution history, and scheduling configuration |
| Existing async operation patterns (073–075) | State-machine, idempotency, and retry conventions reused for execution dispatch |
| Existing audit patterns (071, 073) | Kafka-based audit publication format reused |

---

## 3. Architecture and Component Boundaries

```text
┌──────────────────────────────────────────────────────────────────────┐
│  APISIX (API Gateway)                                                │
│  Route: /v1/scheduling/**  →  scheduling-management OpenWhisk action │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ JWT (Keycloak) — tenant/workspace claims
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  OpenWhisk Action: scheduling-management.mjs                         │
│  • CRUD + pause/resume on scheduled_jobs (PG)                        │
│  • Quota checks  • Capability enablement guard                       │
│  • Audit events → Kafka                                              │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ writes / reads PostgreSQL
                               ▼
              ┌────────────────────────────────────────┐
              │  PostgreSQL                            │
              │  scheduled_jobs                        │
              │  scheduled_executions                  │
              │  scheduling_configurations             │
              └────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│  OpenWhisk Alarm Feed / Cron Trigger                                 │
│  Platform-level periodic wake-up (e.g., every minute)               │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ fires at cadence
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  OpenWhisk Action: scheduling-trigger.mjs                            │
│  • Queries scheduled_jobs WHERE next_run_at <= now()                 │
│    AND status = 'active'                                             │
│  • Detects missed windows (gap > expected interval)                  │
│  • Records 'missed' execution entries for skipped windows            │
│  • Enqueues job-runner invocations per due job                       │
│  • Updates next_run_at for each triggered job                        │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ invokes async per due job
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  OpenWhisk Action: scheduling-job-runner.mjs                         │
│  • Creates scheduled_execution row (status: running)                 │
│  • Invokes target OpenWhisk function with job payload                │
│  • Records outcome: succeeded / failed / timed-out                   │
│  • Increments consecutive_failure_count on failure                   │
│  • Auto-transitions job to 'errored' if threshold exceeded           │
│  • Emits audit event → Kafka                                         │
└──────────────────────────────────────────────────────────────────────┘
```

### Invariants

- All management actions extract `tenantId` and `workspaceId` from verified JWT claims; no trust of body-supplied tenant values.
- The scheduling-trigger action reads only jobs belonging to enabled workspaces; jobs for disabled workspaces are skipped (not triggered).
- The job-runner never crosses workspace or tenant boundaries within a single invocation.
- Capability enablement is checked on every create request; if disabled after jobs exist, those jobs are paused by the management action and cannot be resumed until re-enabled.
- Cron expressions are validated against a minimum-interval floor (configurable per tenant) at both create and update time.

---

## 4. Data Model

### 4.1 PostgreSQL DDL

```sql
-- Tenant/workspace-level scheduling configuration
CREATE TABLE scheduling_configurations (
    id                             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                      TEXT NOT NULL,
    workspace_id                   TEXT,              -- NULL means tenant-wide default
    scheduling_enabled             BOOLEAN NOT NULL DEFAULT FALSE,
    max_active_jobs                INT NOT NULL DEFAULT 10,
    min_interval_seconds           INT NOT NULL DEFAULT 60,    -- minimum cron resolution (floor)
    max_consecutive_failures       INT NOT NULL DEFAULT 5,     -- before auto-errored
    created_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, workspace_id)
);

CREATE INDEX idx_sc_tenant ON scheduling_configurations (tenant_id);

-- Scheduled jobs
CREATE TABLE scheduled_jobs (
    id                             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                      TEXT NOT NULL,
    workspace_id                   TEXT NOT NULL,
    name                           TEXT NOT NULL,
    cron_expression                TEXT NOT NULL,             -- 5-field UNIX cron
    target_action                  TEXT NOT NULL,             -- OpenWhisk function identifier
    payload                        JSONB NOT NULL DEFAULT '{}',
    status                         TEXT NOT NULL DEFAULT 'active',
    -- status: active | paused | errored | deleted
    consecutive_failure_count      INT NOT NULL DEFAULT 0,
    max_consecutive_failures       INT NOT NULL DEFAULT 5,    -- from config at creation time
    next_run_at                    TIMESTAMPTZ,               -- pre-computed after each trigger
    last_triggered_at              TIMESTAMPTZ,
    created_by                     TEXT NOT NULL,
    created_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at                     TIMESTAMPTZ
);

CREATE INDEX idx_sj_tenant_workspace ON scheduled_jobs (tenant_id, workspace_id)
    WHERE deleted_at IS NULL;
CREATE INDEX idx_sj_status_next_run ON scheduled_jobs (status, next_run_at)
    WHERE status = 'active' AND deleted_at IS NULL;

-- Execution history (one row per triggered invocation)
CREATE TABLE scheduled_executions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id              UUID NOT NULL REFERENCES scheduled_jobs(id),
    tenant_id           TEXT NOT NULL,
    workspace_id        TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'running',
    -- status: running | succeeded | failed | timed_out | missed
    scheduled_at        TIMESTAMPTZ NOT NULL,               -- the cron window this execution targets
    started_at          TIMESTAMPTZ,
    finished_at         TIMESTAMPTZ,
    duration_ms         INT,
    error_summary       TEXT,
    correlation_id      TEXT,                              -- for distributed trace linking
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_se_job ON scheduled_executions (job_id);
CREATE INDEX idx_se_tenant_workspace ON scheduled_executions (tenant_id, workspace_id);
CREATE INDEX idx_se_status ON scheduled_executions (status);
```

### 4.2 Kafka Topics

| Topic | Purpose | Retention |
|---|---|---|
| `console.scheduling.job.created` | Audit — job created | 30d |
| `console.scheduling.job.updated` | Audit — job updated | 30d |
| `console.scheduling.job.paused` | Audit — job paused | 30d |
| `console.scheduling.job.resumed` | Audit — job resumed | 30d |
| `console.scheduling.job.deleted` | Audit — job soft-deleted | 30d |
| `console.scheduling.job.errored` | Operational — job auto-transitioned to errored | 30d |
| `console.scheduling.execution.succeeded` | Operational metrics | 7d |
| `console.scheduling.execution.failed` | Operational alert trigger | 30d |
| `console.scheduling.execution.timed_out` | Operational alert trigger | 30d |
| `console.scheduling.execution.missed` | Operational — missed window logged | 14d |
| `console.scheduling.capability.toggled` | Audit — enablement on/off for tenant/workspace | 30d |
| `console.scheduling.quota.exceeded` | Audit — quota-exceeded event | 30d |

### 4.3 Environment Variables

| Variable | Description | Default |
|---|---|---|
| `SCHEDULING_DEFAULT_MAX_ACTIVE_JOBS` | Default max active jobs per workspace | `10` |
| `SCHEDULING_DEFAULT_MIN_INTERVAL_SECONDS` | Minimum allowed cron interval (floor) | `60` |
| `SCHEDULING_DEFAULT_MAX_CONSECUTIVE_FAILURES` | Failures before auto-errored | `5` |
| `SCHEDULING_TRIGGER_INTERVAL_SECONDS` | How often the alarm trigger fires | `60` |
| `SCHEDULING_JOB_RUNNER_TIMEOUT_MS` | Max allowed execution time for a job invocation | `300000` (5 min) |
| `SCHEDULING_EXECUTION_HISTORY_MAX_DAYS` | Retention for execution history rows | `30` |
| `SCHEDULING_ENABLED_BY_DEFAULT` | Whether new workspaces have scheduling on | `false` |

---

## 5. API Contracts

### 5.1 Management REST API

Base path: `/v1/scheduling` (tenant/workspace context from JWT)

#### POST /v1/scheduling/jobs

Create a new scheduled job.

**Request body**:

```json
{
  "name": "hourly-cleanup",
  "cronExpression": "0 * * * *",
  "targetAction": "my-workspace/cleanup-function",
  "payload": { "mode": "soft" }
}
```

**Response 201**:

```json
{
  "jobId": "<uuid>",
  "name": "hourly-cleanup",
  "cronExpression": "0 * * * *",
  "targetAction": "my-workspace/cleanup-function",
  "payload": { "mode": "soft" },
  "status": "active",
  "nextRunAt": "<ISO8601>",
  "createdAt": "<ISO8601>"
}
```

**Error codes**:
- `400 INVALID_CRON_EXPRESSION` — syntactically invalid or resolves below minimum interval.
- `400 INVALID_TARGET_ACTION` — target function not found in workspace function catalogue.
- `400 INTERVAL_BELOW_FLOOR` — cron expression resolves below `min_interval_seconds`.
- `403 SCHEDULING_DISABLED` — scheduling capability not enabled for this workspace/tenant.
- `403 FORBIDDEN` — caller lacks scheduling management permission.
- `409 QUOTA_EXCEEDED` — workspace active job quota reached.

#### GET /v1/scheduling/jobs

List scheduled jobs for workspace (paginated).

**Query params**: `status` (active|paused|errored), `cursor`, `limit` (max 100).

**Response 200**:

```json
{
  "items": [
    {
      "jobId": "<uuid>",
      "name": "hourly-cleanup",
      "cronExpression": "0 * * * *",
      "targetAction": "my-workspace/cleanup-function",
      "status": "active",
      "nextRunAt": "<ISO8601>",
      "lastTriggeredAt": "<ISO8601>",
      "consecutiveFailureCount": 0,
      "createdAt": "<ISO8601>",
      "updatedAt": "<ISO8601>"
    }
  ],
  "nextCursor": "<opaque>"
}
```

#### GET /v1/scheduling/jobs/:id

Get job detail. Same shape as list item plus `payload` field.

#### PATCH /v1/scheduling/jobs/:id

Update `name`, `cronExpression`, `targetAction`, or `payload`. Status cannot be changed via PATCH.

**Validation**: `cronExpression` re-validated against floor; `next_run_at` recalculated on success.

**Response 200**: updated job resource.

#### POST /v1/scheduling/jobs/:id/pause

Pause an active job.

**Response 200**: updated job resource (status: `paused`).

**Error codes**:
- `409 JOB_NOT_ACTIVE` — job is not in `active` status.

#### POST /v1/scheduling/jobs/:id/resume

Resume a paused job.

**Pre-condition**: scheduling capability must still be enabled for the workspace.

**Response 200**: updated job resource (status: `active`, `nextRunAt` recalculated).

**Error codes**:
- `403 SCHEDULING_DISABLED` — capability no longer enabled.
- `409 JOB_NOT_PAUSED` — job is not in `paused` status.
- `409 QUOTA_EXCEEDED` — resuming would exceed active quota.

#### DELETE /v1/scheduling/jobs/:id

Soft-delete a job. Sets `deleted_at`, sets status to `deleted`, emits audit event.

**Response 204**.

#### GET /v1/scheduling/jobs/:id/executions

Paginated execution history for a job.

**Query params**: `status` (succeeded|failed|timed_out|missed), `from`, `to`, `cursor`, `limit` (max 100).

**Response 200**:

```json
{
  "items": [
    {
      "executionId": "<uuid>",
      "status": "succeeded",
      "scheduledAt": "<ISO8601>",
      "startedAt": "<ISO8601>",
      "finishedAt": "<ISO8601>",
      "durationMs": 342,
      "errorSummary": null,
      "correlationId": "<trace-id>"
    }
  ],
  "nextCursor": "<opaque>"
}
```

#### GET /v1/scheduling/summary

Aggregate scheduling summary for the workspace.

**Response 200**:

```json
{
  "activeJobs": 3,
  "pausedJobs": 1,
  "erroredJobs": 0,
  "deletedJobs": 2,
  "quotaLimit": 10,
  "quotaUsed": 3,
  "schedulingEnabled": true
}
```

### 5.2 Admin / Tenant Configuration API

Base path: `/v1/scheduling/config` (tenant or workspace admin role required)

#### GET /v1/scheduling/config

Retrieve current scheduling configuration for the workspace (or tenant default if no workspace override exists).

**Response 200**:

```json
{
  "schedulingEnabled": true,
  "maxActiveJobs": 10,
  "minIntervalSeconds": 60,
  "maxConsecutiveFailures": 5
}
```

#### PATCH /v1/scheduling/config

Update configuration. Partial update supported.

**Request body**:

```json
{
  "schedulingEnabled": false,
  "maxActiveJobs": 20
}
```

**Side-effect on `schedulingEnabled: false`**: all `active` jobs in the workspace are transitioned to `paused` synchronously before responding. A `console.scheduling.capability.toggled` event is emitted with the count of paused jobs.

**Response 200**: updated configuration resource.

### 5.3 Error Response Envelope

All error responses use a consistent shape:

```json
{
  "code": "QUOTA_EXCEEDED",
  "message": "Workspace has reached the maximum number of active scheduled jobs (10).",
  "details": {}
}
```

---

## 6. Files to Create or Modify

### New files

```text
services/scheduling-engine/
  src/
    cron-validator.mjs              # Cron expression parsing, validation, next-run calculation
    job-model.mjs                   # Pure-functional job entity model and state transitions
    execution-model.mjs             # Execution entity model helpers
    quota.mjs                       # Quota evaluation helpers (max jobs, interval floor)
    audit.mjs                       # Audit event builders for Kafka publication
    config-model.mjs                # SchedulingConfiguration read/write helpers
  actions/
    scheduling-management.mjs       # OpenWhisk action: CRUD + lifecycle management
    scheduling-trigger.mjs          # OpenWhisk action: cron-driven wake-up, due-job detection
    scheduling-job-runner.mjs       # OpenWhisk action: invokes target function, records execution
  migrations/
    001-scheduling-tables.sql       # DDL for scheduling_configurations, scheduled_jobs,
                                    # scheduled_executions

tests/
  unit/
    cron-validator.test.mjs
    job-model.test.mjs
    execution-model.test.mjs
    quota.test.mjs
    audit.test.mjs
    config-model.test.mjs
  integration/
    scheduling-management-action.test.mjs  # Action tests with PG test container
    scheduling-trigger.test.mjs
    scheduling-job-runner.test.mjs
  contracts/
    scheduling-api.contract.test.mjs       # Request/response shape assertions
  e2e/
    workspace-scheduling/
      README.md                            # Scenario matrix (see §7.4)

specs/086-workspace-scheduling-automation/
  plan.md                                  # This file
```

### Additive modifications

- `AGENTS.md` — append scheduling engine technology summary after task completes (auto-update convention).
- `services/provisioning-orchestrator/src/` — no changes; scheduling engine is an independent service.

---

## 7. Test Strategy

### 7.1 Unit Tests

All pure-functional modules tested in isolation (no I/O).

**`cron-validator.mjs`**:
- Valid 5-field cron expressions parse without error.
- Invalid expressions (wrong field count, out-of-range values, bad syntax) are rejected with descriptive errors.
- `nextRunAt` calculation is deterministic: given a reference time and a cron expression, returns the correct next timestamp.
- Expressions that resolve below `min_interval_seconds` are rejected.
- Seconds-precision expressions (6-field) are rejected explicitly.

**`job-model.mjs`**:
- Job construction with required fields.
- Status transitions: active → paused, paused → active, active → errored, any → deleted.
- Invalid transitions (e.g., deleted → active) are rejected.
- `consecutive_failure_count` increments on failure; auto-errored transition fires at threshold.
- `next_run_at` recalculation on update of cron expression.

**`quota.mjs`**:
- Count-based check: at-limit returns false, under-limit returns true.
- Interval floor check: below-floor cron rejects, above-floor accepts.
- Resume quota check: verifies active count before resume.

**`audit.mjs`**:
- All builders return required fields: `tenantId`, `workspaceId`, `actorId`, `action`, `resourceId`, `timestamp`.
- No job payloads or sensitive data leaked into audit messages.

**`config-model.mjs`**:
- Config read with workspace override present.
- Config read falls back to tenant default when no workspace override.
- Disabling scheduling returns list of job IDs to be paused.

### 7.2 Integration Tests

Require PostgreSQL (test container or CI-provisioned):

**`scheduling-management-action.test.mjs`**:
- Full lifecycle: create → read → update → pause → resume → delete.
- Quota enforcement with populated job count.
- Concurrent creates respect quota without double-insert (advisory lock or `SELECT FOR UPDATE`).
- Creating a job with scheduling disabled returns `403 SCHEDULING_DISABLED`.
- Disabling scheduling pauses all active jobs and the response reflects updated counts.
- Updating cron expression recalculates `next_run_at`.

**`scheduling-trigger.test.mjs`**:
- Due jobs (next_run_at ≤ now) are picked up and execution rows created.
- Jobs with `next_run_at` in the future are skipped.
- Paused and deleted jobs are not triggered.
- Missed-window detection: if `last_triggered_at` is far in the past, a "missed" execution row is created for the skipped window.
- `next_run_at` is updated on each triggered job.

**`scheduling-job-runner.test.mjs`**:
- Successful function invocation marks execution as `succeeded`.
- OpenWhisk timeout or error marks execution as `failed` or `timed_out`.
- `consecutive_failure_count` increments on failure; auto-errored transition fires at threshold and emits audit event.
- Execution row created with correct `started_at`, `finished_at`, `duration_ms`.

### 7.3 Contract Tests

**`scheduling-api.contract.test.mjs`**:
- POST /jobs request/response shape (all fields present, correct types).
- GET /jobs pagination shape (`nextCursor` opaque, items array).
- GET /jobs/:id/executions pagination shape.
- GET /summary aggregate fields and types.
- PATCH /config side-effect: `schedulingEnabled: false` triggers pause of active jobs.
- Error envelope: `{ "code": "<CODE>", "message": "<string>", "details": {} }`.

### 7.4 E2E Scenario Matrix (static, documented in README.md)

| Scenario | Setup | Expected outcome |
|---|---|---|
| Happy path — single execution | Active job, trigger fires at cron window | Execution row created with status succeeded; next_run_at updated |
| Cron expression validation | Invalid expression submitted | 400 INVALID_CRON_EXPRESSION; no job persisted |
| Below minimum interval | Cron resolves < minIntervalSeconds | 400 INTERVAL_BELOW_FLOOR; no job persisted |
| Quota exceeded | Workspace at max_active_jobs | 409 QUOTA_EXCEEDED on create |
| Scheduling disabled — create rejected | Capability disabled for workspace | 403 SCHEDULING_DISABLED |
| Disable with active jobs | PATCH config sets schedulingEnabled=false | All active jobs → paused; audit event emitted with count |
| Re-enable and resume | Config re-enabled, job resumed | Job back to active; next_run_at recalculated |
| Pause / resume lifecycle | Pause a job, wait for trigger window, resume | No execution during paused window; executions resume after |
| Consecutive failure auto-errored | Target function always fails | After max_consecutive_failures, job → errored; audit event emitted |
| Missed execution on recovery | Platform downtime gap in trigger wake-ups | Missed execution row logged; next normal trigger proceeds |
| Tenant isolation | Two tenants, overlapping job names | Each tenant's listing returns only its own jobs |
| Cross-workspace isolation | Two workspaces in same tenant | Each workspace sees only its own jobs and executions |
| Delete cancels future triggers | Delete active job | Trigger action skips deleted job; no new execution rows created |

---

## 8. Security Considerations

- **Tenant isolation**: `tenantId` and `workspaceId` always sourced from verified JWT claims; never from request body. All SQL queries include `WHERE tenant_id = $1 AND workspace_id = $2`.
- **Target action validation**: `targetAction` must reference a function registered in the workspace's function catalogue before job creation is accepted. Prevents a caller from scheduling arbitrary OpenWhisk action paths outside their workspace.
- **Payload size cap**: job `payload` field capped at a configurable size (default 64 KB) to prevent storage abuse.
- **Cron floor enforcement**: prevents thundering-herd attacks from very high-frequency schedules. Minimum interval is enforced at both create and update time.
- **Capability guard**: scheduling-management action checks enablement flag on every create and resume call — not just at the API gateway layer.
- **Audit trail**: all management and execution lifecycle events published to Kafka with actor, action, resourceId, tenantId, workspaceId, and timestamp. No job payload included in audit events.
- **Secret handling**: no secrets are stored in job records or payloads. If a target function requires secrets, callers should reference named workspace secrets via the platform's existing secret reference mechanism — not embed them in the job payload.

---

## 9. Observability

- **Kafka audit topics** (see §4.2) cover full job management lifecycle and execution outcomes.
- **Execution history rows** in PostgreSQL provide job-scoped history queryable by workspace developers via the API.
- **Summary endpoint** (`GET /v1/scheduling/summary`) provides real-time quota utilisation and job-count breakdown for workspace visibility.
- **Metrics to expose** (via action response metadata or future metrics pipeline):
  - `scheduling_execution_total` (labels: tenant, workspace, status)
  - `scheduling_execution_duration_ms` (histogram, labels: tenant, workspace)
  - `scheduling_job_errored_total` (labels: tenant, workspace)
  - `scheduling_trigger_lag_ms` — time between cron window and actual trigger action execution
  - `scheduling_missed_executions_total` (labels: tenant, workspace)
  - `scheduling_quota_exceeded_total` (labels: tenant, workspace)

---

## 10. Rollback and Migration Safety

- **Additive DDL**: all three scheduling tables are new; no existing tables modified.
- **Migration file**: `001-scheduling-tables.sql` applies with `IF NOT EXISTS` guards on all `CREATE INDEX` statements.
- **Rollback**: drop the three tables and undeploy the three OpenWhisk actions. No destructive change to existing schemas.
- **Feature flag**: scheduling-trigger action can be gated by `SCHEDULING_ENGINE_ENABLED=true` env var; if false, trigger exits immediately without querying due jobs.
- **Idempotency**: scheduling-trigger uses `INSERT ... ON CONFLICT DO NOTHING` on `(job_id, scheduled_at)` to prevent duplicate execution rows if the trigger fires more than once within the same window.
- **Incremental rollout**: enablement defaults to `false` for all tenants/workspaces. No jobs can be created or triggered until a tenant owner explicitly enables the capability, ensuring safe staged deployment.

---

## 11. Implementation Sequence

1. **Migrations** — Create `001-scheduling-tables.sql`; apply to dev/CI environment.
2. **Pure-functional modules** — Implement and unit-test `cron-validator.mjs`, `job-model.mjs`, `execution-model.mjs`, `quota.mjs`, `audit.mjs`, `config-model.mjs`.
3. **Management action** — Implement and integration-test `scheduling-management.mjs` (CRUD, pause/resume, config, summary).
4. **Trigger action** — Implement and integration-test `scheduling-trigger.mjs` (due-job detection, missed-window logging, next-run-at updates).
5. **Job runner action** — Implement and integration-test `scheduling-job-runner.mjs` (function invocation, execution recording, failure tracking, auto-errored transition).
6. **Contract tests** — Write and pass `scheduling-api.contract.test.mjs`.
7. **E2E README** — Document scenario matrix in `tests/e2e/workspace-scheduling/README.md`.
8. **APISIX route configuration** — Add route for `/v1/scheduling/**` pointing to `scheduling-management` action with Keycloak JWT plugin.
9. **OpenWhisk alarm feed** — Register alarm feed to fire `scheduling-trigger` action at `SCHEDULING_TRIGGER_INTERVAL_SECONDS` cadence.
10. **Helm chart updates** — Add scheduling-engine env vars, secrets, and OpenWhisk action/alarm deploy manifests.

Steps 2–5 can be parallelised across developers once migrations are applied. Steps 6–10 depend on steps 2–5 being complete.

---

## 12. Done Criteria

Done means all of the following are true:

- [ ] All three PostgreSQL tables exist and migration applies cleanly to a fresh database with no errors.
- [ ] All pure-functional modules pass unit tests with ≥90% line coverage.
- [ ] Management action integration tests pass the full job lifecycle (create, read, update, pause, resume, delete) and config lifecycle (enable, disable, re-enable).
- [ ] Disabling scheduling via PATCH config synchronously pauses all active jobs; resumed jobs require explicit resume call after re-enabling.
- [ ] Trigger action integration tests confirm: due jobs are picked up, paused/deleted jobs are skipped, missed windows produce "missed" execution rows, duplicate invocations do not create duplicate execution rows.
- [ ] Job-runner tests confirm: success → succeeded, error/timeout → failed or timed_out, consecutive failure threshold triggers auto-errored transition and emits audit event.
- [ ] Contract tests pass for all documented request/response shapes and error envelopes.
- [ ] E2E scenario README documents all 13 scenarios with setup, steps, and expected outcomes.
- [ ] APISIX route for `/v1/scheduling/**` validated in integration environment (or documented in Helm values as a ready-to-apply route manifest).
- [ ] OpenWhisk alarm feed for trigger action configured and verifiably firing at the expected cadence in CI.
- [ ] Zero cross-tenant or cross-workspace data returned in any test scenario.
- [ ] All management and execution lifecycle operations produce Kafka audit events with actor, action, resourceId, tenantId, workspaceId, and timestamp.
- [ ] No job payload or sensitive data appears in any Kafka audit event.
- [ ] Branch `086-workspace-scheduling-automation` passes CI lint and test suite.
