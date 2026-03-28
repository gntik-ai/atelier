# Feature Specification: US-OBS-03-T04 — Hard-Limit Quota Enforcement on Resource Creation

**Feature Branch**: `040-quota-hard-limit-enforcement`
**Task**: `US-OBS-03-T04`
**Epic**: EP-13 — Cuotas, metering, auditoría y observabilidad
**Story**: US-OBS-03 — Metering, cuotas, alertas y estado de aprovisionamiento
**Requirements traceability**: RF-OBS-009, RF-OBS-010, RF-OBS-011, RF-OBS-012, RF-OBS-013, RF-OBS-014, RF-OBS-015, RF-OBS-019
**Dependencies**: US-PLAN-01, US-TEN-01
**Intra-story dependencies**: US-OBS-03-T01 (consumption metering), US-OBS-03-T02 (quota-policy evaluation), US-OBS-03-T03 (threshold alerts)
**Created**: 2026-03-28
**Status**: Specified

---

## Problem Statement

The platform now meters consumption per tenant and workspace (T01), evaluates quota posture
deterministically against configured hard/soft/warning limits (T02), and emits structured alert
events when threshold boundaries are crossed (T03). However, none of these capabilities **prevent**
a tenant from continuing to create resources after a hard limit has been reached. The quota posture
is informational only.

Without enforcement:

- a tenant whose `storage_buckets` count has reached the hard limit can still create additional
  buckets, rendering the limit advisory rather than binding,
- metering and alerting lose credibility because operators see breaches reported but never blocked,
- downstream billing, capacity planning, and fair-use guarantees cannot rely on the quota system as
  a control surface,
- and there is no structured rejection payload that the console or API consumers can use to explain
  *why* an operation was denied.

This task introduces the **hard-limit enforcement layer**: a synchronous gate that intercepts
resource-creation requests, evaluates the current quota posture for the affected scope, and rejects
the operation with a structured, auditable error when the hard limit has been reached or would be
exceeded.

---

## Users and Value

| Actor | Value received |
| --- | --- |
| **Superadmin / SRE** | Confidence that hard limits are actually enforced; no tenant can silently exceed allocated capacity. |
| **Tenant owner** | Clear, actionable feedback when a creation request is blocked, including which dimension is at capacity and how to resolve it (upgrade plan, clean up resources, request quota increase). |
| **Security / Governance** | Auditable record of every enforcement decision — both blocked and allowed — linked to the quota posture at decision time. |
| **Platform API consumers** | Deterministic, machine-readable rejection responses that enable graceful degradation and retry logic in client applications. |

---

## User Scenarios & Testing

### User Story 1 — Resource creation is blocked when hard limit is reached (Priority: P1)

A tenant attempts to create a new resource (e.g., a storage bucket, a serverless function, a Kafka
topic) while the measured consumption for the relevant dimension already equals or exceeds the hard
limit configured for their plan and scope. The platform must reject the request synchronously with a
clear error before any side effect occurs.

**Why this priority**: This is the core enforcement capability — without it, hard limits are
meaningless. It is the minimum viable enforcement behaviour and the foundation for all other
scenarios.

**Independent Test**: Configure a tenant with a hard limit of 3 for `storage_buckets`. Create 3
buckets successfully. Attempt to create a 4th bucket. Verify the request is rejected with a
structured quota-exceeded error and no bucket is created.

**Acceptance Scenarios**:

1. **Given** a tenant whose `storage_buckets` consumption equals the hard limit,
   **When** the tenant sends a POST request to create a new bucket,
   **Then** the platform returns an HTTP 429 (or 403) response with error code
   `QUOTA_HARD_LIMIT_REACHED`, the dimension name, current usage, and the limit value,
   **And** no bucket is created, no storage is allocated, and no side effects are persisted.

2. **Given** a tenant whose `api_requests` count is below the hard limit,
   **When** the tenant sends a valid resource-creation request,
   **Then** the request proceeds normally and the enforcement gate adds no observable latency beyond
   the configured SLO (see SC-002).

3. **Given** a workspace-scoped hard limit of 5 for `logical_databases`,
   **When** a user in that workspace attempts to create a 6th database,
   **Then** the request is rejected with the same structured error, scoped to the workspace.

---

### User Story 2 — Rejection response is structured and actionable (Priority: P1)

When a request is blocked, the API consumer (human or machine) must receive a response body that
identifies the quota dimension, the current usage, the hard limit, the scope (tenant or workspace),
and a human-readable message. This enables the console to render meaningful feedback and allows
programmatic clients to implement retry/backoff or escalation logic.

**Why this priority**: Enforcement without clear feedback creates a frustrating experience. This is
co-equal with the blocking itself because a generic 403 with no payload is operationally useless.

**Independent Test**: Trigger a hard-limit rejection for any dimension. Inspect the response body
and confirm it contains all required fields and is parseable by a JSON client.

**Acceptance Scenarios**:

1. **Given** a hard-limit rejection for dimension `serverless_functions` at workspace scope,
   **When** the response body is inspected,
   **Then** it contains at minimum: `error_code` (`QUOTA_HARD_LIMIT_REACHED`), `dimension`
   (`serverless_functions`), `scope_type` (`workspace`), `scope_id`, `current_usage`, `hard_limit`,
   and `message` (human-readable text in the tenant's locale or a default).

2. **Given** a hard-limit rejection,
   **When** the response headers are inspected,
   **Then** a `Retry-After` header is NOT present (hard limits are not transient; the client must
   take corrective action, not retry blindly).

---

### User Story 3 — Enforcement decisions are audited (Priority: P2)

Every enforcement evaluation — whether the result is "allowed" or "blocked" — must produce an audit
event that records the decision, the quota posture at decision time, the requesting identity, the
resource type, and the scope. This enables governance review and anomaly detection.

**Why this priority**: Auditing is essential for compliance and forensic analysis but is not required
for the core blocking behaviour to function.

**Independent Test**: Create a resource that is allowed and one that is blocked. Query the audit log
and verify both decisions are recorded with the expected fields.

**Acceptance Scenarios**:

1. **Given** a resource creation that is allowed by the enforcement gate,
   **When** the audit log is queried for the request's correlation ID,
   **Then** an `enforcement_decision` event with `result: allowed` and the quota posture snapshot is
   present.

2. **Given** a resource creation that is blocked,
   **When** the audit log is queried,
   **Then** an `enforcement_decision` event with `result: blocked`, the dimension, usage, limit, and
   the requesting identity is present.

---

### User Story 4 — Enforcement applies consistently across all metered dimensions (Priority: P2)

The enforcement gate must not be limited to a single resource type. It must apply to every dimension
for which a hard limit is configured in the quota policy, including but not limited to:
`api_requests`, `serverless_functions`, `storage_buckets`, `logical_databases`, `kafka_topics`,
`collections_tables`, `realtime_connections`, and `error_budget`.

**Why this priority**: Dimension coverage is critical for the system's credibility but can be
delivered incrementally after the core gate is proven for at least one dimension.

**Independent Test**: For each metered dimension that has a hard limit configured, drive consumption
to the limit and attempt one more creation. Verify the rejection for every dimension.

**Acceptance Scenarios**:

1. **Given** a tenant with hard limits configured for N distinct dimensions,
   **When** consumption reaches the hard limit for dimension D (for each D in 1..N),
   **Then** the next resource-creation request for dimension D is blocked with the correct dimension
   in the rejection payload.

---

### User Story 5 — Enforcement respects quota-policy updates without restart (Priority: P3)

When a superadmin or automated plan change updates a tenant's hard limits (e.g., upgrading from a
plan with 5 buckets to one with 20), the enforcement gate must reflect the new limits within a
bounded propagation window — not require a platform restart or cache flush.

**Why this priority**: Hot-reload of limits is important for operational agility but the exact
propagation latency is a tuning concern; the enforcement gate itself can function correctly with
static limits initially.

**Independent Test**: Set a hard limit to 2. Consume both. Verify rejection. Update the hard limit
to 5. Verify the next creation is allowed within the specified propagation window.

**Acceptance Scenarios**:

1. **Given** a tenant blocked at hard limit 2 for `kafka_topics`,
   **When** the hard limit is updated to 5,
   **Then** within the configured propagation window (see FR-007), the tenant can create a 3rd
   topic.

2. **Given** a tenant with 4 `kafka_topics` and a hard limit of 5,
   **When** the hard limit is reduced to 3,
   **Then** existing resources are not deleted or suspended,
   **And** new creation requests are blocked until consumption is below the new limit.

---

### Edge Cases

- **Race condition**: Two concurrent creation requests arrive when the tenant has exactly 1 unit
  of quota remaining. At most one must succeed; the other must be blocked. The enforcement gate must
  use a concurrency-safe mechanism (e.g., optimistic locking, atomic counter) to prevent
  over-allocation.

- **Metering lag**: If T01 consumption data is slightly stale (eventual consistency), the
  enforcement gate should prefer a conservative evaluation — block if the last known posture is at
  or above the hard limit, even if real usage may have decreased since the last measurement.

- **No hard limit configured**: If a dimension has no hard limit in the quota policy (only
  soft/warning or none), the enforcement gate must not block; the request passes through.

- **Scope hierarchy**: If a workspace-level hard limit is not configured but a tenant-level one
  exists, the enforcement gate must evaluate the tenant-level limit. If both exist, the most
  restrictive applies.

- **Quota dimension not applicable**: A creation request for a resource type that maps to no metered
  dimension must pass through the enforcement gate without evaluation (no false blocks).

- **Error in posture evaluation**: If the enforcement gate cannot determine the current posture
  (e.g., metering service unavailable), the system must fail according to a configurable policy:
  fail-open (allow, log degraded enforcement) or fail-closed (reject, log error). The default should
  be fail-closed for hard limits.

---

## Requirements

### Functional Requirements

- **FR-001**: The system MUST reject any resource-creation request when the requesting scope's
  (tenant or workspace) measured consumption for the relevant dimension equals or exceeds the
  configured hard limit.

