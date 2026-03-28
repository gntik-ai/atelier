# Feature Specification: Storage Usage Reporting

**Feature Branch**: `020-storage-usage-reporting`
**Task**: US-STO-03-T02
**Epic**: EP-12 — Storage S3-compatible
**Story**: US-STO-03 — Credenciales programáticas, uso agregado, import/export y auditoría de storage
**Requirements traceability**: RF-STO-015, RF-STO-016
**Dependencies**: US-STO-01 (full chain: specs 007–012), US-STO-03-T01 (spec 019), US-OBS-03
**Created**: 2026-03-28
**Status**: Specified

## Repo-local dependency map

| Concern | Module / Path | Relevance |
|---|---|---|
| Quota dimensions & admission | `services/adapters/src/storage-capacity-quotas.mjs` | Defines `STORAGE_QUOTA_DIMENSIONS` (total_bytes, bucket_count, object_count, object_size_bytes), `STORAGE_QUOTA_SCOPE_TYPES` (tenant, workspace), `buildStorageQuotaProfile`, `buildStorageQuotaScopeStatus`. Usage reporting reads the same dimension vocabulary and scope model. |
| Tenant storage context | `services/adapters/src/storage-tenant-context.mjs` | `buildTenantStorageContextRecord`, `buildTenantStorageContextIntrospection`. Provides tenant-level storage metadata (provider type, quota assignment) that anchors aggregated usage. |
| Bucket & object records | `services/adapters/src/storage-bucket-object-ops.mjs` | `buildStorageBucketRecord`, `buildStorageBucketSummary`, `buildStorageObjectCollection`. Bucket-level metadata that usage reporting aggregates per bucket. |
| Storage admin control plane | `apps/control-plane/src/storage-admin.mjs` | Admin surface that re-exports tenant context, quota, bucket ops, and credential modules. Usage reporting endpoints will be added here. |
| Scoped credentials (spec 019) | `services/adapters/src/storage-programmatic-credentials.mjs` | Credential-attributed operations must be countable in per-credential usage breakdowns. |
| Error taxonomy | `services/adapters/src/storage-error-taxonomy.mjs` | Normalized error codes for usage reporting errors (invalid scope, snapshot unavailable). |
| Event notifications | `services/adapters/src/storage-event-notifications.mjs` | Usage threshold events follow the same event structure conventions. |
| Provider profile | `services/adapters/src/storage-provider-profile.mjs` | Provider-level capability awareness; usage collection may depend on provider admin API capabilities. |
| Existing tests | `tests/unit/storage-capacity-quotas.test.mjs`, `tests/adapters/storage-capacity-quotas.test.mjs` | Test patterns and runner conventions (`node --test`). |

---

## 1. Objective and Problem Statement

The storage subsystem enforces capacity guardrails through `storage-capacity-quotas` (spec `015`), which evaluates whether a proposed operation would exceed configured limits. Scoped programmatic credentials (spec `019`) enable per-principal storage access with audit attribution. However, neither surface provides **visibility into actual consumption** — how much storage a tenant, workspace, or individual bucket is using over time.

Without this task:

- **Tenant owners** cannot see how much of their allocated storage capacity is consumed, nor which workspaces or buckets are the largest consumers.
- **Workspace admins** have no way to identify which buckets are growing fastest or approaching capacity limits, making proactive capacity management impossible.
- **Developers** building on the platform cannot programmatically query their workspace's storage footprint for dashboards, billing integration, or automation.
- **Superadmins** lack a cross-tenant view of storage utilization for capacity planning, abuse detection, and platform-wide reporting.
- The console cannot display storage consumption because no structured usage data surface exists.
- Quota guardrails accept usage as an external input (`tenantUsage`, `workspaceUsage` parameters in `buildStorageQuotaProfile`) but the platform does not provide a canonical source for those values.

This task introduces **storage usage reporting** — a structured, scope-aware surface that exposes aggregated and per-bucket storage consumption through the API and console, using the same dimension vocabulary as the quota guardrail system.

---

## 2. Users, Consumers, and Value

### Direct consumers

