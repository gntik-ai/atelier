# Tasks: US-STO-03-T02 — Storage Usage Reporting

**Input**: `specs/020-storage-usage-reporting/spec.md`
**Feature Branch**: `020-storage-usage-reporting`
**Task**: US-STO-03-T02

---

## Phase 1 — Domain vocabulary and error taxonomy

- [ ] T001 Add `STORAGE_USAGE_COLLECTION_METHODS` frozen record to `services/adapters/src/storage-usage-reporting.mjs` (new file) with values: `provider_admin_api`, `cached_snapshot`, `platform_estimate`. Export it.
- [ ] T002 Add `STORAGE_USAGE_COLLECTION_STATUSES` frozen record to `storage-usage-reporting.mjs` with values: `ok`, `provider_unavailable`, `partial`. Export it.
- [ ] T003 Add `STORAGE_USAGE_THRESHOLD_SEVERITIES` frozen record to `storage-usage-reporting.mjs` with values: `warning`, `critical`. Export it.
- [ ] T004 Add `STORAGE_USAGE_ERROR_CODES` frozen record to `services/adapters/src/storage-error-taxonomy.mjs` with codes: `USAGE_SCOPE_NOT_FOUND`, `USAGE_PROVIDER_UNAVAILABLE`, `USAGE_INVALID_SCOPE`, `USAGE_UNAUTHORIZED`. Follow the existing `STORAGE_NORMALIZED_ERROR_CODES` naming convention. Export it.
- [ ] T005 Add `STORAGE_USAGE_THRESHOLD_DEFAULTS` frozen record to `storage-usage-reporting.mjs` with values: `{ warning: 80, critical: 95 }`. Export it.

---

## Phase 2 — Adapter: snapshot and dimension builders

- [ ] T006 Implement and export `buildStorageUsageDimensionStatus(input)` in `storage-usage-reporting.mjs`. Accepts `{ dimension, used, limit }`. Returns `{ dimension, used, limit, remaining, utilizationPercent }` where `remaining` is `limit - used` (or `null` if `limit` is `null`), and `utilizationPercent` is `Math.round((used / limit) * 10000) / 100` rounded to two decimal places (or `null` if `limit` is `null`). The `dimension` value MUST be one of `STORAGE_QUOTA_DIMENSIONS` (imported from `storage-capacity-quotas.mjs`).
- [ ] T007 Implement and export `buildStorageBucketUsageEntry(input)` in `storage-usage-reporting.mjs`. Returns `{ entityType: 'storage_bucket_usage_entry', bucketId, workspaceId, tenantId, totalBytes, objectCount, largestObjectSizeBytes }`. All numeric fields default to `0` when omitted.
- [ ] T008 Implement and export `buildStorageWorkspaceUsageEntry(input)` in `storage-usage-reporting.mjs`. Returns `{ entityType: 'storage_workspace_usage_entry', workspaceId, tenantId, totalBytes, objectCount, bucketCount, buckets }` where `buckets` is an array of `buildStorageBucketUsageEntry` records. Validates that the sum of `buckets[*].totalBytes` equals `totalBytes` and the sum of `buckets[*].objectCount` equals `objectCount`; throws a structured consistency error if not.
- [ ] T009 Implement and export `buildStorageUsageSnapshot(input)` in `storage-usage-reporting.mjs`. Accepts: `scopeType` (one of `STORAGE_QUOTA_SCOPE_TYPES`), `scopeId`, `tenantId`, `dimensions` (array of dimension status objects from `buildStorageUsageDimensionStatus`), `breakdown` (array of bucket or workspace entries depending on scope), `collectionMethod`, `collectionStatus`, `snapshotAt` (ISO-8601), `cacheSnapshotAt` (nullable ISO-8601). Returns a canonical snapshot record with `entityType: 'storage_usage_snapshot'`, a deterministic `snapshotId`. Validates that `collectionStatus` is `provider_unavailable` → `breakdown` MAY be empty but MUST NOT have all-zero values unless genuinely zero; if `cacheSnapshotAt` is null and status is `provider_unavailable`, `breakdown` MUST be an empty array.
- [ ] T010 Implement and export `buildStorageCrossTenantUsageSummary(input)` in `storage-usage-reporting.mjs`. Accepts `{ tenantSnapshots, sortDimension, topN }`. `tenantSnapshots` is an array of tenant-scope `buildStorageUsageSnapshot` records. Returns `{ entityType: 'storage_cross_tenant_usage_summary', tenants, sortDimension, topN, generatedAt }` where `tenants` is sorted descending by `sortDimension` (default `total_bytes`) and truncated to `topN` if specified. Each entry includes the tenant snapshot's aggregated dimension values, `quotaLimits`, `utilizationPercents`, and `status`.

