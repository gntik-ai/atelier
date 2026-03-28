import { createHash } from 'node:crypto';

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

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeAuditValue(value) {
  if (typeof value === 'string') {
    return sanitizeAuditString(value);
  }

  if (Array.isArray(value)) {
    return deepFreeze(value.map((entry) => sanitizeAuditValue(entry)));
  }

  if (isPlainObject(value)) {
    return deepFreeze(Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, sanitizeAuditValue(entry)])
    ));
  }

  return value;
}

function toNonNegativeInteger(value, fallback = 0) {
  if (value == null || value === '') {
    return fallback;
  }

  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0) {
    return fallback;
  }

  return numeric;
}

function toNullable(value) {
  return value === undefined ? null : value;
}

function buildStructuredError(message, code) {
  const error = new Error(message);
  error.code = code;
  error.detail = { code };
  return error;
}

function sanitizeScope(scope = {}) {
  return deepFreeze({
    tenantId: sanitizeAuditString(toNullable(scope.tenantId) ?? null),
    workspaceId: sanitizeAuditString(toNullable(scope.workspaceId) ?? null),
    bucketId: sanitizeAuditString(toNullable(scope.bucketId) ?? null),
    objectKey: sanitizeAuditString(toNullable(scope.objectKey) ?? null)
  });
}

function publishStorageAuditEvent(auditEvent, context = {}, { allowMetaAudit = false } = {}) {
  if (!allowMetaAudit && auditEvent?.operationType === STORAGE_AUDIT_OPERATION_TYPES.AUDIT_QUERY) {
    return undefined;
  }

  const publisher = context.publishAuditEvent;
  if (typeof publisher === 'function') {
    publisher(STORAGE_AUDIT_TOPIC, auditEvent);
  }

  return auditEvent?.eventId;
}

function credentialOwnedByActor(context = {}, credentialId) {
  if (!credentialId) {
    return false;
  }

  if (typeof context.isCredentialOwnedByActor === 'function') {
    return Boolean(context.isCredentialOwnedByActor(credentialId, context.actorId));
  }

  if (Array.isArray(context.ownedCredentialIds)) {
    return context.ownedCredentialIds.includes(credentialId);
  }

  return false;
}

function normalizeIsoTimestamp(value, fieldName) {
  if (value == null || value === '') {
    return undefined;
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw buildStructuredError(`${fieldName} must be a valid ISO-8601 timestamp.`, STORAGE_AUDIT_ERROR_CODES.AUDIT_QUERY_INVALID);
  }

  return new Date(parsed).toISOString();
}

function normalizePolicyChangeSummary(changeSummary = {}) {
  if (!isPlainObject(changeSummary)) {
    return null;
  }

  const result = {
    statementsAdded: toNonNegativeInteger(changeSummary.statementsAdded, 0),
    statementsRemoved: toNonNegativeInteger(changeSummary.statementsRemoved, 0),
    statementsModified: toNonNegativeInteger(changeSummary.statementsModified, 0)
  };

  if (changeSummary.statementId != null && changeSummary.statementId !== '') {
    result.statementId = sanitizeAuditString(String(changeSummary.statementId));
  }

  return sanitizeAuditValue(result);
}

function normalizeQuotaChangeSummary(changeSummary = {}) {
  if (!isPlainObject(changeSummary)) {
    return null;
  }

  const result = {};
  if (changeSummary.dimension != null) {
    result.dimension = sanitizeAuditString(String(changeSummary.dimension));
  }
  if (changeSummary.oldValue != null && Number.isFinite(Number(changeSummary.oldValue))) {
    result.oldValue = Number(changeSummary.oldValue);
  }
  if (changeSummary.newValue != null && Number.isFinite(Number(changeSummary.newValue))) {
    result.newValue = Number(changeSummary.newValue);
  }

  return sanitizeAuditValue(result);
}

function normalizeAdminChangeSummary(operationType, changeSummary) {
  if (!changeSummary) {
    return null;
  }

  if (POLICY_CHANGE_OPERATION_TYPES.has(operationType)) {
    return normalizePolicyChangeSummary(changeSummary);
  }

  if (QUOTA_CHANGE_OPERATION_TYPES.has(operationType)) {
    return normalizeQuotaChangeSummary(changeSummary);
  }

  return sanitizeAuditValue(changeSummary);
}

