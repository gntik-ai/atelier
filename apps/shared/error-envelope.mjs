import { randomUUID } from 'node:crypto';

const REQUEST_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const CORRELATION_ID_RE = /^[A-Za-z0-9._:-]{8,128}$/;
export const PUBLIC_API_VERSION = '2026-03-26';
export const PUBLIC_CORS_ALLOW_HEADERS = Object.freeze([
  'authorization',
  'content-type',
  'x-api-version',
  'x-correlation-id',
  'idempotency-key',
  'x-requested-with',
  'apikey',
  'x-api-key',
  'last-event-id',
  'x-request-id',
  'range',
  'if-match',
  'if-none-match',
  'x-origin-surface'
]);
export const PUBLIC_CORS_EXPOSE_HEADERS = Object.freeze([
  'x-correlation-id',
  'x-idempotency-replayed',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'content-range',
  'accept-ranges'
]);
const SENSITIVE_RE = /(stack|sqlstate|\bsql\b|select\s|insert\s|update\s|delete\s|https?:\/\/|token|password|secret|credential|authorization|bearer|postgres|mongodb)/i;
// Only server-owned classes already present in the public runtime surface may cross the boundary.
// Unknown provider, datastore, or attacker-controlled class-shaped values fall back by HTTP status.
const APPROVED_ERROR_CLASSES = new Set(`
  ACTION_NOT_FOUND ACTIVATION_NOT_FOUND API_KEYS_DISABLED APPLICATION_NOT_FOUND APPLICATION_SLUG_TAKEN
  API_VERSION_REQUIRED UNSUPPORTED_API_VERSION INVALID_CORRELATION_ID
  BACKUP_SCOPE_UNKNOWN_PROFILE
  AUDIT_EXPORT_BUILD_FAILED AUDIT_EXPORT_INVALID_FORMAT AUDIT_EXPORT_INVALID_TIME_WINDOW
  AUDIT_EXPORT_LIMIT_EXCEEDED AUDIT_EXPORT_QUERY_FAILED AUDIT_EXPORT_UNKNOWN_MASKING_PROFILE
  AUDIT_MISSING_CORRELATION_ID AUDIT_MISSING_TENANT_ID AUDIT_QUERY_INVALID AUDIT_SCOPE_VIOLATION
  AUTH_REFRESH_FORBIDDEN BUCKET_NOT_FOUND BYOK_ENDPOINT_BLOCKED CAPABILITY_NOT_ENTITLED
  CAPABILITY_RESOLUTION_DEGRADED CHECK_VIOLATION COLLECTION_NOT_FOUND CONSOLE_BACKEND_SCOPE_DENIED
  CONCURRENT_ASSIGNMENT_CONFLICT CONCURRENT_PLAN_LIMIT_CONFLICT CONSUME_FAILED CONTROL_PLANE_ERROR
  CREDENTIAL_REVOKED CROSS_TENANT_FORBIDDEN CROSS_TENANT_VIOLATION
  DATA_EXCEPTION DB_ALREADY_PROVISIONED DB_CONNECTION_ERROR DB_EXISTS DB_NOT_PROVISIONED DB_SHARED_MODE
  DB_UNAVAILABLE DDL_INVALID DIMENSION_NOT_FOUND DUPLICATE_OBJECT DUPLICATE_SCHEMA DUPLICATE_TABLE EMBEDDING_CONFIG
  EMBEDDING_DISABLED EMBEDDING_PROVIDER_ERROR EMBEDDING_PROVIDER_MISSING EMBEDDING_PROVIDER_NOT_FOUND
  EMBEDDING_SECRET_UNRESOLVED EMPTY_PUBLISH ENVIRONMENT_MISMATCH ETIMEDOUT EVENTS_DISABLED
  EXECUTION_NOT_FOUND EXECUTION_NOT_RUNNING EXECUTION_TOKEN_EXPIRED EXECUTION_TOKEN_INVALID
  EXECUTION_TOKEN_TENANT_MISMATCH EXPORT_MANIFEST_NOT_FOUND FLOWS_DISABLED FLOW_DEFINITION_INVALID FLOW_EXISTS
  FLOW_HAS_ACTIVE_EXECUTIONS FLOW_MONITORING_DISABLED FLOW_NOT_FOUND FLOW_SCHEDULING_DISABLED
  FLOW_VALIDATION_FAILED FN_DELETE_FAILED FN_DEPLOY_FAILED FN_ROLLBACK_DEPLOY_FAILED FORBIDDEN
  GRACE_MARGIN_REQUIRED_FOR_SOFT
  FOREIGN_KEY_VIOLATION FUNCTIONS_DISABLED FUNCTION_EXISTS FUNCTION_NOT_FOUND IAM_CONFLICT
  IAM_DEPENDENCY_FAILURE IAM_FORBIDDEN IAM_GET_REALM_FAILED IAM_INVALID_PAYLOAD IAM_NOT_FOUND
  IAM_PROVIDER_RATE_LIMITED IAM_PROVIDER_TIMEOUT IAM_UNSUPPORTED_PROVIDER_VERSION IAM_VALIDATION_FAILED
  IDENTITY_MISSING IMPORT_SCOPE_VIOLATION INSUFFICIENT_PRIVILEGE INSUFFICIENT_SCOPE INTERNAL_ERROR
  INVALID_CAPABILITY_KEY INVALID_DENIAL_TYPE INVALID_DIMENSION_KEY INVALID_ENVIRONMENT INVALID_FUNCTION
  INVALID_GRACE_MARGIN INVALID_IDENTIFIER INVALID_IMPORT_MANIFEST INVALID_INPUT INVALID_JSON INVALID_KEY_TYPE
  INVALID_LIMIT_VALUE INVALID_OBJECT_KEY INVALID_OVERRIDE_VALUE INVALID_PART_LIST INVALID_PART_NUMBER
  INVALID_PRESIGN_OPERATION INVALID_QUERY_JSON INVALID_REQUEST INVALID_ROLE INVALID_SIGNATURE INVALID_SLUG
  INVALID_SPEC INVALID_SUB_QUOTA_VALUE INVALID_TARGET_ACTION INVALID_TOKEN INVALID_TOPIC INVALID_TRANSITION
  INVALID_WORKSPACE INVALID_YAML KAFKA_ERROR KEY_NOT_FOUND LIMIT_NOT_SET LLM_CONFIG LLM_DISABLED LLM_PROVIDER_ERROR
  LLM_PROVIDER_MISSING LLM_PROVIDER_NOT_FOUND LLM_PROVIDER_SECRET_UNRESOLVED MAPPING_NOT_FOUND
  MAPPING_STORE_DISABLED MCP_DISABLED MCP_PUBLISH_REJECTED MCP_SERVER_NOT_CONNECTABLE MCP_SERVER_NOT_FOUND
  MCP_UNKNOWN_OPERATION MCP_VERSION_NOT_FOUND MCP_VERSION_REJECTED MODEL_NOT_ALLOWED MONGO_CONFLICT
  MONGO_DEPENDENCY_FAILURE MONGO_DISABLED MONGO_ERROR MONGO_EXPORT_FAILED MONGO_FORBIDDEN MONGO_IMPORT_FAILED
  MONGO_IMPORT_TOO_LARGE MONGO_INVALID_PAYLOAD MONGO_NOT_FOUND MONGO_PROVIDER_RATE_LIMITED
  LOCK_HELD LOCK_TIMEOUT MONGO_PROVIDER_TIMEOUT MONGO_PROVISION_FAILED MONGO_QUOTA_EXCEEDED MONGO_UNSUPPORTED_PROFILE
  MONGO_UNSUPPORTED_PROVIDER_VERSION MONGO_VALIDATION_FAILED NAME_REQUIRED NOT_FOUND NOT_IMPLEMENTED
  NOT_NULL_VIOLATION NO_CHANGES_SPECIFIED NO_HANDLER NO_REALM NO_ROUTE OBJECT_NOT_FOUND OVERRIDE_NOT_FOUND
  PGADM_CONFLICT PGADM_DEPENDENCY_FAILURE
  PGADM_FORBIDDEN PGADM_INVALID_PAYLOAD PGADM_NOT_FOUND PGADM_PROVIDER_TIMEOUT PGADM_QUOTA_EXCEEDED
  PGADM_UNSUPPORTED_PROFILE PGADM_UNSUPPORTED_PROVIDER_VERSION PGADM_VALIDATION_FAILED PG_COLUMNS_FAILED
  PG_DATABASE_NOT_FOUND PG_EXPORT_FAILED PG_IMPORT_FAILED PG_IMPORT_TOO_LARGE PG_INDEXES_FAILED
  PG_MATVIEWS_FAILED PG_POLICIES_FAILED PG_SCHEMAS_FAILED PG_SECURITY_FAILED PG_TABLES_FAILED PG_VIEWS_FAILED
  PLAN_ACTIVE PLAN_ARCHIVED PLAN_HAS_ACTIVE_ASSIGNMENTS PLAN_HAS_ASSIGNMENT_HISTORY PLAN_LIMITS_FROZEN
  PLAN_NOT_ACTIVE PLAN_NOT_FOUND PLAN_REJECTED PLAN_SLUG_CONFLICT PROVIDER_NOT_FOUND PROVISION_DB_FAILED
  PUBLISH_FAILED QUERY_WINDOW_EXCEEDED QUOTA_EXCEEDED RATE_LIMITED REALM_EXISTS
  REALM_NOT_FOUND REALTIME_DISABLED REQUEST_FAILED REQUEST_TOO_LARGE ROLE_NOT_FOUND ROLLBACK_STATE_CONFLICT
  ROTATE_DB_FAILED SAME_ENVIRONMENT SAME_WORKSPACE SA_EXISTS SA_NOT_FOUND SCHEDULE_NOT_FOUND SCHEMA_NOT_READY
  SECRETS_BACKEND_DISABLED SECRET_ALREADY_EXISTS SECRET_DELETE_FAILED SECRET_LIST_FAILED SECRET_NOT_FOUND
  SECRET_READ_FAILED SECRET_RESOLVE_FAILED SECRET_WRITE_FAILED SERVICE_UNAVAILABLE SLUG_TAKEN STATUS_VIEW_NOT_FOUND
  STORAGE_BUCKET_DELETE_FAILED STORAGE_CREDENTIAL_REVOKE_FAILED STORAGE_CREDENTIAL_ROTATE_FAILED
  STORAGE_DELETE_FAILED STORAGE_EXPORT_TOO_LARGE STORAGE_GET_FAILED STORAGE_IDENTITIES_DISABLED
  STORAGE_IMPORT_TOO_LARGE STORAGE_INVALID_BUCKET_NAME STORAGE_LIST_FAILED STORAGE_PROVISION_FAILED
  STORAGE_PUT_FAILED STORAGE_QUOTA_EXCEEDED STORAGE_RANGE_NOT_SATISFIABLE SUB_QUOTA_EXCEEDS_TENANT_LIMIT
  SUB_QUOTA_NOT_FOUND SYNTAX_OR_ACCESS TABLE_NOT_FOUND TARGET_WORKSPACE_NOT_FOUND TEMPORAL_UNAVAILABLE
  TENANT_ISOLATION_VIOLATION TENANT_NOT_FOUND TOKEN_MINT_INVALID TOPIC_NOT_FOUND
  TOPIC_PROVISION_FAILED TRIGGERS_DISABLED TRIGGER_REGISTRATION_FAILED TRIGGER_SECRET_KEY_UNCONFIGURED
  UNAUTHENTICATED UNAUTHORIZED UNDEFINED_COLUMN UNIQUE_VIOLATION UNKNOWN_OPERATION UNKNOWN_SIGNAL UNPROCESSABLE
  UNSUPPORTED_ACTION UNSUPPORTED_FIELD UNSUPPORTED_OPERATION UNSUPPORTED_RESOURCE UPSTREAM_TIMEOUT
  UPSTREAM_UNAVAILABLE USER_NOT_FOUND VALIDATION_ERROR VALUE_TOO_LARGE VERSION_NOT_ELIGIBLE VERSION_NOT_FOUND
  WORKSPACE_DB_UNRESOLVED WORKSPACE_DOCS_DISABLED WORKSPACE_MISSING WORKSPACE_NOT_FOUND WORKSPACE_SLUG_CONFLICT
`.trim().split(/\s+/));
const SAFE_DETAIL_KEYS = new Set([
  'capability',
  'code',
  'dimension',
  'errors',
  'field',
  'fieldPath',
  'message',
  'nodeId',
  'reason',
  'statusView',
  'statusViewId',
  'violations'
]);

