export const STORAGE_ERROR_RETRYABILITY = Object.freeze({
  RETRYABLE: 'retryable',
  NOT_RETRYABLE: 'not_retryable',
  CONDITIONALLY_RETRYABLE: 'conditionally_retryable'
});

export const STORAGE_NORMALIZED_ERROR_CODES = Object.freeze({
  OBJECT_NOT_FOUND: 'OBJECT_NOT_FOUND',
  BUCKET_NOT_FOUND: 'BUCKET_NOT_FOUND',
  BUCKET_ALREADY_EXISTS: 'BUCKET_ALREADY_EXISTS',
  OBJECT_ALREADY_EXISTS: 'OBJECT_ALREADY_EXISTS',
  STORAGE_ACCESS_DENIED: 'STORAGE_ACCESS_DENIED',
  STORAGE_QUOTA_EXCEEDED: 'STORAGE_QUOTA_EXCEEDED',
  STORAGE_OBJECT_TOO_LARGE: 'STORAGE_OBJECT_TOO_LARGE',
  STORAGE_PROVIDER_UNAVAILABLE: 'STORAGE_PROVIDER_UNAVAILABLE',
  STORAGE_PROVIDER_TIMEOUT: 'STORAGE_PROVIDER_TIMEOUT',
  STORAGE_PROVIDER_CONTRACT_VIOLATION: 'STORAGE_PROVIDER_CONTRACT_VIOLATION',
  STORAGE_INVALID_REQUEST: 'STORAGE_INVALID_REQUEST',
  STORAGE_PRECONDITION_FAILED: 'STORAGE_PRECONDITION_FAILED',
  STORAGE_UNKNOWN_ERROR: 'STORAGE_UNKNOWN_ERROR'
});

export const STORAGE_USAGE_ERROR_CODES = Object.freeze({
  USAGE_SCOPE_NOT_FOUND: 'USAGE_SCOPE_NOT_FOUND',
  USAGE_PROVIDER_UNAVAILABLE: 'USAGE_PROVIDER_UNAVAILABLE',
  USAGE_INVALID_SCOPE: 'USAGE_INVALID_SCOPE',
  USAGE_UNAUTHORIZED: 'USAGE_UNAUTHORIZED'
});

