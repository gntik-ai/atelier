import { getPublicRoute } from '../../../services/internal-contracts/src/index.mjs';
import {
  OPENWHISK_CONSOLE_BACKEND_INITIATING_SURFACE,
  buildConsoleBackendActivationAnnotation,
  validateConsoleBackendInvocationRequest
} from '../../../services/adapters/src/openwhisk-admin.mjs';

export const CONSOLE_BACKEND_INITIATING_SURFACE = OPENWHISK_CONSOLE_BACKEND_INITIATING_SURFACE;
export const CONSOLE_BACKEND_ACTOR_TYPE = 'workspace_service_account';
export const CONSOLE_BACKEND_WORKFLOW_ROUTE_ID = 'getFunctionInventory';

function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export function getConsoleBackendIdentityRequirements() {
  return {
    actor_type: CONSOLE_BACKEND_ACTOR_TYPE,
    initiating_surface: CONSOLE_BACKEND_INITIATING_SURFACE,
    required_scope_fields: ['tenantId', 'workspaceId', 'correlationId'],
    authorization_model_role: CONSOLE_BACKEND_ACTOR_TYPE
  };
}

export function validateConsoleBackendScope(context = {}) {
  const violations = [];
  const requestedTenantId = context.requestTenantId ?? context.tenantId;
  const requestedWorkspaceId = context.requestWorkspaceId ?? context.workspaceId;

  if (!context.tenantId) {
    violations.push('tenantId is required for console backend scope validation.');
  }

  if (!context.workspaceId) {
    violations.push('workspaceId is required for console backend scope validation.');
  }

  if (context.tenantId && requestedTenantId && requestedTenantId !== context.tenantId) {
    violations.push('console backend invocation must stay within the caller tenant scope.');
  }

  if (context.workspaceId && requestedWorkspaceId && requestedWorkspaceId !== context.workspaceId) {
    violations.push('console backend invocation must stay within the caller workspace scope.');
  }

  return {
    ok: violations.length === 0,
    violations,
    normalizedContext: {
      actor: context.actor,
      actorType: context.actorType ?? CONSOLE_BACKEND_ACTOR_TYPE,
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      correlationId: context.correlationId,
      requestTenantId: requestedTenantId,
      requestWorkspaceId: requestedWorkspaceId,
      initiatingSurface: CONSOLE_BACKEND_INITIATING_SURFACE
    }
  };
}

export function buildConsoleBackendWorkflowInvocation(context = {}, actionRef, payload = {}) {
  invariant(actionRef && typeof actionRef === 'string', 'actionRef is required for console backend workflow invocation.');
  invariant(context.tenantId, 'tenantId is required for console backend workflow invocation.');
  invariant(context.workspaceId, 'workspaceId is required for console backend workflow invocation.');
  invariant(context.correlationId, 'correlationId is required for console backend workflow invocation.');

  const scopeValidation = validateConsoleBackendScope(context);
  if (!scopeValidation.ok) {
    throw new Error(scopeValidation.violations[0]);
  }

  const route = getPublicRoute(CONSOLE_BACKEND_WORKFLOW_ROUTE_ID);
  const actionName = actionRef.split('/').pop() || actionRef;
  const representativeOperation = payload.representativeOperation ?? {
    operationId: CONSOLE_BACKEND_WORKFLOW_ROUTE_ID,
    method: route?.method ?? 'GET',
    path: route?.path ?? '/v1/functions/workspaces/{workspaceId}/inventory'
  };
  const request = {
    tenantId: payload.tenantId ?? context.tenantId,
    workspaceId: payload.workspaceId ?? context.workspaceId,
    actionRef,
    responseMode: payload.responseMode ?? 'synchronous',
    triggerContext: payload.triggerContext ?? { kind: 'direct' },
    body: payload.body ?? {
      workflow: 'console_backend_inventory_sync',
      publicApiCall: {
        operationId: representativeOperation.operationId,
        method: representativeOperation.method,
        path: representativeOperation.path.replace('{workspaceId}', payload.workspaceId ?? context.workspaceId),
        headers: {
          'X-API-Version': payload.apiVersion ?? '2026-03-25',
          'X-Correlation-Id': context.correlationId,
          'Idempotency-Key': payload.idempotencyKey ?? `idem:${context.correlationId}:${actionName}`
        }
      }
    }
  };

  const adapterValidation = validateConsoleBackendInvocationRequest(request, context);
  if (!adapterValidation.ok) {
    throw new Error(adapterValidation.violations[0]);
  }

  return {
    actor: context.actor,
    actorType: context.actorType ?? CONSOLE_BACKEND_ACTOR_TYPE,
    actionRef,
    invocationRequest: request,
    activationAnnotation: buildConsoleBackendActivationAnnotation({
      actor: context.actor,
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      correlationId: context.correlationId
    }),
    representativeOperation,
    publicApiSurface: {
      operationId: representativeOperation.operationId,
      path: representativeOperation.path,
      privateBackchannelAllowed: false
    }
  };
}

export function summarizeConsoleBackendFunctionsSurface() {
  return {
    initiatingSurface: CONSOLE_BACKEND_INITIATING_SURFACE,
    actorType: CONSOLE_BACKEND_ACTOR_TYPE,
    workflowRouteId: CONSOLE_BACKEND_WORKFLOW_ROUTE_ID,
    representativeWorkflow: 'console_backend_inventory_sync',
    publicApiOnly: true,
    traceFields: ['actor', 'tenant_id', 'workspace_id', 'correlation_id', 'initiating_surface']
  };
}
