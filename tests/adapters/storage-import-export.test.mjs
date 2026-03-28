import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STORAGE_IMPORT_CONFLICT_POLICIES,
  STORAGE_IMPORT_ENTRY_STATUSES,
  buildStorageExportManifest,
  buildStorageExportManifestEntry,
  buildStorageImportEntryOutcome,
  buildStorageImportResultSummary,
  checkImportExportOperationLimit,
  previewImportQuotaAdmission,
  validateImportManifest,
  validateImportManifestEntry
} from '../../services/adapters/src/storage-import-export.mjs';
import { buildStorageQuotaProfile } from '../../services/adapters/src/storage-capacity-quotas.mjs';
import { previewStorageImportResult } from '../../apps/control-plane/src/storage-admin.mjs';

function makeEntry(objectKey, sizeBytes) {
  return buildStorageExportManifestEntry({
    objectKey,
    sizeBytes,
    contentType: 'application/octet-stream',
    bodyReference: { type: 'object_read', bucketId: 'b1', workspaceId: 'w1', tenantId: 't1', objectKey }
  });
}

test('record-level export to import round-trip remains consistent', () => {
  const entries = [makeEntry('a.txt', 10), makeEntry('b.txt', 20), makeEntry('c.txt', 30)];
  const manifest = buildStorageExportManifest({ sourceBucketId: 'b1', sourceWorkspaceId: 'w1', sourceTenantId: 't1', actingPrincipal: { type: 'user', id: 'u1' }, entries });
  const valid = validateImportManifest({ manifest, maxObjectsPerOperation: 10 });
  const quotaProfile = buildStorageQuotaProfile({ workspaceId: 'w2', tenantId: 't1', workspaceUsage: { totalBytes: 0, bucketCount: 0, objectCount: 0 }, workspaceLimits: { totalBytes: 100, maxBuckets: 5, maxObjects: 10, maxObjectSizeBytes: 100 } });
  const admission = previewImportQuotaAdmission({ manifest, quotaProfile });
  const outcomes = entries.map((entry) => buildStorageImportEntryOutcome({ objectKey: entry.objectKey, status: STORAGE_IMPORT_ENTRY_STATUSES.IMPORTED, sizeBytes: entry.sizeBytes }));
  const summary = buildStorageImportResultSummary({ targetBucketId: 'b2', targetWorkspaceId: 'w2', targetTenantId: 't1', actingPrincipal: { type: 'user', id: 'u1' }, conflictPolicy: STORAGE_IMPORT_CONFLICT_POLICIES.OVERWRITE, outcomes });

  assert.deepEqual(valid, { valid: true, errors: [] });
  for (const entry of entries) assert.deepEqual(validateImportManifestEntry({ entry, targetTenantId: 't1' }), { valid: true, reason: null });
  assert.equal(admission.admitted, true);
  assert.equal(summary.totalBytesImported, manifest.totalBytes);
});

test('skip and fail conflict policies remain accurately summarized', () => {
  const manifest = buildStorageExportManifest({ sourceBucketId: 'b1', sourceWorkspaceId: 'w1', sourceTenantId: 't1', actingPrincipal: { type: 'user', id: 'u1' }, entries: [makeEntry('a.txt', 10), makeEntry('b.txt', 20), makeEntry('c.txt', 30)] });
  const skipSummary = buildStorageImportResultSummary({ targetBucketId: 'b2', targetWorkspaceId: 'w2', targetTenantId: 't1', actingPrincipal: { type: 'user', id: 'u1' }, conflictPolicy: STORAGE_IMPORT_CONFLICT_POLICIES.SKIP, outcomes: [
    buildStorageImportEntryOutcome({ objectKey: 'a.txt', status: 'skipped', sizeBytes: 10 }),
    buildStorageImportEntryOutcome({ objectKey: 'b.txt', status: 'imported', sizeBytes: 20 }),
    buildStorageImportEntryOutcome({ objectKey: 'c.txt', status: 'imported', sizeBytes: 30 })
  ] });
  const failPreview = previewStorageImportResult({ targetBucketId: 'b2', targetWorkspaceId: 'w2', targetTenantId: 't1', actingPrincipal: { type: 'user', id: 'u1' }, conflictPolicy: STORAGE_IMPORT_CONFLICT_POLICIES.FAIL, outcomes: [buildStorageImportEntryOutcome({ objectKey: manifest.entries[0].objectKey, status: 'failed', reason: 'CONFLICT_FAIL_ABORT', sizeBytes: 10 })] });

  assert.equal(skipSummary.importedCount, 2);
  assert.equal(skipSummary.skippedCount, 1);
  assert.equal(skipSummary.failedCount, 0);
  assert.equal(skipSummary.totalBytesImported, 50);
  assert.equal(failPreview.auditEvent.outcome, 'manifest_invalid');
});

test('end-to-end operation limit is inclusive', () => {
  assert.deepEqual(checkImportExportOperationLimit({ objectCount: 5000 }), { allowed: true, appliedLimit: 5000 });
  assert.deepEqual(checkImportExportOperationLimit({ objectCount: 5001 }), { allowed: false, appliedLimit: 5000 });
});
