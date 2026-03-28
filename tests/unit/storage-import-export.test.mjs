import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STORAGE_IMPORT_CONFLICT_POLICIES,
  STORAGE_IMPORT_ENTRY_STATUSES,
  STORAGE_IMPORT_EXPORT_MANIFEST_VERSION,
  STORAGE_IMPORT_EXPORT_OPERATION_DEFAULTS,
  buildStorageExportManifest,
  buildStorageExportManifestEntry,
  buildStorageImportEntryOutcome,
  buildStorageImportExportAuditEvent,
  buildStorageImportResultSummary,
  checkImportExportOperationLimit,
  previewImportQuotaAdmission,
  validateImportManifest,
  validateImportManifestEntry
} from '../../services/adapters/src/storage-import-export.mjs';
import {
  STORAGE_IMPORT_EXPORT_ERROR_CODES,
  STORAGE_NORMALIZED_ERROR_CODES,
  STORAGE_USAGE_ERROR_CODES
} from '../../services/adapters/src/storage-error-taxonomy.mjs';
import { buildStorageQuotaProfile } from '../../services/adapters/src/storage-capacity-quotas.mjs';

test('import/export catalogs are frozen and non-empty', () => {
  for (const catalog of [STORAGE_IMPORT_CONFLICT_POLICIES, STORAGE_IMPORT_ENTRY_STATUSES, STORAGE_IMPORT_EXPORT_OPERATION_DEFAULTS, STORAGE_IMPORT_EXPORT_ERROR_CODES]) {
    assert.equal(Object.keys(catalog).length > 0, true);
    assert.equal(Object.isFrozen(catalog), true);
  }
  assert.equal(STORAGE_IMPORT_EXPORT_MANIFEST_VERSION, 1);
});

test('error codes are unique and additive', () => {
  const values = Object.values(STORAGE_IMPORT_EXPORT_ERROR_CODES);
  assert.equal(new Set(values).size, values.length);
  for (const code of values) {
    assert.match(code, /^[A-Z0-9_]+$/);
    assert.equal(Object.values(STORAGE_NORMALIZED_ERROR_CODES).includes(code), false);
    assert.equal(Object.values(STORAGE_USAGE_ERROR_CODES).includes(code), false);
  }
});

test('manifest entry and manifest builders preserve metadata and totals', () => {
  const entry = buildStorageExportManifestEntry({
    objectKey: 'data/file.json',
    sizeBytes: 12,
    contentType: 'application/json',
    customMetadata: { env: 'test' },
    lastModifiedAt: '2026-03-28T00:00:00Z',
    bodyReference: { type: 'object_read', bucketId: 'b1', workspaceId: 'w1', tenantId: 't1', objectKey: 'data/file.json' }
  });
  const manifest = buildStorageExportManifest({
    sourceBucketId: 'b1', sourceWorkspaceId: 'w1', sourceTenantId: 't1', actingPrincipal: { type: 'user', id: 'u1' }, exportedAt: '2026-03-28T00:00:00Z', entries: [entry]
  });
  assert.equal(entry.entityType, 'storage_export_manifest_entry');
  assert.deepEqual(entry.customMetadata, { env: 'test' });
  assert.equal(manifest.entityType, 'storage_export_manifest');
  assert.equal(manifest.totalObjects, 1);
  assert.equal(manifest.totalBytes, 12);
  assert.equal(manifest.formatVersion, STORAGE_IMPORT_EXPORT_MANIFEST_VERSION);
});

test('invalid object key is rejected in entry and manifest-entry validation detects reserved/cross-tenant cases', () => {
  assert.throws(() => buildStorageExportManifestEntry({ objectKey: '/bad', bodyReference: { type: 'object_read', bucketId: 'b', workspaceId: 'w', tenantId: 't' } }), /Invalid object key/);
  assert.deepEqual(validateImportManifestEntry({ entry: { objectKey: '/bad' }, targetTenantId: 't1' }), { valid: false, reason: 'INVALID_OBJECT_KEY' });
  assert.deepEqual(validateImportManifestEntry({ entry: { objectKey: 'tenants/t1/workspaces/w1/_platform/x', bodyReference: { tenantId: 't1' } }, targetTenantId: 't1' }), { valid: false, reason: 'OBJECT_PROTECTED' });
  assert.deepEqual(validateImportManifestEntry({ entry: { objectKey: 'ok/file.txt', bodyReference: { tenantId: 'other' } }, targetTenantId: 't1' }), { valid: false, reason: 'CROSS_TENANT_VIOLATION' });
});

