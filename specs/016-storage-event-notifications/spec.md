# Feature Specification: US-STO-02-T04 — Storage Event Notifications

**Feature Branch**: `016-storage-event-notifications`  
**Task**: US-STO-02-T04  
**Epic**: EP-12 — Storage S3-compatible  
**Story**: US-STO-02 — Multipart, presigned URLs, políticas, cuotas, eventos y capabilities de provider  
**Created**: 2026-03-28  
**Status**: Draft

---

## 1. Objective and Problem Statement

The storage module already supports tenant storage contexts, bucket/object operations, multipart/presigned flows, bucket policies, and quota guardrails. What is still missing is a governed way to react to storage mutations without polling.

This task adds the bounded product capability to declare bucket-scoped storage event notification rules that publish matched storage events to Kafka and/or invoke OpenWhisk actions **only when the underlying provider support is declared as available**. The capability must remain tenant-safe, workspace-safe, auditable, quota-governed, and explicit rather than implicit.

Without this task, applications cannot reliably trigger asynchronous workflows such as ingestion pipelines, media post-processing, cache invalidation, indexing, or security scanning when objects are created or deleted.

---

## 2. Users, Consumers, and Value

### Direct consumers

- **Workspace admins** need to configure bucket-level notification rules without relying on provider-native consoles.
- **Developers** need a declarative contract for reacting to object mutations through Kafka consumers or OpenWhisk actions.
- **Tenant owners** need the number and destination type of notification rules to stay governed per tenant/workspace.
- **Service accounts** need to create and manage rules programmatically inside the workspace permission model.
- **Superadmins** need clear audit evidence and an emergency override path for disabling or reviewing notification configurations.

### Value delivered

- Enables event-driven application behavior on top of object storage.
- Keeps storage-triggered integrations inside the platform governance model.
- Avoids hidden provider coupling by making support and degradation explicit.
- Preserves auditability and traceability for both rule lifecycle and delivery attempts.

---

## 3. In-Scope Capability

This task covers a **repo-local, additive, declarative notification layer** for storage events.

### In scope

- Declare, validate, update, list, and remove bucket-scoped notification rules.
- Support rule destinations of:
  - Kafka topic
  - OpenWhisk action
- Support rule event families for the storage operations already modeled in the repo:
  - object created / object uploaded
  - object deleted
  - multipart completed
- Support optional key-based filtering by prefix and suffix.
- Require explicit capability support before a rule can be considered active.
- Make notification quotas governable at tenant/workspace level.
- Produce immutable delivery-preview records and immutable audit events.
- Degrade gracefully when event notifications are unsupported for the selected provider.

### Out of scope

- Provider-native bucket notification APIs or live provider mutation.
- Dead-letter queues, retry workers, replay infrastructure, or backoff schedulers.
- UI flows or dashboard screens.
- Broader provider-capability publication work from `US-STO-02-T05`.
- Capability degradation test matrix work from `US-STO-02-T06`.

---

## User Scenarios & Testing

### User Story 1 — Workspace admin routes object-created events to Kafka (Priority: P1)

A workspace admin can attach a notification rule to a bucket so that object-created events are published to a governed Kafka topic when the bucket event-notification capability is supported.

**Why this priority**: Kafka delivery is the main event-backbone path for downstream processing and is the primary storage-reactive use case.

**Independent Test**: Create a valid Kafka notification rule, evaluate a matching object-created event, and verify that a delivery preview is generated for the expected topic with tenant/workspace context and correlation metadata.

**Acceptance Scenarios**:

1. **Given** a workspace bucket and provider support for storage event notifications, **When** a workspace admin creates a Kafka notification rule for `object.created`, **Then** the platform stores the rule as active and associates it with that bucket.
2. **Given** an active Kafka rule with prefix `uploads/`, **When** an object with key `uploads/photo.jpg` is created, **Then** the platform generates a delivery preview for the configured Kafka topic.
3. **Given** the same rule, **When** an object with key `avatars/photo.jpg` is created, **Then** the rule does not match and no delivery preview is generated.
4. **Given** a tenant/workspace outside the rule scope, **When** a matching event occurs in a different tenant/workspace, **Then** the rule is never evaluated for that foreign scope.

---

### User Story 2 — Workspace admin routes delete or multipart-complete events to OpenWhisk (Priority: P1)

A workspace admin can attach a notification rule to a bucket so that delete or multipart-complete events trigger an OpenWhisk action when supported and permitted.

**Why this priority**: OpenWhisk is the platform-native automation target for storage-triggered workflows such as thumbnail generation, antivirus scans, or metadata extraction.

**Independent Test**: Create a valid OpenWhisk notification rule for `multipart.completed` or `object.deleted`, evaluate a matching event, and verify that a delivery preview is generated for the expected action reference.

**Acceptance Scenarios**:

1. **Given** a bucket with provider support and a valid OpenWhisk destination, **When** a workspace admin creates a rule for `multipart.completed`, **Then** the rule is stored as active.
2. **Given** an active OpenWhisk rule for `object.deleted`, **When** a matching delete event is evaluated, **Then** the platform generates a delivery preview that targets the configured action reference.
3. **Given** a rule that targets OpenWhisk, **When** the workspace entitlement does not allow OpenWhisk actions, **Then** the rule is rejected with a clear destination-governance error.

---

