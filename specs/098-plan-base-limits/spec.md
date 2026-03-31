# Feature Specification: Plan Base Limits Definition

**Feature Branch**: `098-plan-base-limits`  
**Created**: 2026-03-31  
**Status**: Draft  
**Input**: User description: "Definir límites base por plan para tenants, workspaces, Postgres, Mongo, Kafka, funciones, storage, API keys y membresías"  
**Task ID**: US-PLAN-01-T02  
**Epic**: EP-19 — Planes, límites y packaging del producto  
**Story**: US-PLAN-01 — Modelo de planes de producto y asignación a tenants  
**Depends on**: US-PLAN-01-T01 (097-plan-entity-tenant-assignment)

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Superadmin Defines Base Limits for a Product Plan (Priority: P1)

A superadmin configures the base resource limits for a product plan, specifying numeric thresholds for every quota dimension the platform supports: maximum workspaces per tenant, PostgreSQL databases, MongoDB databases, Kafka topics, serverless functions, storage capacity, API keys, and workspace memberships. These limits become the authoritative baseline that determines what resources a tenant on that plan is entitled to consume.

**Why this priority**: Without base limits attached to a plan, plans are empty commercial labels with no operational meaning. Defining limits is the first step toward quota enforcement and product differentiation between tiers.

**Independent Test**: Can be fully tested by creating a plan, defining base limits for all supported quota dimensions, and verifying that the limits are persisted, queryable, and correctly associated with the plan.

**Acceptance Scenarios**:

1. **Given** the `starter` plan exists in `draft` status, **When** the superadmin defines base limits including `max_workspaces: 3`, `max_pg_databases: 5`, `max_mongo_databases: 2`, `max_kafka_topics: 10`, `max_functions: 50`, `max_storage_bytes: 5368709120`, `max_api_keys: 20`, and `max_workspace_members: 10`, **Then** all limits are persisted and retrievable as part of the plan's quota dimensions.
2. **Given** the `professional` plan exists in `active` status with existing base limits, **When** the superadmin updates `max_workspaces` from `5` to `10`, **Then** the limit is updated, the change is auditable, and the new value is reflected immediately in queries for this plan's limits.
3. **Given** the superadmin attempts to define a limit with a dimension key that is not in the platform's recognized quota dimension catalog, **Then** the system rejects the request indicating the dimension key is invalid.

---

### User Story 2 — Superadmin Reviews and Compares Plan Limit Profiles (Priority: P1)

A superadmin or product operations user views the complete base limit profile for a plan — a summary of all quota dimensions and their values — to verify correctness, compare tiers, or prepare for commercial packaging decisions.

**Why this priority**: Visibility into the limit profile is essential for verifying that plan tiers are correctly differentiated and that limits make commercial sense before assigning plans to tenants.

**Independent Test**: Can be fully tested by querying the base limit profile for a plan and verifying all dimensions and values are returned, including dimensions where no explicit limit has been set (shown with their default behavior).

**Acceptance Scenarios**:

1. **Given** the `starter` plan has base limits defined for all quota dimensions, **When** the superadmin queries the plan's limit profile, **Then** the response includes every quota dimension with its key, display label, current value, and unit of measure.
2. **Given** the `enterprise` plan has no explicit limit set for `max_functions`, **When** the superadmin queries the plan's limit profile, **Then** the `max_functions` dimension appears with a clear indicator that it uses the platform default (or is unlimited if that is the default policy for the dimension).
3. **Given** the superadmin queries limit profiles for both `starter` and `professional` plans, **Then** the responses are structurally identical and can be compared dimension by dimension.

---

### User Story 3 — Tenant Owner Views Their Plan's Resource Limits (Priority: P2)

A tenant owner queries their current plan's base limits to understand what resource ceilings apply to their tenant. This allows them to plan resource usage, identify when they are approaching limits, and make informed decisions about requesting a plan upgrade.

**Why this priority**: Tenant self-service visibility is important for reducing support burden and enabling informed upgrade decisions, but it depends on limits being defined and assigned first.

