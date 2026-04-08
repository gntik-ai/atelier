# Feature Specification: US-OBS-03-T01 — Usage Consumption Calculation per Tenant and Workspace

**Feature Branch**: `037-observability-usage-consumption`
**Task**: `US-OBS-03-T01`
**Epic**: EP-13 — Cuotas, metering, auditoría y observabilidad
**Story**: US-OBS-03 — Metering, cuotas, alertas y estado de aprovisionamiento
**Requirements traceability**: RF-OBS-009, RF-OBS-010, RF-OBS-011, RF-OBS-012, RF-OBS-013, RF-OBS-014, RF-OBS-015, RF-OBS-019
**Dependencies**: US-PLAN-01, US-TEN-01
**Intra-story dependencies**: None
**Created**: 2026-03-28
**Status**: Specified

---

## Problem Statement

The platform already publishes business metrics (defined by US-OBS-01-T04) that capture activity
signals — API requests, function invocations, storage volume, data-service operations, realtime
connections, and topic/collection counts. However, there is no unified **consumption calculation
layer** that aggregates those raw signals into per-tenant and per-workspace usage snapshots that can
be compared against quota policies.

Without this layer:

- Quota enforcement is purely static configuration with no connection to real usage.
- Operators cannot answer "how much of its quota has tenant X consumed?".
- Downstream tasks (quota policies, alerting, blocking, and console views) have no authoritative
  usage source to rely on.

This task introduces the **consumption calculation baseline**: the internal capability that reads
business metric signals and materializes structured usage snapshots scoped by tenant and workspace.

---

## Users and Value

| Actor | Value received |
| --- | --- |
| **Superadmin / SRE** | Can query real consumption per tenant and workspace across all metered dimensions; replaces guesswork with measured data. |
| **Security** | Consumption data is tenant-isolated and auditable; no cross-tenant leakage of usage figures. |
| **Tenant owner** | Foundation for later visibility into "how much am I using and why am I blocked" (exposed by T05). |
| **Downstream platform tasks** | T02 (quota policies), T03 (alerts), T04 (blocking), T05 (console view), T06 (tests) all consume the usage snapshots produced here. |

---

## User Scenarios & Testing

### User Story 1 — Platform operator queries tenant consumption (Priority: P1)

A superadmin or SRE needs to know the current consumption posture of a specific tenant across all
metered resource dimensions to assess capacity pressure and plan governance actions.

**Why this priority**: Without a queryable tenant-level usage snapshot, no downstream quota,
alerting, or blocking behavior can function.

**Independent Test**: Query the usage snapshot for a tenant that has recorded API calls, function
invocations, and storage volume. The response includes measured values for every metered dimension
with timestamps.

**Acceptance Scenarios**:

1. **Given** a tenant with recorded activity across multiple subsystems,
   **When** the platform queries the tenant-level usage snapshot,
   **Then** the response includes one usage entry per metered dimension with the current measured
   value, unit, and snapshot timestamp.

2. **Given** a tenant with no recorded activity in a particular dimension,
   **When** the platform queries the tenant-level usage snapshot,
   **Then** that dimension appears with a zero or absent value and the snapshot timestamp still
   reflects when the calculation was performed.

3. **Given** two tenants with independent activity,
   **When** tenant A's usage snapshot is queried,
   **Then** no data from tenant B is included in the response.

---

### User Story 2 — Platform operator queries workspace-level consumption (Priority: P1)

A superadmin or SRE needs workspace-level granularity to understand which workspace within a tenant
drives the most consumption.

**Why this priority**: Quota policies may apply at workspace scope; without workspace-level
snapshots, workspace-scoped enforcement is impossible.

**Independent Test**: Query workspace-level usage for a tenant with two workspaces that have
different activity levels. The snapshots reflect distinct values per workspace.

**Acceptance Scenarios**:

1. **Given** a tenant with workspaces W1 and W2 where W1 has more API calls,
   **When** workspace-level usage snapshots are queried for both,
   **Then** W1 shows a higher `api_requests` value than W2.

2. **Given** a workspace with storage activity but no function invocations,
   **When** the workspace usage snapshot is queried,
   **Then** storage dimensions have measured values while function dimensions are zero or absent.

---

### User Story 3 — Consumption calculation covers all metered dimensions (Priority: P1)

The consumption layer must calculate usage for every resource dimension the platform meters, so that
quota policies can reference any of them.

**Why this priority**: Partial dimension coverage would leave gaps where quotas cannot be backed by
real data.

**Independent Test**: Generate activity in each metered dimension and verify the usage snapshot
includes all of them.

**Acceptance Scenarios**:

1. **Given** a tenant with activity in API requests, function invocations, storage volume, logical
   databases, topics, collections/tables, realtime connections, and error counts,
   **When** the tenant usage snapshot is calculated,
   **Then** every dimension listed in the metered dimensions catalog appears with a measured value.

---

### User Story 4 — Usage snapshots are periodically refreshed (Priority: P2)

Consumption snapshots must be recalculated at a defined cadence so that quota comparisons reflect
reasonably current usage rather than stale data.

**Why this priority**: Near-real-time accuracy is important for enforcement but the exact refresh
strategy is secondary to having the dimensions and isolation correct.

**Independent Test**: After new activity occurs, wait for the next refresh cycle and verify that
the snapshot values have increased.

**Acceptance Scenarios**:

1. **Given** a tenant whose last snapshot shows 1 000 API requests,
   **When** 500 additional API requests are recorded and the next refresh cycle completes,
   **Then** the updated snapshot shows approximately 1 500 API requests (within the expected
   collection and aggregation tolerance).

2. **Given** that the refresh cycle has not completed,
   **When** a snapshot is queried,
   **Then** the response includes the timestamp of the last successful calculation so the caller
   can assess staleness.

---

### Edge Cases

- **Tenant with no workspaces yet**: The tenant-level snapshot still calculates; workspace-level
  snapshots return empty.
- **Workspace recently deleted**: Usage from a deleted workspace is no longer counted in the
  tenant-level snapshot after the next refresh cycle. Historical snapshots are not retroactively
  modified.
- **Metric collection gap**: If the underlying business metric is stale (as indicated by
  `in_falcone_observability_collection_health`), the usage snapshot for the affected dimension must
  signal that the value may be stale rather than silently returning a stale number as current.
- **Dimension not applicable to plan**: If a tenant's plan does not include a capability (e.g.,
  functions), the consumption calculation may omit that dimension or return zero, but must not fail.
- **Very high tenant count**: The calculation must remain bounded and must not degrade platform
  performance for other tenants.
- **Clock skew / late-arriving metrics**: The snapshot must declare its observation window so
  consumers understand the temporal scope of the measurement.

---

## Requirements

### Metered Dimensions Catalog

The consumption calculation layer must support the following resource dimensions, aligned with the
business metric families established by US-OBS-01-T04:

| Dimension key | Description | Scope | Source metric family |
| --- | --- | --- | --- |
| `api_requests` | Total API requests processed | tenant, workspace | `in_falcone_api_requests_total` |
| `function_invocations` | Total serverless function invocations | tenant, workspace | `in_falcone_function_invocations_total` |
| `storage_volume_bytes` | Logical storage volume in bytes | tenant, workspace | `in_falcone_storage_logical_volume_bytes` |
| `data_service_operations` | Total data-service operations (PG + Mongo) | tenant, workspace | `in_falcone_data_service_operations_total` |
| `realtime_connections` | Peak concurrent realtime connections | tenant, workspace | `in_falcone_realtime_connections_active` |
| `logical_databases` | Count of provisioned logical databases | tenant, workspace | derived from control-plane inventory |
| `topics` | Count of provisioned Kafka topics | tenant, workspace | derived from control-plane inventory |
| `collections_tables` | Count of provisioned collections/tables | tenant, workspace | derived from control-plane inventory |
| `error_count` | Total error responses across subsystems | tenant, workspace | `in_falcone_component_operation_errors_total` |

### Functional Requirements

- **FR-001**: The system MUST calculate a usage snapshot per tenant that aggregates measured values
  for every dimension in the metered dimensions catalog.
- **FR-002**: The system MUST calculate a usage snapshot per workspace that attributes measured
  values to the specific workspace for every applicable dimension.
- **FR-003**: The tenant-level snapshot MUST equal the sum of its workspace-level snapshots for
  counter and gauge dimensions (where mathematically appropriate), ensuring consistency.
- **FR-004**: Each usage snapshot MUST include a snapshot timestamp indicating when the calculation
  was performed and an observation window indicating the temporal scope of the underlying data.
- **FR-005**: The system MUST refresh usage snapshots at a configurable cadence. The default cadence
  MUST be no longer than 5 minutes.
- **FR-006**: When the underlying metric source for a dimension is stale or unavailable (as
  indicated by collection-health meta-metrics), the snapshot MUST mark that dimension's freshness
  status as degraded rather than reporting a stale value as current.
- **FR-007**: The system MUST expose usage snapshots through an internal query surface so that
  downstream tasks (quota policies, alerting, blocking, console views) can consume them without
  directly querying the metrics backend.
- **FR-008**: The usage snapshot response MUST include the unit of measurement for each dimension
  (e.g., `count`, `bytes`, `connections`).
