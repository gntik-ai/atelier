import { randomUUID } from 'node:crypto';
import {
  asyncOperationStateChangedSchema,
  idempotencyDedupEventSchema,
  operationRetryEventSchema,
  operationCancelEventSchema,
  operationTimeoutEventSchema,
  operationRecoveryEventSchema
} from '../../../internal-contracts/src/index.mjs';

export const ASYNC_OPERATION_STATE_CHANGED_TOPIC = 'console.async-operation.state-changed';
export const ASYNC_OPERATION_DEDUPLICATED_TOPIC = 'console.async-operation.deduplicated';
export const ASYNC_OPERATION_RETRY_REQUESTED_TOPIC = 'console.async-operation.retry-requested';
export const ASYNC_OPERATION_CANCELLED_TOPIC = 'console.async-operation.cancelled';
export const ASYNC_OPERATION_TIMED_OUT_TOPIC = 'console.async-operation.timed-out';
export const ASYNC_OPERATION_RECOVERED_TOPIC = 'console.async-operation.recovered';

function validateRequiredFields(event, schema) {
  const required = schema.required ?? [];

  for (const field of required) {
    if (event[field] === undefined) {
      throw Object.assign(new Error(`Missing required event field: ${field}`), { code: 'VALIDATION_ERROR', field });
    }
  }

  return event;
}

export function buildStateChangedEvent(operation, previousStatus) {
  return {
    eventId: randomUUID(),
    eventType: 'async_operation.state_changed',
    operationId: operation.operation_id,
    tenantId: operation.tenant_id,
    workspaceId: operation.workspace_id ?? null,
    actorId: operation.actor_id,
    actorType: operation.actor_type,
    operationType: operation.operation_type,
    previousStatus: previousStatus ?? operation.status,
    newStatus: operation.status,
    errorSummary: operation.error_summary ?? null,
    occurredAt: operation.updated_at ?? operation.created_at ?? new Date().toISOString(),
    correlationId: operation.correlation_id
  };
}

export function buildDeduplicationEvent({ operation, actor, idempotencyKey, paramsMismatch = false, correlationId }) {
  return {
    eventId: randomUUID(),
    eventType: 'async_operation.deduplicated',
    operationId: operation.operation_id,
    tenantId: operation.tenant_id,
    actorId: actor.id,
    actorType: actor.type,
    idempotencyKey,
    paramsMismatch,
    occurredAt: new Date().toISOString(),
    correlationId: correlationId ?? operation.correlation_id
  };
}

export function buildRetryEvent({ operation, attempt, actor, previousCorrelationId }) {
  return {
    eventId: randomUUID(),
    eventType: 'async_operation.retry_requested',
    operationId: operation.operation_id,
    tenantId: operation.tenant_id,
    actorId: actor.id,
    actorType: actor.type,
    attemptId: attempt.attempt_id,
    attemptNumber: attempt.attempt_number,
    previousCorrelationId: previousCorrelationId ?? operation.correlation_id,
    newCorrelationId: attempt.correlation_id,
    occurredAt: attempt.created_at ?? new Date().toISOString()
  };
}

export function buildCancelledEvent(operation, cancelledBy) {
  return {
    eventId: randomUUID(),
    eventType: 'async_operation.cancelled',
    operationId: operation.operation_id,
    tenantId: operation.tenant_id,
    actorId: operation.actor_id ?? cancelledBy ?? 'system',
    cancelledBy: cancelledBy ?? operation.cancelled_by ?? operation.actor_id ?? 'system',
    previousStatus: operation.previous_status ?? operation.status,
    newStatus: operation.status,
    reason: operation.cancellation_reason ?? null,
    occurredAt: operation.updated_at ?? operation.created_at ?? new Date().toISOString(),
    correlationId: operation.correlation_id
  };
}

export function buildTimedOutEvent(operation) {
  return {
    eventId: randomUUID(),
    eventType: 'async_operation.timed_out',
    operationId: operation.operation_id,
    tenantId: operation.tenant_id,
    actorId: 'system',
    previousStatus: operation.previous_status ?? 'running',
    newStatus: operation.status,
    timeoutReason: operation.cancellation_reason ?? 'timeout exceeded',
    occurredAt: operation.updated_at ?? operation.created_at ?? new Date().toISOString(),
    correlationId: operation.correlation_id
  };
}

export function buildRecoveredEvent(operation, recoveryReason) {
  return {
    eventId: randomUUID(),
    eventType: 'async_operation.recovered',
    operationId: operation.operation_id,
    tenantId: operation.tenant_id,
    actorId: 'system',
    previousStatus: operation.previous_status ?? operation.status,
    newStatus: 'failed',
    recoveryAction: 'fail',
    recoveryReason,
    occurredAt: operation.updated_at ?? operation.created_at ?? new Date().toISOString(),
    correlationId: operation.correlation_id
  };
}

export function validateStateChangedEvent(event) {
  return validateRequiredFields(event, asyncOperationStateChangedSchema);
}

export function validateDeduplicationEvent(event) {
  return validateRequiredFields(event, idempotencyDedupEventSchema);
}

export function validateRetryEvent(event) {
  return validateRequiredFields(event, operationRetryEventSchema);
}

export function validateCancelledEvent(event) {
  return validateRequiredFields(event, operationCancelEventSchema);
}

export function validateTimedOutEvent(event) {
  return validateRequiredFields(event, operationTimeoutEventSchema);
}

export function validateRecoveredEvent(event) {
  return validateRequiredFields(event, operationRecoveryEventSchema);
}

async function publishEvent(producer, topic, tenantId, event) {
  if (!producer?.send) {
    return { published: false, topic, event };
  }

  await producer.send({
    topic,
    messages: [
      {
        key: tenantId,
        value: JSON.stringify(event)
      }
    ]
  });

  return { published: true, topic, event };
}

export async function publishStateChanged(producer, operation, previousStatus) {
  const event = validateStateChangedEvent(buildStateChangedEvent(operation, previousStatus));
  return publishEvent(producer, ASYNC_OPERATION_STATE_CHANGED_TOPIC, event.tenantId, event);
}

export async function publishDeduplicationEvent(producer, payload) {
  const event = validateDeduplicationEvent(buildDeduplicationEvent(payload));
  return publishEvent(producer, ASYNC_OPERATION_DEDUPLICATED_TOPIC, event.tenantId, event);
}

export async function publishRetryEvent(producer, payload) {
  const event = validateRetryEvent(buildRetryEvent(payload));
  return publishEvent(producer, ASYNC_OPERATION_RETRY_REQUESTED_TOPIC, event.tenantId, event);
}

export async function publishCancelledEvent(producer, operation, cancelledBy) {
  const event = validateCancelledEvent(buildCancelledEvent(operation, cancelledBy));
  return publishEvent(producer, ASYNC_OPERATION_CANCELLED_TOPIC, event.tenantId, event);
}

export async function publishTimedOutEvent(producer, operation) {
  const event = validateTimedOutEvent(buildTimedOutEvent(operation));
  return publishEvent(producer, ASYNC_OPERATION_TIMED_OUT_TOPIC, event.tenantId, event);
}

export async function publishRecoveredEvent(producer, operation, recoveryReason) {
  const event = validateRecoveredEvent(buildRecoveredEvent(operation, recoveryReason));
  return publishEvent(producer, ASYNC_OPERATION_RECOVERED_TOPIC, event.tenantId, event);
}
