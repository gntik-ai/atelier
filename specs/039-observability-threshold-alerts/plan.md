# Implementation Plan: US-OBS-03-T03 — Threshold Alerts When a Tenant Exceeds Defined Quota Limits

**Feature Branch**: `039-observability-threshold-alerts`
**Spec**: `specs/039-observability-threshold-alerts/spec.md`
**Task**: `US-OBS-03-T03`
**Created**: 2026-03-28
**Status**: Planned

---

## 1. Technical Objective

`US-OBS-03-T03` delivers the **threshold alert emission layer** on top of the quota-posture
evaluation baseline established by `US-OBS-03-T02`.

The increment must establish one shared contract and one executable helper surface that:

- define the structured alert event envelope for every quota-posture transition type,
- detect posture transitions by comparing current evaluations against a persistent last-known
  posture store per tenant/workspace and dimension,
- emit exactly one structured alert event per real transition through the Kafka event backbone,
- suppress alert emission for dimensions whose evidence freshness is `degraded` or `unavailable`
  and emit a `quota.threshold.alert_suppressed` event instead,
- emit recovery events when a dimension's posture improves to a lower-severity state,
- publish alert events in a format compatible with the canonical audit vocabulary from `US-OBS-02`,
- and expose the alert emission helper surface so downstream tasks (`T04` blocking, `T05` console)
  can subscribe to alert events without reimplementing transition detection.

This task does **not** block resource creation, deliver console views, implement notification
channels, or add alert-management workflows. It is purely observational and event-emitting.

---

## 2. Architecture and Scope Boundaries

### 2.1 Position in `US-OBS-03`

```text
T01 — usage-consumption baseline (already delivered)
T02 — quota policy contract + posture evaluation (already delivered)
T03 — THIS TASK: threshold alert / event emission on posture transitions
T04 — hard-limit blocking/resource-creation enforcement
T05 — console usage-vs-quota and provisioning state
T06 — cross-module consumption/enforcement tests
```

`T03` depends on and must not replace any artifact from `T01` or `T02`. It adds one new layer —
transition detection and event emission — while reading T02 posture evaluation output as input.

### 2.2 Inputs reused from existing baselines

This task reuses the contracts and helpers published by prior observability work:

- `services/internal-contracts/src/observability-usage-consumption.json`
- `services/internal-contracts/src/observability-quota-policies.json`
- `services/internal-contracts/src/observability-audit-event-schema.json`
- `services/internal-contracts/src/authorization-model.json`
- `services/internal-contracts/src/public-api-taxonomy.json`
- `services/internal-contracts/src/index.mjs`
- `apps/control-plane/src/observability-admin.mjs`
- `apps/control-plane/openapi/families/metrics.openapi.json`

The full aggregated OpenAPI source must only be edited programmatically; it must not be used as LLM
read context.

### 2.3 Target architecture

```text
T01 usage snapshots + T02 posture evaluators
        ↓
services/internal-contracts/src/observability-threshold-alerts.json
        ↓ shared readers + accessors
services/internal-contracts/src/index.mjs
        ↓ alert evaluation + transition detection + event emission
scripts/lib/observability-threshold-alerts.mjs
        ↓
apps/control-plane/src/observability-admin.mjs   ←→   last-known posture store (PostgreSQL)
        ↓
Kafka topic: quota.threshold.alerts
        ↓
downstream: T04 blocking   T05 console   audit log   future notification subsystem
```

### 2.4 Incremental implementation rule

Follow the same bounded pattern used by earlier observability increments:

- alert evaluation helpers operate on explicit posture snapshots and explicit last-known posture
  inputs or loader callbacks,
- transition detection and event construction are deterministic and centralized in shared helper
  functions,
- the last-known posture store is updated within the same transaction as event emission to prevent
  duplicate events across restarts,
- alert evaluation is triggered after each usage snapshot refresh using the T01 cadence (default
  ≤ 5 minutes),
