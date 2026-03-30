import { randomUUID } from 'node:crypto';
import {
  asyncOperationStateChangedSchema,
  idempotencyDedupEventSchema,
  operationRetryEventSchema,
  operationCancelEventSchema,
  operationTimeoutEventSchema,
  operationRecoveryEventSchema,
  failureClassifiedEventSchema,
  manualInterventionRequiredEventSchema,
  retryOverrideEventSchema,
  interventionNotificationEventSchema
} from '../../../internal-contracts/src/index.mjs';

export const ASYNC_OPERATION_STATE_CHANGED_TOPIC = 'console.async-operation.state-changed';
export const ASYNC_OPERATION_DEDUPLICATED_TOPIC = 'console.async-operation.deduplicated';
export const ASYNC_OPERATION_RETRY_REQUESTED_TOPIC = 'console.async-operation.retry-requested';
export const ASYNC_OPERATION_CANCELLED_TOPIC = 'console.async-operation.cancelled';
export const ASYNC_OPERATION_TIMED_OUT_TOPIC = 'console.async-operation.timed-out';
export const ASYNC_OPERATION_RECOVERED_TOPIC = 'console.async-operation.recovered';
export const ASYNC_OPERATION_FAILURE_CLASSIFIED_TOPIC = 'console.async-operation.failure-classified';
export const ASYNC_OPERATION_MANUAL_INTERVENTION_REQUIRED_TOPIC = 'console.async-operation.manual-intervention-required';
export const ASYNC_OPERATION_RETRY_OVERRIDE_TOPIC = 'console.async-operation.retry-override';
export const ASYNC_OPERATION_INTERVENTION_NOTIFICATION_TOPIC = 'console.async-operation.intervention-notification';

function validateRequiredFields(event, schema) {
  const required = schema.required ?? [];
  for (const field of required) {
    if (event[field] === undefined) {
      throw Object.assign(new Error(`Missing required event field: ${field}`), { code: 'VALIDATION_ERROR', field });
    }
  }
  return event;
}

export function buildStateChangedEvent(operation, previousStatus) { return { eventId: randomUUID(), eventType: 'async_operation.state_changed', operationId: operation.operation_id, tenantId: operation.tenant_id, workspaceId: operation.workspace_id ?? null, actorId: operation.actor_id, actorType: operation.actor_type, operationType: operation.operation_type, previousStatus: previousStatus ?? operation.status, newStatus: operation.status, errorSummary: operation.error_summary ?? null, occurredAt: operation.updated_at ?? operation.created_at ?? new Date().toISOString(), correlationId: operation.correlation_id }; }
export function buildDeduplicationEvent({ operation, actor, idempotencyKey, paramsMismatch = false, correlationId }) { return { eventId: randomUUID(), eventType: 'async_operation.deduplicated', operationId: operation.operation_id, tenantId: operation.tenant_id, actorId: actor.id, actorType: actor.type, idempotencyKey, paramsMismatch, occurredAt: new Date().toISOString(), correlationId: correlationId ?? operation.correlation_id }; }
export function buildRetryEvent({ operation, attempt, actor, previousCorrelationId }) { return { eventId: randomUUID(), eventType: 'async_operation.retry_requested', operationId: operation.operation_id, tenantId: operation.tenant_id, actorId: actor.id, actorType: actor.type, attemptId: attempt.attempt_id, attemptNumber: attempt.attempt_number, previousCorrelationId: previousCorrelationId ?? operation.correlation_id, newCorrelationId: attempt.correlation_id, occurredAt: attempt.created_at ?? new Date().toISOString() }; }
export function buildCancelledEvent(operation, cancelledBy) { return { eventId: randomUUID(), eventType: 'async_operation.cancelled', operationId: operation.operation_id, tenantId: operation.tenant_id, actorId: operation.actor_id ?? cancelledBy ?? 'system', cancelledBy: cancelledBy ?? operation.cancelled_by ?? operation.actor_id ?? 'system', previousStatus: operation.previous_status ?? operation.status, newStatus: operation.status, reason: operation.cancellation_reason ?? null, occurredAt: operation.updated_at ?? operation.created_at ?? new Date().toISOString(), correlationId: operation.correlation_id }; }
export function buildTimedOutEvent(operation) { return { eventId: randomUUID(), eventType: 'async_operation.timed_out', operationId: operation.operation_id, tenantId: operation.tenant_id, actorId: 'system', previousStatus: operation.previous_status ?? 'running', newStatus: operation.status, timeoutReason: operation.cancellation_reason ?? 'timeout exceeded', occurredAt: operation.updated_at ?? operation.created_at ?? new Date().toISOString(), correlationId: operation.correlation_id }; }
export function buildRecoveredEvent(operation, recoveryReason) { return { eventId: randomUUID(), eventType: 'async_operation.recovered', operationId: operation.operation_id, tenantId: operation.tenant_id, actorId: 'system', previousStatus: operation.previous_status ?? operation.status, newStatus: 'failed', recoveryAction: 'fail', recoveryReason, occurredAt: operation.updated_at ?? operation.created_at ?? new Date().toISOString(), correlationId: operation.correlation_id }; }
export function buildFailureClassifiedEvent(params = {}) { return { eventId: randomUUID(), eventType: 'async_operation.failure_classified', operationId: params.operationId, tenantId: params.tenantId, actorId: params.actorId, failureCategory: params.failureCategory, errorCode: params.errorCode, attemptCount: params.attemptCount, maxRetries: params.maxRetries, occurredAt: new Date().toISOString(), correlationId: params.correlationId }; }
export function buildManualInterventionRequiredEvent(params = {}) { return { eventId: randomUUID(), eventType: 'async_operation.manual_intervention_required', operationId: params.operationId, flagId: params.flagId, tenantId: params.tenantId, actorId: params.actorId, reason: params.reason, attemptCountAtFlag: params.attemptCountAtFlag, lastErrorCode: params.lastErrorCode, occurredAt: new Date().toISOString(), correlationId: params.correlationId }; }
export function buildRetryOverrideEvent(params = {}) { return { eventId: randomUUID(), eventType: 'async_operation.retry_override', overrideId: params.overrideId, operationId: params.operationId, flagId: params.flagId, tenantId: params.tenantId, superadminId: params.superadminId, justification: params.justification, attemptNumber: params.attemptNumber, newCorrelationId: params.newCorrelationId, occurredAt: new Date().toISOString() }; }
export function buildInterventionNotificationEvent(params = {}) { return { eventId: randomUUID(), eventType: 'async_operation.intervention_notification', operationId: params.operationId, flagId: params.flagId, tenantId: params.tenantId, recipientActorId: params.recipientActorId, recipientRole: params.recipientRole, operationType: params.operationType, failureSummary: params.failureSummary, suggestedActions: params.suggestedActions ?? [], occurredAt: new Date().toISOString(), correlationId: params.correlationId }; }