test('import result summary derives counts and bytes', () => {
  const summary = buildStorageImportResultSummary({
    targetBucketId: 'b2', targetWorkspaceId: 'w2', targetTenantId: 't1', actingPrincipal: { type: 'user', id: 'u1' }, importedAt: '2026-03-28T00:00:00Z', conflictPolicy: STORAGE_IMPORT_CONFLICT_POLICIES.SKIP,
    outcomes: [
      buildStorageImportEntryOutcome({ objectKey: 'a', status: STORAGE_IMPORT_ENTRY_STATUSES.IMPORTED, reason: null, sizeBytes: 10 }),
      buildStorageImportEntryOutcome({ objectKey: 'b', status: STORAGE_IMPORT_ENTRY_STATUSES.SKIPPED, reason: null, sizeBytes: 20 }),
      buildStorageImportEntryOutcome({ objectKey: 'c', status: STORAGE_IMPORT_ENTRY_STATUSES.FAILED, reason: 'INVALID_OBJECT_KEY', sizeBytes: 30 })
    ]
  });
  assert.equal(summary.totalEntries, 3);
  assert.equal(summary.importedCount, 1);
  assert.equal(summary.skippedCount, 1);
  assert.equal(summary.failedCount, 1);
  assert.equal(summary.totalBytesImported, 10);
});

test('manifest validation short-circuits on version/limit and reports duplicate keys', () => {
  const base = buildStorageExportManifest({
    sourceBucketId: 'b1', sourceWorkspaceId: 'w1', sourceTenantId: 't1', actingPrincipal: { type: 'user', id: 'u1' }, entries: []
  });
  assert.deepEqual(validateImportManifest({ manifest: { ...base, formatVersion: 2 }, maxObjectsPerOperation: 1 }), { valid: false, errors: ['MANIFEST_VERSION_UNSUPPORTED'] });
  assert.deepEqual(validateImportManifest({ manifest: { ...base, entries: [{ objectKey: 'a' }, { objectKey: 'b' }] }, maxObjectsPerOperation: 1 }), { valid: false, errors: ['OPERATION_LIMIT_EXCEEDED'] });
  const duplicate = validateImportManifest({ manifest: { ...base, entries: [{ objectKey: 'a' }, { objectKey: 'a' }] }, maxObjectsPerOperation: 10 });
  assert.equal(duplicate.valid, false);
  assert.deepEqual(duplicate.errors, ['MANIFEST_VALIDATION_ERROR']);
  assert.deepEqual(duplicate.duplicateKeys, ['a']);
});

test('quota admission and limit checks surface additive previews', () => {
  const quotaProfile = buildStorageQuotaProfile({ workspaceId: 'w1', tenantId: 't1', workspaceUsage: { totalBytes: 0, bucketCount: 0, objectCount: 0 }, workspaceLimits: { totalBytes: 100, maxBuckets: 5, maxObjects: 5, maxObjectSizeBytes: 100 } });
  const manifest = buildStorageExportManifest({ sourceBucketId: 'b1', sourceWorkspaceId: 'w1', sourceTenantId: 't1', actingPrincipal: { type: 'user', id: 'u1' }, entries: [buildStorageExportManifestEntry({ objectKey: 'a', sizeBytes: 10, bodyReference: { type: 'object_read', bucketId: 'b1', workspaceId: 'w1', tenantId: 't1', objectKey: 'a' } })] });
  const admitted = previewImportQuotaAdmission({ manifest, quotaProfile });
  assert.equal(admitted.admitted, true);
  assert.equal(admitted.requestedBytes, 10);
  assert.equal(admitted.requestedObjectCount, 1);
  assert.deepEqual(checkImportExportOperationLimit({ objectCount: 5, platformLimit: 5 }), { allowed: true, appliedLimit: 5 });
  assert.deepEqual(checkImportExportOperationLimit({ objectCount: 6, platformLimit: 5 }), { allowed: false, appliedLimit: 5 });
});

test('audit event builder excludes unsafe payloads', () => {
  const event = buildStorageImportExportAuditEvent({ operationType: 'export', actingPrincipal: { type: 'user', id: 'u1' }, manifestId: 'm1', sourceBucketId: 'b1', sourceWorkspaceId: 'w1', sourceTenantId: 't1', objectCount: 0, totalBytes: 0, outcome: 'success', timestamp: '2026-03-28T00:00:00Z' });
  assert.equal(event.entityType, 'storage_import_export_audit_event');
  assert.throws(() => buildStorageImportExportAuditEvent({ operationType: 'export', actingPrincipal: { type: 'user', id: 'u1' }, manifestId: 'm1', entries: [] }), /must not include entries/);
});
