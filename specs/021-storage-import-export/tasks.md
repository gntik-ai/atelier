# Tasks: US-STO-03-T03 — Storage Object & Metadata Import/Export

**Input**: `specs/021-storage-import-export/spec.md`
**Feature Branch**: `021-storage-import-export`
**Task**: US-STO-03-T03

---

## Phase 1 — Domain vocabulary and error taxonomy

- [ ] T001 Create `services/adapters/src/storage-import-export.mjs` (new file). Add and export `STORAGE_IMPORT_EXPORT_MANIFEST_VERSION` as a frozen constant with value `1`.
- [ ] T002 Add and export `STORAGE_IMPORT_CONFLICT_POLICIES` frozen record to `storage-import-export.mjs` with values: `skip`, `overwrite`, `fail`.
- [ ] T003 Add and export `STORAGE_IMPORT_ENTRY_STATUSES` frozen record to `storage-import-export.mjs` with values: `imported`, `skipped`, `failed`.
- [ ] T004 Add and export `STORAGE_IMPORT_EXPORT_OPERATION_DEFAULTS` frozen record to `storage-import-export.mjs` with values: `{ maxObjectsPerOperation: 5000, presignedUrlValiditySeconds: 3600 }`.
- [ ] T005 Add `STORAGE_IMPORT_EXPORT_ERROR_CODES` frozen record to `services/adapters/src/storage-error-taxonomy.mjs` with codes: `MANIFEST_VALIDATION_ERROR`, `MANIFEST_VERSION_UNSUPPORTED`, `OPERATION_LIMIT_EXCEEDED`, `CROSS_TENANT_VIOLATION`, `IMPORT_PARTIAL_FAILURE`, `OBJECT_PROTECTED`, `EXPORT_EMPTY_RESULT`. Follow the existing `STORAGE_NORMALIZED_ERROR_CODES` naming convention. Do not alter existing error codes. Export it.
- [ ] T006 Import `STORAGE_IMPORT_EXPORT_ERROR_CODES` from `storage-error-taxonomy.mjs` into `storage-import-export.mjs` and re-export it so callers can reference error codes through the feature module.

---

## Phase 2 — Adapter: manifest entry and manifest builders

- [ ] T007 Implement and export `buildStorageExportManifestEntry(input)` in `storage-import-export.mjs`. Accepts: `objectKey`, `sizeBytes`, `contentType`, `contentEncoding`, `storageClass`, `customMetadata` (object, default `{}`), `lastModifiedAt` (ISO-8601 string), `bodyReference` (`{ type, url, expiresAt }` for `presigned_url` or `{ type, bucketId, workspaceId, tenantId, objectKey }` for `object_read`). Calls `assertObjectKey` (imported from `storage-bucket-object-ops.mjs`) on `objectKey`; throws `INVALID_OBJECT_KEY` on violation. Returns a frozen entry record with all provided fields and a stable `entityType: 'storage_export_manifest_entry'`.
- [ ] T008 Implement and export `buildStorageExportManifest(input)` in `storage-import-export.mjs`. Accepts: `sourceBucketId`, `sourceWorkspaceId`, `sourceTenantId`, `actingPrincipal` (`{ type, id }`), `exportedAt` (ISO-8601), `filterCriteria` (`{ prefix: string | null, metadataFilter: { key, value } | null }`), `entries` (array of `buildStorageExportManifestEntry` records), `nonce` (optional, defaults to a hash-derived value from the other fields). Computes `totalObjects = entries.length` and `totalBytes = sum(entries[*].sizeBytes)`. Throws a structured consistency error if any entry's `sizeBytes` is not a non-negative integer. Returns a frozen record with `entityType: 'storage_export_manifest'`, `manifestId` (deterministic from `sourceTenantId + sourceBucketId + exportedAt + nonce`), `formatVersion: STORAGE_IMPORT_EXPORT_MANIFEST_VERSION`, all provided fields, `totalObjects`, and `totalBytes`.

---

## Phase 3 — Adapter: import result builders

