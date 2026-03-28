# Implementation Plan: US-STO-03-T03 — Storage Object & Metadata Import/Export

**Feature Branch**: `021-storage-import-export`
**Spec**: `specs/021-storage-import-export/spec.md`
**Task**: US-STO-03-T03
**Epic**: EP-12 — Storage S3-compatible
**Status**: Planned
**Created**: 2026-03-28
**Updated**: 2026-03-28

## 1. Scope summary

This task introduces a governed, manifest-based bulk import/export capability for storage objects and their associated metadata. The delivered slice is bounded to repo-local contracts, record builders, and validation helpers:

- define canonical export manifest and import result summary record builders
- extend the storage error taxonomy with import/export-specific error codes
- expose export manifest construction, import orchestration previews, and operational-limit enforcement through the control-plane aggregation layer
- publish new import/export routes through OpenAPI, the family doc, and the generated public route catalog
- cover the feature with adapter, unit, and contract tests

This implementation is additive and does not alter previously delivered storage bucket/object operations, scoped credentials (spec 019), usage reporting (spec 020), access policies, quotas, event notifications, or multipart/presigned URL behavior.

## 2. Repo-local dependency map

| Concern | Path | Usage |
| --- | --- | --- |
| Bucket and object record builders | `services/adapters/src/storage-bucket-object-ops.mjs` | `buildStorageObjectRecord`, `buildStorageObjectMetadata`, `buildStorageObjectCollection`, `assertObjectKey` — reused for per-entry validation and metadata shape |
| Logical organization | `services/adapters/src/storage-logical-organization.mjs` | `isStorageReservedPrefix` — used to reject reserved-prefix keys per-entry during import |
| Bucket policy evaluation | `services/adapters/src/storage-access-policy.mjs` | `evaluateStorageAccessDecision`, `STORAGE_POLICY_ACTIONS` — import/export authorization evaluated through existing policy model |
| Quota admission | `services/adapters/src/storage-capacity-quotas.mjs` | `previewStorageObjectQuotaAdmission`, `STORAGE_QUOTA_DIMENSIONS`, `buildStorageQuotaProfile` — pre-validation of batch size before any writes |
| Scoped credentials | `services/adapters/src/storage-programmatic-credentials.mjs` | Attribution of import/export operations to credential holders and owning principals in audit events |
| Error taxonomy | `services/adapters/src/storage-error-taxonomy.mjs` | Extended with import/export-specific error codes; normalized patterns reused |
| Multipart and presigned URLs | `services/adapters/src/storage-multipart-presigned.mjs` | `buildPresignedUrlRecord`, `validatePresignedTtl` — body references in manifest entries use presigned download URL shape |
| Event notifications | `services/adapters/src/storage-event-notifications.mjs` | Convention reference for audit event shape |
| Provider profile | `services/adapters/src/storage-provider-profile.mjs` | Capability-awareness for provider-specific behavior during import/export |
| Tenant storage context | `services/adapters/src/storage-tenant-context.mjs` | `buildTenantStorageContextRecord` — tenant-level isolation anchor for all import/export operations |
| Storage admin control plane | `apps/control-plane/src/storage-admin.mjs` | Import/export constants, route helpers, and preview functions added here |
| Provider catalog | `services/adapters/src/provider-catalog.mjs` | Re-exports new import/export adapter helpers for repo-wide access |
| Public OpenAPI source | `apps/control-plane/openapi/control-plane.openapi.json` | Additive import/export schemas and routes |
| Generated route catalog | `services/internal-contracts/src/public-route-catalog.json` | Publishes discoverable import/export routes |
| Public API taxonomy | `services/internal-contracts/src/public-api-taxonomy.json` | Adds `storage_export_manifest` and `storage_import_result` resource types |
| Internal service map | `services/internal-contracts/src/internal-service-map.json` | Declares adapter capabilities for import/export |
| Existing tests | `tests/unit/storage-admin.test.mjs`, `tests/adapters/storage-bucket-object-ops.test.mjs` | Extended with import/export suites |

## 3. Implementation approach

### 3.1 Adapter layer — `storage-import-export.mjs`

Create `services/adapters/src/storage-import-export.mjs` as the feature-local source of truth for all import/export domain logic:

**Vocabulary constants (frozen records)**

