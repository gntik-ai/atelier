# Feature Specification: Plan Entity & Tenant Plan Assignment

**Feature Branch**: `097-plan-entity-tenant-assignment`  
**Created**: 2026-03-31  
**Status**: Draft  
**Input**: User description: "Diseñar entidad plan y contratos para asignación/cambio de plan por tenant"  
**Task ID**: US-PLAN-01-T01  
**Epic**: EP-19 — Planes, límites y packaging del producto  
**Story**: US-PLAN-01 — Modelo de planes de producto y asignación a tenants

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Superadmin Creates a Product Plan (Priority: P1)

A superadmin defines a new product plan in the platform catalog, giving it a unique slug, display name, description, lifecycle status, and a set of declared capabilities and quota dimensions. The plan becomes available for assignment to tenants once it transitions to `active` status.

**Why this priority**: Without at least one plan defined in the catalog, no tenant can be assigned a plan. This is the foundational data that every subsequent plan-related feature depends on.

**Independent Test**: Can be fully tested by creating a plan via the control API and verifying it appears in the plan catalog with the correct attributes, status, and audit trail.

**Acceptance Scenarios**:

1. **Given** the superadmin is authenticated and authorized, **When** they create a plan with slug `starter`, display name "Starter", and status `draft`, **Then** the system persists the plan and returns its unique identifier, slug, and status.
2. **Given** a plan exists in `draft` status, **When** the superadmin transitions it to `active`, **Then** the plan becomes eligible for tenant assignment and an audit event is recorded.
3. **Given** a plan with slug `starter` already exists, **When** the superadmin attempts to create another plan with the same slug, **Then** the system rejects the request with a conflict error.

---

### User Story 2 - Superadmin Assigns a Plan to a Tenant (Priority: P1)

A superadmin assigns an active product plan to an existing tenant. The assignment is recorded with an effective timestamp, the previous plan (if any) is superseded, and the change is fully auditable. The tenant's effective capabilities and quota dimensions are immediately derivable from the newly assigned plan.

**Why this priority**: Plan assignment is the mechanism that connects commercial packaging to tenant behavior. Without it, plans are inert catalog entries with no operational effect.

**Independent Test**: Can be fully tested by assigning a plan to a tenant, querying the tenant's current plan, and verifying the assignment metadata including effective date and audit trail.

**Acceptance Scenarios**:

1. **Given** tenant `acme-corp` exists with no plan assigned, **When** the superadmin assigns the `starter` plan to `acme-corp`, **Then** the assignment is persisted with the current timestamp as `effective_from`, the tenant's current plan resolves to `starter`, and an audit event is emitted.
2. **Given** tenant `acme-corp` is already assigned the `starter` plan, **When** the superadmin assigns the `professional` plan, **Then** the previous assignment is superseded (not deleted), the new assignment becomes current, and both assignments remain queryable in the tenant's plan history.
3. **Given** the plan `enterprise` is in `draft` status, **When** the superadmin attempts to assign it to a tenant, **Then** the system rejects the request because only `active` plans may be assigned.

---

### User Story 3 - Tenant Owner Views Assigned Plan (Priority: P2)

A tenant owner queries their tenant's currently assigned plan to understand which product tier they are on, what capabilities are declared, and what quota dimensions are defined at the plan level.

**Why this priority**: Tenant owners need visibility into their plan to understand their product boundaries. This is essential for self-service but secondary to plan creation and assignment.

**Independent Test**: Can be fully tested by authenticating as a tenant owner, querying the tenant's plan, and verifying the response includes plan metadata, capabilities, and quota dimensions.

**Acceptance Scenarios**:

1. **Given** tenant `acme-corp` is assigned the `professional` plan, **When** the tenant owner queries the current plan, **Then** the response includes the plan slug, display name, description, capabilities list, and quota dimensions with their plan-level values.
2. **Given** tenant `acme-corp` has no plan assigned, **When** the tenant owner queries the current plan, **Then** the response clearly indicates no plan is assigned.

---

### User Story 4 - Superadmin Queries Plan History for a Tenant (Priority: P2)

A superadmin or authorized platform operator retrieves the full history of plan assignments for a specific tenant, including effective dates, superseded timestamps, and the actor who made each change.

**Why this priority**: Auditability and traceability of plan changes are critical for finance, compliance, and dispute resolution, but depend on the assignment mechanism being in place first.