- and all blocking or notification effects remain separate from this increment.

### 2.5 Kafka topic and delivery semantics

| Concern | Decision |
| --- | --- |
| Topic name | `quota.threshold.alerts` |
| Partitioning key | `tenantId` (ensures all events for a tenant land on the same partition and are ordered) |
| Retention | At-least-once delivery; idempotent consumers are expected |
| Message format | JSON with a standard envelope (see § 4.1) |
| Schema registry | Register the alert event schema under the `quota` subject prefix |
| Replay safety | Alert events are immutable; downstream consumers must deduplicate on `correlationId` |
| ACLs | Produce: alert emission service only; Consume: any authorized internal service, no cross-tenant read enforcement at broker level |
| Lag metric | Expose `quota_threshold_alerts_producer_lag_seconds` for operational visibility |

### 2.6 Explicit non-goals

This task will **not**:

- modify the usage-consumption baseline from `US-OBS-03-T01`,
- modify the quota-policy evaluation surface from `US-OBS-03-T02`,
- block resource creation in response to alerts (`US-OBS-03-T04`),
- add console UI components or tenant-facing visualization flows (`US-OBS-03-T05`),
- deliver cross-module enforcement tests (`US-OBS-03-T06`),
- implement alert acknowledgment, silencing, or routing configuration,
- implement notification delivery channels beyond publishing to Kafka,
- or introduce any quota-enforcement side effects.

---

## 3. Artifact-by-Artifact Change Plan

### 3.1 `services/internal-contracts/src/observability-threshold-alerts.json` (new)

Add one machine-readable contract that defines:

- source-contract versions (`observability-usage-consumption`, `observability-quota-policies`,
  `observability-audit-event-schema`, `authorization-model`, `public-api-taxonomy`),
- alert event type catalog with trigger conditions (see § 4.2),
- alert event envelope fields (see § 4.1),
- supported posture transition directions: `escalation` and `recovery`,
- suppression conditions: `evidence_degraded`, `evidence_unavailable`,
- last-known posture store schema (keys and value shape),
- multi-threshold crossing ordering rule: emit all intermediate events in ascending severity within
  one evaluation cycle,
- threshold comparison semantics: inherits `>=` from T02,
- Kafka topic name, partitioning key, and schema subject prefix,
- explicit boundaries to `T04`–`T06`,
- and correlation-id strategy for linking alert events to posture snapshots and usage snapshots.

### 3.2 `services/internal-contracts/src/index.mjs` (update)

Expose the new contract through the shared reader pattern:

- `readObservabilityThresholdAlerts()`
- `OBSERVABILITY_THRESHOLD_ALERTS_VERSION`
- `listAlertEventTypes()` / `getAlertEventType(typeId)`
- `listAlertSuppressionCauses()` / `getAlertSuppressionCause(causeId)`
- `getAlertKafkaTopicConfig()`
- `getAlertEventEnvelopeSchema()`
- `getAlertCorrelationStrategy()`

### 3.3 `scripts/lib/observability-threshold-alerts.mjs` (new)

Add deterministic validation helpers following the existing observability pattern.

Responsibilities:

- read the new contract and its dependencies,
- assert source-version alignment with `observability-quota-policies` and
  `observability-usage-consumption`,
- assert all documented alert event types are present and have trigger conditions,
- assert suppression causes are complete and mapped to freshness states,
- assert the Kafka topic config is present with partitioning key and schema subject,
- assert alert event envelope fields match the audit-event-schema vocabulary,
- assert the correlation-id strategy references both posture-snapshot and usage-snapshot linkage,
- assert explicit downstream boundaries to `T04`–`T06` remain present,
- and assert the alert event contract does not introduce any blocking or enforcement semantics.

### 3.4 `scripts/validate-observability-threshold-alerts.mjs` + `package.json` (new/update)

Add a dedicated validator entry point and wire:

- `validate:observability-threshold-alerts`
- inclusion into `validate:repo`

### 3.5 `apps/control-plane/src/observability-admin.mjs` (update)

Extend the existing observability helper surface with additive threshold-alert helpers:

**Contract and configuration**

- `summarizeObservabilityThresholdAlerts()`
- `getAlertKafkaTopicName()`
- `getAlertEventEnvelopeDefaults()`

**Last-known posture store**

- `readLastKnownPosture(context, { tenantId, workspaceId, dimensionId })` — loads from the
  persistent store; returns `null` for first-seen dimensions.
- `writeLastKnownPosture(context, { tenantId, workspaceId, dimensionId, posture, evaluatedAt })` —
  persists atomically; used inside the emission transaction.

**Transition detection**

- `detectPostureTransitions(currentPosture, lastKnownPosture)` — pure function; returns an ordered
  list of `PostureTransition` objects for the dimension.
  - Must enumerate intermediate transitions when usage crosses multiple thresholds in one cycle.
  - Must return a recovery transition when the new posture is lower-severity than the last-known.
  - Must return an empty list when posture is unchanged.

**Event construction**

- `buildThresholdAlertEvent(transition, context)` — constructs a fully-populated alert event
  envelope from a `PostureTransition` and its evaluation context; never emits.
- `buildAlertSuppressionEvent(context, { tenantId, workspaceId, dimensionId, cause })` —
  constructs a `quota.threshold.alert_suppressed` event for degraded/unavailable evidence.

**Evaluation cycle orchestration**

- `runAlertEvaluationCycle(context, input)` — executes one full evaluation cycle:
  1. Reads current posture snapshot (delegated to T02 helpers).
  2. For each scope/dimension: checks evidence freshness; if degraded/unavailable, builds
     suppression event and skips transition detection.
  3. Calls `detectPostureTransitions()` for each dimension with sufficient evidence.
  4. Calls `buildThresholdAlertEvent()` for each transition.
  5. Emits all constructed events to Kafka within a transaction.
  6. Persists updated last-known posture for each emitted transition.
  7. Returns an evaluation summary (events emitted, suppressions recorded, errors encountered).
- `evaluateTenantAlerts(context, input)` — convenience wrapper for tenant-scoped cycle.
- `evaluateWorkspaceAlerts(context, input)` — convenience wrapper for workspace-scoped cycle.

**Observability**

- `recordAlertEvaluationMetrics(summary)` — increments Prometheus counters:
  - `quota_threshold_alerts_emitted_total{event_type, tenant_id}`,
  - `quota_threshold_alerts_suppressed_total{cause, tenant_id}`,
  - `quota_threshold_alert_evaluation_duration_seconds`.

Implementation constraints:

- reuse T02 `evaluateQuotaDimensionPosture()` and `buildTenantQuotaPosture()` as the posture source
  of truth,
- never re-implement threshold comparison logic; read posture states from T02 helpers,
- preserve tenant/workspace scope isolation throughout; workspace events must not disclose
  cross-workspace data,
- the Kafka emission and last-known posture write must be performed atomically (or with explicit
  idempotency guarantees) to prevent duplicate events on restart,
- and never block, modify provisioning state, or return enforcement decisions in this task.

### 3.6 Last-known posture store — DDL (PostgreSQL)

Add a new table (migration `V{next}__quota_threshold_alert_posture_store.sql`):

```sql
CREATE TABLE quota_last_known_posture (
    tenant_id          TEXT        NOT NULL,
    workspace_id       TEXT,                           -- NULL for tenant-scoped
    dimension_id       TEXT        NOT NULL,
    posture_state      TEXT        NOT NULL,
    evaluated_at       TIMESTAMPTZ NOT NULL,
    snapshot_timestamp TIMESTAMPTZ NOT NULL,
    correlation_id     TEXT        NOT NULL,
    PRIMARY KEY (tenant_id, workspace_id, dimension_id)
);

CREATE INDEX ON quota_last_known_posture (tenant_id);
CREATE INDEX ON quota_last_known_posture (tenant_id, workspace_id);
```