- **`STORAGE_IMPORT_EXPORT_MANIFEST_VERSION`** — current manifest format version: `1`
- **`STORAGE_IMPORT_CONFLICT_POLICIES`** — frozen catalog: `skip`, `overwrite`, `fail`
- **`STORAGE_IMPORT_ENTRY_STATUSES`** — frozen catalog: `imported`, `skipped`, `failed`
- **`STORAGE_IMPORT_EXPORT_OPERATION_DEFAULTS`** — frozen record: `{ maxObjectsPerOperation: 5000, presignedUrlValiditySeconds: 3600 }`
- **`STORAGE_IMPORT_EXPORT_ERROR_CODES`** — frozen record with all new error codes (see §3.2)

**Manifest entry builder**

- **`buildStorageExportManifestEntry(input)`** — constructs one object entry within a manifest. Fields: `objectKey`, `sizeBytes`, `contentType`, `contentEncoding`, `storageClass`, `customMetadata` (object, default `{}`), `lastModifiedAt` (ISO-8601), `bodyReference` (`{ type: 'presigned_url', url, expiresAt }` or `{ type: 'object_read', bucketId, workspaceId, tenantId, objectKey }`). Calls `assertObjectKey` from `storage-bucket-object-ops.mjs` internally to validate `objectKey`. Throws `INVALID_OBJECT_KEY` on violation.

**Export manifest builder**

- **`buildStorageExportManifest(input)`** — constructs the top-level manifest document. Fields: `entityType: 'storage_export_manifest'`, `manifestId` (deterministic from tenantId + bucketId + exportedAt + nonce), `formatVersion` (equals `STORAGE_IMPORT_EXPORT_MANIFEST_VERSION`), `sourceBucketId`, `sourceWorkspaceId`, `sourceTenantId`, `actingPrincipal` (`{ type, id }`), `exportedAt` (ISO-8601), `filterCriteria` (`{ prefix: string | null, metadataFilter: { key, value } | null }`), `totalObjects` (integer ≥ 0), `totalBytes` (integer ≥ 0), `entries` (array of `buildStorageExportManifestEntry` records). Validates that `totalObjects === entries.length` and `totalBytes === sum(entries[*].sizeBytes)`; throws structured consistency error if invariant is violated.

**Import result builders**

- **`buildStorageImportEntryOutcome(input)`** — per-entry result. Fields: `objectKey`, `status` (one of `STORAGE_IMPORT_ENTRY_STATUSES`), `reason` (null on success or skip-without-reason; error code string on failure). Always present for every manifest entry processed.
- **`buildStorageImportResultSummary(input)`** — top-level import result. Fields: `entityType: 'storage_import_result_summary'`, `importId` (deterministic), `targetBucketId`, `targetWorkspaceId`, `targetTenantId`, `actingPrincipal`, `importedAt` (ISO-8601), `conflictPolicy` (one of `STORAGE_IMPORT_CONFLICT_POLICIES`), `totalEntries`, `importedCount`, `skippedCount`, `failedCount`, `totalBytesImported`, `outcomes` (array of `buildStorageImportEntryOutcome` records). Validates that `totalEntries === importedCount + skippedCount + failedCount`; throws consistency error if not.

**Manifest validation**

- **`validateImportManifest(input)`** — pure function. Accepts `{ manifest, maxObjectsPerOperation }`. Returns `{ valid: boolean, errors: string[] }`. Checks: (a) `formatVersion` equals `STORAGE_IMPORT_EXPORT_MANIFEST_VERSION` — else `MANIFEST_VERSION_UNSUPPORTED`; (b) `entries.length` within operational limit — else `OPERATION_LIMIT_EXCEEDED`; (c) no duplicate object keys in `entries` — else `MANIFEST_VALIDATION_ERROR`; (d) structural field presence. Returns first-fail for (a) and (b); accumulates all duplicate-key violations for (c).

**Quota pre-validation**

- **`previewImportQuotaAdmission(input)`** — pure function. Accepts `{ manifest, quotaProfile, currentUsage }`. Computes total bytes across all manifest entries (worst-case: all entries attempted). Delegates to `previewStorageObjectQuotaAdmission` from `storage-capacity-quotas.mjs` for each relevant dimension. Returns `{ admitted: boolean, shortfallBytes: number | null, shortfallObjects: number | null, quotaViolations: array }`.

**Entry-level validation**

- **`validateImportManifestEntry(input)`** — validates a single entry against import rules. Checks: (a) `assertObjectKey` from `storage-bucket-object-ops.mjs` — reason `INVALID_OBJECT_KEY`; (b) `isStorageReservedPrefix` from `storage-logical-organization.mjs` — reason `OBJECT_PROTECTED`; (c) cross-tenant source detection: if `bodyReference.tenantId` is present and differs from `targetTenantId` — reason `CROSS_TENANT_VIOLATION`. Returns `{ valid: boolean, reason: string | null }`.

**Operational limit enforcement**

