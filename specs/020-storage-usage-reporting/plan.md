# Implementation Plan: US-STO-03-T02 — Storage Usage Reporting

**Feature Branch**: `020-storage-usage-reporting`
**Spec**: `specs/020-storage-usage-reporting/spec.md`
**Task**: US-STO-03-T02
**Epic**: EP-12 — Storage S3-compatible
**Status**: Planned
**Created**: 2026-03-28
**Updated**: 2026-03-28

## 1. Scope summary

This task introduces a structured, read-only surface for aggregated and per-bucket storage consumption reporting at tenant, workspace, and bucket scopes. The delivered slice is bounded to repo-local contracts and validation helpers:

- define canonical usage snapshot, dimension status, threshold-breach, and top-N entry record builders
- extend the storage error taxonomy with usage-specific error codes
- expose usage report previews and threshold detection through the control-plane aggregation layer
- publish new usage routes through OpenAPI, the family doc, and the generated public route catalog
- cover the feature with adapter, unit, and contract tests

This implementation is additive. It does not alter previously delivered storage bucket, object, quota, credential, event, or capability behavior. The usage surface is read-only and non-enforcement.

## 2. Repo-local dependency map

| Concern | Path | Usage |
| --- | --- | --- |
| Quota dimension vocabulary | `services/adapters/src/storage-capacity-quotas.mjs` | `STORAGE_QUOTA_DIMENSIONS`, `STORAGE_QUOTA_SCOPE_TYPES`, `buildStorageQuotaProfile`, `buildStorageQuotaScopeStatus` — reused to align dimension names and quota-comparison logic |
| Tenant storage context | `services/adapters/src/storage-tenant-context.mjs` | `buildTenantStorageContextRecord`, `buildTenantStorageContextIntrospection` — anchors tenant-level quota limits in usage snapshots |
| Bucket and object records | `services/adapters/src/storage-bucket-object-ops.mjs` | `buildStorageBucketRecord`, `buildStorageBucketSummary`, `buildStorageObjectCollection` — bucket metadata that per-bucket breakdown entries are built from |
| Provider profile | `services/adapters/src/storage-provider-profile.mjs` | Capability awareness for usage-collection method selection (`provider_admin_api` vs `platform_estimate`) |
| Error taxonomy | `services/adapters/src/storage-error-taxonomy.mjs` | Extended with usage-specific error codes; normalized error patterns reused |
| Event notifications | `services/adapters/src/storage-event-notifications.mjs` | Convention reference for audit event shape |
| Scoped credentials | `services/adapters/src/storage-programmatic-credentials.mjs` | Available for per-credential attribution in future; not changed in this task |
| Storage admin control plane | `apps/control-plane/src/storage-admin.mjs` | Usage report preview helpers and route helpers added here |
| Provider catalog | `services/adapters/src/provider-catalog.mjs` | Re-exports new usage adapter helpers for repo-wide access |
| Public OpenAPI source | `apps/control-plane/openapi/control-plane.openapi.json` | Adds usage snapshot schemas and routes |
| Generated route catalog | `services/internal-contracts/src/public-route-catalog.json` | Publishes discoverable usage routes |
| Public API taxonomy | `services/internal-contracts/src/public-api-taxonomy.json` | Adds `storage_usage_snapshot` resource typing |
| Internal service map | `services/internal-contracts/src/internal-service-map.json` | Declares adapter capabilities for usage reporting |
| Existing tests | `tests/unit/storage-admin.test.mjs`, `tests/adapters/storage-capacity-quotas.test.mjs` | Extended with usage-specific suites |

## 3. Implementation approach

### 3.1 Adapter layer — `storage-usage-reporting.mjs`

Create `services/adapters/src/storage-usage-reporting.mjs` as the feature-local source of truth for:

- **`STORAGE_USAGE_COLLECTION_METHODS`** — frozen catalog: `provider_admin_api`, `cached_snapshot`, `platform_estimate`
- **`STORAGE_USAGE_COLLECTION_STATUSES`** — frozen catalog: `ok`, `provider_unavailable`, `partial`
- **`STORAGE_USAGE_ERROR_CODES`** — frozen catalog: `USAGE_SCOPE_NOT_FOUND`, `USAGE_PROVIDER_UNAVAILABLE`, `USAGE_INVALID_SCOPE`, `USAGE_UNAUTHORIZED`
- **`STORAGE_USAGE_THRESHOLD_SEVERITIES`** — frozen catalog: `warning`, `critical`
- **`buildStorageUsageDimensionStatus(input)`** — single dimension entry: `dimension`, `used`, `limit`, `remaining`, `utilizationPercent`; aligns with `STORAGE_QUOTA_DIMENSIONS` vocabulary
- **`buildStorageUsageSnapshot(input)`** — canonical point-in-time snapshot: `entityType`, `snapshotId`, `scopeType`, `scopeId`, `tenantId`, dimensions record (one entry per `STORAGE_QUOTA_DIMENSIONS` value), `buckets` (workspace scope) or `workspaces` (tenant scope) breakdown array, `collectionMethod`, `collectionStatus`, `snapshotAt`, `cacheSnapshotAt` (nullable)
- **`buildStorageBucketUsageEntry(input)`** — per-bucket row: `bucketId`, `workspaceId`, `tenantId`, `totalBytes`, `objectCount`, `largestObjectSizeBytes`
- **`buildStorageWorkspaceUsageEntry(input)`** — per-workspace row for tenant-scope snapshots: `workspaceId`, `tenantId`, aggregated dimension values, `buckets` array
- **`detectStorageUsageThresholdBreaches(input)`** — pure function: given a snapshot and threshold config (`{ warning: number, critical: number }`, defaults `{ warning: 80, critical: 95 }`), returns array of `buildStorageUsageThresholdBreach` records; skips `null`-limit dimensions; treats utilization > 100 as `critical` regardless
- **`buildStorageUsageThresholdBreach(input)`** — breach record: `dimension`, `scopeType`, `scopeId`, `tenantId`, `utilizationPercent`, `severity`, `thresholdPercent`, `used`, `limit`
- **`rankBucketsByUsage(input)`** — pure function: given a flat `buckets` array, a `sortDimension` (`total_bytes` or `object_count`), and `topN`, returns the top-N bucket entries sorted descending; returns all buckets if fewer than N exist
- **`buildStorageUsageAuditEvent(input)`** — audit event: `eventType` (`storage.usage.queried`), `actorPrincipal`, `scopeType`, `scopeId`, `tenantId`, `timestamp`; MUST NOT include usage payload data
- **`buildStorageCrossTenantUsageSummary(input)`** — aggregates an array of tenant-scope snapshots into a summary record sorted by caller-specified dimension; supports Top-N filtering

### 3.2 Error taxonomy extension

Extend `services/adapters/src/storage-error-taxonomy.mjs` with a new `STORAGE_USAGE_ERROR_CODES` frozen record. Follow the existing `STORAGE_NORMALIZED_ERROR_CODES` naming convention. Do not alter existing error codes.

### 3.3 Control-plane aggregation — `storage-admin.mjs`

Extend `apps/control-plane/src/storage-admin.mjs` to:

- re-export `STORAGE_USAGE_COLLECTION_METHODS`, `STORAGE_USAGE_COLLECTION_STATUSES`, `STORAGE_USAGE_ERROR_CODES`, `STORAGE_USAGE_THRESHOLD_SEVERITIES` alongside the existing storage constant re-exports
- add usage routes to `listStorageAdminRoutes` and `getStorageAdminRoute`
- expose preview/summary helpers: `previewWorkspaceStorageUsage`, `previewTenantStorageUsage`, `previewBucketStorageUsage`, `previewCrossTenantStorageUsage`, `detectWorkspaceUsageThresholds`, `rankWorkspaceBucketsByUsage`

### 3.4 Contract publication

Update `apps/control-plane/openapi/control-plane.openapi.json` with additive usage snapshot schemas and routes:

- `GET /v1/storage/tenants/{tenantId}/usage` — tenant owner + superadmin
- `GET /v1/storage/workspaces/{workspaceId}/usage` — workspace admin + tenant owner + superadmin
- `GET /v1/storage/workspaces/{workspaceId}/buckets/{bucketId}/usage` — developer + workspace admin + tenant owner + superadmin
- `GET /v1/storage/usage/tenants` — superadmin cross-tenant summary

Then regenerate the published artifacts (family doc, route catalog, public API surface docs) to remain in sync.

## 4. Files changed

### 4.1 New source files

- `services/adapters/src/storage-usage-reporting.mjs`

### 4.2 Modified source files

