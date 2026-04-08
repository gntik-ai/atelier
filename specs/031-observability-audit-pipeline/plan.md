# Implementation Plan: US-OBS-02-T01 — Common Audit Pipeline for Platform Subsystems

**Branch**: `031-observability-audit-pipeline` | **Date**: 2026-03-28 | **Spec**: `specs/031-observability-audit-pipeline/spec.md`
**Task**: US-OBS-02-T01 | **Epic**: EP-13 — Cuotas, metering, auditoría y observabilidad
**Requirements traceability**: RF-OBS-004, RF-OBS-005, RF-OBS-006, RF-OBS-007, RF-OBS-008, RF-OBS-018, RF-OBS-020

---

## Summary

This task introduces the **common audit pipeline contract** — the machine-readable, validatable
foundation that every platform subsystem must conform to when emitting, transporting, and durably
storing administrative audit events.

The implementation will:

1. Add `services/internal-contracts/src/observability-audit-pipeline.json` as the authoritative
   pipeline contract, enumerating all eight required subsystems, their event categories, the Kafka
   transport topology, delivery guarantees, tenant isolation rules, health signal definitions, and
   pipeline self-audit requirements.
2. Add `scripts/lib/observability-audit-pipeline.mjs` as the validation helper that loads the
   contract and runs deterministic violation checks.
3. Expose the new contract and constants through `services/internal-contracts/src/index.mjs` using
   the same reader and version-export pattern as the existing observability contracts.
4. Add a reference architecture document at
   `docs/reference/architecture/observability-audit-pipeline.md` that narrates the pipeline
   topology, subsystem roster, delivery semantics, isolation rules, and health signal model.

This increment does **not** implement Kafka topic configuration, emitter code, a storage adapter,
query APIs, masking logic, correlation IDs, or end-to-end traceability tests. Those are the
domain of T02–T06. This task delivers the contract and validation layer that those tasks will
consume as a read-only dependency.

Separation of concerns:
- The **implement step** (future) will write all production code (emitters, consumers, adapters).
- The **test step** (future) will write and run all tests (unit, contract, e2e).
- This plan covers contract artifacts, helper, documentation, and index wiring only.

---

## Technical Context

**Language / Runtime**: Node.js ESM modules, JSON contract artifact, Node test runner.
**Primary dependencies**: existing observability contract readers (metrics-stack, health-checks);
`scripts/lib/quality-gates.mjs` for `readJson`; `services/internal-contracts/src/index.mjs` for
shared exposure.
**Storage**: N/A — no database schema or persistence migration in this task.
**Testing**: contract validation via `scripts/lib/observability-audit-pipeline.mjs`;
unit tests and contract tests are deferred to the test step.
**Target platform**: Helm on Kubernetes and OpenShift.
**Project type**: contract-driven platform monorepo.

**Observability baseline consumed**:
- `services/internal-contracts/src/observability-metrics-stack.json` (US-OBS-01-T01): naming
  prefix `in_falcone`, required labels, high-cardinality label policy.
- `services/internal-contracts/src/observability-health-checks.json` (US-OBS-01-T03): health
  status vocabulary (`healthy`, `degraded`, `unavailable`, `unknown`, `stale`), probe result
  shape, masking policy, forbidden-exposed-fields list.

**Primary artifacts in scope**:

- `specs/031-observability-audit-pipeline/spec.md`
- `specs/031-observability-audit-pipeline/plan.md`
- `specs/031-observability-audit-pipeline/tasks.md`
- `services/internal-contracts/src/observability-audit-pipeline.json`
- `services/internal-contracts/src/index.mjs`
- `scripts/lib/observability-audit-pipeline.mjs`
- `docs/reference/architecture/observability-audit-pipeline.md`

**Artifacts explicitly out of scope for this task**:

- Production emitter code, Kafka topic provisioning, consumer or storage-adapter code.
- Query, export, masking, or correlation helpers.
- Unit tests (`tests/unit/observability-audit-pipeline.test.mjs`) — test step.
- Contract tests (`tests/contracts/observability-audit-pipeline.contract.test.mjs`) — test step.
- E2E tests — test step (US-OBS-02-T06).
- `package.json` test command extension — test step.

