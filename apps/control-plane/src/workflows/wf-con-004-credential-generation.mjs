import * as keycloakAdmin from '../../../../services/adapters/src/keycloak-admin.mjs';
import { createRotationStateRecord } from '../../../../services/provisioning-orchestrator/src/models/credential-rotation-state.mjs';
import { createRotationHistoryRecord } from '../../../../services/provisioning-orchestrator/src/models/credential-rotation-history.mjs';
import { enforceRotationPolicy } from '../../../../services/provisioning-orchestrator/src/models/tenant-rotation-policy.mjs';

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
  generateCredential: keycloakAdmin.generateClientCredential,
  rotateCredential: keycloakAdmin.rotateClientCredential,
  revokeCredential: keycloakAdmin.revokeClientCredential,
  registerGatewayCredential: async () => {
    throw createDependencyError('registerGatewayCredential');
  },
  updateGatewayCredential: async () => {
    throw createDependencyError('updateGatewayCredential');
  },
  removeGatewayCredential: async () => {
    throw createDependencyError('removeGatewayCredential');
  },
  writeCredentialMetadata: async () => {
    throw createDependencyError('writeCredentialMetadata');
  },
  writeRotationState: async ({ record }) => record,
  writeRotationHistory: async ({ record }) => record,
  getInProgressRotation: async () => null,
  countActiveCredentials: async () => 1,
  getTenantRotationPolicy: async () => null,
  publishRotationEvent: async () => {},
  completeRotation: async ({ rotation }) => rotation,
  getDbClient: async () => null,
  upsertTenantRotationPolicy: async ({ policy }) => policy
};

let dependencies = { ...defaultDependencies };

function withAudit(result, callerContext, affectedResources = []) {
  return {
    ...result,
    auditFields: buildAuditFields('WF-CON-004', callerContext, affectedResources, result.status === 'succeeded' ? 'succeeded' : 'failed')
  };
}

function toFailure(request, callerContext, code, message, failedStep = null) {
  return withAudit(buildErrorResult('WF-CON-004', request?.idempotencyKey ?? 'unknown', code, message, failedStep), callerContext ?? request?.callerContext ?? {}, []);
}

function getScopeValidation(request) {
  return validateConsoleBackendScope({
    ...request.callerContext,
    requestTenantId: request.callerContext.requestTenantId ?? request.input.targetTenantId ?? request.callerContext.tenantId,
    requestWorkspaceId: request.callerContext.requestWorkspaceId ?? request.input.targetWorkspaceId ?? request.callerContext.workspaceId
  });
}

function baseResult(request, output) {
  return {
    workflowId: 'WF-CON-004',
    idempotencyKey: request.idempotencyKey,
    status: 'succeeded',
    jobRef: null,
    output
  };
}

export function __setWorkflowDependenciesForTest(overrides = {}) {
  dependencies = { ...dependencies, ...overrides };
}

export function __resetWorkflowDependenciesForTest() {
  dependencies = { ...defaultDependencies };
}