---

## Phase 3 — Adapter: threshold detection and top-N ranking

- [ ] T011 Implement and export `buildStorageUsageThresholdBreach(input)` in `storage-usage-reporting.mjs`. Returns `{ entityType: 'storage_usage_threshold_breach', dimension, scopeType, scopeId, tenantId, utilizationPercent, severity, thresholdPercent, used, limit }`. All fields are required.
- [ ] T012 Implement and export `detectStorageUsageThresholdBreaches(input)` in `storage-usage-reporting.mjs`. Accepts `{ snapshot, thresholds }` where `thresholds` defaults to `STORAGE_USAGE_THRESHOLD_DEFAULTS`. Pure function — no side effects. Rules: (a) skip dimensions where `limit` is `null`; (b) if `utilizationPercent > 100`, always produce a breach with `severity: critical` and `thresholdPercent: thresholds.critical`; (c) else if `utilizationPercent >= thresholds.critical`, produce `severity: critical`; (d) else if `utilizationPercent >= thresholds.warning`, produce `severity: warning`; (e) otherwise no breach for that dimension. Returns an array (empty if no breaches).
- [ ] T013 Implement and export `rankBucketsByUsage(input)` in `storage-usage-reporting.mjs`. Accepts `{ buckets, sortDimension, topN }` where `sortDimension` is `total_bytes` or `object_count`. Returns up to `topN` bucket entries sorted descending by the specified dimension. If `buckets.length < topN` (or `topN` is unset), returns all buckets without padding or error. Each returned entry preserves its original `buildStorageBucketUsageEntry` shape plus a `rank` field (1-indexed).
- [ ] T014 Implement and export `buildStorageUsageAuditEvent(input)` in `storage-usage-reporting.mjs`. Returns `{ entityType: 'storage_usage_audit_event', eventType: 'storage.usage.queried', actorPrincipal, scopeType, scopeId, tenantId, timestamp }`. Assert that no usage payload data (dimensions, bytes, counts) is included in the event. Follows the audit event shape convention from `storage-event-notifications.mjs`.

---

## Phase 4 — Control-plane integration

- [ ] T015 Re-export `STORAGE_USAGE_COLLECTION_METHODS`, `STORAGE_USAGE_COLLECTION_STATUSES`, `STORAGE_USAGE_THRESHOLD_SEVERITIES`, `STORAGE_USAGE_THRESHOLD_DEFAULTS`, and `STORAGE_USAGE_ERROR_CODES` from `apps/control-plane/src/storage-admin.mjs` following the existing constant re-export conventions.
- [ ] T016 Add usage routes to the route table inside `storage-admin.mjs` (following the existing route entry pattern used for credential routes): `GET /v1/storage/tenants/{tenantId}/usage`, `GET /v1/storage/workspaces/{workspaceId}/usage`, `GET /v1/storage/workspaces/{workspaceId}/buckets/{bucketId}/usage`, `GET /v1/storage/usage/tenants`. Verify all four appear in `listStorageAdminRoutes()`.
- [ ] T017 Implement and export `previewWorkspaceStorageUsage(input)` in `storage-admin.mjs`. Composes `buildStorageUsageSnapshot` for `scopeType: workspace`, attaches threshold breaches via `detectStorageUsageThresholdBreaches`, returns `{ snapshot, thresholdBreaches, auditEvent }`.
- [ ] T018 Implement and export `previewTenantStorageUsage(input)` in `storage-admin.mjs`. Same composition pattern as T017 but for `scopeType: tenant`, with `workspaces` breakdown populated from `buildStorageWorkspaceUsageEntry` records.
- [ ] T019 Implement and export `previewBucketStorageUsage(input)` in `storage-admin.mjs`. Returns `{ snapshot, auditEvent }` for `scopeType: bucket` (no workspace/tenant breakdown arrays). No threshold detection at bucket scope (no quota limit applies at bucket granularity by default).
- [ ] T020 Implement and export `previewCrossTenantStorageUsage(input)` in `storage-admin.mjs`. Wraps `buildStorageCrossTenantUsageSummary`, returns `{ summary, auditEvent }`.
- [ ] T021 Implement and export `detectWorkspaceUsageThresholds(input)` in `storage-admin.mjs`. Thin wrapper around `detectStorageUsageThresholdBreaches` that accepts a `workspaceSnapshot` and optional `thresholds` override, returning the breach array.
- [ ] T022 Implement and export `rankWorkspaceBucketsByUsage(input)` in `storage-admin.mjs`. Thin wrapper around `rankBucketsByUsage`, extracting `buckets` from a workspace snapshot if not provided directly.
- [ ] T023 Re-export `buildStorageUsageSnapshot`, `buildStorageBucketUsageEntry`, `buildStorageWorkspaceUsageEntry`, `buildStorageCrossTenantUsageSummary`, `detectStorageUsageThresholdBreaches`, `rankBucketsByUsage`, and `buildStorageUsageAuditEvent` from `services/adapters/src/provider-catalog.mjs` following the existing re-export pattern.

