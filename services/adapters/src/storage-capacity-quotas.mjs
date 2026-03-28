import { mapAdapterQuotaDecisionToEnforcementDecision } from '../../../apps/control-plane/src/observability-admin.mjs';
import { STORAGE_NORMALIZED_ERROR_CODES } from './storage-error-taxonomy.mjs';

const DEFAULT_NOW = '2026-03-28T00:00:00Z';
const DEFAULT_SOURCE = 'explicit_input';

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

function sanitizeAuditString(value) {
  if (typeof value !== 'string') {
    return value ?? null;
  }

  return value
    .replace(/https?:\/\/\S+/gi, '[redacted-url]')
    .replace(/secret:\/\/\S+/gi, '[redacted-secret-ref]')
    .trim();
}

function toNumberOrNull(value) {
  if (value == null || value === '') {
    return null;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  return numeric;
}

function toNonNegativeNumber(value, fallback = 0) {
  const numeric = toNumberOrNull(value);
  return numeric == null ? fallback : Math.max(numeric, 0);
}

function normalizeScope(scope) {
  if (scope === STORAGE_QUOTA_SCOPE_TYPES.WORKSPACE) {
    return STORAGE_QUOTA_SCOPE_TYPES.WORKSPACE;
  }
  return STORAGE_QUOTA_SCOPE_TYPES.TENANT;
}

function normalizeAction(action) {
  return Object.values(STORAGE_QUOTA_OPERATION_TYPES).includes(action)
    ? action
    : STORAGE_QUOTA_OPERATION_TYPES.QUOTA_CHECK;
}

function normalizeSource(source, fallback = DEFAULT_SOURCE) {
  return Object.values(STORAGE_QUOTA_SOURCES).includes(source) ? source : fallback;
}

function normalizeDimensionName(name) {
  return Object.values(STORAGE_QUOTA_DIMENSIONS).includes(name)
    ? name
    : STORAGE_QUOTA_DIMENSIONS.TOTAL_BYTES;
}

function normalizeUsageValue(usage = {}, aliases = [], fallback = 0) {
  for (const alias of aliases) {
    if (usage?.[alias] != null) {
      return toNonNegativeNumber(usage[alias], fallback);
    }
  }

  return fallback;
}

function normalizeLimitValue(limits = {}, aliases = []) {
  for (const alias of aliases) {
    const numeric = toNumberOrNull(limits?.[alias]);
    if (numeric != null) {
      return Math.max(numeric, 0);
    }
  }

  return null;
}

function resolveProviderObjectSizeLimit(providerProfile) {
  const capability = (providerProfile?.capabilityDetails ?? []).find((entry) => entry.capabilityId === 'object.put');
  const constraint = (capability?.constraints ?? []).find((entry) => entry.key === 'maxObjectSizeBytes');
  const numeric = toNumberOrNull(constraint?.value);
  return numeric == null ? null : Math.max(numeric, 0);
}

function minDefined(...values) {
  const filtered = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  return filtered.length ? Math.min(...filtered) : null;
}

function resolveMetricKey(scope, dimension) {
  if (scope === STORAGE_QUOTA_SCOPE_TYPES.TENANT) {
    if (dimension === STORAGE_QUOTA_DIMENSIONS.TOTAL_BYTES) return 'tenant.storage.bytes.max';
    if (dimension === STORAGE_QUOTA_DIMENSIONS.BUCKET_COUNT) return 'tenant.storage.buckets.max';
    if (dimension === STORAGE_QUOTA_DIMENSIONS.OBJECT_COUNT) return 'tenant.storage.objects.max';
    if (dimension === STORAGE_QUOTA_DIMENSIONS.OBJECT_SIZE_BYTES) return 'tenant.storage.object_size_bytes.max';
  }

  if (scope === STORAGE_QUOTA_SCOPE_TYPES.WORKSPACE) {
    if (dimension === STORAGE_QUOTA_DIMENSIONS.TOTAL_BYTES) return 'workspace.storage.bytes.max';
    if (dimension === STORAGE_QUOTA_DIMENSIONS.BUCKET_COUNT) return 'workspace.storage.buckets.max';
    if (dimension === STORAGE_QUOTA_DIMENSIONS.OBJECT_COUNT) return 'workspace.storage.objects.max';
    if (dimension === STORAGE_QUOTA_DIMENSIONS.OBJECT_SIZE_BYTES) return 'workspace.storage.object_size_bytes.max';
  }

  return null;
}

function buildReasonCodeForDimension(dimension) {
  if (dimension === STORAGE_QUOTA_DIMENSIONS.BUCKET_COUNT) {
    return STORAGE_QUOTA_GUARDRAIL_ERROR_CODES.BUCKET_LIMIT_EXCEEDED.code;
  }
  if (dimension === STORAGE_QUOTA_DIMENSIONS.OBJECT_COUNT) {
    return STORAGE_QUOTA_GUARDRAIL_ERROR_CODES.OBJECT_LIMIT_EXCEEDED.code;
  }
  if (dimension === STORAGE_QUOTA_DIMENSIONS.OBJECT_SIZE_BYTES) {
    return STORAGE_QUOTA_GUARDRAIL_ERROR_CODES.OBJECT_SIZE_LIMIT_EXCEEDED.code;
  }
  return STORAGE_QUOTA_GUARDRAIL_ERROR_CODES.CAPACITY_LIMIT_EXCEEDED.code;
}

function getErrorDefinition(reasonCode) {
  return STORAGE_QUOTA_GUARDRAIL_ERROR_CODES[reasonCode] ?? STORAGE_QUOTA_GUARDRAIL_ERROR_CODES.CAPACITY_LIMIT_EXCEEDED;
}

function dimensionPropertyName(dimension) {
  if (dimension === STORAGE_QUOTA_DIMENSIONS.TOTAL_BYTES) return 'totalBytes';
  if (dimension === STORAGE_QUOTA_DIMENSIONS.BUCKET_COUNT) return 'bucketCount';
  if (dimension === STORAGE_QUOTA_DIMENSIONS.OBJECT_COUNT) return 'objectCount';
  return 'objectSizeBytes';
}

function normalizeDelta(delta = {}) {
  return {
    total_bytes: Number(delta.total_bytes ?? delta.totalBytes ?? delta.byteDelta ?? delta.bytes ?? 0),
    bucket_count: Number(delta.bucket_count ?? delta.bucketCount ?? delta.buckets ?? 0),
    object_count: Number(delta.object_count ?? delta.objectCount ?? delta.objects ?? 0),
    object_size_bytes: Number(delta.object_size_bytes ?? delta.objectSizeBytes ?? delta.requestedObjectSizeBytes ?? 0)
  };
}

function buildScopeInput({
  scope,
  scopeId,
  usage = {},
  limits = {},
  sources = {},
  providerObjectSizeLimit = null,
  defaultSource = DEFAULT_SOURCE
}) {
  const normalizedScope = normalizeScope(scope);
  const resolvedSources = {
    total_bytes: normalizeSource(sources.total_bytes, defaultSource),
    bucket_count: normalizeSource(sources.bucket_count, defaultSource),
    object_count: normalizeSource(sources.object_count, defaultSource),
    object_size_bytes: normalizeSource(sources.object_size_bytes, defaultSource)
  };

  const objectSizeLimit = minDefined(
    normalizeLimitValue(limits, ['object_size_bytes', 'objectSizeBytes', 'maxObjectSizeBytes']),
    providerObjectSizeLimit
  );

  if (providerObjectSizeLimit != null && objectSizeLimit === providerObjectSizeLimit && resolvedSources.object_size_bytes === DEFAULT_SOURCE) {
    resolvedSources.object_size_bytes = STORAGE_QUOTA_SOURCES.PROVIDER_CONSTRAINT;
  }

  return {
    scope: normalizedScope,
    scopeId: scopeId ?? null,
    totalBytes: {
      used: normalizeUsageValue(usage, ['total_bytes', 'totalBytes', 'bytesUsed', 'storageBytesUsed']),
      limit: normalizeLimitValue(limits, ['total_bytes', 'totalBytes', 'storageCapacityBytes', 'maxBytes']),
      source: resolvedSources.total_bytes,
      metricKey: resolveMetricKey(normalizedScope, STORAGE_QUOTA_DIMENSIONS.TOTAL_BYTES),
      unit: 'bytes'
    },
    bucketCount: {
      used: normalizeUsageValue(usage, ['bucket_count', 'bucketCount', 'currentBucketCount', 'bucketsUsed']),
      limit: normalizeLimitValue(limits, ['bucket_count', 'bucketCount', 'maxBuckets']),
      source: resolvedSources.bucket_count,
      metricKey: resolveMetricKey(normalizedScope, STORAGE_QUOTA_DIMENSIONS.BUCKET_COUNT),
      unit: 'count'
    },
    objectCount: {
      used: normalizeUsageValue(usage, ['object_count', 'objectCount', 'currentObjectCount', 'objectsUsed']),
      limit: normalizeLimitValue(limits, ['object_count', 'objectCount', 'maxObjects']),
      source: resolvedSources.object_count,
      metricKey: resolveMetricKey(normalizedScope, STORAGE_QUOTA_DIMENSIONS.OBJECT_COUNT),
      unit: 'count'
    },
    objectSizeBytes: {
      used: normalizeUsageValue(usage, ['object_size_bytes', 'objectSizeBytes', 'largestObjectSizeBytes', 'maxObservedObjectSizeBytes']),
      limit: objectSizeLimit,
      source: resolvedSources.object_size_bytes,
      metricKey: resolveMetricKey(normalizedScope, STORAGE_QUOTA_DIMENSIONS.OBJECT_SIZE_BYTES),
      unit: 'bytes'
    }
  };
}

export const STORAGE_QUOTA_DIMENSIONS = deepFreeze({
  TOTAL_BYTES: 'total_bytes',
  BUCKET_COUNT: 'bucket_count',
  OBJECT_COUNT: 'object_count',
  OBJECT_SIZE_BYTES: 'object_size_bytes'
});

export const STORAGE_QUOTA_SCOPE_TYPES = deepFreeze({
  TENANT: 'tenant',
  WORKSPACE: 'workspace'
});

export const STORAGE_QUOTA_SOURCES = deepFreeze({
  TENANT_STORAGE_CONTEXT: 'tenant_storage_context',
  WORKSPACE_OVERRIDE: 'workspace_override',
  EXPLICIT_INPUT: 'explicit_input',
  PROVIDER_CONSTRAINT: 'provider_constraint'
});

export const STORAGE_QUOTA_OPERATION_TYPES = deepFreeze({
  BUCKET_CREATE: 'bucket_create',
  OBJECT_PUT: 'object_put',
  MULTIPART_COMPLETE: 'multipart_complete',
  OBJECT_DELETE: 'object_delete',
  OBJECT_OVERWRITE: 'object_overwrite',
  QUOTA_CHECK: 'quota_check'
});

export const STORAGE_QUOTA_GUARDRAIL_ERROR_CODES = deepFreeze({
  CAPACITY_LIMIT_EXCEEDED: {
    code: 'CAPACITY_LIMIT_EXCEEDED',
    normalizedCode: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_QUOTA_EXCEEDED,
    httpStatus: 409,
    retryability: 'not_retryable',
    fallbackHint: 'Free storage capacity or increase the assigned storage quota before retrying.'
  },
  BUCKET_LIMIT_EXCEEDED: {
    code: 'BUCKET_LIMIT_EXCEEDED',
    normalizedCode: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_QUOTA_EXCEEDED,
    httpStatus: 409,
    retryability: 'not_retryable',
    fallbackHint: 'Delete an unused bucket or raise the allowed bucket count before retrying.'
  },
  OBJECT_LIMIT_EXCEEDED: {
    code: 'OBJECT_LIMIT_EXCEEDED',
    normalizedCode: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_QUOTA_EXCEEDED,
    httpStatus: 409,
    retryability: 'not_retryable',
    fallbackHint: 'Delete unneeded objects or increase the allowed object count before retrying.'
  },
  OBJECT_SIZE_LIMIT_EXCEEDED: {
    code: 'OBJECT_SIZE_LIMIT_EXCEEDED',
    normalizedCode: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_OBJECT_TOO_LARGE,
    httpStatus: 413,
    retryability: 'not_retryable',
    fallbackHint: 'Upload a smaller object or increase the configured max-object-size limit before retrying.'
  },
  USAGE_SNAPSHOT_INVALID: {
    code: 'USAGE_SNAPSHOT_INVALID',
    normalizedCode: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_INVALID_REQUEST,
    httpStatus: 400,
    retryability: 'not_retryable',
    fallbackHint: 'Refresh the usage snapshot and provide numeric quota inputs before retrying.'
  }
});

export function buildStorageQuotaDimensionStatus({
  name,
  used = 0,
  limit = null,
  metricKey = null,
  unit = 'count',
  source = DEFAULT_SOURCE
} = {}) {
  const normalizedName = normalizeDimensionName(name);
  const normalizedUsed = toNonNegativeNumber(used, 0);
  const normalizedLimit = limit == null ? null : Math.max(toNonNegativeNumber(limit, 0), 0);

  return deepFreeze({
    name: normalizedName,
    used: normalizedUsed,
    limit: normalizedLimit,
    remaining: normalizedLimit == null ? null : Math.max(normalizedLimit - normalizedUsed, 0),
    blocked: normalizedLimit == null ? false : normalizedUsed >= normalizedLimit,
    ...(metricKey ? { metricKey } : {}),
    ...(unit ? { unit } : {}),
    source: normalizeSource(source)
  });
}

export function buildStorageQuotaScopeStatus({
  scope,
  scopeId = null,
  source = DEFAULT_SOURCE,
  totalBytes = {},
  bucketCount = {},
  objectCount = {},
  objectSizeBytes = {}
} = {}) {
  const normalizedScope = normalizeScope(scope);
  const normalizedSource = normalizeSource(source);

  return deepFreeze({
    scope: normalizedScope,
    scopeId,
    source: normalizedSource,
    totalBytes: buildStorageQuotaDimensionStatus({
      name: STORAGE_QUOTA_DIMENSIONS.TOTAL_BYTES,
      source: totalBytes.source ?? normalizedSource,
      ...totalBytes
    }),
    bucketCount: buildStorageQuotaDimensionStatus({
      name: STORAGE_QUOTA_DIMENSIONS.BUCKET_COUNT,
      source: bucketCount.source ?? normalizedSource,
      ...bucketCount
    }),
    objectCount: buildStorageQuotaDimensionStatus({
      name: STORAGE_QUOTA_DIMENSIONS.OBJECT_COUNT,
      source: objectCount.source ?? normalizedSource,
      ...objectCount
    }),
    objectSizeBytes: buildStorageQuotaDimensionStatus({
      name: STORAGE_QUOTA_DIMENSIONS.OBJECT_SIZE_BYTES,
      source: objectSizeBytes.source ?? normalizedSource,
      ...objectSizeBytes
    })
  });
}

export function buildStorageQuotaProfile({
  tenantStorageContext = null,
  workspaceId = null,
  tenantUsage = {},
  workspaceUsage = {},
  tenantLimits = {},
  workspaceLimits = {},
  providerProfile = null,
  builtAt = DEFAULT_NOW
} = {}) {
  const resolvedProviderProfile = providerProfile ?? (
    tenantStorageContext?.providerCapabilities
      ? {
          providerType: tenantStorageContext?.providerType,
          capabilityDetails: tenantStorageContext?.providerCapabilities?.details ?? []
        }
      : null
  );
  const providerObjectSizeLimit = resolveProviderObjectSizeLimit(resolvedProviderProfile);
  const tenantId = tenantStorageContext?.tenantId ?? tenantLimits.tenantId ?? null;
  const resolvedWorkspaceId = workspaceId ?? workspaceLimits.workspaceId ?? workspaceUsage.workspaceId ?? null;
  const quotaAssignment = tenantStorageContext?.quotaAssignment ?? {};

  const tenantScopeInput = buildScopeInput({
    scope: STORAGE_QUOTA_SCOPE_TYPES.TENANT,
    scopeId: tenantId,
    usage: tenantUsage,
    limits: {
      storageCapacityBytes: quotaAssignment.storageCapacityBytes,
      maxBuckets: quotaAssignment.maxBuckets,
      ...tenantLimits
    },
    sources: {
      total_bytes: tenantLimits.total_bytes != null || tenantLimits.totalBytes != null || tenantLimits.storageCapacityBytes != null
        ? STORAGE_QUOTA_SOURCES.EXPLICIT_INPUT
        : quotaAssignment.storageCapacityBytes != null
          ? STORAGE_QUOTA_SOURCES.TENANT_STORAGE_CONTEXT
          : STORAGE_QUOTA_SOURCES.EXPLICIT_INPUT,
      bucket_count: tenantLimits.bucket_count != null || tenantLimits.bucketCount != null || tenantLimits.maxBuckets != null
        ? STORAGE_QUOTA_SOURCES.EXPLICIT_INPUT
        : quotaAssignment.maxBuckets != null
          ? STORAGE_QUOTA_SOURCES.TENANT_STORAGE_CONTEXT
          : STORAGE_QUOTA_SOURCES.EXPLICIT_INPUT,
      object_count: STORAGE_QUOTA_SOURCES.EXPLICIT_INPUT,
      object_size_bytes: STORAGE_QUOTA_SOURCES.EXPLICIT_INPUT
    },
    providerObjectSizeLimit,
    defaultSource: quotaAssignment.storageCapacityBytes != null || quotaAssignment.maxBuckets != null
      ? STORAGE_QUOTA_SOURCES.TENANT_STORAGE_CONTEXT
      : STORAGE_QUOTA_SOURCES.EXPLICIT_INPUT
  });

  const workspaceScopeInput = buildScopeInput({
    scope: STORAGE_QUOTA_SCOPE_TYPES.WORKSPACE,
    scopeId: resolvedWorkspaceId,
    usage: workspaceUsage,
    limits: workspaceLimits,
    sources: {
      total_bytes: workspaceLimits.total_bytes != null || workspaceLimits.totalBytes != null || workspaceLimits.storageCapacityBytes != null
        ? STORAGE_QUOTA_SOURCES.WORKSPACE_OVERRIDE
        : STORAGE_QUOTA_SOURCES.EXPLICIT_INPUT,
      bucket_count: workspaceLimits.bucket_count != null || workspaceLimits.bucketCount != null || workspaceLimits.maxBuckets != null
        ? STORAGE_QUOTA_SOURCES.WORKSPACE_OVERRIDE
        : STORAGE_QUOTA_SOURCES.EXPLICIT_INPUT,
      object_count: workspaceLimits.object_count != null || workspaceLimits.objectCount != null || workspaceLimits.maxObjects != null
        ? STORAGE_QUOTA_SOURCES.WORKSPACE_OVERRIDE
        : STORAGE_QUOTA_SOURCES.EXPLICIT_INPUT,
      object_size_bytes: workspaceLimits.object_size_bytes != null || workspaceLimits.objectSizeBytes != null || workspaceLimits.maxObjectSizeBytes != null
        ? STORAGE_QUOTA_SOURCES.WORKSPACE_OVERRIDE
        : STORAGE_QUOTA_SOURCES.EXPLICIT_INPUT
    },
    providerObjectSizeLimit,
    defaultSource: STORAGE_QUOTA_SOURCES.WORKSPACE_OVERRIDE
  });

  const scopes = [];

  const tenantHasData = tenantScopeInput.scopeId || Object.values(tenantScopeInput).some((value) => value && typeof value === 'object' && 'limit' in value && value.limit != null);
  const workspaceHasData = workspaceScopeInput.scopeId || Object.values(workspaceScopeInput).some((value) => value && typeof value === 'object' && 'limit' in value && value.limit != null);

  if (tenantHasData) {
    scopes.push(buildStorageQuotaScopeStatus({
      scope: tenantScopeInput.scope,
      scopeId: tenantScopeInput.scopeId,
      source: STORAGE_QUOTA_SOURCES.TENANT_STORAGE_CONTEXT,
      totalBytes: tenantScopeInput.totalBytes,
      bucketCount: tenantScopeInput.bucketCount,
      objectCount: tenantScopeInput.objectCount,
      objectSizeBytes: tenantScopeInput.objectSizeBytes
    }));
  }

  if (workspaceHasData) {
    scopes.push(buildStorageQuotaScopeStatus({
      scope: workspaceScopeInput.scope,
      scopeId: workspaceScopeInput.scopeId,
      source: STORAGE_QUOTA_SOURCES.WORKSPACE_OVERRIDE,
      totalBytes: workspaceScopeInput.totalBytes,
      bucketCount: workspaceScopeInput.bucketCount,
      objectCount: workspaceScopeInput.objectCount,
      objectSizeBytes: workspaceScopeInput.objectSizeBytes
    }));
  }

  return deepFreeze({
    tenantId,
    workspaceId: resolvedWorkspaceId,
    providerType: resolvedProviderProfile?.providerType ?? tenantStorageContext?.providerType ?? null,
    actionDefaults: deepFreeze({
      bucketDelta: 1,
      objectDelta: 1
    }),
    scopes,
    builtAt
  });
}

export function buildStorageQuotaViolation({
  scope,
  scopeId = null,
  dimension,
  used = 0,
  delta = 0,
  nextUsed = 0,
  limit = 0,
  metricKey = null,
  source = DEFAULT_SOURCE,
  reasonCode = null
} = {}) {
  const normalizedDimension = normalizeDimensionName(dimension);
  const resolvedReasonCode = reasonCode ?? buildReasonCodeForDimension(normalizedDimension);
  const definition = getErrorDefinition(resolvedReasonCode);

  return deepFreeze({
    scope: normalizeScope(scope),
    scopeId,
    dimension: normalizedDimension,
    used: Number(used ?? 0),
    delta: Number(delta ?? 0),
    nextUsed: Number(nextUsed ?? 0),
    limit: Number(limit ?? 0),
    ...(metricKey ? { metricKey } : {}),
    reasonCode: definition.code,
    normalizedCode: definition.normalizedCode,
    httpStatus: definition.httpStatus,
    fallbackHint: definition.fallbackHint,
    source: normalizeSource(source),
    message: `Quota guardrail ${definition.code} blocked ${normalizeScope(scope)} ${normalizedDimension}: ${nextUsed} exceeds ${limit}.`
  });
}

export function validateStorageQuotaGuardrails({
  quotaProfile,
  action = STORAGE_QUOTA_OPERATION_TYPES.QUOTA_CHECK,
  delta = {},
  requestedObjectSizeBytes = null,
  evaluatedAt = DEFAULT_NOW
} = {}) {
  const profile = quotaProfile?.scopes ? quotaProfile : buildStorageQuotaProfile(quotaProfile ?? {});
  const normalizedDelta = normalizeDelta(delta);
  const sizeProbe = toNumberOrNull(requestedObjectSizeBytes) ?? normalizedDelta.object_size_bytes;
  const violations = [];

  for (const scope of profile.scopes) {
    for (const dimension of [
      STORAGE_QUOTA_DIMENSIONS.TOTAL_BYTES,
      STORAGE_QUOTA_DIMENSIONS.BUCKET_COUNT,
      STORAGE_QUOTA_DIMENSIONS.OBJECT_COUNT
    ]) {
      const status = scope[dimensionPropertyName(dimension)];
      if (status.limit == null) {
        continue;
      }

      const nextUsed = Number(status.used) + Number(normalizedDelta[dimension] ?? 0);
      if (nextUsed > status.limit) {
        violations.push(buildStorageQuotaViolation({
          scope: scope.scope,
          scopeId: scope.scopeId,
          dimension,
          used: status.used,
          delta: normalizedDelta[dimension] ?? 0,
          nextUsed,
          limit: status.limit,
          metricKey: status.metricKey,
          source: status.source
        }));
      }
    }

    const objectSizeStatus = scope.objectSizeBytes;
    if (objectSizeStatus.limit != null && sizeProbe != null && sizeProbe > objectSizeStatus.limit) {
      violations.push(buildStorageQuotaViolation({
        scope: scope.scope,
        scopeId: scope.scopeId,
        dimension: STORAGE_QUOTA_DIMENSIONS.OBJECT_SIZE_BYTES,
        used: objectSizeStatus.used,
        delta: sizeProbe,
        nextUsed: sizeProbe,
        limit: objectSizeStatus.limit,
        metricKey: objectSizeStatus.metricKey,
        source: objectSizeStatus.source,
        reasonCode: STORAGE_QUOTA_GUARDRAIL_ERROR_CODES.OBJECT_SIZE_LIMIT_EXCEEDED.code
      }));
    }
  }

  const effectiveViolation = violations[0] ?? null;
  const quotaDecision = effectiveViolation
    ? mapAdapterQuotaDecisionToEnforcementDecision({
        allowed: false,
        dimensionId: effectiveViolation.dimension === STORAGE_QUOTA_DIMENSIONS.BUCKET_COUNT ? 'storage_buckets' : 'storage_buckets',
        scopeType: effectiveViolation.scope,
        scopeId: effectiveViolation.scopeId,
        tenantId: profile.tenantId ?? null,
        workspaceId: profile.workspaceId ?? null,
        currentUsage: effectiveViolation.used,
        hardLimit: effectiveViolation.limit,
        blockingAction: normalizeAction(action),
        metricKey: effectiveViolation.metricKey,
        reasonCode: effectiveViolation.reasonCode,
        effectiveViolation,
        resourceKind: 'bucket',
        surfaceId: 'storage.bucket.create',
        evaluatedAt
      })
    : null;

  return deepFreeze({
    allowed: violations.length === 0,
    action: normalizeAction(action),
    tenantId: profile.tenantId ?? null,
    workspaceId: profile.workspaceId ?? null,
    violations,
    ...(effectiveViolation ? { effectiveViolation } : {}),
    ...(quotaDecision ? { quotaDecision } : {}),
    quotaProfile: profile,
    evaluatedAt
  });
}

export function previewStorageBucketQuotaAdmission({
  quotaProfile,
  bucketDelta = 1,
  requestedAt = DEFAULT_NOW
} = {}) {
  return validateStorageQuotaGuardrails({
    quotaProfile,
    action: STORAGE_QUOTA_OPERATION_TYPES.BUCKET_CREATE,
    delta: { bucket_count: Number(bucketDelta ?? 1) },
    evaluatedAt: requestedAt
  });
}

export function previewStorageObjectQuotaAdmission({
  quotaProfile,
  byteDelta = 0,
  objectDelta = 1,
  requestedObjectSizeBytes = null,
  action = STORAGE_QUOTA_OPERATION_TYPES.OBJECT_PUT,
  requestedAt = DEFAULT_NOW
} = {}) {
  const normalizedByteDelta = Number(byteDelta ?? 0);
  const resolvedObjectSize = requestedObjectSizeBytes ?? (normalizedByteDelta > 0 ? normalizedByteDelta : 0);

  return validateStorageQuotaGuardrails({
    quotaProfile,
    action,
    delta: {
      total_bytes: normalizedByteDelta,
      object_count: Number(objectDelta ?? 1),
      object_size_bytes: Number(resolvedObjectSize ?? 0)
    },
    requestedObjectSizeBytes: resolvedObjectSize,
    evaluatedAt: requestedAt
  });
}

export function buildStorageQuotaAuditEvent({
  decision,
  actorRef = null,
  bucketId = null,
  objectKey = null,
  occurredAt = DEFAULT_NOW,
  correlationId = null
} = {}) {
  const resolvedDecision = decision?.quotaProfile ? decision : validateStorageQuotaGuardrails({ quotaProfile: decision ?? {} });

  return deepFreeze({
    eventType: 'storage.quota.guardrail.evaluated',
    action: resolvedDecision.action,
    allowed: resolvedDecision.allowed,
    tenantId: resolvedDecision.tenantId ?? null,
    workspaceId: resolvedDecision.workspaceId ?? null,
    ...(bucketId ? { bucketId: sanitizeAuditString(bucketId) } : {}),
    ...(objectKey ? { objectKey: sanitizeAuditString(objectKey) } : {}),
    ...(actorRef ? { actorRef: sanitizeAuditString(actorRef) } : {}),
    ...(correlationId ? { correlationId: sanitizeAuditString(correlationId) } : {}),
    ...(resolvedDecision.effectiveViolation
      ? {
          effectiveViolation: {
            scope: resolvedDecision.effectiveViolation.scope,
            dimension: resolvedDecision.effectiveViolation.dimension,
            reasonCode: resolvedDecision.effectiveViolation.reasonCode,
            normalizedCode: resolvedDecision.effectiveViolation.normalizedCode
          }
        }
      : {}),
    violationCount: resolvedDecision.violations.length,
    occurredAt
  });
}