function mapOperationTypeFromSourceEvent(sourceEvent = {}) {
  const eventType = sourceEvent?.eventType ?? '';

  if (eventType.startsWith('storage.object.') || eventType.startsWith('storage.bucket.')) {
    return eventType.replace(/^storage\./, '');
  }

  if (eventType.startsWith('storage.error.')) {
    return 'error.normalized';
  }

  if (eventType.startsWith('storage.event_notification.')) {
    return sourceEvent?.action ? `event_notification.${sourceEvent.action}` : 'event_notification.audit';
  }

  if (eventType.startsWith('storage.usage.')) {
    return 'usage_report.query';
  }

  if (eventType.startsWith('storage.import_export.')) {
    return `import_export.${sourceEvent.operationType ?? 'unknown'}`;
  }

  return 'unknown';
}

function buildNormalizedRecord(input = {}) {
  const resourceScope = sanitizeScope(input.resourceScope ?? {});
  const normalized = {
    eventId: sanitizeAuditString(toNullable(input.eventId) ?? generateEventId(input.correlationId ?? input.eventType ?? 'normalized')),
    eventType: sanitizeAuditString(toNullable(input.eventType) ?? 'storage.unknown'),
    operationCategory: sanitizeAuditString(toNullable(input.operationCategory) ?? STORAGE_AUDIT_OPERATION_CATEGORIES.DATA_PLANE),
    operationType: sanitizeAuditString(toNullable(input.operationType) ?? 'unknown'),
    actorId: sanitizeAuditString(toNullable(input.actorId) ?? null),
    actorType: sanitizeAuditString(toNullable(input.actorType) ?? 'user'),
    credentialId: sanitizeAuditString(toNullable(input.credentialId) ?? null),
    outcome: sanitizeAuditString(toNullable(input.outcome) ?? 'success'),
    resourceScope,
    objectKey: resourceScope.objectKey,
    changeSummary: sanitizeAuditValue(toNullable(input.changeSummary) ?? null),
    errorCode: sanitizeAuditString(toNullable(input.errorCode) ?? null),
    policySource: sanitizeAuditString(toNullable(input.policySource) ?? null),
    triggerSource: sanitizeAuditString(toNullable(input.triggerSource) ?? null),
    cascadeTriggered: toNullable(input.cascadeTriggered) ?? null,
    cascadeScope: sanitizeAuditValue(toNullable(input.cascadeScope) ?? null),
    correlationId: sanitizeAuditString(toNullable(input.correlationId) ?? null),
    occurredAt: normalizeIsoTimestamp(input.occurredAt, 'occurredAt') ?? new Date().toISOString()
  };

  return deepFreeze(normalized);
}

export const STORAGE_AUDIT_TOPIC = 'storage.audit.events';

export const STORAGE_AUDIT_OPERATION_CATEGORIES = Object.freeze({
  DATA_PLANE: 'data_plane',
  ADMINISTRATIVE: 'administrative',
  ERROR: 'error',
  LIFECYCLE: 'lifecycle'
});

export const STORAGE_AUDIT_OPERATION_TYPES = Object.freeze({
  OBJECT_PUT: 'object.put',
  OBJECT_GET: 'object.get',
  OBJECT_DELETE: 'object.delete',
  OBJECT_LIST: 'object.list',
  BUCKET_CREATE: 'bucket.create',
  BUCKET_DELETE: 'bucket.delete',
  BUCKET_POLICY_CREATE: 'bucket_policy.create',
  BUCKET_POLICY_UPDATE: 'bucket_policy.update',
  BUCKET_POLICY_DELETE: 'bucket_policy.delete',
  BUCKET_POLICY_SUPERADMIN_OVERRIDE: 'bucket_policy.superadmin_override',
  WORKSPACE_PERMISSIONS_UPDATE: 'workspace_permissions.update',
  TENANT_TEMPLATE_UPDATE: 'tenant_template.update',
  QUOTA_TENANT_UPDATE: 'quota.tenant_update',
  QUOTA_WORKSPACE_UPDATE: 'quota.workspace_update',
  TENANT_CONTEXT_PROVISION: 'tenant_context.provision',
  TENANT_CONTEXT_SUSPEND: 'tenant_context.suspend',
  TENANT_CONTEXT_REACTIVATE: 'tenant_context.reactivate',
  TENANT_CONTEXT_DELETE: 'tenant_context.delete',
  CREDENTIAL_CREATE: 'credential.create',
  CREDENTIAL_ROTATE: 'credential.rotate',
  CREDENTIAL_REVOKE: 'credential.revoke',
  CREDENTIAL_EXPIRE: 'credential.expire',
  ACCESS_DENIED: 'access.denied',
  AUDIT_QUERY: 'audit.query'
});

