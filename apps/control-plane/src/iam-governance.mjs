import {
  filterPublicRoutes,
  getApiFamily,
  getContract,
  getPublicRoute
} from '../../../services/internal-contracts/src/index.mjs';

export const iamGovernanceApiFamily = getApiFamily('iam');
export const iamLifecycleEventContract = getContract('iam_lifecycle_event');
export const iamAuditRecordContract = getContract('audit_record');
export const iamAdminRequestContract = getContract('iam_admin_request');

export const IAM_LIFECYCLE_EVENT_TYPES = Object.freeze([
  'iam.user.login.succeeded',
  'iam.user.logout.completed',
  'iam.user.signup.requested',
  'iam.user.activation.completed',
  'iam.user.status.changed',
  'iam.user.credentials.reset',
  'iam.invitation.created',
  'iam.invitation.accepted',
  'iam.invitation.revoked',
  'iam.tenant.access.suspended',
  'iam.tenant.access.reactivated',
  'iam.service_account.blocked',
  'iam.service_account.reactivated',
  'iam.client.revoked'
]);

export const IAM_TRACEABILITY_OPERATION_IDS = Object.freeze([
  'listTenantIamActivity',
  'listWorkspaceIamActivity'
]);

export const IAM_ADMIN_AUDIT_CONTEXT_FIELDS = Object.freeze([
  'actor_id',
  'actor_type',
  'origin_surface',
  'request_ip',
  'user_agent',
  'target_tenant_id',
  'target_workspace_id'
]);

function unique(values = []) {
  return [...new Set(values)];
}

export function getIamTraceabilityRoute(operationId) {
  const route = getPublicRoute(operationId);
  return route?.family === 'iam' && IAM_TRACEABILITY_OPERATION_IDS.includes(operationId) ? route : undefined;
}

export function listIamTraceabilityRoutes(filters = {}) {
  return filterPublicRoutes({ family: 'iam', ...filters }).filter((route) =>
    IAM_TRACEABILITY_OPERATION_IDS.includes(route.operationId)
  );
}

export function summarizeIamAuditCoverage() {
  const requestFields = new Set(iamAdminRequestContract?.required_fields ?? []);
  const auditFields = new Set(iamAuditRecordContract?.required_fields ?? []);
  const lifecycleFields = new Set(iamLifecycleEventContract?.required_fields ?? []);

  return {
    family: iamGovernanceApiFamily?.id ?? 'iam',
    traceabilityRouteCount: listIamTraceabilityRoutes().length,
    adminContextFields: IAM_ADMIN_AUDIT_CONTEXT_FIELDS.map((field) => ({
      field,
      requestContract: requestFields.has(field),
      auditContract: auditFields.has(field)
    })),
    lifecycleFields: [...lifecycleFields].sort()
  };
}

export function evaluateTenantIamAccess({
  tenantState = 'active',
  principalType = 'user',
  principalState = 'active',
  clientState = 'active',
  credentialState = 'active'
} = {}) {
  if (tenantState === 'suspended') {
    return {
      allowed: false,
      reason: 'tenant_suspended',
      semantics: 'Tenant suspension overrides user and service-account access until reactivation completes.'
    };
  }

  if (principalType === 'user' && principalState !== 'active') {
    return {
      allowed: false,
      reason: 'user_disabled',
      semantics: 'User disablement blocks the human identity only and does not imply tenant-wide suspension.'
    };
  }

  if (principalType === 'service_account' && clientState !== 'active') {
    return {
      allowed: false,
      reason: 'application_revoked',
      semantics: 'Client or application revocation blocks the workload identity without suspending the tenant.'
    };
  }

  if (principalType === 'service_account' && credentialState !== 'active') {
    return {
      allowed: false,
      reason: 'credential_blocked',
      semantics: 'Credential rotation or revocation blocks the current secret material while the service account can remain defined.'
    };
  }

  return {
    allowed: true,
    reason: 'active',
    semantics: 'No lifecycle guard currently blocks access.'
  };
}

export function buildIamLifecycleEvent({
  eventId,
  eventType,
  action,
  outcome = 'applied',
  actor = {},
  target = {},
  auditRecordId,
  correlationId,
  occurredAt = '2026-03-24T00:00:00Z',
  contractVersion = iamLifecycleEventContract?.version ?? '2026-03-24',
  suspensionState,
  metadata = {}
} = {}) {
  if (!IAM_LIFECYCLE_EVENT_TYPES.includes(eventType)) {
    throw new Error(`Unsupported IAM lifecycle event type ${String(eventType)}.`);
  }

  return {
    eventId,
    eventType,
    action,
    outcome,
    actor: {
      actorId: actor.actorId,
      actorType: actor.actorType,
      username: actor.username,
      originSurface: actor.originSurface,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      delegationChain: unique(actor.delegationChain ?? [])
    },
    target: {
      resourceType: target.resourceType,
      resourceId: target.resourceId,
      tenantId: target.tenantId,
      workspaceId: target.workspaceId,
      realmId: target.realmId,
      clientId: target.clientId,
      parentResourceId: target.parentResourceId
    },
    streamDelivery: {
      auditRecordId,
      deliveryMode: 'audit_and_kafka',
      kafkaTopic: 'iam.lifecycle',
      partitionKey: target.tenantId ?? target.resourceId,
      replayToken: `${eventId}:${correlationId}`
    },
    correlationId,
    contractVersion,
    occurredAt,
    suspensionState,
    metadata
  };
}
