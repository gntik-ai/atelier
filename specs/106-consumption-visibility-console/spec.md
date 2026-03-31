# Feature Specification: Consumption Visibility Console

**Feature Branch**: `106-consumption-visibility-console`  
**Created**: 2026-03-31  
**Status**: Draft  
**Input**: User description: "Mostrar en consola el plan activo, límites consumidos y capacidades habilitadas"  
**Task ID**: US-PLAN-02-T04  
**Epic**: EP-19 — Planes, límites y packaging del producto  
**Story**: US-PLAN-02 — Hard/soft quotas, capabilities booleanas, overrides y visualización de consumo  
**Depends on**: US-PLAN-02-T01 (103-hard-soft-quota-overrides), US-PLAN-02-T02 (104-plan-boolean-capabilities), US-PLAN-02-T03 (105-effective-limit-resolution)

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Tenant Owner Views Their Active Plan and Effective Entitlements (Priority: P1)

A tenant owner navigates to their plan overview page in the console and immediately sees the name, status, and description of their currently assigned product plan. Below the plan identity, they see a unified summary of their effective entitlements: every quantitative quota dimension showing the effective limit and its source (plan, override, or catalog default), along with every boolean capability showing whether it is enabled or disabled. This single view gives the tenant owner a complete, authoritative picture of what their tenancy is entitled to — without needing to know the internal resolution mechanics.

**Why this priority**: This is the foundational console view that all other consumption visibility features depend on. A tenant owner who cannot see their plan and entitlements cannot make informed decisions about resource usage, plan upgrades, or workspace allocation. This is the minimum viable value for the task.

**Independent Test**: Can be fully tested by assigning a plan with mixed quota dimensions and capabilities to a tenant, logging in as tenant owner, navigating to the plan overview, and verifying that every dimension and capability appears with its correct effective value and source.

**Acceptance Scenarios**:

1. **Given** tenant `acme-corp` is assigned the `professional` plan, **When** the tenant owner navigates to the plan overview page, **Then** the page displays the plan name (`Professional`), plan status (`active`), and plan description.
2. **Given** the `professional` plan defines `max_workspaces: 10`, `max_pg_databases: 20`, and has a superadmin override setting `max_pg_databases: 30` for this tenant, **When** the tenant owner views the entitlements section, **Then** `max_workspaces` shows `10 (plan)` and `max_pg_databases` shows `30 (override)`.
3. **Given** the quota dimension catalog defines `max_kafka_topics` with a platform default of `5` and the tenant's plan does not set this dimension, **When** the tenant owner views the entitlements, **Then** `max_kafka_topics` shows `5 (platform default)`.
4. **Given** the tenant's plan enables `realtime`, `webhooks`, and `sql_admin_api`, and the catalog has 7 capabilities, **When** the tenant owner views the capabilities section, **Then** all 7 capabilities are listed — 3 shown as enabled and 4 shown as disabled — each with a human-readable label.
5. **Given** no plan is assigned to the tenant, **When** the tenant owner navigates to the plan overview, **Then** the page displays a clear message indicating no plan is assigned and all entitlements show catalog defaults.

---

### User Story 2 — Tenant Owner Sees Current Consumption Against Effective Limits (Priority: P1)

For each quantitative quota dimension, the console shows not only the effective limit but also the tenant's **current consumption** — how many resources of that type are currently in use. The display makes it immediately obvious whether the tenant is well within limits, approaching a threshold, or already at/above the limit. Visual indicators (progress bars, color coding, or similar affordances) help the tenant owner scan consumption status at a glance.

**Why this priority**: Knowing entitlements without knowing current usage is incomplete. Consumption visibility is what transforms a static plan display into an actionable operational dashboard. Without it, tenants cannot anticipate when they will hit limits or justify upgrade requests.

**Independent Test**: Can be fully tested by provisioning measurable resources (workspaces, databases, functions) for a tenant, navigating to the plan overview, and verifying the consumption count matches the actual provisioned resources, and that visual indicators correctly reflect the consumption ratio.

**Acceptance Scenarios**:

1. **Given** tenant `acme-corp` has an effective limit of `max_workspaces: 10` and currently has 3 workspaces, **When** the tenant owner views the quota section, **Then** the display shows `3 / 10` with a visual indicator (e.g., progress bar) at 30%.
2. **Given** tenant `acme-corp` has an effective limit of `max_pg_databases: 20` and currently has 18 databases, **When** the tenant owner views the quota section, **Then** the display shows `18 / 20` with a visual indicator highlighting that the tenant is at 90% — approaching the limit.
3. **Given** tenant `acme-corp` was downgraded and now has `max_functions: 10` but currently has 15 functions deployed, **When** the tenant owner views the quota section, **Then** the display shows `15 / 10` with a clear over-limit visual indicator and an explanation that the tenant is currently above the effective limit.
4. **Given** a dimension has an effective limit of `-1` (unlimited), **When** the tenant owner views the quota section, **Then** the display shows the current consumption count alongside an "Unlimited" label, with no progress bar or percentage.
5. **Given** a dimension has current consumption of `0`, **When** the tenant owner views the quota section, **Then** the display shows `0 / [limit]` with the indicator at 0%, not omitted or hidden.

---

### User Story 3 — Superadmin Views a Tenant's Consumption and Entitlements (Priority: P1)

A superadmin navigates to the tenant management section of the console, selects a specific tenant, and accesses a consumption and entitlements view that mirrors what the tenant owner sees — but with additional context. The superadmin view shows the resolution source for each dimension (plan, override, or default), whether overrides are active, and any over-limit conditions. This enables the superadmin to make informed decisions about overrides, plan changes, or support escalations without leaving the console.

**Why this priority**: Superadmins are the operators who respond to tenant requests for plan changes, override approvals, and capacity issues. They need a comprehensive view of the tenant's entitlement and consumption posture to make these decisions accurately. Without this, superadmins must query APIs manually or rely on partial information.

**Independent Test**: Can be fully tested by logging in as a superadmin, navigating to a tenant's detail page, and verifying the entitlements and consumption view includes all dimensions with source annotations, override indicators, and over-limit warnings where applicable.

**Acceptance Scenarios**:

1. **Given** the superadmin navigates to tenant `acme-corp`, **When** the entitlements view loads, **Then** each quota dimension shows the effective limit, resolution source (plan / override / catalog default), and current consumption.
2. **Given** tenant `acme-corp` has a superadmin override on `max_pg_databases`, **When** the superadmin views the entitlements, **Then** the override is visually indicated (e.g., badge, icon, or label) alongside the effective limit, and the original plan-level limit is also shown for comparison.
3. **Given** tenant `acme-corp` is over-limit on `max_functions` due to a recent downgrade, **When** the superadmin views the entitlements, **Then** the over-limit condition is highlighted with a warning indicator, the current consumption count, and the effective limit clearly displayed.
4. **Given** a superadmin views entitlements for a tenant with no overrides, **When** all dimensions are at plan-level or catalog-default values, **Then** no override indicators are shown and the source for each dimension correctly reads "plan" or "platform default."

---

### User Story 4 — Workspace Admin Views Workspace-Specific Consumption and Limits (Priority: P2)

