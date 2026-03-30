import {
  getOperationById,
  getOperationLogs,
  getOperationResult,
  listOperations
} from '../repositories/async-operation-query-repo.mjs';

const VALID_QUERY_TYPES = new Set(['list', 'detail', 'logs', 'result']);
const ERROR_STATUS_CODES = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  TENANT_ISOLATION_VIOLATION: 403
};

function metricAnnotation(name, labels = {}) {
  return { metric: name, labels };
}

function requireQueryType(queryType) {
  if (!VALID_QUERY_TYPES.has(queryType)) {
    throw Object.assign(new Error('queryType must be one of list, detail, logs or result'), {
      code: 'VALIDATION_ERROR',
      statusCode: 400
    });
  }
}

function requireOperationId(queryType, operationId) {
  if (queryType !== 'detail' && queryType !== 'logs' && queryType !== 'result') {
    return;
  }

  if (!operationId) {
    throw Object.assign(new Error('operationId is required for detail, logs and result queries'), {
      code: 'VALIDATION_ERROR',
      statusCode: 400
    });
  }
}

function getCallerContext(params = {}) {
  return params.callerContext ?? {};
}

function requireCallerIdentity(callerContext) {
  if (!callerContext.actor?.id) {
    throw Object.assign(new Error('callerContext.actor.id is required'), {
      code: 'VALIDATION_ERROR',
      statusCode: 400
    });
  }

  if (!callerContext.actor?.type) {
    throw Object.assign(new Error('callerContext.actor.type is required'), {
      code: 'VALIDATION_ERROR',
      statusCode: 400
    });
  }

  if (callerContext.actor.type !== 'superadmin' && !callerContext.tenantId) {
    throw Object.assign(new Error('callerContext.tenantId is required'), {
      code: 'VALIDATION_ERROR',
      statusCode: 400
    });
  }
}

function resolveTenantScope(callerContext, filters = {}) {
  if (callerContext.actor?.type === 'superadmin') {
    return filters.tenantId ?? null;
  }

  if (filters.tenantId && filters.tenantId !== callerContext.tenantId) {
    throw Object.assign(new Error('tenantId must come from callerContext'), {
      code: 'TENANT_ISOLATION_VIOLATION',
      statusCode: 403
    });
  }

  return callerContext.tenantId;
}

function formatOperationSummary(operation) {
  return {
    operationId: operation.operation_id,
    status: operation.status,
    operationType: operation.operation_type,
    tenantId: operation.tenant_id,
    workspaceId: operation.workspace_id ?? null,
    actorId: operation.actor_id,
    actorType: operation.actor_type,
    createdAt: operation.created_at,
    updatedAt: operation.updated_at,
    correlationId: operation.correlation_id
  };
}

function formatOperationDetail(operation) {
  return {
    queryType: 'detail',
    operationId: operation.operation_id,
    status: operation.status,
    operationType: operation.operation_type,
    tenantId: operation.tenant_id,
    workspaceId: operation.workspace_id ?? null,
    actorId: operation.actor_id,
    actorType: operation.actor_type,
    correlationId: operation.correlation_id,
    idempotencyKey: operation.idempotency_key ?? null,
    sagaId: operation.saga_id ?? null,
    createdAt: operation.created_at,
    updatedAt: operation.updated_at,
    errorSummary: operation.error_summary ?? null
  };
}

function formatLogsResponse(operationId, logPage) {
  return {
    queryType: 'logs',
    operationId,
    entries: logPage.entries.map((entry) => ({
      logEntryId: entry.log_entry_id,
      level: entry.level,
      message: entry.message,
      occurredAt: entry.occurred_at
    })),
    total: logPage.total,
    pagination: logPage.pagination
  };
}

function formatResultResponse(resultProjection) {
  return {
    queryType: 'result',
    operationId: resultProjection.operation_id,
    status: resultProjection.status,
    resultType: resultProjection.resultType,
    summary: resultProjection.summary ?? null,
    failureReason: resultProjection.failureReason ?? null,
    retryable: resultProjection.retryable ?? null,
    completedAt: resultProjection.completedAt ?? null
  };
}

async function publishAuditEvent(producer, event) {
  if (!producer || typeof producer.send !== 'function') {
    return;
  }

  await producer.send({
    topic: 'console.async-operation.accessed',
    messages: [{ value: JSON.stringify(event) }]
  });
}

