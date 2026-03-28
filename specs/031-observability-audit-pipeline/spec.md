# Feature Specification: US-OBS-02-T01 — Common Audit Pipeline for Platform Subsystems

**Feature Branch**: `031-observability-audit-pipeline`
**Task**: `US-OBS-02-T01`
**Epic**: EP-13 — Cuotas, metering, auditoría y observabilidad
**Story**: US-OBS-02 — Auditoría transversal, consulta, exportación, enmascarado y correlación
**Requirements traceability**: RF-OBS-004, RF-OBS-005, RF-OBS-006, RF-OBS-007, RF-OBS-008, RF-OBS-018, RF-OBS-020
**Dependencies**: US-ARC-03, US-PRG-03
**Created**: 2026-03-28
**Status**: Specified

---

## 1. Objective and Problem Statement

The platform operates eight administrative subsystems — IAM (Keycloak), PostgreSQL, MongoDB, Kafka, OpenWhisk, S3-compatible object storage, the quota/metering layer, and the tenant/workspace control plane — each capable of performing security-relevant and compliance-relevant operations.

Today there is no unified contract that defines:

- which administrative events each subsystem must emit,
- what shape those events must have,
- how events flow from their origin to a durable audit store,
- or how subsystem-specific differences are normalized into a single queryable surface.

Without this common audit pipeline contract:

- audit coverage is ad-hoc and subsystem-dependent, making compliance gaps invisible,
- downstream audit features (schema definition, querying, export, masking, correlation) cannot be built on a stable foundation,
- SREs and security reviewers must inspect each subsystem individually to understand what is and is not audited,
- and multi-tenant isolation of audit data cannot be enforced from a single, reviewable policy.

This task defines the **common audit pipeline**: the contract, topology, and behavioral rules that every subsystem must follow to emit, transport, and durably store administrative audit events. It is the foundational enabler for all downstream audit capabilities in US-OBS-02.

This task does **not** define the detailed audit event schema (T02), the query/filter API (T03), export or masking behavior (T04), cross-system correlation (T05), or end-to-end traceability tests (T06). It provides the pipeline foundation that those tasks will consume.

---

## 2. Users, Consumers, and Value

### Direct consumers

- **Superadmins** need confidence that every administrative action across every subsystem is captured in a single auditable surface, rather than scattered across subsystem-specific logs with no common guarantees.
- **Security and compliance reviewers** need a reviewable contract that enumerates exactly which subsystems participate in the audit pipeline, what event categories each must emit, and what delivery and durability guarantees the pipeline provides — so they can assess compliance gaps without inspecting each subsystem separately.
- **SRE / platform operators** need to know the audit pipeline's operational posture: whether all subsystems are emitting, whether transport is healthy, and whether any events are being lost or delayed — without building ad-hoc monitoring for each subsystem.
- **Downstream audit feature developers** (T02–T06 implementors) need a stable, documented pipeline contract to build against — for schema normalization, querying, export, masking, and correlation — instead of reverse-engineering each subsystem's emission behavior.

### Indirect consumers

- **Tenant owners** benefit because the common pipeline enforces tenant-scoped isolation at the transport and storage layer, ensuring that one tenant's audit events are never visible to another tenant.

### Value delivered

- Establishes a single source of truth for which subsystems participate in audit and what event categories each must emit.
- Defines the transport topology (emission → transport → durable store) so downstream tasks can assume a known path.
- Makes pipeline health observable so missing or delayed audit events surface as operational conditions, not silent gaps.
- Provides the stable foundation that T02–T06 require before they can define schema, queries, export, masking, or correlation.

---

## 3. In-Scope Capability

### In scope

- Define the **subsystem roster** for audit: IAM (Keycloak), PostgreSQL, MongoDB, Kafka, OpenWhisk, S3-compatible storage, the quota/metering layer, and the tenant/workspace control plane.
- Define the **administrative event categories** each subsystem must emit (e.g., resource creation, deletion, configuration change, access-control modification, privilege escalation, quota adjustment).
- Define the **pipeline topology**: the path from subsystem emission through transport (Kafka as the event backbone) to a durable audit store.
- Define **delivery guarantees**: at-least-once delivery semantics, ordering expectations within a tenant partition, and durability commitments.
- Define **pipeline health observability**: how missing, delayed, or failed audit emission is detected and surfaced as a first-class operational signal reusing the observability plane from US-OBS-01.
- Define **multi-tenant isolation rules** for audit transport and storage: tenant-scoped partitioning, prohibition on cross-tenant event leakage, and platform-level vs. tenant-level event separation.
- Define **pipeline-level security constraints**: which actors can configure the pipeline, how pipeline configuration changes are themselves audited, and what happens when a subsystem fails to emit.
- Define the **contract artifact** as a machine-readable, validatable source of truth (consistent with the contract pattern established in US-OBS-01).

