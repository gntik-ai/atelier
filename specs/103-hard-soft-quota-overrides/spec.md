# Feature Specification: Hard & Soft Quotas with Superadmin Override

**Feature Branch**: `103-hard-soft-quota-overrides`  
**Created**: 2026-03-31  
**Status**: Draft  
**Input**: User description: "Implementar cuotas hard y soft por plan y posibilidad de override excepcional por superadmin"  
**Task ID**: US-PLAN-02-T01  
**Epic**: EP-19 — Planes, límites y packaging del producto  
**Story**: US-PLAN-02 — Hard/soft quotas, capabilities booleanas, overrides y visualización de consumo  
**Depends on**: US-PLAN-01 (097–102), US-OBS-03 (metering infrastructure)

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Superadmin Classifies Each Quota Dimension as Hard or Soft per Plan (Priority: P1)

A superadmin configures each quota dimension within a plan to behave as either a **hard limit** or a **soft limit**. A hard limit blocks resource creation outright when the tenant reaches the threshold. A soft limit allows the tenant to temporarily exceed the threshold (within a configurable grace margin) but emits a warning event and may trigger degraded-service policies. By default, all quota dimensions are treated as hard limits unless explicitly configured otherwise.

**Why this priority**: Distinguishing hard from soft limits is the foundational behavior change this task introduces. Without it, the platform can only block — it cannot warn, grace, or differentiate enforcement severity per dimension.

**Independent Test**: Can be fully tested by configuring a plan with one hard-limited dimension and one soft-limited dimension, then attempting to exceed each and verifying the hard limit blocks while the soft limit allows with a warning.

**Acceptance Scenarios**:

1. **Given** the `starter` plan has `max_workspaces` configured as a hard limit with value `3`, **When** a tenant on this plan attempts to create a 4th workspace, **Then** the creation is blocked and the response clearly indicates the hard quota has been reached.
2. **Given** the `professional` plan has `max_kafka_topics` configured as a soft limit with value `20` and grace margin `5` (i.e., up to 25 total), **When** a tenant creates a 21st topic, **Then** the creation succeeds, a `quota.soft_limit.exceeded` event is emitted to Kafka, and the API response includes a warning header indicating the tenant is in the grace zone.
3. **Given** the `professional` plan has `max_kafka_topics` as a soft limit with value `20` and grace margin `5`, **When** a tenant attempts to create a 26th topic, **Then** the creation is blocked because even the grace margin is exhausted.
4. **Given** a plan has a dimension with no explicit quota type configured, **When** the enforcement engine evaluates that dimension, **Then** it defaults to hard limit behavior.

---

### User Story 2 — Superadmin Creates a Quota Override for a Specific Tenant (Priority: P1)

A superadmin grants an exceptional quota override to a specific tenant, allowing them to exceed the base plan limit for one or more quota dimensions. Overrides are always tenant-scoped (not workspace-scoped), always require a justification, and are auditable. An override can raise or lower the effective limit for a dimension, and can optionally carry an expiration date after which the override ceases to apply.

**Why this priority**: Overrides are essential for handling commercial exceptions, key customers, trial extensions, and operational edge cases without creating custom plans for each tenant.

**Independent Test**: Can be fully tested by creating a tenant override for a dimension, verifying the effective limit changes, and confirming the override is auditable with justification.

**Acceptance Scenarios**:

1. **Given** tenant `acme-corp` is on the `starter` plan with `max_pg_databases: 5` (hard), **When** a superadmin creates an override setting `max_pg_databases` to `10` for `acme-corp` with justification "Enterprise pilot, approved by VP Sales", **Then** the effective limit for this tenant becomes `10` and the override is persisted with actor, timestamp, and justification.
2. **Given** tenant `acme-corp` has an active override for `max_pg_databases` set to `10`, **When** a superadmin queries the effective limits for `acme-corp`, **Then** the response shows `max_pg_databases: 10` with an indicator that this value comes from an override (not the base plan).
3. **Given** a superadmin attempts to create an override without providing a justification, **Then** the request is rejected indicating that justification is mandatory.
4. **Given** tenant `acme-corp` has an override for `max_storage_bytes` with an expiration date of `2026-04-15`, **When** the current date passes `2026-04-15`, **Then** the override is no longer applied and the effective limit reverts to the base plan value.
5. **Given** a superadmin creates two overrides for the same tenant and dimension, **Then** only one active override per tenant per dimension is permitted; the new override supersedes the previous one, and the previous is marked as superseded with an audit record.

