import { resolveTenantConsumption } from '../repositories/effective-entitlements-repository.mjs';

const ERROR_STATUS_CODES = { FORBIDDEN: 403, TENANT_NOT_FOUND: 404 };

function resolveTenantId(params) {
  const actor = params.callerContext?.actor;
  if (!actor?.id) throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
  if (actor.type === 'superadmin' || actor.type === 'internal') {
    if (!params.tenantId) throw Object.assign(new Error('Tenant not found'), { code: 'TENANT_NOT_FOUND' });
    return params.tenantId;
  }
  const actorTenantId = actor.tenantId ?? actor.tenant?.id ?? params.tenantId;
  const ownerTypes = new Set(['tenant_owner', 'tenant-owner', 'tenant']);
  if (!ownerTypes.has(actor.type) || !actorTenantId || (params.tenantId && params.tenantId !== actorTenantId)) throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
  return actorTenantId;
}

export async function main(params = {}, overrides = {}) {
  const db = overrides.db ?? params.db;
  try {
    const tenantId = resolveTenantId(params);
    const profile = await resolveTenantConsumption(db, tenantId);
    return {
      statusCode: 200,
      body: {
        tenantId,
        snapshotAt: new Date().toISOString(),
        dimensions: profile.quantitativeLimits.map(({ dimensionKey, displayLabel, unit, currentUsage, usageStatus, usageUnknownReason }) => ({ dimensionKey, displayLabel, unit, currentUsage, usageStatus, usageUnknownReason }))
      }
    };
  } catch (error) {
    error.statusCode = error.statusCode ?? ERROR_STATUS_CODES[error.code] ?? 500;
    throw error;
  }
}
