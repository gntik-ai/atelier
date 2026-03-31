import { randomUUID } from 'node:crypto';

export const DENIAL_TYPES = Object.freeze({
  SCOPE_INSUFFICIENT: 'SCOPE_INSUFFICIENT',
  PLAN_ENTITLEMENT_DENIED: 'PLAN_ENTITLEMENT_DENIED',
  WORKSPACE_SCOPE_MISMATCH: 'WORKSPACE_SCOPE_MISMATCH',
  CONFIG_ERROR: 'CONFIG_ERROR'
});

const REQUIRED_FIELDS = ['tenantId', 'actorId', 'actorType', 'denialType', 'httpMethod', 'requestPath', 'correlationId'];

export function validateScopeEnforcementDenial(record = {}) {
  for (const field of REQUIRED_FIELDS) {
    if (record[field] === undefined || record[field] === null || record[field] === '') {
      throw new TypeError(field);
    }
  }
  if (!Object.values(DENIAL_TYPES).includes(record.denialType)) {
    throw new TypeError('denialType');
  }
  return record;
}

export function createScopeEnforcementDenial({
  tenantId,
  workspaceId = null,
  actorId,
  actorType,
  denialType,
  httpMethod,
  requestPath,
  requiredScopes = [],
  presentedScopes = [],
  missingScopes = [],
  requiredEntitlement = null,
  currentPlanId = null,
  sourceIp = null,
  correlationId,
  deniedAt = new Date().toISOString()
} = {}) {
  return validateScopeEnforcementDenial({
    id: randomUUID(),
    tenantId,
    workspaceId,
    actorId,
    actorType,
    denialType,
    httpMethod,
    requestPath,
    requiredScopes,
    presentedScopes,
    missingScopes,
    requiredEntitlement,
    currentPlanId,
    sourceIp,
    correlationId,
    deniedAt
  });
}
