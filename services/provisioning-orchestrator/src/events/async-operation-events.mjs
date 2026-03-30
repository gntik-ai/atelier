import { randomUUID } from 'node:crypto';
import { asyncOperationStateChangedSchema } from '../../../internal-contracts/src/index.mjs';

export const ASYNC_OPERATION_STATE_CHANGED_TOPIC = 'console.async-operation.state-changed';

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

export function validateStateChangedEvent(event) {
  const required = asyncOperationStateChangedSchema.required ?? [];

  for (const field of required) {
    if (event[field] === undefined) {
      throw Object.assign(new Error(`Missing required event field: ${field}`), { code: 'VALIDATION_ERROR', field });
    }
  }

  return event;
}

export async function publishStateChanged(producer, operation, previousStatus) {
  const event = validateStateChangedEvent(buildStateChangedEvent(operation, previousStatus));

  if (!producer?.send) {
    return { published: false, topic: ASYNC_OPERATION_STATE_CHANGED_TOPIC, event };
  }

  await producer.send({
    topic: ASYNC_OPERATION_STATE_CHANGED_TOPIC,
    messages: [
      {
        key: event.tenantId,
        value: JSON.stringify(event)
      }
    ]
  });

  return { published: true, topic: ASYNC_OPERATION_STATE_CHANGED_TOPIC, event };
}