---

## Phase 5 — Published API contracts

- [ ] T024 Add `StorageUsageDimensionStatus`, `StorageUsageSnapshot`, `StorageBucketUsageEntry`, `StorageWorkspaceUsageEntry`, `StorageUsageThresholdBreach`, `StorageCrossTenantUsageSummary` component schemas to `apps/control-plane/openapi/control-plane.openapi.json`. Schemas MUST be additive only.
- [ ] T025 Add the four usage routes to `control-plane.openapi.json`: `GET /v1/storage/tenants/{tenantId}/usage`, `GET /v1/storage/workspaces/{workspaceId}/usage`, `GET /v1/storage/workspaces/{workspaceId}/buckets/{bucketId}/usage`, `GET /v1/storage/usage/tenants`. Include security schemes, `200` and error response references, and operationId values matching the route table from T016.
- [ ] T026 Regenerate `apps/control-plane/openapi/families/storage.openapi.json` to include the new usage routes.
- [ ] T027 Update `services/internal-contracts/src/public-route-catalog.json` to publish the four new usage operationIds.
- [ ] T028 Update `services/internal-contracts/src/public-api-taxonomy.json` to add `storage_usage_snapshot` resource type entry.
- [ ] T029 Update `services/internal-contracts/src/internal-service-map.json` to declare the usage reporting adapter capability.
- [ ] T030 Regenerate `docs/reference/architecture/public-api-surface.md` to reflect the updated OpenAPI surface.

---

## Phase 6 — Unit tests (adapter)

- [ ] T031 Create `tests/unit/storage-usage-reporting.test.mjs` using `node --test` pattern. Add suite for `buildStorageUsageDimensionStatus`: assert all output fields present; assert `utilizationPercent` is `null` when `limit` is `null`; assert `remaining` is `null` when `limit` is `null`; assert correct two-decimal rounding; assert utilization > 100 when used > limit.
- [ ] T032 Add suite for `buildStorageBucketUsageEntry`: assert `entityType` is `storage_bucket_usage_entry`; assert numeric fields default to `0`; assert all required fields present.
- [ ] T033 Add suite for `buildStorageWorkspaceUsageEntry`: assert `entityType` is `storage_workspace_usage_entry`; assert consistency guard throws when bucket subtotals do not sum to workspace totals; assert passes when totals are consistent; assert empty `buckets` array produces zero totals without error.
- [ ] T034 Add suite for `buildStorageUsageSnapshot`: assert `entityType` is `storage_usage_snapshot`; assert `snapshotId` is deterministic for the same inputs; assert `provider_unavailable` + null `cacheSnapshotAt` → empty breakdown array enforced; assert snapshot with valid dimensions and breakdown is accepted.
- [ ] T035 Add suite for `detectStorageUsageThresholdBreaches`: assert no breach when utilization < warning threshold; assert `warning` breach when utilization ≥ 80% and < 95%; assert `critical` breach when utilization ≥ 95%; assert `critical` breach when utilization > 100% regardless of thresholds; assert null-limit dimensions are skipped; assert custom thresholds override defaults; assert empty array returned when no breaches.
- [ ] T036 Add suite for `rankBucketsByUsage` sorting by `total_bytes`: assert top 3 of 10 buckets returns exactly 3 entries sorted descending; assert sorting by `object_count` produces correct order; assert `topN` exceeding bucket count returns all buckets; assert `rank` field is 1-indexed and monotonically increasing.
- [ ] T037 Add suite for `buildStorageUsageAuditEvent`: assert all required fields are present; assert `eventType` is `storage.usage.queried`; assert no numeric usage payload fields (bytes, counts, dimensions) are present in the event; assert `actorPrincipal` field exists.
- [ ] T038 Add suite for `buildStorageCrossTenantUsageSummary`: assert output sorted by `total_bytes` descending by default; assert `topN` truncation; assert all tenant snapshots appear when `topN` is unset; assert `generatedAt` is present.

---

## Phase 7 — Unit tests (control-plane / storage-admin)

