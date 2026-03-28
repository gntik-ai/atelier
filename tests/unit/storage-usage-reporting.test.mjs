import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STORAGE_USAGE_COLLECTION_STATUSES,
  STORAGE_USAGE_THRESHOLD_DEFAULTS,
  STORAGE_USAGE_THRESHOLD_SEVERITIES,
  buildStorageBucketUsageEntry,
  buildStorageCrossTenantUsageSummary,
  buildStorageUsageAuditEvent,
  buildStorageUsageDimensionStatus,
  buildStorageUsageSnapshot,
  buildStorageWorkspaceUsageEntry,
  detectStorageUsageThresholdBreaches,
  rankBucketsByUsage
} from '../../services/adapters/src/storage-usage-reporting.mjs';

test('storage usage dimension status computes remaining and utilization consistently', () => {
  const status = buildStorageUsageDimensionStatus({ dimension: 'total_bytes', used: 125, limit: 100 });
  const unlimited = buildStorageUsageDimensionStatus({ dimension: 'object_count', used: 5, limit: null });
  const rounded = buildStorageUsageDimensionStatus({ dimension: 'bucket_count', used: 1, limit: 3 });

  assert.equal(status.remaining, -25);
  assert.equal(status.utilizationPercent, 125);
  assert.equal(unlimited.remaining, null);
  assert.equal(unlimited.utilizationPercent, null);
  assert.equal(rounded.utilizationPercent, 33.33);
});

test('storage bucket and workspace usage entries preserve additive totals', () => {
  const buckets = [
    buildStorageBucketUsageEntry({ bucketId: 'b1', workspaceId: 'w1', tenantId: 't1', totalBytes: 10, objectCount: 2 }),
    buildStorageBucketUsageEntry({ bucketId: 'b2', workspaceId: 'w1', tenantId: 't1', totalBytes: 20, objectCount: 3 })
  ];
  const workspace = buildStorageWorkspaceUsageEntry({ workspaceId: 'w1', tenantId: 't1', totalBytes: 30, objectCount: 5, bucketCount: 2, buckets });

  assert.equal(workspace.entityType, 'storage_workspace_usage_entry');
  assert.equal(workspace.bucketCount, 2);
  assert.equal(workspace.buckets.length, 2);
  assert.throws(() => buildStorageWorkspaceUsageEntry({ workspaceId: 'w1', tenantId: 't1', totalBytes: 999, objectCount: 5, bucketCount: 2, buckets }), /inconsistent/i);
});

test('storage usage snapshot is deterministic and provider unavailable without cache empties breakdown', () => {
  const dimensions = [
    buildStorageUsageDimensionStatus({ dimension: 'total_bytes', used: 30, limit: 100 }),
    buildStorageUsageDimensionStatus({ dimension: 'bucket_count', used: 2, limit: 5 }),
    buildStorageUsageDimensionStatus({ dimension: 'object_count', used: 5, limit: 10 }),
    buildStorageUsageDimensionStatus({ dimension: 'object_size_bytes', used: 20, limit: 50 })
  ];
  const buckets = [buildStorageBucketUsageEntry({ bucketId: 'b1', workspaceId: 'w1', tenantId: 't1', totalBytes: 30, objectCount: 5 })];
  const a = buildStorageUsageSnapshot({ scopeType: 'workspace', scopeId: 'w1', tenantId: 't1', dimensions, breakdown: buckets, snapshotAt: '2026-03-28T00:00:00Z', collectionMethod: 'platform_estimate', collectionStatus: 'ok' });
  const b = buildStorageUsageSnapshot({ scopeType: 'workspace', scopeId: 'w1', tenantId: 't1', dimensions, breakdown: buckets, snapshotAt: '2026-03-28T00:00:00Z', collectionMethod: 'platform_estimate', collectionStatus: 'ok' });
  const unavailable = buildStorageUsageSnapshot({ scopeType: 'workspace', scopeId: 'w1', tenantId: 't1', dimensions, breakdown: buckets, snapshotAt: '2026-03-28T00:00:00Z', collectionMethod: 'cached_snapshot', collectionStatus: STORAGE_USAGE_COLLECTION_STATUSES.PROVIDER_UNAVAILABLE, cacheSnapshotAt: null });

  assert.equal(a.snapshotId, b.snapshotId);
  assert.equal(unavailable.breakdown.length, 0);
  assert.deepEqual(a.buckets, buckets);
});

