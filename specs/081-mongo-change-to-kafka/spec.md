# Feature Specification: MongoDB Change Stream Capture toward Kafka Realtime Channels

**Feature Branch**: `081-mongo-change-to-kafka`
**Created**: 2026-03-30
**Status**: Draft
**Input**: User description: "Conectar change streams de MongoDB hacia Kafka y/o canales realtime cuando la topología lo permita"
**Traceability**: EP-17 / US-DX-01 / US-DX-01-T03

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Workspace admin enables MongoDB change capture for a collection (Priority: P1)

A workspace administrator wants document mutations (inserts, updates, replacements, deletes) occurring in a specific MongoDB collection within the workspace's provisioned document database to be automatically captured and published to the event backbone. The admin selects which collections should emit change events, and the platform begins streaming those changes to the corresponding Kafka topic.

**Why this priority**: Without the ability to activate capture on individual collections, no MongoDB change data can enter the realtime pipeline. This is the foundational capability for the MongoDB side of the realtime story.

**Independent Test**: Can be tested by provisioning a workspace with a MongoDB data source, enabling change capture on one collection, inserting a document, and verifying a corresponding change event appears on the expected Kafka topic.

**Acceptance Scenarios**:

1. **Given** a workspace with a provisioned MongoDB data source containing collection "products", **When** the workspace admin enables change capture for "products", **Then** the platform confirms activation and begins streaming changes for that collection.
2. **Given** change capture is enabled for collection "products", **When** a document is inserted into "products", **Then** a change event representing the insert is published to the workspace's designated Kafka topic within the configured latency threshold.
3. **Given** change capture is enabled for collection "products", **When** the workspace admin disables change capture for "products", **Then** the platform stops streaming changes for that collection and confirms deactivation; no further events are published for that collection.

---

### User Story 2 — Developer receives MongoDB change events through a workspace channel (Priority: P1)

A developer who has already created a subscription to a MongoDB-changes channel (as defined by US-DX-01-T01) expects that actual document mutations hitting captured collections produce structured events arriving on the Kafka topic associated with that channel. The developer does not need to understand the internal change-stream mechanism; they see events flowing into the channel they subscribed to.

**Why this priority**: This is the end-to-end value delivery — connecting the MongoDB capture mechanism to the channel/subscription model so that subscriptions produce actual events.

**Independent Test**: Can be tested by enabling capture on a collection, creating a subscription to the corresponding channel type, performing document mutations, and consuming events from the Kafka topic to verify they match the expected event contract.

**Acceptance Scenarios**:

1. **Given** change capture is active for collection "products" and a subscription exists on the `mongodb-changes` channel for that workspace, **When** a document is updated in "products", **Then** a change event containing the operation type (`update`), collection name, workspace identifier, tenant identifier, and the changed payload is published to the channel's Kafka topic.
2. **Given** change capture is active for collection "products", **When** a document is deleted from "products", **Then** a change event containing the operation type (`delete`), document key reference, collection name, workspace identifier, and tenant identifier is published.
3. **Given** a workspace with change capture active on two collections ("products" and "orders"), **When** mutations occur on both collections concurrently, **Then** change events for each collection are published independently and each event clearly identifies its source collection.

---

### User Story 3 — Tenant owner governs which collections can emit change events (Priority: P2)

A tenant owner needs to control which MongoDB collections across their workspaces are eligible for change capture, to manage resource consumption, prevent excessive event volumes, and comply with data governance policies. The tenant owner can set limits on the number of captured collections per workspace and review the current capture status across all workspaces.

**Why this priority**: Governance and resource control are critical for multi-tenant safety but do not block the basic capture pipeline.

**Independent Test**: Can be tested by configuring a per-workspace captured-collection quota at the tenant level, then attempting to enable capture beyond that quota and verifying rejection. Also tested by querying capture status across workspaces.

**Acceptance Scenarios**:

1. **Given** a tenant-level quota of 5 captured collections per workspace, **When** a workspace admin tries to enable capture on a 6th collection, **Then** the system rejects the request with a clear quota-exceeded error.
2. **Given** multiple workspaces under one tenant with active captures, **When** the tenant owner queries capture status across workspaces, **Then** the system returns a per-workspace summary showing captured collection count, collection names, and activation timestamps.
3. **Given** a captured collection produces a volume of events exceeding a configurable rate threshold, **When** the system detects the excess, **Then** it records a quota-warning audit event and optionally pauses capture for that collection (based on tenant policy).

---

### User Story 4 — Platform observes and audits all MongoDB capture lifecycle operations (Priority: P2)

The platform must record every activation, deactivation, configuration change, and runtime anomaly of MongoDB change capture for audit and troubleshooting purposes. Operations teams and tenant owners must be able to trace who enabled capture on which collection, when, and the current state of capture across the system.

**Why this priority**: Auditability is a non-negotiable cross-cutting requirement in the BaaS product but does not block the primary data flow.

**Independent Test**: Can be tested by enabling and disabling capture on a collection, then querying the audit log to verify all lifecycle events are recorded with correct actor, timestamp, and before/after state.

**Acceptance Scenarios**:

1. **Given** a workspace admin enables change capture for collection "products", **When** the audit log is queried, **Then** it contains an entry with action "capture-enabled", actor identity, workspace ID, tenant ID, collection name, data source type "mongodb", and timestamp.
2. **Given** the system encounters a failure in the MongoDB change stream for a collection (e.g., the change stream is invalidated), **When** the failure is detected, **Then** an audit event of type "capture-error" is recorded including the collection, workspace, error classification, and timestamp.

---

### Edge Cases

