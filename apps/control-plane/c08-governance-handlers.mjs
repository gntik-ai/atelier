import { randomUUID } from 'node:crypto';
import {
  ENTITY_ID_PATTERNS,
  acceptEntityCommand,
  getEntityProjection,
  ValidationError,
  GovernanceConflictError,
  ReferencedEntityNotFoundError
} from './platform-governance-store.mjs';
import { isPlatformTeam, canMutatePlatform } from './c08-authz.mjs';
import { validateC08Schema, compactValidationMessage, metadataContainsSensitiveKey } from './c08-contracts.mjs';

const ok = (statusCode, body, headers) => ({ statusCode, body, ...(headers ? { headers } : {}) });
const err = (statusCode, code, message) => ({ statusCode, body: { code, message } });

const DESCRIPTORS = Object.freeze({
  deployment_profile: { operationId: 'createDeploymentProfileRecord', requestSchema: 'DeploymentProfileRecordWriteRequest', responseSchema: 'DeploymentProfileRecord', idParam: 'deploymentProfileId' },
  plan: { operationId: 'createCommercialPlan', requestSchema: 'CommercialPlanWriteRequest', responseSchema: 'CommercialPlan', idParam: 'planId' },
  quota_policy: { operationId: 'createQuotaPolicy', requestSchema: 'QuotaPolicyWriteRequest', responseSchema: 'QuotaPolicy', idParam: 'quotaPolicyId' },
  provider_capability: { operationId: 'createProviderCapabilityRecord', requestSchema: 'ProviderCapabilityRecordWriteRequest', responseSchema: 'ProviderCapabilityRecord', idParam: 'providerCapabilityId' },
  platform_user: { operationId: 'createPlatformUser', requestSchema: 'PlatformUserWriteRequest', responseSchema: 'PlatformUser', idParam: 'userId' }
});

