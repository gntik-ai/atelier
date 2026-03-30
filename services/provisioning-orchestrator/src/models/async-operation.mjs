import { randomUUID } from 'node:crypto';
import { CANCELLABLE_STATES, validateTransition } from './async-operation-states.mjs';

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

  if (input.new_status === 'failed') {
    validateErrorSummary(input.error_summary);
  }

  const updatedAt = new Date().toISOString();
  const nextOperation = {
    ...operation,
    status: input.new_status,
    error_summary: input.new_status === 'failed' ? normalizeErrorSummary(input.error_summary) : null,
    cancellation_reason: input.new_status === 'timed_out'
      ? 'timeout exceeded'
      : (input.new_status === 'cancelling' ? input.cancellation_reason ?? null : operation.cancellation_reason ?? null),
    cancelled_by: input.new_status === 'cancelling' ? input.cancelled_by ?? null : operation.cancelled_by ?? null,
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
  return {
    code: errorSummary.code,
    message: errorSummary.message.trim(),
    failedStep: errorSummary.failedStep ?? null
  };
}

export function validateErrorSummary(errorSummary) {
  if (!errorSummary || typeof errorSummary !== 'object') {
    throw Object.assign(new Error('error_summary is required when transitioning to failed'), {
      code: 'VALIDATION_ERROR',
      field: 'error_summary'
    });
  }

  if (!errorSummary.code || !errorSummary.message) {
    throw Object.assign(new Error('error_summary.code and error_summary.message are required'), {
      code: 'VALIDATION_ERROR',
      field: 'error_summary'
    });
  }

  if (SENSITIVE_MESSAGE_PATTERNS.some((pattern) => pattern.test(errorSummary.message))) {
    throw Object.assign(new Error('error_summary.message contains sensitive content'), {
      code: 'VALIDATION_ERROR',
      field: 'error_summary.message'
    });
  }
}