export const STORAGE_AUDIT_ERROR_CODES = Object.freeze({
  AUDIT_SCOPE_UNAUTHORIZED: 'AUDIT_SCOPE_UNAUTHORIZED',
  AUDIT_QUERY_INVALID: 'AUDIT_QUERY_INVALID',
  AUDIT_COVERAGE_UNAVAILABLE: 'AUDIT_COVERAGE_UNAVAILABLE'
});

export const STORAGE_AUDIT_COVERAGE_CATEGORIES = Object.freeze([
  'object.read',
  'object.write',
  'object.delete',
  'object.list',
  'bucket.create',
  'bucket.delete',
  'bucket_policy.change',
  'credential.lifecycle',
  'quota.change',
  'tenant_context.lifecycle',
  'access.denied',
  'import_export',
  'usage_report',
  'event_notification.lifecycle',
  'error'
]);

const ADMIN_OPERATION_TYPES = new Set([
  STORAGE_AUDIT_OPERATION_TYPES.BUCKET_CREATE,
  STORAGE_AUDIT_OPERATION_TYPES.BUCKET_DELETE,
  STORAGE_AUDIT_OPERATION_TYPES.BUCKET_POLICY_CREATE,
  STORAGE_AUDIT_OPERATION_TYPES.BUCKET_POLICY_UPDATE,
  STORAGE_AUDIT_OPERATION_TYPES.BUCKET_POLICY_DELETE,
  STORAGE_AUDIT_OPERATION_TYPES.BUCKET_POLICY_SUPERADMIN_OVERRIDE,
  STORAGE_AUDIT_OPERATION_TYPES.WORKSPACE_PERMISSIONS_UPDATE,
  STORAGE_AUDIT_OPERATION_TYPES.TENANT_TEMPLATE_UPDATE,
  STORAGE_AUDIT_OPERATION_TYPES.QUOTA_TENANT_UPDATE,
  STORAGE_AUDIT_OPERATION_TYPES.QUOTA_WORKSPACE_UPDATE,
  STORAGE_AUDIT_OPERATION_TYPES.TENANT_CONTEXT_PROVISION,
  STORAGE_AUDIT_OPERATION_TYPES.TENANT_CONTEXT_SUSPEND,
  STORAGE_AUDIT_OPERATION_TYPES.TENANT_CONTEXT_REACTIVATE,
  STORAGE_AUDIT_OPERATION_TYPES.TENANT_CONTEXT_DELETE
]);

const POLICY_CHANGE_OPERATION_TYPES = new Set([
  STORAGE_AUDIT_OPERATION_TYPES.BUCKET_POLICY_CREATE,
  STORAGE_AUDIT_OPERATION_TYPES.BUCKET_POLICY_UPDATE,
  STORAGE_AUDIT_OPERATION_TYPES.BUCKET_POLICY_DELETE,
  STORAGE_AUDIT_OPERATION_TYPES.BUCKET_POLICY_SUPERADMIN_OVERRIDE,
  STORAGE_AUDIT_OPERATION_TYPES.WORKSPACE_PERMISSIONS_UPDATE,
  STORAGE_AUDIT_OPERATION_TYPES.TENANT_TEMPLATE_UPDATE
]);

const QUOTA_CHANGE_OPERATION_TYPES = new Set([
  STORAGE_AUDIT_OPERATION_TYPES.QUOTA_TENANT_UPDATE,
  STORAGE_AUDIT_OPERATION_TYPES.QUOTA_WORKSPACE_UPDATE
]);

const TENANT_LIFECYCLE_OPERATION_TYPES = new Set([
  STORAGE_AUDIT_OPERATION_TYPES.TENANT_CONTEXT_SUSPEND,
  STORAGE_AUDIT_OPERATION_TYPES.TENANT_CONTEXT_DELETE
]);