- **Workspace admins** need to see how much storage each bucket in their workspace consumes (bytes, object count), identify top consumers, and track trends to proactively manage capacity before hitting quota limits.
- **Tenant owners** need an aggregated view of storage consumption across all workspaces in their tenant, broken down by workspace and by bucket, to govern capacity allocation and justify quota changes.
- **Developers** need a programmatic API to query storage usage for a workspace or bucket, enabling integration with custom dashboards, billing pipelines, CI/CD gates, and automation scripts.
- **Superadmins** need cross-tenant usage summaries for platform-wide capacity planning, anomaly detection, and operational reporting.
- **Console UI** needs structured usage data to render storage dashboards with consumption bars, top-bucket lists, and usage-over-time indicators.
- **Quota guardrail system** (`storage-capacity-quotas`) needs a canonical usage source to replace the current external-input pattern, enabling self-contained admission decisions.

### Value delivered

- Provides visibility into actual storage consumption at every scope level (tenant, workspace, bucket).
- Enables proactive capacity management — teams can act before hitting hard limits.
- Creates the canonical usage data source that quota guardrails can reference for accurate admission decisions.
- Supports console storage dashboards without requiring the frontend to query the storage provider directly.
- Enables per-bucket consumption attribution for cost allocation and chargeback scenarios.

---

## 3. In-Scope Capability

This task covers the **collection, aggregation, and exposure of storage usage data** through the platform API and as structured data for the console, at tenant, workspace, and bucket scope levels.

### In scope

- Building a storage usage snapshot for a specific scope (tenant, workspace, or bucket) that reports consumption along the same dimensions as the quota system: total bytes, bucket count, object count, and largest object size.
- Aggregating usage across workspaces within a tenant and across buckets within a workspace.
- Per-bucket usage breakdown: bytes consumed and object count for each bucket in a workspace or tenant.
- Usage-to-quota comparison: each usage snapshot includes the corresponding quota limits, remaining capacity, and utilization percentage per dimension, enabling the consumer to render quota bars and alerts.
- Top-N bucket ranking by bytes consumed and by object count within a scope.
- Usage freshness metadata: each snapshot reports when the usage data was collected and the collection method (provider API, cached snapshot, platform estimate).
- API surface for workspace admins, tenant owners, and superadmins to query usage at their authorized scope.
- Console-ready structured responses that the React frontend can consume to render storage dashboards.
- Audit event for usage report generation (who queried what scope, when).
- Usage threshold detection: a pure function that, given a usage snapshot and quota profile, identifies dimensions that exceed configurable warning thresholds (e.g., 80%, 90% utilization) and produces structured threshold-breach records.

### Out of scope

- **US-STO-03-T01**: Scoped programmatic credentials (already specified in spec 019).
- **US-STO-03-T03**: Object and metadata import/export.
- **US-STO-03-T04**: Full data-plane audit schema for storage operations.
- **US-STO-03-T05**: Credential rotation/revocation test suite.
- **US-STO-03-T06**: Documentation of limits, SLAs, and cost considerations.
- Background metering jobs, persistent time-series storage, or asynchronous usage reconciliation pipelines (future operational concern; this task provides the snapshot surface).
- Billing integration or monetary cost calculations.
- Historical usage trend storage (the snapshot is point-in-time; persistence of snapshots for trend analysis is a separate concern).
- Console UI implementation (this task defines the data contract; the React components are a separate task).
- Provider-side quota enforcement changes.

---

## 4. User Scenarios & Testing

### User Story 1 — Workspace admin views aggregated workspace storage usage (Priority: P1)

A workspace admin queries the storage usage for their workspace and receives a snapshot showing total bytes consumed, total object count, bucket count, and per-bucket breakdown, alongside the applicable quota limits and utilization percentages.

**Why this priority**: This is the foundational usage reporting surface — it provides the minimum viable visibility that all other reporting layers build upon.

**Independent Test**: A workspace admin requests usage for workspace W, receives a structured snapshot with aggregated dimensions and per-bucket entries, and the totals are consistent (sum of per-bucket bytes equals the aggregated total bytes).

**Acceptance Scenarios**:

1. **Given** workspace W in tenant T has 3 buckets (B1: 500 MB / 1000 objects, B2: 200 MB / 300 objects, B3: 50 MB / 50 objects) and a workspace quota of 1 GB / 5 buckets / 5000 objects, **When** the workspace admin requests usage for W, **Then** the response includes an aggregated snapshot with `totalBytes: 750 MB`, `objectCount: 1350`, `bucketCount: 3`, the quota limits for each dimension, remaining capacity (`250 MB`, `2 buckets`, `3650 objects`), utilization percentages (`75%`, `60%`, `27%`), and a per-bucket breakdown listing B1, B2, B3 with their individual consumption.
2. **Given** workspace W has no buckets, **When** the workspace admin requests usage for W, **Then** the response includes an aggregated snapshot with all consumption dimensions at zero, per-bucket breakdown as an empty list, and utilization at 0% for all dimensions.
3. **Given** the workspace admin is a member of workspace W but not workspace W2, **When** the admin requests usage for W2, **Then** the request is rejected with an authorization error — usage data respects workspace-boundary isolation.

---

### User Story 2 — Tenant owner views aggregated tenant storage usage (Priority: P1)

A tenant owner queries storage usage for their entire tenant and receives an aggregated snapshot with per-workspace and per-bucket breakdowns, plus tenant-level quota comparison.

**Why this priority**: Tenant-level visibility is required for capacity governance across workspaces. Without it, tenant owners cannot make informed decisions about quota allocation.

**Independent Test**: A tenant owner requests usage for tenant T, receives aggregated dimensions plus per-workspace subtotals that sum to the tenant total.

**Acceptance Scenarios**:

1. **Given** tenant T has 2 workspaces (W1: 750 MB / 1350 objects / 3 buckets, W2: 400 MB / 800 objects / 2 buckets) and tenant quota of 2 GB / 10 buckets, **When** the tenant owner requests usage for T, **Then** the response includes tenant-level aggregation (`totalBytes: 1150 MB`, `objectCount: 2150`, `bucketCount: 5`), tenant quota limits, utilization percentages, and a per-workspace breakdown with each workspace's subtotals.
2. **Given** tenant T has workspaces but the tenant owner requests a detailed breakdown, **When** the response includes the per-workspace breakdown, **Then** each workspace entry also includes its per-bucket breakdown (nested), enabling drill-down from tenant → workspace → bucket.
3. **Given** tenant T has workspace-level quota overrides on W1, **When** the tenant owner views W1's entry in the tenant usage report, **Then** both the tenant-level limits and the workspace-specific overrides are visible in the response.

---

### User Story 3 — Developer queries per-bucket usage via API (Priority: P1)

A developer uses the API to query usage for a specific bucket and receives its consumption metrics, enabling programmatic integration with dashboards, alerts, and automation.

**Why this priority**: Per-bucket granularity is the atomic unit of usage data. Developers need it for automation and integration.

**Independent Test**: A developer requests usage for bucket B1 in workspace W and receives the bucket's byte consumption, object count, and largest object size.

**Acceptance Scenarios**:

1. **Given** bucket B1 in workspace W contains 500 MB across 1000 objects with the largest object being 50 MB, **When** the developer requests usage for B1, **Then** the response includes `totalBytes: 500 MB`, `objectCount: 1000`, `largestObjectSizeBytes: 50 MB`, the timestamp of the snapshot, and the collection method.
2. **Given** bucket B1 has a bucket-level policy restricting the developer to `object.get` only, **When** the developer requests usage for B1, **Then** usage read is allowed — usage visibility is granted to any principal with read access to the bucket. Usage is a read-only, non-data-plane operation.
3. **Given** bucket B1 does not exist, **When** the developer requests usage for B1, **Then** the request returns a structured error with code `BUCKET_NOT_FOUND`.

---

### User Story 4 — Usage threshold detection (Priority: P1)

The platform evaluates a usage snapshot against configurable warning thresholds and produces structured threshold-breach records that the console or alerting systems can consume.

**Why this priority**: Threshold detection is the bridge between passive reporting and proactive capacity management. Without it, users must manually compare usage to limits.

**Independent Test**: Given a usage snapshot where one dimension exceeds 80% utilization, the threshold evaluation produces a breach record for that dimension with the correct severity and utilization percentage.

**Acceptance Scenarios**:

1. **Given** workspace W has `totalBytes` utilization at 85% and `objectCount` utilization at 40%, and warning thresholds are configured at 80% (warning) and 95% (critical), **When** the threshold evaluation runs, **Then** it produces one breach record for `totalBytes` at severity `warning` (85%) and no breach for `objectCount`.
2. **Given** workspace W has `bucketCount` utilization at 100% (4/4 buckets), **When** the threshold evaluation runs with thresholds at 80% / 95%, **Then** it produces a breach record for `bucketCount` at severity `critical` (100%).
3. **Given** a dimension has no configured limit (limit is `null`), **When** the threshold evaluation runs, **Then** that dimension is skipped — no breach record is produced for unlimited dimensions.
4. **Given** custom thresholds are provided (e.g., 70% warning, 90% critical), **When** the evaluation runs, **Then** the custom thresholds override the defaults for that evaluation.

---

### User Story 5 — Superadmin views cross-tenant usage summary (Priority: P2)

A superadmin queries a cross-tenant usage summary for platform-wide capacity planning and anomaly detection.

**Why this priority**: Cross-tenant visibility is a platform-operations concern. It is less frequent than tenant/workspace-level reporting but essential for capacity planning and abuse detection.

**Independent Test**: A superadmin requests a cross-tenant summary and receives a list of tenants with their aggregated storage consumption, sorted by total bytes descending.

**Acceptance Scenarios**:

1. **Given** the platform has 3 tenants (T1: 5 GB, T2: 2 GB, T3: 800 MB), **When** the superadmin requests a cross-tenant usage summary, **Then** the response includes each tenant's aggregated `totalBytes`, `objectCount`, `bucketCount`, quota limits, and utilization percentages, sorted by `totalBytes` descending.
2. **Given** the superadmin requests the top 2 tenants by storage consumption, **When** the response is returned, **Then** only T1 and T2 appear (Top-N filtering).
3. **Given** tenant T1 has been suspended, **When** the superadmin requests the cross-tenant summary, **Then** T1 still appears in the summary with its last known usage (suspension does not erase usage data) and its status is indicated as `suspended`.

---

### User Story 6 — Top-N bucket ranking within a scope (Priority: P2)

A workspace admin or tenant owner requests the top N buckets by consumption (bytes or object count) within their scope, enabling quick identification of storage hotspots.

**Why this priority**: Top-N ranking is a convenience layer over the per-bucket breakdown that simplifies hotspot identification at scale.

**Independent Test**: A workspace admin requests the top 3 buckets by bytes in workspace W and receives exactly 3 entries sorted by bytes descending.

**Acceptance Scenarios**:

1. **Given** workspace W has 10 buckets, **When** the workspace admin requests top 3 by bytes, **Then** the response includes the 3 buckets with the highest `totalBytes`, sorted descending, each with their byte consumption and object count.
2. **Given** workspace W has only 2 buckets and top 5 is requested, **When** the response is returned, **Then** it includes only the 2 existing buckets (no padding or error).
3. **Given** the tenant owner requests top 5 buckets across the entire tenant (all workspaces), **When** the response is returned, **Then** buckets from any workspace in the tenant can appear, each annotated with their workspace identifier.

---

### User Story 7 — Console renders storage dashboard from usage API (Priority: P2)

The console frontend requests the structured usage data for the active workspace and renders a storage dashboard with quota utilization bars, per-bucket breakdown table, and threshold alerts.

**Why this priority**: Console integration is a primary user-facing deliverable, but depends on the API surface being stable first.

**Independent Test**: The API response for workspace usage contains all fields needed by the console to render utilization bars (used, limit, percentage), bucket table (name, bytes, objects), and threshold alerts (breach records) — without requiring client-side computation beyond formatting.

**Acceptance Scenarios**:

1. **Given** the console requests workspace usage for W, **When** the API responds, **Then** the response includes: aggregated dimensions with `used`, `limit`, `remaining`, `utilizationPercent` for each dimension; a `buckets` array with per-bucket `name`, `totalBytes`, `objectCount`; a `thresholdBreaches` array (possibly empty); and `snapshotAt` timestamp.
2. **Given** the console requests workspace usage and a threshold breach exists, **When** the response includes a breach record, **Then** the record contains `dimension`, `severity` (`warning` or `critical`), `utilizationPercent`, and `thresholdPercent`, enabling the console to render a contextual alert without additional logic.