---

## Architecture / Content Strategy

### 1. The contract is the single source of truth for the pipeline

`services/internal-contracts/src/observability-audit-pipeline.json` is machine-readable,
versionable, and structurally consistent with the existing observability contracts. It governs:

- the **subsystem roster** (eight required subsystems, each with at least one event category),
- the **pipeline topology** (Kafka backbone, at-least-once delivery, tenant-partitioned ordering),
- the **tenant isolation model** (tenant-scoped vs. platform-scoped event routing, optional
  `workspace_id`, dead-letter routing for unattributed events),
- the **pipeline health signals** (emission freshness, transport health, storage health —
  integrated with the US-OBS-01 observability plane),
- the **edge-case and resilience rules** (unclassified events, unattributed events, transport
  unavailability, storage unavailability, back-pressure semantics),
- and the **self-audit requirement** (pipeline configuration changes are themselves auditable
  through the same pipeline).

The contract does **not** define field-level event schemas (T02), query filters (T03), export
or masking semantics (T04), or correlation identifiers (T05).

### 2. Contract structure mirrors the established observability contract pattern

Following `observability-health-checks.json` and `observability-metrics-stack.json`:

```json
{
  "version": "<ISO date>",
  "scope": "US-OBS-02-T01",
  "system": "in-falcone-observability-plane",
  "source_metrics_contract": "<observability-metrics-stack.json version>",
  "source_health_contract": "<observability-health-checks.json version>",
  "principles": [...],
  "subsystem_roster": [...],
  "pipeline_topology": {...},
  "delivery_guarantees": {...},
  "tenant_isolation": {...},
  "health_signals": {...},
  "resilience_rules": {...},
  "self_audit": {...},
  "masking_policy": {...},
  "observability_projection": {...}
}
```

Each **subsystem roster entry** has:
- `id` (stable identifier matching the health-checks component IDs where they overlap),
- `display_name`,
- `required_event_categories` (non-empty array),
- `optional_event_categories` (may be empty),
- `emission_freshness_threshold_seconds`,
- `scope_attribution` (`tenant`, `platform`, or `both`).

### 3. Eight required subsystems and their minimum event categories

The contract must enumerate all eight subsystems required by FR-001 and FR-002:

| Subsystem ID           | Min. event categories required by FR-002                                                                       |
|------------------------|----------------------------------------------------------------------------------------------------------------|
| `iam`                  | `resource_creation`, `resource_deletion`, `configuration_change`, `access_control_modification`, `privilege_escalation` |
| `postgresql`           | `resource_creation`, `resource_deletion`, `configuration_change`, `access_control_modification`               |
| `mongodb`              | `resource_creation`, `resource_deletion`, `configuration_change`, `access_control_modification`               |
| `kafka`                | `resource_creation`, `resource_deletion`, `configuration_change`, `access_control_modification`               |
| `openwhisk`            | `resource_creation`, `resource_deletion`, `configuration_change`, `quota_adjustment`                          |
| `storage`              | `resource_creation`, `resource_deletion`, `configuration_change`, `access_control_modification`               |
| `quota_metering`       | `quota_adjustment`, `configuration_change`, `resource_creation`, `resource_deletion`                          |
| `tenant_control_plane` | `resource_creation`, `resource_deletion`, `configuration_change`, `access_control_modification`, `privilege_escalation` |

Note: `iam` aligns with the Keycloak component. `tenant_control_plane` covers workspace lifecycle
events. `quota_metering` covers the quota/metering service introduced in US-PRG-03.

### 4. Pipeline topology is declared, not implemented

The contract declares the authoritative Kafka-backed topology:

```text
subsystem emitter → Kafka audit topic (tenant-partitioned) → durable audit store
```

Key declarations:
- **Transport backbone**: Kafka (required; FR-003).
- **Topic naming convention**: `audit.<tenant_id>` for tenant-scoped events;
  `audit.platform` for platform-scoped events and unattributed dead-letter routing.
- **Partition key**: `tenant_id` for all tenant-scoped events; `platform` for
  platform-level events.
