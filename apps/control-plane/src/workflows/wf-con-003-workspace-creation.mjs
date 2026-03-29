import * as keycloakAdmin from '../../../../services/adapters/src/keycloak-admin.mjs';
import {
  OPENWHISK_WORKFLOW_ACTION_REFS,
  dispatchWorkflowAction
} from '../../../../services/adapters/src/openwhisk-admin.mjs';
import * as storageTenantContext from '../../../../services/adapters/src/storage-tenant-context.mjs';

import { checkIdempotency, markFailed, markPending, markSucceeded } from './idempotency-store.mjs';
import { queryJobStatus, registerJob, updateJobStatus } from './job-status.mjs';
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
  createClient: keycloakAdmin.createClient,
  writeWorkspaceRecord: async () => {
    throw createDependencyError('writeWorkspaceRecord');
  },
  provisionWorkspaceStorageBoundary: storageTenantContext.provisionWorkspaceStorageBoundary,
  registerJob,
  updateJobStatus,
  dispatchWorkflowAction
};

let dependencies = { ...defaultDependencies };

function withAudit(result, callerContext, affectedResources = []) {
  return {
    ...result,
    auditFields: buildAuditFields('WF-CON-003', callerContext, affectedResources, result.status === 'succeeded' ? 'succeeded' : 'failed')
  };
}

function toFailure(request, callerContext, code, message, failedStep = null) {
  return withAudit(buildErrorResult('WF-CON-003', request?.idempotencyKey ?? 'unknown', code, message, failedStep), callerContext ?? request?.callerContext ?? {}, []);
}

function pendingResult(request, jobRef) {
  return {
    workflowId: 'WF-CON-003',
    idempotencyKey: request.idempotencyKey,
    status: 'pending',
    jobRef
  };
}

export function __setWorkflowDependenciesForTest(overrides = {}) {
  dependencies = { ...dependencies, ...overrides };
}

export function __resetWorkflowDependenciesForTest() {
  dependencies = { ...defaultDependencies };
}

export async function runWorkspaceCreationAction(request) {
  const jobRef = request.jobRef ?? await registerJob('WF-CON-003', request.idempotencyKey, request.callerContext);
  const affectedResources = [];

  try {
    await dependencies.updateJobStatus(jobRef, 'running', null);

    const client = await dependencies.createClient({ request, jobRef });
    affectedResources.push({ type: 'keycloak_client', id: client?.clientId ?? request.input.workspaceSlug ?? 'workspace-client' });

    const workspaceRecord = await dependencies.writeWorkspaceRecord({ request, jobRef, client });
    affectedResources.push({ type: 'workspace_record', id: workspaceRecord?.workspaceId ?? request.input.workspaceSlug ?? 'workspace-record' });

    const storageBoundary = await dependencies.provisionWorkspaceStorageBoundary({ request, jobRef, workspaceRecord, client });
    affectedResources.push({ type: 'workspace_storage_boundary', id: storageBoundary?.boundaryId ?? request.input.workspaceSlug ?? 'workspace-storage-boundary' });

    const result = withAudit(
      {
        workflowId: 'WF-CON-003',
        idempotencyKey: request.idempotencyKey,
        status: 'succeeded',
        jobRef,
        output: {
          workspaceId: workspaceRecord?.workspaceId ?? request.input.workspaceSlug,
          workspaceName: request.input.workspaceName,
          workspaceSlug: request.input.workspaceSlug,
          storageBoundaryId: storageBoundary?.boundaryId ?? null
        }
      },
      request.callerContext,
      affectedResources
    );

    await dependencies.updateJobStatus(jobRef, 'succeeded', result);
    await markSucceeded(request.idempotencyKey, result);
    return result;
  } catch (error) {
    const failedStep = error?.failedStep ?? error?.step ?? (affectedResources.length === 0
      ? 'create_keycloak_client'
      : affectedResources.length === 1
        ? 'write_workspace_record'
        : 'provision_storage_boundary');
    const failure = {
      code: error?.code ?? 'DOWNSTREAM_UNAVAILABLE',
      message: error?.message ?? 'Workspace creation failed.',
      failedStep,
      auditFields: buildAuditFields('WF-CON-003', request.callerContext, affectedResources, 'failed')
    };
    await dependencies.updateJobStatus(jobRef, 'failed', failure);
    await markFailed(request.idempotencyKey, failure);
    return toFailure(request, request.callerContext, failure.code, failure.message, failure.failedStep);
  }
}

export default async function handleWorkspaceCreation(request) {
  const validation = validateInvocationRequest(request);
  if (!validation.ok) {
    return toFailure(request, request?.callerContext, 'INVALID_REQUEST', validation.violations.join(' '), null);
  }

  const normalizedRequest = validation.request;
  const authorization = validateCallerAuthorization(
    normalizedRequest.callerContext,
    'WF-CON-003',
    WORKFLOW_AUTHORIZATION_MODEL
  );
  if (!authorization.authorized) {
    return toFailure(normalizedRequest, normalizedRequest.callerContext, 'FORBIDDEN', authorization.reason, null);
  }

  if (normalizedRequest.callerContext.requestTenantId && normalizedRequest.callerContext.requestTenantId !== normalizedRequest.callerContext.tenantId) {
    return toFailure(normalizedRequest, normalizedRequest.callerContext, 'FORBIDDEN', 'Caller cannot cross tenant boundaries.', null);
  }

  const idempotency = await checkIdempotency(normalizedRequest.idempotencyKey);
  if (idempotency.state === 'succeeded' || idempotency.state === 'failed') {
    return idempotency.cachedResult;
  }

  if (idempotency.state === 'pending') {
    return pendingResult(normalizedRequest, idempotency.jobRef ?? `wf_job_${normalizedRequest.idempotencyKey.replace(/-/g, '')}`);
  }

  const jobRef = await dependencies.registerJob('WF-CON-003', normalizedRequest.idempotencyKey, normalizedRequest.callerContext);
  const wrotePending = await markPending(
    normalizedRequest.idempotencyKey,
    'WF-CON-003',
    normalizedRequest.callerContext.tenantId,
    null,
    jobRef
  );

  if (!wrotePending.written) {
    const current = await queryJobStatus(jobRef, normalizedRequest.callerContext).catch(() => ({ jobRef }));
    return pendingResult(normalizedRequest, current.jobRef ?? jobRef);
  }

  await dependencies.dispatchWorkflowAction(
    normalizedRequest.callerContext.workspaceId ?? normalizedRequest.callerContext.tenantId ?? 'workspace',
    OPENWHISK_WORKFLOW_ACTION_REFS['WF-CON-003'],
    normalizedRequest,
    {
      workflowId: 'WF-CON-003',
      correlationId: normalizedRequest.callerContext.correlationId,
      tenantId: normalizedRequest.callerContext.tenantId,
      workspaceId: normalizedRequest.callerContext.workspaceId ?? null
    }
  );

  return pendingResult(normalizedRequest, jobRef);
}