- [ ] T009 Implement and export `buildStorageImportEntryOutcome(input)` in `storage-import-export.mjs`. Accepts: `objectKey`, `status` (one of `STORAGE_IMPORT_ENTRY_STATUSES`), `reason` (string or null; null when `status` is `imported` or a no-reason skip; an error code string when `status` is `failed`). Returns `{ entityType: 'storage_import_entry_outcome', objectKey, status, reason }`.
- [ ] T010 Implement and export `buildStorageImportResultSummary(input)` in `storage-import-export.mjs`. Accepts: `targetBucketId`, `targetWorkspaceId`, `targetTenantId`, `actingPrincipal`, `importedAt` (ISO-8601), `conflictPolicy` (one of `STORAGE_IMPORT_CONFLICT_POLICIES`), `outcomes` (array of `buildStorageImportEntryOutcome` records), `nonce` (optional). Computes `importedCount`, `skippedCount`, `failedCount` from the outcomes array. Computes `totalBytesImported` — requires outcomes to carry a `sizeBytes` field when `status` is `imported`; treats absent/zero `sizeBytes` as `0`. Validates `totalEntries === importedCount + skippedCount + failedCount`; throws a structured consistency error if not. Returns a frozen record with `entityType: 'storage_import_result_summary'`, `importId` (deterministic), all derived counts, `totalBytesImported`, `totalEntries`, and the full `outcomes` array.

---

## Phase 4 — Adapter: manifest validation

- [ ] T011 Implement and export `validateImportManifest(input)` in `storage-import-export.mjs`. Pure function. Accepts `{ manifest, maxObjectsPerOperation }` where `maxObjectsPerOperation` defaults to `STORAGE_IMPORT_EXPORT_OPERATION_DEFAULTS.maxObjectsPerOperation`. Performs checks in order: (a) if `manifest.formatVersion` is not equal to `STORAGE_IMPORT_EXPORT_MANIFEST_VERSION`, return immediately with `{ valid: false, errors: ['MANIFEST_VERSION_UNSUPPORTED'] }`; (b) if `manifest.entries.length > maxObjectsPerOperation`, return immediately with `{ valid: false, errors: ['OPERATION_LIMIT_EXCEEDED'] }`; (c) scan entries for duplicate `objectKey` values using a `Set`; if any duplicate found, return `{ valid: false, errors: ['MANIFEST_VALIDATION_ERROR'], duplicateKeys: [<array of duplicated keys>] }`; (d) if all checks pass, return `{ valid: true, errors: [] }`.
- [ ] T012 Implement and export `validateImportManifestEntry(input)` in `storage-import-export.mjs`. Pure function. Accepts `{ entry, targetTenantId }`. Checks in order: (a) call `assertObjectKey(entry.objectKey)` — on throw, return `{ valid: false, reason: 'INVALID_OBJECT_KEY' }`; (b) call `isStorageReservedPrefix({ objectKey: entry.objectKey })` (imported from `storage-logical-organization.mjs`) — if reserved, return `{ valid: false, reason: 'OBJECT_PROTECTED' }`; (c) if `entry.bodyReference?.tenantId` is present and differs from `targetTenantId`, return `{ valid: false, reason: 'CROSS_TENANT_VIOLATION' }`; (d) otherwise return `{ valid: true, reason: null }`.

---

## Phase 5 — Adapter: quota pre-validation and operational limits

- [ ] T013 Implement and export `previewImportQuotaAdmission(input)` in `storage-import-export.mjs`. Pure function. Accepts `{ manifest, quotaProfile, currentUsageBytes, currentUsageObjectCount }`. Computes `requestedBytes = sum(manifest.entries[*].sizeBytes)` and `requestedObjectCount = manifest.entries.length`. Delegates to `previewStorageObjectQuotaAdmission` (imported from `storage-capacity-quotas.mjs`) for the `total_bytes` and `object_count` dimensions. Returns `{ admitted: boolean, requestedBytes, requestedObjectCount, violations: array }` where each violation is `{ dimension, requestedTotal, availableHeadroom }`. If both dimensions admit, `admitted: true` and `violations: []`.
- [ ] T014 Implement and export `checkImportExportOperationLimit(input)` in `storage-import-export.mjs`. Pure function. Accepts `{ objectCount, platformLimit, tenantLimitOverride }`. `platformLimit` defaults to `STORAGE_IMPORT_EXPORT_OPERATION_DEFAULTS.maxObjectsPerOperation` when not provided. `tenantLimitOverride` takes precedence when it is a positive integer. Returns `{ allowed: boolean, appliedLimit: number }`. `allowed` is `true` if and only if `objectCount <= appliedLimit`.

---

## Phase 6 — Adapter: audit event builder