- `services/adapters/src/storage-error-taxonomy.mjs` — add `STORAGE_USAGE_ERROR_CODES`
- `services/adapters/src/provider-catalog.mjs` — re-export new usage helpers
- `apps/control-plane/src/storage-admin.mjs` — usage constants, route helpers, preview functions

### 4.3 Published API artifacts

- `apps/control-plane/openapi/control-plane.openapi.json`
- `apps/control-plane/openapi/families/storage.openapi.json`
- `services/internal-contracts/src/public-route-catalog.json`
- `services/internal-contracts/src/public-api-taxonomy.json`
- `services/internal-contracts/src/internal-service-map.json`
- `docs/reference/architecture/public-api-surface.md`

### 4.4 Spec Kit artifacts

- `specs/020-storage-usage-reporting/spec.md`
- `specs/020-storage-usage-reporting/plan.md`
- `specs/020-storage-usage-reporting/tasks.md`

### 4.5 Tests

- `tests/adapters/storage-usage-reporting.test.mjs` — new
- `tests/unit/storage-usage-reporting.test.mjs` — new
- `tests/unit/storage-admin.test.mjs` — extended with usage preview suites
- `tests/contracts/storage-provider.contract.test.mjs` — extended for usage routes
- `tests/unit/public-api.test.mjs` — extended for usage taxonomy and route catalog

## 5. Validation plan

The implementation is considered ready when these checks pass:

- adapter tests for snapshot builder, dimension status, bucket/workspace entry builders, threshold detection, top-N ranking, audit event cleanliness
- usage unit tests for snapshot consistency (additive totals), threshold edge cases, cross-tenant summary builder
- storage admin unit tests for preview helpers and route discoverability
- contract tests for additive OpenAPI schemas, route metadata, taxonomy, and service-map coverage
- generated public API artifacts are in sync with the OpenAPI source
- repo markdown lint passes for the new Spec Kit artifacts

Validation command:

```bash
npm test -- --test-concurrency=1 \
  tests/adapters/storage-usage-reporting.test.mjs \
  tests/unit/storage-usage-reporting.test.mjs \
  tests/unit/storage-admin.test.mjs \
  tests/contracts/storage-provider.contract.test.mjs \
  tests/unit/public-api.test.mjs \
  tests/contracts/control-plane.openapi.test.mjs
```

## 6. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Dimension vocabulary drift from `storage-capacity-quotas` | Import and reuse `STORAGE_QUOTA_DIMENSIONS` constants directly; never duplicate string literals |
| Additive inconsistency (bucket subtotals ≠ workspace total) | Enforce FR-007 in `buildStorageUsageSnapshot` via a guard function; covered by unit test suite |
| Silent zero values when provider is unavailable | `buildStorageUsageSnapshot` requires explicit `collectionStatus`; `provider_unavailable` path requires non-null `cacheSnapshotAt` or explicit null with no data masking |
| Cross-tenant usage leakage in summary endpoint | `buildStorageCrossTenantUsageSummary` accepts only pre-filtered tenant snapshot arrays; authorization is enforced at the control-plane call site, not inside the builder |
| New usage routes drift from generated artifacts | Regenerate published API artifacts after every OpenAPI change before running contract tests |
| Threshold detection false negatives on > 100% utilization | Explicit guard in `detectStorageUsageThresholdBreaches`: if `utilizationPercent > 100`, severity is always `critical`, independent of configured thresholds |

## 7. Rollback plan

If this increment needs to be reverted:

1. Revert commit `feat(storage): add usage reporting surface`
2. Regenerate the public API artifacts if the revert is partial
3. Rerun the validation command and the default CI checks
4. No data migrations are involved — this task is additive and does not write to any persistent store

## 8. Exit criteria

This task is complete when:

- `specs/020-storage-usage-reporting/spec.md`, `plan.md`, and `tasks.md` exist
- `services/adapters/src/storage-usage-reporting.mjs` is created and exported via `provider-catalog.mjs`
- `storage-error-taxonomy.mjs` exports `STORAGE_USAGE_ERROR_CODES`
- `storage-admin.mjs` exposes usage preview helpers and the new routes appear in `listStorageAdminRoutes`
- OpenAPI, route catalog, taxonomy, and service-map artifacts are updated and in sync
- Local validation command above passes green
- Branch is pushed, PR is opened, and CI is green for merge
