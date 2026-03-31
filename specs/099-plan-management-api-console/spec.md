# Feature Specification: Plan Management API & Console

**Feature Branch**: `099-plan-management-api-console`  
**Created**: 2026-03-31  
**Status**: Draft  
**Input**: User description: "Implementar API y consola para consultar, asignar y cambiar el plan de un tenant"  
**Task ID**: US-PLAN-01-T03  
**Epic**: EP-19 — Planes, límites y packaging del producto  
**Story**: US-PLAN-01 — Modelo de planes de producto y asignación a tenants  
**Depends on**: US-PLAN-01-T01 (097-plan-entity-tenant-assignment), US-PLAN-01-T02 (098-plan-base-limits)

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Superadmin Manages Plans Through the Console (Priority: P1)

A superadmin opens the administrative console and navigates to the Plan Management section. They can view the full catalog of product plans, create new plans, edit plan metadata (display name, description, capabilities, quota dimensions), and manage plan lifecycle transitions — all from a single, cohesive interface. Each mutation action provides immediate visual feedback and confirmation.

**Why this priority**: The console is the primary operational surface for plan management. Without it, superadmins must rely on direct API calls, which is operationally fragile and inaccessible to non-technical product or finance staff.

**Independent Test**: Can be fully tested by logging in as a superadmin, navigating to the Plan Management page, creating a plan, editing its attributes, transitioning its lifecycle, and verifying that each action persists correctly and is reflected in the UI.

**Acceptance Scenarios**:

1. **Given** a superadmin is authenticated and navigates to the Plan Management page, **When** the page loads, **Then** a paginated table of all plans is displayed showing slug, display name, status, number of assigned tenants, and last-modified timestamp.
2. **Given** the superadmin clicks "Create Plan," **When** they fill in slug, display name, description, and initial capabilities/quota dimensions, and submit the form, **Then** the plan is created in `draft` status and appears in the catalog immediately.
3. **Given** a plan exists in `draft` status, **When** the superadmin opens its detail view and clicks "Activate," **Then** a confirmation dialog explains the implications, and upon confirmation the plan transitions to `active` and the UI reflects the new status.
4. **Given** a plan in `active` status, **When** the superadmin edits its display name or description, **Then** the update is persisted, a success notification is shown, and an audit event is recorded.
5. **Given** the superadmin views the plan catalog, **When** they use the status filter (draft, active, deprecated, archived), **Then** the table updates to show only plans matching the selected status.

---

### User Story 2 — Superadmin Assigns or Changes a Tenant's Plan via Console (Priority: P1)

A superadmin navigates to a tenant's detail page or uses the Plan Assignment interface to assign an active plan to a tenant, or change the tenant's existing plan. The console shows the current assignment, allows selecting a new plan from the active catalog, displays a comparison of the current and target plan limits, and requires explicit confirmation before persisting the change.

**Why this priority**: Plan assignment is the operational act that connects commercial packaging to tenants. Providing a clear, confirmation-guarded UI flow prevents accidental assignments and gives operators full visibility before committing.

**Independent Test**: Can be fully tested by navigating to a tenant's plan section, assigning a plan, changing it to a different plan, and verifying the assignment persists, the previous assignment is superseded, and the change is visible in the tenant's plan history.

**Acceptance Scenarios**:

1. **Given** a superadmin navigates to tenant `acme-corp` which has no plan assigned, **When** they click "Assign Plan" and select the `starter` plan from a dropdown of active plans, **Then** a confirmation dialog shows the plan's capabilities and limits, and upon confirmation the assignment is persisted and immediately displayed.
2. **Given** tenant `acme-corp` is currently on the `starter` plan, **When** the superadmin initiates a plan change to `professional`, **Then** the console displays a side-by-side comparison of the current and target plan's limits and capabilities, highlighting differences (increases in green, decreases in red/amber).
3. **Given** the superadmin confirms the plan change from `starter` to `professional`, **Then** the previous assignment is superseded, the new assignment becomes current, and both appear in the tenant's plan history with correct timestamps.
4. **Given** the only active plans are `starter` and `professional`, **When** the superadmin opens the plan assignment dropdown, **Then** only active plans are listed — `draft`, `deprecated`, and `archived` plans are excluded.

---