const STORAGE_ERROR_DEFINITIONS = Object.freeze({
  [STORAGE_NORMALIZED_ERROR_CODES.OBJECT_NOT_FOUND]: Object.freeze({
    code: STORAGE_NORMALIZED_ERROR_CODES.OBJECT_NOT_FOUND,
    messageTemplate: 'The requested storage object was not found.',
    httpStatus: 404,
    retryability: STORAGE_ERROR_RETRYABILITY.NOT_RETRYABLE
  }),
  [STORAGE_NORMALIZED_ERROR_CODES.BUCKET_NOT_FOUND]: Object.freeze({
    code: STORAGE_NORMALIZED_ERROR_CODES.BUCKET_NOT_FOUND,
    messageTemplate: 'The requested storage bucket was not found.',
    httpStatus: 404,
    retryability: STORAGE_ERROR_RETRYABILITY.NOT_RETRYABLE
  }),
  [STORAGE_NORMALIZED_ERROR_CODES.BUCKET_ALREADY_EXISTS]: Object.freeze({
    code: STORAGE_NORMALIZED_ERROR_CODES.BUCKET_ALREADY_EXISTS,
    messageTemplate: 'The storage bucket already exists.',
    httpStatus: 409,
    retryability: STORAGE_ERROR_RETRYABILITY.NOT_RETRYABLE
  }),
  [STORAGE_NORMALIZED_ERROR_CODES.OBJECT_ALREADY_EXISTS]: Object.freeze({
    code: STORAGE_NORMALIZED_ERROR_CODES.OBJECT_ALREADY_EXISTS,
    messageTemplate: 'The storage object already exists for the requested precondition.',
    httpStatus: 409,
    retryability: STORAGE_ERROR_RETRYABILITY.NOT_RETRYABLE
  }),
  [STORAGE_NORMALIZED_ERROR_CODES.STORAGE_ACCESS_DENIED]: Object.freeze({
    code: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_ACCESS_DENIED,
    messageTemplate: 'The storage provider denied the requested operation.',
    httpStatus: 403,
    retryability: STORAGE_ERROR_RETRYABILITY.NOT_RETRYABLE
  }),
  [STORAGE_NORMALIZED_ERROR_CODES.STORAGE_QUOTA_EXCEEDED]: Object.freeze({
    code: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_QUOTA_EXCEEDED,
    messageTemplate: 'The storage quota would be exceeded by this operation.',
    httpStatus: 409,
    retryability: STORAGE_ERROR_RETRYABILITY.NOT_RETRYABLE
  }),
  [STORAGE_NORMALIZED_ERROR_CODES.STORAGE_OBJECT_TOO_LARGE]: Object.freeze({
    code: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_OBJECT_TOO_LARGE,
    messageTemplate: 'The object exceeds the provider-supported maximum object size.',
    httpStatus: 413,
    retryability: STORAGE_ERROR_RETRYABILITY.NOT_RETRYABLE
  }),
  [STORAGE_NORMALIZED_ERROR_CODES.STORAGE_PROVIDER_UNAVAILABLE]: Object.freeze({
    code: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_PROVIDER_UNAVAILABLE,
    messageTemplate: 'The storage provider is temporarily unavailable.',
    httpStatus: 503,
    retryability: STORAGE_ERROR_RETRYABILITY.RETRYABLE
  }),
  [STORAGE_NORMALIZED_ERROR_CODES.STORAGE_PROVIDER_TIMEOUT]: Object.freeze({
    code: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_PROVIDER_TIMEOUT,
    messageTemplate: 'The storage provider did not respond before the configured timeout.',
    httpStatus: 504,
    retryability: STORAGE_ERROR_RETRYABILITY.CONDITIONALLY_RETRYABLE
  }),
  [STORAGE_NORMALIZED_ERROR_CODES.STORAGE_PROVIDER_CONTRACT_VIOLATION]: Object.freeze({
    code: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_PROVIDER_CONTRACT_VIOLATION,
    messageTemplate: 'The storage provider returned an unexpected response shape.',
    httpStatus: 502,
    retryability: STORAGE_ERROR_RETRYABILITY.NOT_RETRYABLE
  }),
  [STORAGE_NORMALIZED_ERROR_CODES.STORAGE_INVALID_REQUEST]: Object.freeze({
    code: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_INVALID_REQUEST,
    messageTemplate: 'The storage request is invalid for the requested operation.',
    httpStatus: 400,
    retryability: STORAGE_ERROR_RETRYABILITY.NOT_RETRYABLE
  }),
  [STORAGE_NORMALIZED_ERROR_CODES.STORAGE_PRECONDITION_FAILED]: Object.freeze({
    code: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_PRECONDITION_FAILED,
    messageTemplate: 'The storage request precondition was not satisfied.',
    httpStatus: 412,
    retryability: STORAGE_ERROR_RETRYABILITY.NOT_RETRYABLE
  }),
  [STORAGE_NORMALIZED_ERROR_CODES.STORAGE_UNKNOWN_ERROR]: Object.freeze({
    code: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_UNKNOWN_ERROR,
    messageTemplate: 'The storage provider returned an unknown error.',
    httpStatus: 500,
    retryability: STORAGE_ERROR_RETRYABILITY.CONDITIONALLY_RETRYABLE
  })
});

