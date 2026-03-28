# Feature Specification: US-OBS-03-T03 — Threshold Alerts When a Tenant Exceeds Defined Quota Limits

**Feature Branch**: `039-observability-threshold-alerts`
**Task**: `US-OBS-03-T03`
**Epic**: EP-13 — Cuotas, metering, auditoría y observabilidad
**Story**: US-OBS-03 — Metering, cuotas, alertas y estado de aprovisionamiento
**Requirements traceability**: RF-OBS-009, RF-OBS-010, RF-OBS-011, RF-OBS-012, RF-OBS-013, RF-OBS-014, RF-OBS-015, RF-OBS-019
**Dependencies**: US-PLAN-01, US-TEN-01
**Intra-story dependencies**: US-OBS-03-T01, US-OBS-03-T02
**Created**: 2026-03-28
**Status**: Specified

---

## Problem Statement

`US-OBS-03-T02` established the quota-policy evaluation baseline: the platform can now classify
every metered dimension for a tenant or workspace into a deterministic posture — within limits,
warning reached, soft limit exceeded, or hard limit reached. However, that evaluation is passive and
pull-based. No part of the platform currently **reacts** when a scope transitions into a concerning
posture.

Without an alerting layer:

- operators discover quota breaches only when they manually inspect posture snapshots,
- tenant owners have no proactive notification that they are approaching or exceeding limits,
- downstream blocking and console work cannot rely on a published event stream for threshold
  transitions,
- and there is no auditable record of *when* a threshold was first crossed.

This task introduces the **threshold alert emission layer**: a bounded capability that monitors
quota-posture transitions and emits structured alert events through the platform event backbone
whenever a tenant or workspace crosses a configured threshold boundary.

---

## Users and Value

| Actor | Value received |
| --- | --- |
| **Superadmin / SRE** | Receives proactive notification when any tenant or workspace crosses warning, soft-limit, or hard-limit thresholds; eliminates manual polling for quota pressure. |
| **Security / Governance** | Gains an auditable, timestamped event trail of every threshold transition for compliance and forensic review. |
| **Tenant owner** | Foundation for future tenant-facing notifications about approaching or exceeded limits (exposed later by T05 or a notification subsystem). |
| **Downstream platform tasks** | T04 (blocking) can subscribe to hard-limit events to trigger enforcement; T05 (console) can subscribe to render real-time quota status changes. |

---

## User Scenarios & Testing

### User Story 1 — Platform emits an alert when a tenant crosses the warning threshold (Priority: P1)

A superadmin or SRE needs the platform to automatically emit an alert event when a tenant's
measured consumption crosses the warning threshold for any metered dimension, so the operator can
investigate before harder limits are reached.

**Why this priority**: Warning alerts are the earliest signal that a tenant is approaching capacity
pressure; they enable proactive governance and are the minimum viable alerting capability.

**Independent Test**: Configure a tenant with a warning threshold for `api_requests`. Generate
traffic until usage crosses the threshold. Verify an alert event is emitted to the event backbone
with the correct posture transition, dimension, tenant identifier, and timestamp.

**Acceptance Scenarios**:

1. **Given** a tenant with a warning threshold of 8 000 API requests and current usage below that
   value,
   **When** the next usage snapshot shows 8 000 or more API requests,
   **Then** the system emits a `quota.threshold.warning_reached` alert event scoped to that tenant
   and the `api_requests` dimension.

2. **Given** that the warning alert has already been emitted for a tenant and dimension in the
   current evaluation cycle,
   **When** the next usage snapshot still shows usage above the warning threshold but below the
   soft limit,
   **Then** the system does NOT emit a duplicate warning alert for the same transition.

3. **Given** a tenant whose usage previously exceeded the warning threshold and later dropped back
   below it,
   **When** the usage rises above the warning threshold again,
   **Then** the system emits a new `quota.threshold.warning_reached` alert event because this is a
   fresh transition.

---

### User Story 2 — Platform emits an alert on soft-limit and hard-limit transitions (Priority: P1)