### Out of scope

- Detailed audit event schema with field-level definitions (US-OBS-02-T02).
- Query and filter API for audit events (US-OBS-02-T03).
- Export, sensitive-event marking, and data masking (US-OBS-02-T04).
- Cross-system correlation and console-to-backend traceability (US-OBS-02-T05).
- End-to-end traceability and data-protection tests (US-OBS-02-T06).
- Runtime implementation of emitters, consumers, or storage adapters.
- Console UI for audit views.
- Retention policy management or archival workflows.
- Changes to the existing observability contracts from US-OBS-01 (this task only references and reuses them).

---

## 4. User Scenarios & Testing

### User Story 1 — Subsystem coverage confirmation (Priority: P1)

As a security reviewer, I need to verify that every platform subsystem capable of administrative mutations is enrolled in the audit pipeline so that I can confirm there are no coverage gaps before a compliance review.

**Why this priority**: Without complete subsystem enrollment, the entire audit surface has blind spots. This is the earliest prerequisite for any downstream audit feature.

**Independent Test**: A reviewer can inspect the pipeline contract and confirm that each of the eight required subsystems is listed with its expected event categories. Removing one subsystem from the contract must produce a validation failure.

**Acceptance Scenarios**:

1. **Given** the audit pipeline contract is defined, **when** a reviewer inspects it, **then** all eight subsystems (IAM, PostgreSQL, MongoDB, Kafka, OpenWhisk, storage, quota/metering, tenant/workspace control plane) are listed with at least one event category each.
2. **Given** a subsystem is removed from the pipeline contract, **when** validation runs, **then** it fails and identifies the missing subsystem.
3. **Given** a new administrative event category is added to a subsystem, **when** the contract is updated, **then** the category appears in the subsystem's entry and validation passes.

---

### User Story 2 — Pipeline topology and delivery assurance (Priority: P1)

As an SRE, I need the audit pipeline's transport topology and delivery guarantees documented in a reviewable contract so that I can reason about event ordering, durability, and failure modes without inspecting subsystem internals.

**Why this priority**: Downstream audit features (query, export, correlation) depend on known delivery semantics. If delivery guarantees are ambiguous, every consumer must make ad-hoc assumptions.

**Independent Test**: A reviewer can inspect the pipeline contract and confirm that the transport topology names Kafka as the backbone, specifies at-least-once delivery, documents tenant-partitioned ordering, and defines what happens when a subsystem or the transport itself is unavailable.

**Acceptance Scenarios**:

1. **Given** the pipeline contract is defined, **when** a reviewer inspects the topology section, **then** the path from subsystem emission through Kafka transport to the durable audit store is explicit.
2. **Given** the transport backbone (Kafka) becomes temporarily unavailable, **when** the contract is consulted, **then** the expected subsystem behavior (buffering, retry, failure signaling) is documented.
3. **Given** a subsystem emits events for multiple tenants, **when** the contract is consulted, **then** the tenant partitioning strategy ensures events are ordered within a single tenant's partition.

---

### User Story 3 — Audit pipeline health as an observable signal (Priority: P1)

As a platform operator, I need audit pipeline health to be visible in the existing observability plane so that missing or delayed audit emission surfaces as an operational condition rather than a silent compliance gap.

**Why this priority**: A pipeline that is nominally defined but silently failing is worse than no pipeline. Operators need audit-specific health signals integrated into the observability model established by US-OBS-01.

**Independent Test**: A reviewer can confirm that the contract defines audit-specific health metrics or probe points that integrate with the existing observability contracts, and that missing emission from a required subsystem is detectable as a degraded condition.

**Acceptance Scenarios**:

1. **Given** all subsystems are emitting normally, **when** the pipeline health signal is inspected, **then** it reports healthy for the audit surface.
2. **Given** one subsystem has stopped emitting audit events beyond the expected freshness threshold, **when** the pipeline health signal is inspected, **then** it reports the specific subsystem as degraded or stale.
3. **Given** the transport backbone is unavailable, **when** the pipeline health signal is inspected, **then** the audit pipeline overall reports degraded and identifies transport as the affected component.

---

### User Story 4 — Multi-tenant isolation at the pipeline level (Priority: P1)

As a superadmin responsible for tenant data segregation, I need the audit pipeline to enforce tenant-scoped isolation at the transport and storage layer so that one tenant's audit events are never accessible to another tenant.