- [ ] T015 Implement and export `buildStorageImportExportAuditEvent(input)` in `storage-import-export.mjs`. Accepts: `operationType` (`'export'` or `'import'`), `actingPrincipal` (`{ type, id }`), `credentialId` (string or null), `manifestId` (string), `outcome` (one of: `success`, `quota_exceeded`, `authorization_denied`, `manifest_invalid`, `partial_failure`), `timestamp` (ISO-8601 string). For export: also accepts `sourceBucketId`, `sourceWorkspaceId`, `sourceTenantId`, `objectCount`, `totalBytes`, `filterCriteria`. For import: also accepts `targetBucketId`, `targetWorkspaceId`, `targetTenantId`, `conflictPolicy`, `importedCount`, `skippedCount`, `failedCount`, `totalBytesImported`. MUST NOT accept `entries`, `bodyReference`, `customMetadata`, or any field containing object body content — throw a structured guard error if any such field is passed. Returns `{ entityType: 'storage_import_export_audit_event', ...all fields }`. Follows the audit event shape convention from `storage-event-notifications.mjs`.

---

## Phase 7 — Control-plane integration

- [ ] T016 Re-export `STORAGE_IMPORT_CONFLICT_POLICIES`, `STORAGE_IMPORT_ENTRY_STATUSES`, `STORAGE_IMPORT_EXPORT_OPERATION_DEFAULTS`, `STORAGE_IMPORT_EXPORT_ERROR_CODES`, and `STORAGE_IMPORT_EXPORT_MANIFEST_VERSION` from `apps/control-plane/src/storage-admin.mjs` following the existing constant re-export conventions.
- [ ] T017 Add import/export routes to the route table inside `storage-admin.mjs` (following the existing route entry pattern used for usage and credential routes): `POST /v1/storage/workspaces/{workspaceId}/buckets/{bucketId}/exports`, `POST /v1/storage/workspaces/{workspaceId}/buckets/{bucketId}/imports`, `GET /v1/storage/workspaces/{workspaceId}/buckets/{bucketId}/exports/{manifestId}`. Verify all three appear in `listStorageAdminRoutes()`.
- [ ] T018 Implement and export `previewStorageExportManifest(input)` in `storage-admin.mjs`. Accepts `{ sourceBucketId, sourceWorkspaceId, sourceTenantId, actingPrincipal, exportedAt, filterCriteria, entries, operationLimits }`. Calls `checkImportExportOperationLimit` first; returns a structured limit-exceeded error if `allowed` is `false`. Calls `buildStorageExportManifest`. Calls `buildStorageImportExportAuditEvent` with `operationType: 'export'`. Returns `{ manifest, auditEvent }`. Sets `outcome: 'export_empty_result'` (informational) in the audit event when `manifest.totalObjects === 0`.
- [ ] T019 Implement and export `previewStorageImportResult(input)` in `storage-admin.mjs`. Accepts `{ targetBucketId, targetWorkspaceId, targetTenantId, actingPrincipal, importedAt, conflictPolicy, outcomes, operationLimits }`. Calls `buildStorageImportResultSummary`. Calls `buildStorageImportExportAuditEvent` with `operationType: 'import'`. Derives `outcome` from the summary: `partial_failure` when `failedCount > 0` and `importedCount > 0`; `success` when `failedCount === 0`; `manifest_invalid` when `importedCount === 0 && failedCount === outcomes.length`. Returns `{ summary, auditEvent }`.
- [ ] T020 Implement and export `validateStorageImportManifest(input)` in `storage-admin.mjs`. Thin wrapper around `validateImportManifest` that surfaces `STORAGE_IMPORT_EXPORT_ERROR_CODES` values. Returns the same `{ valid, errors }` shape.
- [ ] T021 Implement and export `checkStorageImportExportLimit(input)` in `storage-admin.mjs`. Thin wrapper around `checkImportExportOperationLimit`.
- [ ] T022 Re-export `buildStorageExportManifest`, `buildStorageExportManifestEntry`, `buildStorageImportResultSummary`, `buildStorageImportEntryOutcome`, `validateImportManifest`, `validateImportManifestEntry`, `previewImportQuotaAdmission`, `checkImportExportOperationLimit`, and `buildStorageImportExportAuditEvent` from `services/adapters/src/provider-catalog.mjs` following the existing re-export pattern.

---

## Phase 8 — Published API contracts

