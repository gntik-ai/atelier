# Feature Specification: PostgreSQL Change Data Capture toward Kafka Realtime Channels

**Feature Branch**: `080-pg-change-to-kafka`
**Created**: 2026-03-30
**Status**: Draft
**Input**: User description: "Conectar cambios de PostgreSQL hacia Kafka y/o canales realtime cuando la arquitectura elegida lo habilite"
**Traceability**: EP-17 / US-DX-01 / US-DX-01-T02

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Workspace admin enables PostgreSQL change capture for a table (Priority: P1)

A workspace administrator wants data changes happening in a specific PostgreSQL table (inserts, updates, deletes) to be automatically captured and published to the event backbone so that downstream subscribers can receive them in near-real-time. The admin selects which tables within their workspace's provisioned PostgreSQL database should emit change events, and the platform begins capturing and publishing those changes to the corresponding Kafka topic.

**Why this priority**: Without the ability to enable capture on specific tables, no PostgreSQL change data can flow into the realtime pipeline. This is the foundational capability.

**Independent Test**: Can be tested by provisioning a workspace with a PostgreSQL data source, enabling change capture on one table, performing an INSERT, and verifying a corresponding change event appears on the expected Kafka topic.

**Acceptance Scenarios**:

1. **Given** a workspace with a provisioned PostgreSQL data source containing table "orders", **When** the workspace admin enables change capture for "orders", **Then** the platform confirms activation and begins capturing changes for that table.
2. **Given** change capture is enabled for table "orders", **When** a row is inserted into "orders", **Then** a change event representing the insert is published to the workspace's designated Kafka topic within the configured latency threshold.
3. **Given** change capture is enabled for table "orders", **When** the workspace admin disables change capture for "orders", **Then** the platform stops capturing changes for that table and confirms deactivation; no further events are published for that table.

---

### User Story 2 — Developer receives PostgreSQL change events through a workspace channel (Priority: P1)

A developer who has already created a subscription to a PostgreSQL-changes channel (as defined by US-DX-01-T01) expects that actual data mutations hitting the captured tables result in structured events arriving on the Kafka topic associated with that channel. The developer does not need to know about the internal CDC mechanism; they only see events flowing into the channel they subscribed to.

**Why this priority**: This is the end-to-end value delivery — connecting the capture mechanism to the channel/subscription model so that subscriptions produce actual events.

**Independent Test**: Can be tested by enabling capture on a table, creating a subscription to the corresponding channel type, performing data mutations, and consuming events from the Kafka topic to verify they match the expected event contract.

**Acceptance Scenarios**:

1. **Given** change capture is active for table "orders" and a subscription exists on the `postgresql-changes` channel for that workspace, **When** a row is updated in "orders", **Then** a change event containing the operation type (`UPDATE`), table name, workspace identifier, tenant identifier, and the changed payload is published to the channel's Kafka topic.
2. **Given** change capture is active for table "orders", **When** a row is deleted from "orders", **Then** a change event containing the operation type (`DELETE`), primary key reference, table name, workspace identifier, and tenant identifier is published.
3. **Given** a workspace with change capture active on two tables ("orders" and "products"), **When** mutations occur on both tables concurrently, **Then** change events for each table are published independently and each event clearly identifies its source table.

---

### User Story 3 — Tenant owner governs which tables can emit change events (Priority: P2)

A tenant owner needs to control which PostgreSQL tables across their workspaces are eligible for change capture, to manage resource consumption, prevent excessive event volumes, and comply with data governance policies. The tenant owner can set limits on the number of captured tables per workspace and review the current capture status across all workspaces.

**Why this priority**: Governance and resource control are critical for multi-tenant safety but are not blocking the basic capture pipeline.

**Independent Test**: Can be tested by configuring a per-workspace captured-table quota at the tenant level, then attempting to enable capture beyond that quota and verifying rejection. Also tested by querying capture status across workspaces.

**Acceptance Scenarios**:

1. **Given** a tenant-level quota of 5 captured tables per workspace, **When** a workspace admin tries to enable capture on a 6th table, **Then** the system rejects the request with a clear quota-exceeded error.
2. **Given** multiple workspaces under one tenant with active captures, **When** the tenant owner queries capture status across workspaces, **Then** the system returns a per-workspace summary showing captured table count, table names, and activation timestamps.
3. **Given** a captured table produces a volume of events exceeding a configurable rate threshold, **When** the system detects the excess, **Then** it records a quota-warning audit event and optionally pauses capture for that table (based on tenant policy).

---

### User Story 4 — Platform observes and audits all capture lifecycle operations (Priority: P2)

The platform must record every activation, deactivation, and configuration change of change capture for audit and troubleshooting purposes. Operations teams and tenant owners must be able to trace who enabled capture on which table, when, and the current state of capture across the system.

