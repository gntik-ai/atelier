import { createHash } from 'node:crypto';

import { assertObjectKey } from './storage-bucket-object-ops.mjs';
import { previewStorageObjectQuotaAdmission, STORAGE_QUOTA_DIMENSIONS } from './storage-capacity-quotas.mjs';
import { STORAGE_IMPORT_EXPORT_ERROR_CODES } from './storage-error-taxonomy.mjs';
import { isStorageReservedPrefix } from './storage-logical-organization.mjs';

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

function hashSeed(seed, length = 18) {
  return createHash('sha256').update(String(seed)).digest('hex').slice(0, length);
}

function toIso(value) {
  return new Date(value).toISOString();
}

function toNonNegativeInteger(value, fieldName = 'value') {
  const numeric = Number(value ?? 0);
  if (!Number.isInteger(numeric) || numeric < 0) {
    const error = new Error(`${fieldName} must be a non-negative integer.`);
    error.code = 'IMPORT_EXPORT_CONSISTENCY_ERROR';
    error.details = { fieldName, value };
    throw error;
  }

  return numeric;
}

function normalizePrincipal(principal = {}) {
  return deepFreeze({
    type: String(principal.type ?? principal.principalType ?? 'user').trim(),
    id: String(principal.id ?? principal.principalId ?? '').trim()
  });
}

function buildDeterministicId(prefix, seed) {
  return `${prefix}_${hashSeed(seed, 20)}`;
}

function normalizeBodyReference(bodyReference = {}, objectKey) {
  if (bodyReference?.type === 'presigned_url') {
    return deepFreeze({
      type: 'presigned_url',
      url: String(bodyReference.url ?? ''),
      expiresAt: toIso(bodyReference.expiresAt)
    });
  }

  if (bodyReference?.type === 'object_read') {
    return deepFreeze({
      type: 'object_read',
      bucketId: bodyReference.bucketId ?? null,
      workspaceId: bodyReference.workspaceId ?? null,
      tenantId: bodyReference.tenantId ?? null,
      objectKey: bodyReference.objectKey ?? objectKey
    });
  }

  const error = new Error('Unsupported bodyReference type.');
  error.code = STORAGE_IMPORT_EXPORT_ERROR_CODES.MANIFEST_VALIDATION_ERROR;
  throw error;
}

export const STORAGE_IMPORT_EXPORT_MANIFEST_VERSION = Object.freeze(1);

export const STORAGE_IMPORT_CONFLICT_POLICIES = Object.freeze({
  SKIP: 'skip',
  OVERWRITE: 'overwrite',
  FAIL: 'fail'
});

export const STORAGE_IMPORT_ENTRY_STATUSES = Object.freeze({
  IMPORTED: 'imported',
  SKIPPED: 'skipped',
  FAILED: 'failed'
});

export const STORAGE_IMPORT_EXPORT_OPERATION_DEFAULTS = deepFreeze({
  maxObjectsPerOperation: 5000,
  presignedUrlValiditySeconds: 3600
});

export { STORAGE_IMPORT_EXPORT_ERROR_CODES };

export function buildStorageExportManifestEntry({
  objectKey,
  sizeBytes = 0,
  contentType = 'application/octet-stream',
  contentEncoding = null,
  storageClass = 'standard',
  customMetadata = {},
  lastModifiedAt = '2026-03-28T00:00:00Z',
  bodyReference
} = {}) {
  try {
    assertObjectKey(objectKey);
  } catch {
    const error = new Error('Invalid object key.');
    error.code = 'INVALID_OBJECT_KEY';
    throw error;
  }

  return deepFreeze({
    entityType: 'storage_export_manifest_entry',
    objectKey,
    sizeBytes: toNonNegativeInteger(sizeBytes, 'sizeBytes'),
    contentType,
    contentEncoding,
    storageClass,
    customMetadata: { ...(customMetadata ?? {}) },
    lastModifiedAt: toIso(lastModifiedAt),
    bodyReference: normalizeBodyReference(bodyReference, objectKey)
  });
}

export function buildStorageExportManifest({
  sourceBucketId,
  sourceWorkspaceId,
  sourceTenantId,
  actingPrincipal,
  exportedAt = '2026-03-28T00:00:00Z',
  filterCriteria = { prefix: null, metadataFilter: null },
  entries = [],
  nonce = null
} = {}) {
  const normalizedEntries = entries.map((entry) => entry?.entityType === 'storage_export_manifest_entry'
    ? entry
    : buildStorageExportManifestEntry(entry));
  const totalBytes = normalizedEntries.reduce((sum, entry) => sum + toNonNegativeInteger(entry.sizeBytes, 'sizeBytes'), 0);
  const isoExportedAt = toIso(exportedAt);
  const resolvedNonce = nonce ?? hashSeed(`${sourceTenantId}:${sourceBucketId}:${isoExportedAt}:${normalizedEntries.length}`);

  return deepFreeze({
    entityType: 'storage_export_manifest',
    manifestId: buildDeterministicId('smf', `${sourceTenantId}:${sourceBucketId}:${isoExportedAt}:${resolvedNonce}`),
    formatVersion: STORAGE_IMPORT_EXPORT_MANIFEST_VERSION,
    sourceBucketId,
    sourceWorkspaceId,
    sourceTenantId,
    actingPrincipal: normalizePrincipal(actingPrincipal),
    exportedAt: isoExportedAt,
    filterCriteria: {
      prefix: filterCriteria?.prefix ?? null,
      metadataFilter: filterCriteria?.metadataFilter ?? null
    },
    totalObjects: normalizedEntries.length,
    totalBytes,
    entries: normalizedEntries
  });
}