**Independent Test**: Can be fully tested by authenticating as a tenant owner, querying the tenant's plan limits, and verifying the response includes all quota dimensions with their values.

**Acceptance Scenarios**:

1. **Given** tenant `acme-corp` is assigned the `professional` plan which has base limits defined, **When** the tenant owner queries their plan's limits, **Then** the response includes all quota dimensions with display-friendly labels, values, and units.
2. **Given** tenant `acme-corp` has no plan assigned, **When** the tenant owner queries their plan's limits, **Then** the response indicates no plan is assigned and no limits are defined.
3. **Given** the tenant owner for `acme-corp` queries plan limits, **Then** the response does NOT include limits from other tenants' plans or any internal-only metadata visible only to superadmins.

---

### User Story 4 — Platform Establishes a Recognized Quota Dimension Catalog (Priority: P1)

The platform maintains a well-defined catalog of recognized quota dimensions that any plan may reference. Each dimension has a unique key, a human-readable display label, a unit of measure, and a platform-wide default value. This catalog serves as the single source of truth for which resource types can be limited by plans.

**Why this priority**: A governed dimension catalog is foundational — without it, plans could define arbitrary and inconsistent dimension keys, making enforcement and comparison impossible.

**Independent Test**: Can be fully tested by querying the quota dimension catalog and verifying it includes all expected platform resource types with correct metadata.

**Acceptance Scenarios**:

1. **Given** the platform is initialized, **When** a superadmin queries the quota dimension catalog, **Then** the response includes at minimum the following dimensions: `max_workspaces`, `max_pg_databases`, `max_mongo_databases`, `max_kafka_topics`, `max_functions`, `max_storage_bytes`, `max_api_keys`, `max_workspace_members`.
2. **Given** each dimension in the catalog, **Then** it has a unique key, a display label (e.g., "Maximum Workspaces"), a unit of measure (e.g., "count", "bytes"), and a platform default value.
3. **Given** the catalog is used for plan limit validation, **When** a superadmin attempts to set a limit using a key not present in the catalog, **Then** the operation is rejected with a descriptive error.

---

### User Story 5 — Superadmin Manages Limit Values During Plan Lifecycle (Priority: P2)

A superadmin can add, modify, or remove individual limit values from a plan at different stages of the plan lifecycle. Limits can be freely modified on `draft` plans. On `active` plans, modifications are permitted but every change is audited. On `deprecated` or `archived` plans, limit modifications are blocked.

**Why this priority**: Lifecycle-aware limit management ensures operational discipline — active plans can be tuned for commercial needs while deprecated plans remain frozen for auditability.

**Independent Test**: Can be fully tested by attempting limit modifications on plans in each lifecycle state and verifying that the correct permission/rejection behavior and audit trail are produced.

**Acceptance Scenarios**:

1. **Given** a plan in `draft` status, **When** the superadmin adds, updates, or removes a base limit, **Then** the change is persisted without restriction.
2. **Given** a plan in `active` status, **When** the superadmin updates a base limit value, **Then** the change is persisted and an audit event is emitted recording the previous value, new value, actor, and timestamp.
3. **Given** a plan in `deprecated` status, **When** the superadmin attempts to modify a base limit, **Then** the system rejects the change, indicating that limits on deprecated plans are frozen.
4. **Given** a plan in `archived` status, **When** the superadmin attempts to modify a base limit, **Then** the system rejects the change.

---

### Edge Cases