**Why this priority**: Auditability is a non-negotiable cross-cutting requirement in the BaaS product but does not block the primary data flow.

**Independent Test**: Can be tested by enabling and disabling capture on a table, then querying the audit log to verify all lifecycle events are recorded with correct actor, timestamp, and before/after state.

**Acceptance Scenarios**:

1. **Given** a workspace admin enables change capture for table "orders", **When** the audit log is queried, **Then** it contains an entry with action "capture-enabled", actor identity, workspace ID, tenant ID, table name, and timestamp.
2. **Given** the system encounters a failure in the capture pipeline for a table (e.g., replication slot becomes invalid), **When** the failure is detected, **Then** an audit event of type "capture-error" is recorded including the table, workspace, error classification, and timestamp.

---

### Edge Cases

- What happens when a workspace admin enables capture on a table that does not exist in the provisioned PostgreSQL database? → The system rejects activation with a descriptive error indicating the table is not found or not accessible.
- What happens when a captured table is dropped (DDL change) while capture is active? → The system detects the loss of the table, marks the capture as `errored`, records an audit event, and stops publishing events for that table. No cascading failure to other captured tables.
- What happens when PostgreSQL logical replication slots reach the server's configured maximum? → The system rejects new capture activations with a resource-limit error and records a platform-level alert. Existing captures are unaffected.
- What happens when the Kafka broker is temporarily unavailable? → The capture mechanism buffers or retries publication according to the platform's delivery guarantees (at-least-once). Events are not silently dropped. If the outage exceeds a configurable threshold, capture is paused and an audit event is recorded.
- What happens when a single transaction modifies thousands of rows in a captured table? → The system publishes individual change events per row (not one bulk event), maintaining ordering within the transaction where feasible. Rate-limiting or batching at the Kafka publication layer is applied to prevent topic saturation.
- What happens when the same table is captured, deactivated, and recaptured? → Each activation cycle creates an independent capture context. Events from a previous cycle are not replayed; the new cycle starts from the current WAL position.
- What happens when multiple workspaces in the same tenant share the same underlying PostgreSQL instance? → Each workspace's capture is logically independent. Events from workspace A's tables never appear on workspace B's Kafka topic, even if they share a physical database instance.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST allow workspace administrators to enable change data capture on individual PostgreSQL tables within their workspace's provisioned database.
- **FR-002**: The system MUST allow workspace administrators to disable change data capture on previously captured tables.
- **FR-003**: The system MUST capture INSERT, UPDATE, and DELETE operations on enabled tables and publish a structured change event to the corresponding workspace-scoped Kafka topic.
- **FR-004**: Each change event MUST include at minimum: event type (insert/update/delete), source table name, workspace identifier, tenant identifier, a monotonically increasing sequence or LSN for ordering, timestamp of the change, and the changed row payload (new values for insert/update; primary key for delete).
- **FR-005**: The system MUST publish change events to a Kafka topic that follows the platform's topic naming convention, scoped to workspace and channel type (as defined in US-DX-01-T01's channel model).
- **FR-006**: The system MUST ensure workspace isolation: change events from one workspace's tables MUST NEVER be published to another workspace's Kafka topic, regardless of the underlying physical database topology.
- **FR-007**: The system MUST ensure tenant isolation: change capture metadata, configuration, and events from one tenant MUST NOT be visible or accessible to another tenant.
- **FR-008**: The system MUST enforce configurable quotas on the number of tables with active change capture per workspace and per tenant. Quota violations MUST be rejected at activation time.
- **FR-009**: The system MUST guarantee at-least-once delivery of change events to Kafka. Duplicate events under failure/recovery scenarios are acceptable; silent event loss is not.
- **FR-010**: The system MUST record an auditable event for every capture lifecycle change (enable, disable, error, pause, resume) including actor identity, timestamp, workspace, tenant, table name, and before/after state.
- **FR-011**: The system MUST expose a query interface for workspace administrators to list all currently captured tables within their workspace, including status (active, paused, errored) and activation metadata.
- **FR-012**: The system MUST expose a tenant-level summary interface for tenant owners to view captured-table counts and statuses across all workspaces.
- **FR-013**: The system MUST handle DDL changes (table drop, column alteration) on captured tables gracefully — marking the capture as errored, logging an audit event, and not causing cascading failures.
- **FR-014**: The system MUST maintain event ordering per table within a single workspace (events for the same table arrive in Kafka in the order they were committed in PostgreSQL).

### Key Entities