### User Story 3 — Superadmin Reviews Plan Assignment History for a Tenant (Priority: P2)

A superadmin navigates to a tenant's plan section and views the complete chronological history of all plan assignments, including which plan was assigned, when it was effective, when it was superseded, and who made the change. This provides full auditability for support, compliance, and finance investigations.

**Why this priority**: Auditability of plan changes is critical for dispute resolution, billing reconciliation, and compliance. It depends on the assignment mechanism being in place but is essential for operational confidence.

**Independent Test**: Can be fully tested by performing multiple plan changes for a tenant and then viewing the history section, verifying all entries appear in correct chronological order with complete metadata.

**Acceptance Scenarios**:

1. **Given** tenant `acme-corp` has had three plan assignments (starter → professional → enterprise), **When** the superadmin views the plan history tab, **Then** all three assignments are displayed in reverse chronological order, each showing plan name, effective date, superseded date (or "Current"), and the actor who made the change.
2. **Given** the plan history contains more than 20 entries, **When** the superadmin views the history, **Then** results are paginated and navigable.
3. **Given** a plan assignment entry in the history, **When** the superadmin clicks on it, **Then** a detail view shows the full plan snapshot at the time of assignment (capabilities and limits that were in effect).

---

### User Story 4 — Tenant Owner Views Their Plan and Limits in the Console (Priority: P2)

A tenant owner logs into the console and navigates to their workspace/tenant settings area. They can see their currently assigned plan's name, description, declared capabilities (with clear enabled/disabled indicators), and all quota dimension limits with display-friendly labels and units. This self-service view empowers tenant owners to understand their boundaries and consider upgrades.

**Why this priority**: Self-service visibility reduces support burden and enables informed upgrade decisions. It depends on plan data and limits being in place but directly serves the tenant experience.

**Independent Test**: Can be fully tested by logging in as a tenant owner, navigating to the plan/limits section, and verifying all plan metadata, capabilities, and limits are correctly displayed with no leakage of data from other tenants.

**Acceptance Scenarios**:

1. **Given** tenant `acme-corp` is assigned the `professional` plan, **When** the tenant owner navigates to their plan overview, **Then** the page displays the plan name, description, a list of capabilities with enabled/disabled badges, and a table of all quota dimensions with their values and units.
2. **Given** the `professional` plan has `realtime_enabled: true` and `webhooks_enabled: false`, **When** the tenant owner views capabilities, **Then** `Realtime` shows as enabled (green badge) and `Webhooks` shows as disabled (grey badge).
3. **Given** the tenant owner views their plan's limits, **Then** each limit row shows a human-readable label (e.g., "Maximum Workspaces"), the limit value, and the unit (e.g., "5 workspaces"). Dimensions marked as unlimited show "Unlimited" instead of a numeric value.
4. **Given** a tenant with no plan assigned, **When** the tenant owner navigates to the plan section, **Then** the page displays a clear "No plan assigned" message and does not show empty or broken limit tables.

---

### User Story 5 — Superadmin Manages Plan Limits Through the Console (Priority: P2)

A superadmin opens a plan's detail view and navigates to its Limits tab. They see all quota dimensions from the catalog, each showing its current value (explicit or inherited default). They can edit individual limits, toggle between explicit values and "use platform default," and set dimensions to "unlimited." Changes to active plans trigger a confirmation dialog that explains the audit implications.

**Why this priority**: Limit management through the console provides a governed, error-resistant interface for configuring plan tiers. It depends on the quota dimension catalog and plan base limits being in place.

**Independent Test**: Can be fully tested by opening a plan's limits tab, modifying limits across different lifecycle states, and verifying the correct persistence, validation, and audit behavior.

**Acceptance Scenarios**:

1. **Given** a `draft` plan with no explicit limits set, **When** the superadmin opens the Limits tab, **Then** all quota dimensions from the catalog are listed with "Platform Default" indicators and the default value shown in parentheses.
2. **Given** the superadmin edits the `max_workspaces` limit from "Platform Default" to `10`, **Then** the value is persisted and the dimension now shows `10` with an "Explicit" indicator.
3. **Given** an `active` plan, **When** the superadmin changes a limit value, **Then** a confirmation dialog warns that the change will take effect immediately and be audited, and upon confirmation the change is saved and an audit event is emitted.
4. **Given** a `deprecated` plan, **When** the superadmin attempts to edit any limit, **Then** all limit fields are disabled/read-only and a banner explains that limits on deprecated plans are frozen.
5. **Given** the superadmin sets a dimension to "Unlimited," **Then** the value is stored as the unlimited sentinel and the UI displays "Unlimited" for that dimension.