- What happens when a plan has no base limits defined for any dimension? The plan is valid but effectively grants only platform defaults for all dimensions. Tenants on this plan inherit the default value for every quota dimension.
- What happens when a base limit value is set to zero? A zero value means the tenant is explicitly allocated no capacity for that dimension. This is distinct from "not set" (which inherits the platform default) and from "unlimited."
- What happens when the platform default for a dimension changes after plans have been created? Plans with explicitly set values for that dimension are unaffected. Plans relying on the platform default will reflect the new default upon next query. This behavior must be clearly documented.
- What happens when a superadmin sets a limit lower than what a tenant is already consuming? The limit is accepted and persisted — limit definition is a metadata operation. Enforcement (blocking further creation, warning, or grace periods) is the responsibility of downstream quota enforcement features (US-PLAN-02).
- How is "unlimited" represented? A dimension can be marked as unlimited by using a sentinel value (e.g., `-1` or `null` with explicit semantics). The representation must be unambiguous and consistent across all query interfaces.
- What happens when a quota dimension is added to the catalog after plans already exist? Existing plans do not automatically get a value for the new dimension — they inherit the platform default until a superadmin explicitly sets a value.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST maintain a **quota dimension catalog** — a governed registry of all recognized resource types that plans may define limits for. Each catalog entry has: a unique dimension key, a display label, a unit of measure (e.g., `count`, `bytes`), and a platform-wide default value.
- **FR-002**: The initial quota dimension catalog MUST include at minimum the following dimensions:
  - `max_workspaces` — Maximum workspaces per tenant (count)
  - `max_pg_databases` — Maximum PostgreSQL databases per tenant (count)
  - `max_mongo_databases` — Maximum MongoDB databases per tenant (count)
  - `max_kafka_topics` — Maximum Kafka topics per tenant (count)
  - `max_functions` — Maximum serverless functions per tenant (count)
  - `max_storage_bytes` — Maximum object storage capacity per tenant (bytes)
  - `max_api_keys` — Maximum API keys per tenant (count)
  - `max_workspace_members` — Maximum members per workspace (count)
- **FR-003**: The system MUST allow superadmins to define, update, and remove base limit values for each quota dimension on a plan. Each base limit is a mapping from a dimension key to a numeric value.
- **FR-004**: The system MUST validate that every dimension key used in a plan's base limits exists in the quota dimension catalog. Attempts to set limits for unrecognized dimension keys MUST be rejected with a descriptive error.
- **FR-005**: Base limits on plans in `draft` status MAY be freely added, modified, or removed without audit event emission. Base limits on plans in `active` status MAY be modified, but every change MUST emit an audit event recording the dimension key, previous value, new value, actor, and timestamp.
- **FR-006**: Base limits on plans in `deprecated` or `archived` status MUST NOT be modifiable. Modification attempts MUST be rejected.
- **FR-007**: When a plan does not define an explicit base limit for a given dimension, the platform default value from the quota dimension catalog applies. Queries for a plan's limit profile MUST indicate which values are explicitly set versus inherited from the platform default.
- **FR-008**: The system MUST support a sentinel representation for "unlimited" on any dimension, clearly distinguishable from zero, from a positive numeric limit, and from "not set" (platform default).
- **FR-009**: The system MUST expose a read-only contract for retrieving the complete base limit profile of a plan, including all recognized dimensions with their effective values (explicit or default), display labels, units, and an indication of whether each value is explicit or inherited.
- **FR-010**: The system MUST expose a read-only contract for tenant owners to query the base limit profile of their currently assigned plan. The response MUST include all dimensions with display-friendly labels, values, and units, and MUST NOT include internal metadata or limits from other tenants' plans.
- **FR-011**: Every base limit mutation on an `active` plan MUST emit an auditable event containing: plan identifier, dimension key, previous value, new value, actor identifier, timestamp, and correlation ID.
- **FR-012**: The quota dimension catalog MUST be extensible — new dimensions can be added over time without requiring changes to existing plans. Existing plans without an explicit value for a new dimension inherit the platform default.
- **FR-013**: All base limit operations MUST respect multi-tenant isolation: tenant owners can only view limits for their own plan; superadmins can view and manage limits for any plan.
- **FR-014**: Base limit values MUST be non-negative integers, or the sentinel value representing "unlimited." The system MUST reject negative values (other than the "unlimited" sentinel) and non-integer values.
- **FR-015**: The system MUST expose a read-only contract for querying the quota dimension catalog itself, returning all recognized dimensions with their keys, labels, units, and platform default values.