- What happens when a workspace admin enables capture on a collection that does not exist in the provisioned MongoDB database? → The system rejects activation with a descriptive error indicating the collection is not found or not accessible within the workspace's data source.
- What happens when a captured collection is dropped while capture is active? → The system detects the invalidation of the change stream, marks the capture as `errored`, records an audit event, and stops publishing events for that collection. No cascading failure to other captured collections.
- What happens when a MongoDB replica set undergoes a primary election while change streams are active? → The system automatically resumes the change stream from its last-known resume token after the election completes. If resumption fails after a configurable number of retries, the capture is marked as `errored` and an audit event is recorded.
- What happens when the Kafka broker is temporarily unavailable? → The capture mechanism buffers or retries publication according to the platform's delivery guarantees (at-least-once). Events are not silently dropped. If the outage exceeds a configurable threshold, capture is paused and an audit event is recorded.
- What happens when a single operation modifies a very large document (e.g., > 16 MB BSON limit area)? → The system publishes the change event with the delta or full-document representation as configured. If the resulting event exceeds the Kafka message size limit, the system records a "capture-oversized-event" audit entry and publishes a truncated reference event indicating the original change could not be fully represented.
- What happens when the MongoDB topology changes (shard added/removed in a sharded cluster)? → Active change streams adapt to topology changes transparently. If a change stream becomes invalid due to topology mutation, the system re-establishes it with the last resume token and records an audit event for the disruption.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow a workspace admin to enable change capture on one or more MongoDB collections within the workspace's provisioned document database.
- **FR-002**: System MUST allow a workspace admin to disable change capture for a previously activated MongoDB collection.
- **FR-003**: When change capture is active for a collection, the system MUST publish a structured change event to the workspace's designated Kafka topic for every insert, update, replace, and delete operation on that collection.
- **FR-004**: Each change event MUST include at minimum: operation type, collection name, workspace identifier, tenant identifier, document key, and a timestamp.
- **FR-005**: Change events for updates MUST include the changed fields or the full document post-change, depending on a configurable capture mode (delta vs. full-document).
- **FR-006**: The system MUST resume MongoDB change streams from the last-known resume token after transient failures (replica set elections, temporary network interruptions) without data loss.
- **FR-007**: The system MUST enforce tenant-level quotas on the maximum number of simultaneously captured collections per workspace and reject activations that exceed the quota.
- **FR-008**: The system MUST record an audit event for every capture activation, deactivation, configuration change, resumption, and error.
- **FR-009**: The system MUST isolate change streams per tenant and workspace; events from one workspace's captured collections MUST NOT leak into another workspace's Kafka topics.
- **FR-010**: The system MUST detect when a captured collection is dropped or a change stream is invalidated, mark the capture as errored, and stop publishing events for that collection.
- **FR-011**: The system MUST provide a query interface for tenant owners to retrieve the current capture status (active, paused, errored) for all collections across their workspaces.
- **FR-012**: The system MUST apply at-least-once delivery semantics for change events published to Kafka, retrying on transient broker failures.
- **FR-013**: When a change event exceeds the configured maximum Kafka message size, the system MUST publish a reference event indicating the oversized change and record an audit entry.

### Key Entities

- **Capture Registration**: Represents the activation of change capture on a specific MongoDB collection within a workspace. Attributes include workspace identifier, tenant identifier, collection name, data source type (mongodb), capture mode (delta or full-document), status (active, paused, errored), resume token, activation timestamp, and activating actor.
- **Change Event**: A structured representation of a single document mutation published to Kafka. Includes operation type, collection name, document key, changed payload or delta, workspace identifier, tenant identifier, and event timestamp.
- **Capture Quota**: A tenant-level or workspace-level limit on the number of simultaneously active MongoDB change captures. Attributes include tenant identifier, workspace identifier (optional for workspace-level overrides), maximum captured collections count, and current usage count.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Document mutations in captured MongoDB collections are visible as change events to subscribers within 5 seconds of the mutation under normal operating conditions.
- **SC-002**: 100% of capture lifecycle operations (enable, disable, error, resume) are recorded in the audit log with correct actor and timestamp.
- **SC-003**: The system supports at least 50 simultaneously active MongoDB change captures across all tenants without degradation of event delivery latency.
- **SC-004**: After a transient failure (replica set election, temporary network disruption), the system resumes capturing events with zero event loss within 60 seconds.
- **SC-005**: Quota enforcement correctly rejects 100% of capture activation attempts that exceed the configured per-workspace limit.
- **SC-006**: No change event from one workspace's MongoDB collection is ever delivered to a different workspace's Kafka topic (strict tenant/workspace isolation).

## Assumptions

- MongoDB instances provisioned for workspaces run as replica sets (or sharded clusters with replica set shards), which is a prerequisite for change streams.
- The channel/subscription model defined in US-DX-01-T01 is available and defines a `mongodb-changes` channel type that this task's capture mechanism feeds into.
- The PostgreSQL change capture task (US-DX-01-T02) establishes event contract patterns and Kafka topic naming conventions that this task aligns with, adapting them for MongoDB-specific semantics (e.g., document keys instead of row primary keys, BSON-derived payloads).
- Kafka topics for workspace change events already exist or are auto-created by the platform's topic management infrastructure.
- Authorization and access control filtering on change events is handled by US-DX-01-T04 and is out of scope for this task.

## Dependencies

- **US-DX-01-T01** (Realtime channel/subscription model): Defines the `mongodb-changes` channel type and the subscription lifecycle that this task's capture feeds.
- **US-DX-01-T02** (PostgreSQL change capture): Establishes shared patterns for event contracts, Kafka topic naming, quota structures, and audit event types that this task mirrors for the MongoDB data source.
