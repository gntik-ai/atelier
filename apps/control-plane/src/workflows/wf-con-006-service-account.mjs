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
  createServiceAccount: keycloakAdmin.createServiceAccount,
  updateServiceAccountScopeBindings: keycloakAdmin.updateServiceAccountScopeBindings,
  regenerateServiceAccountCredentials: keycloakAdmin.regenerateServiceAccountCredentials,
  disableServiceAccount: keycloakAdmin.disableServiceAccount,
  deleteServiceAccount: keycloakAdmin.deleteServiceAccount,
  writeServiceAccountRecord: async () => {
    throw createDependencyError('writeServiceAccountRecord');
  }
};

let dependencies = { ...defaultDependencies };

function withAudit(result, callerContext, affectedResources = []) {
  return {
    ...result,
    auditFields: buildAuditFields('WF-CON-006', callerContext, affectedResources, result.status === 'succeeded' ? 'succeeded' : 'failed')
  };
}

function toFailure(request, callerContext, code, message, failedStep = null) {
  return withAudit(buildErrorResult('WF-CON-006', request?.idempotencyKey ?? 'unknown', code, message, failedStep), callerContext ?? request?.callerContext ?? {}, []);
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

export default async function handleServiceAccountLifecycle(request) {
  const validation = validateInvocationRequest(request);
  if (!validation.ok) {
    return toFailure(request, request?.callerContext, 'INVALID_REQUEST', validation.violations.join(' '), null);
  }

  const normalizedRequest = validation.request;
  const authorization = validateCallerAuthorization(
    normalizedRequest.callerContext,
    'WF-CON-006',
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

  const workspaceId = normalizedRequest.input.targetWorkspaceId ?? normalizedRequest.callerContext.workspaceId ?? null;
  const wrotePending = await markPending(
    normalizedRequest.idempotencyKey,
    'WF-CON-006',
    normalizedRequest.callerContext.tenantId,
    workspaceId,
    null
  );
  if (!wrotePending.written) {
    return toFailure(normalizedRequest, normalizedRequest.callerContext, 'DUPLICATE_INVOCATION', 'A matching invocation is already in progress.', null);
  }

  const affectedResources = [];

  try {
    let output;

    switch (normalizedRequest.input.serviceAccountAction) {
      case 'create': {
        const serviceAccount = await dependencies.createServiceAccount({ request: normalizedRequest, workspaceId });
        affectedResources.push({ type: 'keycloak_service_account', id: serviceAccount?.serviceAccountId ?? 'service-account' });
        const record = await dependencies.writeServiceAccountRecord({ request: normalizedRequest, workspaceId, serviceAccount, action: 'create' });
        affectedResources.push({ type: 'service_account_record', id: record?.recordId ?? serviceAccount?.serviceAccountId ?? 'service-account-record' });
        output = {
          serviceAccountId: serviceAccount?.serviceAccountId ?? record?.serviceAccountId ?? 'service-account',
          workspaceId,
          action: 'create'
        };
        break;
      }
      case 'scope': {
        const scopeBinding = await dependencies.updateServiceAccountScopeBindings({ request: normalizedRequest, workspaceId });
        affectedResources.push({ type: 'keycloak_scope_binding', id: scopeBinding?.bindingId ?? normalizedRequest.input.serviceAccountId ?? 'scope-binding' });
        const record = await dependencies.writeServiceAccountRecord({ request: normalizedRequest, workspaceId, scopeBinding, action: 'scope' });
        affectedResources.push({ type: 'service_account_record', id: record?.recordId ?? normalizedRequest.input.serviceAccountId ?? 'service-account-record' });
        output = {
          serviceAccountId: normalizedRequest.input.serviceAccountId ?? record?.serviceAccountId ?? 'service-account',
          scopeBindings: normalizedRequest.input.scopeBindings ?? [],
          workspaceId,
          action: 'scope'
        };
        break;
      }
      case 'rotate': {
        const rotation = await dependencies.regenerateServiceAccountCredentials({ request: normalizedRequest, workspaceId });
        affectedResources.push({ type: 'keycloak_service_account_credential', id: rotation?.credentialId ?? normalizedRequest.input.serviceAccountId ?? 'service-account-credential' });
        const record = await dependencies.writeServiceAccountRecord({ request: normalizedRequest, workspaceId, rotation, action: 'rotate' });
        affectedResources.push({ type: 'service_account_record', id: record?.recordId ?? normalizedRequest.input.serviceAccountId ?? 'service-account-record' });
        output = {
          serviceAccountId: rotation?.serviceAccountId ?? normalizedRequest.input.serviceAccountId ?? record?.serviceAccountId ?? 'service-account',
          credentialId: rotation?.credentialId ?? record?.credentialId ?? 'service-account-credential',
          rotatedAt: rotation?.rotatedAt ?? new Date().toISOString(),
          credential: rotation?.credential ?? null,
          workspaceId,
          action: 'rotate'
        };
        break;
      }
      case 'deactivate': {
        const deactivation = await dependencies.disableServiceAccount({ request: normalizedRequest, workspaceId });
        affectedResources.push({ type: 'keycloak_service_account', id: deactivation?.serviceAccountId ?? normalizedRequest.input.serviceAccountId ?? 'service-account' });
        const record = await dependencies.writeServiceAccountRecord({ request: normalizedRequest, workspaceId, deactivation, action: 'deactivate' });
        affectedResources.push({ type: 'service_account_record', id: record?.recordId ?? normalizedRequest.input.serviceAccountId ?? 'service-account-record' });
        output = {
          serviceAccountId: deactivation?.serviceAccountId ?? normalizedRequest.input.serviceAccountId ?? record?.serviceAccountId ?? 'service-account',
          state: 'inactive',
          workspaceId,
          action: 'deactivate'
        };
        break;
      }
      case 'delete': {
        const deletion = await dependencies.deleteServiceAccount({ request: normalizedRequest, workspaceId });
        affectedResources.push({ type: 'keycloak_service_account', id: deletion?.serviceAccountId ?? normalizedRequest.input.serviceAccountId ?? 'service-account' });
        const record = await dependencies.writeServiceAccountRecord({ request: normalizedRequest, workspaceId, deletion, action: 'delete' });
        affectedResources.push({ type: 'service_account_record', id: record?.recordId ?? normalizedRequest.input.serviceAccountId ?? 'service-account-record' });
        output = {
          serviceAccountId: deletion?.serviceAccountId ?? normalizedRequest.input.serviceAccountId ?? record?.serviceAccountId ?? 'service-account',
          state: 'deleted',
          workspaceId,
          action: 'delete'
        };
        break;
      }
      default:
        return toFailure(normalizedRequest, normalizedRequest.callerContext, 'INVALID_REQUEST', 'Unsupported serviceAccountAction.', null);
    }

    const finalized = withAudit(
      {
        workflowId: 'WF-CON-006',
        idempotencyKey: normalizedRequest.idempotencyKey,
        status: 'succeeded',
        jobRef: null,
        output
      },
      normalizedRequest.callerContext,
      affectedResources
    );
    await markSucceeded(normalizedRequest.idempotencyKey, finalized);
    return finalized;
  } catch (error) {
    const message = error?.message ?? 'Service-account workflow failed.';
    const failedStep = error?.failedStep ?? error?.step ?? 'write_service_account_record';
    await markFailed(normalizedRequest.idempotencyKey, {
      code: error?.code ?? 'DOWNSTREAM_UNAVAILABLE',
      message,
      failedStep
    });
    return toFailure(normalizedRequest, normalizedRequest.callerContext, error?.code ?? 'DOWNSTREAM_UNAVAILABLE', message, failedStep);
  }
}
