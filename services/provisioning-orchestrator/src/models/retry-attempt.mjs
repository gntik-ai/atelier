import { randomUUID } from 'node:crypto';
import { generateCorrelationId } from './async-operation.mjs';

const ACTOR_TYPES = new Set(['workspace_admin', 'tenant_owner', 'superadmin', 'tenant_member']);
const ATTEMPT_STATUSES = new Set(['pending', 'running', 'completed', 'failed']);

function requireField(input, field) {
  if (!input?.[field]) {
    throw Object.assign(new Error(`Missing required field: ${field}`), {
      code: 'VALIDATION_ERROR',
      field
    });
  }
}

export function validateAttemptNumber(value) {
  if (!Number.isInteger(value) || value < 1) {
    throw Object.assign(new Error('attempt_number must be an integer greater than 0'), {
      code: 'VALIDATION_ERROR',
      field: 'attempt_number'
    });
  }

  return value;
}

export function createRetryAttempt(input = {}) {
  requireField(input, 'operation_id');
  requireField(input, 'tenant_id');
  requireField(input, 'actor_id');
  requireField(input, 'actor_type');

  if (!ACTOR_TYPES.has(input.actor_type)) {
    throw Object.assign(new Error(`Invalid actor_type: ${input.actor_type}`), {
      code: 'VALIDATION_ERROR',
      field: 'actor_type'
    });
  }

  validateAttemptNumber(input.attempt_number);

  const status = input.status ?? 'pending';
  if (!ATTEMPT_STATUSES.has(status)) {
    throw Object.assign(new Error(`Invalid status: ${status}`), {
      code: 'VALIDATION_ERROR',
      field: 'status'
    });
  }

  const createdAt = input.created_at ?? new Date().toISOString();

  return {
    attempt_id: input.attempt_id ?? randomUUID(),
    operation_id: input.operation_id,
    tenant_id: input.tenant_id,
    attempt_number: input.attempt_number,
    correlation_id: input.correlation_id ?? generateCorrelationId(input.tenant_id),
    actor_id: input.actor_id,
    actor_type: input.actor_type,
    status,
    created_at: createdAt,
    completed_at: input.completed_at ?? null,
    metadata: input.metadata ?? null
  };
}