**Independent Test**: Can be fully tested by performing multiple plan changes on a tenant and verifying that the full ordered history is returned with correct timestamps and actor information.

**Acceptance Scenarios**:

1. **Given** tenant `acme-corp` has been assigned `starter`, then `professional`, then `enterprise`, **When** the superadmin queries plan history, **Then** the response returns all three assignments in chronological order with `effective_from`, `superseded_at`, and `assigned_by` for each.

---

### User Story 5 - Superadmin Manages Plan Lifecycle (Priority: P3)

A superadmin updates plan metadata (display name, description) and manages plan lifecycle transitions (`draft` → `active` → `deprecated` → `archived`). Deprecating a plan prevents new assignments but does not affect existing tenants. Archiving a plan is only allowed when no tenant has it as their current assignment.

**Why this priority**: Plan lifecycle management enables catalog evolution over time but is only needed once the basic plan entity and assignment flow work.

**Independent Test**: Can be fully tested by transitioning a plan through its lifecycle states and verifying that assignment constraints are enforced at each state.

**Acceptance Scenarios**:

1. **Given** a plan in `active` status, **When** the superadmin transitions it to `deprecated`, **Then** the plan remains visible in the catalog, existing tenant assignments are unaffected, but new assignments of this plan are rejected.
2. **Given** a plan in `deprecated` status with no current tenant assignments, **When** the superadmin transitions it to `archived`, **Then** the plan is no longer visible in the default catalog listing.
3. **Given** a plan in `deprecated` status with one or more tenants still assigned, **When** the superadmin attempts to archive it, **Then** the system rejects the transition and lists the tenants still on this plan.

---

### Edge Cases

- What happens when a tenant's currently assigned plan is deprecated? The tenant retains the assignment — deprecation only blocks new assignments, not existing ones.
- What happens when the superadmin attempts to delete a plan? Plans are never hard-deleted; they follow the lifecycle (`draft` → `active` → `deprecated` → `archived`). An `archived` plan is logically removed but data is retained for audit.
- What happens when two superadmins attempt to assign different plans to the same tenant concurrently? The system must enforce serialized plan assignment per tenant to prevent conflicting state; one request succeeds and the other receives a conflict or retry error.
- What happens when a plan is created without any capabilities or quota dimensions? The plan is valid — capabilities and quota dimensions are optional at creation and can be added incrementally. An empty plan simply grants no declared capabilities and no quota dimensions.
- What happens when the platform has no plans defined yet? Tenants can exist without a plan assignment. The system does not require a plan for tenant operation at this stage; plan enforcement is the responsibility of downstream quota and capability enforcement features (US-PLAN-01-T02 and beyond).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST support a **plan** entity with the following attributes: unique identifier, slug (unique, URL-safe), display name, description, lifecycle status, capabilities declaration, quota dimensions declaration, creation timestamp, and last-modified timestamp.
- **FR-002**: Plan lifecycle status MUST follow the state machine: `draft` → `active` → `deprecated` → `archived`. Only forward transitions are allowed; no state may transition backward.
- **FR-003**: The system MUST enforce slug uniqueness across all plans regardless of lifecycle status.
- **FR-004**: The system MUST support a **plan assignment** entity that records: tenant identifier, plan identifier, effective-from timestamp, superseded-at timestamp (null for current), assigned-by actor identifier, and assignment metadata.
- **FR-005**: Each tenant MUST have at most one current (non-superseded) plan assignment at any point in time.
- **FR-006**: When a new plan is assigned to a tenant, the system MUST atomically supersede the previous assignment (setting `superseded_at`) and create the new assignment in a single transaction.
- **FR-007**: Only plans in `active` status MAY be assigned to tenants. Assignments to `draft`, `deprecated`, or `archived` plans MUST be rejected.
- **FR-008**: The system MUST NOT allow archiving a plan that is the current assignment of any tenant. The system MUST return the list of blocking tenants in the error response.
- **FR-009**: Deprecating a plan MUST prevent new assignments but MUST NOT affect existing tenant assignments.
- **FR-010**: The system MUST expose read-only contracts for tenants to query their own current plan assignment, including plan metadata, capabilities, and quota dimensions.
- **FR-011**: The system MUST expose contracts for superadmins to query the full plan assignment history for any tenant.
- **FR-012**: Every plan creation, update, lifecycle transition, and assignment/reassignment MUST emit an auditable event containing actor, tenant (when applicable), action, timestamp, previous state, and new state.
- **FR-013**: Plan capabilities MUST be declared as a set of named boolean flags (e.g., `realtime_enabled`, `webhooks_enabled`). The plan entity defines which capabilities exist; enforcement is out of scope for this task.
- **FR-014**: Plan quota dimensions MUST be declared as a set of named numeric values with a dimension key and a plan-level value (e.g., `max_workspaces: 5`, `max_pg_databases: 10`). Enforcement is out of scope for this task.
- **FR-015**: The system MUST support updating plan metadata (display name, description) and modifying capabilities/quota dimensions for plans in `draft` or `active` status. Changes to active plans MUST be audited but do NOT retroactively modify existing tenant assignments — tenants see the plan's current state.
- **FR-016**: All plan and assignment operations MUST respect multi-tenant isolation. A tenant owner can only read their own plan; a superadmin can read and manage all plans and assignments.
- **FR-017**: The system MUST support listing all plans in the catalog with filtering by lifecycle status, and with pagination.