function validId(pattern, ...candidates) {
  for (const candidate of candidates) {
    const value = String(candidate ?? '');
    if (pattern.test(value)) return value;
  }
  return randomUUID();
}

/** Normalize the externally supplied tracing boundary without reflecting attacker input. */
export function resolveCorrelationId(value) {
  const raw = String(value ?? '');
  return raw && CORRELATION_ID_RE.test(raw) ? raw : randomUUID();
}

export function validatePublicRequestHeaders(headers = {}) {
  const version = String(headers['x-api-version'] ?? '').trim();
  const hasCorrelation = Object.prototype.hasOwnProperty.call(headers, 'x-correlation-id');
  const correlation = String(headers['x-correlation-id'] ?? '').trim();
  if (!version) return { ok: false, status: 400, code: 'API_VERSION_REQUIRED' };
  if (version !== PUBLIC_API_VERSION) return { ok: false, status: 400, code: 'UNSUPPORTED_API_VERSION' };
  if (hasCorrelation && !CORRELATION_ID_RE.test(correlation)) {
    return { ok: false, status: 400, code: 'INVALID_CORRELATION_ID' };
  }
  return { ok: true, correlationId: resolveCorrelationId(correlation), apiVersion: PUBLIC_API_VERSION };
}

export function withCorrelationResponseHeader(headers = {}, correlationId) {
  const normalized = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (name.toLowerCase() === 'x-correlation-id') continue;
    normalized[name] = value;
  }
  if (correlationId) normalized['x-correlation-id'] = correlationId;
  return normalized;
}