---

### User Story 3 — Superadmin Revokes or Modifies an Existing Override (Priority: P2)

A superadmin can revoke an active override, returning a tenant to their plan's base limit for that dimension, or modify an existing override (changing the value, quota type classification, or expiration). Every modification or revocation is audited.

**Why this priority**: Lifecycle management of overrides is necessary to avoid permanent exceptions accumulating without governance. Revocation is the complement of creation.

**Independent Test**: Can be fully tested by creating an override, then revoking it and verifying the effective limit reverts to the plan baseline, with a full audit trail.

**Acceptance Scenarios**:

1. **Given** tenant `acme-corp` has an active override for `max_functions` set to `200`, **When** a superadmin revokes the override with justification "Pilot concluded", **Then** the effective limit reverts to the base plan value and the revocation is audited with actor, timestamp, and justification.
2. **Given** tenant `acme-corp` has an active override for `max_api_keys` set to `100` expiring `2026-06-01`, **When** a superadmin modifies the override to set the value to `150` and extend expiration to `2026-09-01`, **Then** the modification is persisted, the previous state is captured in the audit record, and the new effective limit is immediately `150`.
3. **Given** a superadmin queries all active overrides across all tenants, **Then** the system returns a paginated list showing tenant, dimension, override value, quota type, expiration (if any), creation date, and actor.

---

### User Story 4 — System Applies Hard vs Soft Enforcement at Resource Creation Time (Priority: P1)

When any resource creation request reaches the enforcement layer, the system resolves the effective limit for the relevant quota dimension (base plan value, overridden by any active override), determines whether the dimension is hard or soft, and applies the correct enforcement behavior. Hard dimensions block. Soft dimensions allow within the grace margin and emit warning events.

**Why this priority**: This is the runtime behavior that makes the hard/soft distinction meaningful. Without enforcement, the classification is metadata with no operational effect.

**Independent Test**: Can be fully tested by simulating resource creation against hard-limited and soft-limited dimensions at, near, and beyond their thresholds and verifying correct allow/block/warn behavior.

**Acceptance Scenarios**:

1. **Given** a tenant's effective limit for `max_workspaces` is `3` (hard, no override), **When** the tenant has 3 workspaces and requests a 4th, **Then** the request is rejected with error code `QUOTA_HARD_LIMIT_REACHED` and a message identifying the dimension and current/maximum values.
2. **Given** a tenant's effective limit for `max_mongo_databases` is `5` (soft, grace margin `2`), **When** the tenant has 5 databases and requests a 6th, **Then** the request succeeds, the response includes a `X-Quota-Warning` header, and a `quota.soft_limit.exceeded` event is emitted to Kafka.
3. **Given** a tenant's effective limit for `max_mongo_databases` is `5` (soft, grace margin `2`), **When** the tenant has 7 databases and requests an 8th, **Then** the request is rejected with error code `QUOTA_SOFT_LIMIT_GRACE_EXHAUSTED`.
4. **Given** a tenant has an override raising `max_functions` from `50` to `200`, **When** the tenant has 100 functions and requests another, **Then** the enforcement uses the override value `200` as the effective limit and the request succeeds.
5. **Given** a dimension is configured as unlimited (`-1`), **When** the tenant requests resource creation, **Then** no quota check is performed for that dimension.

---

### User Story 5 — Audit Trail for All Quota and Override Operations (Priority: P2)

Every operation that creates, modifies, revokes, or expires a quota override, and every enforcement decision (block or grace-allow), is recorded as an auditable event. The audit trail is queryable by tenant, by dimension, by actor, and by time range.