---

### User Story 6 — Superadmin Views the Quota Dimension Catalog (Priority: P3)

A superadmin navigates to a platform settings area where the quota dimension catalog is displayed as a read-only reference table. This shows all recognized dimensions, their display labels, units of measure, and platform default values, serving as the definitive reference for plan configuration.

**Why this priority**: The catalog is a supporting reference view. Most superadmins interact with dimensions through the plan limits tab, but a dedicated catalog view aids governance and onboarding.

**Independent Test**: Can be fully tested by navigating to the catalog page and verifying all expected dimensions are listed with correct metadata.

**Acceptance Scenarios**:

1. **Given** a superadmin navigates to the Quota Dimension Catalog page, **When** the page loads, **Then** a table displays all recognized dimensions with columns: Dimension Key, Display Label, Unit of Measure, Platform Default Value.
2. **Given** the catalog includes the 8 standard dimensions from T02, **Then** all 8 appear in the table with their correct labels and defaults.

---

### User Story 7 — API Consumers Manage Plans Programmatically (Priority: P1)

External or internal system integrators use the plan management REST API to perform all plan operations programmatically: create plans, update plan metadata, manage lifecycle transitions, define/update base limits, assign plans to tenants, query plan catalogs, and retrieve tenant plan information. The API follows the platform's existing REST conventions and is protected by the standard authentication and authorization model.

**Why this priority**: The API is the foundational contract that the console and all automation depend on. Without it, no surface can operate. It is co-equal in priority with the console as the primary operational layer.

**Independent Test**: Can be fully tested by exercising every API endpoint with valid and invalid inputs, verifying correct responses, error codes, multi-tenant isolation, and audit event emission.

**Acceptance Scenarios**:

1. **Given** an authenticated superadmin, **When** they call the API to create a plan with slug `starter`, display name "Starter", and status `draft`, **Then** the API returns `201 Created` with the full plan entity including its generated ID.
2. **Given** a plan exists, **When** the superadmin calls the API to list plans with `status=active` filter, **Then** the response includes only active plans with pagination metadata.
3. **Given** an authenticated superadmin, **When** they call the API to assign the `professional` plan to tenant `acme-corp`, **Then** the API returns `200 OK` with the new assignment details, and the previous assignment (if any) is superseded.
4. **Given** an authenticated tenant owner, **When** they call the API to get their current plan, **Then** the response includes plan metadata, capabilities, and base limits. Calling the same endpoint with a different tenant's ID returns `403 Forbidden`.
5. **Given** an unauthenticated caller, **When** they call any plan management endpoint, **Then** the API returns `401 Unauthorized`.
6. **Given** a superadmin attempts to assign a `deprecated` plan to a tenant, **Then** the API returns `422 Unprocessable Entity` with a descriptive error message.

---

### Edge Cases

- What happens when a superadmin tries to create a plan with a slug that already exists? The API returns `409 Conflict` with an error message referencing the existing plan. The console shows an inline validation error on the slug field.
- What happens when the plan catalog is empty? The console shows an empty state with a prominent "Create your first plan" call-to-action. The tenant plan view for tenants without a plan shows "No plan assigned."
- What happens when a superadmin attempts to assign a plan to a non-existent tenant? The API returns `404 Not Found` referencing the tenant. The console only presents tenants from a validated search/dropdown.
- What happens during a plan change when the target plan has lower limits than the current plan? The comparison view in the console highlights decreasing dimensions in amber/red. The API accepts the change (enforcement is downstream) but the confirmation dialog warns about potential limit reductions.
- What happens when two superadmins attempt to change the same tenant's plan simultaneously? The backend serialization from T01 ensures exactly one succeeds. The other receives a conflict error. The console should display a retry prompt.
- What happens when a tenant owner tries to access the superadmin plan management pages? The console's route guards redirect them to their own plan view. The API returns `403 Forbidden` for admin-only endpoints.
- What happens when a plan's capabilities or limits change after assignment? The tenant's plan view reflects the current state of the plan. The history view captures the plan ID at assignment time, enabling future reconstruction of point-in-time state (T04 scope).