export default async function handleCredentialGeneration(request) {
  const validation = validateInvocationRequest(request);
  if (!validation.ok) {
    return toFailure(request, request?.callerContext, 'INVALID_REQUEST', validation.violations.join(' '), null);
  }

  const normalizedRequest = validation.request;
  const authorization = validateCallerAuthorization(
    normalizedRequest.callerContext,
    'WF-CON-004',
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
    'WF-CON-004',
    normalizedRequest.callerContext.tenantId,
    normalizedRequest.input.targetWorkspaceId ?? normalizedRequest.callerContext.workspaceId ?? null,
    null
  );
  if (!wrotePending.written) {
    return toFailure(normalizedRequest, normalizedRequest.callerContext, 'DUPLICATE_INVOCATION', 'A matching invocation is already in progress.', null);
  }

  const affectedResources = [];

  try {
    let output;
    let failedStep = null;

    if (normalizedRequest.input.credentialAction === 'generate') {
      const credential = await dependencies.generateCredential({ request: normalizedRequest });
      affectedResources.push({ type: 'keycloak_credential', id: credential?.credentialId ?? 'generated-credential' });
      await dependencies.registerGatewayCredential({ request: normalizedRequest, credential });
      affectedResources.push({ type: 'apisix_consumer_key', id: credential?.consumerKeyId ?? credential?.credentialId ?? 'gateway-consumer-key' });
      const metadata = await dependencies.writeCredentialMetadata({ request: normalizedRequest, credential, action: 'generate' });
      affectedResources.push({ type: 'credential_metadata_record', id: metadata?.recordId ?? credential?.credentialId ?? 'credential-metadata' });
      output = {
        credentialId: credential?.credentialId ?? metadata?.credentialId ?? 'credential-generated',
        credentialType: credential?.credentialType ?? 'client_secret',
        targetWorkspaceId: normalizedRequest.input.targetWorkspaceId,
        credential: credential?.credential ?? null,
        action: 'generate'
      };
    } else if (normalizedRequest.input.credentialAction === 'rotate') {
      const gracePeriodSeconds = Number.isInteger(normalizedRequest.input.gracePeriodSeconds) ? normalizedRequest.input.gracePeriodSeconds : 0;
      const currentPolicy = await dependencies.getTenantRotationPolicy({ request: normalizedRequest, tenantId: normalizedRequest.callerContext.tenantId });
      enforceRotationPolicy(currentPolicy, gracePeriodSeconds);
      const activeCount = await dependencies.countActiveCredentials({ request: normalizedRequest, serviceAccountId: normalizedRequest.input.serviceAccountId });
      const maxActiveCredentials = normalizedRequest.input.maxActiveCredentials ?? 3;
      if (activeCount >= maxActiveCredentials) {
        const error = new Error('Credential limit exceeded');
        error.code = 'CREDENTIAL_LIMIT_EXCEEDED';
        error.failedStep = 'count_active_credentials';
        throw error;
      }
      const inProgress = await dependencies.getInProgressRotation({ request: normalizedRequest, serviceAccountId: normalizedRequest.input.serviceAccountId });
      if (inProgress) {
        const error = new Error('A rotation is already in progress');
        error.code = 'ROTATION_IN_PROGRESS';
        error.failedStep = 'check_in_progress_rotation';
        throw error;
      }

      const credential = await dependencies.rotateCredential({ request: normalizedRequest, additive: gracePeriodSeconds > 0 });
      affectedResources.push({ type: 'keycloak_credential', id: credential?.credentialId ?? normalizedRequest.input.credentialId ?? 'rotated-credential' });
      await dependencies.updateGatewayCredential({ request: normalizedRequest, credential, mode: gracePeriodSeconds > 0 ? 'dual-key' : 'replace' });
      affectedResources.push({ type: 'apisix_consumer_key', id: credential?.consumerKeyId ?? credential?.credentialId ?? 'gateway-consumer-key' });
      const metadata = await dependencies.writeCredentialMetadata({ request: normalizedRequest, credential, action: 'rotate' });
      affectedResources.push({ type: 'credential_metadata_record', id: metadata?.recordId ?? credential?.credentialId ?? 'credential-metadata' });

      if (gracePeriodSeconds > 0) {
        const record = createRotationStateRecord({
          tenantId: normalizedRequest.callerContext.tenantId,
          workspaceId: normalizedRequest.input.targetWorkspaceId,
          serviceAccountId: normalizedRequest.input.serviceAccountId,
          newCredentialId: credential?.credentialId ?? 'credential-rotated',
          oldCredentialId: normalizedRequest.input.credentialId ?? 'credential-old',
          rotationType: 'grace_period',
          gracePeriodSeconds,
          initiatedBy: normalizedRequest.callerContext.actor
        });
        const persisted = await dependencies.writeRotationState({ request: normalizedRequest, record });
        await dependencies.publishRotationEvent({
          topic: 'console.credential-rotation.initiated',
          payload: {
            tenantId: normalizedRequest.callerContext.tenantId,
            workspaceId: normalizedRequest.input.targetWorkspaceId,
            serviceAccountId: normalizedRequest.input.serviceAccountId,
            rotationType: 'grace_period',
            gracePeriodSeconds,
            actorId: normalizedRequest.callerContext.actor,
            newCredentialId: record.new_credential_id,
            oldCredentialId: record.old_credential_id
          }
        });
        output = {
          rotationStateId: persisted?.id ?? record.id,
          credentialId: credential?.credentialId ?? metadata?.credentialId ?? normalizedRequest.input.credentialId ?? 'credential-rotated',
          newCredentialId: credential?.credentialId ?? record.new_credential_id,
          oldCredentialId: normalizedRequest.input.credentialId ?? record.old_credential_id,
          deprecatedExpiresAt: persisted?.deprecated_expires_at ?? record.deprecated_expires_at,
          credentialType: credential?.credentialType ?? 'client_secret',
          targetWorkspaceId: normalizedRequest.input.targetWorkspaceId,
          rotatedAt: credential?.rotatedAt ?? new Date().toISOString(),
          credential: credential?.credential ?? null,
          action: 'rotate'
        };
      } else {
        const immediateRotationContext = normalizedRequest.input.serviceAccountId
          ? createRotationHistoryRecord({
              tenantId: normalizedRequest.callerContext.tenantId,
              workspaceId: normalizedRequest.input.targetWorkspaceId,
              serviceAccountId: normalizedRequest.input.serviceAccountId,
              rotationType: 'immediate',
              gracePeriodSeconds: 0,
              oldCredentialId: normalizedRequest.input.credentialId ?? null,
              newCredentialId: credential?.credentialId ?? null,
              initiatedBy: normalizedRequest.callerContext.actor,
              completedAt: new Date().toISOString(),
              completedBy: normalizedRequest.callerContext.actor,
              completionReason: 'immediate'
            })
          : null;
        if (immediateRotationContext) {
          await dependencies.writeRotationHistory({ request: normalizedRequest, record: immediateRotationContext });
        }
        await dependencies.publishRotationEvent({
          topic: 'console.credential-rotation.initiated',
          payload: {
            tenantId: normalizedRequest.callerContext.tenantId,
            workspaceId: normalizedRequest.input.targetWorkspaceId,
            serviceAccountId: normalizedRequest.input.serviceAccountId ?? null,
            rotationType: 'immediate',
            gracePeriodSeconds: 0,
            actorId: normalizedRequest.callerContext.actor,
            newCredentialId: immediateRotationContext?.new_credential_id ?? credential?.credentialId ?? null,
            oldCredentialId: immediateRotationContext?.old_credential_id ?? normalizedRequest.input.credentialId ?? null
          }
        });
        output = {
          credentialId: credential?.credentialId ?? metadata?.credentialId ?? normalizedRequest.input.credentialId ?? 'credential-rotated',
          credentialType: credential?.credentialType ?? 'client_secret',
          targetWorkspaceId: normalizedRequest.input.targetWorkspaceId,
          rotatedAt: credential?.rotatedAt ?? new Date().toISOString(),
          credential: credential?.credential ?? null,
          action: 'rotate'
        };
      }
    } else if (normalizedRequest.input.credentialAction === 'force-complete-rotation') {
      const rotation = await dependencies.getInProgressRotation({ request: normalizedRequest, serviceAccountId: normalizedRequest.input.serviceAccountId });
      if (!rotation) {
        const error = new Error('No in-progress rotation found');
        error.code = 'ROTATION_NOT_FOUND';
        error.failedStep = 'load_rotation_state';
        throw error;
      }
      await dependencies.revokeCredential({ request: normalizedRequest, credentialId: rotation.old_credential_id });
      await dependencies.removeGatewayCredential({ request: normalizedRequest, credentialId: rotation.old_credential_id });
      const completed = await dependencies.completeRotation({ request: normalizedRequest, id: rotation.id, completedBy: normalizedRequest.callerContext.actor, completionReason: 'force_completed' });
      await dependencies.writeRotationHistory({ request: normalizedRequest, record: createRotationHistoryRecord({
        tenantId: rotation.tenant_id,
        workspaceId: rotation.workspace_id,
        serviceAccountId: rotation.service_account_id,
        rotationStateId: rotation.id,
        rotationType: rotation.rotation_type,
        gracePeriodSeconds: rotation.grace_period_seconds,
        oldCredentialId: rotation.old_credential_id,
        newCredentialId: rotation.new_credential_id,
        initiatedBy: rotation.initiated_by,
        initiatedAt: rotation.initiated_at,
        completedAt: completed?.completed_at ?? new Date().toISOString(),
        completedBy: normalizedRequest.callerContext.actor,
        completionReason: 'force_completed'
      }) });
      await dependencies.publishRotationEvent({ topic: 'console.credential-rotation.force-completed', payload: rotation });
      output = {
        rotationStateId: rotation.id,
        action: 'force-complete-rotation',
        oldCredentialId: rotation.old_credential_id,
        newCredentialId: rotation.new_credential_id,
        completedAt: completed?.completed_at ?? new Date().toISOString()
      };
    } else if (normalizedRequest.input.credentialAction === 'set-tenant-rotation-policy') {
      const policy = await dependencies.upsertTenantRotationPolicy({ request: normalizedRequest, policy: normalizedRequest.input.policy });
      output = { action: 'set-tenant-rotation-policy', policy };
    } else {
      const credential = await dependencies.revokeCredential({ request: normalizedRequest });
      affectedResources.push({ type: 'keycloak_credential', id: credential?.credentialId ?? normalizedRequest.input.credentialId ?? 'revoked-credential' });
      await dependencies.removeGatewayCredential({ request: normalizedRequest, credential });
      affectedResources.push({ type: 'apisix_consumer_key', id: credential?.consumerKeyId ?? credential?.credentialId ?? 'gateway-consumer-key' });
      const metadata = await dependencies.writeCredentialMetadata({ request: normalizedRequest, credential, action: 'revoke' });
      affectedResources.push({ type: 'credential_metadata_record', id: metadata?.recordId ?? credential?.credentialId ?? 'credential-metadata' });
      output = {
        credentialId: credential?.credentialId ?? metadata?.credentialId ?? normalizedRequest.input.credentialId ?? 'credential-revoked',
        credentialType: credential?.credentialType ?? 'client_secret',
        targetWorkspaceId: normalizedRequest.input.targetWorkspaceId,
        credential: null,
        action: 'revoke'
      };
    }

    const finalized = withAudit(baseResult(normalizedRequest, output), normalizedRequest.callerContext, affectedResources);
    await markSucceeded(normalizedRequest.idempotencyKey, finalized);
    return finalized;
  } catch (error) {
    const message = error?.message ?? 'Credential workflow failed.';
    const stepMap = {
      generateCredential: 'generate_keycloak_credential',
      rotateCredential: 'rotate_keycloak_credential',
      revokeCredential: 'revoke_keycloak_credential'
    };
    const failedStep = error?.failedStep ?? error?.step ?? 'update_credential_metadata';
    await markFailed(normalizedRequest.idempotencyKey, {
      code: error?.code ?? 'DOWNSTREAM_UNAVAILABLE',
      message,
      failedStep
    });
    return toFailure(normalizedRequest, normalizedRequest.callerContext, error?.code ?? 'DOWNSTREAM_UNAVAILABLE', message, failedStep);
  }
}
