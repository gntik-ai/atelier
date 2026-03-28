import { buildStorageObjectRecord } from './storage-bucket-object-ops.mjs';
import { isStorageReservedPrefix } from './storage-logical-organization.mjs';
import {
  STORAGE_ERROR_RETRYABILITY,
  STORAGE_NORMALIZED_ERROR_CODES,
  buildStorageErrorEnvelope
} from './storage-error-taxonomy.mjs';

const DEFAULT_NOW = '2026-03-28T00:00:00Z';
const DEFAULT_TTL_SECONDS = 3600;
const DEFAULT_PAGE_SIZE = 1;

export const MULTIPART_SESSION_STATES = Object.freeze({
  ACTIVE: 'active',
  STALE: 'stale',
  COMPLETING: 'completing',
  COMPLETED: 'completed',
  ABORTED: 'aborted'
});

export const MULTIPART_LIFECYCLE_TRANSITIONS = Object.freeze({
  INITIATE: 'initiate',
  PART_UPLOADED: 'part_uploaded',
  COMPLETE: 'complete',
  ABORT: 'abort',
  STALE_CLEANUP: 'stale_cleanup'
});

export const PRESIGNED_URL_OPERATIONS = Object.freeze({
  UPLOAD: 'upload',
  DOWNLOAD: 'download'
});

function freezeNested(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => freezeNested(item));
    return Object.freeze(value);
  }

  Object.values(value).forEach((item) => freezeNested(item));
  return Object.freeze(value);
}

function sanitizeString(value) {
  if (typeof value !== 'string') {
    return value;
  }

  return value
    .replace(/https?:\/\/\S+/gi, '[redacted-url]')
    .replace(/secret:\/\/\S+/gi, '[redacted-secret-ref]');
}

function sanitizeStringsDeep(value) {
  if (typeof value === 'string') {
    return sanitizeString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeStringsDeep(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitizeStringsDeep(item)])
    );
  }

  return value;
}

function asDate(value, fallback = DEFAULT_NOW) {
  if (value instanceof Date) {
    return value;
  }

  return new Date(value ?? fallback);
}

function toIso(value, fallback = DEFAULT_NOW) {
  return asDate(value, fallback).toISOString();
}

function assertNonEmptyString(value, fieldName) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${fieldName} is required.`);
  }

  return value.trim();
}

function assertPositiveInteger(value, fieldName) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }

  return value;
}

function assertNonNegativeNumber(value, fieldName) {
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative number.`);
  }

  return value;
}

function buildFrozenRecord(value) {
  return freezeNested(value);
}

function buildConstraintLookup(constraints = []) {
  return new Map((constraints ?? []).map((constraint) => [constraint.key, constraint]));
}

function getProviderCapabilityDetails(providerProfile, capabilityId) {
  const capabilityDetails = Array.isArray(providerProfile?.capabilityDetails)
    ? providerProfile.capabilityDetails
    : [];

  return capabilityDetails.find((entry) => entry.capabilityId === capabilityId) ?? buildFrozenRecord({
    capabilityId,
    required: false,
    state: 'unsatisfied',
    summary: `Capability ${capabilityId}.`,
    constraints: []
  });
}

function buildCodeDefinition(code, httpStatus, fallbackHint) {
  return buildFrozenRecord({
    code,
    httpStatus,
    retryability: STORAGE_ERROR_RETRYABILITY.NOT_RETRYABLE,
    fallbackHint
  });
}

export const MULTIPART_NORMALIZED_ERROR_CODES = buildFrozenRecord({
  CAPABILITY_NOT_AVAILABLE: buildCodeDefinition('CAPABILITY_NOT_AVAILABLE', 501, 'Use the non-capability-gated storage flow instead.'),
  MULTIPART_CONSTRAINT_EXCEEDED: buildCodeDefinition('MULTIPART_CONSTRAINT_EXCEEDED', 400, 'Reduce part count or adjust part sizing to match provider constraints.'),
  MULTIPART_SESSION_NOT_FOUND: buildCodeDefinition('MULTIPART_SESSION_NOT_FOUND', 404, 'Initiate a new multipart upload session and retry the workflow.'),
  MULTIPART_SESSION_EXPIRED: buildCodeDefinition('MULTIPART_SESSION_EXPIRED', 410, 'Initiate a new multipart upload session because the previous one expired.'),
  MULTIPART_INVALID_PART_ORDER: buildCodeDefinition('MULTIPART_INVALID_PART_ORDER', 400, 'Submit a complete ordered part list with unique sequential part numbers.'),
  PRESIGNED_TTL_EXCEEDED: buildCodeDefinition('PRESIGNED_TTL_EXCEEDED', 400, 'Reduce the requested presigned URL TTL to the platform maximum.')
});