const PROVIDER_ERROR_CODE_ALIASES = Object.freeze({
  OBJECT_NOT_FOUND: STORAGE_NORMALIZED_ERROR_CODES.OBJECT_NOT_FOUND,
  NO_SUCH_KEY: STORAGE_NORMALIZED_ERROR_CODES.OBJECT_NOT_FOUND,
  NOSUCHKEY: STORAGE_NORMALIZED_ERROR_CODES.OBJECT_NOT_FOUND,
  BUCKET_NOT_FOUND: STORAGE_NORMALIZED_ERROR_CODES.BUCKET_NOT_FOUND,
  NO_SUCH_BUCKET: STORAGE_NORMALIZED_ERROR_CODES.BUCKET_NOT_FOUND,
  NOSUCHBUCKET: STORAGE_NORMALIZED_ERROR_CODES.BUCKET_NOT_FOUND,
  BUCKET_ALREADY_EXISTS: STORAGE_NORMALIZED_ERROR_CODES.BUCKET_ALREADY_EXISTS,
  BUCKETALREADYEXISTS: STORAGE_NORMALIZED_ERROR_CODES.BUCKET_ALREADY_EXISTS,
  BUCKET_ALREADY_OWNED_BY_YOU: STORAGE_NORMALIZED_ERROR_CODES.BUCKET_ALREADY_EXISTS,
  BUCKETALREADYOWNEDBYYOU: STORAGE_NORMALIZED_ERROR_CODES.BUCKET_ALREADY_EXISTS,
  OBJECT_ALREADY_EXISTS: STORAGE_NORMALIZED_ERROR_CODES.OBJECT_ALREADY_EXISTS,
  PRECONDITION_FAILED: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_PRECONDITION_FAILED,
  PRECONDITIONFAILED: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_PRECONDITION_FAILED,
  ACCESS_DENIED: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_ACCESS_DENIED,
  ACCESSDENIED: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_ACCESS_DENIED,
  INVALID_ACCESS_KEY_ID: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_ACCESS_DENIED,
  INVALIDACCESSKEYID: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_ACCESS_DENIED,
  SIGNATURE_DOES_NOT_MATCH: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_ACCESS_DENIED,
  SIGNATUREDOESNOTMATCH: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_ACCESS_DENIED,
  QUOTA_EXCEEDED: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_QUOTA_EXCEEDED,
  ENTITY_TOO_LARGE: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_OBJECT_TOO_LARGE,
  ENTITYTOOLARGE: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_OBJECT_TOO_LARGE,
  REQUEST_TIMEOUT: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_PROVIDER_TIMEOUT,
  REQUESTTIMEOUT: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_PROVIDER_TIMEOUT,
  TIMEOUT_ERROR: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_PROVIDER_TIMEOUT,
  TIMEOUTERROR: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_PROVIDER_TIMEOUT,
  TIMED_OUT: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_PROVIDER_TIMEOUT,
  CONTRACT_VIOLATION: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_PROVIDER_CONTRACT_VIOLATION,
  MALFORMED_RESPONSE: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_PROVIDER_CONTRACT_VIOLATION,
  INVALID_BUCKET_NAME: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_INVALID_REQUEST,
  INVALID_OBJECT_KEY: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_INVALID_REQUEST,
  INVALID_WORKSPACE_SCOPE: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_INVALID_REQUEST,
  INVALID_APPLICATION_SCOPE: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_INVALID_REQUEST,
  RESERVED_PREFIX_CONFLICT: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_PRECONDITION_FAILED,
  CONTEXT_INACTIVE: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_PRECONDITION_FAILED,
  CAPABILITY_UNAVAILABLE: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_PRECONDITION_FAILED,
  BUCKET_NOT_EMPTY: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_PRECONDITION_FAILED,
  BUCKET_PROTECTED: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_PRECONDITION_FAILED,
  MISSING_PROVIDER_TYPE: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_PROVIDER_UNAVAILABLE,
  UNKNOWN_PROVIDER_TYPE: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_PROVIDER_UNAVAILABLE,
  AMBIGUOUS_PROVIDER_SELECTION: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_PROVIDER_CONTRACT_VIOLATION,
  STORAGE_UNAVAILABLE: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_PROVIDER_UNAVAILABLE,
  PROVIDER_UNAVAILABLE: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_PROVIDER_UNAVAILABLE
});

function normalizeProviderCode(value) {
  if (typeof value !== 'string') {
    return null;
  }

  return value.trim().replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase() || null;
}

function shouldClassifyAsUnavailable(httpStatus) {
  return [500, 502, 503].includes(httpStatus);
}

function buildOperationContext(input = {}) {
  return {
    requestId: input.requestId ?? null,
    tenantId: input.tenantId ?? null,
    workspaceId: input.workspaceId ?? null,
    operation: input.operation ?? input.operationType ?? 'storage.operation',
    bucketName: input.bucketName ?? null,
    objectKey: input.objectKey ?? null
  };
}