test('threshold detection handles warning critical over-quota and custom thresholds', () => {
  const snapshot = buildStorageUsageSnapshot({
    scopeType: 'workspace',
    scopeId: 'w1',
    tenantId: 't1',
    dimensions: [
      buildStorageUsageDimensionStatus({ dimension: 'total_bytes', used: 85, limit: 100 }),
      buildStorageUsageDimensionStatus({ dimension: 'bucket_count', used: 5, limit: 5 }),
      buildStorageUsageDimensionStatus({ dimension: 'object_count', used: 4, limit: 10 }),
      buildStorageUsageDimensionStatus({ dimension: 'object_size_bytes', used: 150, limit: 100 })
    ],
    breakdown: [],
    snapshotAt: '2026-03-28T00:00:00Z',
    collectionMethod: 'platform_estimate',
    collectionStatus: 'ok'
  });
  const breaches = detectStorageUsageThresholdBreaches({ snapshot });
  const custom = detectStorageUsageThresholdBreaches({ snapshot, thresholds: { warning: 70, critical: 90 } });

  assert.equal(breaches.length, 3);
  assert.equal(breaches.find((entry) => entry.dimension === 'total_bytes').severity, STORAGE_USAGE_THRESHOLD_SEVERITIES.WARNING);
  assert.equal(breaches.find((entry) => entry.dimension === 'bucket_count').severity, STORAGE_USAGE_THRESHOLD_SEVERITIES.CRITICAL);
  assert.equal(breaches.find((entry) => entry.dimension === 'object_size_bytes').thresholdPercent, STORAGE_USAGE_THRESHOLD_DEFAULTS.critical);
  assert.equal(custom.find((entry) => entry.dimension === 'total_bytes').thresholdPercent, 70);
});

test('bucket ranking and audit events are stable and payload-safe', () => {
  const ranked = rankBucketsByUsage({
    buckets: [
      buildStorageBucketUsageEntry({ bucketId: 'b1', workspaceId: 'w1', tenantId: 't1', totalBytes: 10, objectCount: 100 }),
      buildStorageBucketUsageEntry({ bucketId: 'b2', workspaceId: 'w1', tenantId: 't1', totalBytes: 30, objectCount: 50 }),
      buildStorageBucketUsageEntry({ bucketId: 'b3', workspaceId: 'w1', tenantId: 't1', totalBytes: 20, objectCount: 150 })
    ],
    sortDimension: 'object_count',
    topN: 2
  });
  const event = buildStorageUsageAuditEvent({ actorPrincipal: 'usr_01', scopeType: 'workspace', scopeId: 'w1', tenantId: 't1', timestamp: '2026-03-28T00:00:00Z' });

  assert.deepEqual(ranked.map((entry) => entry.bucketId), ['b3', 'b1']);
  assert.deepEqual(ranked.map((entry) => entry.rank), [1, 2]);
  assert.equal(event.eventType, 'storage.usage.queried');
  assert.equal('totalBytes' in event, false);
});

test('cross tenant usage summary sorts by total bytes and truncates topN', () => {
  const makeSnapshot = (tenantId, totalBytes) => buildStorageUsageSnapshot({
    scopeType: 'tenant',
    scopeId: tenantId,
    tenantId,
    dimensions: [
      buildStorageUsageDimensionStatus({ dimension: 'total_bytes', used: totalBytes, limit: totalBytes * 2 }),
      buildStorageUsageDimensionStatus({ dimension: 'bucket_count', used: 1, limit: 5 }),
      buildStorageUsageDimensionStatus({ dimension: 'object_count', used: 2, limit: 10 }),
      buildStorageUsageDimensionStatus({ dimension: 'object_size_bytes', used: 3, limit: 100 })
    ],
    breakdown: [],
    collectionMethod: 'platform_estimate',
    collectionStatus: 'ok',
    snapshotAt: '2026-03-28T00:00:00Z',
    status: 'active'
  });
  const summary = buildStorageCrossTenantUsageSummary({ tenantSnapshots: [makeSnapshot('t1', 20), makeSnapshot('t2', 50), makeSnapshot('t3', 10)], topN: 2 });

  assert.equal(summary.entityType, 'storage_cross_tenant_usage_summary');
  assert.deepEqual(summary.tenants.map((entry) => entry.tenantId), ['t2', 't1']);
  assert.equal(typeof summary.generatedAt, 'string');
});