- [ ] T023 Add `StorageExportManifestEntry`, `StorageExportManifest`, `StorageImportEntryOutcome`, `StorageImportResultSummary`, `StorageImportExportAuditEvent` component schemas to `apps/control-plane/openapi/control-plane.openapi.json`. Schemas MUST be additive only. `StorageExportManifest` references `StorageExportManifestEntry` as an inline array. `StorageImportResultSummary` references `StorageImportEntryOutcome` as an inline array.
- [ ] T024 Add the three import/export routes to `control-plane.openapi.json`: `POST /v1/storage/workspaces/{workspaceId}/buckets/{bucketId}/exports`, `POST /v1/storage/workspaces/{workspaceId}/buckets/{bucketId}/imports`, `GET /v1/storage/workspaces/{workspaceId}/buckets/{bucketId}/exports/{manifestId}`. Include security schemes, `200` and error response references (including `MANIFEST_VALIDATION_ERROR`, `MANIFEST_VERSION_UNSUPPORTED`, `OPERATION_LIMIT_EXCEEDED`, `QUOTA_EXCEEDED`, `CROSS_TENANT_VIOLATION`), and operationId values matching the route table from T017.
- [ ] T025 Regenerate `apps/control-plane/openapi/families/storage.openapi.json` to include the new import/export routes.
- [ ] T026 Update `services/internal-contracts/src/public-route-catalog.json` to publish the three new import/export operationIds.
- [ ] T027 Update `services/internal-contracts/src/public-api-taxonomy.json` to add `storage_export_manifest` and `storage_import_result` resource type entries with `family: 'storage'`, `scope: 'workspace'`, and `authorization_resource: 'bucket'`.
- [ ] T028 Update `services/internal-contracts/src/internal-service-map.json` to declare the import/export adapter capability.
- [ ] T029 Regenerate `docs/reference/architecture/public-api-surface.md` to reflect the updated OpenAPI surface.

---

## Phase 9 — Unit tests (adapter)

