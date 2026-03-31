# Feature Specification: Plan Transition & Limit Excess Policies

**Feature Branch**: `102-plan-transition-limit-policies`  
**Created**: 2026-03-31  
**Status**: Draft  
**Input**: User description: "Documentar políticas de transición, compatibilidad y tratamiento de exceso sobre límites"  
**Task ID**: US-PLAN-01-T06  
**Epic**: EP-19 — Planes, límites y packaging del producto  
**Story**: US-PLAN-01 — Modelo de planes de producto y asignación a tenants  
**Depends on**: US-PLAN-01-T01 (097), US-PLAN-01-T02 (098), US-PLAN-01-T03 (099), US-PLAN-01-T04 (100), US-PLAN-01-T05 (101)

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Platform Defines Transition Compatibility Rules Between Plans (Priority: P1)

A superadmin or product operations user establishes which plan transitions are permitted and which are blocked. The platform maintains a set of transition compatibility rules that govern whether a tenant can move from one plan to another. For example, moving from `starter` to `professional` (upgrade) may be unconditionally allowed, while moving from `enterprise` to `starter` (multi-tier downgrade) may require explicit approval or be blocked outright. Each rule specifies a source plan (or wildcard), a target plan (or wildcard), a transition direction (upgrade, downgrade, lateral), and whether the transition is allowed, allowed-with-approval, or blocked.

**Why this priority**: Without explicit transition rules, the platform either allows all plan changes (creating commercial and operational risk) or blocks all changes (creating operational friction). Defining rules is the prerequisite for safe, auditable plan mobility.

**Independent Test**: Can be fully tested by creating transition rules between specific plans, then attempting plan assignments that match allowed, approval-required, and blocked rules, and verifying the system enforces each correctly.

**Acceptance Scenarios**:

1. **Given** a transition rule allows `starter` → `professional` unconditionally, **When** a superadmin assigns the `professional` plan to a tenant currently on `starter`, **Then** the assignment proceeds without additional approval.
2. **Given** a transition rule marks `enterprise` → `starter` as blocked, **When** a superadmin attempts to assign `starter` to a tenant currently on `enterprise`, **Then** the system rejects the assignment with a clear explanation that the transition is not permitted by policy.
3. **Given** a transition rule marks `professional` → `starter` as allowed-with-approval, **When** a superadmin initiates the transition, **Then** the system indicates that the transition requires explicit acknowledgment of downgrade consequences before proceeding.
4. **Given** no specific transition rule exists between two plans, **When** a superadmin attempts the transition, **Then** the system falls back to the platform default policy (configurable as allow-all, block-all, or allow-upgrades-only).

---

### User Story 2 — Platform Enforces Limit Excess Policies on Downgrade (Priority: P1)

When a tenant's plan is changed to a plan with lower limits, and the tenant's current resource consumption already exceeds one or more of the new limits, the platform applies a configurable limit excess policy. The policy determines how the over-limit condition is handled: whether the tenant is placed in a grace period during which they must reduce consumption, whether new resource creation is blocked immediately while existing resources remain untouched, or whether the transition is blocked entirely until the tenant is within the target plan's limits.

**Why this priority**: Downgrades with existing over-limit consumption are the highest-risk scenario in plan transitions. Without a clear, enforceable policy, tenants may lose access to resources or the platform may allow indefinitely uncapped usage. This policy is the safety net that makes plan mobility commercially and operationally viable.

**Independent Test**: Can be fully tested by creating a tenant with resource counts exceeding a target plan's limits, attempting a downgrade, and verifying the correct policy is applied (grace period assigned, new-creation blocked, or transition rejected) based on the configured excess policy.

**Acceptance Scenarios**:

1. **Given** the limit excess policy is set to `grace-period` with a 30-day window, **When** tenant `acme-corp` downgrades from `professional` (10 workspaces allowed) to `starter` (3 workspaces allowed) while currently using 7 workspaces, **Then** the transition succeeds, a 30-day grace period is recorded for the `max_workspaces` dimension, the tenant retains access to all 7 workspaces during the grace period, and a notification is emitted indicating the excess condition and deadline.
2. **Given** the limit excess policy is set to `block-creation`, **When** the same downgrade occurs, **Then** the transition succeeds, the tenant retains existing workspaces but cannot create new ones until consumption falls to or below 3, and a persistent over-limit indicator is recorded.
3. **Given** the limit excess policy is set to `block-transition`, **When** the same downgrade is attempted, **Then** the system rejects the transition with a detailed breakdown of which dimensions are over-limit and by how much, and advises the operator to reduce consumption first.
4. **Given** a downgrade creates over-limit conditions on multiple dimensions simultaneously, **Then** the policy is applied independently per dimension, and the combined result is reported as a single coherent summary.

---

### User Story 3 — Superadmin Configures and Reviews Limit Excess Policies (Priority: P1)

A superadmin configures the platform-wide default limit excess policy and optionally overrides it per specific plan transition or per specific quota dimension. They can review the current policy configuration to understand what will happen when a particular downgrade is attempted.

**Why this priority**: Policy configurability gives product and finance teams the flexibility to define business-appropriate responses to over-limit conditions without requiring code changes. The ability to review policies before they are triggered prevents surprise outcomes.

**Independent Test**: Can be fully tested by configuring a default policy, adding per-transition and per-dimension overrides, then querying the effective policy for various transition scenarios and verifying the resolution hierarchy is correct.

**Acceptance Scenarios**:

1. **Given** the superadmin sets the platform default limit excess policy to `grace-period` with a 14-day window, **When** any downgrade triggers an over-limit condition and no more specific policy applies, **Then** the 14-day grace period policy governs.
2. **Given** the superadmin adds an override for the `professional` → `starter` transition setting the policy to `block-transition`, **When** that specific downgrade is attempted with over-limit consumption, **Then** the transition-specific policy applies instead of the platform default.
3. **Given** the superadmin adds a dimension-level override setting `max_storage_bytes` to `block-creation` regardless of transition, **When** any downgrade triggers an over-limit condition on storage, **Then** the dimension-specific policy applies for storage while other dimensions follow the transition-level or platform-default policy.
4. **Given** a superadmin queries the effective policy for a hypothetical `enterprise` → `starter` transition, **Then** the system returns the resolved policy for each quota dimension, indicating which policy layer (platform default, transition override, or dimension override) governs each.

---

### User Story 4 — Tenant Owner Receives Clear Communication About Over-Limit Status (Priority: P2)

After a plan change that creates over-limit conditions, the tenant owner sees clear, actionable information about their situation: which resources exceed the new plan's limits, what the effective policy is (grace period deadline, creation block, etc.), and what actions they can take to return to compliance. This information is available in the console and emitted as auditable events.

**Why this priority**: Tenant owners are directly affected by limit excess policies. Without clear communication, they cannot act on over-limit conditions, leading to support escalations and frustration.

**Independent Test**: Can be fully tested by triggering a downgrade with over-limit conditions, then checking the tenant console for over-limit indicators, reviewing the emitted events, and verifying the information is accurate and actionable.

**Acceptance Scenarios**:

1. **Given** tenant `acme-corp` is in a grace period for `max_workspaces` after a downgrade, **When** the tenant owner views the plan or quota section of the console, **Then** the console shows which dimensions are over-limit, the grace period deadline, the current consumption versus the new limit, and suggested actions (e.g., "Delete 4 workspaces before 2026-05-01").
2. **Given** a `block-creation` policy is in effect for `max_api_keys`, **When** the tenant owner attempts to create a new API key, **Then** the system blocks the creation and explains that the tenant is over the plan limit for API keys and must reduce existing keys before creating new ones.
3. **Given** a grace period expires and the tenant has not reduced consumption, **Then** the system transitions the over-limit condition to a `block-creation` policy for the affected dimensions and emits an audit event indicating the grace period expired.

---

### User Story 5 — Superadmin Reviews Transition Audit Trail (Priority: P2)

A superadmin or compliance officer reviews the audit trail for plan transitions to see which transitions were allowed, which were blocked by policy, which required approval acknowledgment, and which triggered limit excess policies. Each audit entry includes the transition attempted, the policy evaluation result, any over-limit dimensions detected, and the policy applied.

