# Unified Observability Metrics Stack

This document records the foundational observability contract introduced by `US-OBS-01-T01`.
It defines how APISIX, Kafka, PostgreSQL, MongoDB, OpenWhisk, storage, and the control plane
publish operational metrics into one common observability plane without changing the public API
surface or claiming downstream dashboard and health-check work that belongs to `US-OBS-01-T02`
through `US-OBS-01-T06`.

## Scope of this baseline

This increment establishes:

- the seven subsystems that must report into the common plane,
- the normalized metric naming and labeling rules,
- the tenant and workspace isolation strategy for metric selectors,
- the minimum required categories per subsystem,
- the collection topology, intervals, and staleness windows,
- the collection-health meta-metrics that make scrape or ingestion failures visible,
- and the internal retention and resolution targets for the observability layer.

This increment does **not** implement dashboards, readiness or liveness endpoints, alert rules,
business metrics, or tenant-facing console views.

## Authoritative machine-readable source

`services/internal-contracts/src/observability-metrics-stack.json` is the source of truth for the
metrics-stack contract. The Helm-facing baseline under `charts/in-falcone/values.yaml` mirrors the
same subsystem targets and collection-health metadata so future deployment work can stay aligned
with the internal contract.

## Normalized metric naming

All common-plane metrics use the `in_falcone_` prefix.

The foundational normalized metric families are:

- `in_falcone_component_up`
- `in_falcone_component_operations_total`
- `in_falcone_component_operation_errors_total`
- `in_falcone_component_operation_duration_seconds`
- `in_falcone_observability_collection_health`
- `in_falcone_observability_collection_failures_total`
- `in_falcone_observability_collection_lag_seconds`

These are normalized projection names for the common observability plane. Native component metrics
such as APISIX, Kafka, PostgreSQL, MongoDB, OpenWhisk, or storage exporter series may continue to
exist internally, but the shared plane and downstream tasks should anchor on the normalized names
and labels described here.

## Required labels

Every normalized metric family carries the following required labels:

- `environment`
- `subsystem`
- `metric_scope`
- `collection_mode`

Additional labels are allowed only when they remain bounded and semantically stable. The common
examples are:

- `operation`
- `error_class`
- `route_template`
- `resource_kind`
- `status_class`

## Tenant and workspace isolation

Tenant isolation is a platform invariant at the metrics layer.

### Scope rules

- `metric_scope=platform` marks infrastructure-global series.
- `metric_scope=tenant` marks tenant-attributable series where workspace granularity is not safely
  available.
- `metric_scope=workspace` marks tenant-attributable series with safe workspace-level attribution.

### Selector rules

- `tenant_id` is mandatory on every tenant-attributable series.
- `workspace_id` is mandatory when the subsystem can safely distinguish workspace ownership.
- Platform-scoped metrics omit `tenant_id` and `workspace_id` rather than filling wildcard values.
- Tenant-scoped queries must exclude `metric_scope=platform` series unless the caller has
  platform-wide scope and explicitly requests an aggregated platform view.

### Forbidden labels

The following labels are forbidden because they create high-cardinality or sensitive series:

- `user_id`
- `session_id`
- `request_id`
- `raw_path`
- `raw_query`
- `raw_topic_name`
- `object_key`
- `authorization_header`

### Bounded labels

When additional labels are needed, use bounded forms only:

- route families or route templates instead of raw URLs,
- logical topic identifiers instead of physical broker topic names,
- logical bucket identifiers or prefixes instead of full object keys,
- stable action identifiers instead of activation payload fragments,
- logical database references instead of connection-string fragments.

## Latency convention

Latency uses a normalized histogram named
`in_falcone_component_operation_duration_seconds` with the following bucket strategy:

- `0.005`
- `0.01`
- `0.025`
- `0.05`
- `0.1`
- `0.25`
- `0.5`
- `1`
- `2.5`
- `5`
- `10`

Downstream tasks that need percentile views, degradation panels, or alert thresholds must derive
them from this histogram rather than inventing incompatible latency names.

## Collection-health meta-metrics

Collection failures must be visible as first-class signals rather than silent data gaps.

The common plane therefore reserves:

- `in_falcone_observability_collection_health`
- `in_falcone_observability_collection_failures_total`
- `in_falcone_observability_collection_lag_seconds`

Required labels for collection-health signals are:

- `environment`
- `subsystem`
- `collection_mode`
- `target_ref`

`in_falcone_observability_collection_health` uses `1` for a healthy target and `0` for a failed or
stale target.

## Internal operating targets

These are internal operating targets for the platform team, not customer-facing SLA promises.

- common-plane default collection model: `hybrid`
- default scrape interval: `30s`
- default staleness window: `120s`
- control-plane interval: `15s`
- hot retention: `15d`
- downsample boundary: `90d`
- cold retention target: `395d`
- default query resolution: `30s`
- downsampled resolutions: `5m`, `1h`

## Subsystem collection topology

| Subsystem | Mode | Target | Interval | Max staleness | Scope notes |
| --- | --- | --- | --- | --- | --- |
| APISIX | scrape | `apisix` `http` `/apisix/prometheus/metrics` | `30s` | `120s` | platform, tenant, and workspace metrics via bounded route and gateway-context labels |
| Kafka | scrape | `kafka` `metrics` `/metrics` | `30s` | `120s` | broker health is platform scoped; topic, bridge, trigger, and lag views can become tenant or workspace scoped after logical ownership mapping |
| PostgreSQL | scrape | `postgresql` `metrics` `/metrics` | `30s` | `120s` | engine health is platform scoped; platform-managed admin and data-api projections may be tenant or workspace scoped |
| MongoDB | scrape | `mongodb` `metrics` `/metrics` | `30s` | `120s` | engine health is platform scoped; collection-level series use bounded logical identifiers only |
| OpenWhisk | scrape | `openwhisk` `metrics` `/metrics` | `30s` | `120s` | action and trigger metrics may be tenant/workspace scoped through platform-managed namespace mapping |
| Storage | hybrid | `storage` `metrics` `/metrics` | `60s` | `180s` | provider-global health is platform scoped; tenant/workspace storage usage and object-operation views use logical bucket identifiers only |
| Control plane | scrape | `controlPlane` `http` `/metrics` | `15s` | `60s` | platform APIs, admin flows, and platform-managed projections may expose tenant and workspace attribution when safe |

## Minimum category coverage per subsystem

Each subsystem contributes the following minimum category set:

- availability / up
- throughput / operations total
- error counters
- latency distribution

This is the minimum prerequisite for the sibling dashboard, health, alerting, and smoke-test tasks.
A subsystem is not considered integrated into the common observability plane until all four
categories are present and recent.

## Notes for downstream observability tasks

- `US-OBS-01-T02` should build dashboards against the normalized metric families and scope labels in
  this document.
- `US-OBS-01-T03` should reuse the collection-health contract rather than invent a parallel health
  vocabulary.
- `US-OBS-01-T04` should keep business metrics additive and clearly separate from this
  infrastructure baseline.
- `US-OBS-01-T05` should respect the same tenant and workspace selector rules when summarizing
  health in the console.
- `US-OBS-01-T06` should validate both subsystem presence and collection-health freshness.

## Residual implementation note

This baseline defines the contract, configuration shape, and validation surface for the unified
metrics stack. It does not claim that a full production Prometheus, TSDB, or dashboard deployment is
already running for every component; those runtime and product-facing concerns remain the scope of
later observability tasks.
