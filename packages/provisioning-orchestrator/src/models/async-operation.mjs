import { randomUUID } from 'node:crypto';
import { isProxy } from 'node:util/types';
import { CANCELLABLE_STATES, TERMINAL_STATES, validateTransition } from './async-operation-states.mjs';

const REQUIRED_CREATE_FIELDS = Object.freeze(['tenant_id', 'actor_id', 'actor_type', 'operation_type']);
const ACTOR_TYPES = new Set(['workspace_admin', 'tenant_owner', 'superadmin', 'tenant_member']);
const CORRELATION_ID_PATTERN = /^[a-z]+:[A-Za-z0-9_-]+:[0-9a-z]+:[a-f0-9]{8}$/;
const SENSITIVE_MESSAGE_PATTERNS = [
  /postgres(?:ql)?:\/\//i,
  /mongodb(?:\+srv)?:\/\//i,
  /(?:api[_-]?key|token|secret|password)\s*[=:]/i,
  /(?:\/[^\s]+){2,}/,
  /\bat\s+.+\(.+\)/
];
const SENSITIVE_RESULT_KEYS = new Set([
  'accesskey',
  'accesskeyid',
  'apikey',
  'auth',
  'authheader',
  'authorization',
  'connectionstring',
  'cookie',
  'credential',
  'credentials',
  'githubpat',
  'password',
  'privatekey',
  'refreshtoken',
  'secret',
  'secretaccesskey',
  'stack',
  'stacktrace',
  'token'
]);
const SENSITIVE_RESULT_KEY_SUFFIX =
  /(?:accesskey(?:id|value)?|apikey(?:id|value)?|authorization(?:header|value)?|connectionstring(?:value)?|cookie(?:value)?|credential(?:s|id|value|material(?:id|value)?)?|githubpat(?:value)?|passphrase(?:value)?|passwd(?:value)?|password(?:hash|value)?|privatekey(?:value)?|pwd(?:value)?|refreshtoken(?:value)?|secret(?:accesskey|key|value)?|stack(?:trace)?|token(?:id|value)?)$/;
