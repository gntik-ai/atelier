import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStorageBucketUsageEntry,
  buildStorageUsageDimensionStatus,
  buildStorageUsageSnapshot,
  buildStorageWorkspaceUsageEntry,
  detectStorageUsageThresholdBreaches
} from '../../services/adapters/src/storage-usage-reporting.mjs';

test('workspace usage composition stays additively consistent end to end', () => {
  const buckets = [
    buildStorageBucketUsageEntry({ bucketId: 'b1', workspaceId: 'w1', tenantId: 't1', totalBytes: 500, objectCount: 1000, largestObjectSizeBytes: 50 }),
    buildStorageBucketUsageEntry({ bucketId: 'b2', workspaceId: 'w1', tenantId: 't1', totalBytes: 200, objectCount: 300, largestObjectSizeBytes: 20 }),
    buildStorageBucketUsageEntry({ bucketId: 'b3', workspaceId: 'w1', tenantId: 't1', totalBytes: 50, objectCount: 50, largestObjectSizeBytes: 10 })
  ];
  const workspace = buildStorageWorkspaceUsageEntry({ workspaceId: 'w1', tenantId: 't1', totalBytes: 750, objectCount: 1350, bucketCount: 3, buckets });
  const snapshot = buildStorageUsageSnapshot({
    scopeType: 'workspace',
    scopeId: 'w1',
    tenantId: 't1',
    dimensions: [
      buildStorageUsageDimensionStatus({ dimension: 'total_bytes', used: 750, limit: 1000 }),
      buildStorageUsageDimensionStatus({ dimension: 'bucket_count', used: 3, limit: 5 }),
      buildStorageUsageDimensionStatus({ dimension: 'object_count', used: 1350, limit: 5000 }),
      buildStorageUsageDimensionStatus({ dimension: 'object_size_bytes', used: 50, limit: 500 })
    ],
    breakdown: workspace.buckets,
    collectionMethod: 'provider_admin_api',
    collectionStatus: 'ok',
    snapshotAt: '2026-03-28T00:00:00Z'
  });
  const breaches = detectStorageUsageThresholdBreaches({ snapshot });

  assert.equal(workspace.totalBytes, buckets.reduce((sum, bucket) => sum + bucket.totalBytes, 0));
  assert.equal(workspace.objectCount, buckets.reduce((sum, bucket) => sum + bucket.objectCount, 0));
  assert.equal(workspace.bucketCount, buckets.length);
  assert.equal(snapshot.buckets.length, 3);
  assert.equal(breaches.length, 0);
});
