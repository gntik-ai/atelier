# Tasks: US-OBS-03-T03 — Threshold Alerts When a Tenant Exceeds Defined Quota Limits

**Input**: `specs/039-observability-threshold-alerts/plan.md`
**Feature Branch**: `039-observability-threshold-alerts`
**Task**: `US-OBS-03-T03`

---

## Implementation input map (bounded read set)

Use only the following repo files as implementation inputs for this task.

> **Token-optimization rule**: do NOT read
> `apps/control-plane/openapi/control-plane.openapi.json` directly.
> Use `apps/control-plane/openapi/families/metrics.openapi.json` as read context only.

### Spec artifacts

- `specs/039-observability-threshold-alerts/spec.md`
- `specs/039-observability-threshold-alerts/plan.md`
- `specs/039-observability-threshold-alerts/tasks.md`

### Existing contract + reader references (T01/T02 baseline — read-only)

- `services/internal-contracts/src/observability-usage-consumption.json`
- `services/internal-contracts/src/observability-quota-policies.json`
- `services/internal-contracts/src/observability-audit-event-schema.json`
- `services/internal-contracts/src/authorization-model.json`
- `services/internal-contracts/src/public-api-taxonomy.json`
- `services/internal-contracts/src/index.mjs`

### Existing helper + pattern references (read-only)

- `apps/control-plane/src/observability-admin.mjs`
- `apps/control-plane/openapi/families/metrics.openapi.json`
- `scripts/lib/observability-usage-consumption.mjs`
- `scripts/lib/observability-quota-policies.mjs`
- `tests/unit/observability-quota-policies.test.mjs`
- `tests/contracts/observability-quota-policies.contract.test.mjs`
- `docs/reference/architecture/observability-quota-policies.md`
- `docs/reference/architecture/README.md`
- `docs/tasks/us-obs-03.md`
- `package.json`

### New or updated delivery targets

- `services/internal-contracts/src/observability-threshold-alerts.json`
- `services/internal-contracts/src/index.mjs`
- `scripts/lib/observability-threshold-alerts.mjs`
- `scripts/validate-observability-threshold-alerts.mjs`
- `apps/control-plane/src/observability-admin.mjs`
- `charts/in-falcone/bootstrap/migrations/20260328-002-quota-threshold-alert-posture-store.sql`
- `docs/reference/architecture/observability-threshold-alerts.md`
- `docs/reference/architecture/README.md`
- `docs/tasks/us-obs-03.md`
- `tests/unit/observability-threshold-alerts.test.mjs`
- `tests/contracts/observability-threshold-alerts.contract.test.mjs`
- `package.json`

---

## Phase 1 — Spec artifacts

- [x] T001 Materialize `specs/039-observability-threshold-alerts/spec.md` with the bounded threshold-alert scope for `US-OBS-03-T03`.
- [x] T002 Materialize `specs/039-observability-threshold-alerts/plan.md` with the contract, helper, store migration, evaluation-cycle, docs, and validation sequence.
- [x] T003 Materialize `specs/039-observability-threshold-alerts/tasks.md` and keep it aligned with the bounded T03 delta.

## Phase 2 — Internal contract and validation baseline

- [ ] T004 Add `services/internal-contracts/src/observability-threshold-alerts.json` covering:
  - source-contract version pins for `observability-usage-consumption`, `observability-quota-policies`, and `observability-audit-event-schema`,
  - alert event type catalog with trigger conditions and transition directions (escalation / recovery / suppression),
  - alert event envelope field definitions (all fields from the spec § Requirements / Alert Event Contract),
  - suppression causes (`evidence_degraded`, `evidence_unavailable`) mapped to T01 freshness states,
  - multi-threshold crossing ordering rule (ascending severity within one cycle),
  - recovery ordering rule (descending severity within one cycle),
  - last-known posture store schema (key shape and value shape),
  - threshold comparison semantics (inherits `>=` from T02),
  - Kafka topic name (`quota.threshold.alerts`), partitioning key (`tenantId`), schema subject prefix (`quota.threshold.alerts-value`), compatibility policy (`BACKWARD`), and ACL policy,
  - correlation-id strategy referencing posture-snapshot and usage-snapshot linkage,
  - explicit downstream boundaries to `T04`–`T06`,
  - atomicity/delivery-guarantee posture (transactional producer preferred; at-least-once with idempotent consumers as fallback).
- [ ] T005 Update `services/internal-contracts/src/index.mjs` to expose:
  - `readObservabilityThresholdAlerts()` and `OBSERVABILITY_THRESHOLD_ALERTS_VERSION`,
  - `listAlertEventTypes()` / `getAlertEventType(typeId)`,
  - `listAlertSuppressionCauses()` / `getAlertSuppressionCause(causeId)`,
  - `getAlertKafkaTopicConfig()`,
  - `getAlertEventEnvelopeSchema()`,
  - `getAlertCorrelationStrategy()`.
