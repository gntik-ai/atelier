# Feature Specification: Plan Upgrade/Downgrade Verification Tests

**Feature Branch**: `101-plan-upgrade-downgrade-tests`  
**Created**: 2026-03-31  
**Status**: Draft  
**Input**: User description: "Crear pruebas de upgrade/downgrade de plan con recursos ya creados"  
**Task ID**: US-PLAN-01-T05  
**Epic**: EP-19 — Planes, límites y packaging del producto  
**Story**: US-PLAN-01 — Modelo de planes de producto y asignación a tenants  
**Depends on**: US-PLAN-01-T01 (097-plan-entity-tenant-assignment), US-PLAN-01-T02 (098-plan-base-limits), US-PLAN-01-T03 (099-plan-management-api-console), US-PLAN-01-T04 (100-plan-change-impact-history)

## Objective

When a tenant upgrades or downgrades its plan, the platform must behave predictably with respect to resources the tenant has already created — workspaces, databases, functions, storage buckets, API keys, memberships, and any other quota-governed asset. Today, plan changes are recorded and their quota impact is persisted (T04), but there is no verified behaviour guaranteeing that existing resources remain accessible after an upgrade and that over-limit conditions after a downgrade are surfaced consistently without data loss.

This task delivers an automated verification suite that proves correctness of upgrade and downgrade transitions for tenants that already have live resources. It validates that:

1. Upgrades unlock higher limits and new capabilities without affecting existing resources.
2. Downgrades correctly surface over-limit conditions without deleting, disabling, or silently hiding existing resources.
3. The system maintains full auditability, multi-tenant isolation, and quota consistency across transitions.

## Users & Value

| Actor | Value received |
| ----- | -------------- |
| **Superadmin** | Confidence that plan changes applied to tenants with live resources behave as designed; regression protection against future changes to plan logic. |
| **Tenant owner** | Assurance that an upgrade never breaks existing resources and that a downgrade never causes silent data loss. |
| **Product / Finance ops** | Verified evidence that the transition model is commercially safe: over-limit conditions are flagged, not auto-remediated, preserving the ability to apply business policies downstream. |
| **QA / Platform engineering** | Executable verification artefacts that serve as living documentation of plan transition behaviour and can be incorporated into CI. |

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Upgrade Preserves Existing Resources and Unlocks Higher Limits (Priority: P1)

A superadmin upgrades a tenant that already has workspaces, databases, functions, API keys, and storage objects. After the upgrade, all previously created resources remain accessible and functional, and the tenant's effective limits reflect the higher plan entitlements.

**Why this priority**: If an upgrade breaks existing resources, the platform is commercially unusable. This is the most critical safety property of plan transitions.

**Independent Test**: Can be fully tested by provisioning a tenant on a lower plan, creating resources up to the plan limits, upgrading the plan, then verifying every previously created resource is still accessible and that the new higher limits are now reported.

**Acceptance Scenarios**:

1. **Given** tenant `acme-corp` is on plan `starter` with 3 workspaces, 2 Postgres databases, and 5 API keys already created, **When** a superadmin upgrades the tenant to plan `professional`, **Then** all 3 workspaces, 2 databases, and 5 API keys remain accessible and functional.
2. **Given** tenant `acme-corp` was at 100% of its `starter` storage limit, **When** the upgrade to `professional` completes, **Then** the effective storage limit increases and the tenant is no longer at capacity.
3. **Given** plan `professional` grants boolean capabilities not present in `starter` (e.g., `realtime_enabled`), **When** the upgrade completes, **Then** the newly gained capabilities are reflected in the tenant's effective entitlement summary.
4. **Given** the upgrade completes, **When** any existing resource is queried, **Then** the response is identical in structure and content to the pre-upgrade response (no field loss, no status change, no access denial).

---

### User Story 2 — Downgrade Surfaces Over-Limit Conditions Without Data Loss (Priority: P1)

A superadmin downgrades a tenant whose current resource consumption exceeds the target plan's limits. After the downgrade, the system clearly flags which quota dimensions are over-limit but does not delete, disable, archive, or restrict access to any existing resource.

**Why this priority**: Silent data loss or access denial on downgrade would be a critical trust violation. The platform must preserve resources and surface the over-limit condition for business-level resolution.

**Independent Test**: Can be fully tested by provisioning a tenant on a higher plan, creating resources that exceed the lower plan's limits, downgrading, then verifying all resources remain accessible and the over-limit conditions are accurately reported.

**Acceptance Scenarios**:

1. **Given** tenant `acme-corp` has 10 workspaces on plan `professional` (limit 10), **When** downgraded to plan `starter` (limit 5), **Then** all 10 workspaces remain accessible and functional, and the effective quota summary reports `max_workspaces` as over-limit (usage 10, effective limit 5).
2. **Given** tenant `acme-corp` has 8 API keys and the target plan allows 3, **When** the downgrade completes, **Then** all 8 API keys continue to function, and the system reports `max_api_keys` as over-limit.
3. **Given** tenant `acme-corp` loses a boolean capability on downgrade (e.g., `realtime_enabled` → false), **When** the downgrade completes, **Then** the lost capability is reflected in the effective entitlements, but existing resources created while the capability was active are not destroyed.
4. **Given** a downgrade creates over-limit conditions on multiple dimensions simultaneously, **When** the effective quota summary is queried, **Then** every affected dimension is individually flagged with its current usage and newly effective limit.

---

### User Story 3 — Audit Trail Captures Full Transition Context With Resource State (Priority: P1)

Every plan upgrade or downgrade for a tenant with existing resources produces an auditable record that includes not only the plan change delta (from T04) but also confirms that the verification of resource preservation was executed and its outcome.

**Why this priority**: Auditability of verified transitions is essential for compliance and support. Without it, operators cannot distinguish between a transition that was verified safe and one that was not.

**Independent Test**: Can be fully tested by performing an upgrade and a downgrade, then querying the audit/history records and verifying each contains a reference to the verification outcome.

**Acceptance Scenarios**:

1. **Given** an upgrade is performed on a tenant with existing resources, **When** the plan change history entry is queried, **Then** the audit record includes confirmation that existing resources were verified accessible post-transition.
2. **Given** a downgrade creates over-limit conditions, **When** the history entry is queried, **Then** the audit record captures each over-limit dimension with observed usage and effective limit at the time of change.
3. **Given** multiple plan changes occur over time, **When** the full history is retrieved, **Then** each entry independently records the verification state applicable to its specific transition.

---

### User Story 4 — Multi-Tenant Isolation Is Maintained During Transitions (Priority: P2)

When one tenant undergoes a plan change, the resources, limits, and capabilities of other tenants on the platform are completely unaffected.

**Why this priority**: Multi-tenant isolation is a non-negotiable platform invariant, but transitions involve quota recalculation that could leak across tenant boundaries if improperly scoped.

**Independent Test**: Can be fully tested by provisioning two tenants with different plans, changing only one tenant's plan, then verifying the other tenant's resources, limits, and capabilities are unchanged.

**Acceptance Scenarios**:

1. **Given** tenant `acme-corp` and tenant `globex-inc` both exist with resources, **When** `acme-corp` is upgraded, **Then** `globex-inc`'s effective limits, capabilities, and resource accessibility are unchanged.
2. **Given** tenant `acme-corp` is downgraded and enters an over-limit state, **When** `globex-inc`'s quota summary is queried, **Then** `globex-inc` shows no over-limit condition attributable to `acme-corp`'s transition.

---

### User Story 5 — Sequential Upgrade Then Downgrade Round-Trip Is Safe (Priority: P2)

A tenant undergoes an upgrade followed by a downgrade back to the original plan. After the round trip, the tenant's effective limits match the original plan, all resources created on the lower plan are preserved, and any resources created during the intermediate higher plan are preserved but flagged as over-limit if they exceed the original plan's limits.

**Why this priority**: Round-trip transitions are a common real-world scenario (trial upgrades, billing corrections) and exercise the most complex state transitions.

**Independent Test**: Can be fully tested by starting a tenant on `starter`, upgrading to `professional`, creating additional resources while on `professional`, then downgrading back to `starter` and verifying the full resource inventory with correct over-limit flags.

**Acceptance Scenarios**:

1. **Given** tenant starts on `starter`, is upgraded to `professional`, creates 3 additional workspaces (now at 8 total), **When** downgraded back to `starter` (limit 5), **Then** all 8 workspaces remain accessible and `max_workspaces` is flagged over-limit (8 of 5).
2. **Given** the round-trip completes, **When** the tenant's effective entitlements are queried, **Then** they exactly match the original `starter` plan limits and capabilities.
3. **Given** the round-trip completes, **When** the plan change history is queried, **Then** it contains two entries — upgrade and downgrade — each with its own verified impact snapshot.

### Edge Cases