Notes:

- `workspace_id` uses `NULL` (not empty string) for tenant-scoped entries; the primary key uses
  `COALESCE(workspace_id, '')` in practice to satisfy PK constraints; document the convention.
- No `deleted_at` column; workspace deletion must purge rows explicitly in a cleanup hook.
- The table is internal; no public API route reads it directly.

### 3.7 Kafka schema registration

Register the alert event envelope schema in the platform schema registry:

- Subject: `quota.threshold.alerts-value`
- Format: JSON Schema (matching the envelope defined in § 4.1)
- Compatibility: `BACKWARD` — new optional fields may be added; required fields must not be removed.

Document the subject name and compatibility policy in `observability-threshold-alerts.json`.

### 3.8 Documentation

Add/update:

- `docs/reference/architecture/observability-threshold-alerts.md` (new)
- `docs/reference/architecture/README.md`
- `docs/tasks/us-obs-03.md`

The architecture doc should explain:

- the alert evaluation cycle trigger and cadence,
- the last-known posture store and its role in deduplication,
- event type catalog and trigger conditions,
- suppression and recovery semantics,
- multi-threshold crossing ordering,
- Kafka topic config (name, key, schema subject, ACLs),
- correlation-id strategy,
- observability counters and lag metric,
- explicit downstream boundary to `T04`–`T06`,
- and rollback posture.

### 3.9 Tests

Add:

- `tests/unit/observability-threshold-alerts.test.mjs`
- `tests/contracts/observability-threshold-alerts.contract.test.mjs`

Unit coverage (see § 6.1 for full list).

Contract coverage (see § 6.2 for full list).

---

## 4. Data / Contract Model

### 4.1 Alert event envelope

Every event published to `quota.threshold.alerts` must include all of the following fields:

| Field | Type | Description |
| --- | --- | --- |
| `eventType` | string | One of the documented alert event types (see § 4.2) |
| `tenantId` | string | Tenant scope identifier |
| `workspaceId` | string \| null | Workspace scope identifier; `null` for tenant-scoped alerts |
| `dimension` | string | Metered dimension key from the usage-consumption catalog (T01) |
| `measuredValue` | number | Current usage value at the time of the transition |
| `thresholdValue` | number | The threshold that was crossed (or recovered from) |
| `thresholdType` | string | `warning`, `soft_limit`, or `hard_limit` |
| `previousPosture` | string | Posture state before this transition (from T02 posture-state catalog) |
| `newPosture` | string | Posture state after this transition |
| `headroom` | number \| null | Remaining headroom to the next higher threshold; `null` for hard limit or when not applicable |
| `evidenceFreshness` | string | Freshness status of the underlying usage snapshot (from T01 freshness catalog) |
| `evaluationTimestamp` | string (ISO 8601) | When the alert evaluation was performed |
| `snapshotTimestamp` | string (ISO 8601) | Timestamp of the underlying usage snapshot |
| `correlationId` | string | Stable identifier linking this event to the T02 posture snapshot and the T01 usage snapshot |
| `actor` | object | Audit `actor` from the canonical audit vocabulary (`US-OBS-02`): `{ type: "system", id: "quota-alert-evaluator" }` |
| `action` | string | Canonical audit action matching the event type (e.g., `quota.threshold.warning_reached`) |
| `resource` | object | Canonical audit resource: `{ type: "quota_dimension", id: "<tenantId>/<dimension>" }` |

For suppression events (`quota.threshold.alert_suppressed`), the fields `measuredValue`,
`thresholdValue`, `thresholdType`, `previousPosture`, `newPosture`, and `headroom` are replaced by:

| Field | Type | Description |
| --- | --- | --- |
| `suppressionCause` | string | `evidence_degraded` or `evidence_unavailable` |
| `suppressedEventType` | string | The event type that would have been emitted if evidence had been fresh |