The alerting layer must detect and emit distinct events for soft-limit exceeded and hard-limit
reached transitions, so that operators and downstream consumers can differentiate severity levels.

**Why this priority**: Soft-limit and hard-limit alerts carry different operational urgency; the
platform must distinguish them to enable proportional response.

**Independent Test**: Configure a tenant with warning, soft-limit, and hard-limit thresholds for
`storage_volume_bytes`. Increase usage through each boundary in sequence. Verify three distinct
alert events are emitted with escalating severity.

**Acceptance Scenarios**:

1. **Given** a tenant whose usage crosses the soft limit for `storage_volume_bytes`,
   **When** the posture transitions from `warning_threshold_reached` to `soft_limit_exceeded`,
   **Then** the system emits a `quota.threshold.soft_limit_exceeded` alert event with the measured
   value, the soft-limit threshold, and remaining headroom to the hard limit.

2. **Given** a tenant whose usage reaches or exceeds the hard limit for `storage_volume_bytes`,
   **When** the posture transitions to `hard_limit_reached`,
   **Then** the system emits a `quota.threshold.hard_limit_reached` alert event with the measured
   value, the hard-limit threshold, and zero remaining headroom.

3. **Given** a dimension with no configured soft limit (only warning and hard),
   **When** usage crosses directly from warning to hard limit,
   **Then** the system emits only the `quota.threshold.hard_limit_reached` event — no synthetic
   soft-limit event is fabricated.

---

### User Story 3 — Workspace-scoped threshold alerts respect tenant isolation (Priority: P1)

The alerting layer must support workspace-scoped alerts and must not leak workspace quota events
across tenant boundaries or across workspaces within the same tenant.

**Why this priority**: Workspace-level alerting is required for workspace-scoped quota policies
introduced in T02; isolation is a platform invariant.

**Independent Test**: Configure two workspaces under the same tenant with different warning
thresholds for `function_invocations`. Push workspace A past its threshold while workspace B
remains within limits. Verify that only workspace A generates an alert and that workspace B's
posture is unaffected.

**Acceptance Scenarios**:

1. **Given** workspace A with a warning threshold of 500 function invocations and workspace B with
   a warning threshold of 2 000,
   **When** workspace A reaches 500 invocations while workspace B has 100,
   **Then** the system emits a warning alert scoped to workspace A only; no alert is emitted for
   workspace B.

2. **Given** a workspace-scoped alert event,
   **When** the event payload is inspected,
   **Then** it contains both `tenantId` and `workspaceId` identifiers without referencing any other
   workspace.

---

### User Story 4 — Recovery events are emitted when usage drops below a previously crossed threshold (Priority: P2)

Operators need to know when a quota pressure situation has resolved, not only when it was first
detected. The platform should emit a recovery event when a dimension's posture improves.

**Why this priority**: Recovery events close the alert lifecycle and prevent stale operational
context, but they are lower priority than the initial breach alerts.

**Independent Test**: Push a tenant past the soft-limit threshold, wait for the alert, then reduce
usage below the soft limit. Verify a recovery event is emitted.

**Acceptance Scenarios**:

1. **Given** a tenant whose `api_requests` dimension was in `soft_limit_exceeded` posture,
   **When** the next usage snapshot shows usage has dropped below the soft-limit threshold,
   **Then** the system emits a `quota.threshold.soft_limit_recovered` event indicating the posture
   has improved.

2. **Given** a tenant that recovers from `hard_limit_reached` to `warning_threshold_reached`,
   **When** the recovery is detected,
   **Then** the system emits a `quota.threshold.hard_limit_recovered` event. The tenant's posture
   may still show warning, but the hard-limit recovery is reported as a distinct transition.

---

### User Story 5 — Alerts are suppressed when evidence freshness is degraded (Priority: P2)

When the underlying usage snapshot has degraded or unavailable evidence for a dimension, the
alerting layer must not emit false threshold-crossing alerts based on untrustworthy data.