- **Delivery semantics**: at-least-once (FR-004); idempotent consumer responsibility documented.
- **Ordering guarantee**: within a single tenant partition, events are ordered by emission
  timestamp; cross-partition ordering is not guaranteed.

### 5. Health signals integrate with the US-OBS-01 observability plane

The contract defines three health signal families for audit pipeline observability:

| Signal                   | Metric name                                      | Degraded condition                                               |
|--------------------------|--------------------------------------------------|------------------------------------------------------------------|
| Emission freshness        | `in_falcone_audit_emission_freshness_seconds`    | Last emission from subsystem exceeds threshold                   |
| Transport health          | `in_falcone_audit_transport_health`              | Kafka consumer lag exceeds threshold or broker unavailable        |
| Storage health            | `in_falcone_audit_storage_health`                | Durable store write failures or unavailability detected          |

All signals follow the `in_falcone` prefix (FR-008; metrics-stack contract §naming). Required
labels mirror the existing observability plane: `environment`, `subsystem`, `metric_scope`,
`collection_mode`. Health status vocabulary reuses the health-checks contract:
`healthy`, `degraded`, `unavailable`, `unknown`, `stale`.

Missing emission from any required subsystem beyond `emission_freshness_threshold_seconds` MUST
surface as `degraded` — not silent (FR-009).

### 6. Tenant isolation is declared as a hard contract invariant

The contract codifies:
- `tenant_id` is required on every tenant-scoped event; missing → dead-letter to `audit.platform`
  as unattributed (FR-006, FR-010).
- `workspace_id` is optional; the pipeline MUST NOT fabricate workspace attribution (FR-007).
- Platform-level events (e.g., pipeline config changes) route to `audit.platform` exclusively
  and are never injected into tenant partitions (FR-006).
- The contract explicitly prohibits cross-tenant event co-mingling and names it a security
  incident class (§7 spec).

### 7. The validation helper enforces the contract deterministically

`scripts/lib/observability-audit-pipeline.mjs` exports a
`collectAuditPipelineViolations(contract, metricsStack, healthChecks)` function that returns
an array of human-readable violation strings. It is deterministic: running against a valid
contract returns `[]`; removing a required subsystem returns a specific message identifying
the missing entry (FR-014, SC-003).

The helper uses the same `readJson` utility from `scripts/lib/quality-gates.mjs` as the
existing helpers.

### 8. Index wiring follows the existing export pattern

`services/internal-contracts/src/index.mjs` gains:
- `OBSERVABILITY_AUDIT_PIPELINE_URL` constant,
- `cachedObservabilityAuditPipeline` lazy cache,
- `readObservabilityAuditPipeline()` reader,
- `OBSERVABILITY_AUDIT_PIPELINE_VERSION` export,
- Accessor helpers: `listAuditPipelineSubsystems()`, `getAuditPipelineTopology()`,
  `getAuditPipelineHealthSignals()`, `getAuditPipelineTenantIsolation()`.

---

## Planned Changes by Artifact

### Spec Kit artifacts

| Artifact | Action |
|---|---|
| `specs/031-observability-audit-pipeline/spec.md` | Already materialized |
| `specs/031-observability-audit-pipeline/plan.md` | This document |
| `specs/031-observability-audit-pipeline/tasks.md` | To be materialized (tasks step) |

### Contract

| Artifact | Action |
|---|---|
| `services/internal-contracts/src/observability-audit-pipeline.json` | **Add** — new contract; version `2026-03-28`; fields described in §Architecture above |

### Index / shared readers

| Artifact | Action |
|---|---|
| `services/internal-contracts/src/index.mjs` | **Modify** — add URL constant, cache var, reader, version export, and four accessor helpers |

### Validation helper

| Artifact | Action |
|---|---|
| `scripts/lib/observability-audit-pipeline.mjs` | **Add** — exports path constants, `readObservabilityAuditPipeline()`, and `collectAuditPipelineViolations()` |

### Documentation

| Artifact | Action |
|---|---|
| `docs/reference/architecture/observability-audit-pipeline.md` | **Add** — narrative reference doc covering pipeline topology, subsystem roster, delivery semantics, tenant isolation model, health signals, edge-case rules, and T01 scope boundary |

