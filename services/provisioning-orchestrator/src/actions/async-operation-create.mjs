import { createOperation as createOperationModel } from '../models/async-operation.mjs';
import {
  createIdempotencyKeyRecord,
  hashParams,
  validateKeyFormat
} from '../models/idempotency-key-record.mjs';
import { createOperation as persistOperation, findById } from '../repositories/async-operation-repo.mjs';
import { findActive, insertOrFind } from '../repositories/idempotency-key-repo.mjs';
import {
  publishDeduplicationEvent,
  publishStateChanged
} from '../events/async-operation-events.mjs';

const ERROR_STATUS_CODES = {
  IDEMPOTENCY_KEY_CONFLICT: 409,
  VALIDATION_ERROR: 400
};

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

function buildRequestPayload(params = {}) {
  const payload = { ...params };
  delete payload.callerContext;
  delete payload.correlation_id;
  delete payload.idempotency_key;
  return payload;
}

function formatCreateResponse(operation, bodyExtras = {}, headerExtras = {}) {
  return {
    statusCode: 200,
    headers: {
      'X-Correlation-Id': operation.correlation_id,
      ...headerExtras
    },
    body: {
      operationId: operation.operation_id,
      status: operation.status,
      correlationId: operation.correlation_id,
      createdAt: operation.created_at,
      ...bodyExtras
    }
  };
}

export function buildCreateActionDependencies(overrides = {}) {
  return {
    db: overrides.db,
    producer: overrides.producer,
    createOperationModel: overrides.createOperationModel ?? createOperationModel,
    persistOperation: overrides.persistOperation ?? persistOperation,
    findById: overrides.findById ?? findById,
    findActiveIdempotencyKey: overrides.findActiveIdempotencyKey ?? findActive,
    insertOrFindIdempotencyKey: overrides.insertOrFindIdempotencyKey ?? insertOrFind,
    createIdempotencyKeyRecord: overrides.createIdempotencyKeyRecord ?? createIdempotencyKeyRecord,
    hashParams: overrides.hashParams ?? hashParams,
    publishStateChanged: overrides.publishStateChanged ?? publishStateChanged,
    publishDeduplicationEvent: overrides.publishDeduplicationEvent ?? publishDeduplicationEvent,
    log: overrides.log ?? console.log
  };
}

async function publishCreateEvent(dependencies, stored) {
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
}

async function publishDedupEvent(dependencies, { operation, actor, idempotencyKey, paramsMismatch, requestCorrelationId }) {
  let publishFailure = null;

  try {
    await dependencies.publishDeduplicationEvent(dependencies.producer, {
      operation,
      actor,
      idempotencyKey,
      paramsMismatch,
      correlationId: requestCorrelationId ?? operation.correlation_id
    });
  } catch (error) {
    publishFailure = error;
  }

  dependencies.log(
    JSON.stringify({
      level: publishFailure ? 'warn' : 'info',
      event: 'async_operation_deduplicated',
      operation_id: operation.operation_id,
      tenant_id: operation.tenant_id,
      correlation_id: requestCorrelationId ?? operation.correlation_id,
      status: operation.status,
      metrics: [
        metricAnnotation('async_operation_deduplicated_total', { tenant: operation.tenant_id, operation_type: operation.operation_type }),
        ...(paramsMismatch ? [metricAnnotation('async_operation_idempotency_params_mismatch_total', { tenant: operation.tenant_id })] : []),
        ...(publishFailure ? [metricAnnotation('async_operation_event_publish_failures_total', { tenant: operation.tenant_id })] : [])
      ]
    })
  );
}

async function resolveExistingOperation(dependencies, tenantId, record, operationType) {
  if (record.operation_type && record.operation_type !== operationType) {
    const error = Object.assign(
      new Error('Idempotency key already associated with a different operation type'),
      {
        code: 'IDEMPOTENCY_KEY_CONFLICT',
        existingOperationType: record.operation_type,
        statusCode: 409
      }
    );
    throw error;
  }

  const existingOperation = await dependencies.findById(dependencies.db, {
    operation_id: record.operation_id,
    tenant_id: tenantId
  });

  if (!existingOperation) {
    throw Object.assign(new Error('Operation not found for active idempotency key'), {
      code: 'NOT_FOUND',
      statusCode: 404
    });
  }

  return existingOperation;
}

