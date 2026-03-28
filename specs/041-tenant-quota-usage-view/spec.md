# Feature Specification: US-OBS-03-T05 — Tenant Quota Usage and Provisioning-State View

**Feature Branch**: `041-tenant-quota-usage-view`
**Task**: `US-OBS-03-T05`
**Epic**: EP-13 — Cuotas, metering, auditoría y observabilidad
**Story**: US-OBS-03 — Metering, cuotas, alertas y estado de aprovisionamiento
**Requirements traceability**: RF-OBS-009, RF-OBS-010, RF-OBS-011, RF-OBS-012, RF-OBS-013, RF-OBS-014, RF-OBS-015, RF-OBS-019
**Dependencies**: US-PLAN-01, US-TEN-01
**Intra-story dependencies**: US-OBS-03-T01 (consumption metering), US-OBS-03-T02 (quota-policy evaluation), US-OBS-03-T03 (threshold alerts), US-OBS-03-T04 (hard-limit enforcement)
**Created**: 2026-03-28
**Status**: Specified

---

## Problem Statement

The platform now calculates per-tenant and per-workspace consumption (T01), evaluates that
consumption against configured hard/soft/warning quota policies (T02), emits alert events when
thresholds are crossed (T03), and enforces hard limits synchronously on resource creation (T04).
However, none of these capabilities are **visible** to the humans who need to act on them.

Without a usage and provisioning-state view:

- a tenant owner who receives a `QUOTA_HARD_LIMIT_REACHED` rejection has no place to see *which*
  dimensions are at capacity, how close other dimensions are, and what the configured limits are,
- a superadmin cannot inspect the provisioning posture of a tenant at a glance to decide whether a
  plan upgrade, quota adjustment, or cleanup is warranted,
- SRE teams lack a consolidated surface to spot capacity pressure across tenants before it becomes
  an operational incident,
- and the enforcement, alerting, and metering investments remain back-end-only capabilities that
  cannot be self-served by platform users.

This task introduces the **tenant quota-usage and provisioning-state view**: a read-only API surface
and the corresponding console representation that exposes current consumption, quota limits, posture
classification, and provisioning state for every metered dimension at tenant and workspace scope.

---

## Users and Value

| Actor | Value received |
| --- | --- |
| **Tenant owner** | Self-service visibility into how much of each quota dimension is consumed, which limits are approaching, and why certain operations are being blocked — enabling informed decisions about resource cleanup or plan upgrades. |
| **Superadmin** | Consolidated view of any tenant's quota posture and provisioning state, enabling proactive capacity management, plan adjustments, and support responses without querying internal systems. |
| **SRE** | Ability to identify tenants under capacity pressure across all metered dimensions, supporting capacity planning and incident prevention. |
| **Security / Governance** | Auditable access to quota posture data through a governed API, ensuring that quota visibility follows the same multi-tenant isolation and permission model as the rest of the platform. |

---

## User Scenarios & Testing

### User Story 1 — Tenant owner views their quota usage summary (Priority: P1)

A tenant owner navigates to their tenant's quota/usage section in the console (or queries the API
directly) and sees a summary of every metered dimension: current consumption, configured limits
(warning, soft, hard), the evaluated posture (within_limits, warning_reached, soft_limit_exceeded,
hard_limit_reached), and a visual indication of the usage percentage relative to the hard limit.

**Why this priority**: This is the core read capability — the entire purpose of the task. Without
it, all other stories are meaningless. It delivers immediate, self-service value to the most common
actor (tenant owner) and closes the feedback loop opened by enforcement rejections in T04.

**Independent Test**: Create a tenant with configured quota policies across at least three
dimensions. Drive consumption to different levels (e.g., 20%, 75%, 100% of hard limit). Query the
usage-view API and verify the response includes accurate consumption, limits, posture, and
percentage for each dimension.

**Acceptance Scenarios**:

1. **Given** a tenant with quota policies configured for `storage_buckets`, `serverless_functions`,
   and `api_requests`,
   **When** the tenant owner calls the quota-usage API for their tenant,
   **Then** the response includes one entry per metered dimension with fields: `dimension`,
   `current_usage`, `warning_threshold`, `soft_limit`, `hard_limit`, `posture`, and
   `usage_percentage`.

2. **Given** a tenant whose `storage_buckets` consumption is at 3 out of a hard limit of 5,
   **When** the quota-usage API is queried,
   **Then** the `storage_buckets` entry shows `current_usage: 3`, `hard_limit: 5`,
   `usage_percentage: 60`, and `posture: within_limits` (assuming warning threshold is above 60%).

3. **Given** a tenant whose `serverless_functions` consumption equals the hard limit,
   **When** the quota-usage API is queried,
   **Then** the `serverless_functions` entry shows `posture: hard_limit_reached` and
   `usage_percentage: 100`.