**Why this priority**: Emitting false alerts on stale data erodes operator trust; suppression with
explicit notice is safer than overconfident alerting.

**Independent Test**: Mark a dimension as `degraded` in the usage snapshot. Verify that no
threshold alert is emitted for that dimension and that a suppression notice is recorded instead.

**Acceptance Scenarios**:

1. **Given** a usage dimension marked `degraded` that would otherwise trigger a warning alert,
   **When** the alert evaluation runs,
   **Then** no threshold alert is emitted for that dimension and a
   `quota.threshold.alert_suppressed` event is emitted indicating the reason.

2. **Given** a usage dimension marked `unavailable`,
   **When** the alert evaluation runs,
   **Then** no threshold alert is emitted for that dimension; a suppression event is emitted with
   cause `evidence_unavailable`.

---

## Edge Cases

- **Multiple thresholds crossed in a single evaluation cycle**: If usage jumps from below warning
  directly past the hard limit in one snapshot interval, the system must emit all intermediate
  transition events (warning reached, soft limit exceeded if configured, hard limit reached) in
  correct ascending order within the same evaluation.

- **Threshold configuration changes between evaluations**: If an operator lowers a warning threshold
  while usage is already above the new value, the next evaluation must detect the transition and
  emit the appropriate alert against the updated policy.

- **Dimension added to policy after usage is already above threshold**: The first evaluation after
  the dimension is added must detect the current posture and emit any applicable alerts as initial
  transitions.

- **Workspace deleted while alert is active**: No further alerts are emitted for the deleted
  workspace. Active alert state for that workspace is cleaned up gracefully.

- **Unbounded dimension**: Dimensions explicitly configured as unbounded in the quota policy must
  never trigger threshold alerts regardless of usage volume.

- **Concurrent posture changes across many tenants**: The alert evaluation must remain performant
  under high tenant count and must not create a burst of events that overwhelms the event backbone
  or downstream consumers.

- **Usage exactly at threshold boundary**: Follows the inclusive comparison semantics (`>=`)
  established by T02 — usage exactly equal to a threshold constitutes a crossing.

- **Recovery oscillation**: If usage oscillates around a threshold boundary across consecutive
  evaluation cycles, the system must emit crossing and recovery events for each real transition.
  An optional dampening mechanism may be introduced to reduce noise, but it must be explicitly
  configured and documented rather than applied silently.

---

## Requirements

### Alert Event Contract

The threshold alert system must emit structured events through the platform event backbone (Kafka)
with the following conceptual payload:

| Field | Description |
| --- | --- |
| `event_type` | One of the documented alert event types (see event type catalog below) |
| `tenant_id` | Tenant scope identifier |
| `workspace_id` | Workspace scope identifier (null for tenant-scoped alerts) |
| `dimension` | Metered dimension key from the consumption catalog |
| `measured_value` | Current usage value at the time of the transition |
| `threshold_value` | The threshold that was crossed |
| `threshold_type` | `warning`, `soft_limit`, or `hard_limit` |
| `previous_posture` | The posture state before this transition |
| `new_posture` | The posture state after this transition |
| `headroom` | Remaining headroom to the next higher threshold (if applicable) |
| `evidence_freshness` | Freshness status of the underlying usage snapshot |
| `evaluation_timestamp` | When the alert evaluation was performed |
| `snapshot_timestamp` | Timestamp of the underlying usage snapshot |
| `correlation_id` | Stable identifier suitable for linking to audit, posture, and enforcement events |

### Alert Event Type Catalog

| Event type | Trigger condition |
| --- | --- |
| `quota.threshold.warning_reached` | Usage crosses warning threshold upward |
| `quota.threshold.soft_limit_exceeded` | Usage crosses soft limit upward |
| `quota.threshold.hard_limit_reached` | Usage crosses hard limit upward |
| `quota.threshold.warning_recovered` | Usage drops below warning threshold after a previous warning |
| `quota.threshold.soft_limit_recovered` | Usage drops below soft limit after a previous soft-limit breach |
| `quota.threshold.hard_limit_recovered` | Usage drops below hard limit after a previous hard-limit breach |
| `quota.threshold.alert_suppressed` | Alert was suppressed due to degraded or unavailable evidence |