- **FR-009**: Resource-count dimensions (logical databases, topics, collections/tables) MUST be
  derived from the control-plane resource inventory rather than from approximate metric counters,
  ensuring exact counts.
- **FR-010**: The calculation MUST NOT introduce labels or data that would allow cross-tenant usage
  comparison at the tenant-facing layer. Tenant A's snapshot MUST NOT contain or reveal information
  about tenant B.

### Multi-Tenancy and Isolation

- Usage snapshots are strictly scoped by tenant. A tenant-level query returns only that tenant's
  data.
- Workspace-level snapshots are scoped by tenant and workspace. No workspace from a different
  tenant can appear.
- Platform-scoped aggregation (all tenants) is restricted to superadmin and SRE roles.
- The internal query surface must enforce scope isolation.

### Audit and Traceability

- Every snapshot calculation cycle MUST produce an auditable record indicating: which tenants were
  calculated, the cycle timestamp, and whether any dimensions were marked degraded.
- Snapshot audit records must be compatible with the audit pipeline established by US-OBS-02 tasks.

### Security

- Usage data is internal operational data. It MUST NOT be exposed on public API routes without
  explicit authorization checks that respect the contextual authorization model (ADR 0005).
- Forbidden labels from the metrics stack (user_id, session_id, request_id, etc.) MUST NOT leak
  into usage snapshot responses.

### Key Entities

- **Usage Snapshot**: A point-in-time record of measured consumption for one tenant or workspace.
  Contains: scope (tenant/workspace), scope identifiers, dimension entries (key, value, unit,
  freshness status), snapshot timestamp, observation window.
- **Metered Dimension**: A named, cataloged resource type that the platform measures. Contains:
  dimension key, description, supported scopes, source metric or inventory reference, unit.
- **Snapshot Cycle**: A scheduled calculation run that reads metrics and inventory data and produces
  or updates usage snapshots. Contains: cycle ID, start/end timestamps, tenants processed, degraded
  dimensions (if any).

---

## Scope Boundaries

### In scope

- Defining the metered dimensions catalog for this task.
- Calculating and materializing usage snapshots per tenant and per workspace.
- Exposing an internal query surface for downstream consumers.
- Handling staleness and degraded metric sources.
- Audit records for calculation cycles.

### Out of scope

- **Quota policy definition and enforcement modes** → US-OBS-03-T02
- **Alert emission when thresholds are exceeded** → US-OBS-03-T03
- **Blocking resource creation on hard quota breach** → US-OBS-03-T04
- **Console view of usage vs. quota** → US-OBS-03-T05
- **End-to-end consumption and enforcement tests** → US-OBS-03-T06
- **Billing or cost attribution** — not in scope for EP-13.
- **Historical usage trending or analytics** — this task produces current snapshots, not time-series
  history.

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: For a tenant with activity across all metered dimensions, the usage snapshot returns
  a non-zero measured value for every applicable dimension within one refresh cycle.
- **SC-002**: Tenant-level and workspace-level snapshots are internally consistent — the tenant
  total for a counter dimension equals the sum of its workspace breakdowns.
- **SC-003**: When a metric source becomes stale, the affected dimension in the usage snapshot is
  marked degraded within the next refresh cycle.
- **SC-004**: Usage snapshots for tenant A contain zero information about tenant B, verified by
  inspection of the response payload.
- **SC-005**: The refresh cycle completes within the configured cadence (default ≤ 5 minutes) for
  the expected tenant population without degrading platform responsiveness.
- **SC-006**: Each calculation cycle produces an auditable record that can be queried through the
  audit pipeline.

---

## Risks, Assumptions, and Open Questions

### Assumptions

- The business metric families from US-OBS-01-T04 are already emitting data for the metered
  subsystems. If they are not yet active, this task's snapshots will correctly report zero/absent
  with degraded freshness rather than failing.
- The domain governance model (ADR 0007) provides the quota policy entity and governance states
  (`nominal`, `warning`, `throttled`, `blocked`) that downstream tasks will use. This task produces
  the usage input; it does not evaluate governance state transitions.
- Control-plane inventory APIs for logical databases, topics, and collections/tables exist or will
  exist as part of their respective feature implementations.

### Risks

- **Metric lag**: If business metrics arrive with significant delay, the usage snapshot may
  under-report recent activity. Mitigation: staleness marking and observation window metadata.
- **Cardinality at scale**: With many tenants and workspaces, the calculation cycle must remain
  efficient. The plan phase should address batching and concurrency strategy.

### Open Questions

- None currently blocking specification. The refresh cadence default (5 minutes) is a starting
  recommendation; it can be adjusted during planning without changing the specification.
