import * as kafkaAdmin from '../../../../services/adapters/src/kafka-admin.mjs';
import * as keycloakAdmin from '../../../../services/adapters/src/keycloak-admin.mjs';
import {
  OPENWHISK_WORKFLOW_ACTION_REFS,
  dispatchWorkflowAction
} from '../../../../services/adapters/src/openwhisk-admin.mjs';

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
  createRealm: keycloakAdmin.createRealm,
  writeTenantRecord: async () => {
    throw createDependencyError('writeTenantRecord');
  },
  createTopicNamespace: kafkaAdmin.createTopicNamespace,
  registerApisixRoutes: async () => {
    throw createDependencyError('registerApisixRoutes');
  },
  registerJob,
  updateJobStatus,
  dispatchWorkflowAction
};

let dependencies = { ...defaultDependencies };

function withAudit(result, callerContext, affectedResources = []) {
  return {
    ...result,
    auditFields: buildAuditFields('WF-CON-002', callerContext, affectedResources, result.status === 'succeeded' ? 'succeeded' : 'failed')
  };
}

function toFailure(request, callerContext, code, message, failedStep = null) {
  return withAudit(buildErrorResult('WF-CON-002', request?.idempotencyKey ?? 'unknown', code, message, failedStep), callerContext ?? request?.callerContext ?? {}, []);
}

function pendingResult(request, jobRef) {
  return {
    workflowId: 'WF-CON-002',
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

export async function runTenantProvisioningAction(request) {
  const jobRef = request.jobRef ?? await registerJob('WF-CON-002', request.idempotencyKey, request.callerContext);
  const affectedResources = [];

  try {
    await dependencies.updateJobStatus(jobRef, 'running', null);

    const realm = await dependencies.createRealm({ request, jobRef });
    affectedResources.push({ type: 'keycloak_realm', id: realm?.realmId ?? request.input.tenantSlug ?? 'tenant-realm' });

    const tenantRecord = await dependencies.writeTenantRecord({ request, jobRef, realm });
    affectedResources.push({ type: 'tenant_record', id: tenantRecord?.tenantId ?? request.input.tenantSlug ?? 'tenant-record' });

    const topicNamespace = await dependencies.createTopicNamespace({ request, jobRef, tenantRecord });
    affectedResources.push({ type: 'kafka_topic_namespace', id: topicNamespace?.namespaceId ?? request.input.tenantSlug ?? 'topic-namespace' });

    const apisixRoute = await dependencies.registerApisixRoutes({ request, jobRef, tenantRecord, topicNamespace });
    affectedResources.push({ type: 'apisix_route_configuration', id: apisixRoute?.routeId ?? request.input.tenantSlug ?? 'apisix-routes' });

    const result = withAudit(
      {
        workflowId: 'WF-CON-002',
        idempotencyKey: request.idempotencyKey,
        status: 'succeeded',
        jobRef,
        output: {
          tenantSlug: request.input.tenantSlug,
          tenantDisplayName: request.input.tenantDisplayName,
          adminEmail: request.input.adminEmail,
          tenantId: tenantRecord?.tenantId ?? request.input.tenantSlug
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
      ? 'create_keycloak_realm'
      : affectedResources.length === 1
        ? 'write_tenant_record'
        : affectedResources.length === 2
          ? 'create_kafka_namespace'
          : 'register_apisix_routes');
    const failure = {
      code: error?.code ?? 'DOWNSTREAM_UNAVAILABLE',
      message: error?.message ?? 'Tenant provisioning failed.',
      failedStep,
      auditFields: buildAuditFields('WF-CON-002', request.callerContext, affectedResources, 'failed')
    };
    await dependencies.updateJobStatus(jobRef, 'failed', failure);
    await markFailed(request.idempotencyKey, failure);
    return toFailure(request, request.callerContext, failure.code, failure.message, failure.failedStep);
  }
}

export default async function handleTenantProvisioning(request) {
  if (request?.callerContext?.actorType !== 'superadmin') {
    return toFailure(request, request?.callerContext, 'FORBIDDEN', 'Superadmin required.', null);
  }

  const validation = validateInvocationRequest(request);
  if (!validation.ok) {
    return toFailure(request, request?.callerContext, 'INVALID_REQUEST', validation.violations.join(' '), null);
  }

  const normalizedRequest = validation.request;
  const authorization = validateCallerAuthorization(
    normalizedRequest.callerContext,
    'WF-CON-002',
    WORKFLOW_AUTHORIZATION_MODEL
  );
  if (!authorization.authorized) {
    return toFailure(normalizedRequest, normalizedRequest.callerContext, 'FORBIDDEN', authorization.reason, null);
  }

  const idempotency = await checkIdempotency(normalizedRequest.idempotencyKey);
  if (idempotency.state === 'succeeded' || idempotency.state === 'failed') {
    return idempotency.cachedResult;
  }

  if (idempotency.state === 'pending') {
    return pendingResult(normalizedRequest, idempotency.jobRef ?? `wf_job_${normalizedRequest.idempotencyKey.replace(/-/g, '')}`);
  }

  const jobRef = await dependencies.registerJob('WF-CON-002', normalizedRequest.idempotencyKey, normalizedRequest.callerContext);
  const wrotePending = await markPending(
    normalizedRequest.idempotencyKey,
    'WF-CON-002',
    normalizedRequest.callerContext.tenantId ?? 'superadmin',
    null,
    jobRef
  );

  if (!wrotePending.written) {
    const current = await queryJobStatus(jobRef, normalizedRequest.callerContext).catch(() => ({ jobRef }));
    return pendingResult(normalizedRequest, current.jobRef ?? jobRef);
  }

  await dependencies.dispatchWorkflowAction(
    normalizedRequest.callerContext.workspaceId ?? normalizedRequest.callerContext.tenantId ?? 'platform',
    OPENWHISK_WORKFLOW_ACTION_REFS['WF-CON-002'],
    normalizedRequest,
    {
      workflowId: 'WF-CON-002',
      correlationId: normalizedRequest.callerContext.correlationId,
      tenantId: normalizedRequest.callerContext.tenantId ?? 'superadmin',
      workspaceId: normalizedRequest.callerContext.workspaceId ?? null
    }
  );

  return pendingResult(normalizedRequest, jobRef);
}