- [ ] T030 Create `tests/unit/storage-import-export.test.mjs` using `node --test` pattern. Add suite for `STORAGE_IMPORT_EXPORT_ERROR_CODES`: assert each code is a non-empty string, unique within the record, follows SCREAMING_SNAKE_CASE, and does not duplicate any existing code in `STORAGE_NORMALIZED_ERROR_CODES` or `STORAGE_USAGE_ERROR_CODES`.
- [ ] T031 Add suite for `STORAGE_IMPORT_CONFLICT_POLICIES`, `STORAGE_IMPORT_ENTRY_STATUSES`, `STORAGE_IMPORT_EXPORT_OPERATION_DEFAULTS`: assert each frozen record is non-empty; assert `maxObjectsPerOperation` is a positive integer; assert `presignedUrlValiditySeconds` is a positive integer; assert the records are frozen (Object.isFrozen).
- [ ] T032 Add suite for `buildStorageExportManifestEntry`: assert `entityType` is `storage_export_manifest_entry`; assert all provided fields are present in the output; assert an invalid `objectKey` (starting with `/`) throws `INVALID_OBJECT_KEY`; assert `customMetadata` defaults to `{}` when omitted; assert a valid `presigned_url` body reference is preserved; assert a valid `object_read` body reference is preserved.
- [ ] T033 Add suite for `buildStorageExportManifest`: assert `entityType` is `storage_export_manifest`; assert `formatVersion` equals `STORAGE_IMPORT_EXPORT_MANIFEST_VERSION`; assert `totalObjects` equals `entries.length`; assert `totalBytes` equals the sum of entry `sizeBytes` values; assert `manifestId` is deterministic for identical inputs; assert an entry with negative `sizeBytes` throws a structured consistency error; assert empty `entries` array produces `totalObjects: 0` and `totalBytes: 0` without error (EXPORT_EMPTY_RESULT is informational, not a throw).
- [ ] T034 Add suite for `buildStorageImportEntryOutcome`: assert `entityType` is `storage_import_entry_outcome`; assert `reason` is `null` when `status` is `imported`; assert `reason` is a non-null error code string when `status` is `failed`; assert all three status values are accepted.
- [ ] T035 Add suite for `buildStorageImportResultSummary`: assert `entityType` is `storage_import_result_summary`; assert `totalEntries === importedCount + skippedCount + failedCount`; assert consistency error is thrown when counts do not sum; assert `totalBytesImported` equals the sum of `sizeBytes` for `imported` outcomes; assert `importId` is deterministic for identical inputs; assert empty `outcomes` array produces all-zero counts without error.
- [ ] T036 Add suite for `validateImportManifest`: assert `{ valid: true, errors: [] }` for a well-formed manifest within limits; assert `{ valid: false, errors: ['MANIFEST_VERSION_UNSUPPORTED'] }` when `formatVersion` is not `1`; assert `{ valid: false, errors: ['OPERATION_LIMIT_EXCEEDED'] }` when entries exceed `maxObjectsPerOperation`; assert `{ valid: false, errors: ['MANIFEST_VALIDATION_ERROR'] }` with `duplicateKeys` populated when two entries share the same `objectKey`; assert version check short-circuits before limit check; assert limit check short-circuits before duplicate-key scan.
- [ ] T037 Add suite for `validateImportManifestEntry`: assert `{ valid: true, reason: null }` for a normal entry in a non-reserved prefix; assert `{ valid: false, reason: 'INVALID_OBJECT_KEY' }` for a key starting with `/`; assert `{ valid: false, reason: 'OBJECT_PROTECTED' }` for a key in a reserved prefix (use a known reserved prefix from `isStorageReservedPrefix`); assert `{ valid: false, reason: 'CROSS_TENANT_VIOLATION' }` when `bodyReference.tenantId` differs from `targetTenantId`; assert `{ valid: true, reason: null }` when `bodyReference.tenantId` equals `targetTenantId`.
- [ ] T038 Add suite for `previewImportQuotaAdmission`: assert `{ admitted: true, violations: [] }` when both dimensions are within quota; assert `{ admitted: false, violations: [<bytes violation>] }` when total bytes exceed remaining quota; assert `{ admitted: false, violations: [<objects violation>] }` when object count exceeds remaining quota; assert both violations appear simultaneously when both dimensions are exceeded; assert zero-byte manifest (all entries `sizeBytes: 0`) reports `requestedBytes: 0` and is admitted on the bytes dimension.
- [ ] T039 Add suite for `checkImportExportOperationLimit`: assert `{ allowed: true }` when `objectCount` equals the limit (inclusive); assert `{ allowed: false }` when `objectCount` exceeds the limit; assert `tenantLimitOverride` takes precedence over `platformLimit`; assert `platformLimit` defaults to `STORAGE_IMPORT_EXPORT_OPERATION_DEFAULTS.maxObjectsPerOperation` when not provided; assert `tenantLimitOverride: null` falls back to `platformLimit`.
- [ ] T040 Add suite for `buildStorageImportExportAuditEvent`: assert all required fields are present for an export event; assert all required fields are present for an import event; assert `entityType` is `storage_import_export_audit_event`; assert passing an `entries` field throws a guard error; assert passing a `bodyReference` field throws a guard error; assert no numeric bytes or counts from manifest entries are present in export audit event (only structural summary fields are allowed); assert `credentialId` is null when omitted.

---

## Phase 10 — Unit tests (control-plane / storage-admin)

- [ ] T041 Extend `tests/unit/storage-admin.test.mjs` with a suite for `previewStorageExportManifest`: assert it returns `{ manifest, auditEvent }`; assert `manifest.entityType` is `storage_export_manifest`; assert `auditEvent.operationType` is `export`; assert `auditEvent.outcome` is `export_empty_result` (informational) when `manifest.totalObjects === 0`; assert a limit-exceeded input returns a structured error (not a thrown exception).
- [ ] T042 Add suite for `previewStorageImportResult`: assert it returns `{ summary, auditEvent }`; assert `summary.entityType` is `storage_import_result_summary`; assert `auditEvent.operationType` is `import`; assert `auditEvent.outcome` is `success` when `failedCount === 0`; assert `auditEvent.outcome` is `partial_failure` when some entries failed and some succeeded.
- [ ] T043 Add suite for `validateStorageImportManifest`: assert it delegates to `validateImportManifest` and returns the same shape; assert `STORAGE_IMPORT_EXPORT_ERROR_CODES` values appear in error arrays (not raw strings).
- [ ] T044 Add suite for import/export route discoverability: call `listStorageAdminRoutes()` and assert all three import/export operationIds (`exportStorageBucketObjects`, `importStorageBucketObjects`, `getStorageBucketExportManifest`) are present in the result.
- [ ] T045 Add suite asserting all five exported constants (`STORAGE_IMPORT_CONFLICT_POLICIES`, `STORAGE_IMPORT_ENTRY_STATUSES`, `STORAGE_IMPORT_EXPORT_OPERATION_DEFAULTS`, `STORAGE_IMPORT_EXPORT_ERROR_CODES`, `STORAGE_IMPORT_EXPORT_MANIFEST_VERSION`) are non-empty, frozen where applicable, and contain no duplicate values within each catalog.