**Why this priority**: Auditability of policy enforcement is essential for compliance, dispute resolution, and operational confidence. It builds on existing plan change history (US-PLAN-01-T04) by adding the policy evaluation dimension.

**Independent Test**: Can be fully tested by performing various plan transitions (allowed, blocked, with excess), then querying the audit trail and verifying each entry contains complete policy evaluation details.

**Acceptance Scenarios**:

1. **Given** a plan transition was blocked by a compatibility rule, **When** the audit trail is queried, **Then** the entry shows the attempted transition, the rule that blocked it, and the timestamp and actor.
2. **Given** a plan transition succeeded with a grace-period policy applied, **When** the audit trail is queried, **Then** the entry shows the transition, the over-limit dimensions, the policy applied per dimension, and the grace period deadline.
3. **Given** a grace period expired and the policy escalated to `block-creation`, **When** the audit trail is queried, **Then** the escalation event appears as a separate audit entry linked to the original transition.

---

### User Story 6 — Platform Handles Upgrade Transitions Smoothly (Priority: P3)

When a tenant upgrades to a plan with equal or higher limits across all dimensions, the transition is straightforward: no over-limit condition exists, no grace period is needed, and the new higher limits take effect immediately. The system recognizes this as a clean upgrade and records it without triggering any limit excess policy evaluation.

**Why this priority**: While upgrades are the simpler case, explicitly defining the upgrade path ensures the system doesn't unnecessarily trigger excess policy evaluation, reducing noise in audit trails and simplifying the operator experience.

**Independent Test**: Can be fully tested by upgrading a tenant to a plan with strictly higher limits and verifying no excess policy is triggered, the upgrade completes immediately, and the audit entry is recorded as a clean upgrade.

**Acceptance Scenarios**:

1. **Given** tenant `acme-corp` is on `starter` (3 workspaces) and currently uses 2, **When** upgraded to `professional` (10 workspaces), **Then** the transition completes immediately with no grace period, no block, and the audit entry is marked as a clean upgrade.
2. **Given** the upgrade introduces new quota dimensions not present in the source plan, **Then** those dimensions take effect with the target plan's values and no excess condition is evaluated for them.

### Edge Cases