- **Capture Configuration**: Represents the activation of change data capture on a specific PostgreSQL table within a workspace. Attributes: unique identifier, workspace ID, tenant ID, table name (schema-qualified), status (active | paused | errored | disabled), activation timestamp, deactivation timestamp, activating actor identity, last error description.
- **Change Event**: A structured message representing a single row-level mutation captured from PostgreSQL. Attributes: event ID, event type (insert/update/delete), source table, workspace ID, tenant ID, sequence/LSN, committed timestamp, row payload (new values or primary key reference), capture configuration reference.
- **Capture Quota**: A configurable limit on the number of tables with active capture, enforceable at workspace and tenant level. Attributes: scope (workspace/tenant), limit value, current usage count.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A workspace admin can enable change capture on a PostgreSQL table and see the first change event published to Kafka within 30 seconds of performing a data mutation.
- **SC-002**: Change events maintain correct ordering per table — 100% of events for a single table arrive in Kafka in commit order under normal operating conditions.
- **SC-003**: Zero cross-workspace event leakage: under concurrent multi-tenant load, no change event is ever published to a Kafka topic belonging to a different workspace.
- **SC-004**: The system achieves at-least-once delivery: zero silent event loss across capture pipeline restarts, Kafka broker failovers, and PostgreSQL connection interruptions (verified by comparing WAL LSN ranges to published events).
- **SC-005**: Every capture lifecycle operation (enable, disable, error, pause) produces an auditable record queryable within 30 seconds of the operation.
- **SC-006**: Quota enforcement rejects capture activation beyond configured limits 100% of the time with no race-condition-induced over-allocation.
- **SC-007**: A DDL change (table drop) on a captured table does not cause any other active capture in the same workspace to fail or lose events.

## Scope Boundaries

### In Scope

- Activation and deactivation of change data capture on individual PostgreSQL tables within a workspace.
- Structured change event publication to workspace-scoped Kafka topics.
- Change event contract (schema/structure) for PostgreSQL row-level mutations.
- Workspace and tenant isolation of capture configuration and events.
- Quota model for captured tables per workspace and per tenant.
- Audit trail for all capture lifecycle operations.
- Graceful handling of DDL changes and infrastructure failures.
- Ordering guarantees within a single table's event stream.

### Out of Scope

- Channel and subscription model (already defined in US-DX-01-T01).
- MongoDB change stream capture (US-DX-01-T03).
- Authentication, authorization scopes, and per-field filtering on delivered events (US-DX-01-T04).
- SDK examples or client-side consumption code (US-DX-01-T05).
- End-to-end integration and reconnection tests (US-DX-01-T06).
- Actual delivery transport to end clients (WebSocket, SSE, webhook) — a downstream concern.
- Schema evolution strategy for change event payloads beyond basic DDL error handling.

## Assumptions

- The workspace's PostgreSQL data source supports logical replication (PostgreSQL 10+ with `wal_level = logical` or equivalent), which is a platform provisioning prerequisite.
- The channel/subscription model from US-DX-01-T01 is available and defines the Kafka topic naming convention and channel type taxonomy that this task's events map onto.
- The Kafka event backbone (US-EVT-03) is operational and provides the target topics with appropriate retention and partitioning.
- The platform's existing identity context (Keycloak) supplies authenticated workspace admin and tenant owner identities for authorization and audit attribution.
- The change event payload publishes the full new row state for inserts and updates; partial/column-level payloads are a future enhancement.
- At-least-once delivery is the initial guarantee; exactly-once semantics may be added in a future iteration if required.

## Dependencies

- **US-DX-01-T01**: Channel and subscription model — defines channel types, Kafka topic naming, and the subscription resolution that consumes this task's events.
- **US-EVT-03**: Event backbone and topic conventions — provides the Kafka infrastructure and topic lifecycle management.
- **US-GW-04**: API Gateway routing — exposes the capture management API surface.
- **US-PGDATA-01**: PostgreSQL data provisioning — determines which PostgreSQL databases and tables are available per workspace and ensures logical replication is enabled.

## Risks

- **Replication slot proliferation**: Each captured table or workspace may require a PostgreSQL replication slot; exceeding `max_replication_slots` on the PostgreSQL server could block new activations. Mitigation: share replication slots across tables within the same database where possible and enforce quotas.
- **WAL retention growth**: Active replication slots prevent WAL segments from being recycled, potentially consuming significant disk space during Kafka outages. Mitigation: configure `max_slot_wal_keep_size` and implement capture-pausing when WAL retention exceeds a threshold.
- **High-throughput tables**: Tables with very high write rates may produce event volumes that strain Kafka topic throughput or downstream consumers. Mitigation: enforce per-table event rate limits and provide rate-warning audit events.
- **Schema changes on captured tables**: ALTER TABLE operations (add/drop/rename columns) may alter the change event payload structure unexpectedly. Mitigation: detect DDL changes, record audit events, and continue publishing with the new schema; do not silently break consumers.