A workspace admin navigates to a workspace-level dashboard within the console and sees the effective limits applicable to their workspace. If the workspace has sub-quotas allocated (from the tenant's effective limits), the display shows the workspace's allocation and consumption against it. If no sub-quota is allocated for a dimension, the display indicates that the workspace shares the tenant-level pool for that dimension. Boolean capabilities are inherited from the tenant plan and displayed as read-only at workspace level.

**Why this priority**: Workspace admins manage day-to-day operations within a workspace and need visibility into their local resource constraints. However, this depends on sub-quota allocation (T03) and the tenant-level views (US1–US3) being in place first.

**Independent Test**: Can be fully tested by allocating sub-quotas for some dimensions to a workspace, creating resources in the workspace, navigating to the workspace dashboard as workspace admin, and verifying the limits and consumption reflect workspace-level allocations where set and tenant-pool inheritance where not.

**Acceptance Scenarios**:

1. **Given** workspace `ws-prod` has a sub-quota of `max_pg_databases: 6` and currently has 4 databases, **When** the workspace admin views the workspace dashboard, **Then** the display shows `4 / 6` for `max_pg_databases` with the source labeled as "workspace allocation."
2. **Given** workspace `ws-dev` has no sub-quota for `max_functions`, **When** the workspace admin views the workspace dashboard, **Then** `max_functions` shows "Shared tenant pool" with the tenant-level effective limit displayed for reference, and the workspace's own consumption count.
3. **Given** the tenant's plan disables the `realtime` capability, **When** the workspace admin views the workspace dashboard, **Then** `realtime` is shown as disabled and the workspace admin cannot enable it at workspace level.
4. **Given** workspace `ws-staging` has a sub-quota of `max_workspaces: 3` and currently consumes `3`, **When** the workspace admin views the dashboard, **Then** the display shows `3 / 3` with an at-limit visual indicator.

---

### User Story 5 — Tenant Owner Views Workspace Allocation Summary (Priority: P2)

A tenant owner views an allocation summary that shows how the tenant's effective limits for each dimension are distributed across workspaces. For each dimension, the summary shows the total effective limit, the sum of all workspace sub-quotas, and the remaining unallocated capacity (shared pool). This helps the tenant owner understand whether their capacity is well-distributed or concentrated in specific workspaces.

**Why this priority**: The allocation summary bridges the gap between tenant-level entitlements and workspace-level sub-quotas. Without it, the tenant owner sees only the aggregate or only per-workspace views, and cannot assess the overall distribution pattern. This is valuable but depends on the core consumption views being in place.

**Independent Test**: Can be fully tested by setting sub-quotas on multiple workspaces, navigating to the allocation summary as tenant owner, and verifying the total, allocated, and unallocated figures are arithmetically correct for each dimension.

**Acceptance Scenarios**:

1. **Given** tenant `acme-corp` has effective `max_pg_databases: 20`, with `ws-prod` allocated `8` and `ws-dev` allocated `5`, **When** the tenant owner views the allocation summary, **Then** the summary shows total: 20, allocated: 13, unallocated: 7.
2. **Given** all workspace sub-quotas for a dimension sum to exactly the effective limit, **When** the tenant owner views the allocation summary, **Then** the unallocated amount is `0` and a visual cue indicates the dimension is fully allocated.
3. **Given** a dimension has no workspace sub-quotas set at all, **When** the tenant owner views the allocation summary, **Then** the summary shows the entire effective limit as "Shared pool (no workspace allocations)."
4. **Given** a dimension is unlimited (`-1`) at the tenant level and workspaces have finite sub-quotas, **When** the tenant owner views the allocation summary, **Then** the total is shown as "Unlimited" and the allocated sum is displayed for informational purposes without a percentage or progress calculation.

---

### Edge Cases

- **Tenant with no plan assigned**: All entitlement views must gracefully handle the absence of a plan, showing catalog defaults and a prompt to contact the administrator for plan assignment.
- **Quota dimension added to catalog after plan assignment**: Newly added dimensions appear in the entitlements view with their catalog default value, without requiring a plan reassignment.
- **Override expires or is revoked between page loads**: The next page load or refresh must reflect the updated effective limits — no stale override data should persist in the UI beyond a single page session.
- **Concurrent workspace sub-quota changes**: If two workspace admins are modifying sub-quotas simultaneously, the allocation summary must reflect the committed state, not an inconsistent mix. Optimistic concurrency or refresh mechanisms should handle this gracefully.
- **Dimension with effective limit of 0**: The display should show `0` explicitly (not "Unlimited" or blank), with a clear indication that no resources of this type are allowed.
- **Large number of quota dimensions**: The display must remain usable when the catalog grows beyond the initial 8 dimensions — scrollable, searchable, or categorized as needed.
- **Consumption count temporarily unavailable**: If a consumption data source is unreachable or returns an error, the UI should show the entitlement limit with a "consumption data unavailable" indicator rather than hiding the entire row.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The console MUST display the tenant's currently assigned plan identity (name, status, description) on the plan overview page.
- **FR-002**: The console MUST display all effective quantitative quota dimensions for the tenant, showing for each: the dimension display name, the effective limit value, and the resolution source (plan, override, or catalog default).
- **FR-003**: The console MUST display all effective boolean capabilities for the tenant, showing for each: the capability display name, enabled/disabled state, and the resolution source (plan or catalog default).
- **FR-004**: The console MUST display current consumption (resource count in use) for each quantitative quota dimension alongside the effective limit.
- **FR-005**: The console MUST provide visual indicators that communicate consumption status at a glance: within limits (normal), approaching limits (warning threshold), at or above limits (critical/over-limit).
- **FR-006**: Dimensions with an effective limit of `-1` (unlimited) MUST be displayed with an "Unlimited" label and the current consumption count, without percentage or progress indicators.
- **FR-007**: Dimensions with an effective limit of `0` MUST be displayed explicitly as zero, clearly indicating no resources of that type are permitted.
- **FR-008**: Over-limit conditions (current consumption exceeds effective limit) MUST be visually distinct and MUST include both the current count and the effective limit.
- **FR-009**: The superadmin tenant detail view MUST include the same entitlement and consumption information as the tenant-owner view, plus: override indicators, original plan-level values alongside overridden values, and over-limit warnings.
- **FR-010**: The workspace dashboard MUST display effective limits for the workspace: workspace sub-quota values where allocated, and "shared tenant pool" indicators where no sub-quota exists.
- **FR-011**: The workspace dashboard MUST display current consumption within the workspace for each applicable dimension.
- **FR-012**: Boolean capabilities MUST be displayed as read-only at workspace level, inherited from the tenant's plan.
- **FR-013**: The tenant owner MUST be able to view a workspace allocation summary showing, per dimension: total effective limit, sum of workspace sub-quotas, and unallocated remainder.
- **FR-014**: When no plan is assigned to a tenant, the console MUST display a clear "No plan assigned" message and show all dimensions at catalog default values.
- **FR-015**: The console MUST use human-readable display names for both quota dimensions and boolean capabilities, sourced from the respective catalogs.
- **FR-016**: All consumption and entitlement views MUST be scoped to the authenticated user's tenant (tenant owner) or the selected tenant (superadmin), enforcing multi-tenant isolation.
- **FR-017**: The console MUST refresh entitlement and consumption data on page load; stale data from a previous session MUST NOT persist.
- **FR-018**: When consumption data for a dimension is temporarily unavailable, the console MUST show the effective limit with a "data unavailable" indicator rather than hiding the row or displaying incorrect data.

### Key Entities

- **Effective Entitlement Profile**: A resolved set of quantitative limits and boolean capabilities for a tenant, combining plan base values, overrides, and catalog defaults — already computed by the backend (T03).
- **Consumption Snapshot**: A point-in-time count of resources currently in use for each quota dimension, scoped to a tenant or workspace.
- **Workspace Allocation Summary**: An aggregation of workspace sub-quotas for each dimension against the tenant's effective limit, showing allocated vs. unallocated capacity.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A tenant owner can identify their active plan, effective limits for all quota dimensions, and enabled/disabled state for all capabilities within 10 seconds of navigating to the plan overview page.
- **SC-002**: A tenant owner can determine whether any quota dimension is at or above its effective limit within 5 seconds, by visual inspection alone (no manual calculation required).
- **SC-003**: A superadmin can view a specific tenant's full entitlement and consumption posture, including override indicators and over-limit warnings, in a single page without requiring API calls or additional tooling.
- **SC-004**: Workspace-level consumption visibility is available for any workspace with or without sub-quota allocations, correctly reflecting workspace-specific limits or shared-pool inheritance.
- **SC-005**: All entitlement views correctly reflect the latest resolved state — any override creation, revocation, plan change, or sub-quota modification is reflected upon the next page load.
- **SC-006**: The allocation summary arithmetic is correct: `sum(workspace_sub_quotas) + unallocated = effective_limit` for every dimension that has a finite effective limit.

## Assumptions

- The backend resolution endpoints from T03 (105-effective-limit-resolution) are available and return the complete unified entitlement profile (quantitative + capabilities + source annotations) in a single call.
- Consumption counts are obtainable from existing platform services or repositories for each recognized quota dimension. The exact mechanism for gathering counts is a backend concern; the console consumes an API that returns them.
- The console already has tenant-owner and superadmin authentication/authorization flows in place (from 099-plan-management-api-console and prior features).
- The existing console component library (React + Tailwind CSS + shadcn/ui) provides or can accommodate progress bars, badges, and status indicators needed for consumption visualization.
- Workspace sub-quota data is available from the sub-quota management endpoints introduced in T03 (105).

## Scope Boundaries

**In scope**:
- Console pages and components for tenant-level plan overview with entitlements and consumption.
- Superadmin tenant detail entitlement and consumption view.
- Workspace-level consumption dashboard.
- Tenant owner workspace allocation summary.
- Visual indicators for consumption status (normal, warning, critical, over-limit, unlimited).
- Human-readable labels sourced from dimension and capability catalogs.

**Out of scope**:
- Enforcement of limits at gateway, API, or control plane level (US-PLAN-02-T05).
- Modification of plans, overrides, or sub-quotas from the consumption views (those mutations exist in separate management pages from T01, T03, and 099).
- Historical consumption trends or time-series graphs (future observability work).
- Notification or alerting when a tenant approaches or exceeds a limit (future alerting feature).
- Backend API implementation for consumption counting (assumed available or to be coordinated with existing metering infrastructure from US-OBS-03).