---

### Edge Cases

- **Empty tenant (no workspaces)**: Usage snapshot returns zero for all dimensions, empty workspace breakdown, and empty per-bucket breakdown. No threshold breaches.
- **Workspace with deleted buckets**: Usage reflects only currently existing buckets. Deleted buckets do not contribute to the aggregated totals. If the provider's admin API includes deleted-bucket residual data, it MUST be excluded from the usage snapshot.
- **Quota limit not configured (null limit)**: Utilization percentage is reported as `null` (not 0% or 100%). Threshold detection skips that dimension. Remaining capacity is reported as `null`.
- **Usage exceeds quota (over-quota state)**: If actual consumption already exceeds the configured limit (e.g., limit was reduced after data was written), the snapshot reports the real usage, the utilization percentage exceeds 100%, and the threshold breach is reported at `critical` severity. The usage surface does not trigger enforcement — that remains the responsibility of `storage-capacity-quotas` admission checks.
- **Provider API unavailable**: If the underlying storage provider's admin API is unreachable when usage collection is attempted, the usage snapshot MUST include a `collectionStatus` of `provider_unavailable` and MAY return stale cached data if available, with the cache timestamp clearly indicated. The response MUST NOT fail silently with zero values.
- **Concurrent usage changes during snapshot**: The usage snapshot is a point-in-time best-effort view. The specification does not require transactional consistency across buckets within a single snapshot. Each bucket's data may reflect a slightly different instant. The `snapshotAt` timestamp represents when the collection began.
- **Bucket with zero objects**: Appears in the per-bucket breakdown with `totalBytes: 0`, `objectCount: 0`. Not excluded.
- **Cross-workspace credential usage attribution**: Per-credential usage breakdown is a future enhancement. This spec provides per-bucket and per-scope aggregation, not per-credential disaggregation.

---

## 5. Functional Requirements

### Usage Snapshot Construction

- **FR-001**: The system MUST provide a function to build a storage usage snapshot for a given scope (tenant, workspace, or bucket) that reports consumption along the dimensions: total bytes, bucket count, object count, and largest object size.
- **FR-002**: Each dimension in the usage snapshot MUST include: `used` (current consumption), `limit` (configured quota limit or `null` if unconfigured), `remaining` (limit - used, or `null` if limit is `null`), and `utilizationPercent` (used / limit × 100, rounded to two decimal places, or `null` if limit is `null`).
- **FR-003**: The usage snapshot MUST include a `snapshotAt` ISO-8601 timestamp indicating when collection began, and a `collectionMethod` field indicating the data source (`provider_admin_api`, `cached_snapshot`, `platform_estimate`).
- **FR-004**: The dimension vocabulary MUST align with `STORAGE_QUOTA_DIMENSIONS` from `storage-capacity-quotas.mjs`: `total_bytes`, `bucket_count`, `object_count`, `object_size_bytes`.

### Aggregation & Breakdown

- **FR-005**: A workspace-scope usage snapshot MUST include a `buckets` array listing every bucket in the workspace with its individual `totalBytes`, `objectCount`, `largestObjectSizeBytes`, and bucket identifier.
- **FR-006**: A tenant-scope usage snapshot MUST include a `workspaces` array listing every workspace in the tenant with its aggregated subtotals, and each workspace entry MUST include its per-bucket breakdown.
- **FR-007**: The sum of per-bucket `totalBytes` within a workspace MUST equal the workspace's aggregated `totalBytes`. The same additive consistency applies to `objectCount` and `bucketCount`.
- **FR-008**: A cross-tenant summary (superadmin scope) MUST list tenants with their aggregated consumption, quota limits, and utilization, sorted by a caller-specified dimension (default: total bytes descending). It supports Top-N filtering.

### Usage-to-Quota Integration

- **FR-009**: The usage snapshot MUST incorporate quota limits from the same sources as `buildStorageQuotaProfile` — tenant storage context (`quotaAssignment`), workspace overrides, and provider constraints — ensuring consistency between the usage report and the quota guardrail system.
- **FR-010**: The usage snapshot response MUST be directly usable as the `tenantUsage` / `workspaceUsage` input to `buildStorageQuotaProfile`, enabling the quota system to consume the canonical usage source without transformation.