- [ ] T006 Add `scripts/lib/observability-threshold-alerts.mjs` exporting `collectObservabilityThresholdAlertViolations(contract, dependencies)` with deterministic checks for:
  - source-contract version alignment with installed `observability-quota-policies` and `observability-usage-consumption`,
  - all documented alert event types are present and have non-empty trigger conditions,
  - all suppression causes map to a freshness state from the usage-consumption contract,
  - Kafka topic config is present with `topicName`, `partitionKey`, and `schemaSubject`,
  - alert event envelope schema references all required fields,
  - correlation-id strategy references both posture-snapshot and usage-snapshot linkage,
  - explicit downstream boundaries to `T04`–`T06` remain in the contract,
  - contract does not introduce any blocking or enforcement semantics.
- [ ] T007 Add `scripts/validate-observability-threshold-alerts.mjs` and wire `validate:observability-threshold-alerts` into `package.json` plus include it in `validate:repo`.

## Phase 3 — Control-plane helper surface

- [ ] T008 Extend `apps/control-plane/src/observability-admin.mjs` with additive threshold-alert helpers (do not modify any T01 or T02 helper):

  **Contract and configuration**
  - `summarizeObservabilityThresholdAlerts()` — returns contract summary from the new contract reader.
  - `getAlertKafkaTopicName()` — returns the configured Kafka topic name.
  - `getAlertEventEnvelopeDefaults()` — returns audit-compatible defaults for the `actor` and `resource` fields.

  **Last-known posture store**
  - `readLastKnownPosture(context, { tenantId, workspaceId, dimensionId })` — loads the current posture record from PostgreSQL; returns `null` if no prior record exists (first-seen dimension).
  - `writeLastKnownPosture(context, { tenantId, workspaceId, dimensionId, posture, evaluatedAt, snapshotTimestamp, correlationId })` — persists atomically as part of the Kafka emission transaction.

  **Transition detection**
  - `detectPostureTransitions(currentPosture, lastKnownPosture, policyContext)` — pure function; returns an ordered list of `PostureTransition` objects:
    - escalation: all intermediate transitions in ascending severity,
    - recovery: recovery transitions in descending severity,
    - unchanged: empty list,
    - first-seen: treat `within_limit` as implicit baseline and escalate,
    - unbounded dimension: always returns empty list.

  **Event construction**
  - `buildThresholdAlertEvent(transition, context)` — constructs a fully-populated alert event envelope; never emits; includes audit-compatible `actor`, `action`, `resource` fields.
  - `buildAlertSuppressionEvent(context, { tenantId, workspaceId, dimensionId, cause })` — constructs a `quota.threshold.alert_suppressed` envelope with `suppressionCause` and `suppressedEventType`.

  **Evaluation cycle orchestration**
  - `runAlertEvaluationCycle(context, input)` — one complete pass: reads posture snapshot (via T02 helpers), checks freshness, detects transitions, builds events, emits to Kafka, writes last-known posture, returns summary.
  - `evaluateTenantAlerts(context, input)` — tenant-scoped convenience wrapper around `runAlertEvaluationCycle`.
  - `evaluateWorkspaceAlerts(context, input)` — workspace-scoped convenience wrapper around `runAlertEvaluationCycle`.

  **Observability**
  - `recordAlertEvaluationMetrics(summary)` — increments Prometheus counters: `quota_threshold_alerts_emitted_total{event_type, tenant_id}`, `quota_threshold_alerts_suppressed_total{cause, tenant_id}`, `quota_threshold_alert_evaluation_duration_seconds`, and `quota_threshold_alerts_producer_lag_seconds`.

## Phase 4 — PostgreSQL migration

- [ ] T009 Add `charts/in-falcone/bootstrap/migrations/20260328-002-quota-threshold-alert-posture-store.sql` with:

  ```sql
  CREATE TABLE quota_last_known_posture (
      tenant_id          TEXT        NOT NULL,
      workspace_id       TEXT,
      dimension_id       TEXT        NOT NULL,
      posture_state      TEXT        NOT NULL,
      evaluated_at       TIMESTAMPTZ NOT NULL,
      snapshot_timestamp TIMESTAMPTZ NOT NULL,
      correlation_id     TEXT        NOT NULL,
      PRIMARY KEY (tenant_id, COALESCE(workspace_id, ''), dimension_id)
  );
  CREATE INDEX ON quota_last_known_posture (tenant_id);
  CREATE INDEX ON quota_last_known_posture (tenant_id, workspace_id);
  ```

  Document in a comment: `workspace_id` uses `NULL` for tenant-scoped entries; the PK uses `COALESCE(workspace_id, '')` to satisfy the constraint; workspace deletion must purge rows via a cleanup hook.