function buildPaginationInfo(page = {}, size = DEFAULT_PAGE_SIZE) {
  return buildFrozenRecord({
    size,
    ...(page.after ? { after: page.after } : {}),
    ...(page.nextCursor ? { nextCursor: page.nextCursor } : {})
  });
}

function buildSessionId(now) {
  const timestamp = asDate(now).getTime();
  const entropy = Math.random().toString(36).slice(2, 10);
  return `mp_${timestamp}_${entropy}`;
}

function buildOpaqueReference(prefix, seed) {
  const encoded = Buffer.from(String(seed), 'utf8').toString('base64url').slice(0, 18);
  return `${prefix}_${encoded}`;
}

export function buildCapabilityNotAvailableError({ capabilityId, fallbackHint, correlationId = null } = {}) {
  const missingCapabilityId = assertNonEmptyString(capabilityId, 'capabilityId');
  const definition = MULTIPART_NORMALIZED_ERROR_CODES.CAPABILITY_NOT_AVAILABLE;
  const sanitizedFallbackHint = sanitizeString(assertNonEmptyString(fallbackHint, 'fallbackHint'));
  const envelope = buildStorageErrorEnvelope({
    normalizedCode: definition.code,
    publicMessage: `Capability ${missingCapabilityId} is not available for the active storage provider.`,
    observedAt: DEFAULT_NOW
  });

  return buildFrozenRecord(sanitizeStringsDeep({
    ...envelope.error,
    normalizedCode: definition.code,
    missingCapabilityId,
    fallbackHint: sanitizedFallbackHint,
    correlationId,
    httpStatus: definition.httpStatus,
    retryability: definition.retryability
  }));
}

function buildCapabilityGateResult({ allowed, capabilityId, satisfactionState, constraints = [], errorEnvelope } = {}) {
  return buildFrozenRecord({
    allowed: Boolean(allowed),
    capabilityId,
    satisfactionState,
    constraints: (constraints ?? []).map((constraint) => ({ ...constraint })),
    ...(errorEnvelope ? { errorEnvelope } : {})
  });
}

export function checkMultipartCapability(input = {}) {
  const providerProfile = input.providerProfile ?? input;
  const capabilityId = 'object.multipart_upload';
  const capability = getProviderCapabilityDetails(providerProfile, capabilityId);
  const allowed = capability.state === 'satisfied' || capability.state === 'partially_satisfied';

  if (allowed) {
    return buildCapabilityGateResult({
      allowed,
      capabilityId,
      satisfactionState: capability.state,
      constraints: capability.constraints ?? []
    });
  }

  return buildCapabilityGateResult({
    allowed: false,
    capabilityId,
    satisfactionState: capability.state,
    constraints: [],
    errorEnvelope: buildCapabilityNotAvailableError({
      capabilityId,
      fallbackHint: 'Use single-request object.put instead of multipart upload.',
      correlationId: input.correlationId ?? null
    })
  });
}

export function checkPresignedUrlCapability(input = {}) {
  const providerProfile = input.providerProfile ?? input;
  const capabilityId = 'bucket.presigned_urls';
  const capability = getProviderCapabilityDetails(providerProfile, capabilityId);
  const allowed = capability.state === 'satisfied' || capability.state === 'partially_satisfied';

  if (allowed) {
    return buildCapabilityGateResult({
      allowed,
      capabilityId,
      satisfactionState: capability.state,
      constraints: capability.constraints ?? []
    });
  }

  return buildCapabilityGateResult({
    allowed: false,
    capabilityId,
    satisfactionState: capability.state,
    constraints: [],
    errorEnvelope: buildCapabilityNotAvailableError({
      capabilityId,
      fallbackHint: 'Use the proxied upload/download endpoints instead of presigned URLs.',
      correlationId: input.correlationId ?? null
    })
  });
}