### Deferred to test step

| Artifact | Deferred reason |
|---|---|
| `tests/unit/observability-audit-pipeline.test.mjs` | Test step: unit assertions on helper and contract internal consistency |
| `tests/contracts/observability-audit-pipeline.contract.test.mjs` | Test step: contract reader exposure, version-constant assertions, violation tests |
| `package.json` test command additions | Test step: wiring new test files into `npm test` |

---

## Key Entity Model

```text
AuditPipelineContract
  ├── SubsystemRosterEntry[]          (id, display_name, required_event_categories,
  │                                    optional_event_categories,
  │                                    emission_freshness_threshold_seconds,
  │                                    scope_attribution)
  ├── PipelineTopology                (transport_backbone, topic_naming, partition_key,
  │                                    delivery_semantics, ordering_guarantee)
  ├── DeliveryGuarantees              (semantics, idempotent_consumer_responsibility,
  │                                    buffer_on_transport_unavailability,
  │                                    back_pressure_behavior)
  ├── TenantIsolation                 (required_fields, missing_tenant_id_routing,
  │                                    workspace_id_policy, platform_event_routing,
  │                                    cross_tenant_prohibition)
  ├── HealthSignals[]                 (id, metric_name, required_labels,
  │                                    degraded_condition, healthy_condition)
  ├── ResilienceRules                 (unclassified_event_policy,
  │                                    unattributed_event_policy,
  │                                    transport_unavailable_policy,
  │                                    storage_unavailable_policy,
  │                                    volume_spike_policy)
  ├── SelfAudit                       (config_change_audit_requirement,
  │                                    audit_trail_attributable_fields)
  └── MaskingPolicy                   (forbidden_exposed_fields — inherited from
                                       health-checks contract for consistency)
```

---

## Verification Strategy

### Contract self-consistency

1. Instantiate the contract JSON and confirm `version` is a non-empty string.
2. Confirm `source_metrics_contract` matches `observability-metrics-stack.json` version.
3. Confirm `source_health_contract` matches `observability-health-checks.json` version.
4. Confirm all eight required subsystem IDs are present in `subsystem_roster`.
5. Confirm each subsystem entry has at least one `required_event_category`.
6. Confirm `pipeline_topology.transport_backbone === "kafka"`.
7. Confirm `delivery_guarantees.semantics === "at_least_once"`.
8. Confirm `tenant_isolation.required_fields` includes `tenant_id`.
9. Confirm `health_signals` contains at least three entries (emission, transport, storage).
10. Confirm each health signal metric name begins with `in_falcone_audit_`.
11. Confirm `masking_policy.forbidden_exposed_fields` is a non-empty array aligned with the
    health-checks contract.

### Validation helper determinism

1. Run `collectAuditPipelineViolations()` against the checked-in contract → returns `[]`.
2. Run against a contract with one subsystem removed → returns a violation naming that subsystem.
3. Run against a contract with an empty `required_event_categories` → returns a violation.
4. Run against a contract with `transport_backbone` removed → returns a violation.
5. Run against a contract with a `source_metrics_contract` version mismatch → returns a violation.

### Index reader exposure

1. `readObservabilityAuditPipeline()` returns the parsed contract.
2. `OBSERVABILITY_AUDIT_PIPELINE_VERSION` equals the contract `version` field.
3. `listAuditPipelineSubsystems()` returns an array of eight entries.
4. `getAuditPipelineTopology()` returns the `pipeline_topology` object.
5. `getAuditPipelineHealthSignals()` returns an array with at least three entries.
6. `getAuditPipelineTenantIsolation()` returns the `tenant_isolation` object.

### Reference documentation

1. Run `npm run lint:md` over `docs/reference/architecture/observability-audit-pipeline.md`.
2. Confirm the document references all eight subsystems by name.
3. Confirm the document explicitly states the T01 scope boundary (not T02–T06).

---

## Risks and Mitigations

### Risk: subsystem IDs diverge between this contract and the health-checks contract

The health-checks contract uses `apisix`, `kafka`, `postgresql`, `mongodb`, `openwhisk`,
`storage`, `control_plane`. The audit roster adds `iam`, `quota_metering`, and
`tenant_control_plane`, which have no health-check counterpart yet.