- **Mixed transition (some limits increase, some decrease)**: When a plan change increases some dimensions but decreases others, the system evaluates the limit excess policy only for the dimensions that decrease below current consumption. Dimensions that increase or remain unchanged are not subject to excess evaluation.
- **Unlimited-to-finite transition**: When a dimension changes from unlimited (`-1`) to a finite value, the system treats this as a potential excess condition and evaluates current consumption against the new finite limit.
- **Finite-to-unlimited transition**: This is always clean — no excess evaluation needed.
- **Zero-limit dimension**: A dimension with a `0` limit after transition means the resource type is not permitted. If the tenant currently has any resources of that type, the full excess policy applies.
- **Grace period already active from a previous transition**: If the tenant already has an active grace period for a dimension from a prior downgrade and another transition triggers a new excess condition for the same dimension, the more restrictive policy governs and the grace period is not extended.
- **Plan transition while tenant has no current consumption data available**: The system records the limit change but marks the excess evaluation as `deferred` with an audit note, and re-evaluates when consumption data becomes available.
- **Concurrent plan transitions for the same tenant**: Only one plan transition may be in progress at a time per tenant. A second attempt while one is pending is rejected with a conflict error.
- **Transition to the same plan**: Assigning the same plan a tenant already has is treated as a no-op and does not trigger any policy evaluation or generate excess records.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST support a catalog of plan transition compatibility rules, each specifying a source plan (or wildcard), target plan (or wildcard), transition direction classification (upgrade, downgrade, lateral), and disposition (allowed, allowed-with-approval, blocked).
- **FR-002**: The system MUST enforce transition compatibility rules at the time of plan assignment, rejecting blocked transitions and requiring acknowledgment for approval-required transitions.
- **FR-003**: The system MUST provide a configurable platform-wide default transition policy that governs transitions with no specific rule defined.
- **FR-004**: The system MUST support three limit excess policy modes: `grace-period` (with configurable duration), `block-creation` (prevent new resources while retaining existing), and `block-transition` (reject the plan change entirely).
- **FR-005**: The system MUST evaluate limit excess conditions per quota dimension independently when a plan transition reduces limits below current tenant consumption.
- **FR-006**: The system MUST support a three-tier policy resolution hierarchy: dimension-level override > transition-level override > platform default.
- **FR-007**: The system MUST record a grace period entry per affected dimension when the `grace-period` policy applies, including the start timestamp, expiration timestamp, the dimension key, the effective limit, and the observed consumption at the time of change.
- **FR-008**: The system MUST automatically escalate expired grace periods to `block-creation` policy for the affected dimension and emit an audit event.
- **FR-009**: The system MUST block new resource creation for dimensions under `block-creation` policy and provide a clear, actionable error message explaining the over-limit condition.
- **FR-010**: The system MUST allow superadmins to query the effective policy for any hypothetical plan transition, returning the resolved policy per dimension with the governing policy layer identified.
- **FR-011**: The system MUST emit auditable events for every policy evaluation: transition allowed, transition blocked, excess detected, grace period started, grace period expired, creation blocked, and policy escalation.
- **FR-012**: The system MUST treat upgrades (all dimensions equal or higher) as clean transitions that bypass excess policy evaluation entirely.
- **FR-013**: The system MUST prevent concurrent plan transitions for the same tenant, returning a conflict error if a transition is already in progress.
- **FR-014**: The system MUST recognize same-plan reassignment as a no-op and not trigger policy evaluation.
- **FR-015**: The system MUST handle unlimited-to-finite transitions as potential excess conditions and evaluate current consumption accordingly.
- **FR-016**: The system MUST surface over-limit conditions, grace period deadlines, and suggested remediation actions to tenant owners through the console and queryable APIs.
- **FR-017**: The system MUST persist all policy configuration (rules, overrides, defaults) with full audit trail of changes including actor, timestamp, and previous value.
- **FR-018**: The system MUST support tenant-scoped isolation — transition rules and excess policies for one tenant MUST NOT leak to or affect another tenant's evaluation.

### Key Entities

- **Transition Compatibility Rule**: Defines whether a specific plan-to-plan transition is allowed, requires approval, or is blocked. Attributes include source plan reference (or wildcard), target plan reference (or wildcard), direction classification, disposition, and optional justification text.
- **Limit Excess Policy**: Configurable policy governing what happens when a tenant's consumption exceeds the target plan's limits on transition. Has three modes (grace-period, block-creation, block-transition) and can be set at platform, transition, or dimension level.
- **Grace Period Record**: Tracks an active grace period for a specific tenant and quota dimension, including start time, expiration time, effective limit, observed consumption at creation, and current status (active, expired, resolved).
- **Over-Limit Condition**: A per-tenant, per-dimension record indicating that the tenant's current consumption exceeds the plan's effective limit, the governing policy mode, and the remediation status.
- **Transition Policy Evaluation Result**: An immutable audit record capturing the full policy evaluation for a specific plan transition attempt, including the compatibility rule matched, the excess conditions detected, and the policy applied per dimension.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every plan transition attempt produces a complete, queryable audit record within 5 seconds, including the compatibility rule evaluation and any excess policy applied.
- **SC-002**: Superadmins can configure transition rules and excess policies and verify their effect on hypothetical transitions without performing an actual plan change.
- **SC-003**: Tenant owners affected by over-limit conditions can identify the affected dimensions, deadlines, and recommended actions within one console page load after a plan change.
- **SC-004**: Grace period expiration is detected and escalated to block-creation within the configured sweep interval (no more than 15 minutes past expiry under normal operation).
- **SC-005**: 100% of blocked transitions are rejected before any state mutation occurs — no partial plan assignments result from policy enforcement.
- **SC-006**: The policy resolution hierarchy (dimension > transition > platform default) produces deterministic, explainable results for any combination of configured policies.