- [ ] T039 Extend `tests/unit/storage-admin.test.mjs` with a suite for `previewWorkspaceStorageUsage`: assert it returns `{ snapshot, thresholdBreaches, auditEvent }`; assert `snapshot.scopeType` is `workspace`; assert `thresholdBreaches` is an array; assert `auditEvent.eventType` is `storage.usage.queried`.
- [ ] T040 Add suite for `previewTenantStorageUsage`: assert `{ snapshot, thresholdBreaches, auditEvent }` shape; assert `snapshot.scopeType` is `tenant`; assert `snapshot.breakdown` contains workspace entries.
- [ ] T041 Add suite for `previewBucketStorageUsage`: assert `{ snapshot, auditEvent }` shape (no `thresholdBreaches`); assert `snapshot.scopeType` is `bucket`.
- [ ] T042 Add suite for `previewCrossTenantStorageUsage`: assert `{ summary, auditEvent }` shape; assert `summary.entityType` is `storage_cross_tenant_usage_summary`.
- [ ] T043 Add suite for usage route discoverability: call `listStorageAdminRoutes()` and assert all four usage operationIds are present in the result.
- [ ] T044 Add suite asserting all five new exported constants (`STORAGE_USAGE_COLLECTION_METHODS`, `STORAGE_USAGE_COLLECTION_STATUSES`, `STORAGE_USAGE_THRESHOLD_SEVERITIES`, `STORAGE_USAGE_THRESHOLD_DEFAULTS`, `STORAGE_USAGE_ERROR_CODES`) are non-empty, frozen, and contain no duplicate values within each catalog.

---

## Phase 8 — Adapter integration tests

- [ ] T045 Create `tests/adapters/storage-usage-reporting.test.mjs`. Add integration-level suite exercising the full workspace usage snapshot composition: `buildStorageBucketUsageEntry` × 3 → `buildStorageWorkspaceUsageEntry` → `buildStorageUsageSnapshot` → `detectStorageUsageThresholdBreaches`. Assert end-to-end field consistency and that threshold breaches reflect the dimension utilization values in the snapshot.
- [ ] T046 Add suite verifying additive consistency invariant: construct a workspace snapshot with 3 buckets; assert workspace `totalBytes` equals sum of bucket `totalBytes`; assert workspace `objectCount` equals sum of bucket `objectCount`; assert workspace `bucketCount` equals number of bucket entries.
- [ ] T047 Add suite verifying `provider_unavailable` behavior: construct a snapshot with `collectionStatus: provider_unavailable` and `cacheSnapshotAt: null`; assert `breakdown` is empty array; construct a second snapshot with `provider_unavailable` and a valid `cacheSnapshotAt`; assert `breakdown` may be non-empty (stale data path accepted).
- [ ] T048 Add suite verifying tenant-scope snapshot with nested workspace breakdowns: construct two workspace entries (W1, W2) with known values, build a tenant snapshot, assert tenant `totalBytes` equals W1.totalBytes + W2.totalBytes, assert `breakdown` array contains both workspace entries with their own `buckets` arrays intact.
- [ ] T049 Add suite verifying audit event cleanliness across all event-producing functions: for each of `buildStorageUsageAuditEvent`, `previewWorkspaceStorageUsage.auditEvent`, `previewTenantStorageUsage.auditEvent`; assert returned event contains no field whose value is a number > 0 (i.e., no bytes or counts leak into audit events).

---

## Phase 9 — Contract tests

- [ ] T050 Extend `tests/contracts/storage-provider.contract.test.mjs` with a suite asserting the four new usage routes are present in the published route catalog (`public-route-catalog.json`) with expected operationIds, methods, and path patterns.
- [ ] T051 Extend `tests/unit/public-api.test.mjs` with a suite asserting `storage_usage_snapshot` is present in `public-api-taxonomy.json` and that all four usage operationIds appear in `public-route-catalog.json`.
- [ ] T052 Extend `tests/contracts/control-plane.openapi.test.mjs` (if it exists) or add an inline check to assert the OpenAPI source and generated artifacts are in sync for the new usage schemas and routes.

---

## Phase 10 — Verification

- [ ] T053 Run `node --test tests/unit/storage-usage-reporting.test.mjs`; fix any deterministic failures introduced in Phases 6–7.
- [ ] T054 Run `node --test tests/adapters/storage-usage-reporting.test.mjs`; fix any deterministic failures introduced in Phase 8.
- [ ] T055 Run `node --test tests/unit/storage-admin.test.mjs`; ensure existing suites remain green alongside the new usage suites.
- [ ] T056 Run full `npm test`; fix any follow-on regressions in existing storage tests (`storage-capacity-quotas`, `storage-admin`, `storage-event-notifications`, `storage-programmatic-credentials`, contract tests) before the branch is ready for push/PR/CI.
