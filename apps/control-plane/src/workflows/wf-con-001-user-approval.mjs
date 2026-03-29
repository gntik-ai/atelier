import * as keycloakAdmin from '../../../../services/adapters/src/keycloak-admin.mjs';

import { validateConsoleBackendScope } from '../console-backend-functions.mjs';
import { checkIdempotency, markFailed, markPending, markSucceeded } from './idempotency-store.mjs';
import {
  WORKFLOW_AUTHORIZATION_MODEL,
  buildAuditFields,
  buildErrorResult,
  validateCallerAuthorization,
  validateInvocationRequest
} from './workflow-invocation-contract.mjs';

function createDependencyError(capability) {
  const error = new Error(`DOWNSTREAM_UNAVAILABLE: ${capability}`);
  error.code = 'DOWNSTREAM_UNAVAILABLE';
  return error;
}

const defaultDependencies = {
  assignRole: keycloakAdmin.assignRole,
  activateMembership: async () => {
    throw createDependencyError('activateMembership');
  }
};

let dependencies = { ...defaultDependencies };

function withAudit(result, callerContext, affectedResources = []) {
  return {
    ...result,
    auditFields: buildAuditFields('WF-CON-001', callerContext, affectedResources, result.status === 'succeeded' ? 'succeeded' : 'failed')
  };
}

function toFailure(request, callerContext, code, message, failedStep = null) {
  return withAudit(buildErrorResult('WF-CON-001', request?.idempotencyKey ?? 'unknown', code, message, failedStep), callerContext ?? request?.callerContext ?? {}, []);
}

function getScopeValidation(request) {
  return validateConsoleBackendScope({
    ...request.callerContext,
    requestTenantId: request.callerContext.requestTenantId ?? request.input.targetTenantId ?? request.callerContext.tenantId,
    requestWorkspaceId: request.callerContext.requestWorkspaceId ?? request.input.targetWorkspaceId ?? request.callerContext.workspaceId
  });
}

export function __setWorkflowDependenciesForTest(overrides = {}) {
  dependencies = { ...dependencies, ...overrides };
}

export function __resetWorkflowDependenciesForTest() {
  dependencies = { ...defaultDependencies };
}

export default async function handleUserApproval(request) {
  const validation = validateInvocationRequest(request);
  if (!validation.ok) {
    return toFailure(request, request?.callerContext, 'INVALID_REQUEST', validation.violations.join(' '), null);
  }

  const normalizedRequest = validation.request;
  const authorization = validateCallerAuthorization(
    normalizedRequest.callerContext,
    'WF-CON-001',
    WORKFLOW_AUTHORIZATION_MODEL
  );
  if (!authorization.authorized) {
    return toFailure(normalizedRequest, normalizedRequest.callerContext, 'FORBIDDEN', authorization.reason, null);
  }

  const scopeValidation = getScopeValidation(normalizedRequest);
  if (!scopeValidation.ok) {
    return toFailure(normalizedRequest, normalizedRequest.callerContext, 'FORBIDDEN', scopeValidation.violations[0], null);
  }

  const idempotency = await checkIdempotency(normalizedRequest.idempotencyKey);
  if (idempotency.state === 'succeeded' || idempotency.state === 'failed') {
    return idempotency.cachedResult;
  }

  if (idempotency.state === 'pending') {
    return toFailure(normalizedRequest, normalizedRequest.callerContext, 'DUPLICATE_INVOCATION', 'A matching invocation is already in progress.', null);
  }

  const wrotePending = await markPending(
    normalizedRequest.idempotencyKey,
    'WF-CON-001',
    normalizedRequest.callerContext.tenantId,
    normalizedRequest.input.targetWorkspaceId ?? normalizedRequest.callerContext.workspaceId ?? null,
    null
  );

  if (!wrotePending.written) {
    return toFailure(normalizedRequest, normalizedRequest.callerContext, 'DUPLICATE_INVOCATION', 'A matching invocation is already in progress.', null);
  }

  const affectedResources = [];

  try {
    const assignment = await dependencies.assignRole({
      tenantId: normalizedRequest.callerContext.tenantId,
      workspaceId: normalizedRequest.input.targetWorkspaceId ?? normalizedRequest.callerContext.workspaceId ?? null,
      userId: normalizedRequest.input.userId,
      requestedRole: normalizedRequest.input.requestedRole,
      callerContext: normalizedRequest.callerContext,
      idempotencyKey: normalizedRequest.idempotencyKey
    });
    affectedResources.push({
      type: 'keycloak_role_assignment',
      id: assignment?.assignmentId ?? assignment?.id ?? `kra_${normalizedRequest.input.userId}_${normalizedRequest.input.requestedRole}`
    });

    const membership = await dependencies.activateMembership({
      tenantId: normalizedRequest.callerContext.tenantId,
      workspaceId: normalizedRequest.input.targetWorkspaceId ?? normalizedRequest.callerContext.workspaceId ?? null,
      userId: normalizedRequest.input.userId,
      callerContext: normalizedRequest.callerContext,
      idempotencyKey: normalizedRequest.idempotencyKey
    });
    affectedResources.push({
      type: 'membership_record',
      id: membership?.recordId ?? membership?.id ?? `mbr_${normalizedRequest.input.userId}_${normalizedRequest.input.targetWorkspaceId}`
    });

    const result = {
      workflowId: 'WF-CON-001',
      idempotencyKey: normalizedRequest.idempotencyKey,
      status: 'succeeded',
      jobRef: null,
      output: {
        userId: normalizedRequest.input.userId,
        targetWorkspaceId: normalizedRequest.input.targetWorkspaceId,
        grantedRole: normalizedRequest.input.requestedRole
      }
    };
    const finalized = withAudit(result, normalizedRequest.callerContext, affectedResources);
    await markSucceeded(normalizedRequest.idempotencyKey, finalized);
    return finalized;
  } catch (error) {
    const failedStep = affectedResources.length === 0 ? 'assign_keycloak_role' : 'update_membership_record';
    const message = error?.message ?? 'User approval failed.';
    await markFailed(normalizedRequest.idempotencyKey, {
      code: error?.code ?? 'DOWNSTREAM_UNAVAILABLE',
      message,
      failedStep
    });
    return toFailure(normalizedRequest, normalizedRequest.callerContext, error?.code ?? 'DOWNSTREAM_UNAVAILABLE', message, failedStep);
  }
}