- **`checkImportExportOperationLimit(input)`** — accepts `{ objectCount, platformLimit, tenantLimitOverride }`. Returns `{ allowed: boolean, appliedLimit: number }`. Tenant override takes precedence when present and non-null.

**Audit event builder**

- **`buildStorageImportExportAuditEvent(input)`** — produces a structured audit event. Fields: `entityType: 'storage_import_export_audit_event'`, `operationType` (`export` or `import`), `actingPrincipal`, `credentialId` (null when no programmatic credential), `sourceBucketId` / `sourceWorkspaceId` / `sourceTenantId` (export) or `targetBucketId` / `targetWorkspaceId` / `targetTenantId` (import), `manifestId`, `filterCriteria` (export only, null on import), `conflictPolicy` (import only, null on export), `objectCount`, `totalBytes` (export) or `totalBytesImported` (import), `importedCount` / `skippedCount` / `failedCount` (import only), `outcome` (`success`, `quota_exceeded`, `authorization_denied`, `manifest_invalid`, `partial_failure`), `timestamp`. MUST NOT include object body content, presigned URL values, or custom metadata.

### 3.2 Error taxonomy extension

Extend `services/adapters/src/storage-error-taxonomy.mjs` with a new `STORAGE_IMPORT_EXPORT_ERROR_CODES` frozen record:

```text
MANIFEST_VALIDATION_ERROR
MANIFEST_VERSION_UNSUPPORTED
OPERATION_LIMIT_EXCEEDED
CROSS_TENANT_VIOLATION
IMPORT_PARTIAL_FAILURE
OBJECT_PROTECTED
EXPORT_EMPTY_RESULT
```

Follow the existing `STORAGE_NORMALIZED_ERROR_CODES` naming convention. Do not alter existing error codes.

### 3.3 Control-plane aggregation — `storage-admin.mjs`

Extend `apps/control-plane/src/storage-admin.mjs` to:

- re-export `STORAGE_IMPORT_CONFLICT_POLICIES`, `STORAGE_IMPORT_ENTRY_STATUSES`, `STORAGE_IMPORT_EXPORT_OPERATION_DEFAULTS`, `STORAGE_IMPORT_EXPORT_ERROR_CODES`, and `STORAGE_IMPORT_EXPORT_MANIFEST_VERSION` alongside the existing storage constant re-exports
- add import/export routes to `listStorageAdminRoutes` and `getStorageAdminRoute`
- expose preview/summary helpers: `previewStorageExportManifest`, `previewStorageImportResult`, `validateStorageImportManifest`, `checkStorageImportExportLimit`

**`previewStorageExportManifest(input)`** — composes `buildStorageExportManifest` from provided entries and filter criteria. Returns `{ manifest, auditEvent }` where `auditEvent` comes from `buildStorageImportExportAuditEvent` with `operationType: 'export'`. Enforces operational limit before building.

**`previewStorageImportResult(input)`** — composes `buildStorageImportResultSummary` from per-entry outcomes. Returns `{ summary, auditEvent }` where `auditEvent` has `operationType: 'import'`. Handles `conflictPolicy: 'fail'` case by returning a summary with `failedCount: 1` and the conflicting key in outcomes.

**`validateStorageImportManifest(input)`** — thin wrapper around `validateImportManifest`, surfaces `STORAGE_IMPORT_EXPORT_ERROR_CODES` values in the validation error array.

**`checkStorageImportExportLimit(input)`** — thin wrapper around `checkImportExportOperationLimit`.

### 3.4 Contract publication

Update `apps/control-plane/openapi/control-plane.openapi.json` with additive import/export schemas and routes:

- `POST /v1/storage/workspaces/{workspaceId}/buckets/{bucketId}/exports` — initiate export; returns manifest
- `POST /v1/storage/workspaces/{workspaceId}/buckets/{bucketId}/imports` — submit manifest for import; returns import result summary
- `GET /v1/storage/workspaces/{workspaceId}/buckets/{bucketId}/exports/{manifestId}` — retrieve a previously produced manifest by ID

Then regenerate the published artifacts (family doc, route catalog, taxonomy, service-map, public API surface docs) to remain in sync.

## 4. Files changed

### 4.1 New source files

- `services/adapters/src/storage-import-export.mjs`

### 4.2 Modified source files

- `services/adapters/src/storage-error-taxonomy.mjs` — add `STORAGE_IMPORT_EXPORT_ERROR_CODES`
- `services/adapters/src/provider-catalog.mjs` — re-export new import/export helpers
- `apps/control-plane/src/storage-admin.mjs` — import/export constants, route helpers, preview functions