const SENSITIVE_RESULT_VALUE_PATTERNS = [
  /\b(?:postgres(?:ql)?|mongodb(?:\+srv)?|mysql|mariadb|redis|amqps?):\/\/\S+/i,
  /\bhttps?:\/\/[^/\s:@]+:[^/\s@]+@/i,
  /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/,
  /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password)\s*[=:]\s*\S+/i,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|sk-(?:live|proj|test)-[A-Za-z0-9_-]{16,})\b/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /(?:^|\n)\s*at\s+.+(?:\(.+\)|:\d+:\d+)/,
  /(?:^|\n)\s*Traceback \(most recent call last\):/i,
  /(?:^|\n)\s*File\s+["'][^"'\n]+["'],\s+line\s+\d+/i,
  /(?:^|[\s"'(=:])(?:\/(?:home|root|etc|var|usr|opt|tmp|srv|app|repo|workspace)\/|\/run\/secrets(?:\/|$)|[A-Za-z]:\\(?:Users|Windows|Program Files)\\)/,
  /(?:^|[\s"'(=:])(?:\.\.?[\\/])*(?:apps|packages|scripts|tests|deploy|openspec)[\\/][A-Za-z0-9._@/\\-]+(?::\d+(?::\d+)?)?/i,
  /\bfile:\/\/\/(?:home|root|etc|var|usr|opt|tmp|srv|app|repo|workspace)\//i
];
const MAX_RESULT_DEPTH = 8;
const MAX_RESULT_BYTES = 32 * 1024;
const UNSAFE_RESULT_STRUCTURE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SAFE_BEARER_PROSE_WORDS = new Set([
  'authentication',
  'authorization',
  'credential',
  'credentials',
  'documentation',
  'scheme',
  'support',
  'token',
  'tokens'
]);
const MAX_ERROR_CODE_BYTES = 128;
const MAX_FAILED_STEP_BYTES = 256;
const SAFE_JSON_STRINGIFY = JSON.stringify;
const SAFE_JSON_PARSE = JSON.parse;

export function createOperation(input = {}) {
  for (const field of REQUIRED_CREATE_FIELDS) {
    if (!input[field]) {
      throw Object.assign(new Error(`Missing required field: ${field}`), {
        code: 'VALIDATION_ERROR',
        field
      });
    }
  }

  if (!ACTOR_TYPES.has(input.actor_type)) {
    throw Object.assign(new Error(`Invalid actor_type: ${input.actor_type}`), {
      code: 'VALIDATION_ERROR',
      field: 'actor_type'
    });
  }

  if (input.max_retries !== undefined && input.max_retries !== null) {
    const maxRetries = Number(input.max_retries);
    if (!Number.isInteger(maxRetries) || maxRetries < 1) {
      throw Object.assign(new Error('max_retries must be an integer greater than or equal to 1'), {
        code: 'VALIDATION_ERROR',
        field: 'max_retries'
      });
    }
  }

  const now = new Date().toISOString();

  return {
    operation_id: input.operation_id ?? randomUUID(),
    tenant_id: input.tenant_id,
    actor_id: input.actor_id,
    actor_type: input.actor_type,
    workspace_id: input.workspace_id ?? null,
    operation_type: input.operation_type,
    status: input.status ?? 'pending',
    error_summary: input.error_summary ?? null,
    cancellation_reason: input.cancellation_reason ?? null,
    cancelled_by: input.cancelled_by ?? null,
    timeout_policy_snapshot: input.timeout_policy_snapshot ? structuredClone(input.timeout_policy_snapshot) : null,
    policy_applied_at: input.policy_applied_at ?? null,
    correlation_id: input.correlation_id ?? generateCorrelationId(input.tenant_id),
    idempotency_key: input.idempotency_key ?? null,
    saga_id: input.saga_id ?? null,
    attempt_count: Number.isInteger(input.attempt_count) ? input.attempt_count : 0,
    max_retries: input.max_retries ?? null,
    result: null,
    completed_at: null,
    created_at: input.created_at ?? now,
    updated_at: input.updated_at ?? now
  };
}

export function applyTransition(operation, input = {}) {
  if (!operation?.status) {
    throw Object.assign(new Error('operation.status is required'), {
      code: 'VALIDATION_ERROR',
      field: 'status'
    });
  }

  if (!input.new_status) {
    throw Object.assign(new Error('new_status is required'), {
      code: 'VALIDATION_ERROR',
      field: 'new_status'
    });
  }

  validateTransition(operation.status, input.new_status);

  const updatedAt = new Date().toISOString();
  const isTerminal = TERMINAL_STATES.has(input.new_status);
  const errorSummary = input.new_status === 'failed'
    ? normalizeErrorSummary(input.error_summary)
    : null;
  const nextOperation = {
    ...operation,
    status: input.new_status,
    error_summary: errorSummary,
    cancellation_reason: input.new_status === 'timed_out'
      ? 'timeout exceeded'
      : (input.new_status === 'cancelling' ? input.cancellation_reason ?? null : operation.cancellation_reason ?? null),
    cancelled_by: input.new_status === 'cancelling' ? input.cancelled_by ?? null : operation.cancelled_by ?? null,
    result: input.new_status === 'completed' ? normalizeOperationResult(input.result) : null,
    completed_at: isTerminal ? updatedAt : null,
    updated_at: updatedAt
  };

  return nextOperation;
}

export function isCancellable(status) {
  return CANCELLABLE_STATES.has(status);
}

export function generateCorrelationId(tenantId) {
  const ts = Date.now().toString(36);
  const randomSuffix = randomUUID().replace(/-/g, '').slice(0, 8);
  return `op:${tenantId}:${ts}:${randomSuffix}`;
}

export function isValidCorrelationId(value) {
  return CORRELATION_ID_PATTERN.test(value);
}

export function normalizeErrorSummary(errorSummary) {
  if (!errorSummary || typeof errorSummary !== 'object') {
    throw Object.assign(new Error('error_summary is required when transitioning to failed'), {
      code: 'VALIDATION_ERROR',
      field: 'error_summary'
    });
  }
  if (isProxy(errorSummary)) {
    throw Object.assign(new Error('error_summary must not be a Proxy object'), {
      code: 'VALIDATION_ERROR',
      field: 'error_summary'
    });
  }
  if (snapshotSerializationHooks().some(([, descriptor]) => descriptor)) {
    throw Object.assign(new Error('error_summary serialization environment contains an inherited toJSON hook'), {
      code: 'VALIDATION_ERROR',
      field: 'error_summary'
    });
  }

  const canonical = {};
  for (const field of ['code', 'message', 'failedStep']) {
    const descriptor = Object.getOwnPropertyDescriptor(errorSummary, field);
    if (descriptor && (!descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value'))) {
      throw Object.assign(new Error(`error_summary.${field} must be an enumerable data property`), {
        code: 'VALIDATION_ERROR',
        field: `error_summary.${field}`
      });
    }
    canonical[field] = descriptor?.value;
  }

  validateCanonicalErrorSummary(canonical);
  return {
    code: canonical.code,
    message: canonical.message.trim(),
    failedStep: canonical.failedStep ?? null
  };
}

export function validateErrorSummary(errorSummary) {
  normalizeErrorSummary(errorSummary);
}

function validateCanonicalErrorSummary(errorSummary) {
  if (!errorSummary.code || !errorSummary.message) {
    throw Object.assign(new Error('error_summary.code and error_summary.message are required'), {
      code: 'VALIDATION_ERROR',
      field: 'error_summary'
    });
  }

  if (
    typeof errorSummary.message !== 'string'
    || errorSummary.message.trim().length === 0
    || SENSITIVE_MESSAGE_PATTERNS.some((pattern) => pattern.test(errorSummary.message))
    || containsSensitiveResultValue(errorSummary.message)
    || errorSummary.message.includes('\u0000')
    || hasUnpairedSurrogate(errorSummary.message)
  ) {
    throw Object.assign(new Error('error_summary.message contains sensitive content'), {
      code: 'VALIDATION_ERROR',
      field: 'error_summary.message'
    });
  }

  if (
    typeof errorSummary.code !== 'string'
    || errorSummary.code.trim().length === 0
    || Buffer.byteLength(errorSummary.code, 'utf8') > MAX_ERROR_CODE_BYTES
    || containsSensitiveResultValue(errorSummary.code)
    || errorSummary.code.includes('\u0000')
    || hasUnpairedSurrogate(errorSummary.code)
  ) {
    throw Object.assign(new Error('error_summary.code contains unsafe content'), {
      code: 'VALIDATION_ERROR',
      field: 'error_summary.code'
    });
  }

  if (
    errorSummary.failedStep != null
    && (
      typeof errorSummary.failedStep !== 'string'
      || Buffer.byteLength(errorSummary.failedStep, 'utf8') > MAX_FAILED_STEP_BYTES
      || containsSensitiveResultValue(errorSummary.failedStep)
      || errorSummary.failedStep.includes('\u0000')
      || hasUnpairedSurrogate(errorSummary.failedStep)
    )
  ) {
    throw Object.assign(new Error('error_summary.failedStep contains unsafe content'), {
      code: 'VALIDATION_ERROR',
      field: 'error_summary.failedStep'
    });
  }
}

function invalidResult(message) {
  return Object.assign(new Error(message), {
    code: 'VALIDATION_ERROR',
    field: 'result'
  });
}

function containsAuthorizationCredential(value) {
  const bearerMatches = value.matchAll(/\bBearer[ \t]+([A-Za-z0-9._~+/-]+=*)/gi);
  for (const match of bearerMatches) {
    const token = match[1];
    const precedingText = value.slice(0, match.index).trimEnd();
    const followingText = value.slice(match.index + match[0].length);
    const isAuthorizationHeader = /(?:^|\b)Authorization\s*:\s*$/i.test(precedingText);
    const isUnambiguousProse = !isAuthorizationHeader
      && SAFE_BEARER_PROSE_WORDS.has(token.toLowerCase())
      && /^[ \t]+\p{L}/u.test(followingText);
    if (!isUnambiguousProse) return true;
  }

  const basicMatches = value.matchAll(/\bBasic[ \t]+([A-Za-z0-9+/]+={0,2})/gi);
  for (const match of basicMatches) {
    const token = match[1];
    if (token.length < 4 || token.length % 4 === 1) continue;
    try {
      const unpadded = token.replace(/=+$/, '');
      const padded = unpadded.padEnd(Math.ceil(unpadded.length / 4) * 4, '=');
      const decodedBuffer = Buffer.from(padded, 'base64');
      if (decodedBuffer.toString('base64').replace(/=+$/, '') !== unpadded) continue;
      const decoded = decodedBuffer.toString('utf8');
      if (decoded.includes(':')) return true;
    } catch {
      // An invalid base64 candidate is prose, not a credential.
    }
  }

  return false;
}

function hasUnpairedSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || next < 0xDC00 || next > 0xDFFF) return true;
      index += 1;
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      return true;
    }
  }
  return false;
}