function header(ctx, name) {
  const value = ctx.req?.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function correlationId(ctx) {
  const value = ctx.callerContext?.correlationId;
  return typeof value === 'string' && value.length >= 8 && value.length <= 128
    ? value : `cor_${randomUUID().replace(/-/g, '')}`;
}

function requestError(schema, body) {
  const result = validateC08Schema(schema, body);
  if (!result.valid) return err(400, 'VALIDATION_ERROR', compactValidationMessage(result.errors));
  if (metadataContainsSensitiveKey(body?.metadata)) {
    return err(400, 'SENSITIVE_METADATA_REJECTED', 'metadata must not contain credentials or secrets');
  }
  return null;
}

function assertSuccess(schema, body) {
  const result = validateC08Schema(schema, body);
  if (!result.valid) throw Object.assign(new Error(`${schema} projection violates OpenAPI`), {
    code: 'C08_OUTPUT_CONTRACT_VIOLATION', validationErrors: result.errors
  });
}

function mapError(error) {
  if (error instanceof ValidationError) return err(400, error.code ?? 'VALIDATION_ERROR', error.message);
  if (error instanceof ReferencedEntityNotFoundError) return err(404, error.code, error.message);
  if (error instanceof GovernanceConflictError) return err(409, error.code, error.message);
  return null;
}

async function quotaParent(ctx) {
  const planId = String(ctx.params?.planId ?? '');
  if (!ENTITY_ID_PATTERNS.plan.test(planId)) return { error: err(400, 'INVALID_IDENTIFIER', 'malformed planId') };
  const plan = await getEntityProjection(ctx.pool, { entityType: 'plan', entityId: planId });
  if (!plan) return { error: err(404, 'PLAN_NOT_FOUND', `plan ${planId} not found`) };
  return { parentId: planId, entityIdOverride: plan.quotaPolicyId };
}

function platformUserId(body) {
  const ids = new Set([...(body?.tenantMemberships ?? []), ...(body?.workspaceMemberships ?? [])]
    .map((membership) => membership.userId).filter(Boolean));
  if (ids.size > 1) throw new ValidationError('all membership userId fields must identify one user', 'MEMBERSHIP_USER_MISMATCH');
  return ids.size === 1 ? [...ids][0] : null;
}

async function validatePlatformUserReferences(client, body, entityId) {
  const effectiveId = entityId ?? platformUserId(body);
  const tenantIds = [...new Set((body.tenantMemberships ?? []).map((item) => item.tenantId))];
  const workspaceIds = [...new Set((body.workspaceMemberships ?? []).map((item) => item.workspaceId))];
  if (effectiveId && [...(body.tenantMemberships ?? []), ...(body.workspaceMemberships ?? [])]
    .some((item) => item.userId !== effectiveId)) {
    throw new ValidationError('membership userId must equal the platform user id', 'MEMBERSHIP_USER_MISMATCH');
  }
  if (tenantIds.length) {
    const result = await client.query('SELECT id FROM tenants WHERE id = ANY($1::text[])', [tenantIds]);
    if (result.rows.length !== tenantIds.length) throw new ReferencedEntityNotFoundError('one or more tenant memberships reference a missing tenant');
  }
  if (workspaceIds.length) {
    const result = await client.query('SELECT id, tenant_id FROM workspaces WHERE id = ANY($1::text[])', [workspaceIds]);
    if (result.rows.length !== workspaceIds.length) throw new ReferencedEntityNotFoundError('one or more workspace memberships reference a missing workspace');
    if (!(body.platformRoles ?? []).length) {
      const tenants = new Set(tenantIds);
      if (result.rows.some((workspace) => !tenants.has(workspace.tenant_id))) {
        throw new ValidationError('workspace memberships require a membership in the owning tenant', 'MEMBERSHIP_SCOPE_VIOLATION');
      }
    }
  }
  const expectedRealm = process.env.KEYCLOAK_PLATFORM_REALM ?? 'in-falcone-platform';
  if (body.iamBinding && body.iamBinding.realm !== expectedRealm) {
    throw new ValidationError(`iamBinding.realm must be ${expectedRealm}`, 'IAM_REALM_BOUNDARY_VIOLATION');
  }
}

export async function validatePlanCapabilities(client, body) {
  const keys = [...new Set(body.capabilityKeys ?? [])];
  if (!keys.length) return;
  const profileResult = await client.query(
    `SELECT projection FROM platform_governance_entities
      WHERE entity_type = 'deployment_profile' AND entity_id = $1`,
    [body.deploymentProfileId]
  );
  const profile = profileResult.rows[0]?.projection;
  if (!profile) throw new ReferencedEntityNotFoundError(`deployment profile ${body.deploymentProfileId} does not exist`);
  const capabilityIds = [...new Set(profile.providerCapabilityIds ?? [])];
  if (!capabilityIds.length) {
    throw new ValidationError('deployment profile does not bind provider capabilities', 'PLAN_CAPABILITY_UNSUPPORTED');
  }
  const result = await client.query(
    `SELECT entity_id, projection FROM platform_governance_entities
      WHERE entity_type = 'provider_capability' AND entity_id = ANY($1::text[])`,
    [capabilityIds]
  );
  const profileEnvironments = new Set(profile.supportedEnvironments ?? []);
  const supported = new Set(result.rows
    .map((row) => row.projection)
    .filter((capability) => capability?.state === 'active'
      && capability.capabilityStatus === 'available'
      && [...profileEnvironments].every((environment) => (capability.allowedEnvironments ?? []).includes(environment)))
    .map((capability) => capability.capabilityKey));
  const missing = keys.filter((key) => !supported.has(key));
  if (missing.length) {
    throw new ValidationError(
      `capabilityKeys are not active and available through deployment profile ${body.deploymentProfileId}: ${missing.join(', ')}`,
      'PLAN_CAPABILITY_UNSUPPORTED'
    );
  }
}

function createHandler(entityType, { nestedQuota = false } = {}) {
  const descriptor = DESCRIPTORS[entityType];
  return async (ctx) => {
    if (!canMutatePlatform(ctx.identity)) return err(403, 'FORBIDDEN', 'requires platform administration permission');
    const validation = requestError(descriptor.requestSchema, ctx.body);
    if (validation) return validation;
    let parentId = null;
    let entityIdOverride = entityType === 'platform_user' ? platformUserId(ctx.body) : null;
    if (nestedQuota) {
      const parent = await quotaParent(ctx);
      if (parent.error) return parent.error;
      parentId = parent.parentId;
      entityIdOverride = parent.entityIdOverride;
    }
    const client = await ctx.pool.connect();
    try {
      const result = await acceptEntityCommand(client, {
        entityType,
        operationId: descriptor.operationId,
        body: ctx.body,
        idempotencyKey: header(ctx, 'idempotency-key'),
        correlationId: correlationId(ctx),
        actorId: String(ctx.identity.sub),
        parentId,
        entityIdOverride,
        referenceValidator: entityType === 'platform_user'
          ? validatePlatformUserReferences
          : entityType === 'plan' ? validatePlanCapabilities : null
      });
      assertSuccess('MutationAccepted', result.envelope);
      ctx.resolvedScope = { entityType, entityId: result.entityId };
      return ok(202, result.envelope, { 'X-Idempotency-Replayed': String(result.replayed) });
    } catch (error) {
      return mapError(error) ?? Promise.reject(error);
    } finally {
      client.release();
    }
  };
}

function getHandler(entityType, { nestedQuota = false } = {}) {
  const descriptor = DESCRIPTORS[entityType];
  return async (ctx) => {
    if (!isPlatformTeam(ctx.identity)) return err(403, 'FORBIDDEN', 'requires platform read permission');
    const entityId = String(ctx.params?.[descriptor.idParam] ?? '');
    if (!ENTITY_ID_PATTERNS[entityType].test(entityId)) return err(400, 'INVALID_IDENTIFIER', `malformed ${descriptor.idParam}`);
    let parentId = null;
    if (nestedQuota) {
      const parent = await quotaParent(ctx);
      if (parent.error) return parent.error;
      parentId = parent.parentId;
    }
    const projection = await getEntityProjection(ctx.pool, { entityType, entityId, parentId });
    if (!projection) return err(404, `${entityType.toUpperCase()}_NOT_FOUND`, `${descriptor.idParam} ${entityId} not found`);
    assertSuccess(descriptor.responseSchema, projection);
    return ok(200, projection);
  };
}

export { createHandler, getHandler };

export const C08_GOVERNANCE_HANDLERS = Object.freeze({
  createDeploymentProfileRecord: createHandler('deployment_profile'),
  getDeploymentProfileRecord: getHandler('deployment_profile'),
  createCommercialPlan: createHandler('plan'),
  getCommercialPlan: getHandler('plan'),
  createQuotaPolicy: createHandler('quota_policy', { nestedQuota: true }),
  getQuotaPolicy: getHandler('quota_policy', { nestedQuota: true }),
  createProviderCapabilityRecord: createHandler('provider_capability'),
  getProviderCapabilityRecord: getHandler('provider_capability'),
  createPlatformUser: createHandler('platform_user'),
  getPlatformUser: getHandler('platform_user')
});