---

### User Story 2 — Tenant owner views workspace-scoped usage (Priority: P1)

A tenant may have multiple workspaces, each with its own quota policies. The tenant owner must be
able to view quota usage scoped to a specific workspace, not just the tenant-level aggregate. This
enables the owner to identify which workspace is consuming the most resources and take targeted
action.

**Why this priority**: Workspace-level visibility is essential for multi-workspace tenants. Without
it, a tenant with 10 workspaces cannot determine which one is driving the hard-limit rejection they
just received.

**Independent Test**: Create a tenant with two workspaces, each with distinct quota policies and
different consumption levels. Query the usage-view API for each workspace and verify the responses
are correctly scoped.

**Acceptance Scenarios**:

1. **Given** a tenant with workspace A (3 of 5 `storage_buckets`) and workspace B (5 of 5
   `storage_buckets`),
   **When** the tenant owner queries usage for workspace A,
   **Then** workspace A's usage shows `posture: within_limits`,
   **And** workspace B's data is not included in the response.

2. **Given** a tenant-level query (no workspace filter),
   **When** the tenant owner queries usage at tenant scope,
   **Then** the response includes the tenant-level aggregate posture across all dimensions.

---

### User Story 3 — Superadmin inspects any tenant's quota posture (Priority: P2)

A superadmin needs to view the quota posture of any tenant on the platform — for example, in
response to a support request, to verify a plan upgrade took effect, or to proactively identify
tenants at capacity. The API must allow superadmin-scoped access to any tenant's usage data.

**Why this priority**: Superadmin visibility is critical for platform operations but can be delivered
after the tenant-owner self-service view is proven, since it shares the same data surface and only
differs in authorization scope.

**Independent Test**: As a superadmin, query the usage-view API for a tenant the superadmin does not
own. Verify the full posture is returned. As a tenant owner, attempt the same query for a different
tenant and verify it is rejected.

**Acceptance Scenarios**:

1. **Given** a superadmin with platform-wide access,
   **When** the superadmin queries the quota-usage API for tenant T,
   **Then** the full usage posture for tenant T is returned, including all dimensions and workspaces.

2. **Given** a tenant owner of tenant A,
   **When** the owner attempts to query usage for tenant B,
   **Then** the request is rejected with HTTP 403, and no data from tenant B is disclosed.

---

### User Story 4 — Console renders quota usage with visual posture indicators (Priority: P2)

The admin console displays the quota-usage data in a human-friendly format: progress bars or gauges
per dimension, color-coded by posture (green for within_limits, amber for warning_reached, orange
for soft_limit_exceeded, red for hard_limit_reached), and an explicit indication when a dimension is
at hard limit, linking the visual state to the enforcement rejections the user may have experienced.

**Why this priority**: The console rendering transforms raw API data into actionable insight. It is
high-value but depends on Story 1 (the API surface) being available first.

**Independent Test**: With a tenant at varying consumption levels across dimensions, open the
console quota page and visually verify that each dimension displays correct usage, limit, percentage,
and posture coloring.

**Acceptance Scenarios**:

1. **Given** a tenant with `storage_buckets` at 100% (hard_limit_reached),
   **When** the tenant owner views the quota page in the console,
   **Then** the `storage_buckets` row shows a full progress bar in red, the label
   "Hard limit reached", and the numeric values (e.g., "5 / 5").

2. **Given** a tenant with `api_requests` at 80% (warning_reached),
   **When** the tenant owner views the quota page,
   **Then** the `api_requests` row shows an amber progress bar and the label "Warning threshold
   reached".

3. **Given** a tenant with no consumption on any dimension,
   **When** the tenant owner views the quota page,
   **Then** all dimensions show green indicators, 0% usage, and "Within limits".

---

### User Story 5 — Provisioning state is visible per tenant (Priority: P2)

Beyond quota usage, the tenant owner and superadmin need to see the **provisioning state** of the
tenant: whether the tenant's infrastructure (databases, storage, messaging, functions runtime) is
fully provisioned, partially provisioned, provisioning in progress, or in a degraded/error state.
This is especially important after tenant creation, plan changes, or infrastructure incidents.

**Why this priority**: Provisioning state closes the gap between "the tenant exists" and "the tenant
is fully operational". It is important for onboarding and plan-change flows but is not required for
the core usage-view to function.

**Independent Test**: Create a new tenant. Immediately query the provisioning-state API and verify
it reflects "provisioning" or partial state. Wait for provisioning to complete and verify it
transitions to "active". Simulate a degraded component and verify the state reflects it.

**Acceptance Scenarios**:

1. **Given** a tenant whose infrastructure is fully provisioned and healthy,
   **When** the provisioning-state API is queried,
   **Then** the response includes `provisioning_state: active` and a per-component breakdown all
   showing `status: ready`.