### 4.3 Published API artifacts

- `apps/control-plane/openapi/control-plane.openapi.json`
- `apps/control-plane/openapi/families/storage.openapi.json`
- `services/internal-contracts/src/public-route-catalog.json`
- `services/internal-contracts/src/public-api-taxonomy.json`
- `services/internal-contracts/src/internal-service-map.json`
- `docs/reference/architecture/public-api-surface.md`

### 4.4 Spec Kit artifacts

- `specs/021-storage-import-export/spec.md`
- `specs/021-storage-import-export/plan.md`
- `specs/021-storage-import-export/tasks.md`

### 4.5 Tests

- `tests/adapters/storage-import-export.test.mjs` — new
- `tests/unit/storage-import-export.test.mjs` — new
- `tests/unit/storage-admin.test.mjs` — extended with import/export preview suites
- `tests/contracts/storage-provider.contract.test.mjs` — extended for import/export routes
- `tests/unit/public-api.test.mjs` — extended for import/export taxonomy and route catalog

## 5. Validation plan

The implementation is considered ready when these checks pass:

- adapter tests for manifest builder (consistency invariant, `EXPORT_EMPTY_RESULT` path), manifest entry builder (`assertObjectKey` integration, reserved-prefix rejection), import result summary builder, `validateImportManifest` (duplicate-key detection, version check, limit check), `previewImportQuotaAdmission`, `checkImportExportOperationLimit`, and audit event cleanliness
- unit tests for `buildStorageImportResultSummary` consistency (total = imported + skipped + failed), conflict-policy behavior, `validateImportManifestEntry` per-reason paths, and `STORAGE_IMPORT_EXPORT_ERROR_CODES` uniqueness/naming convention
- storage admin unit tests for preview helper shapes, route discoverability, and constant re-exports
- contract tests for additive OpenAPI schemas, route metadata, taxonomy entries, and service-map coverage
- generated public API artifacts are in sync with the OpenAPI source
- repo markdown lint passes for the new Spec Kit artifacts

Validation command:

```bash
npm test -- --test-concurrency=1 \
  tests/adapters/storage-import-export.test.mjs \
  tests/unit/storage-import-export.test.mjs \
  tests/unit/storage-admin.test.mjs \
  tests/contracts/storage-provider.contract.test.mjs \
  tests/unit/public-api.test.mjs \
  tests/contracts/control-plane.openapi.test.mjs
```

## 6. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Manifest consistency invariant violations (totalObjects/totalBytes mismatch) | Enforce in `buildStorageExportManifest` with a guard that throws a structured error; covered by dedicated unit test |
| Duplicate key detection at large manifest sizes | `validateImportManifest` uses a `Set` for O(n) detection regardless of manifest size |
| Reserved-prefix objects silently passing validation | `validateImportManifestEntry` calls `isStorageReservedPrefix` before quota check; covered by per-entry tests |
| Audit events leaking presigned URL values | `buildStorageImportExportAuditEvent` never accepts `entries` or `bodyReference` — only structural counts and identifiers; asserted in tests |
| Cross-tenant manifest references bypassing isolation | `validateImportManifestEntry` checks `bodyReference.tenantId` against `targetTenantId`; covered by cross-tenant violation test |
| Quota pre-validation race condition | Pre-validation is explicitly best-effort; spec documents that the quota admission check at write time is the ultimate guardrail; no mitigation needed in this slice |
| New import/export routes drifting from generated artifacts | Regenerate published API artifacts after every OpenAPI change before running contract tests |
| `objectKey` normalization diverging from existing rules | Reuse `assertObjectKey` directly from `storage-bucket-object-ops.mjs`; never duplicate the validation logic |

## 7. Rollback plan

If this increment needs to be reverted:

1. Revert commit `feat(storage): add import/export manifest surface`
2. Regenerate the public API artifacts if the revert is partial
3. Rerun the validation command and the default CI checks
4. No data migrations are involved — this task is additive and does not write to any persistent store

## 8. Exit criteria

This task is complete when:

- `specs/021-storage-import-export/spec.md`, `plan.md`, and `tasks.md` exist
- `services/adapters/src/storage-import-export.mjs` is created and exported via `provider-catalog.mjs`
- `storage-error-taxonomy.mjs` exports `STORAGE_IMPORT_EXPORT_ERROR_CODES`
- `storage-admin.mjs` exposes import/export preview helpers and the new routes appear in `listStorageAdminRoutes`
- OpenAPI, route catalog, taxonomy, and service-map artifacts are updated and in sync
- Local validation command above passes green
- Branch is pushed, PR is opened, and CI is green for merge