### User Story 3 — Tenant governance blocks unsupported or over-limit rules (Priority: P2)

Tenant-level governance prevents notification rules from being activated when the provider capability is unavailable, when the destination type is not allowed, or when the workspace/tenant already exceeded the allowed number of notification rules.

**Why this priority**: Event automation must not bypass quota or capability governance.

**Independent Test**: Attempt to create rules in three failure cases—unsupported provider capability, missing destination entitlement, and exceeded rule quota—and verify deterministic errors plus audit evidence.

**Acceptance Scenarios**:

1. **Given** a provider profile without storage event-notification support, **When** a caller creates a rule, **Then** the rule is rejected with a capability-not-available error and fallback guidance.
2. **Given** tenant/workspace rule-count limits are already exhausted, **When** a caller creates another rule, **Then** the rule is rejected with a quota/governance error.
3. **Given** a rule was rejected, **When** the audit event is emitted, **Then** it records the attempted destination type, bucket scope, actor, outcome, and blocking reason without leaking secrets or URLs.

---

### Edge Cases

- What happens when both prefix and suffix filters are provided and only one matches? The rule does not match; both must match when both are declared.
- What happens when the provider profile omits the event-notification capability entry entirely? The capability is treated as unavailable, not implicitly supported.
- What happens when a rule targets a Kafka topic or OpenWhisk action outside the current tenant/workspace governance context? The rule is rejected.
- What happens when multiple rules match the same event? Each active matching rule produces its own immutable delivery preview.
- What happens when a bucket is deleted or disabled? Notification rules bound to that bucket become non-evaluable and future preview attempts must fail clearly.
- What happens when event payload metadata includes URL-like or secret-like values? Audit serialization must redact them.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide an immutable bucket-scoped notification rule record that includes rule ID, bucket ID, tenant ID, workspace ID, destination type, destination reference, subscribed event types, optional prefix/suffix filters, enabled state, actor metadata, and timestamps.
- **FR-002**: The system MUST support notification destinations of `kafka_topic` and `openwhisk_action`.
- **FR-003**: The system MUST support at least these event types for matching: `object.created`, `object.deleted`, and `multipart.completed`.
- **FR-004**: The system MUST evaluate storage event notification support explicitly from provider capability input and MUST treat missing or unsatisfied capability state as unsupported.
- **FR-005**: The system MUST reject rule activation when the current tenant/workspace governance input does not permit the selected destination type.
- **FR-006**: The system MUST reject rule activation when the effective tenant/workspace notification-rule limit would be exceeded.
- **FR-007**: The system MUST support optional key filters by prefix and suffix, and both filters MUST be satisfied when both are present.
- **FR-008**: The system MUST evaluate a storage mutation event against all active rules for the same tenant/workspace/bucket scope and return deterministic delivery previews for the matching rules.
- **FR-009**: The system MUST generate delivery previews that include destination type/reference, event type, bucket ID, object key if present, tenant/workspace identifiers, correlation ID, occurred-at timestamp, and matched rule ID.
- **FR-010**: The system MUST generate immutable audit events for rule creation/update/deletion and for delivery-preview evaluation outcomes.
- **FR-011**: Audit events MUST redact or omit secret-like values, raw URLs, credentials, and presigned material.
- **FR-012**: The system MUST preserve graceful degradation by returning explicit unsupported-capability outcomes instead of silently accepting rules that cannot run.
- **FR-013**: The system MUST preserve additive compatibility with previous storage specs and MUST not require live Kafka, OpenWhisk, or provider connections for local evaluation.
- **FR-014**: The system MUST keep destination governance explicit and declarative rather than inferring support from unrelated capabilities.

### Key Entities *(include if feature involves data)*

- **Storage Event Notification Rule**: Immutable declaration that binds a bucket scope to one destination, one or more event types, optional key filters, governance metadata, and an enabled/disabled state.
- **Storage Event Notification Delivery Preview**: Deterministic record describing one matched event routed to one destination without performing live delivery.
- **Storage Event Notification Audit Event**: Immutable audit-safe summary of rule lifecycle or delivery evaluation outcome.
- **Storage Event Governance Profile**: Effective tenant/workspace limits and destination entitlements used to accept or reject rules.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A valid supported Kafka or OpenWhisk rule can be built and matched into a delivery preview with deterministic output in local tests.
- **SC-002**: Unsupported capability, invalid destination governance, and rule-quota exhaustion each produce distinct deterministic rejection outcomes in local tests.
- **SC-003**: Matching evaluation across multiple active rules returns all matching delivery previews in stable order.
- **SC-004**: Audit event serialization contains no `http://`, `https://`, or `secret://` substrings in local tests.
- **SC-005**: The feature remains additive to the provider catalog and does not break existing storage adapter tests.

## Assumptions

- Provider capability publication for event notifications will be broadened in `US-STO-02-T05`; this task only consumes capability input if supplied.
- Delivery semantics in this task are preview-oriented and contract-oriented, not live broker/function invocation.
- Governance inputs for Kafka/OpenWhisk entitlements and rule limits are supplied by callers as resolved policy/quota context.

## Risks and Open Questions

- Provider capability naming for storage event notifications must remain consistent with the later capability-exposure task; this spec assumes one explicit capability identifier rather than implicit inference.
- Exact downstream payload schemas for Kafka and OpenWhisk may evolve; this task only requires stable preview envelopes and audit-safe metadata.