- What happens when a tenant has zero resources (no workspaces, no databases, etc.) and undergoes an upgrade or downgrade? The transition must complete cleanly with no over-limit flags and the effective limits must reflect the target plan.
- What happens when a tenant's current usage exactly equals the target plan's limit on a dimension? The system must report the dimension as at-limit, not over-limit.
- What happens when a quota dimension exists in the source plan but not in the target plan (or vice versa)? The verification must account for added or removed dimensions and report them as such in the transition audit.
- What happens when usage data for a specific dimension is temporarily unavailable during the transition? The verification must mark that dimension's usage status as unavailable rather than skipping it or reporting false data.
- What happens when a plan change is performed concurrently for the same tenant (e.g., two superadmins acting simultaneously)? The system must serialize plan changes per tenant and reject the concurrent attempt or queue it, never apply both.
- What happens when the tenant has resources governed by overrides that exceed both the source and target plan limits? The verification must consider effective limits inclusive of overrides, not just base plan limits.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide an automated verification suite that validates resource preservation during plan upgrade transitions for tenants with existing resources.
- **FR-002**: The system MUST provide an automated verification suite that validates resource preservation during plan downgrade transitions for tenants with existing resources.
- **FR-003**: Each verification run MUST assert that every resource type governed by quota dimensions (workspaces, Postgres databases, MongoDB databases, Kafka topics, functions, storage objects, API keys, memberships) remains accessible and functional after a plan change.
- **FR-004**: After a downgrade, the verification MUST enumerate each quota dimension where current usage exceeds the newly effective limit and report the exact usage count and effective limit per dimension.
- **FR-005**: After an upgrade, the verification MUST confirm that no previously accessible resource has become inaccessible, restricted, or modified in state.
- **FR-006**: The verification MUST confirm that newly gained boolean capabilities (from upgrade) are reflected in the tenant's effective entitlements.
- **FR-007**: The verification MUST confirm that lost boolean capabilities (from downgrade) are reflected in the tenant's effective entitlements without destroying resources created while the capability was active.
- **FR-008**: The verification MUST produce a structured, machine-readable result that includes: tenant identifier, source plan, target plan, timestamp, per-dimension verification status (accessible, over-limit, at-limit, usage-unavailable), and overall pass/fail outcome.
- **FR-009**: The verification MUST confirm multi-tenant isolation by asserting that no other tenant's resources, limits, or capabilities are affected by the plan change under test.
- **FR-010**: The verification MUST support round-trip transitions (upgrade then downgrade to original plan) as a single composite test scenario.
- **FR-011**: The verification MUST account for tenant-specific overrides when evaluating effective limits — base plan limits alone are insufficient.
- **FR-012**: When current usage for a dimension cannot be determined, the verification MUST report that dimension as `usage_unavailable` rather than omitting it or assuming a value.
- **FR-013**: The verification result MUST be persisted or emittable as an auditable record that can be correlated with the plan change history entry from T04.
- **FR-014**: The verification suite MUST be executable as part of a continuous integration pipeline to serve as regression protection.

### Key Entities

- **Plan Transition Verification Result**: Represents the outcome of verifying a single plan change against live tenant resources. Includes tenant reference, source and target plans, per-dimension verification status, overall outcome, and correlation to the plan change audit entry.
- **Dimension Verification Status**: Per-quota-dimension record within a verification result. Captures the dimension key, effective limit before and after, observed usage, and status classification (accessible, over-limit, at-limit, usage-unavailable).
- **Capability Verification Entry**: Per-boolean-capability record within a verification result. Captures the capability key, previous state, new state, and whether existing resources dependent on the capability were preserved.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of upgrade transitions for tenants with existing resources complete without any resource becoming inaccessible — verified by the automated suite across all quota-governed resource types.
- **SC-002**: 100% of downgrade transitions for tenants with over-limit resources complete without any resource being deleted, disabled, or hidden — verified by the automated suite.
- **SC-003**: Every over-limit condition created by a downgrade is individually detected and reported with accurate usage and limit values — zero false negatives across all quota dimensions.
- **SC-004**: Multi-tenant isolation is maintained with zero cross-tenant side effects across all verified transitions.
- **SC-005**: The verification suite executes end-to-end (setup, transition, verification, teardown) in under 5 minutes for a tenant with representative resource counts across all dimensions.
- **SC-006**: The verification suite runs as part of the CI pipeline, and any regression in plan transition behaviour causes a pipeline failure with a clear diagnostic report.
- **SC-007**: Every plan change verified by the suite produces an audit-correlated record that can be retrieved within 30 seconds of the transition completing.

## Assumptions

- Plans, quota dimensions, tenant plan assignments, and plan change history (T01–T04) are fully operational and available as prerequisites.
- The platform provides queryable APIs or data access paths for retrieving current resource counts per quota dimension per tenant.
- Over-limit conditions are advisory only at this stage; enforcement of restrictions or overage policies is the concern of T06 and future work.
- The verification suite does not enforce concurrency control on plan changes — it relies on the existing serialization guarantees provided by the plan assignment mechanism (T01/T03).
- Overrides (tenant-specific limit adjustments) are already supported by the plan model; the verification suite reads them but does not create or modify them.

## Out of Scope

- Enforcement of resource restrictions when a tenant is in an over-limit state (deferred to T06 and downstream policy work).
- Automated remediation of over-limit conditions (e.g., archiving workspaces, revoking API keys).
- Performance/load testing of plan transitions under high concurrency.
- UI/console integration for displaying verification results (the suite produces machine-readable output; console visualization is future work).
- Billing or financial impact calculation of plan transitions.