## Requirements *(mandatory)*

### Functional Requirements

#### Plan Management API

- **FR-001**: The system MUST expose a REST API for plan lifecycle operations: create plan, update plan metadata, transition plan lifecycle status, list plans (with status filter and pagination), and get plan by ID or slug.
- **FR-002**: The system MUST expose a REST API for plan assignment operations: assign plan to tenant, get tenant's current plan assignment, and get tenant's plan assignment history (paginated).
- **FR-003**: The system MUST expose a REST API for plan base limit operations: set/update limit for a dimension on a plan, remove an explicit limit (revert to platform default), and get the complete limit profile for a plan.
- **FR-004**: The system MUST expose a REST API for the quota dimension catalog: list all recognized dimensions with their metadata and platform defaults (read-only).
- **FR-005**: The system MUST expose a read-only REST API for tenant owners to query their own plan's metadata, capabilities, and base limit profile.
- **FR-006**: All plan management API endpoints that perform mutations MUST require superadmin authorization. Tenant owner endpoints MUST be scoped to the authenticated tenant's own data only.
- **FR-007**: All mutating API endpoints MUST emit auditable events consistent with the event schemas defined in T01 and T02 (actor, target entity, action type, previous state, new state, timestamp, correlation ID).
- **FR-008**: API error responses MUST follow the platform's standard error envelope format with structured error codes, human-readable messages, and actionable detail (e.g., listing blocking tenants when archive is rejected, referencing the catalog when an invalid dimension key is used).
- **FR-009**: The plan listing API MUST support filtering by lifecycle status and pagination with cursor-based or offset-based navigation consistent with the platform's existing pagination conventions.

#### Plan Management Console

- **FR-010**: The console MUST provide a Plan Catalog page accessible to superadmins, displaying a paginated, filterable table of all plans with columns: slug, display name, status, assigned tenant count, and last-modified date.
- **FR-011**: The console MUST provide a Plan Detail page with tabs for: General Information (metadata, lifecycle actions), Capabilities (boolean feature flags), Limits (all quota dimensions), and Assigned Tenants (list of tenants on this plan).
- **FR-012**: The console MUST provide a plan creation form with fields for slug, display name, description, initial capabilities, and initial quota dimensions. Slug must be validated for format (lowercase, alphanumeric, hyphens) and uniqueness before submission.
- **FR-013**: The console MUST provide lifecycle transition actions (Activate, Deprecate, Archive) on the Plan Detail page, each guarded by a confirmation dialog explaining implications. Archive MUST show blocking tenants when the transition is not allowed.
- **FR-014**: The console MUST provide a Plan Assignment interface on the tenant detail page, showing the current plan (or "No plan assigned"), an "Assign Plan" / "Change Plan" action, and a plan selection dropdown limited to active plans.
- **FR-015**: When changing a tenant's plan, the console MUST display a side-by-side comparison of the current and target plans' capabilities and limits, with visual indicators for increases (green), decreases (amber/red), and unchanged values (neutral).
- **FR-016**: The console MUST provide a Plan History section on the tenant detail page showing all plan assignments in reverse chronological order with plan name, effective date, superseded date, and actor.
- **FR-017**: The console MUST provide a Tenant Plan Overview page for tenant owners, displaying their current plan's name, description, capability badges (enabled/disabled), and all quota dimension limits with human-readable labels, values, and units.
- **FR-018**: The console MUST provide a Plan Limits editing interface on the Plan Detail page allowing superadmins to set explicit values, revert to platform default, or set "Unlimited" for each quota dimension. Editing MUST be disabled for plans in `deprecated` or `archived` status.
- **FR-019**: The console MUST provide a Quota Dimension Catalog page (read-only) accessible to superadmins, displaying all recognized dimensions with their key, label, unit, and platform default value.
- **FR-020**: All console pages MUST respect multi-tenant isolation: tenant owners see only their own plan data; superadmins see the full catalog and all tenant assignments.
- **FR-021**: All console mutation actions MUST show appropriate loading states during API calls and display success or error notifications upon completion.
- **FR-022**: The console MUST include route guards that prevent tenant owners from accessing superadmin plan management pages. Unauthorized navigation attempts MUST redirect to the appropriate tenant-scoped view.