function containsSensitiveResultValue(value) {
  return containsAuthorizationCredential(value)
    || SENSITIVE_RESULT_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

function normalizeResultValue(value, seen, depth = 0) {
  if (depth > MAX_RESULT_DEPTH) {
    throw invalidResult(`result exceeds the maximum depth of ${MAX_RESULT_DEPTH}`);
  }

  if (value === null || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw invalidResult('result numbers must be finite');
    }
    return value;
  }

  if (typeof value === 'string') {
    if (value.includes('\u0000') || hasUnpairedSurrogate(value)) {
      throw invalidResult('result contains text that PostgreSQL JSONB cannot represent');
    }
    if (containsSensitiveResultValue(value)) {
      throw invalidResult('result contains sensitive or internal content');
    }
    return value;
  }

  if (typeof value !== 'object') {
    throw invalidResult('result must be JSON-compatible');
  }

  if (isProxy(value)) {
    throw invalidResult('result must not contain Proxy objects');
  }

  if (seen.has(value)) {
    throw invalidResult('result must not contain circular references');
  }
  seen.add(value);

  if (Array.isArray(value)) {
    const normalized = [];
    Object.setPrototypeOf(normalized, null);
    const keys = Reflect.ownKeys(value);
    for (const key of keys) {
      if (key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      const index = typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key)
        ? Number(key)
        : -1;
      if (
        index < 0
        || index >= value.length
        || !Number.isSafeInteger(index)
        || !descriptor?.enumerable
        || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      ) {
        throw invalidResult('result arrays must contain only enumerable data elements');
      }
      normalized[index] = normalizeResultValue(descriptor.value, seen, depth + 1);
    }
    if (normalized.length !== value.length || keys.length - 1 !== value.length) {
      throw invalidResult('result arrays must not contain sparse or accessor elements');
    }
    seen.delete(value);
    return normalized;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw invalidResult('result objects must be plain JSON objects');
  }

  const normalized = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== 'string'
      || !descriptor?.enumerable
      || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
    ) {
      throw invalidResult('result must contain only enumerable string keys');
    }
    if (UNSAFE_RESULT_STRUCTURE_KEYS.has(key)) {
      throw invalidResult(`result contains unsafe structural field: ${key}`);
    }
    if (key.includes('\u0000') || hasUnpairedSurrogate(key)) {
      throw invalidResult('result contains a field name that PostgreSQL JSONB cannot represent');
    }
    const normalizedKey = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (SENSITIVE_RESULT_KEYS.has(normalizedKey) || SENSITIVE_RESULT_KEY_SUFFIX.test(normalizedKey)) {
      throw invalidResult(`result contains sensitive field: ${key}`);
    }
    if (
      (normalizedKey === 'summary' || normalizedKey === 'message')
      && descriptor.value !== null
      && typeof descriptor.value !== 'string'
    ) {
      throw invalidResult(`result.${key} must be a string or null`);
    }
    normalized[key] = normalizeResultValue(descriptor.value, seen, depth + 1);
  }

  seen.delete(value);
  return normalized;
}