export function validateStateChangedEvent(event) { return validateRequiredFields(event, asyncOperationStateChangedSchema); }
export function validateDeduplicationEvent(event) { return validateRequiredFields(event, idempotencyDedupEventSchema); }
export function validateRetryEvent(event) { return validateRequiredFields(event, operationRetryEventSchema); }
export function validateCancelledEvent(event) { return validateRequiredFields(event, operationCancelEventSchema); }
export function validateTimedOutEvent(event) { return validateRequiredFields(event, operationTimeoutEventSchema); }
export function validateRecoveredEvent(event) { return validateRequiredFields(event, operationRecoveryEventSchema); }
export function validateFailureClassifiedEvent(event) { return validateRequiredFields(event, failureClassifiedEventSchema); }
export function validateManualInterventionRequiredEvent(event) { return validateRequiredFields(event, manualInterventionRequiredEventSchema); }
export function validateRetryOverrideEvent(event) { return validateRequiredFields(event, retryOverrideEventSchema); }
export function validateInterventionNotificationEvent(event) { return validateRequiredFields(event, interventionNotificationEventSchema); }

async function publishEvent(producer, topic, tenantId, event) {
  if (!producer?.send) {
    return { published: false, topic, event };
  }
  await producer.send({ topic, messages: [{ key: tenantId, value: JSON.stringify(event) }] });
  return { published: true, topic, event };
}

export async function publishStateChanged(producer, operation, previousStatus) { const event = validateStateChangedEvent(buildStateChangedEvent(operation, previousStatus)); return publishEvent(producer, ASYNC_OPERATION_STATE_CHANGED_TOPIC, event.tenantId, event); }
export async function publishDeduplicationEvent(producer, payload) { const event = validateDeduplicationEvent(buildDeduplicationEvent(payload)); return publishEvent(producer, ASYNC_OPERATION_DEDUPLICATED_TOPIC, event.tenantId, event); }
export async function publishRetryEvent(producer, payload) { const event = validateRetryEvent(buildRetryEvent(payload)); return publishEvent(producer, ASYNC_OPERATION_RETRY_REQUESTED_TOPIC, event.tenantId, event); }
export async function publishCancelledEvent(producer, operation, cancelledBy) { const event = validateCancelledEvent(buildCancelledEvent(operation, cancelledBy)); return publishEvent(producer, ASYNC_OPERATION_CANCELLED_TOPIC, event.tenantId, event); }
export async function publishTimedOutEvent(producer, operation) { const event = validateTimedOutEvent(buildTimedOutEvent(operation)); return publishEvent(producer, ASYNC_OPERATION_TIMED_OUT_TOPIC, event.tenantId, event); }
export async function publishRecoveredEvent(producer, operation, recoveryReason) { const event = validateRecoveredEvent(buildRecoveredEvent(operation, recoveryReason)); return publishEvent(producer, ASYNC_OPERATION_RECOVERED_TOPIC, event.tenantId, event); }
export async function publishFailureClassifiedEvent(producer, params) { const event = validateFailureClassifiedEvent(buildFailureClassifiedEvent(params)); return publishEvent(producer, ASYNC_OPERATION_FAILURE_CLASSIFIED_TOPIC, event.tenantId, event); }
export async function publishManualInterventionRequiredEvent(producer, params) { const event = validateManualInterventionRequiredEvent(buildManualInterventionRequiredEvent(params)); return publishEvent(producer, ASYNC_OPERATION_MANUAL_INTERVENTION_REQUIRED_TOPIC, event.tenantId, event); }
export async function publishRetryOverrideEvent(producer, params) { const event = validateRetryOverrideEvent(buildRetryOverrideEvent(params)); return publishEvent(producer, ASYNC_OPERATION_RETRY_OVERRIDE_TOPIC, event.tenantId, event); }
export async function publishInterventionNotificationEvent(producer, params) { const event = validateInterventionNotificationEvent(buildInterventionNotificationEvent(params)); return publishEvent(producer, ASYNC_OPERATION_INTERVENTION_NOTIFICATION_TOPIC, event.tenantId, event); }