### Threshold Detection

- **FR-011**: The system MUST provide a pure function that, given a usage snapshot and a set of threshold percentages (default: 80% warning, 95% critical), produces an array of threshold-breach records.
- **FR-012**: Each threshold-breach record MUST include: `dimension`, `scope`, `scopeId`, `utilizationPercent`, `severity` (`warning` or `critical`), `thresholdPercent`, `used`, and `limit`.
- **FR-013**: Dimensions with no configured limit (`null`) MUST be skipped — no breach record is produced.
- **FR-014**: Utilization exceeding 100% MUST produce a `critical` severity breach regardless of the configured thresholds.

### Top-N Ranking

- **FR-015**: The system MUST provide a function that, given a usage snapshot containing per-bucket breakdowns, returns the top N buckets sorted by a specified dimension (total bytes or object count), descending.
- **FR-016**: If fewer than N buckets exist, the result contains all buckets without padding or error.
- **FR-017**: Each top-N entry MUST include the bucket identifier, the workspace identifier (for tenant-scope queries), and the consumption values.

### Authorization & Multi-Tenant Isolation

- **FR-018**: Usage queries MUST enforce scope-based authorization: workspace admins see only their workspace's data, tenant owners see their tenant's data, superadmins see cross-tenant data.
- **FR-019**: Usage data (snapshots, breakdowns, threshold breaches) MUST be fully isolated by tenant boundary. No usage data from one tenant is visible or accessible to another tenant.
- **FR-020**: Within a tenant, usage data for a workspace is visible only to members of that workspace, the tenant owner, and superadmins.

### Audit

- **FR-021**: Every usage report generation MUST produce an audit event including: the requesting principal, the queried scope (tenant/workspace/bucket), the scope identifier, and a timestamp.
- **FR-022**: Audit events for usage queries MUST NOT include the full usage data payload — only the query metadata.

### Error Handling

- **FR-023**: If the storage provider's admin API is unavailable during usage collection, the system MUST return a usage snapshot with `collectionStatus: 'provider_unavailable'` and, if cached data exists, include it with the cache timestamp.
- **FR-024**: Requests for a non-existent scope (unknown tenant, workspace, or bucket) MUST return a structured error following the `storage-error-taxonomy` conventions.

### Key Entities

- **Storage Usage Snapshot**: A point-in-time view of storage consumption for a specific scope. Key attributes: scope type (tenant / workspace / bucket), scope identifier, dimension statuses (total bytes, bucket count, object count, largest object size — each with used, limit, remaining, utilization percent), per-sub-scope breakdown (buckets for workspace scope, workspaces for tenant scope), collection method, collection status, snapshot timestamp.
- **Threshold Breach Record**: A structured alert indicating that a usage dimension has crossed a configured warning or critical threshold. Key attributes: dimension, scope, severity, utilization percent, threshold percent, used, limit.
- **Top-N Bucket Entry**: A ranked bucket consumption record. Key attributes: bucket identifier, workspace identifier, dimension values, rank.

---

## 6. Business Rules and Governance

- The usage snapshot is a **read-only, non-enforcement surface**. It reports consumption but does not block operations — enforcement remains the responsibility of `storage-capacity-quotas` admission checks.
- Usage data respects the same scope hierarchy as quota governance: tenant → workspace → bucket. There is no mechanism to query cross-tenant data except through the superadmin scope.
- The dimension vocabulary (`total_bytes`, `bucket_count`, `object_count`, `object_size_bytes`) is shared with the quota guardrail system and MUST NOT diverge.
- Threshold detection is a pure, stateless function — it does not persist alerts or trigger side effects. Consumers (console, notification systems) are responsible for acting on breach records.
- Usage snapshots are point-in-time and eventually consistent. The platform does not guarantee that a snapshot reflects the absolute latest state of every bucket simultaneously.
- The `collectionMethod` field provides transparency about data freshness. Consumers SHOULD treat `cached_snapshot` data as potentially stale and display the cache timestamp to users.
- Per-bucket breakdowns MUST include all buckets in scope, including empty ones. Omitting empty buckets would create a misleading view of the workspace's bucket count.

---

## 7. Acceptance Criteria