function snapshotSerializationHooks() {
  return [
    [Object.prototype, Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON')],
    [Array.prototype, Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON')]
  ];
}

function restoreSerializationHooks(snapshots) {
  for (const [prototype, descriptor] of snapshots) {
    if (descriptor) {
      Object.defineProperty(prototype, 'toJSON', descriptor);
    } else if (!Reflect.deleteProperty(prototype, 'toJSON')) {
      throw invalidResult('result attempted to install an inherited serialization hook');
    }
  }
}

export function normalizeOperationResult(result) {
  if (result === undefined || result === null) {
    return null;
  }

  const serializationHooks = snapshotSerializationHooks();
  if (serializationHooks.some(([, descriptor]) => descriptor)) {
    throw invalidResult('result serialization environment contains an inherited toJSON hook');
  }
  try {
    // Build a detached JSON value while validating it. Reading each own data
    // property exactly once closes a validation/serialization TOCTOU where an
    // accessor could return safe text first and a credential on the next read.
    // Null-prototype containers also prevent a Proxy trap from installing an
    // inherited toJSON hook that replaces the already-validated value.
    const normalized = normalizeResultValue(result, new WeakSet());
    const serialized = SAFE_JSON_STRINGIFY(normalized);
    if (serialized === undefined) {
      throw invalidResult('result must be JSON-compatible');
    }
    if (Buffer.byteLength(serialized, 'utf8') > MAX_RESULT_BYTES) {
      throw invalidResult(`result exceeds the maximum size of ${MAX_RESULT_BYTES} bytes`);
    }

    // Rehydrate the safe serialized form to preserve the existing ordinary
    // Object/Array result contract for repository and action callers.
    return SAFE_JSON_PARSE(serialized);
  } finally {
    restoreSerializationHooks(serializationHooks);
  }
}