2. **Given** a tenant whose storage subsystem is still being provisioned after a plan upgrade,
   **When** the provisioning-state API is queried,
   **Then** the response includes `provisioning_state: provisioning` and the storage component
   shows `status: in_progress` while other components show `status: ready`.

3. **Given** a tenant whose Kafka broker is in a degraded state,
   **When** the provisioning-state API is queried,
   **Then** the response includes `provisioning_state: degraded` and the messaging component shows
   `status: degraded` with a `reason` field.

---

### User Story 6 — Console displays provisioning state alongside quota usage (Priority: P3)

The console integrates the provisioning-state data into the same tenant overview page as quota
usage, so the tenant owner has a single place to understand both "how much am I using" and "is my
infrastructure healthy and fully available".

**Why this priority**: This is a UX consolidation that depends on both the usage view (Story 4) and
the provisioning-state API (Story 5). It improves discoverability but is not a new data capability.

**Independent Test**: With a tenant in `degraded` provisioning state and one dimension at
hard_limit_reached, open the console and verify both states are visible on the same page.

**Acceptance Scenarios**:

1. **Given** a tenant with `provisioning_state: degraded` and `storage_buckets` at hard limit,
   **When** the tenant owner opens the tenant overview page in the console,
   **Then** a provisioning-state banner shows "Degraded — Storage" at the top,
   **And** the quota-usage section below shows the `storage_buckets` dimension in red.

---

### Edge Cases

- **Tenant with no quota policies configured**: The usage-view API must return an empty dimensions
  list with a clear indication that no quota policies are active, rather than an error.

- **Dimension with no hard limit**: If a dimension has only a warning or soft limit (no hard limit),
  the `hard_limit` field must be `null` and `usage_percentage` must be calculated against the soft
  limit (or omitted if no numeric cap exists).

- **Consumption exceeds hard limit (legacy data)**: If a tenant's consumption exceeds the hard
  limit due to a retroactive limit reduction (T04 does not remove existing resources), the
  `usage_percentage` may exceed 100%. The view must display this accurately (e.g., "7 / 5 — 140%")
  rather than capping at 100%.

- **Stale metering data**: If the consumption data is slightly behind real-time (eventual
  consistency from T01), the API must include a `last_updated_at` timestamp per dimension so the
  consumer knows the freshness of the data.

- **Concurrent provisioning-state transitions**: If a provisioning operation is in progress while
  the API is queried, the response must reflect the in-progress state rather than the last stable
  state.

- **Large number of dimensions**: The API must return all metered dimensions in a single response
  without pagination, since the number of quota dimensions is bounded and small (< 20).

- **Unauthorized workspace access**: A user with access to workspace A but not workspace B within
  the same tenant must not see workspace B's usage data, even if they have tenant-level read access
  to the aggregate.

---

## Requirements

### Functional Requirements

- **FR-001**: The system MUST expose a read-only API endpoint that returns the current quota-usage
  summary for a given tenant, including all metered dimensions with their `current_usage`,
  `warning_threshold`, `soft_limit`, `hard_limit`, `posture`, `usage_percentage`, and
  `last_updated_at`.

- **FR-002**: The system MUST support workspace-scoped queries: when a workspace ID is provided, the
  response MUST contain only the usage data for that workspace's quota policies and consumption.

- **FR-003**: The system MUST enforce multi-tenant isolation: a tenant owner can only view usage for
  their own tenant and workspaces they have access to. A superadmin can view usage for any tenant.

- **FR-004**: When a dimension's consumption exceeds the hard limit (e.g., due to retroactive limit
  reduction), the API MUST report the actual consumption and a `usage_percentage` above 100%.

- **FR-005**: Each dimension entry MUST include a `last_updated_at` timestamp reflecting the
  freshness of the underlying consumption data from T01.

- **FR-006**: The system MUST expose a read-only API endpoint that returns the provisioning state of
  a given tenant, including an overall `provisioning_state` enum (`active`, `provisioning`,
  `degraded`, `error`) and a per-component breakdown with `component_name`, `status` (`ready`,
  `in_progress`, `degraded`, `error`), and optional `reason`.

- **FR-007**: The provisioning-state API MUST follow the same multi-tenant isolation rules as the
  usage API (FR-003).

- **FR-008**: When no quota policies are configured for a tenant, the usage API MUST return an
  empty dimensions list and a `policies_configured: false` flag, not an error.

- **FR-009**: The `usage_percentage` MUST be calculated against the hard limit when present; when
  only a soft limit is configured, against the soft limit; when neither is configured, the field
  MUST be `null`.

- **FR-010**: The admin console MUST render a quota-usage page per tenant showing progress bars or
  gauges for each metered dimension, color-coded by posture (green/amber/orange/red).

- **FR-011**: The admin console MUST display the provisioning state of the tenant on the same
  overview page as quota usage, with a banner or status indicator for non-active states.