function safeString(value, maxLength = 512) {
  const text = String(value ?? '');
  if (!text || SENSITIVE_RE.test(text)) return null;
  return text.slice(0, maxLength);
}

function sanitizeDetailValue(value, depth = 0) {
  if (depth > 2 || value == null) return undefined;
  if (typeof value === 'string') return safeString(value, 512) ?? undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value
      .slice(0, 20)
      .map((entry) => sanitizeDetailValue(entry, depth + 1))
      .filter((entry) => entry !== undefined);
  }
  if (typeof value !== 'object') return undefined;

  const sanitized = {};
  for (const [key, entry] of Object.entries(value).slice(0, 20)) {
    if (!SAFE_DETAIL_KEYS.has(key) || SENSITIVE_RE.test(key)) continue;
    const clean = sanitizeDetailValue(entry, depth + 1);
    if (clean !== undefined) sanitized[key] = clean;
  }
  return sanitized;
}

function buildDetail(source, rawCode, status) {
  if (status >= 500) return {};
  if (status === 403) return { reason: 'FORBIDDEN' };

  const detail = {};
  if (typeof source.detail === 'string') {
    const reason = safeString(source.detail);
    if (reason) detail.reason = reason;
  } else if (source.detail && typeof source.detail === 'object') {
    Object.assign(detail, sanitizeDetailValue(source.detail));
  }

  const errors = sanitizeDetailValue(source.errors);
  if (Array.isArray(errors) && errors.length > 0) {
    detail.errors = errors;
    const violations = errors
      .map((entry) => typeof entry === 'string' ? entry : entry?.message ?? entry?.fieldPath)
      .filter((entry) => typeof entry === 'string' && entry.length > 0);
    if (violations.length > 0) detail.violations = violations;
  }

  for (const key of ['dimension', 'field', 'statusView', 'statusViewId']) {
    const clean = sanitizeDetailValue(source[key]);
    if (clean !== undefined) detail[key] = clean;
  }

  if (!detail.reason) detail.reason = rawCode;
  return detail;
}

