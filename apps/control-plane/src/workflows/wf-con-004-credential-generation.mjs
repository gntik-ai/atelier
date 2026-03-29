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
  }
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
      const credential = await dependencies.rotateCredential({ request: normalizedRequest });
      affectedResources.push({ type: 'keycloak_credential', id: credential?.credentialId ?? normalizedRequest.input.credentialId ?? 'rotated-credential' });
      await dependencies.updateGatewayCredential({ request: normalizedRequest, credential });
      affectedResources.push({ type: 'apisix_consumer_key', id: credential?.consumerKeyId ?? credential?.credentialId ?? 'gateway-consumer-key' });
      const metadata = await dependencies.writeCredentialMetadata({ request: normalizedRequest, credential, action: 'rotate' });
      affectedResources.push({ type: 'credential_metadata_record', id: metadata?.recordId ?? credential?.credentialId ?? 'credential-metadata' });
      output = {
        credentialId: credential?.credentialId ?? metadata?.credentialId ?? normalizedRequest.input.credentialId ?? 'credential-rotated',
        credentialType: credential?.credentialType ?? 'client_secret',
        targetWorkspaceId: normalizedRequest.input.targetWorkspaceId,
        rotatedAt: credential?.rotatedAt ?? new Date().toISOString(),
        credential: credential?.credential ?? null,
        action: 'rotate'
      };
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