const CREDENTIAL_LIFECYCLE_OPERATION_TYPES = new Set([
  STORAGE_AUDIT_OPERATION_TYPES.CREDENTIAL_CREATE,
  STORAGE_AUDIT_OPERATION_TYPES.CREDENTIAL_ROTATE,
  STORAGE_AUDIT_OPERATION_TYPES.CREDENTIAL_REVOKE,
  STORAGE_AUDIT_OPERATION_TYPES.CREDENTIAL_EXPIRE
]);

const CATEGORY_OPERATION_TYPE_MAP = deepFreeze({
  'object.read': [STORAGE_AUDIT_OPERATION_TYPES.OBJECT_GET],
  'object.write': [STORAGE_AUDIT_OPERATION_TYPES.OBJECT_PUT],
  'object.delete': [STORAGE_AUDIT_OPERATION_TYPES.OBJECT_DELETE],
  'object.list': [STORAGE_AUDIT_OPERATION_TYPES.OBJECT_LIST],
  'bucket.create': [STORAGE_AUDIT_OPERATION_TYPES.BUCKET_CREATE],
  'bucket.delete': [STORAGE_AUDIT_OPERATION_TYPES.BUCKET_DELETE],
  'bucket_policy.change': [
    STORAGE_AUDIT_OPERATION_TYPES.BUCKET_POLICY_CREATE,
    STORAGE_AUDIT_OPERATION_TYPES.BUCKET_POLICY_UPDATE,
    STORAGE_AUDIT_OPERATION_TYPES.BUCKET_POLICY_DELETE,
    STORAGE_AUDIT_OPERATION_TYPES.BUCKET_POLICY_SUPERADMIN_OVERRIDE,
    STORAGE_AUDIT_OPERATION_TYPES.WORKSPACE_PERMISSIONS_UPDATE,
    STORAGE_AUDIT_OPERATION_TYPES.TENANT_TEMPLATE_UPDATE
  ],
  'credential.lifecycle': [...CREDENTIAL_LIFECYCLE_OPERATION_TYPES],
  'quota.change': [
    STORAGE_AUDIT_OPERATION_TYPES.QUOTA_TENANT_UPDATE,
    STORAGE_AUDIT_OPERATION_TYPES.QUOTA_WORKSPACE_UPDATE
  ],
  'tenant_context.lifecycle': [
    STORAGE_AUDIT_OPERATION_TYPES.TENANT_CONTEXT_PROVISION,
    STORAGE_AUDIT_OPERATION_TYPES.TENANT_CONTEXT_SUSPEND,
    STORAGE_AUDIT_OPERATION_TYPES.TENANT_CONTEXT_REACTIVATE,
    STORAGE_AUDIT_OPERATION_TYPES.TENANT_CONTEXT_DELETE
  ],
  'access.denied': [STORAGE_AUDIT_OPERATION_TYPES.ACCESS_DENIED],
  import_export: ['import_export.export', 'import_export.import'],
  usage_report: ['usage_report.query'],
  'event_notification.lifecycle': ['event_notification.rule_created', 'event_notification.rule_updated', 'event_notification.rule_deleted', 'event_notification.delivery_previewed', 'event_notification.delivery_blocked'],
  error: ['error.normalized', STORAGE_NORMALIZED_ERROR_CODES.STORAGE_UNKNOWN_ERROR]
});

function sanitizeAuditString(value) {
  if (typeof value !== 'string') {
    return value;
  }

  return value
    .replace(/https?:\/\/[^\s]+/gi, '[redacted-url]')
    .replace(/[A-Za-z0-9+/]{20,}={0,2}/g, '[redacted]')
    .trim();
}

function generateEventId(seed) {
  const digest = createHash('sha256')
    .update(`${seed ?? ''}${Date.now()}`)
    .digest('hex')
    .slice(0, 32);

  return `sevt_${digest}`;
}