function publicMessage(status) {
  if (status >= 500) return 'Internal server error';
  const messages = {
    400: 'Invalid request',
    401: 'Authentication required',
    403: 'Request forbidden',
    404: 'Resource not found',
    405: 'Method not allowed',
    409: 'Request conflict',
    413: 'Request too large',
    422: 'Request could not be processed',
    429: 'Too many requests'
  };
  return messages[status] ?? 'Request failed';
}

function safeResourcePath(resource) {
  const value = String(resource ?? '/')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .split(/[?#]/, 1)[0]
    .slice(0, 512);
  if (!value.startsWith('/')) return '/';
  return value.split('/').map((segment) => {
    let decoded = segment;
    try { decoded = decodeURIComponent(segment); } catch {}
    const idLike =
      /^(?:tenant|ten|tnt|workspace|wrk|ws|resource|res|flow|flw|execution|exec|run|user|usr|key|secret|token|server|srv|operation|op|environment|env)[._:-].+/i.test(decoded)
      || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(decoded)
      || /^\d+$/.test(decoded)
      || decoded.includes(':')
      || decoded.length > 64;
    return idLike ? '{id}' : segment;
  }).join('/');
}

export function normalizeErrorResponse(statusCode, input = {}, context = {}) {
  const status = Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599 ? statusCode : 500;
  const source = input && typeof input === 'object' ? input : {};
  const genericClass = {
    400: 'INVALID_REQUEST',
    401: 'UNAUTHENTICATED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    405: 'METHOD_NOT_ALLOWED',
    409: 'CONFLICT',
    413: 'REQUEST_TOO_LARGE',
    422: 'UNPROCESSABLE',
    429: 'RATE_LIMITED'
  }[status] ?? 'REQUEST_FAILED';
  const sourceCode = String(source.code ?? (typeof source.error === 'string' ? source.error : '')).trim();
  const classShaped = /^(?:GW_)?[A-Z][A-Z0-9_]{0,95}$/.test(sourceCode);
  const sourceClass = sourceCode.replace(/^GW_/, '');
  const rawCode = classShaped && APPROVED_ERROR_CLASSES.has(sourceClass)
    ? sourceClass
    : (sourceCode ? genericClass : 'CONTROL_PLANE_ERROR');
  const publicClass = status === 403 ? genericClass : rawCode;
  const code = status >= 500
    ? ({
        500: 'GW_CONTROL_PLANE_ERROR',
        501: 'GW_NOT_IMPLEMENTED',
        502: 'GW_UPSTREAM_UNAVAILABLE',
        503: 'GW_SERVICE_UNAVAILABLE',
        504: 'GW_UPSTREAM_TIMEOUT'
      }[status] ?? 'GW_CONTROL_PLANE_ERROR')
    : `GW_${publicClass.slice(0, 96) || 'ERROR'}`;
  const envelope = {
    status,
    code,
    message: publicMessage(status),
    detail: buildDetail(source, publicClass.replace(/^GW_/, ''), status),
    requestId: validId(REQUEST_ID_RE, context.requestId),
    correlationId: validId(CORRELATION_ID_RE, context.correlationId),
    timestamp: new Date().toISOString(),
    resource: { path: safeResourcePath(context.resource ?? source.resource?.path) }
  };
  if (typeof source.retryable === 'boolean') envelope.retryable = source.retryable;
  return envelope;
}