1. A workspace admin can query usage for their workspace and receive a snapshot with aggregated dimensions (total bytes, object count, bucket count) and per-bucket breakdown, each dimension showing used, limit, remaining, and utilization percent.
2. A tenant owner can query usage for their tenant and receive a snapshot with tenant-level aggregation and per-workspace breakdown (each workspace including its per-bucket breakdown).
3. A developer can query usage for a specific bucket and receive its byte consumption, object count, and largest object size.
4. The sum of per-bucket bytes within a workspace snapshot equals the workspace's aggregated total bytes. Same additive consistency for object count.
5. Usage threshold detection correctly identifies dimensions exceeding 80% (warning) and 95% (critical) utilization and produces structured breach records.
6. Dimensions with no configured limit produce `null` utilization and are skipped by threshold detection.
7. Over-quota states (utilization > 100%) are reported accurately and produce `critical` severity breaches.
8. Top-N bucket ranking returns the correct top N buckets sorted by the specified dimension, handling fewer-than-N gracefully.
9. Superadmins can query cross-tenant usage summaries with Top-N filtering.
10. Usage data is tenant-isolated: a workspace admin in tenant T1 cannot see any usage data from tenant T2.
11. Usage data is workspace-isolated within a tenant: a workspace admin for W1 cannot see W2's usage.
12. Every usage report generation produces an audit event with requesting principal, queried scope, and timestamp.
13. When the storage provider API is unavailable, the usage snapshot includes `collectionStatus: 'provider_unavailable'` and cached data if available — not silent zeroes.
14. The usage snapshot is directly consumable as input to `buildStorageQuotaProfile` for quota admission decisions.
15. Console-ready responses include all fields needed to render utilization bars, bucket tables, and threshold alerts without client-side computation beyond formatting.

---

## 8. Risks, Assumptions, and Open Questions

### Assumptions

- The S3-compatible storage provider exposes an admin API to retrieve per-bucket byte consumption and object count. MinIO, Ceph RGW, and Garage all support some form of bucket-level usage statistics via their admin APIs.
- The provider profile abstraction (spec `007`) can be extended to retrieve usage statistics, or a dedicated usage-collection adapter function will wrap the provider-specific admin API calls.
- The tenant storage context (spec `008`) provides sufficient metadata (provider type, admin credentials, tenant ID) to authenticate usage-collection calls against the storage provider.
- The quota assignment structure in `buildTenantStorageContextRecord` includes the limits needed for usage-to-quota comparison.
- The workspace and bucket permission model (spec `014`) can authorize usage-read operations as a non-data-plane action.

### Risks

- **Provider API heterogeneity for usage statistics**: Different S3-compatible providers expose usage data through different admin API endpoints with varying granularity and freshness guarantees. Mitigation: define the usage snapshot as a platform-normalized abstraction and implement per-provider collection adapters behind it, following the same pattern as `storage-provider-profile.mjs`.
- **Stale usage data**: Provider-reported usage may be delayed (eventual consistency at the provider level). Mitigation: expose `collectionMethod` and `snapshotAt` so consumers understand data freshness. Do not present usage data as real-time.
- **Large tenant with many buckets**: A tenant with hundreds of workspaces and thousands of buckets may produce large usage responses. Mitigation: support pagination in per-workspace and per-bucket breakdowns, and provide the Top-N ranking function as a lightweight alternative to full breakdowns.

### Blocking questions

None identified. The prerequisite surfaces (provider abstraction, tenant storage context, bucket/object records, quota guardrails) are specified or implemented.

---

## 9. Success Criteria

- **SC-001**: A workspace admin can retrieve a usage snapshot for their workspace with per-bucket breakdown in under 5 seconds for workspaces with up to 100 buckets.
- **SC-002**: Aggregated dimension totals are additively consistent with per-bucket subtotals — no unexplained discrepancies.
- **SC-003**: Threshold detection correctly identifies 100% of dimensions that exceed configured warning/critical thresholds, with zero false negatives.
- **SC-004**: Usage data is fully tenant-isolated — no cross-tenant data leakage (verifiable by automated authorization test).
- **SC-005**: The usage snapshot response is directly consumable by `buildStorageQuotaProfile` without transformation (verifiable by integration test).