function assertAuditQueryScope(context = {}, params = {}) {
  if (context.isSuperadmin) {
    return;
  }

  if ((params.tenantId ?? context.tenantId) !== context.tenantId) {
    throw buildStructuredError('Storage audit query must stay within the caller tenant scope.', STORAGE_AUDIT_ERROR_CODES.AUDIT_SCOPE_UNAUTHORIZED);
  }

  if (context.actorType === 'tenant_owner') {
    return;
  }

  if (context.actorType === 'workspace_admin') {
    if (params.workspaceId != null && params.workspaceId !== context.workspaceId) {
      throw buildStructuredError('Workspace admins may query only their own workspace audit trail.', STORAGE_AUDIT_ERROR_CODES.AUDIT_SCOPE_UNAUTHORIZED);
    }
    return;
  }

  if (['developer', 'user'].includes(context.actorType)) {
    if ((params.workspaceId ?? context.workspaceId) !== context.workspaceId) {
      throw buildStructuredError('Developers may query only their own workspace audit trail.', STORAGE_AUDIT_ERROR_CODES.AUDIT_SCOPE_UNAUTHORIZED);
    }

    const actorMatches = params.actorId === context.actorId;
    const credentialMatches = credentialOwnedByActor(context, params.credentialId);
    if (!actorMatches && !credentialMatches) {
      throw buildStructuredError('Developers may query only their own actor or owned credential audit records.', STORAGE_AUDIT_ERROR_CODES.AUDIT_SCOPE_UNAUTHORIZED);
    }
  }
}

function normalizeQueryParams(params = {}) {
  const normalized = { ...params };
  const rawLimit = params.limit;

  if (rawLimit == null || rawLimit === '') {
    normalized.limit = 50;
  } else {
    const numericLimit = Number(rawLimit);
    if (!Number.isInteger(numericLimit)) {
      throw buildStructuredError('Storage audit query limit must be an integer.', STORAGE_AUDIT_ERROR_CODES.AUDIT_QUERY_INVALID);
    }
    if (numericLimit > 500) {
      throw buildStructuredError('Storage audit query limit cannot exceed 500.', STORAGE_AUDIT_ERROR_CODES.AUDIT_QUERY_INVALID);
    }
    normalized.limit = numericLimit < 1 ? 1 : numericLimit;
  }

  normalized.sortOrder = params.sortOrder == null || params.sortOrder === ''
    ? 'desc'
    : String(params.sortOrder).toLowerCase();

  if (!['asc', 'desc'].includes(normalized.sortOrder)) {
    throw buildStructuredError('Storage audit query sortOrder must be asc or desc.', STORAGE_AUDIT_ERROR_CODES.AUDIT_QUERY_INVALID);
  }

  const fromTimestamp = normalizeIsoTimestamp(params.fromTimestamp, 'fromTimestamp');
  const toTimestamp = normalizeIsoTimestamp(params.toTimestamp, 'toTimestamp');

  if (fromTimestamp !== undefined) {
    normalized.fromTimestamp = fromTimestamp;
  }
  if (toTimestamp !== undefined) {
    normalized.toTimestamp = toTimestamp;
  }

  return normalized;
}

function categoryForEventType(eventType) {
  if (typeof eventType !== 'string') {
    return STORAGE_AUDIT_OPERATION_CATEGORIES.DATA_PLANE;
  }

  if (eventType.startsWith('storage.object.') || eventType.startsWith('storage.bucket.')) {
    return STORAGE_AUDIT_OPERATION_CATEGORIES.DATA_PLANE;
  }

  if (eventType.startsWith('storage.error.')) {
    return STORAGE_AUDIT_OPERATION_CATEGORIES.ERROR;
  }

  if (eventType.startsWith('storage.event_notification.')) {
    return STORAGE_AUDIT_OPERATION_CATEGORIES.LIFECYCLE;
  }

  if (eventType.startsWith('storage.usage.')) {
    return STORAGE_AUDIT_OPERATION_CATEGORIES.ADMINISTRATIVE;
  }

  if (eventType.startsWith('storage.import_export.')) {
    return STORAGE_AUDIT_OPERATION_CATEGORIES.DATA_PLANE;
  }

  return STORAGE_AUDIT_OPERATION_CATEGORIES.DATA_PLANE;
}