export function buildMultipartUploadSession({
  tenantId,
  workspaceId,
  bucketId,
  objectKey,
  ttlSeconds = DEFAULT_TTL_SECONDS,
  now = DEFAULT_NOW,
  correlationId = null
} = {}) {
  const initiatedAtDate = asDate(now);
  const effectiveTtlSeconds = assertPositiveInteger(ttlSeconds, 'ttlSeconds');
  const session = {
    sessionId: buildSessionId(initiatedAtDate),
    tenantId: assertNonEmptyString(tenantId, 'tenantId'),
    workspaceId: assertNonEmptyString(workspaceId, 'workspaceId'),
    bucketId: assertNonEmptyString(bucketId, 'bucketId'),
    objectKey: assertNonEmptyString(objectKey, 'objectKey'),
    initiatedAt: initiatedAtDate.toISOString(),
    ttlDeadline: new Date(initiatedAtDate.getTime() + (effectiveTtlSeconds * 1000)).toISOString(),
    state: MULTIPART_SESSION_STATES.ACTIVE,
    partCount: 0,
    accumulatedSizeBytes: 0,
    ...(correlationId ? { correlationId } : {})
  };

  return buildFrozenRecord(session);
}

export function buildMultipartSessionSummary(session = {}) {
  return buildFrozenRecord({
    sessionId: session.sessionId,
    objectKey: session.objectKey,
    bucketId: session.bucketId,
    initiatedAt: session.initiatedAt,
    ttlDeadline: session.ttlDeadline,
    state: session.state,
    partCount: session.partCount,
    accumulatedSizeBytes: session.accumulatedSizeBytes
  });
}

export function buildMultipartUploadList({ items = [], page = {} } = {}) {
  const summaries = items.map((item) => buildMultipartSessionSummary(item));
  return buildFrozenRecord({
    items: summaries,
    page: buildPaginationInfo(page, summaries.length || page.size || DEFAULT_PAGE_SIZE)
  });
}

export function buildMultipartPartReceipt({
  sessionId,
  partNumber,
  integrityToken,
  sizeBytes,
  receivedAt = DEFAULT_NOW
} = {}) {
  return buildFrozenRecord({
    sessionId: assertNonEmptyString(sessionId, 'sessionId'),
    partNumber: assertPositiveInteger(partNumber, 'partNumber'),
    integrityToken: assertNonEmptyString(integrityToken, 'integrityToken'),
    sizeBytes: assertNonNegativeNumber(sizeBytes, 'sizeBytes'),
    receivedAt: toIso(receivedAt)
  });
}

export function validateMultipartObjectKey({ objectKey, isReservedPrefixFn = isStorageReservedPrefix } = {}) {
  const normalizedKey = assertNonEmptyString(objectKey, 'objectKey');
  const reserved = isReservedPrefixFn({ candidatePrefix: normalizedKey });
  const errors = [];

  if (reserved) {
    errors.push('Reserved prefix conflict: multipart targets cannot use platform-managed prefixes.');
  }

  return buildFrozenRecord({
    valid: errors.length === 0,
    errors
  });
}

export function validatePartList({
  parts = [],
  maxParts = Number.POSITIVE_INFINITY,
  minPartSizeBytes = 0,
  allowEmptyList = false
} = {}) {
  const errors = [];
  const normalizedParts = parts.map((part) => ({ ...part }));
  const totalSizeBytes = normalizedParts.reduce((sum, part) => sum + (Number(part.sizeBytes) || 0), 0);

  if (!allowEmptyList && normalizedParts.length === 0) {
    errors.push('Multipart completion requires a non-empty part list.');
  }

  if (normalizedParts.length > maxParts) {
    errors.push(`Multipart part list exceeds maxParts constraint (${maxParts}).`);
  }

  const seen = new Set();
  for (let index = 0; index < normalizedParts.length; index += 1) {
    const part = normalizedParts[index];
    const partNumber = part.partNumber;

    if (!Number.isInteger(partNumber) || partNumber < 1) {
      errors.push(`Invalid part number at index ${index}.`);
      continue;
    }

    if (seen.has(partNumber)) {
      errors.push(`Duplicate part number ${partNumber} is not allowed in completion lists.`);
    }
    seen.add(partNumber);

    if (index > 0 && normalizedParts[index - 1].partNumber >= partNumber) {
      errors.push(`Multipart part list is not strictly ordered at part ${partNumber}.`);
    }
  }

  for (let expected = 1; expected <= normalizedParts.length; expected += 1) {
    const actual = normalizedParts[expected - 1]?.partNumber;
    if (actual !== expected) {
      errors.push(`Multipart part list has a gap or misordering at expected part ${expected}.`);
      break;
    }
  }

  if (minPartSizeBytes > 0 && normalizedParts.length > 1) {
    normalizedParts.slice(0, -1).forEach((part) => {
      if ((Number(part.sizeBytes) || 0) < minPartSizeBytes) {
        errors.push(`Non-final part ${part.partNumber} is below minPartSizeBytes (${minPartSizeBytes}).`);
      }
    });
  }

  return buildFrozenRecord({
    valid: errors.length === 0,
    errors,
    partCount: normalizedParts.length,
    totalSizeBytes
  });
}