### 4.2 Alert event type catalog

| Event type | Trigger condition | Transition direction |
| --- | --- | --- |
| `quota.threshold.warning_reached` | Usage crosses warning threshold upward | Escalation |
| `quota.threshold.soft_limit_exceeded` | Usage crosses soft limit upward | Escalation |
| `quota.threshold.hard_limit_reached` | Usage crosses hard limit upward | Escalation |
| `quota.threshold.warning_recovered` | Usage drops below warning threshold after previous warning | Recovery |
| `quota.threshold.soft_limit_recovered` | Usage drops below soft limit after previous soft-limit breach | Recovery |
| `quota.threshold.hard_limit_recovered` | Usage drops below hard limit after previous hard-limit breach | Recovery |
| `quota.threshold.alert_suppressed` | Alert suppressed due to degraded or unavailable evidence | Suppression |

### 4.3 Posture transition semantics

Transition detection compares `currentPosture` from the T02 evaluator with `lastKnownPosture` from
the persistent store:

- **Escalation**: `currentPosture` is higher severity than `lastKnownPosture`. If the gap spans
  multiple boundaries (e.g., `within_limit` → `hard_limit_reached`), emit all intermediate events
  in ascending severity order within the same evaluation cycle:
  1. `quota.threshold.warning_reached` (if warning threshold exists)
  2. `quota.threshold.soft_limit_exceeded` (if soft limit exists)
  3. `quota.threshold.hard_limit_reached`

- **Recovery**: `currentPosture` is lower severity than `lastKnownPosture`. Emit one recovery event
  per threshold boundary that is now below the current measured value. Recovery events are emitted
  in descending severity order (highest threshold first).

- **Unchanged**: `currentPosture == lastKnownPosture`. No event is emitted.

- **Suppression**: `evidenceFreshness` is `degraded` or `unavailable`. Emit one
  `quota.threshold.alert_suppressed` event. Do **not** update last-known posture, so that the
  transition is re-evaluated when fresh evidence becomes available.

- **First-seen dimension**: `lastKnownPosture` is `null` (no prior record in store). Treat
  `within_limit` as the implicit baseline and apply the standard escalation logic against the
  current posture.

- **Unbounded dimension**: `policyMode == unbounded` per T02 contract. Never emit any alert event;
  skip transition detection entirely.

### 4.4 Suppression rules

| Evidence freshness (T01) | Alert behavior |
| --- | --- |
| `fresh` | Normal transition detection and emission |
| `degraded` | Emit `alert_suppressed` with `suppressionCause: evidence_degraded`; do not update last-known posture |
| `unavailable` | Emit `alert_suppressed` with `suppressionCause: evidence_unavailable`; do not update last-known posture |

### 4.5 Recovery oscillation policy

By default, every real transition (including oscillating recoveries) emits an event. An optional
dampening mechanism (configurable minimum recovery window before re-alerting) may be introduced in
a later increment. If dampening is added, it must be explicitly configured and documented; it must
never be applied silently.

### 4.6 Last-known posture store consistency

The store write and the Kafka emit must be coordinated to avoid duplicates on restart:

- Preferred: emit to Kafka within a local transaction using transactional producer semantics; write
  to PostgreSQL in the same application transaction and commit only after the Kafka send is
  acknowledged.
- If transactional Kafka is not available in the deployment profile: use the PostgreSQL row as the
  source of truth, perform an idempotent Kafka emit keyed on `correlationId`, and document the
  at-least-once delivery guarantee for downstream consumers.
- The chosen strategy must be documented in the architecture doc and in the contract.

---

## 5. Risk, Compatibility, and Rollback

### 5.1 Key risks

- **Duplicate events on restart**: If the store write and Kafka emit are not atomic, a process
  restart between the two can cause the same transition event to be re-emitted. Mitigation: use
  the atomicity strategy from § 4.6; expose `correlationId` for downstream deduplication.