export function buildStorageUnifiedAuditEvent(input = {}) {
  for (const fieldName of ['eventType', 'operationCategory', 'operationType', 'actorId', 'actorType', 'outcome']) {
    if (input[fieldName] == null || input[fieldName] === '') {
      throw buildStructuredError(`${fieldName} is required for storage audit events.`, STORAGE_AUDIT_ERROR_CODES.AUDIT_QUERY_INVALID);
    }
  }

  const occurredAt = normalizeIsoTimestamp(input.occurredAt, 'occurredAt') ?? new Date().toISOString();
  const resourceScope = sanitizeScope(input.resourceScope ?? {});
  const eventId = input.eventId == null || input.eventId === ''
    ? generateEventId(input.eventId ?? input.correlationId)
    : sanitizeAuditString(input.eventId);

  const normalized = {
    eventId,
    eventType: sanitizeAuditString(input.eventType),
    operationCategory: sanitizeAuditString(input.operationCategory),
    operationType: sanitizeAuditString(input.operationType),
    actorId: sanitizeAuditString(input.actorId),
    actorType: sanitizeAuditString(input.actorType),
    credentialId: sanitizeAuditString(toNullable(input.credentialId) ?? null),
    outcome: sanitizeAuditString(input.outcome),
    resourceScope,
    objectKey: resourceScope.objectKey,
    changeSummary: sanitizeAuditValue(toNullable(input.changeSummary) ?? null),
    errorCode: sanitizeAuditString(toNullable(input.errorCode) ?? null),
    policySource: sanitizeAuditString(toNullable(input.policySource) ?? null),
    triggerSource: sanitizeAuditString(toNullable(input.triggerSource) ?? null),
    cascadeTriggered: toNullable(input.cascadeTriggered) ?? null,
    cascadeScope: sanitizeAuditValue(toNullable(input.cascadeScope) ?? null),
    correlationId: sanitizeAuditString(toNullable(input.correlationId) ?? null),
    occurredAt
  };

  return deepFreeze(normalized);
}

export function buildStorageAdminAuditEvent(operationType, context = {}, detail = {}) {
  if (!ADMIN_OPERATION_TYPES.has(operationType)) {
    throw buildStructuredError(`Unsupported storage administrative audit operation: ${operationType}`, STORAGE_AUDIT_ERROR_CODES.AUDIT_QUERY_INVALID);
  }

  if (TENANT_LIFECYCLE_OPERATION_TYPES.has(operationType) && detail.cascadeTriggered !== false) {
    if (typeof detail.cascadeTriggered !== 'boolean') {
      throw buildStructuredError('Tenant lifecycle audit events require cascadeTriggered to be provided explicitly.', STORAGE_AUDIT_ERROR_CODES.AUDIT_QUERY_INVALID);
    }
    if (!isPlainObject(detail.cascadeScope)) {
      throw buildStructuredError('Tenant lifecycle audit events require cascadeScope when cascadeTriggered is true.', STORAGE_AUDIT_ERROR_CODES.AUDIT_QUERY_INVALID);
    }
  }

  return buildStorageUnifiedAuditEvent({
    eventType: `storage.${operationType}`,
    operationCategory: STORAGE_AUDIT_OPERATION_CATEGORIES.ADMINISTRATIVE,
    operationType,
    actorId: context.actorId,
    actorType: context.actorType,
    credentialId: context.credentialId ?? null,
    outcome: detail.outcome,
    resourceScope: {
      tenantId: context.tenantId ?? null,
      workspaceId: context.workspaceId ?? null,
      bucketId: detail.bucketId ?? null,
      objectKey: detail.objectKey ?? null
    },
    changeSummary: normalizeAdminChangeSummary(operationType, detail.changeSummary),
    triggerSource: detail.triggerSource ?? null,
    cascadeTriggered: detail.cascadeTriggered ?? null,
    cascadeScope: detail.cascadeScope ?? null,
    correlationId: context.correlationId ?? null,
    occurredAt: detail.occurredAt
  });
}

export function buildStorageAccessDeniedAuditEvent(context = {}, detail = {}) {
  if (detail.policyDocument || detail.policy) {
    throw buildStructuredError('Storage access-denied audit events must not include full policy documents.', STORAGE_AUDIT_ERROR_CODES.AUDIT_QUERY_INVALID);
  }

  return buildStorageUnifiedAuditEvent({
    eventType: 'storage.access.denied',
    operationCategory: STORAGE_AUDIT_OPERATION_CATEGORIES.DATA_PLANE,
    operationType: STORAGE_AUDIT_OPERATION_TYPES.ACCESS_DENIED,
    actorId: context.actorId,
    actorType: context.actorType,
    credentialId: context.credentialId ?? null,
    outcome: 'denied',
    resourceScope: {
      tenantId: context.tenantId ?? null,
      workspaceId: context.workspaceId ?? null,
      bucketId: detail.targetResource?.bucketId ?? null,
      objectKey: detail.targetResource?.objectKey ?? null
    },
    policySource: detail.policySource ?? null,
    changeSummary: sanitizeAuditValue({
      requestedAction: detail.requestedAction ?? null,
      statementId: detail.statementId ?? null
    }),
    correlationId: context.correlationId ?? null,
    occurredAt: detail.occurredAt
  });
}