### Key Entities

- **Plan**: Represents a commercial/technical product tier. Identified by a unique ID and a unique slug. Contains display name, description, lifecycle status, a map of capability flags (boolean), and a map of quota dimensions (numeric). Immutable once archived.
- **Plan Assignment**: Represents the association between a tenant and a plan at a point in time. Contains tenant reference, plan reference, effective-from timestamp, superseded-at timestamp, and the actor who made the assignment. Supports historical querying.
- **Plan Audit Event**: An immutable record of every mutation to plans and assignments. Contains actor, action type, target entity, previous and new state, timestamp, and correlation ID.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A superadmin can create, update, and transition a product plan through its full lifecycle in under 30 seconds per operation.
- **SC-002**: A superadmin can assign or change a tenant's plan in a single operation, with the change reflected immediately in subsequent queries.
- **SC-003**: The full plan assignment history for any tenant is retrievable with correct chronological ordering and complete actor/timestamp metadata.
- **SC-004**: 100% of plan and assignment mutations produce an auditable event that is queryable by actor, tenant, action type, and time range.
- **SC-005**: No tenant can view or access plan information belonging to another tenant.
- **SC-006**: Concurrent plan assignment attempts for the same tenant are serialized — exactly one succeeds and the other fails gracefully without data corruption.
- **SC-007**: The plan catalog supports at least 100 plans and 10,000 tenant assignments without degradation in query response times.

## Assumptions

- The domain model for `tenant` already exists and provides a stable tenant identifier (dependency on US-DOM-02 is satisfied).
- Capabilities and quota dimensions defined in a plan are declarative metadata at this stage. Actual enforcement of limits and feature gating is handled by downstream tasks (US-PLAN-01-T02 through US-PLAN-01-T06 and US-PLAN-02).
- Plan assignment does not trigger any automated provisioning or deprovisioning of resources. It is a metadata operation only. Resource-level impact is the responsibility of quota enforcement features.
- The `superadmin` role is the only role authorized to create plans and assign them to tenants. Tenant owners have read-only access to their own plan.
- The audit event schema aligns with the platform's existing audit pipeline conventions (correlation-id, actor, tenant, timestamp pattern).
- Plan slugs follow the platform's standard slug conventions (lowercase alphanumeric with hyphens, max 64 characters).

## Scope Boundaries

### In Scope

- Plan entity design (attributes, lifecycle, constraints)
- Plan assignment and reassignment contracts
- Plan catalog listing with status filtering
- Tenant's own plan query contract
- Plan assignment history query contract
- Audit event emission for all mutations
- Capability and quota dimension declaration on plans (schema only)
- Multi-tenant isolation for plan reads

### Out of Scope

- Quota enforcement based on plan limits (US-PLAN-01-T02)
- API and console implementation for plan management (US-PLAN-01-T03)
- Historical impact analysis of plan changes on effective quotas (US-PLAN-01-T04)
- Upgrade/downgrade testing with existing resources (US-PLAN-01-T05)
- Transition policy documentation and overage handling (US-PLAN-01-T06)
- Hard/soft quota distinction and override mechanism (US-PLAN-02)
- Billing integration or payment-related plan gating