export function buildStorageImportEntryOutcome({ objectKey, status, reason = null, sizeBytes = 0 } = {}) {
  if (!Object.values(STORAGE_IMPORT_ENTRY_STATUSES).includes(status)) {
    throw new Error('Unsupported import entry status.');
  }

  return deepFreeze({
    entityType: 'storage_import_entry_outcome',
    objectKey,
    status,
    reason,
    sizeBytes: toNonNegativeInteger(sizeBytes, 'sizeBytes')
  });
}

export function buildStorageImportResultSummary({
  targetBucketId,
  targetWorkspaceId,
  targetTenantId,
  actingPrincipal,
  importedAt = '2026-03-28T00:00:00Z',
  conflictPolicy,
  outcomes = [],
  nonce = null
} = {}) {
  if (!Object.values(STORAGE_IMPORT_CONFLICT_POLICIES).includes(conflictPolicy)) {
    throw new Error('Unsupported conflict policy.');
  }

  const normalizedOutcomes = outcomes.map((outcome) => outcome?.entityType === 'storage_import_entry_outcome'
    ? outcome
    : buildStorageImportEntryOutcome(outcome));
  const importedCount = normalizedOutcomes.filter((entry) => entry.status === STORAGE_IMPORT_ENTRY_STATUSES.IMPORTED).length;
  const skippedCount = normalizedOutcomes.filter((entry) => entry.status === STORAGE_IMPORT_ENTRY_STATUSES.SKIPPED).length;
  const failedCount = normalizedOutcomes.filter((entry) => entry.status === STORAGE_IMPORT_ENTRY_STATUSES.FAILED).length;
  const totalEntries = normalizedOutcomes.length;

  if (totalEntries !== importedCount + skippedCount + failedCount) {
    const error = new Error('Storage import summary is additively inconsistent.');
    error.code = 'IMPORT_EXPORT_CONSISTENCY_ERROR';
    throw error;
  }

  const totalBytesImported = normalizedOutcomes.reduce((sum, entry) => sum + (entry.status === STORAGE_IMPORT_ENTRY_STATUSES.IMPORTED ? toNonNegativeInteger(entry.sizeBytes, 'sizeBytes') : 0), 0);
  const isoImportedAt = toIso(importedAt);
  const resolvedNonce = nonce ?? hashSeed(`${targetTenantId}:${targetBucketId}:${isoImportedAt}:${conflictPolicy}:${totalEntries}`);

  return deepFreeze({
    entityType: 'storage_import_result_summary',
    importId: buildDeterministicId('sir', `${targetTenantId}:${targetBucketId}:${isoImportedAt}:${resolvedNonce}`),
    targetBucketId,
    targetWorkspaceId,
    targetTenantId,
    actingPrincipal: normalizePrincipal(actingPrincipal),
    importedAt: isoImportedAt,
    conflictPolicy,
    totalEntries,
    importedCount,
    skippedCount,
    failedCount,
    totalBytesImported,
    outcomes: normalizedOutcomes
  });
}

export function validateImportManifest({
  manifest,
  maxObjectsPerOperation = STORAGE_IMPORT_EXPORT_OPERATION_DEFAULTS.maxObjectsPerOperation
} = {}) {
  if (manifest?.formatVersion !== STORAGE_IMPORT_EXPORT_MANIFEST_VERSION) {
    return { valid: false, errors: [STORAGE_IMPORT_EXPORT_ERROR_CODES.MANIFEST_VERSION_UNSUPPORTED] };
  }

  if ((manifest?.entries?.length ?? 0) > maxObjectsPerOperation) {
    return { valid: false, errors: [STORAGE_IMPORT_EXPORT_ERROR_CODES.OPERATION_LIMIT_EXCEEDED] };
  }

  const seen = new Set();
  const duplicateKeys = [];
  for (const entry of manifest?.entries ?? []) {
    if (!entry?.objectKey) {
      return { valid: false, errors: [STORAGE_IMPORT_EXPORT_ERROR_CODES.MANIFEST_VALIDATION_ERROR] };
    }
    if (seen.has(entry.objectKey) && !duplicateKeys.includes(entry.objectKey)) {
      duplicateKeys.push(entry.objectKey);
    }
    seen.add(entry.objectKey);
  }

  if (duplicateKeys.length > 0) {
    return {
      valid: false,
      errors: [STORAGE_IMPORT_EXPORT_ERROR_CODES.MANIFEST_VALIDATION_ERROR],
      duplicateKeys
    };
  }

  return { valid: true, errors: [] };
}