export function buildStorageCredentialLifecycleAuditEvent(context = {}, detail = {}) {
  if (detail.credentialId == null || detail.credentialId === '') {
    throw buildStructuredError('credentialId is required for storage credential lifecycle audit events.', STORAGE_AUDIT_ERROR_CODES.AUDIT_QUERY_INVALID);
  }

  if (!CREDENTIAL_LIFECYCLE_OPERATION_TYPES.has(detail.operationType)) {
    throw buildStructuredError(`Unsupported storage credential lifecycle operation: ${detail.operationType}`, STORAGE_AUDIT_ERROR_CODES.AUDIT_QUERY_INVALID);
  }

  return buildStorageUnifiedAuditEvent({
    eventType: `storage.${detail.operationType}`,
    operationCategory: STORAGE_AUDIT_OPERATION_CATEGORIES.ADMINISTRATIVE,
    operationType: detail.operationType,
    actorId: context.actorId,
    actorType: context.actorType,
    credentialId: detail.credentialId,
    outcome: detail.outcome,
    resourceScope: {
      tenantId: context.tenantId ?? null,
      workspaceId: context.workspaceId ?? null,
      bucketId: detail.bucketId ?? null,
      objectKey: detail.objectKey ?? null
    },
    triggerSource: detail.triggerSource ?? null,
    correlationId: context.correlationId ?? null,
    occurredAt: detail.occurredAt
  });
}

export function buildStorageMetaAuditEvent(context = {}, query = {}) {
  const allowedFields = ['tenantId', 'workspaceId', 'actorId', 'operationType', 'outcome', 'fromTimestamp', 'toTimestamp'];
  const changeSummary = Object.fromEntries(
    allowedFields
      .filter((fieldName) => query[fieldName] !== undefined)
      .map((fieldName) => [fieldName, query[fieldName]])
  );

  return buildStorageUnifiedAuditEvent({
    eventType: 'storage.audit.query',
    operationCategory: STORAGE_AUDIT_OPERATION_CATEGORIES.ADMINISTRATIVE,
    operationType: STORAGE_AUDIT_OPERATION_TYPES.AUDIT_QUERY,
    actorId: context.actorId,
    actorType: context.actorType,
    credentialId: context.credentialId ?? null,
    outcome: 'success',
    resourceScope: {
      tenantId: context.tenantId ?? null,
      workspaceId: context.workspaceId ?? null,
      bucketId: null,
      objectKey: null
    },
    changeSummary,
    correlationId: context.correlationId ?? null
  });
}

export function emitStorageAuditEvent(auditEvent, context = {}) {
  publishStorageAuditEvent(auditEvent, context);
}