### Key Entities

- **Quota Dimension Catalog Entry**: Represents a recognized resource type that can be limited by plans. Contains: dimension key (unique, e.g., `max_workspaces`), display label (e.g., "Maximum Workspaces"), unit of measure (`count` or `bytes`), platform default value. Serves as the controlled vocabulary for plan limits.
- **Plan Base Limit**: Represents the explicitly configured value for a single quota dimension on a specific plan. Contains: plan reference, dimension key (must exist in the catalog), numeric value (non-negative integer or unlimited sentinel). Together, a plan's set of base limits forms its limit profile.
- **Plan Limit Profile**: A computed view that combines a plan's explicit base limits with catalog defaults for any dimensions not explicitly set. Used for display and comparison purposes. Not a stored entity — derived at query time.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A superadmin can define base limits for all recognized quota dimensions on a plan in a single session, with each limit operation completing in under 5 seconds.
- **SC-002**: The complete base limit profile for any plan is retrievable in a single query and includes all recognized dimensions with their effective values, regardless of how many are explicitly set versus defaulted.
- **SC-003**: A tenant owner can view their current plan's base limits with display-friendly labels and units, with no visibility into other tenants' plan information.
- **SC-004**: 100% of base limit changes on active plans produce an auditable event that includes the previous value, new value, actor, and timestamp.
- **SC-005**: Attempts to set limits using unrecognized dimension keys are rejected 100% of the time with a descriptive error message referencing the quota dimension catalog.
- **SC-006**: Plans in `deprecated` or `archived` status reject all base limit modification attempts.
- **SC-007**: The quota dimension catalog supports at least 50 dimension entries and the system supports at least 100 plans, each with explicit values for all dimensions, without degradation in query response times.

## Assumptions

- The plan entity, lifecycle management, and assignment model from US-PLAN-01-T01 (097-plan-entity-tenant-assignment) are already in place. This task extends plans with structured, governed base limits.
- The quota dimensions defined in FR-002 represent the initial set. The catalog is designed to grow as new platform capabilities are added.
- "Platform default" values for each dimension are configured once and apply globally. They represent what a plan grants when no explicit limit is set. The initial default values will be determined during implementation planning.
- Base limit definition is a metadata operation only. Enforcement of limits against actual resource consumption is out of scope (US-PLAN-02 and beyond).
- The "unlimited" sentinel is a single well-known value consistently interpreted across all contracts and queries. The specific representation (e.g., `-1` or `null`) will be decided during planning.
- Overrides per tenant (granting a specific tenant more or fewer resources than their plan specifies) are out of scope for this task and will be addressed in a subsequent task.
- The audit event schema for limit changes follows the same conventions established in US-PLAN-01-T01 (correlation-id, actor, tenant context when applicable, timestamp).
- The existing `plans` table from T01 already stores `quota_dimensions` as a JSONB map. This task may extend or formalize that structure but does not alter the plan entity's core design.

## Scope Boundaries

### In Scope

- Quota dimension catalog: definition, governance, and queryability
- Base limit CRUD on plans (per dimension, lifecycle-aware)
- Read-only limit profile query for plans (superadmin)
- Read-only limit profile query for tenant owners (own plan only)
- Audit event emission for limit changes on active plans
- Validation against the quota dimension catalog
- "Unlimited" and "not set / platform default" semantics
- Multi-tenant isolation for limit visibility

### Out of Scope

- Quota enforcement against actual resource consumption (US-PLAN-02)
- Hard vs soft limit distinction and grace periods (US-PLAN-02)
- Per-tenant overrides beyond the plan's base limits (future task)
- API and console UI implementation (US-PLAN-01-T03)
- Historical impact analysis of limit changes on tenant quotas (US-PLAN-01-T04)
- Upgrade/downgrade testing with existing resources (US-PLAN-01-T05)
- Transition policy documentation and overage handling (US-PLAN-01-T06)
- Billing integration or usage metering