export function buildQueryActionDependencies(overrides = {}) {
  return {
    db: overrides.db,
    producer: overrides.producer,
    listOperations: overrides.listOperations ?? listOperations,
    getOperationById: overrides.getOperationById ?? getOperationById,
    getOperationLogs: overrides.getOperationLogs ?? getOperationLogs,
    getOperationResult: overrides.getOperationResult ?? getOperationResult,
    publishAuditEvent: overrides.publishAuditEvent ?? publishAuditEvent,
    log: overrides.log ?? console.log
  };
}

export async function main(params = {}, overrides = {}) {
  const startedAt = Date.now();
  const dependencies = buildQueryActionDependencies(overrides);
  const callerContext = getCallerContext(params);

  requireCallerIdentity(callerContext);
  requireQueryType(params.queryType);
  requireOperationId(params.queryType, params.operationId);

  const tenantId = resolveTenantScope(callerContext, params.filters ?? {});
  const isSuperadmin = callerContext.actor.type === 'superadmin';

  try {
    let body;
    let operationForAudit = null;

    if (params.queryType === 'list') {
      const response = await dependencies.listOperations(dependencies.db, {
        tenant_id: tenantId,
        status: params.filters?.status,
        operationType: params.filters?.operationType,
        workspaceId: params.filters?.workspaceId,
        limit: params.pagination?.limit,
        offset: params.pagination?.offset,
        isSuperadmin
      });

      body = {
        queryType: 'list',
        items: response.items.map(formatOperationSummary),
        total: response.total,
        pagination: response.pagination
      };
    }

    if (params.queryType === 'detail' || params.queryType === 'logs' || params.queryType === 'result') {
      operationForAudit = await dependencies.getOperationById(dependencies.db, {
        operation_id: params.operationId,
        tenant_id: tenantId,
        isSuperadmin
      });

      if (!operationForAudit) {
        throw Object.assign(new Error('Operation not found'), {
          code: 'NOT_FOUND',
          statusCode: 404
        });
      }

      if (params.queryType === 'detail') {
        body = formatOperationDetail(operationForAudit);
      }

      if (params.queryType === 'logs') {
        const logs = await dependencies.getOperationLogs(dependencies.db, {
          operation_id: params.operationId,
          tenant_id: operationForAudit.tenant_id,
          limit: params.pagination?.limit,
          offset: params.pagination?.offset
        });

        body = formatLogsResponse(operationForAudit.operation_id, logs);
      }

      if (params.queryType === 'result') {
        const resultProjection = await dependencies.getOperationResult(dependencies.db, {
          operation_id: params.operationId,
          tenant_id: operationForAudit.tenant_id
        });

        if (!resultProjection) {
          throw Object.assign(new Error('Operation not found'), {
            code: 'NOT_FOUND',
            statusCode: 404
          });
        }

        body = formatResultResponse(resultProjection);
      }
    }

    const auditEvent = {
      actorId: callerContext.actor.id,
      tenantId: operationForAudit?.tenant_id ?? tenantId,
      operationId: operationForAudit?.operation_id ?? params.operationId ?? null,
      queryType: params.queryType,
      timestamp: new Date().toISOString()
    };

    let publishFailure = null;
    try {
      await dependencies.publishAuditEvent(dependencies.producer, auditEvent);
    } catch (error) {
      publishFailure = error;
    }

    const correlationId = operationForAudit?.correlation_id ?? callerContext.correlationId ?? null;

    dependencies.log(
      JSON.stringify({
        level: publishFailure ? 'warn' : 'info',
        event: 'async_operation_query_completed',
        operation_id: operationForAudit?.operation_id ?? null,
        tenant_id: operationForAudit?.tenant_id ?? tenantId,
        actor_id: callerContext.actor.id,
        queryType: params.queryType,
        durationMs: Date.now() - startedAt,
        metrics: [
          metricAnnotation('async_operation_query_total', { queryType: params.queryType }),
          metricAnnotation('async_operation_query_duration_seconds', { queryType: params.queryType }),
          ...(publishFailure ? [metricAnnotation('async_operation_access_audit_publish_failures_total', { queryType: params.queryType })] : [])
        ]
      })
    );

    return {
      statusCode: 200,
      headers: correlationId ? { 'X-Correlation-Id': correlationId } : {},
      body
    };
  } catch (error) {
    error.statusCode = error.statusCode ?? ERROR_STATUS_CODES[error.code] ?? 500;
    throw error;
  }
}