function sanitizeDiagnosticString(value) {
  if (typeof value !== 'string') {
    return null;
  }

  return value
    .replace(/https?:\/\/\S+/gi, '[redacted-url]')
    .replace(/secret:\/\/\S+/gi, '[redacted-secret-ref]')
    .replace(/(access|secret|session)[-_ ]?key\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .trim() || null;
}

function buildInternalDiagnostics(input = {}) {
  const providerCode = normalizeProviderCode(input.providerCode ?? input.errorCode ?? input.nativeCode ?? input.code);
  const providerMessage = sanitizeDiagnosticString(input.providerMessage ?? input.message ?? null);

  if (!providerCode && !providerMessage && input.httpStatus == null) {
    return null;
  }

  return {
    providerCode,
    providerMessage,
    providerHttpStatus: input.httpStatus ?? null
  };
}

export function getStorageNormalizedErrorDefinition(code) {
  return STORAGE_ERROR_DEFINITIONS[code] ?? STORAGE_ERROR_DEFINITIONS[STORAGE_NORMALIZED_ERROR_CODES.STORAGE_UNKNOWN_ERROR];
}

export function listStorageNormalizedErrorDefinitions() {
  return Object.values(STORAGE_ERROR_DEFINITIONS).map((definition) => ({ ...definition }));
}

export function resolveStorageNormalizedErrorCode(input = {}) {
  if (input.normalizedCode && STORAGE_ERROR_DEFINITIONS[input.normalizedCode]) {
    return input.normalizedCode;
  }

  const providerCode = normalizeProviderCode(input.providerCode ?? input.errorCode ?? input.nativeCode ?? input.code);
  if (providerCode && PROVIDER_ERROR_CODE_ALIASES[providerCode]) {
    return PROVIDER_ERROR_CODE_ALIASES[providerCode];
  }

  const httpStatus = Number.isInteger(input.httpStatus) ? input.httpStatus : null;
  if (httpStatus === 404) {
    return STORAGE_NORMALIZED_ERROR_CODES.BUCKET_NOT_FOUND;
  }
  if (httpStatus === 403) {
    return STORAGE_NORMALIZED_ERROR_CODES.STORAGE_ACCESS_DENIED;
  }
  if (httpStatus === 408 || httpStatus === 504) {
    return STORAGE_NORMALIZED_ERROR_CODES.STORAGE_PROVIDER_TIMEOUT;
  }
  if (shouldClassifyAsUnavailable(httpStatus)) {
    return STORAGE_NORMALIZED_ERROR_CODES.STORAGE_PROVIDER_UNAVAILABLE;
  }
  if (httpStatus === 412) {
    return STORAGE_NORMALIZED_ERROR_CODES.STORAGE_PRECONDITION_FAILED;
  }
  if (httpStatus === 413) {
    return STORAGE_NORMALIZED_ERROR_CODES.STORAGE_OBJECT_TOO_LARGE;
  }
  if (httpStatus === 400) {
    return STORAGE_NORMALIZED_ERROR_CODES.STORAGE_INVALID_REQUEST;
  }

  return STORAGE_NORMALIZED_ERROR_CODES.STORAGE_UNKNOWN_ERROR;
}

export function buildNormalizedStorageError(input = {}) {
  const normalizedCode = resolveStorageNormalizedErrorCode(input);
  const definition = getStorageNormalizedErrorDefinition(normalizedCode);
  const operationContext = buildOperationContext(input);

  return {
    code: normalizedCode,
    message: input.publicMessage ?? definition.messageTemplate,
    httpStatus: definition.httpStatus,
    retryability: definition.retryability,
    operationContext,
    observedAt: input.observedAt ?? '2026-03-27T00:00:00Z'
  };
}

export function buildStorageErrorEnvelope(input = {}) {
  return {
    error: buildNormalizedStorageError(input)
  };
}

export function buildStorageInternalErrorRecord(input = {}) {
  const normalizedError = buildNormalizedStorageError(input);
  const diagnostics = buildInternalDiagnostics(input);

  return {
    ...normalizedError,
    ...(diagnostics ? { diagnostics } : {})
  };
}

export function buildStorageErrorAuditEvent(input = {}) {
  const normalizedError = buildNormalizedStorageError(input);

  return {
    eventType: 'storage.error.normalized',
    entityType: 'storage_error',
    tenantId: normalizedError.operationContext.tenantId,
    workspaceId: normalizedError.operationContext.workspaceId,
    bucketName: normalizedError.operationContext.bucketName,
    objectKey: normalizedError.operationContext.objectKey,
    operation: normalizedError.operationContext.operation,
    errorCode: normalizedError.code,
    retryability: normalizedError.retryability,
    httpStatus: normalizedError.httpStatus,
    auditEnvelope: {
      requestId: normalizedError.operationContext.requestId,
      correlationId: input.correlationId ?? normalizedError.operationContext.requestId ?? null,
      outcome: 'error',
      occurredAt: normalizedError.observedAt
    },
    ...(input.providerType ? { providerType: input.providerType } : {})
  };
}
