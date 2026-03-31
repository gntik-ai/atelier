import * as catalogRepository from '../repositories/quota-dimension-catalog-repository.mjs';
import * as planLimitsRepository from '../repositories/plan-limits-repository.mjs';
import { formatProfileEntry } from '../models/quota-dimension.mjs';

const ERROR_STATUS_CODES = { FORBIDDEN: 403 };

function requireTenantOwner(params) {
  const actor = params.callerContext?.actor;
  const tenantId = params.tenantId ?? params.callerContext?.tenantId ?? actor?.tenantId;
  if (!actor?.id || actor.type !== 'tenant-owner' || !tenantId) throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
  if (tenantId !== (params.callerContext?.tenantId ?? actor.tenantId)) throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
  return tenantId;
}

export async function main(params = {}, overrides = {}) {
  const db = overrides.db ?? params.db;
  try {
    const tenantId = requireTenantOwner(params);
    const assignment = await planLimitsRepository.getLimitsByTenantCurrentPlan(db, tenantId);
    if (!assignment) {
      return { statusCode: 200, body: { tenantId, noAssignment: true, profile: [] } };
    }
    const dimensions = await catalogRepository.listAllDimensions(db);
    return { statusCode: 200, body: { tenantId, planSlug: assignment.planSlug, planStatus: assignment.planStatus, profile: dimensions.map((dimension) => formatProfileEntry({ dimension, explicitValue: Object.prototype.hasOwnProperty.call(assignment.quotaDimensions, dimension.dimensionKey) ? assignment.quotaDimensions[dimension.dimensionKey] : null })) } };
  } catch (error) {
    error.statusCode = error.statusCode ?? ERROR_STATUS_CODES[error.code] ?? 500;
    throw error;
  }
}