**Mitigation**: The audit contract is an independent roster. Where IDs overlap (kafka,
postgresql, mongodb, openwhisk, storage) they are kept identical. The three new IDs (`iam`,
`quota_metering`, `tenant_control_plane`) are introduced by this contract and documented as
audit-only until US-ARC-03 aligns the health-check roster. The validation helper does not
require a health-check component entry for every audit subsystem.

### Risk: the health signal metric names conflict with future emitter implementations

Defining metric names in the contract binds future emitter work.

**Mitigation**: Metric names follow the `in_falcone` prefix and naming conventions from the
metrics-stack contract. They are additive and do not modify any existing metric family.
If T02–T06 require narrower granularity, they extend rather than rename these families.

### Risk: the contract predates the Kafka topic naming convention being settled

The contract declares a topic naming convention (`audit.<tenant_id>`, `audit.platform`).
If the platform's Kafka governance (US-ARC-03) later defines a different convention, these
names may need updating.

**Mitigation**: The contract version is `2026-03-28`. Any breaking rename requires a new
contract version and a compatibility window, consistent with the versioning rules in the
metrics-stack contract. The validation helper checks structural integrity, not live Kafka
state, so no runtime impact exists at this task's stage.

### Risk: the `quota_metering` and `tenant_control_plane` subsystem IDs may conflict with identifiers introduced by US-PRG-03

**Mitigation**: Cross-check with `services/internal-contracts/src/internal-service-map.json`
during the implement step. If stable IDs differ, align this contract's IDs with the
service-map entries before merging.

### Risk: the contract becomes a de facto schema for T02

If too much field-level detail is added here, T02 (detailed schema) loses its clear mandate.

**Mitigation**: Keep the subsystem roster focused on event *categories* only. Field-level
schema (actor, timestamp, correlation_id, resource, result) is explicitly deferred to T02
and is called out in the `pipeline_topology.schema_contract_reference` placeholder field.

---

## Done Criteria

The task is done when:

- `services/internal-contracts/src/observability-audit-pipeline.json` exists, is valid JSON,
  has `version: "2026-03-28"`, enumerates all eight required subsystems each with at least one
  required event category, declares the Kafka topology, at-least-once delivery, tenant isolation
  rules, health signals, resilience rules, and self-audit requirement.
- `scripts/lib/observability-audit-pipeline.mjs` exists, exports `collectAuditPipelineViolations`,
  and returns `[]` when run against the checked-in contract.
- `services/internal-contracts/src/index.mjs` exports `readObservabilityAuditPipeline`,
  `OBSERVABILITY_AUDIT_PIPELINE_VERSION`, and the four accessor helpers.
- `docs/reference/architecture/observability-audit-pipeline.md` exists, passes markdown lint,
  and narrates the pipeline topology, subsystem roster, health signals, and T01 scope boundary.
- Removing any required subsystem from the contract causes `collectAuditPipelineViolations` to
  return a non-empty array identifying the missing subsystem.
- The plan, spec, and contract are internally consistent (scope_metrics_contract and
  source_health_contract version fields align with the checked-in contract versions).
- T02–T06 can reference this contract as their foundational input without inspecting subsystem
  internals.

---

## Backlog Traceability

| Field | Value |
|---|---|
| **Task ID** | US-OBS-02-T01 |
| **Epic** | EP-13 — Cuotas, metering, auditoría y observabilidad |
| **Story** | US-OBS-02 — Auditoría transversal, consulta, exportación, enmascarado y correlación |
| **Story priority** | P0 |
| **Covered RFs** | RF-OBS-004, RF-OBS-005, RF-OBS-006, RF-OBS-007, RF-OBS-008, RF-OBS-018, RF-OBS-020 |
| **Story dependencies** | US-ARC-03, US-PRG-03 |
| **Intra-story dependencies** | None — foundational task |
| **Downstream dependents** | US-OBS-02-T02 through US-OBS-02-T06 |
| **Observability baseline consumed** | US-OBS-01-T01 (metrics-stack), US-OBS-01-T03 (health-checks) |
