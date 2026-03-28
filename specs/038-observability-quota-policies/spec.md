# Feature Specification: US-OBS-03-T02 — Quota Policies for Hard Limit, Soft Limit, and Warning Threshold

**Feature Branch**: `038-observability-quota-policies`
**Task**: `US-OBS-03-T02`
**Epic**: EP-13 — Cuotas, metering, auditoría y observabilidad
**Story**: US-OBS-03 — Metering, cuotas, alertas y estado de aprovisionamiento
**Requirements traceability**: RF-OBS-009, RF-OBS-010, RF-OBS-011, RF-OBS-012, RF-OBS-013, RF-OBS-014, RF-OBS-015, RF-OBS-019
**Dependencies**: US-PLAN-01, US-TEN-01
**Intra-story dependencies**: US-OBS-03-T01
**Created**: 2026-03-28
**Status**: Specified

---

## Problem Statement

`US-OBS-03-T01` established the authoritative usage-consumption baseline for tenant and workspace scope.
That solved **how much** each scope is consuming, but it did not yet define **how the platform should
interpret that consumption against quota policy**.

Without a shared quota-policy baseline:

- usage data remains descriptive rather than actionable,
- each downstream consumer could invent different threshold semantics,
- operators cannot explain whether a scope is merely approaching limits or has already exceeded a
  hard limit,
- and later alerting, blocking, and console work would depend on inconsistent policy logic.

This task introduces the **quota-policy evaluation baseline**: a bounded contract and helper surface
that compares measured usage against per-dimension policy thresholds and produces one consistent
posture for tenant and workspace scope.

---

## Users and Value

| Actor | Value received |
| --- | --- |
| **Superadmin / SRE** | Can determine whether a tenant or workspace is within quota, approaching warning, past soft limit, or at hard limit for each metered dimension. |
| **Security / Governance** | Receives a deterministic and auditable quota-policy interpretation surface instead of ad hoc threshold decisions in downstream modules. |
| **Tenant owner** | Gains the future foundation for transparent explanations of why governance actions, alerts, or blocks occur. |
| **Downstream platform tasks** | T03, T04, T05, and T06 can all reuse one authoritative quota posture instead of recalculating thresholds independently. |

---

## User Scenarios & Testing

### User Story 1 — Platform operator evaluates tenant quota posture (Priority: P1)

A platform operator needs to inspect a tenant and understand, per metered dimension, whether the
tenant is within limits, at warning threshold, past soft limit, or at hard limit.

**Why this priority**: Tenant-scoped quota interpretation is the minimum viable product that makes
usage data governable.

**Independent Test**: Evaluate a tenant usage snapshot against a policy catalog with warning, soft,
and hard thresholds. The result contains one deterministic posture per metered dimension.

**Acceptance Scenarios**:

1. **Given** a tenant usage snapshot below all configured thresholds,
   **When** the tenant quota posture is evaluated,
   **Then** every configured dimension is reported as within limits with remaining headroom.

2. **Given** a tenant usage snapshot that reaches the configured warning threshold for API requests,
   **When** the tenant quota posture is evaluated,
   **Then** the API requests dimension is reported as `warning_threshold_reached` and lower-severity
   dimensions remain unchanged.

3. **Given** a tenant usage snapshot that exceeds the soft limit for storage but remains below the
   hard limit,
   **When** the tenant quota posture is evaluated,
   **Then** storage is reported as `soft_limit_exceeded`, the tenant is not implicitly blocked by
   this task, and the response still includes remaining hard-limit headroom.

4. **Given** a tenant usage snapshot that reaches or exceeds the hard limit for a dimension,
   **When** the tenant quota posture is evaluated,
   **Then** that dimension is reported as `hard_limit_reached` with explicit rationale suitable for
   later blocking logic.

---

### User Story 2 — Platform operator evaluates workspace quota posture within tenant isolation (Priority: P1)

A platform operator or tenant-scoped owner needs the same quota interpretation for one workspace
without widening beyond the tenant and workspace boundary.

**Why this priority**: Workspace-level quota posture is required before later alerting, blocking,
and console views can act at workspace scope.

**Independent Test**: Evaluate one workspace usage snapshot and verify the response is scoped only
to that workspace and its tenant.

**Acceptance Scenarios**:

1. **Given** two workspaces under the same tenant with different usage levels,
   **When** workspace A's quota posture is queried,
   **Then** the response includes only workspace A's posture and threshold evaluation.

2. **Given** a caller scoped to workspace A,
   **When** the caller attempts to evaluate workspace B,
   **Then** the system rejects the scope widening.

---

### User Story 3 — Threshold semantics remain consistent across all consumers (Priority: P1)

Downstream alerting, blocking, and console work must all reuse one shared interpretation for warning,
soft-limit, and hard-limit semantics.

**Why this priority**: The core value of this task is consistency; without it, every later task could
drift in policy behavior.

**Independent Test**: Compare the same usage snapshot and policy input through multiple helper or
route entry points. They all return the same posture for every dimension.

**Acceptance Scenarios**:

1. **Given** one usage snapshot and one policy definition,
   **When** the posture is evaluated through the helper surface and through the published route,
   **Then** both results classify each dimension identically.

2. **Given** a dimension with no configured soft limit but with warning and hard thresholds,
   **When** posture is evaluated,
   **Then** the result uses the same documented fallback rules every time.

---

### User Story 4 — Operators can distinguish policy status from freshness degradation (Priority: P2)

Operators must know whether a quota posture is trustworthy when the underlying usage snapshot is
fresh, degraded, or unavailable.

**Why this priority**: A quota posture is only useful if the operator can tell when its evidence is
stale.

**Independent Test**: Evaluate a quota posture using usage dimensions marked `degraded` or
`unavailable` and verify the resulting posture preserves that warning state.

**Acceptance Scenarios**:

1. **Given** a usage dimension marked `degraded`,
   **When** quota posture is evaluated,
   **Then** the dimension posture remains visible but is marked as derived from degraded evidence.

2. **Given** a usage dimension marked `unavailable`,
   **When** quota posture is evaluated,
   **Then** the dimension is surfaced as not safely enforceable and its policy state is not falsely
   reported as healthy.

---

## Edge Cases

- **Warning threshold equals soft limit**: The posture remains deterministic and does not emit two
  contradictory statuses for the same dimension.
- **Soft limit omitted**: The contract must define whether evaluation jumps directly from warning to
  hard limit or treats soft limit as absent rather than inferred.
- **Hard limit below soft or warning threshold**: The policy is invalid and must fail validation.
- **Workspace policy override missing**: Workspace evaluation must either use a documented inherited
  tenant policy or report that no workspace policy exists; it must not silently widen to another
  workspace.
- **Usage value exactly equal to a threshold**: Equality must have explicit inclusive semantics.
- **Unlimited dimension**: A dimension intentionally configured without thresholds must remain visible
  and be classified as `unbounded` or equivalent rather than as healthy by accident.
- **Freshness degraded or unavailable**: The posture must preserve evidence quality and avoid
  overconfident enforcement semantics.
- **Negative or non-numeric threshold values**: These are invalid policy definitions and must be
  rejected by validation.
- **Dimension present in policy but absent from usage contract**: Validation must fail.

---

## Requirements

### Functional Requirements

- **FR-001**: The system MUST define a machine-readable quota-policy contract covering tenant and
  workspace scope.
- **FR-002**: The system MUST support threshold semantics for `warning_threshold`, `soft_limit`, and
  `hard_limit` per metered dimension.
- **FR-003**: The system MUST evaluate usage snapshots from `US-OBS-03-T01` against quota-policy
  thresholds and publish one deterministic posture per dimension.
- **FR-004**: The system MUST classify each evaluated dimension into a documented posture state set
  that distinguishes at minimum: below threshold, warning reached, soft limit exceeded, hard limit
  reached, and evidence unavailable or degraded.
- **FR-005**: Threshold comparison rules MUST be explicitly inclusive or exclusive and remain stable
  across all helper and route surfaces.
- **FR-006**: The evaluation result MUST include both the measured usage and the effective policy
  thresholds used for the decision.
- **FR-007**: The evaluation result MUST include remaining headroom to the next relevant threshold
  where that concept applies.
- **FR-008**: The system MUST support tenant-scoped and workspace-scoped policy evaluation without
  widening authorization scope.
- **FR-009**: The system MUST preserve usage freshness context from the underlying usage snapshot so
  operators can see whether a posture is based on fresh, degraded, or unavailable evidence.
- **FR-010**: The system MUST expose a query surface that downstream tasks can consume instead of
  re-implementing threshold evaluation.