### Functional Requirements

- **FR-001**: The system MUST evaluate quota posture transitions after each usage snapshot refresh
  and emit alert events when a metered dimension transitions to a higher-severity or
  lower-severity (recovery) posture.

- **FR-002**: The system MUST emit distinct event types for warning reached, soft-limit exceeded,
  and hard-limit reached transitions, as defined in the alert event type catalog.

- **FR-003**: The system MUST emit recovery events when a dimension's posture transitions to a
  lower-severity state, as defined in the alert event type catalog.

- **FR-004**: The system MUST detect posture transitions by comparing the current evaluation
  against the last-known posture for each tenant/workspace and dimension combination.

- **FR-005**: The system MUST NOT emit duplicate alert events for the same transition within the
  same evaluation cycle or across consecutive cycles where no actual posture change has occurred.

- **FR-006**: The system MUST emit all intermediate transition events when usage jumps across
  multiple thresholds in a single evaluation cycle, in ascending severity order.

- **FR-007**: The system MUST support both tenant-scoped and workspace-scoped alert evaluation
  without widening authorization or isolation boundaries.

- **FR-008**: The system MUST publish alert events through the platform event backbone (Kafka) in
  a structured format that downstream consumers can subscribe to.

- **FR-009**: Each alert event MUST contain the fields specified in the alert event contract,
  including correlation identifiers suitable for audit trail linkage.

- **FR-010**: The system MUST suppress threshold alerts for dimensions whose underlying usage
  evidence is marked `degraded` or `unavailable`, and MUST emit a suppression event instead.

- **FR-011**: The system MUST NOT emit alerts for dimensions explicitly configured as unbounded
  in the quota policy.

- **FR-012**: The system MUST maintain a last-known posture state per tenant/workspace and
  dimension to enable transition detection. This state must survive process restarts within the
  configured snapshot refresh cadence.

- **FR-013**: The alert evaluation MUST use the same inclusive comparison semantics (`>=`)
  established by `US-OBS-03-T02` for threshold boundary determination.

- **FR-014**: The system MUST handle policy configuration changes (new dimensions added, threshold
  values modified, dimensions removed) gracefully: the next evaluation cycle after a policy change
  must re-evaluate all affected dimensions and emit transitions as needed.

- **FR-015**: Alert events MUST be compatible with the canonical audit vocabulary introduced in
  `US-OBS-02` and the posture identifiers defined in `US-OBS-03-T02`.

### Key Entities

- **Posture Transition**: A change in the quota posture of a specific dimension for a specific
  tenant or workspace between two consecutive evaluations. Each transition maps to exactly one
  alert event.

- **Alert Event**: A structured, immutable record published to the event backbone representing a
  single posture transition, suppression, or recovery. Contains the full context needed by
  downstream subscribers.

- **Last-Known Posture Store**: The per-dimension, per-scope record of the most recent posture
  state and the evaluation timestamp at which it was established. Used to detect transitions and
  prevent duplicate emissions.

- **Alert Evaluation Cycle**: One complete pass over all active tenant and workspace postures to
  detect transitions and emit events. Triggered after each usage snapshot refresh.

---

## Multi-Tenancy and Isolation

- Alert evaluation for tenant scope requires `tenantId`; alert events are published with the
  `tenantId` that triggered the transition.
- Alert evaluation for workspace scope requires both `tenantId` and `workspaceId`.
- Workspace alert events must never disclose posture or usage from another workspace.
- The last-known posture store must be partitioned by tenant and workspace scope; cross-tenant
  posture state must never be co-mingled.
- Alert event topics or partitioning on the event backbone must support downstream consumers
  filtering by tenant without reading events from other tenants.
- Cross-tenant alert aggregation or comparison is out of scope for this task.

---

## Permissions and Access

- Alert evaluation is an internal platform process; it does not require caller-initiated
  authorization per evaluation cycle.
