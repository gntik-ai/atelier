import {
  STORAGE_QUOTA_DIMENSIONS,
  STORAGE_QUOTA_SCOPE_TYPES
} from './storage-capacity-quotas.mjs';
import { STORAGE_NORMALIZED_ERROR_CODES } from './storage-error-taxonomy.mjs';

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return value;
}

function toFiniteNumber(value, fallback = 0) {
  if (value == null || value === '') {
    return fallback;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toNonNegativeNumber(value, fallback = 0) {
  return Math.max(toFiniteNumber(value, fallback), 0);
}

function normalizeDimension(dimension) {
  if (!Object.values(STORAGE_QUOTA_DIMENSIONS).includes(dimension)) {
    throw new Error(`Unsupported storage usage dimension: ${dimension}`);
  }

  return dimension;
}

function normalizeScopeType(scopeType) {
  if (![...Object.values(STORAGE_QUOTA_SCOPE_TYPES), 'bucket'].includes(scopeType)) {
    throw new Error(`Unsupported storage usage scope: ${scopeType}`);
  }

  return scopeType;
}

function normalizeCollectionMethod(method) {
  return Object.values(STORAGE_USAGE_COLLECTION_METHODS).includes(method)
    ? method
    : STORAGE_USAGE_COLLECTION_METHODS.PLATFORM_ESTIMATE;
}

function normalizeCollectionStatus(status) {
  return Object.values(STORAGE_USAGE_COLLECTION_STATUSES).includes(status)
    ? status
    : STORAGE_USAGE_COLLECTION_STATUSES.OK;
}

function normalizeSeverity(severity) {
  if (!Object.values(STORAGE_USAGE_THRESHOLD_SEVERITIES).includes(severity)) {
    throw new Error(`Unsupported storage usage threshold severity: ${severity}`);
  }

  return severity;
}

function buildSnapshotId({ scopeType, scopeId, tenantId, snapshotAt, collectionMethod, collectionStatus }) {
  return [scopeType ?? 'unknown', scopeId ?? 'unknown', tenantId ?? 'none', snapshotAt ?? 'unknown', collectionMethod ?? 'unknown', collectionStatus ?? 'unknown']
    .join(':');
}

function sumBuckets(buckets, field) {
  return buckets.reduce((total, bucket) => total + toNonNegativeNumber(bucket?.[field], 0), 0);
}

function getDimensionRecord(snapshot, dimension) {
  const key = DIMENSION_PROPERTY_BY_NAME[dimension];
  return snapshot?.dimensions?.[key] ?? null;
}

function getDimensionValue(entry, sortDimension) {
  if (sortDimension === STORAGE_QUOTA_DIMENSIONS.OBJECT_COUNT) {
    return toNonNegativeNumber(entry?.objectCount, 0);
  }

  return toNonNegativeNumber(entry?.totalBytes, 0);
}

function buildQuotaLimitMap(snapshot) {
  return Object.fromEntries(Object.values(STORAGE_QUOTA_DIMENSIONS).map((dimension) => {
    const status = getDimensionRecord(snapshot, dimension);
    return [dimension, status?.limit ?? null];
  }));
}

function buildUtilizationMap(snapshot) {
  return Object.fromEntries(Object.values(STORAGE_QUOTA_DIMENSIONS).map((dimension) => {
    const status = getDimensionRecord(snapshot, dimension);
    return [dimension, status?.utilizationPercent ?? null];
  }));
}

export const STORAGE_USAGE_COLLECTION_METHODS = deepFreeze({
  PROVIDER_ADMIN_API: 'provider_admin_api',
  CACHED_SNAPSHOT: 'cached_snapshot',
  PLATFORM_ESTIMATE: 'platform_estimate'
});

export const STORAGE_USAGE_COLLECTION_STATUSES = deepFreeze({
  OK: 'ok',
  PROVIDER_UNAVAILABLE: 'provider_unavailable',
  PARTIAL: 'partial'
});

export const STORAGE_USAGE_THRESHOLD_SEVERITIES = deepFreeze({
  WARNING: 'warning',
  CRITICAL: 'critical'
});

export const STORAGE_USAGE_THRESHOLD_DEFAULTS = deepFreeze({
  warning: 80,
  critical: 95
});

export const STORAGE_USAGE_ENTITY_TYPES = deepFreeze({
  SNAPSHOT: 'storage_usage_snapshot',
  BUCKET_ENTRY: 'storage_bucket_usage_entry',
  WORKSPACE_ENTRY: 'storage_workspace_usage_entry',
  THRESHOLD_BREACH: 'storage_usage_threshold_breach',
  AUDIT_EVENT: 'storage_usage_audit_event',
  CROSS_TENANT_SUMMARY: 'storage_cross_tenant_usage_summary'
});

export const STORAGE_USAGE_DIMENSION_KEYS = deepFreeze({
  [STORAGE_QUOTA_DIMENSIONS.TOTAL_BYTES]: 'totalBytes',
  [STORAGE_QUOTA_DIMENSIONS.BUCKET_COUNT]: 'bucketCount',
  [STORAGE_QUOTA_DIMENSIONS.OBJECT_COUNT]: 'objectCount',
  [STORAGE_QUOTA_DIMENSIONS.OBJECT_SIZE_BYTES]: 'objectSizeBytes'
});

const DIMENSION_PROPERTY_BY_NAME = STORAGE_USAGE_DIMENSION_KEYS;

export function buildStorageUsageDimensionStatus({
  dimension,
  used = 0,
  limit = null
} = {}) {
  const normalizedDimension = normalizeDimension(dimension);
  const normalizedUsed = toNonNegativeNumber(used, 0);
  const normalizedLimit = limit == null ? null : toNonNegativeNumber(limit, 0);

  return deepFreeze({
    dimension: normalizedDimension,
    used: normalizedUsed,
    limit: normalizedLimit,
    remaining: normalizedLimit == null ? null : normalizedLimit - normalizedUsed,
    utilizationPercent: normalizedLimit == null
      ? null
      : Math.round((normalizedUsed / normalizedLimit) * 10000) / 100
  });
}

export function buildStorageBucketUsageEntry({
  bucketId = null,
  workspaceId = null,
  tenantId = null,
  totalBytes = 0,
  objectCount = 0,
  largestObjectSizeBytes = 0
} = {}) {
  return deepFreeze({
    entityType: STORAGE_USAGE_ENTITY_TYPES.BUCKET_ENTRY,
    bucketId,
    workspaceId,
    tenantId,
    totalBytes: toNonNegativeNumber(totalBytes, 0),
    objectCount: toNonNegativeNumber(objectCount, 0),
    largestObjectSizeBytes: toNonNegativeNumber(largestObjectSizeBytes, 0)
  });
}

export function buildStorageWorkspaceUsageEntry({
  workspaceId = null,
  tenantId = null,
  totalBytes = 0,
  objectCount = 0,
  bucketCount = null,
  buckets = []
} = {}) {
  const normalizedBuckets = (buckets ?? []).map((bucket) => bucket?.entityType === STORAGE_USAGE_ENTITY_TYPES.BUCKET_ENTRY
    ? bucket
    : buildStorageBucketUsageEntry(bucket));
  const expectedBucketCount = bucketCount == null ? normalizedBuckets.length : toNonNegativeNumber(bucketCount, 0);
  const normalizedTotalBytes = toNonNegativeNumber(totalBytes, 0);
  const normalizedObjectCount = toNonNegativeNumber(objectCount, 0);
  const bucketBytes = sumBuckets(normalizedBuckets, 'totalBytes');
  const bucketObjects = sumBuckets(normalizedBuckets, 'objectCount');

  if (bucketBytes !== normalizedTotalBytes || bucketObjects !== normalizedObjectCount || expectedBucketCount !== normalizedBuckets.length) {
    const error = new Error('Storage workspace usage breakdown is additively inconsistent.');
    error.code = 'USAGE_BREAKDOWN_INCONSISTENT';
    error.normalizedCode = STORAGE_NORMALIZED_ERROR_CODES.STORAGE_INVALID_REQUEST;
    error.details = {
      expected: {
        totalBytes: normalizedTotalBytes,
        objectCount: normalizedObjectCount,
        bucketCount: expectedBucketCount
      },
      actual: {
        totalBytes: bucketBytes,
        objectCount: bucketObjects,
        bucketCount: normalizedBuckets.length
      }
    };
    throw error;
  }

  return deepFreeze({
    entityType: STORAGE_USAGE_ENTITY_TYPES.WORKSPACE_ENTRY,
    workspaceId,
    tenantId,
    totalBytes: normalizedTotalBytes,
    objectCount: normalizedObjectCount,
    bucketCount: expectedBucketCount,
    buckets: normalizedBuckets
  });
}

export function buildStorageUsageSnapshot({
  scopeType,
  scopeId = null,
  tenantId = null,
  dimensions = [],
  breakdown = [],
  collectionMethod,
  collectionStatus,
  snapshotAt = new Date().toISOString(),
  cacheSnapshotAt = null,
  status = null
} = {}) {
  const normalizedScopeType = normalizeScopeType(scopeType);
  const normalizedCollectionMethod = normalizeCollectionMethod(collectionMethod);
  const normalizedCollectionStatus = normalizeCollectionStatus(collectionStatus);
  let normalizedBreakdown = [...(breakdown ?? [])];

  if (normalizedCollectionStatus === STORAGE_USAGE_COLLECTION_STATUSES.PROVIDER_UNAVAILABLE && cacheSnapshotAt == null) {
    normalizedBreakdown = [];
  }

  const dimensionEntries = Object.values(STORAGE_QUOTA_DIMENSIONS).map((dimension) => {
    const existing = (dimensions ?? []).find((entry) => entry?.dimension === dimension);
    return existing ?? buildStorageUsageDimensionStatus({ dimension, used: 0, limit: null });
  });

  const dimensionsRecord = Object.fromEntries(dimensionEntries.map((entry) => [DIMENSION_PROPERTY_BY_NAME[entry.dimension], entry]));
  const snapshot = {
    entityType: STORAGE_USAGE_ENTITY_TYPES.SNAPSHOT,
    snapshotId: buildSnapshotId({
      scopeType: normalizedScopeType,
      scopeId,
      tenantId,
      snapshotAt,
      collectionMethod: normalizedCollectionMethod,
      collectionStatus: normalizedCollectionStatus
    }),
    scopeType: normalizedScopeType,
    scopeId,
    tenantId,
    dimensions: dimensionsRecord,
    breakdown: normalizedBreakdown,
    collectionMethod: normalizedCollectionMethod,
    collectionStatus: normalizedCollectionStatus,
    snapshotAt,
    cacheSnapshotAt,
    ...(status ? { status } : {})
  };

  if (normalizedScopeType === STORAGE_QUOTA_SCOPE_TYPES.WORKSPACE) {
    snapshot.buckets = normalizedBreakdown;
  }
  if (normalizedScopeType === STORAGE_QUOTA_SCOPE_TYPES.TENANT) {
    snapshot.workspaces = normalizedBreakdown;
  }

  return deepFreeze(snapshot);
}

export function buildStorageUsageThresholdBreach({
  dimension,
  scopeType,
  scopeId,
  tenantId = null,
  utilizationPercent,
  severity,
  thresholdPercent,
  used,
  limit
} = {}) {
  return deepFreeze({
    entityType: STORAGE_USAGE_ENTITY_TYPES.THRESHOLD_BREACH,
    dimension: normalizeDimension(dimension),
    scopeType: normalizeScopeType(scopeType),
    scopeId,
    tenantId,
    utilizationPercent: toFiniteNumber(utilizationPercent, 0),
    severity: normalizeSeverity(severity),
    thresholdPercent: toFiniteNumber(thresholdPercent, 0),
    used: toNonNegativeNumber(used, 0),
    limit: toNonNegativeNumber(limit, 0)
  });
}

export function detectStorageUsageThresholdBreaches({
  snapshot,
  thresholds = STORAGE_USAGE_THRESHOLD_DEFAULTS
} = {}) {
  const resolvedThresholds = {
    warning: toFiniteNumber(thresholds?.warning, STORAGE_USAGE_THRESHOLD_DEFAULTS.warning),
    critical: toFiniteNumber(thresholds?.critical, STORAGE_USAGE_THRESHOLD_DEFAULTS.critical)
  };

  return Object.values(STORAGE_QUOTA_DIMENSIONS).flatMap((dimension) => {
    const status = getDimensionRecord(snapshot, dimension);
    if (!status || status.limit == null || status.utilizationPercent == null) {
      return [];
    }

    if (status.utilizationPercent > 100) {
      return [buildStorageUsageThresholdBreach({
        dimension,
        scopeType: snapshot.scopeType,
        scopeId: snapshot.scopeId,
        tenantId: snapshot.tenantId,
        utilizationPercent: status.utilizationPercent,
        severity: STORAGE_USAGE_THRESHOLD_SEVERITIES.CRITICAL,
        thresholdPercent: resolvedThresholds.critical,
        used: status.used,
        limit: status.limit
      })];
    }

    if (status.utilizationPercent >= resolvedThresholds.critical) {
      return [buildStorageUsageThresholdBreach({
        dimension,
        scopeType: snapshot.scopeType,
        scopeId: snapshot.scopeId,
        tenantId: snapshot.tenantId,
        utilizationPercent: status.utilizationPercent,
        severity: STORAGE_USAGE_THRESHOLD_SEVERITIES.CRITICAL,
        thresholdPercent: resolvedThresholds.critical,
        used: status.used,
        limit: status.limit
      })];
    }

    if (status.utilizationPercent >= resolvedThresholds.warning) {
      return [buildStorageUsageThresholdBreach({
        dimension,
        scopeType: snapshot.scopeType,
        scopeId: snapshot.scopeId,
        tenantId: snapshot.tenantId,
        utilizationPercent: status.utilizationPercent,
        severity: STORAGE_USAGE_THRESHOLD_SEVERITIES.WARNING,
        thresholdPercent: resolvedThresholds.warning,
        used: status.used,
        limit: status.limit
      })];
    }

    return [];
  });
}

export function rankBucketsByUsage({
  buckets = [],
  sortDimension = STORAGE_QUOTA_DIMENSIONS.TOTAL_BYTES,
  topN = null
} = {}) {
  const normalizedSortDimension = [STORAGE_QUOTA_DIMENSIONS.TOTAL_BYTES, STORAGE_QUOTA_DIMENSIONS.OBJECT_COUNT].includes(sortDimension)
    ? sortDimension
    : STORAGE_QUOTA_DIMENSIONS.TOTAL_BYTES;
  const limit = topN == null ? null : Math.max(Math.trunc(toFiniteNumber(topN, buckets.length)), 0);

  return [...(buckets ?? [])]
    .sort((left, right) => getDimensionValue(right, normalizedSortDimension) - getDimensionValue(left, normalizedSortDimension))
    .slice(0, limit ?? undefined)
    .map((bucket, index) => deepFreeze({ ...bucket, rank: index + 1 }));
}

export function buildStorageUsageAuditEvent({
  actorPrincipal = null,
  scopeType,
  scopeId,
  tenantId = null,
  timestamp = new Date().toISOString()
} = {}) {
  const event = {
    entityType: STORAGE_USAGE_ENTITY_TYPES.AUDIT_EVENT,
    eventType: 'storage.usage.queried',
    actorPrincipal,
    scopeType: normalizeScopeType(scopeType),
    scopeId,
    tenantId,
    timestamp
  };

  return deepFreeze(event);
}

export function buildStorageCrossTenantUsageSummary({
  tenantSnapshots = [],
  sortDimension = STORAGE_QUOTA_DIMENSIONS.TOTAL_BYTES,
  topN = null,
  generatedAt = new Date().toISOString()
} = {}) {
  const normalizedSortDimension = [STORAGE_QUOTA_DIMENSIONS.TOTAL_BYTES, STORAGE_QUOTA_DIMENSIONS.OBJECT_COUNT, STORAGE_QUOTA_DIMENSIONS.BUCKET_COUNT, STORAGE_QUOTA_DIMENSIONS.OBJECT_SIZE_BYTES].includes(sortDimension)
    ? sortDimension
    : STORAGE_QUOTA_DIMENSIONS.TOTAL_BYTES;

  const tenants = [...(tenantSnapshots ?? [])]
    .map((snapshot) => ({
      tenantId: snapshot.tenantId,
      scopeId: snapshot.scopeId,
      totalBytes: getDimensionRecord(snapshot, STORAGE_QUOTA_DIMENSIONS.TOTAL_BYTES)?.used ?? 0,
      objectCount: getDimensionRecord(snapshot, STORAGE_QUOTA_DIMENSIONS.OBJECT_COUNT)?.used ?? 0,
      bucketCount: getDimensionRecord(snapshot, STORAGE_QUOTA_DIMENSIONS.BUCKET_COUNT)?.used ?? 0,
      largestObjectSizeBytes: getDimensionRecord(snapshot, STORAGE_QUOTA_DIMENSIONS.OBJECT_SIZE_BYTES)?.used ?? 0,
      quotaLimits: buildQuotaLimitMap(snapshot),
      utilizationPercents: buildUtilizationMap(snapshot),
      status: snapshot.status ?? snapshot.collectionStatus,
      snapshot
    }))
    .sort((left, right) => {
      const rightValue = normalizedSortDimension === STORAGE_QUOTA_DIMENSIONS.OBJECT_COUNT
        ? right.objectCount
        : normalizedSortDimension === STORAGE_QUOTA_DIMENSIONS.BUCKET_COUNT
          ? right.bucketCount
          : normalizedSortDimension === STORAGE_QUOTA_DIMENSIONS.OBJECT_SIZE_BYTES
            ? right.largestObjectSizeBytes
            : right.totalBytes;
      const leftValue = normalizedSortDimension === STORAGE_QUOTA_DIMENSIONS.OBJECT_COUNT
        ? left.objectCount
        : normalizedSortDimension === STORAGE_QUOTA_DIMENSIONS.BUCKET_COUNT
          ? left.bucketCount
          : normalizedSortDimension === STORAGE_QUOTA_DIMENSIONS.OBJECT_SIZE_BYTES
            ? left.largestObjectSizeBytes
            : left.totalBytes;
      return rightValue - leftValue;
    });

  const normalizedTopN = topN == null ? null : Math.max(Math.trunc(toFiniteNumber(topN, tenants.length)), 0);

  return deepFreeze({
    entityType: STORAGE_USAGE_ENTITY_TYPES.CROSS_TENANT_SUMMARY,
    tenants: tenants.slice(0, normalizedTopN ?? undefined),
    sortDimension: normalizedSortDimension,
    topN: normalizedTopN,
    generatedAt
  });
}