- **FR-011**: Policy validation MUST reject contradictory threshold definitions, including negative
  values or ordering where warning > soft or soft > hard for the same dimension.
- **FR-012**: The system MUST allow explicitly unbounded or disabled dimensions to remain visible in
  the posture catalog without being treated as breached.
- **FR-013**: The posture output MUST contain sufficient rationale for downstream alerting and hard
  blocking work, but this task MUST NOT itself emit alerts or execute blocking.
- **FR-014**: The route and contract surface MUST remain aligned with authorization, public API
  taxonomy, and route catalog artifacts.

### Key Entities

- **Quota Policy Scope**: Tenant or workspace policy boundary with required permission, route
  mapping, and scope-binding rules.
- **Quota Dimension Policy**: Threshold configuration for one metered dimension, including optional
  warning, soft, and hard thresholds plus inheritance or bounded/unbounded behavior.
- **Quota Dimension Posture**: The evaluated result for one dimension combining current usage,
  threshold values, evidence freshness, policy status, and remaining headroom.
- **Quota Posture Snapshot**: The full tenant or workspace evaluation result containing all relevant
  dimension postures, a summarized overall state, and audit-compatible evaluation metadata.

---

## Multi-Tenancy and Isolation

- Tenant quota posture requires `tenantId` and must not widen to workspace scope.
- Workspace quota posture requires both `tenantId` and `workspaceId`.
- Workspace posture must never disclose quota posture from another workspace.
- Tenant-scoped callers may read workspace posture only when their authorization scope already
  permits that workspace.
- Cross-tenant quota posture comparison is out of scope for this task.
- Policy inheritance, if supported, must be explicit and deterministic; it must never infer scope by
  omission.

---

## Permissions and Access

- Tenant posture evaluation must align to a dedicated tenant-scoped read permission.
- Workspace posture evaluation must align to a dedicated workspace-scoped read permission.
- Later tasks may reuse these posture surfaces for alerting, blocking, and console visualization, but
  those tasks must not broaden read scope beyond the permissions introduced here.
- No policy-management write workflow is required in this task; this task is about policy semantics,
  evaluation, and publication of the posture surface.

---

## Audit and Traceability

- Quota-policy evaluation must remain compatible with the canonical audit vocabulary introduced in
  `US-OBS-02`.
- The posture output must contain stable identifiers and timestamps suitable for correlation with
  later alert and enforcement events.
- The evaluation summary must avoid raw request payloads, secrets, or cross-tenant detail.
- The contract should make explicit that later tasks may attach alerts or blocking outcomes to the
  posture identifiers defined here.

---

## Out of Scope / Boundaries

This task does **not**:

- invent or replace the usage-consumption baseline from `US-OBS-03-T01`,
- emit quota alerts or events (`US-OBS-03-T03`),
- block new resource creation or provisioning (`US-OBS-03-T04`),
- implement the final operator or tenant-facing usage-vs-quota console views (`US-OBS-03-T05`),
- or deliver the broad cross-module enforcement matrix (`US-OBS-03-T06`).

This task only defines the policy contract, posture evaluation semantics, publication surface,
documentation, and tests required for those downstream tasks.

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: Every metered dimension with a configured policy can be classified deterministically as
  warning, soft-limit exceeded, hard-limit reached, or within limits for both tenant and workspace
  scope.
- **SC-002**: The same usage input and threshold configuration produce identical posture results
  across all supported helper and route entry points.
- **SC-003**: Invalid threshold ordering is rejected automatically by validation before publication.
- **SC-004**: Operators can distinguish healthy posture from degraded-evidence posture without
  inspecting raw metrics.
- **SC-005**: Downstream tasks can consume one authoritative quota posture surface instead of
  recalculating thresholds independently.

---

## Blocking Questions / Assumptions

### Assumptions

- Threshold comparison uses inclusive semantics at the point of equality (`>=`) so there is no
  ambiguity when measured usage exactly meets a threshold.
- A missing soft limit is treated as intentionally absent rather than inferred from hard limit.
- This task may publish read-only posture routes for downstream consumers even though the final human
  console visualization is deferred to `US-OBS-03-T05`.

### No blocking questions

No open question in this task blocks progress because the threshold semantics, scope boundaries, and
downstream split can be defined within the repository baseline.