- Downstream consumers that subscribe to alert events must filter based on their own authorization
  scope; the alert emission layer publishes events and does not enforce consumer-side access
  control.
- If an external API surface for querying alert history is needed, it must align with the
  tenant-scoped and workspace-scoped read permissions established by `US-OBS-03-T02`. However,
  building that API surface is not required in this task.
- No alert-management write workflow (acknowledge, silence, configure routing) is required in this
  task; this task is about detecting transitions and emitting events.

---

## Audit and Traceability

- Every alert event must contain a `correlation_id` that can be linked to the underlying quota
  posture snapshot from T02 and the usage snapshot from T01.
- Alert events must be published to the event backbone in a format compatible with the canonical
  audit vocabulary from `US-OBS-02`, including standard `actor`, `action`, `resource`, and
  `timestamp` fields.
- Suppression events must record the reason for suppression (evidence degraded, evidence
  unavailable) and the dimension that would have triggered the alert.
- The alert event stream must be suitable for ingestion by future audit-log consumers and
  compliance reporting without requiring transformation.
- Alert events must not contain raw request payloads, secrets, or cross-tenant identifiers.

---

## Out of Scope / Boundaries

This task does **not**:

- replace or modify the usage-consumption baseline from `US-OBS-03-T01`,
- replace or modify the quota-policy evaluation surface from `US-OBS-03-T02`,
- block new resource creation or provisioning in response to alerts (`US-OBS-03-T04`),
- implement operator or tenant-facing console views for quota status or alert history
  (`US-OBS-03-T05`),
- deliver cross-module enforcement tests (`US-OBS-03-T06`),
- implement alert acknowledgment, silencing, or routing configuration,
- implement notification delivery channels (email, webhook, Slack, etc.) beyond publishing
  structured events to the Kafka event backbone,
- or introduce any quota-enforcement side effects — this task is purely observational and
  event-emitting.

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: When a tenant's metered dimension transitions from within-limits to
  `warning_threshold_reached`, a corresponding alert event appears on the event backbone within
  the same evaluation cycle.

- **SC-002**: When a dimension transitions through warning → soft-limit → hard-limit in successive
  evaluation cycles, exactly three distinct alert events are emitted with the correct event types,
  no duplicates, and correct chronological ordering.

- **SC-003**: When a dimension's usage drops below a previously crossed threshold, a recovery event
  is emitted within the same evaluation cycle as the transition.

- **SC-004**: No threshold alert is emitted for a dimension whose evidence freshness is `degraded`
  or `unavailable`; a suppression event is emitted instead.

- **SC-005**: Alert events for workspace A never contain posture, usage, or threshold data from
  workspace B, even within the same tenant.

- **SC-006**: After a process restart, the system resumes transition detection from the last-known
  posture without re-emitting alerts for postures that were already reported before the restart.

- **SC-007**: The alert event payload contains all fields defined in the alert event contract,
  and each event can be correlated back to a posture snapshot and a usage snapshot via
  `correlation_id`.

---

## Blocking Questions / Assumptions

### Assumptions

- The alert evaluation cycle is triggered by or runs immediately after the usage snapshot refresh
  established in T01, using the same configurable cadence (default ≤ 5 minutes).
- The event backbone topic for quota threshold alerts is a dedicated Kafka topic (or topic
  partition strategy) scoped to this alert domain; the exact topic naming convention follows
  platform-wide event topology decisions.
- The last-known posture store may use the same persistence mechanism available to the platform
  (PostgreSQL or equivalent); the exact storage is an implementation decision, not a specification
  concern.
- Recovery events use the same event contract as crossing events, differentiated only by
  `event_type` and the direction of the posture transition.
- Dampening or rate-limiting of oscillating alerts is an optional enhancement that may be added
  later; this specification requires that every real transition is emitted by default.

### No blocking questions

No open question in this task blocks progress. The alert event contract, transition detection
semantics, suppression rules, and scope boundaries are fully defined within this specification and
the baseline established by T01 and T02.