export async function main(params = {}, overrides = {}) {
  const dependencies = buildCreateActionDependencies(overrides);
  const callerContext = getCallerContext(params);
  requireCallerIdentity(callerContext);

  const requestCorrelationId = params.correlation_id ?? callerContext.correlationId;
  const idempotencyKey = params.idempotency_key ?? null;
  const requestPayload = buildRequestPayload(params);
  const paramsHash = idempotencyKey ? dependencies.hashParams(requestPayload) : null;

  try {
    if (idempotencyKey) {
      validateKeyFormat(idempotencyKey);

      const existingRecord = await dependencies.findActiveIdempotencyKey(dependencies.db, {
        tenant_id: callerContext.tenantId,
        idempotency_key: idempotencyKey
      });

      if (existingRecord) {
        const existingOperation = await resolveExistingOperation(
          dependencies,
          callerContext.tenantId,
          existingRecord,
          params.operation_type
        );
        const paramsMismatch = existingRecord.params_hash !== paramsHash;
        await publishDedupEvent(dependencies, {
          operation: existingOperation,
          actor: callerContext.actor,
          idempotencyKey,
          paramsMismatch,
          requestCorrelationId
        });

        return formatCreateResponse(
          existingOperation,
          { idempotent: true, paramsMismatch },
          {
            'X-Idempotent-Replayed': 'true',
            ...(paramsMismatch ? { 'X-Idempotent-Params-Mismatch': 'true' } : {})
          }
        );
      }
    }

    const operation = dependencies.createOperationModel({
      tenant_id: callerContext.tenantId,
      actor_id: callerContext.actor.id,
      actor_type: callerContext.actor.type,
      workspace_id: params.workspace_id ?? callerContext.workspaceId ?? null,
      operation_type: params.operation_type,
      correlation_id: requestCorrelationId ?? callerContext.correlationId,
      idempotency_key: idempotencyKey,
      saga_id: params.saga_id ?? null,
      max_retries: params.max_retries ?? null
    });

    if (!idempotencyKey) {
      const stored = await dependencies.persistOperation(dependencies.db, operation);
      await publishCreateEvent(dependencies, stored);
      return formatCreateResponse(stored);
    }

    await dependencies.db.query('BEGIN');

    try {
      const stored = await dependencies.persistOperation(dependencies.db, operation);
      const keyRecord = dependencies.createIdempotencyKeyRecord({
        tenant_id: stored.tenant_id,
        idempotency_key: idempotencyKey,
        operation_id: stored.operation_id,
        operation_type: stored.operation_type,
        params_hash: paramsHash
      });
      const result = await dependencies.insertOrFindIdempotencyKey(dependencies.db, keyRecord);

      if (!result.created || result.record?.operation_id !== stored.operation_id) {
        await dependencies.db.query('ROLLBACK');
        const existingOperation = await resolveExistingOperation(
          dependencies,
          callerContext.tenantId,
          result.record,
          params.operation_type
        );
        const paramsMismatch = result.record.params_hash !== paramsHash;
        await publishDedupEvent(dependencies, {
          operation: existingOperation,
          actor: callerContext.actor,
          idempotencyKey,
          paramsMismatch,
          requestCorrelationId
        });

        return formatCreateResponse(
          existingOperation,
          { idempotent: true, paramsMismatch },
          {
            'X-Idempotent-Replayed': 'true',
            ...(paramsMismatch ? { 'X-Idempotent-Params-Mismatch': 'true' } : {})
          }
        );
      }

      await dependencies.db.query('COMMIT');
      await publishCreateEvent(dependencies, stored);
      return formatCreateResponse(stored, { idempotent: false, paramsMismatch: false });
    } catch (error) {
      await dependencies.db.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    error.statusCode = error.statusCode ?? ERROR_STATUS_CODES[error.code] ?? 500;
    throw error;
  }
}