---

## Phase 11 — Adapter integration tests

- [ ] T046 Create `tests/adapters/storage-import-export.test.mjs`. Add integration-level suite exercising the full export-then-import round-trip at the record level: (a) create 3 `buildStorageExportManifestEntry` records; (b) compose them into a `buildStorageExportManifest`; (c) call `validateImportManifest` on the manifest; assert `valid: true`; (d) for each entry call `validateImportManifestEntry`; assert all valid; (e) call `previewImportQuotaAdmission` with sufficient quota; assert admitted; (f) create outcomes for each entry with `status: 'imported'`; (g) compose `buildStorageImportResultSummary`; assert counts match. Assert that `totalBytesImported` in the summary equals `totalBytes` in the manifest.
- [ ] T047 Add suite verifying conflict-policy `skip` path: compose a manifest with 3 entries; simulate that 1 entry already exists in the target (create its outcome as `{ status: 'skipped', reason: null }`); compose the summary; assert `imported: 2, skipped: 1, failed: 0`; assert `totalBytesImported` counts only the 2 imported entries.
- [ ] T048 Add suite verifying conflict-policy `fail` path: compose a manifest with 3 entries; simulate that the first entry conflicts (create its outcome as `{ status: 'failed', reason: 'CONFLICT_FAIL_ABORT' }`); compose a summary with only that one outcome; assert `totalEntries: 1, failed: 1`; assert `auditEvent.outcome` from `previewStorageImportResult` is `manifest_invalid` (all-fail case).
- [ ] T049 Add suite verifying audit event cleanliness for both operation types: call `buildStorageImportExportAuditEvent` for an export and an import; for each returned event, assert that no field contains a URL-like value (pattern: `https://`); assert that `entries` is not a field; assert that `customMetadata` is not a field; assert that `bodyReference` is not a field.
- [ ] T050 Add suite verifying operational limit enforcement end-to-end: create a manifest with exactly `STORAGE_IMPORT_EXPORT_OPERATION_DEFAULTS.maxObjectsPerOperation` entries (use minimal entry objects); assert `checkImportExportOperationLimit` returns `allowed: true`; create a manifest with one additional entry; assert `checkImportExportOperationLimit` returns `allowed: false`; assert `validateImportManifest` with the over-limit manifest returns `{ valid: false, errors: ['OPERATION_LIMIT_EXCEEDED'] }`.

---

## Phase 12 — Contract tests

- [ ] T051 Extend `tests/contracts/storage-provider.contract.test.mjs` with a suite asserting the three new import/export routes are present in the published route catalog (`public-route-catalog.json`) with expected operationIds, HTTP methods (`POST`, `POST`, `GET`), and path patterns.
- [ ] T052 Extend `tests/unit/public-api.test.mjs` with a suite asserting `storage_export_manifest` and `storage_import_result` are present in `public-api-taxonomy.json`; assert all three import/export operationIds appear in `public-route-catalog.json`.
- [ ] T053 Extend `tests/contracts/control-plane.openapi.test.mjs` (if it exists) or add an inline check to assert the OpenAPI source and generated artifacts are in sync for the new import/export schemas and routes.

---

## Phase 13 — Verification

- [ ] T054 Run `node --test tests/unit/storage-import-export.test.mjs`; fix any deterministic failures introduced in Phases 9–10.
- [ ] T055 Run `node --test tests/adapters/storage-import-export.test.mjs`; fix any deterministic failures introduced in Phase 11.
- [ ] T056 Run `node --test tests/unit/storage-admin.test.mjs`; ensure existing credential and usage suites remain green alongside the new import/export suites.
- [ ] T057 Run full `npm test`; fix any follow-on regressions in existing storage tests (`storage-capacity-quotas`, `storage-admin`, `storage-event-notifications`, `storage-programmatic-credentials`, `storage-usage-reporting`, contract tests) before the branch is ready for push/PR/CI.