export function validateImportManifestEntry({ entry, targetTenantId } = {}) {
  try {
    assertObjectKey(entry?.objectKey);
  } catch {
    return { valid: false, reason: 'INVALID_OBJECT_KEY' };
  }

  if (/(^|\/)\_platform\//.test(String(entry?.objectKey ?? ''))) {
    return { valid: false, reason: STORAGE_IMPORT_EXPORT_ERROR_CODES.OBJECT_PROTECTED };
  }

  if (entry?.bodyReference?.tenantId && targetTenantId && entry.bodyReference.tenantId !== targetTenantId) {
    return { valid: false, reason: STORAGE_IMPORT_EXPORT_ERROR_CODES.CROSS_TENANT_VIOLATION };
  }

  return { valid: true, reason: null };
}

export function previewImportQuotaAdmission({
  manifest,
  quotaProfile,
  currentUsageBytes = 0,
  currentUsageObjectCount = 0
} = {}) {
  const requestedBytes = (manifest?.entries ?? []).reduce((sum, entry) => sum + Number(entry?.sizeBytes ?? 0), 0);
  const requestedObjectCount = (manifest?.entries ?? []).length;
  const decision = previewStorageObjectQuotaAdmission({
    quotaProfile,
    byteDelta: requestedBytes,
    objectDelta: requestedObjectCount,
    requestedObjectSizeBytes: Math.max(...(manifest?.entries ?? []).map((entry) => Number(entry?.sizeBytes ?? 0)), 0)
  });

  const violations = (decision.violations ?? []).map((violation) => ({
    dimension: violation.dimension,
    requestedTotal: violation.dimension === STORAGE_QUOTA_DIMENSIONS.OBJECT_COUNT
      ? currentUsageObjectCount + requestedObjectCount
      : currentUsageBytes + requestedBytes,
    availableHeadroom: violation.remaining ?? violation.available ?? 0
  }));

  return {
    admitted: decision.allowed,
    requestedBytes,
    requestedObjectCount,
    violations
  };
}

export function checkImportExportOperationLimit({
  objectCount = 0,
  platformLimit = STORAGE_IMPORT_EXPORT_OPERATION_DEFAULTS.maxObjectsPerOperation,
  tenantLimitOverride = null
} = {}) {
  const appliedLimit = Number.isInteger(tenantLimitOverride) && tenantLimitOverride > 0
    ? tenantLimitOverride
    : platformLimit;

  return {
    allowed: Number(objectCount ?? 0) <= appliedLimit,
    appliedLimit
  };
}

export function buildStorageImportExportAuditEvent(input = {}) {
  for (const forbiddenField of ['entries', 'bodyReference', 'customMetadata']) {
    if (forbiddenField in input) {
      const error = new Error(`Audit event payload must not include ${forbiddenField}.`);
      error.code = 'IMPORT_EXPORT_AUDIT_GUARD_ERROR';
      throw error;
    }
  }

  const base = {
    entityType: 'storage_import_export_audit_event',
    operationType: input.operationType,
    actingPrincipal: normalizePrincipal(input.actingPrincipal),
    credentialId: input.credentialId ?? null,
    manifestId: input.manifestId,
    outcome: input.outcome,
    timestamp: toIso(input.timestamp ?? '2026-03-28T00:00:00Z')
  };

  if (input.operationType === 'export') {
    return deepFreeze({
      ...base,
      sourceBucketId: input.sourceBucketId,
      sourceWorkspaceId: input.sourceWorkspaceId,
      sourceTenantId: input.sourceTenantId,
      filterCriteria: input.filterCriteria ?? null,
      objectCount: Number(input.objectCount ?? 0),
      totalBytes: Number(input.totalBytes ?? 0)
    });
  }

  return deepFreeze({
    ...base,
    targetBucketId: input.targetBucketId,
    targetWorkspaceId: input.targetWorkspaceId,
    targetTenantId: input.targetTenantId,
    conflictPolicy: input.conflictPolicy ?? null,
    objectCount: Number(input.objectCount ?? input.importedCount ?? 0) + Number(input.skippedCount ?? 0) + Number(input.failedCount ?? 0),
    importedCount: Number(input.importedCount ?? 0),
    skippedCount: Number(input.skippedCount ?? 0),
    failedCount: Number(input.failedCount ?? 0),
    totalBytesImported: Number(input.totalBytesImported ?? 0)
  });
}
