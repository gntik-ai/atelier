# Workspace Scheduling E2E Scenario Matrix

## 1. Happy path — single execution

- Setup: enable scheduling, create active hourly job.
- Steps: wait for trigger cadence, invoke runner.
- Expected: execution row `succeeded`, `next_run_at` advances.
- Kafka: `console.scheduling.job.created`, `console.scheduling.execution.succeeded`.

## 2. Cron expression validation

- Setup: scheduling enabled.
- Steps: submit invalid cron.
- Expected: `400 INVALID_CRON_EXPRESSION`, no row persisted.
- Kafka: none.

## 3. Below minimum interval

- Setup: minIntervalSeconds above cron cadence.
- Steps: create too-frequent job.
- Expected: `400 INTERVAL_BELOW_FLOOR`.
- Kafka: none.

## 4. Quota exceeded

- Setup: workspace at max active jobs.
- Steps: create one more job.
- Expected: `409 QUOTA_EXCEEDED`.
- Kafka: `console.scheduling.quota.exceeded`.

## 5. Scheduling disabled — create rejected

- Setup: capability disabled.
- Steps: create job.
- Expected: `403 SCHEDULING_DISABLED`.
- Kafka: none.

## 6. Disable with active jobs

- Setup: enabled workspace with active jobs.
- Steps: PATCH config `{ schedulingEnabled: false }`.
- Expected: all active jobs become paused.
- Kafka: `console.scheduling.capability.toggled`.

## 7. Re-enable and resume

- Setup: paused jobs after disable.
- Steps: re-enable config, resume job.
- Expected: status returns to active and `next_run_at` recalculates.
- Kafka: `console.scheduling.capability.toggled`, `console.scheduling.job.resumed`.

## 8. Pause / resume lifecycle

- Setup: active job.
- Steps: pause, wait through due window, resume.
- Expected: no execution while paused; new executions after resume only.
- Kafka: `console.scheduling.job.paused`, `console.scheduling.job.resumed`.

## 9. Consecutive failure auto-errored

- Setup: job pointing to failing function.
- Steps: run until threshold reached.
- Expected: execution rows fail/timed out; job becomes `errored`.
- Kafka: `console.scheduling.execution.failed`, `console.scheduling.job.errored`.

## 10. Missed execution on recovery

- Setup: job active, trigger downtime gap.
- Steps: restart trigger after gap.
- Expected: `missed` execution rows inserted without backfill execution.
- Kafka: `console.scheduling.execution.missed`.

## 11. Tenant isolation

- Setup: same job names under two tenants.
- Steps: list and inspect jobs per tenant.
- Expected: each tenant sees only its own rows.
- Kafka: tenant-scoped lifecycle events only.

## 12. Cross-workspace isolation

- Setup: same tenant, two workspaces.
- Steps: query lists and execution history.
- Expected: workspace filtering prevents cross-visibility.
- Kafka: workspace-scoped events only.

## 13. Delete cancels future triggers

- Setup: active job scheduled for future run.
- Steps: delete job, invoke trigger.
- Expected: no new execution rows for deleted job.
- Kafka: `console.scheduling.job.deleted`.