- **Stale last-known posture after workspace deletion**: Orphaned store rows could cause a false
  transition when the workspace is recreated. Mitigation: add a cleanup hook that purges store rows
  for the deleted workspace; document the hook in the architecture doc.

- **Burst event emission under high tenant count**: A wide policy change (e.g., threshold lowered
  globally) could cause all tenants to cross simultaneously. Mitigation: the evaluation cycle must
  process scopes sequentially or in bounded batches and must expose producer lag metrics so
  operators can detect backpressure.

- **T02 posture evaluator divergence**: If T02 helper outputs change shape between T02 and T03
  branches, alert builders could silently receive incorrect posture states. Mitigation: pin
  source-contract version in the alert contract and assert alignment in the validator.

- **Evidence freshness masking a real breach**: If evidence is perpetually `degraded`, a genuine
  threshold breach may never be alerted. Mitigation: suppression events are emitted so operators
  can detect the degraded state and investigate the evidence pipeline. The architecture doc must
  document this limitation.

- **Threshold configuration change mid-cycle**: A lower threshold after an existing breach could
  cause the comparison to detect an escalation even though usage has not changed. Mitigation: FR-014
  is explicit that the next cycle re-evaluates against the updated policy; document that operators
  should expect a transition event after any threshold change.

### 5.2 Compatibility posture

This increment is additive:

- new contract file,
- additive readers and helper exports,
- additive PostgreSQL table (no existing schema modified),
- new Kafka topic (no existing topic modified),
- additive docs and tests,
- and no modification to T01 or T02 artifacts.

No destructive migration is expected. Downstream tasks (`T04`, `T05`) that have not yet been
implemented are not impacted.

### 5.3 Rollback posture

If the increment must be rolled back:

- Remove the new contract file and its reader/accessor exports from `index.mjs`.
- Remove the alert helpers from `observability-admin.mjs`.
- Drop the `quota_last_known_posture` table (migration rollback script).
- Delete the `quota.threshold.alerts` Kafka topic (or leave it empty; it has no dependents at this
  point).
- Unregister the schema registry subject if desired.
- Restoring to this state leaves T01 and T02 intact and undisturbed.

---

## 6. Verification Strategy

### 6.1 Unit test coverage (`tests/unit/observability-threshold-alerts.test.mjs`)

- Validator pass for the new contract.
- Summary output shape.
- Transition detection: same posture → no transitions.
- Transition detection: within-limit → warning → emit one escalation.
- Transition detection: within-limit → hard-limit (skip over soft absent) → emit warning + hard.
- Transition detection: within-limit → hard-limit (soft present) → emit warning + soft + hard in
  order.
- Transition detection: hard-limit → within-limit → emit hard-recovered.
- Transition detection: hard-limit → soft-limit → emit hard-recovered only.
- First-seen dimension with breach → treat baseline as within-limit and escalate.
- Unbounded dimension → no events emitted.
- Evidence degraded → suppression event, no transition events, last-known posture not updated.
- Evidence unavailable → suppression event, no transition events.
- Alert event envelope contains all required fields.
- Suppression event envelope contains `suppressionCause` and `suppressedEventType`.
- Workspace-scoped event carries both `tenantId` and `workspaceId`.
- Correlation-id is deterministic for the same input tuple (stable under re-run).
- Prometheus metrics incremented after evaluation cycle.

### 6.2 Contract test coverage (`tests/contracts/observability-threshold-alerts.contract.test.mjs`)

- Shared readers and accessors are exported from `index.mjs`.
- Source-contract version alignment: alert contract pins the same versions as the installed
  quota-policies and usage-consumption contracts.