## Phase 5 — Documentation

- [ ] T010 Add `docs/reference/architecture/observability-threshold-alerts.md` documenting:
  - alert evaluation cycle trigger and cadence (after each T01 snapshot refresh, default ≤ 5 min),
  - last-known posture store schema and its role in deduplication and restart safety,
  - event type catalog and trigger conditions,
  - suppression and recovery semantics,
  - multi-threshold crossing ordering rule,
  - Kafka topic config (name, partitioning key, schema subject, ACLs),
  - correlation-id strategy,
  - atomicity posture (transactional producer preferred; at-least-once fallback documented),
  - Prometheus metrics and lag metric,
  - explicit downstream boundary to `T04`–`T06`,
  - rollback procedure.
- [ ] T011 Update `docs/reference/architecture/README.md` to add the new threshold-alerts contract/doc pair to the observability architecture index.
- [ ] T012 Update `docs/tasks/us-obs-03.md` with a `## Scope delivered in 'US-OBS-03-T03'` section summarizing the threshold-alert baseline, Kafka topic, last-known posture store, and residual boundary to T04–T06.

## Phase 6 — Tests

- [ ] T013 Add `tests/unit/observability-threshold-alerts.test.mjs` covering:
  - validator pass for the new contract,
  - summary output shape,
  - `detectPostureTransitions`: unchanged posture → empty list,
  - `detectPostureTransitions`: within-limit → warning → one escalation event,
  - `detectPostureTransitions`: within-limit → hard-limit (soft absent) → warning + hard in order,
  - `detectPostureTransitions`: within-limit → hard-limit (soft present) → warning + soft + hard in order,
  - `detectPostureTransitions`: hard-limit → within-limit → hard-recovered,
  - `detectPostureTransitions`: hard-limit → soft-limit → hard-recovered only,
  - first-seen dimension with breach → implicit within-limit baseline, escalation emitted,
  - unbounded dimension → empty list regardless of usage,
  - evidence `degraded` → suppression event, no transition events, last-known posture not updated,
  - evidence `unavailable` → suppression event, no transition events,
  - `buildThresholdAlertEvent` envelope contains all required fields,
  - `buildAlertSuppressionEvent` envelope contains `suppressionCause` and `suppressedEventType`,
  - workspace-scoped event carries both `tenantId` and `workspaceId` without cross-workspace data,
  - `correlationId` is deterministic for the same input tuple,
  - Prometheus counters incremented after evaluation cycle completes.
- [ ] T014 Add `tests/contracts/observability-threshold-alerts.contract.test.mjs` covering:
  - shared readers and accessors exported from `index.mjs`,
  - source-contract version alignment: alert contract pins same versions as installed `observability-quota-policies` and `observability-usage-consumption`,
  - all alert event types in the catalog have distinct `eventType` values,
  - all suppression causes map to a freshness state from the usage-consumption contract,
  - Kafka topic config has `topicName`, `partitionKey`, and `schemaSubject`,
  - alert event envelope schema references all required fields,
  - explicit downstream boundaries to `T04`–`T06` are documented in the contract,
  - architecture doc exists at `docs/reference/architecture/observability-threshold-alerts.md`,
  - README index references the new architecture doc,
  - `docs/tasks/us-obs-03.md` contains a `T03` summary section.

## Phase 7 — Verification

- [ ] T015 Run `npm run validate:observability-threshold-alerts`.
- [ ] T016 Run `node --test tests/unit/observability-threshold-alerts.test.mjs`.
- [ ] T017 Run `node --test tests/contracts/observability-threshold-alerts.contract.test.mjs`.
- [ ] T018 Run `npm run lint:md -- specs/039-observability-threshold-alerts/spec.md specs/039-observability-threshold-alerts/plan.md specs/039-observability-threshold-alerts/tasks.md docs/reference/architecture/observability-threshold-alerts.md docs/reference/architecture/README.md docs/tasks/us-obs-03.md`.
- [ ] T019 Run full `npm run lint` and `npm test` successfully.
- [ ] T020 Inspect the final diff to confirm the increment stayed within: threshold-alert contract, validation script, store migration, admin helpers, docs, and tests — and did not absorb T04–T06 work, and did not modify any T01 or T02 artifact.

## Phase 8 — Delivery

- [ ] T021 Commit the branch with a focused message for `US-OBS-03-T03`.
- [ ] T022 Push `039-observability-threshold-alerts` to `origin`.
- [ ] T023 Open a PR from `039-observability-threshold-alerts` to `main`.
- [ ] T024 Monitor CI, fix deterministic failures, and update the branch until checks are green.
- [ ] T025 Merge the PR to `main` once green.
- [ ] T026 Update the orchestrator state files with the completed unit (`US-OBS-03-T03`) and the next pending backlog unit (`US-OBS-03-T04`).