**Why this priority**: Multi-tenancy is a platform invariant. If the audit pipeline leaks events across tenant boundaries, it creates a compliance and security incident regardless of how well the downstream query layer filters results.

**Independent Test**: A reviewer can confirm that the contract specifies tenant-scoped partitioning for audit transport, prohibits cross-tenant event co-mingling in storage, and distinguishes platform-level events from tenant-level events.

**Acceptance Scenarios**:

1. **Given** audit events from two different tenants enter the pipeline, **when** the transport layer processes them, **then** each tenant's events are routed to tenant-scoped partitions.
2. **Given** a platform-level administrative event occurs (e.g., global configuration change), **when** the pipeline processes it, **then** it is stored in a platform-scoped partition and is not visible in any tenant-scoped audit view.
3. **Given** a tenant-scoped query is issued against the durable audit store, **when** results are returned, **then** no events from other tenants are included.

---

### User Story 5 — Pipeline self-audit and configuration governance (Priority: P2)

As a security reviewer, I need changes to the audit pipeline's own configuration to be themselves auditable so that pipeline tampering or misconfiguration is traceable.

**Why this priority**: The audit pipeline is a security-critical component. If its configuration can be changed without an audit trail, the entire audit surface can be silently weakened.

**Independent Test**: A reviewer can confirm that the contract requires pipeline configuration changes (e.g., adding/removing a subsystem, changing delivery parameters) to produce audit events through the same pipeline.

**Acceptance Scenarios**:

1. **Given** an administrator modifies the pipeline configuration (e.g., disables emission from a subsystem), **when** the change is applied, **then** a pipeline-configuration-change audit event is emitted and durably stored.
2. **Given** the pipeline configuration is inspected after a series of changes, **when** the configuration audit trail is reviewed, **then** each change is attributable to a specific actor with a timestamp.

---

## 5. Edge Cases

- What happens when a subsystem emits an event that does not match any declared event category? The pipeline must accept it for durability but flag it as unclassified so it is visible in pipeline health and reviewable by operators.
- What happens when a subsystem emits an event without a valid `tenant_id`? The pipeline must route it to a platform-scoped dead-letter or unattributed partition rather than silently dropping it or attributing it to a default tenant.
- How does the pipeline behave during subsystem startup or restart when historical audit context may not yet be available? The pipeline must accept events with incomplete context and flag them rather than blocking emission.
- What happens when the durable audit store is temporarily unavailable while Kafka transport is healthy? Events must be retained in the transport layer up to a configurable retention window; pipeline health must report storage degradation.
- What happens when two subsystems emit audit events about the same underlying operation (e.g., IAM issues a token and the API gateway logs the token-based access)? This task does not resolve correlation (T05), but the pipeline must preserve both events independently so that downstream correlation can match them.
- What happens when audit event volume spikes (e.g., a bulk import or mass configuration change)? The pipeline must not silently drop events; back-pressure behavior must be documented as part of the delivery guarantees.
- How does the pipeline distinguish workspace-scoped events from tenant-scoped events for subsystems that may not be workspace-aware? The pipeline must support an optional `workspace_id` scope and must not fabricate workspace attribution when the subsystem does not provide it.

---

## 6. Requirements

### Functional Requirements

- **FR-001**: The pipeline contract MUST enumerate every required subsystem: IAM (Keycloak), PostgreSQL, MongoDB, Kafka, OpenWhisk, S3-compatible storage, quota/metering, and tenant/workspace control plane.
- **FR-002**: The pipeline contract MUST define, for each subsystem, the administrative event categories it is required to emit (at minimum: resource creation, resource deletion, configuration change, access-control modification).
- **FR-003**: The pipeline MUST use Kafka as the event transport backbone, consistent with the platform's architectural decisions.
- **FR-004**: The pipeline MUST provide at-least-once delivery semantics from subsystem emission to durable storage.
- **FR-005**: The pipeline MUST partition audit events by tenant so that tenant-scoped queries never return events from other tenants.
- **FR-006**: The pipeline MUST distinguish platform-scoped events from tenant-scoped events and MUST NOT inject platform events into tenant-scoped partitions.
- **FR-007**: The pipeline MUST support optional `workspace_id` attribution without fabricating workspace scope when the emitting subsystem does not provide it.
- **FR-008**: The pipeline MUST define health signals (emission freshness, transport health, storage health) that integrate with the observability plane established by US-OBS-01.
- **FR-009**: The pipeline MUST surface missing or stale emission from any required subsystem as a degraded health condition, not a silent gap.
- **FR-010**: The pipeline MUST accept events with unrecognized categories or incomplete context and flag them as unclassified or unattributed, rather than dropping them.
- **FR-011**: The pipeline MUST require that changes to the pipeline's own configuration produce audit events through the same pipeline.
- **FR-012**: The pipeline MUST document back-pressure behavior for high-volume emission scenarios and MUST NOT silently drop events.
- **FR-013**: The pipeline contract MUST be a machine-readable, validatable artifact consistent with the contract pattern used in US-OBS-01.
- **FR-014**: The pipeline contract MUST be accompanied by a validation script that fails deterministically when a required subsystem or event category is missing.