- **FR-012**: API access to the usage-view and provisioning-state endpoints MUST be recorded as
  audit events with the requesting identity and scope.

### Key Entities

- **Quota Usage Summary**: A read model representing a tenant's (or workspace's) consumption
  snapshot across all metered dimensions. Each entry contains: `dimension`, `current_usage`,
  `warning_threshold`, `soft_limit`, `hard_limit`, `posture`, `usage_percentage`,
  `last_updated_at`. This entity is derived from T01 consumption data and T02 quota policies; it is
  not independently persisted but computed on read.

- **Provisioning State**: Represents the infrastructure readiness of a tenant. Contains an overall
  `provisioning_state` enum and a list of component statuses. Components include platform
  subsystems (storage, databases, messaging, functions, realtime) and reflect whether each is
  `ready`, `in_progress`, `degraded`, or in `error`.

- **Component Status**: A sub-entity of Provisioning State representing a single infrastructure
  component's readiness: `component_name`, `status`, `reason` (optional, for degraded/error
  states), `last_checked_at`.

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: A tenant owner can retrieve their full quota-usage summary (all dimensions) via a
  single API call and receive accurate data matching the underlying metering and policy state,
  verified by cross-referencing T01 consumption and T02 policy values.

- **SC-002**: The usage-view API responds within 200 ms at p95 under normal operating conditions,
  ensuring a responsive console experience.

- **SC-003**: Multi-tenant isolation is enforced: a tenant owner querying another tenant's usage
  receives HTTP 403 in 100% of test cases; no cross-tenant data leakage is observed.

- **SC-004**: The console renders posture indicators that match the API data for 100% of dimensions,
  verified by automated UI test comparing rendered values against API responses.

- **SC-005**: The provisioning-state API accurately reflects component status transitions (ready →
  in_progress → ready, or ready → degraded) within 30 seconds of the underlying state change.

- **SC-006**: A tenant with dimensions at varying postures (within_limits, warning_reached,
  soft_limit_exceeded, hard_limit_reached) displays correct color-coding and labels for every
  dimension in the console.

---

## Out of Scope

- **Quota modification or plan management**: This task is read-only. Changing quota limits, managing
  plans, or requesting quota increases are separate capabilities.
- **Historical usage trends or time-series charts**: This task exposes the current snapshot only.
  Historical consumption views and trend analysis are a separate feature.
- **Alerting or notification delivery**: T03 handles threshold alerts. This task does not duplicate
  alert emission or notification channels.
- **Enforcement logic**: T04 handles hard-limit blocking. This task only displays the result of
  enforcement (posture) — it does not implement blocking.
- **Consumption calculation or policy evaluation**: T01 and T02 provide the underlying data. This
  task consumes those outputs as read-only inputs.
- **Billing or cost display**: Financial data tied to consumption is outside this task's scope.

---

## Risks, Assumptions, and Open Questions

### Assumptions

- T01 consumption data and T02 quota-posture evaluation are available as callable services or
  libraries with latency suitable for synchronous API responses (< 100 ms).
- T02 provides the posture classification enum (`within_limits`, `warning_reached`,
  `soft_limit_exceeded`, `hard_limit_reached`) that this task surfaces directly.
- The provisioning-state data is maintained by the platform's tenant-lifecycle management (from
  US-TEN-01) and is queryable per tenant.
- The admin console already has a tenant-detail or settings section where the quota-usage page can
  be added without architectural changes to the console shell.

### Risks

- **Metering latency**: If T01 consumption data has high staleness, the usage view may show
  outdated numbers, reducing user trust. Mitigation: include `last_updated_at` per dimension
  (FR-005) and, if staleness exceeds a threshold, display a "data may be delayed" indicator in the
  console.
- **Provisioning-state source ambiguity**: The source of truth for provisioning state may not be
  clearly defined yet if tenant lifecycle management is still evolving. Mitigation: define a minimal
  provisioning-state contract (FR-006) and allow the implementation to start with a subset of
  components.

### Open Questions

- **OQ-001**: Should the usage-view API support filtering by posture (e.g., "show me only
  dimensions at warning or above") or is a flat list of all dimensions sufficient for the initial
  implementation? Recommendation: start with a flat list; filtering can be added later as a
  non-breaking enhancement.
- **OQ-002**: Should the console quota page include a direct link or action to request a quota
  increase (e.g., "Contact support" or "Upgrade plan" button), or is that deferred to a separate
  plan-management feature? Recommendation: include a static "Contact support" link as a placeholder;
  dynamic plan-upgrade actions are out of scope.
- **OQ-003**: What is the expected set of provisioning-state components? Suggested initial list:
  `storage`, `databases`, `messaging`, `functions`, `realtime`. This should be confirmed with the
  tenant-lifecycle design.