- All alert event types in the catalog have distinct `eventType` values.
- All suppression causes map to a freshness state from the usage-consumption contract.
- Kafka topic config is present with `topicName`, `partitionKey`, and `schemaSubject`.
- Alert event envelope schema is present and references all fields from the contract.
- Explicit downstream boundaries to `T04`–`T06` are documented in the contract.
- Architecture doc exists at `docs/reference/architecture/observability-threshold-alerts.md`.
- README index references the new architecture doc.
- `docs/tasks/us-obs-03.md` contains a `T03` summary section.

### 6.3 Targeted validation

```sh
npm run validate:observability-threshold-alerts
node --test tests/unit/observability-threshold-alerts.test.mjs
node --test tests/contracts/observability-threshold-alerts.contract.test.mjs
```

### 6.4 Full regression

```sh
npm run lint
npm test
```

### 6.5 Expected evidence

- Contract validator passes with zero violations.
- Unit tests prove transition detection, escalation ordering, recovery, suppression, unbounded
  dimensions, first-seen handling, and workspace isolation.
- Contract tests prove readers/event-catalog/Kafka-config/docs alignment.
- Architecture doc is present and discoverable from the README.
- Task summary in `us-obs-03.md` reflects the T03 baseline and the residual T04–T06 boundary.
- No T01 or T02 file was modified.

---

## 7. Recommended Execution Sequence

1. Add the new threshold-alert contract.
2. Expose the shared readers and accessors in `index.mjs`.
3. Add the validator library and dedicated script plus `package.json` wiring.
4. Add the PostgreSQL migration for `quota_last_known_posture`.
5. Register the Kafka schema (or document the registration step for the deployment pipeline).
6. Extend `observability-admin.mjs` with the store helpers, transition detector, event builders,
   evaluation-cycle orchestrator, and metrics recorder.
7. Add docs and `us-obs-03.md` task-summary updates.
8. Add unit and contract tests.
9. Run targeted validation (`validate:observability-threshold-alerts`, unit, contract).
10. Run full lint and test suite.
11. Inspect the final diff to confirm the increment stays within the alert contract, store
    migration, admin helpers, Kafka config, docs, and tests — and did not absorb T04–T06 work.
12. Commit, push, open PR on `039-observability-threshold-alerts`, watch CI, fix regressions,
    and merge.

---

## 8. Definition of Done

`US-OBS-03-T03` is done when:

- `services/internal-contracts/src/observability-threshold-alerts.json` exists and validates
  cleanly, including source-contract version pins and explicit T04–T06 boundaries,
- shared readers and accessors are available through `services/internal-contracts/src/index.mjs`,
- `scripts/lib/observability-threshold-alerts.mjs` exists and passes
  `npm run validate:observability-threshold-alerts`,
- the `quota_last_known_posture` PostgreSQL migration exists and is registered in the migration
  sequence,
- the Kafka topic name, partitioning key, schema subject, and ACL policy are documented in the
  contract and architecture doc,
- `observability-admin.mjs` exposes the store helpers, transition detector, event builders, and
  evaluation-cycle orchestrator without modifying any T01 or T02 helper,
- the architecture doc at `docs/reference/architecture/observability-threshold-alerts.md` explains
  the evaluation cycle, event catalog, suppression/recovery rules, Kafka semantics, correlation
  strategy, atomicity posture, and rollback procedure,
- `docs/reference/architecture/README.md` references the new doc,
- `docs/tasks/us-obs-03.md` contains a `## Scope delivered in 'US-OBS-03-T03'` section,
- `tests/unit/observability-threshold-alerts.test.mjs` covers all transition scenarios,
  suppression, recovery, unbounded, first-seen, workspace isolation, and metrics,
- `tests/contracts/observability-threshold-alerts.contract.test.mjs` covers readers, catalog,
  Kafka config, downstream boundaries, and doc discoverability,
- targeted validator/unit/contract runs are green,
- full `npm run lint` and `npm test` are green,
- and the branch is committed, pushed, PR'd, checked green, and merged without absorbing T04–T06
  work.