**Why this priority**: Auditability is a cross-cutting governance requirement for all quota operations. It supports compliance, dispute resolution, and operational visibility.

**Independent Test**: Can be fully tested by performing override CRUD and enforcement decisions, then querying the audit trail and verifying complete records exist for each operation.

**Acceptance Scenarios**:

1. **Given** a superadmin creates an override for tenant `acme-corp`, **When** the audit trail is queried for `acme-corp`, **Then** the record includes actor identity, timestamp, dimension, previous effective value, new override value, justification, and expiration (if set).
2. **Given** a tenant hits a hard limit and resource creation is blocked, **When** the audit/event trail is queried, **Then** a `quota.hard_limit.blocked` event exists with tenant, workspace, dimension, attempted action, current usage, and effective limit.
3. **Given** a tenant enters the soft limit grace zone, **When** the audit/event trail is queried, **Then** a `quota.soft_limit.exceeded` event exists with tenant, dimension, current usage, base limit, grace margin, and effective ceiling.

---

### Edge Cases

- What happens when an override raises a limit above what the infrastructure can physically support? The system accepts the override but infrastructure-level failures (e.g., PostgreSQL max connections) are handled independently by the service adapter and reported as infrastructure errors, not quota errors.
- What happens when a plan is changed (upgrade/downgrade) while an override is active? Overrides remain active and are re-evaluated against the new plan's base limits. The override value itself does not change; the effective limit is always `max(base_plan, override)` for raises or the override value for explicit lowering.
- What happens when two concurrent override creation requests arrive for the same tenant and dimension? Only one succeeds; the system uses optimistic concurrency or `INSERT ... ON CONFLICT` semantics to ensure exactly one active override per tenant per dimension.
- What happens when a soft limit grace margin is set to `0`? The dimension behaves identically to a hard limit (no grace allowed), but the classification still records it as soft for reporting purposes.
- What happens to enforcement when the metering system is temporarily unavailable? Enforcement fails closed — resource creation is blocked with a transient error, not silently allowed. The error message distinguishes this from a quota block.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST support classifying each quota dimension within a plan as either `hard` or `soft`.
- **FR-002**: Hard-limited dimensions MUST block resource creation when current usage meets or exceeds the effective limit.
- **FR-003**: Soft-limited dimensions MUST allow resource creation within a configurable grace margin beyond the base limit, emitting a warning event for each creation that exceeds the base limit.
- **FR-004**: Soft-limited dimensions MUST block resource creation when current usage meets or exceeds the base limit plus the grace margin.
- **FR-005**: Each plan's quota dimensions MUST default to hard limit behavior when no explicit quota type is configured.
- **FR-006**: The grace margin for soft-limited dimensions MUST be configurable per dimension per plan, expressed as an absolute count (not a percentage).
- **FR-007**: The system MUST support creating per-tenant quota overrides that raise or lower the effective limit for any recognized quota dimension.
- **FR-008**: Each override MUST include a mandatory justification text provided by the superadmin at creation time.
- **FR-009**: Each override MUST be associated with exactly one tenant and one quota dimension.
- **FR-010**: Only one active override per tenant per dimension is permitted at any time. Creating a new override for the same tenant and dimension supersedes the previous one.
- **FR-011**: Overrides MUST support an optional expiration timestamp. Once expired, the override ceases to affect the effective limit.
- **FR-012**: A periodic or on-demand expiry sweep MUST exist to transition expired overrides from active to expired status.
- **FR-013**: The system MUST support revoking an active override, returning the tenant to their base plan limit for that dimension.
- **FR-014**: The system MUST support modifying an active override (value, quota type, expiration) with full audit trail of the previous and new state.
- **FR-015**: The effective limit for any dimension MUST be resolved as: override value (if active override exists) > base plan value (from `plans.quota_dimensions`) > platform default (from `quota_dimension_catalog`).
- **FR-016**: Every override creation, modification, revocation, and expiration MUST be recorded as an audit event with actor, timestamp, tenant, dimension, previous state, new state, and justification.
- **FR-017**: Every enforcement decision (block or grace-allow) MUST emit a Kafka event with tenant, workspace, dimension, current usage, effective limit, and decision.
- **FR-018**: The system MUST provide a query API for listing all active overrides, filterable by tenant and dimension.
- **FR-019**: The system MUST provide a query API for a specific tenant's effective limits (resolved from plan + overrides + catalog defaults), clearly indicating the source of each limit value (plan, override, or platform default).
- **FR-020**: Only superadmin actors MUST be permitted to create, modify, or revoke overrides.
- **FR-021**: All override and enforcement data MUST be scoped by tenant, ensuring no cross-tenant data leakage.
- **FR-022**: The system MUST handle the unlimited sentinel (`-1`) correctly: unlimited dimensions skip quota checks entirely.

