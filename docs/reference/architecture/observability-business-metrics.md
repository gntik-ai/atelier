# Observability Business Metrics

This document records the canonical business and product metrics baseline introduced by
`US-OBS-01-T04`.
It extends the unified observability plane established by `US-OBS-01-T01`, stays compatible with
the dashboard scope hierarchy from `US-OBS-01-T02`, and reuses the same freshness caution that
`US-OBS-01-T03` applied to health/probe evidence.

This increment does **not** implement dashboards, alert thresholds, billing logic, console widgets,
or smoke verification. It defines the internal contract that future work must consume.

## Authoritative machine-readable source

`services/internal-contracts/src/observability-business-metrics.json` is the source of truth for:

- business metric domains,
- metric families and supported scopes,
- required labels and bounded dimensions,
- forbidden labels and masking posture,
- audit and freshness expectations,
- and downstream reuse guidance for quota, metering, console, and alerting work.

## Why business metrics belong in the same observability plane

The platform already records whether core subsystems are healthy and whether telemetry is fresh.
That is necessary, but it is not sufficient.

Operators and platform owners also need to know:

- whether tenants and workspaces are active,
- whether API, function, storage, realtime, and data-service workloads are being used,
- whether quota pressure is building for a tenant or workspace,
- and whether a technical degradation has product impact.

Keeping business metrics in the same plane gives downstream work one vocabulary for:

- scope (`platform`, `tenant`, `workspace`),
- cardinality controls,
- freshness semantics,
- and auditable query behavior.

## Covered business domains

The baseline currently defines these business domains:

- `tenant_lifecycle`
- `workspace_lifecycle`
- `api_usage`
- `identity_activity`
- `function_usage`
- `data_service_usage`
- `storage_usage`
- `realtime_event_activity`
- `quota_posture`

The current metric families are intentionally bounded and reusable:

- `in_atelier_tenant_active_total`
- `in_atelier_workspace_active_total`
- `in_atelier_api_requests_total`
- `in_atelier_identity_events_total`
- `in_atelier_function_invocations_total`
- `in_atelier_data_service_operations_total`
- `in_atelier_storage_logical_volume_bytes`
- `in_atelier_realtime_connections_active`
- `in_atelier_quota_utilization_ratio`

## Scope and isolation rules

Business metrics reuse the same canonical scopes as the technical observability plane:

- `platform`
- `tenant`
- `workspace`

The dashboard-facing aliases remain:

- `global` → `platform`
- `tenant` → `tenant`
- `workspace` → `workspace`

Important safety rules:

- platform-only metrics must not be exposed as tenant-comparative signals,
- tenant-scoped metrics must allow `tenant_id`,
- workspace-scoped metrics must allow `workspace_id` only when workspace attribution is explicit and
  safe,
- and downstream consumers must not widen scope beyond what the metric family declares.

## Bounded-cardinality expectations

Business metrics are useful only if they stay queryable and safe.

That means the contract prefers normalized dimensions such as:

- `domain`
- `metric_type`
- `feature_area`
- `operation_family`
- `workspace_environment`
- `quota_metric_key`

And explicitly forbids raw or sensitive labels such as:

- `user_id`
- `request_id`
- `raw_path`
- `object_key`
- `email`
- `api_key_id`
- raw bucket, topic, route, or session identifiers

Identity-oriented business metrics must remain aggregated and must never expose principal-level
identifiers as labels.

## Freshness and collection semantics

Business metrics inherit the same collection-health caution as the technical observability plane.

That means downstream consumers must continue to interpret:

- `in_atelier_observability_collection_health`
- `in_atelier_observability_collection_lag_seconds`

when deciding whether business signals are current, stale, or missing.

A missing business signal must not be silently treated as current healthy activity.

## Relationship to health and technical observability

Business metrics are deliberately **not** the same thing as:

- infrastructure availability metrics,
- component latency and error metrics,
- liveness/readiness/health probe status,
- or runtime endpoint behavior.

Instead, they answer questions such as:

- how much of a capability is being used,
- whether adoption is growing or shrinking,
- and how close a tenant or workspace is to a quota boundary.

This separation matters because later tasks may correlate both signal classes, but they must not
collapse them into one undifferentiated health score.

## Notes for downstream work

- Quota and metering work should reuse the usage and saturation families instead of reading raw
  component metrics directly.
- Console and alerting work should preserve the same scope and masking rules when presenting business
  summaries.
- Smoke and operational verification work should validate that the promised business metric families
  exist and remain queryable without introducing unsafe labels.

## Residual implementation note

This baseline defines the machine-readable contract, helper surfaces, validation rules, and
architecture guidance for business metrics. It does not claim a live dashboard, alert-routing
policy, billing implementation, or smoke suite in this repository.