export function buildMultipartCompletionPreview({ session, parts = [], now = DEFAULT_NOW } = {}) {
  const validation = validatePartList({ parts });
  const preview = {
    sessionId: session?.sessionId,
    objectKey: session?.objectKey,
    bucketId: session?.bucketId,
    tenantId: session?.tenantId,
    workspaceId: session?.workspaceId,
    partsCount: validation.partCount,
    totalSizeBytes: validation.totalSizeBytes,
    validationOutcome: validation.valid ? 'valid' : 'invalid',
    validationErrors: validation.errors,
    ...(session?.correlationId ? { correlationId: session.correlationId } : {})
  };

  if (validation.valid) {
    preview.expectedObjectRecord = buildStorageObjectRecord({
      bucket: {
        tenantId: session.tenantId,
        workspaceId: session.workspaceId,
        bucketName: session.bucketId,
        resourceId: session.bucketId,
        namespace: `${session.tenantId}:${session.workspaceId}`,
        providerType: 'storage',
        providerDisplayName: 'Storage',
        status: 'active',
        objectStats: { objectCount: 0, totalBytes: 0, empty: true },
        timestamps: { createdAt: toIso(now), updatedAt: toIso(now), activatedAt: toIso(now) },
        organization: {
          strategy: 'tenant-workspace-application-prefix-v1',
          layoutVersion: 'v1',
          tenantRootPrefix: `tenants/${session.tenantId}/`,
          workspaceRootPrefix: `tenants/${session.tenantId}/workspaces/${session.workspaceId}/`,
          workspaceSharedPrefix: `tenants/${session.tenantId}/workspaces/${session.workspaceId}/shared/`,
          applicationRootPrefixTemplate: `tenants/${session.tenantId}/workspaces/${session.workspaceId}/apps/{applicationId}/data/`,
          reservedPrefixes: [],
          quotaAttributionMode: 'tenant>workspace>application',
          auditScopeMode: 'tenant_workspace_application',
          slugIndependent: true
        },
        tenantStorageContext: {
          entityType: 'tenant_storage_context',
          tenantId: session.tenantId,
          providerType: 'minio',
          namespace: `${session.tenantId}:${session.workspaceId}`,
          quotaAssignment: { capabilityAvailable: true },
          state: 'active',
          bucketProvisioningAllowed: true
        },
        provisioning: {}
      },
      objectKey: session.objectKey,
      sizeBytes: validation.totalSizeBytes,
      now: toIso(now),
      updatedAt: toIso(now)
    });
  }

  return buildFrozenRecord(preview);
}

export function buildMultipartAbortPreview({ session, now = DEFAULT_NOW, correlationId = null } = {}) {
  return buildFrozenRecord({
    sessionId: session?.sessionId,
    objectKey: session?.objectKey,
    bucketId: session?.bucketId,
    tenantId: session?.tenantId,
    workspaceId: session?.workspaceId,
    state: MULTIPART_SESSION_STATES.ABORTED,
    abortedAt: toIso(now),
    ...(correlationId ?? session?.correlationId ? { correlationId: correlationId ?? session?.correlationId } : {})
  });
}

export function evaluateMultipartSessionStaleness({ session, now = DEFAULT_NOW } = {}) {
  const evaluatedAt = asDate(now);
  const deadline = asDate(session?.ttlDeadline ?? now);

  return buildFrozenRecord({
    sessionId: session?.sessionId,
    isStale: evaluatedAt.getTime() > deadline.getTime(),
    evaluatedAt: evaluatedAt.toISOString(),
    ttlDeadline: deadline.toISOString(),
    currentState: session?.state
  });
}

export function buildStaleSessionCleanupRecord({ session, cleanedAt = DEFAULT_NOW } = {}) {
  return buildFrozenRecord({
    sessionId: session?.sessionId,
    objectKey: session?.objectKey,
    bucketId: session?.bucketId,
    tenantId: session?.tenantId,
    workspaceId: session?.workspaceId,
    state: MULTIPART_SESSION_STATES.ABORTED,
    cleanupReason: 'ttl_exceeded',
    cleanedAt: toIso(cleanedAt)
  });
}