export function normalizeStorageAuditEvent(sourceEvent = {}) {
  const eventType = sanitizeAuditString(sourceEvent.eventType ?? 'storage.unknown');
  const resourceScope = sanitizeScope({
    tenantId: sourceEvent.tenantId ?? sourceEvent.sourceTenantId ?? sourceEvent.targetTenantId ?? sourceEvent.resourceScope?.tenantId ?? null,
    workspaceId: sourceEvent.workspaceId ?? sourceEvent.sourceWorkspaceId ?? sourceEvent.targetWorkspaceId ?? sourceEvent.resourceScope?.workspaceId ?? null,
    bucketId: sourceEvent.bucketId ?? sourceEvent.bucketResourceId ?? sourceEvent.sourceBucketId ?? sourceEvent.targetBucketId ?? sourceEvent.resourceScope?.bucketId ?? null,
    objectKey: sourceEvent.objectKey ?? sourceEvent.resourceScope?.objectKey ?? null
  });

  const actorId = sourceEvent.actorUserId
    ?? sourceEvent.auditEnvelope?.actorUserId
    ?? sourceEvent.actingPrincipal?.id
    ?? sourceEvent.actor?.id
    ?? null;
  const actorType = sourceEvent.actingPrincipal?.type
    ?? sourceEvent.actor?.type
    ?? (sourceEvent.actorUserId || sourceEvent.auditEnvelope?.actorUserId ? 'user' : 'user');
  const occurredAt = sourceEvent.occurredAt
    ?? sourceEvent.timestamp
    ?? sourceEvent.auditEnvelope?.occurredAt
    ?? new Date().toISOString();
  const outcome = sourceEvent.outcome
    ?? sourceEvent.auditEnvelope?.outcome
    ?? (sourceEvent.allowed === false ? 'denied' : 'success');
  const changeSummary = sourceEvent.filterCriteria
    ? { filterCriteria: sourceEvent.filterCriteria }
    : sourceEvent.action
      ? { action: sourceEvent.action, matchedEventType: sourceEvent.matchedEventType ?? null }
      : sourceEvent.scopeType || sourceEvent.scopeId
        ? { scopeType: sourceEvent.scopeType ?? null, scopeId: sourceEvent.scopeId ?? null }
        : null;

  return buildNormalizedRecord({
    eventType,
    operationCategory: categoryForEventType(eventType),
    operationType: mapOperationTypeFromSourceEvent(sourceEvent),
    actorId,
    actorType,
    credentialId: sourceEvent.credentialId ?? null,
    outcome,
    resourceScope,
    changeSummary,
    errorCode: sourceEvent.errorCode ?? sourceEvent.reasonCode ?? sourceEvent.effectiveViolation?.normalizedCode ?? null,
    policySource: sourceEvent.policySource ?? sourceEvent.source ?? null,
    triggerSource: sourceEvent.triggerSource ?? null,
    cascadeTriggered: sourceEvent.cascadeTriggered ?? null,
    cascadeScope: sourceEvent.cascadeScope ?? null,
    correlationId: sourceEvent.correlationId ?? sourceEvent.auditEnvelope?.correlationId ?? null,
    occurredAt
  });
}

export async function queryStorageAuditTrail(context = {}, params = {}) {
  assertAuditQueryScope(context, params);
  const normalizedParams = normalizeQueryParams(params);
  const metaAuditEvent = buildStorageMetaAuditEvent(context, normalizedParams);
  publishStorageAuditEvent(metaAuditEvent, context, { allowMetaAudit: true });

  const loader = context.queryAuditRecords ?? (async () => ({ items: [], cursor: null, total: 0 }));
  const result = await loader(normalizedParams);
  const items = Array.isArray(result?.items) ? result.items : [];
  const filteredItems = context.isSuperadmin
    ? items
    : items.filter((item) => (item?.resourceScope?.tenantId ?? context.tenantId ?? null) === (context.tenantId ?? null));

  return {
    items: filteredItems,
    cursor: result?.cursor ?? null,
    total: result?.total ?? filteredItems.length,
    appliedFilters: normalizedParams
  };
}

export async function buildStorageAuditCoverageReport(context = {}, params = {}) {
  const scopeType = params.scopeType ?? 'tenant';
  if (scopeType === 'platform' && !context.isSuperadmin) {
    throw buildStructuredError('platform scope requires superadmin', STORAGE_AUDIT_ERROR_CODES.AUDIT_COVERAGE_UNAVAILABLE);
  }

  const windowDays = Number.isInteger(params.windowDays) && params.windowDays > 0 ? params.windowDays : 30;
  const loader = context.queryCoverage ?? (async () => ({ lastEventAt: null }));
  const tenantId = scopeType === 'tenant' ? context.tenantId ?? null : null;

  const categories = [];
  for (const category of STORAGE_AUDIT_COVERAGE_CATEGORIES) {
    const coverage = await loader({ category, tenantId, windowDays });
    categories.push({
      categoryId: category,
      displayName: category.split('.').map((segment) => segment.replace(/_/g, ' ')).join(' '),
      exampleOperationTypes: CATEGORY_OPERATION_TYPE_MAP[category],
      coverageStatus: coverage?.lastEventAt ? 'covered' : 'gap',
      lastEventAt: coverage?.lastEventAt ?? null
    });
  }

  return deepFreeze({
    entityType: 'storage_audit_coverage_report',
    scopeType,
    tenantId,
    windowDays,
    generatedAt: new Date().toISOString(),
    categories: deepFreeze(categories)
  });
}

export {
  generateEventId,
  sanitizeAuditString,
  assertAuditQueryScope,
  normalizeQueryParams,
  categoryForEventType
};
