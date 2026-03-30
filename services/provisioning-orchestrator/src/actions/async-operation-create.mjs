import { createOperation as createOperationModel } from '../models/async-operation.mjs';
import { createOperation as persistOperation } from '../repositories/async-operation-repo.mjs';
import { publishStateChanged } from '../events/async-operation-events.mjs';

function getCallerContext(params = {}) {
  return params.callerContext ?? {};
}

function requireCallerIdentity(callerContext) {
  if (!callerContext.tenantId) {
    throw Object.assign(new Error('callerContext.tenantId is required'), { code: 'VALIDATION_ERROR', statusCode: 400 });
  }

  if (!callerContext.actor?.id) {
    throw Object.assign(new Error('callerContext.actor.id is required'), { code: 'VALIDATION_ERROR', statusCode: 400 });
  }

  if (!callerContext.actor?.type) {
    throw Object.assign(new Error('callerContext.actor.type is required'), { code: 'VALIDATION_ERROR', statusCode: 400 });
  }
}

function metricAnnotation(name, labels = {}) {
  return { metric: name, labels };
}

export function buildCreateActionDependencies(overrides = {}) {
  return {
    db: overrides.db,
    producer: overrides.producer,
    createOperationModel: overrides.createOperationModel ?? createOperationModel,
    persistOperation: overrides.persistOperation ?? persistOperation,
    publishStateChanged: overrides.publishStateChanged ?? publishStateChanged,
    log: overrides.log ?? console.log
  };
}

export async function main(params = {}, overrides = {}) {
  const dependencies = buildCreateActionDependencies(overrides);
  const callerContext = getCallerContext(params);
  requireCallerIdentity(callerContext);

  const operation = dependencies.createOperationModel({
    tenant_id: callerContext.tenantId,
    actor_id: callerContext.actor.id,
    actor_type: callerContext.actor.type,
    workspace_id: params.workspace_id ?? callerContext.workspaceId ?? null,
    operation_type: params.operation_type,
    correlation_id: params.correlation_id ?? callerContext.correlationId,
    idempotency_key: params.idempotency_key,
    saga_id: params.saga_id ?? null
  });

  const stored = await dependencies.persistOperation(dependencies.db, operation);
  let publishFailure = null;

  try {
    await dependencies.publishStateChanged(dependencies.producer, stored, 'pending');
  } catch (error) {
    publishFailure = error;
  }

  dependencies.log(
    JSON.stringify({
      level: publishFailure ? 'warn' : 'info',
      event: 'async_operation_created',
      operation_id: stored.operation_id,
      tenant_id: stored.tenant_id,
      correlation_id: stored.correlation_id,
      status: stored.status,
      metrics: [
        metricAnnotation('async_operation_created_total', { tenant: stored.tenant_id, operation_type: stored.operation_type }),
        ...(publishFailure ? [metricAnnotation('async_operation_event_publish_failures_total', { tenant: stored.tenant_id })] : [])
      ]
    })
  );

  return {
    statusCode: 200,
    headers: { 'X-Correlation-Id': stored.correlation_id },
    body: {
      operationId: stored.operation_id,
      status: stored.status,
      correlationId: stored.correlation_id,
      createdAt: stored.created_at
    }
  };
}