### Key Entities

- **Audit Pipeline**: The end-to-end path from administrative event emission through transport to durable storage, governed by a single contract.
- **Subsystem Emitter**: A platform subsystem enrolled in the pipeline, responsible for emitting audit events in the declared categories.
- **Event Category**: A normalized classification of administrative actions (e.g., resource creation, access-control modification) that a subsystem must emit.
- **Audit Transport**: The Kafka-based backbone that carries audit events from emitters to the durable store, partitioned by tenant.
- **Durable Audit Store**: The persistent storage layer where audit events are retained for querying, export, and compliance review.
- **Pipeline Health Signal**: An observable metric or probe that surfaces emission freshness, transport health, and storage health within the observability plane.
- **Unclassified Event**: An audit event whose category does not match any declared category for its subsystem, retained but flagged.
- **Unattributed Event**: An audit event missing a valid `tenant_id`, routed to a platform-scoped partition for operator review.

---

## 7. Isolation, Audit, and Security Constraints

- Audit events MUST be tenant-isolated at the transport and storage layer; cross-tenant leakage is a security incident.
- Platform-scoped events (e.g., global configuration changes, pipeline configuration changes) MUST be stored separately from tenant-scoped events and MUST only be visible to superadmin and platform operator roles.
- The audit pipeline itself is a security-critical component; its configuration MUST be restricted to superadmin-level actors.
- Pipeline configuration changes MUST be self-audited (FR-011).
- The pipeline MUST NOT require raw sensitive data (credentials, tokens, PII) in event payloads at the transport layer; field-level masking is defined by T04, but the pipeline MUST NOT depend on sensitive fields for routing or partitioning.
- The pipeline MUST align with the high-cardinality and forbidden-label policies established by US-OBS-01 for any metric families it introduces.

---

## 8. Success Criteria

### Measurable Outcomes

- **SC-001**: The pipeline contract enumerates all eight required subsystems, each with at least one declared event category, and the validation script confirms complete coverage.
- **SC-002**: The pipeline contract explicitly specifies the transport topology (Kafka backbone), at-least-once delivery, and tenant-partitioned ordering, and a reviewer can trace the full path from emission to durable storage.
- **SC-003**: Removing a required subsystem or event category from the contract causes the validation script to fail with a specific, actionable error message.
- **SC-004**: The pipeline health signals are defined and integrated with the US-OBS-01 observability plane, and a reviewer can confirm that missing emission surfaces as a degraded condition.
- **SC-005**: The contract explicitly forbids cross-tenant event leakage and documents the tenant isolation strategy at both transport and storage layers.
- **SC-006**: The contract is machine-readable, versionable, and consistent in structure with the observability contracts delivered in US-OBS-01.
- **SC-007**: Downstream tasks (T02–T06) can reference this contract as their foundational input without needing to inspect subsystem internals.

---

## 9. Backlog Traceability

| Field | Value |
|---|---|
| **Task ID** | US-OBS-02-T01 |
| **Epic** | EP-13 — Cuotas, metering, auditoría y observabilidad |
| **Story** | US-OBS-02 — Auditoría transversal, consulta, exportación, enmascarado y correlación |
| **Story type** | Feature |
| **Story priority** | P0 |
| **Story size** | L |
| **Covered RFs** | RF-OBS-004, RF-OBS-005, RF-OBS-006, RF-OBS-007, RF-OBS-008, RF-OBS-018, RF-OBS-020 |
| **Story dependencies** | US-ARC-03, US-PRG-03 |
| **Intra-story dependencies** | None — this is the first task in US-OBS-02 |
| **Downstream dependents** | US-OBS-02-T02, US-OBS-02-T03, US-OBS-02-T04, US-OBS-02-T05, US-OBS-02-T06 |
| **Observability baseline consumed** | US-OBS-01-T01 through US-OBS-01-T06 (metrics, dashboards, health, business metrics, console alerts, smoke verification) |