- **FR-002**: The rejection response MUST include: `error_code` (`QUOTA_HARD_LIMIT_REACHED`),
  `dimension`, `scope_type`, `scope_id`, `current_usage`, `hard_limit`, and a human-readable
  `message`.

- **FR-003**: The enforcement gate MUST NOT block requests for dimensions where no hard limit is
  configured or where the dimension does not apply to the requested resource type.

- **FR-004**: When both a workspace-level and a tenant-level hard limit exist for the same
  dimension, the enforcement gate MUST apply the most restrictive limit.

- **FR-005**: The enforcement gate MUST produce an audit event for every evaluation, recording the
  decision (`allowed` or `blocked`), the posture snapshot, the requesting identity, and the
  correlation ID.

- **FR-006**: The enforcement gate MUST be concurrency-safe: two concurrent requests with only one
  unit of remaining quota MUST NOT both succeed.

- **FR-007**: After a hard limit is updated in the quota policy, the enforcement gate MUST reflect
  the change within a bounded propagation window of [NEEDS CLARIFICATION: target propagation SLO,
  suggested ≤ 30 seconds].

- **FR-008**: When the enforcement gate cannot determine the current posture, it MUST apply the
  configured failure policy (default: fail-closed for hard limits) and log the incident.

- **FR-009**: Reducing a hard limit below current consumption MUST NOT retroactively remove or
  suspend existing resources; it MUST only block new creation until consumption falls below the new
  limit.

- **FR-010**: The enforcement evaluation MUST complete within a bounded latency budget so that
  resource-creation response times are not degraded beyond the configured SLO (see SC-002).

### Key Entities

- **Enforcement Decision**: Represents the outcome of a single enforcement evaluation — scope,
  dimension, posture snapshot, decision (allowed/blocked), timestamp, correlation ID, requesting
  identity. Persisted as an audit event.

- **Quota Posture** (from T02): The evaluated state of a scope+dimension — within_limits,
  warning_reached, soft_limit_exceeded, hard_limit_reached. The enforcement gate consumes this as
  read-only input.

- **Quota Policy** (from T02): The configured limits (hard, soft, warning) per dimension per scope.
  The enforcement gate reads the hard-limit value to make its decision.

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: 100% of resource-creation requests against a scope at hard limit are rejected with the
  correct structured error; zero over-allocations observed across all metered dimensions during
  acceptance testing.

- **SC-002**: Enforcement evaluation adds no more than 50 ms of p99 latency to resource-creation
  requests under normal operating conditions.

- **SC-003**: Every enforcement decision (allowed and blocked) is present in the audit log with all
  required fields, verified by querying audit events for a sample of creation requests.

- **SC-004**: After a hard-limit policy update, the enforcement gate reflects the new value within
  the configured propagation window, verified by the hot-reload acceptance scenario.

- **SC-005**: Under concurrent load (≥ 10 simultaneous creation requests with 1 unit remaining),
  exactly 1 request succeeds and the rest are blocked, verified by a concurrency stress test.

---

## Out of Scope

- **Soft-limit enforcement or throttling**: This task covers hard-limit blocking only. Soft-limit
  behaviour (e.g., degraded service, warnings, throttling) is a separate concern.
- **Console UI for quota feedback**: Rendering the rejection in the admin console is the
  responsibility of T05.
- **Billing integration**: Automatic plan upgrades or payment-triggered limit increases are outside
  this task's scope.
- **Retroactive enforcement**: Existing resources above a newly reduced limit are not affected; only
  new creation is blocked.
- **Alert emission for enforcement events**: T03 already handles threshold alerts. This task does
  not duplicate alert emission; it focuses on the synchronous blocking gate.

---

## Risks, Assumptions, and Open Questions

### Assumptions

- T01 provides consumption metrics with low-enough latency for synchronous enforcement decisions.
- T02 quota-posture evaluation is available as a callable, low-latency service or library.
- T03 alert events are independent of enforcement; enforcement does not wait for alert delivery.

### Risks

- **Latency impact**: Synchronous posture evaluation on every creation request could degrade API
  response times if the metering or policy lookup path is slow. Mitigation: enforce a latency budget
  (FR-010, SC-002) and consider caching posture with short TTL.
- **Eventual consistency**: If metering data is slightly stale, enforcement may briefly allow
  creations beyond the hard limit. Mitigation: fail-closed default and conservative evaluation
  (FR-008, edge case on metering lag).

### Open Questions

- **OQ-001**: What HTTP status code should be used for quota rejections — `429 Too Many Requests`
  or `403 Forbidden`? `429` implies retryability, which may be misleading for hard limits. `403`
  with a clear body may be more semantically correct. Recommendation: `403` with error code
  `QUOTA_HARD_LIMIT_REACHED`.
- **OQ-002**: What is the target propagation SLO for hot-reloaded limit changes (FR-007)? Suggested
  ≤ 30 seconds.
- **OQ-003**: Should the fail-closed default (FR-008) be configurable per dimension, or is a global
  setting sufficient for the initial implementation?