### Key Entities

- **Quota Override**: A per-tenant, per-dimension exception to the base plan limit. Carries a value, quota type classification (hard/soft), optional grace margin, optional expiration, mandatory justification, lifecycle status (active, superseded, revoked, expired), and full audit metadata.
- **Quota Type Configuration**: The per-dimension, per-plan classification of a quota dimension as hard or soft, with an associated grace margin for soft limits. Stored as part of the plan's quota metadata.
- **Enforcement Decision**: A runtime evaluation that resolves the effective limit and quota type for a given tenant and dimension, then allows or blocks the requested resource creation accordingly.
- **Effective Limit Resolution**: The computed result of merging platform catalog defaults, plan base limits, and tenant-specific overrides for a given dimension.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Superadmins can classify any quota dimension as hard or soft per plan and the enforcement behavior matches the classification within the same operational cycle.
- **SC-002**: A tenant hitting a hard limit receives an immediate, clear rejection — no resource is created and no side effects occur.
- **SC-003**: A tenant exceeding a soft limit but within the grace margin receives the resource successfully along with a visible warning, and a downstream alert event is generated.
- **SC-004**: Superadmins can create, modify, and revoke per-tenant overrides with mandatory justification, and the change takes effect immediately for subsequent enforcement checks.
- **SC-005**: Every override lifecycle event and every enforcement decision is captured in the audit trail and queryable within 30 seconds of occurrence.
- **SC-006**: The effective limit resolution correctly reflects the override > plan > catalog default hierarchy in all query responses.
- **SC-007**: Expired overrides cease to affect enforcement within one sweep cycle (configurable, default ≤ 5 minutes) of their expiration timestamp.
- **SC-008**: No cross-tenant data leakage occurs: a tenant's override, usage, and enforcement data is invisible to other tenants.

## Assumptions

- The metering infrastructure (US-OBS-03) provides near-real-time usage counters per tenant per dimension that the enforcement layer can query synchronously during resource creation.
- The `plans` table and `quota_dimension_catalog` table from specs 097 and 098 are deployed and populated before this feature is activated.
- The existing `plan_audit_events` table and Kafka audit pipeline from previous plan specs (097–102) are available for extension with new event types.
- Override justification text is free-form with a reasonable maximum length (e.g., 1000 characters) and is not structured or validated beyond presence.
- Grace margin is expressed as an absolute count in the same unit as the dimension (count or bytes), not as a percentage.

## Scope Boundaries

### In scope

- Hard/soft quota type classification per dimension per plan.
- Grace margin configuration for soft limits.
- Per-tenant quota override CRUD with justification, optional expiration, and audit.
- Effective limit resolution (override > plan > catalog default).
- Enforcement behavior at resource creation (block for hard, warn-and-allow for soft within grace, block beyond grace).
- Kafka events for enforcement decisions and override lifecycle.
- Query APIs for overrides and effective limits.

### Out of scope

- Boolean capabilities per plan (US-PLAN-02-T02).
- Effective limit calculation combining workspace-level sub-quotas (US-PLAN-02-T03).
- Console visualization of limits and consumption (US-PLAN-02-T04).
- Gateway/UI enforcement of capabilities (US-PLAN-02-T05).
- End-to-end enforcement tests across all services (US-PLAN-02-T06).
- Per-workspace override granularity (future consideration).
- Automatic override creation based on billing or CRM triggers (future consideration).
