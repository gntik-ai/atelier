# Observability Threshold Alerts

This document records the bounded threshold-alert baseline introduced by `US-OBS-03-T03`.
It consumes the usage baseline from `US-OBS-03-T01` and the quota-posture baseline from
`US-OBS-03-T02` without absorbing the downstream blocking, console, or cross-module test work
reserved for `T04`–`T06`.

## Authoritative machine-readable source

`services/internal-contracts/src/observability-threshold-alerts.json` is the source of truth for:

- threshold alert event types and transition directions,
- suppression causes and freshness mappings,
- the alert event envelope,
- Kafka topic configuration,
- last-known posture storage semantics,
- correlation-id strategy,
- evaluation ordering rules,
- and delivery / atomicity posture.

## Evaluation cycle and cadence

A threshold-alert evaluation cycle runs **after each usage snapshot refresh**.

Default cadence remains bounded by the usage-consumption contract and should stay at or below
**5 minutes** unless a narrower operational profile is explicitly documented.

Each cycle:

1. loads the current quota posture snapshot,
2. checks evidence freshness,
3. suppresses alert emission when evidence is degraded or unavailable,
4. compares the current posture to the last-known stored posture,
5. emits ordered escalation or recovery events,
6. writes the new last-known posture atomically with the event emission posture whenever possible,
7. records bounded Prometheus metrics for emitted alerts, suppressions, duration, and producer lag.

## Last-known posture store

The last-known posture store exists to provide:

- deduplication across repeated evaluation cycles,
- restart safety after evaluator restarts,
- ordered recovery emission after a prior breach,
- and first-seen dimension handling without inventing hidden alert state.

Schema:

- table: `quota_last_known_posture`
- key: `tenant_id`, `workspace_id`, `dimension_id`
- value: `posture_state`, `evaluated_at`, `snapshot_timestamp`, `correlation_id`

Tenant-scoped rows use `workspace_id = NULL`.
The physical primary-key posture uses `COALESCE(workspace_id, '')` in PostgreSQL so tenant and
workspace records remain distinct and uniquely addressable.

## Event catalog and trigger conditions

Escalation events:

- `quota.threshold.warning_reached`
- `quota.threshold.soft_limit_exceeded`
- `quota.threshold.hard_limit_reached`

Recovery events:

- `quota.threshold.warning_recovered`
- `quota.threshold.soft_limit_recovered`
- `quota.threshold.hard_limit_recovered`

Suppression event:

- `quota.threshold.alert_suppressed`

Important semantics:

- escalation emits all intermediate transitions in **ascending severity** within one cycle,
- recovery emits transitions in **descending severity** within one cycle,
- first-seen dimensions treat `within_limit` as the implicit baseline,
- unbounded dimensions never emit threshold transitions,
- threshold comparisons inherit the inclusive `>=` rule from `US-OBS-03-T02`.

## Suppression and recovery semantics

Suppression causes are intentionally bounded to usage freshness:

- `evidence_degraded`
- `evidence_unavailable`

When suppression occurs:

- a suppression envelope may be emitted,
- threshold transition events are not emitted for that cycle,
- the last-known posture is not advanced using degraded or unavailable evidence.

Recovery is emitted only when the current trustworthy posture drops below a previously recorded
threshold posture.

## Kafka topic posture

Kafka transport is intentionally simple and stable for this increment:

- topic name: `quota.threshold.alerts`
- partitioning key: `tenantId`
- schema subject prefix: `quota.threshold.alerts-value`
- compatibility policy: `BACKWARD`
- ACL posture: producers are limited to the threshold-alert emitter and consumers remain bounded to
  authorized internal services

## Correlation strategy

Each alert event correlation id is deterministic and derived from:

- `tenantId`
- `workspaceId` when present
- `dimensionId`
- `snapshotTimestamp`
- transition or suppression token

The strategy explicitly links both:

- the quota posture snapshot
- the usage snapshot

That allows downstream consumers and future audit work to trace threshold decisions back to the
exact posture and evidence inputs without introducing notification-channel semantics.

## Atomicity and delivery guarantees

Preferred posture:

- transactional Kafka producer coordinated with the posture-store write

Fallback posture:

- at-least-once delivery with idempotent consumers

This preserves the baseline guarantee that restart recovery should not create unsafe ambiguity about
whether a threshold transition was already published.

## Prometheus metrics

The evaluator records:

- `quota_threshold_alerts_emitted_total{event_type,tenant_id}`
- `quota_threshold_alerts_suppressed_total{cause,tenant_id}`
- `quota_threshold_alert_evaluation_duration_seconds`
- `quota_threshold_alerts_producer_lag_seconds`

These metrics stay bounded to evaluator health and alert throughput only.
They do not deliver final console UX or notification routing behavior.

## Explicit downstream boundary

This increment stops at the threshold-alert baseline.
It does **not** implement:

- `US-OBS-03-T04` hard-limit blocking
- `US-OBS-03-T05` console usage / quota projection
- `US-OBS-03-T06` broad cross-module enforcement verification

## Rollback procedure

If this increment must be rolled back:

1. stop the threshold-alert evaluator,
2. disable producers for `quota.threshold.alerts`,
3. revert the application code and contract readers,
4. leave the posture-store table in place unless an operator-approved data rollback is required,
5. if the migration itself must be reversed, archive posture rows first and then drop
   `quota_last_known_posture` in a coordinated maintenance window.
