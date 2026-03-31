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
    const subQuotas = (db._workspaceSubQuotas ?? []).filter((item) => item.tenantId === tenantId);
    return {
      statusCode: 200,
      body: {
        tenantId,
        dimensions: profile.quantitativeLimits.map((dimension) => {
          const workspaces = subQuotas
            .filter((item) => item.dimensionKey === dimension.dimensionKey)
            .map((item) => ({ workspaceId: item.workspaceId, allocatedValue: Number(item.allocatedValue) }));
          const totalAllocated = workspaces.reduce((sum, item) => sum + item.allocatedValue, 0);
          const unallocated = dimension.effectiveValue === -1 ? null : Math.max(dimension.effectiveValue - totalAllocated, 0);
          return {
            dimensionKey: dimension.dimensionKey,
            displayLabel: dimension.displayLabel,
            unit: dimension.unit,
            tenantEffectiveValue: dimension.effectiveValue,
            totalAllocated,
            unallocated,
            isFullyAllocated: unallocated === 0 && dimension.effectiveValue !== -1,
            workspaces
          };
        })
      }
    };
  } catch (error) {
    error.statusCode = error.statusCode ?? ERROR_STATUS_CODES[error.code] ?? 500;
    throw error;
  }
}
