import * as assignmentRepository from '../repositories/plan-assignment-repository.mjs';
import * as catalogRepository from '../repositories/boolean-capability-catalog-repository.mjs';
import * as planCapabilityRepository from '../repositories/plan-capability-repository.mjs';

const ERROR_STATUS_CODES = { FORBIDDEN: 403, TENANT_NOT_FOUND: 404 };
const DEFAULT_CACHE_TTL = 120;

function resolveTenantId(params) {
  const actor = params.callerContext?.actor;
  if (!actor?.id) throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
  if (actor.type === 'superadmin' || actor.type === 'internal') {
    if (!params.tenantId) throw Object.assign(new Error('Tenant not found'), { code: 'TENANT_NOT_FOUND' });
    return params.tenantId;
  }
  if (actor.scopes && Array.isArray(actor.scopes) && actor.scopes.includes('capability:resolve') && params.tenantId) {
    return params.tenantId;
  }
  const actorTenantId = actor.tenantId ?? actor.tenant?.id ?? params.tenantId;
  if (!actorTenantId) throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
  if (params.tenantId && params.tenantId !== actorTenantId) throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
  return actorTenantId;
}

async function loadCapabilityOverrides(db, tenantId) {
  try {
    const result = await db.query(
      'SELECT capability_overrides FROM tenant_plan_adjustments WHERE tenant_id = $1 LIMIT 1',
      [tenantId]
    );
    return (result.rows[0]?.capability_overrides) ?? {};
  } catch (error) {
    if (error.code === '42P01') return {};
    throw error;
  }
}

function resolveEffectiveCapabilities(planCapabilities, overrides, activeCatalog) {
  const capabilities = {};
  for (const entry of activeCatalog) {
    const key = entry.capabilityKey ?? entry.capability_key;
    if (!key) continue;
    const hasOverride = Object.prototype.hasOwnProperty.call(overrides, key);
    if (hasOverride) {
      capabilities[key] = Boolean(overrides[key]);
    } else {
      const hasPlan = Object.prototype.hasOwnProperty.call(planCapabilities, key);
      capabilities[key] = hasPlan
        ? Boolean(planCapabilities[key])
        : Boolean(entry.platformDefault ?? entry.platform_default ?? false);
    }
  }
  return capabilities;
}

export async function main(params = {}, overrides = {}) {
  const db = overrides.db ?? params.db;
  const ttlHint = Number(params.CAPABILITY_CACHE_TTL_SECONDS ?? process.env.CAPABILITY_CACHE_TTL_SECONDS) || DEFAULT_CACHE_TTL;
  try {
    const tenantId = resolveTenantId(params);
    const assignment = await assignmentRepository.getCurrent(db, tenantId);

    if (!assignment) {
      const activeCatalog = await catalogRepository.listActiveCatalog(db);
      const allFalse = {};
      for (const entry of activeCatalog) {
        const key = entry.capabilityKey ?? entry.capability_key;
        if (key) allFalse[key] = false;
      }
      return {
        statusCode: 200,
        body: {
          tenantId,
          planId: null,
          resolvedAt: new Date().toISOString(),
          capabilities: allFalse,
          ttlHint
        }
      };
    }

    const [plan, activeCatalog, capOverrides] = await Promise.all([
      planCapabilityRepository.getPlanCapabilities(db, assignment.planId),
      catalogRepository.listActiveCatalog(db),
      loadCapabilityOverrides(db, tenantId)
    ]);

    const capabilities = resolveEffectiveCapabilities(
      plan?.capabilities ?? {},
      capOverrides,
      activeCatalog
    );

    return {
      statusCode: 200,
      body: {
        tenantId,
        planId: assignment.planId,
        resolvedAt: new Date().toISOString(),
        capabilities,
        ttlHint
      }
    };
  } catch (error) {
    error.statusCode = error.statusCode ?? ERROR_STATUS_CODES[error.code] ?? 500;
    throw error;
  }
}

export { resolveEffectiveCapabilities, resolveTenantId };
