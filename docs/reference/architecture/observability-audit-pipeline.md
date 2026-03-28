# Observability audit pipeline

## Purpose

`US-OBS-02-T01` establishes the common audit pipeline contract for platform administrative events.

This document is the human-readable companion to:

- `services/internal-contracts/src/observability-audit-pipeline.json`
- `scripts/lib/observability-audit-pipeline.mjs`
- `scripts/validate-observability-audit-pipeline.mjs`

It defines the bounded foundation that downstream audit tasks will consume for schema work, query
surfaces, export and masking behavior, and cross-system correlation.

## Scope boundary

This increment defines the **pipeline contract only**.

Included in `US-OBS-02-T01`:

- subsystem enrollment and minimum administrative event categories
- Kafka-backed pipeline topology
- at-least-once delivery semantics
- tenant and platform isolation rules
- audit pipeline health signals aligned with the existing observability plane
- resilience handling for unclassified, unattributed, stale, and back-pressured events
- self-audit requirements for pipeline configuration changes

Explicitly deferred to later tasks:

- detailed event field schema (`US-OBS-02-T02`)
- query and filter APIs (`US-OBS-02-T03`)
- export, sensitive marking, and masking policy execution (`US-OBS-02-T04`)
- cross-system correlation and traceability (`US-OBS-02-T05`)
- end-to-end verification and traceability testing (`US-OBS-02-T06`)
- runtime emitters, Kafka provisioning, consumers, and durable-store adapters

## Pipeline topology

The authoritative path is:

```text
subsystem emitter → Kafka audit transport → durable audit store
```

Contract rules:

- Kafka is the required transport backbone.
- Tenant-scoped events use the topic pattern `audit.<tenant_id>`.
- Platform-scoped events use `audit.platform`.
- Events without a valid `tenant_id` are retained and routed to the platform-scoped unattributed path instead of being dropped.
- Ordering is only guaranteed within one tenant partition.
- Delivery semantics are **at least once**, so downstream consumers must remain idempotent.

## Required subsystem roster

The common audit pipeline currently requires all eight platform subsystems below.

| Subsystem ID | Display name | Minimum required event categories |
|---|---|---|
| `iam` | IAM (Keycloak) | `resource_creation`, `resource_deletion`, `configuration_change`, `access_control_modification`, `privilege_escalation` |
| `postgresql` | PostgreSQL | `resource_creation`, `resource_deletion`, `configuration_change`, `access_control_modification` |
| `mongodb` | MongoDB | `resource_creation`, `resource_deletion`, `configuration_change`, `access_control_modification` |
| `kafka` | Kafka | `resource_creation`, `resource_deletion`, `configuration_change`, `access_control_modification` |
| `openwhisk` | OpenWhisk | `resource_creation`, `resource_deletion`, `configuration_change`, `quota_adjustment` |
| `storage` | S3-compatible storage | `resource_creation`, `resource_deletion`, `configuration_change`, `access_control_modification` |
| `quota_metering` | Quota and metering layer | `quota_adjustment`, `configuration_change`, `resource_creation`, `resource_deletion` |
| `tenant_control_plane` | Tenant and workspace control plane | `resource_creation`, `resource_deletion`, `configuration_change`, `access_control_modification`, `privilege_escalation` |

The validator treats missing subsystem entries or empty required-category lists as deterministic contract failures.

## Delivery and durability posture

The contract fixes the following pipeline guarantees:

- **Transport backbone**: Kafka
- **Delivery semantics**: at least once
- **Tenant partition key**: `tenant_id`
- **Platform partition key**: `platform`
- **Workspace attribution**: optional `workspace_id` metadata only when the emitter can safely provide it
- **Back-pressure behavior**: retry and surface degradation; do not silently drop audit events
- **Storage failure behavior**: retain events in transport until the durable store recovers or the configured retention window is exhausted

This task intentionally does not define the physical Kafka topic provisioning, broker settings, or durable-store implementation.

## Tenant isolation model

Tenant isolation is a hard invariant of the audit pipeline.

Rules encoded by the contract:

- `tenant_id` is required for tenant-scoped events.
- `workspace_id` is optional and must never be fabricated.
- Platform-scoped events must stay in `audit.platform` and must not be mixed into tenant-scoped partitions.
- Unattributed events are retained for operator review and treated as a platform-scoped audit concern.
- Cross-tenant event leakage is classified as a security incident.
- Query surfaces built later must preserve this routing model rather than reconstructing isolation heuristically.

## Health signals aligned with US-OBS-01

The audit pipeline reuses the existing observability conventions from `US-OBS-01`.

Required health signal families:

| Signal | Metric name | Degraded condition |
|---|---|---|
| Emission freshness | `in_atelier_audit_emission_freshness_seconds` | A subsystem has not emitted within its freshness threshold |
| Transport health | `in_atelier_audit_transport_health` | Kafka transport is unavailable or lag exceeds threshold |
| Storage health | `in_atelier_audit_storage_health` | Durable-store writes fail or the store is unavailable |

Shared observability rules:

- Metrics retain the `in_atelier` prefix.
- Required labels remain `environment`, `subsystem`, `metric_scope`, and `collection_mode`.
- Status vocabulary reuses `healthy`, `degraded`, `unavailable`, `unknown`, and `stale`.
- Missing or stale audit emission is visible as degradation, not silent success.

## Resilience and edge-case handling

The common pipeline contract also fixes how several edge cases behave.

### Unclassified events

If a subsystem emits an event whose category is not yet declared, the event is still retained and marked as unclassified for operator review.

### Unattributed events

If a tenant-scoped event arrives without a valid `tenant_id`, it is not dropped and it is not assigned to a synthetic tenant. It is routed to the platform-scoped unattributed path.

### Startup or partial context

Subsystem startup gaps must not block event durability. Events with incomplete context can be retained and flagged for review.

### Transport or storage outage

When Kafka or the durable store is unavailable, the expected behavior is retry, buffering within configured limits, and visible degradation in the health model.

### Volume spikes

Bulk administrative activity must produce back-pressure and operational signals rather than silent event loss.

## Pipeline self-audit and governance

The audit pipeline is itself security-critical. For that reason the contract requires:

- only superadmin-level actors may change the pipeline configuration baseline
- pipeline configuration changes must themselves emit audit events through the same common pipeline
- the audit trail for pipeline changes must capture actor, time, change type, target subsystem, and correlation context

## Validation entry point

Primary validation entry point:

```bash
npm run validate:observability-audit-pipeline
```

The validation helper checks at least the following:

- contract version presence
- alignment with the observability metrics-stack and health-check contracts
- complete eight-subsystem coverage
- required event-category coverage
- Kafka topology and at-least-once semantics
- tenant-isolation shape
- required health signal presence and naming
- masking-policy alignment with the health-check baseline

## Implementation note

`US-OBS-02-T01` is intentionally a contract-and-validation increment.

It gives downstream audit work a stable foundation without prematurely implementing runtime emitters,
query features, export behavior, masking execution, or correlation logic.