### Key Entities

- **Plan Management API**: The REST API surface exposing all plan operations (catalog CRUD, assignment, history, limits) to authenticated consumers. Serves as the backend contract for the console and any programmatic integrators.
- **Plan Catalog Page**: The console view showing all plans with filtering and navigation to individual plan details.
- **Plan Detail Page**: The console view for a single plan, with tabs for metadata, capabilities, limits, and assigned tenants.
- **Tenant Plan Section**: The console area within tenant detail showing current plan, assignment controls, comparison view, and plan history.
- **Tenant Plan Overview Page**: The tenant-owner-facing console view showing their own plan information, capabilities, and limits.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A superadmin can create a new plan, define its limits, and assign it to a tenant entirely through the console without any direct API calls, completing the full workflow in under 3 minutes.
- **SC-002**: A tenant owner can view their current plan, capabilities, and limits in the console within 10 seconds of navigation, with all information presented using human-readable labels and clear visual indicators.
- **SC-003**: Every plan and assignment mutation performed through the console produces a corresponding audit event that is visible in the plan history and queryable through the existing audit pipeline.
- **SC-004**: The plan comparison view during plan changes shows all capability and limit differences between the current and target plans, enabling the superadmin to make an informed decision before confirmation.
- **SC-005**: All API endpoints respond within 2 seconds under normal load, and the console pages render within 3 seconds including data fetch.
- **SC-006**: No tenant can access plan data belonging to another tenant through the console or API, verified by attempting cross-tenant access with both tenant owner and superadmin roles.
- **SC-007**: All error scenarios (duplicate slug, invalid dimension key, deprecated plan assignment, concurrent plan change, unauthorized access) produce clear, actionable feedback in both the API response and console UI.

## Assumptions

- The plan entity, lifecycle management, assignment model (T01 / 097-plan-entity-tenant-assignment), quota dimension catalog, and base limits model (T02 / 098-plan-base-limits) are already implemented and provide stable backend contracts. This task exposes those capabilities through the API surface and console.
- The console follows the existing React + Tailwind CSS + shadcn/ui design system and component patterns already established in the platform.
- Backend API logic runs as OpenWhisk actions, consistent with the platform's serverless architecture for console backends.
- The platform's existing authentication (Keycloak) and authorization patterns (role-based access, tenant scoping) apply to all new endpoints and console routes without requiring new IAM primitives.
- The platform's existing pagination, error envelope, and audit event conventions are followed without modification.
- The plan comparison feature shows the current plan state vs. the target plan state at the time of comparison. Point-in-time historical state reconstruction is out of scope (T04).
- Console navigation structure and sidebar integration follow the existing patterns — the plan management section is added to the appropriate admin/tenant navigation areas.

## Scope Boundaries

### In Scope

- REST API endpoints for all plan management operations (CRUD, lifecycle, assignment, limits, catalog query)
- REST API endpoints for tenant owner plan/limits read access
- Console Plan Catalog page (superadmin)
- Console Plan Detail page with tabs: metadata, capabilities, limits, assigned tenants (superadmin)
- Console Plan Creation form (superadmin)
- Console Plan Assignment and Change interface on tenant detail page (superadmin)
- Console Plan Comparison view during plan changes (superadmin)
- Console Plan History section on tenant detail page (superadmin)
- Console Tenant Plan Overview page (tenant owner)
- Console Quota Dimension Catalog page (superadmin, read-only)
- Console Plan Limits editing interface on Plan Detail page (superadmin)
- Route guards and multi-tenant isolation in the console
- Loading states, success/error notifications, confirmation dialogs
- API authentication, authorization, error handling, and audit event emission

### Out of Scope

- Plan entity design and data model (T01 — already implemented)
- Quota dimension catalog and base limits data model (T02 — already implemented)
- Historical impact analysis of plan changes on effective quotas (T04)
- Upgrade/downgrade testing with existing resources (T05)
- Transition policy documentation and overage handling (T06)
- Hard/soft quota distinction and enforcement (US-PLAN-02)
- Per-tenant overrides and custom limits beyond the plan
- Billing integration, payment gating, or usage metering
- Real-time quota consumption display (deferred to quota enforcement features)
- Plan approval workflows or multi-step plan change processes