export function buildMultipartLifecycleAuditEvent({
  transition,
  session,
  partsCount,
  totalSizeBytes,
  abortReason,
  correlationId,
  occurredAt = DEFAULT_NOW
} = {}) {
  const event = {
    eventType: 'storage.multipart.lifecycle',
    transition,
    sessionId: session?.sessionId,
    tenantId: session?.tenantId,
    workspaceId: session?.workspaceId,
    bucketId: session?.bucketId,
    objectKey: session?.objectKey,
    partCount: partsCount ?? session?.partCount ?? 0,
    accumulatedSizeBytes: totalSizeBytes ?? session?.accumulatedSizeBytes ?? 0,
    occurredAt: toIso(occurredAt),
    ...(correlationId ?? session?.correlationId ? { correlationId: correlationId ?? session?.correlationId } : {})
  };

  if (
    transition === MULTIPART_LIFECYCLE_TRANSITIONS.ABORT
    || transition === MULTIPART_LIFECYCLE_TRANSITIONS.STALE_CLEANUP
  ) {
    event.abortReason = abortReason ?? 'caller_requested';
  }

  return buildFrozenRecord(event);
}

export function validatePresignedTtl({ requestedTtlSeconds, platformMaxTtlSeconds } = {}) {
  const requested = assertPositiveInteger(requestedTtlSeconds, 'requestedTtlSeconds');
  const maximum = assertPositiveInteger(platformMaxTtlSeconds, 'platformMaxTtlSeconds');
  const clamped = requested > maximum;

  return buildFrozenRecord({
    valid: true,
    requestedTtlSeconds: requested,
    effectiveTtlSeconds: clamped ? maximum : requested,
    clamped,
    platformMaxTtlSeconds: maximum
  });
}

export function buildPresignedUrlRecord({
  operation,
  bucketId,
  objectKey,
  tenantId,
  workspaceId,
  grantedTtlSeconds,
  ttlClamped = false,
  generatedAt = DEFAULT_NOW,
  correlationId = null
} = {}) {
  const normalizedOperation = assertNonEmptyString(operation, 'operation');
  if (!Object.values(PRESIGNED_URL_OPERATIONS).includes(normalizedOperation)) {
    throw new Error('operation must be a valid presigned URL operation.');
  }

  const generatedAtDate = asDate(generatedAt);
  const ttlSeconds = assertPositiveInteger(grantedTtlSeconds, 'grantedTtlSeconds');

  return buildFrozenRecord({
    presignedUrlRef: buildOpaqueReference('psu', `${tenantId}:${workspaceId}:${bucketId}:${objectKey}:${normalizedOperation}:${generatedAtDate.toISOString()}`),
    operation: normalizedOperation,
    bucketId: assertNonEmptyString(bucketId, 'bucketId'),
    objectKey: assertNonEmptyString(objectKey, 'objectKey'),
    tenantId: assertNonEmptyString(tenantId, 'tenantId'),
    workspaceId: assertNonEmptyString(workspaceId, 'workspaceId'),
    grantedTtlSeconds: ttlSeconds,
    ttlClamped: Boolean(ttlClamped),
    expiresAt: new Date(generatedAtDate.getTime() + (ttlSeconds * 1000)).toISOString(),
    generatedAt: generatedAtDate.toISOString(),
    ...(correlationId ? { correlationId } : {})
  });
}

export function buildPresignedUrlAuditEvent({ presignedUrlRecord, requestingIdentity } = {}) {
  return buildFrozenRecord(sanitizeStringsDeep({
    eventType: 'storage.presigned_url.generated',
    presignedUrlRef: presignedUrlRecord?.presignedUrlRef,
    requestingIdentity: assertNonEmptyString(requestingIdentity, 'requestingIdentity'),
    tenantId: presignedUrlRecord?.tenantId,
    workspaceId: presignedUrlRecord?.workspaceId,
    bucketId: presignedUrlRecord?.bucketId,
    objectKey: presignedUrlRecord?.objectKey,
    operation: presignedUrlRecord?.operation,
    grantedTtlSeconds: presignedUrlRecord?.grantedTtlSeconds,
    ttlClamped: presignedUrlRecord?.ttlClamped,
    expiresAt: presignedUrlRecord?.expiresAt,
    generatedAt: presignedUrlRecord?.generatedAt,
    ...(presignedUrlRecord?.correlationId ? { correlationId: presignedUrlRecord.correlationId } : {})
  }));
}
