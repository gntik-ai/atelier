import * as catalogRepository from '../repositories/quota-dimension-catalog-repository.mjs';
import * as planLimitsRepository from '../repositories/plan-limits-repository.mjs';
import { formatProfileEntry } from '../models/quota-dimension.mjs';

const ERROR_STATUS_CODES = { FORBIDDEN: 403 };

function requireTenantOwner(params) {
  const actor = params.callerContext?.actor;
  if (!actor?.id || actor.type !== 'tenant-owner' || !actor.tenantId) throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
  if (!params.tenantId || actor.tenantId !== params.tenantId) throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
  return actor;
}

export async function main(params = {}, overrides = {}) {
  const db = overrides.db ?? params.db;
  try {
    requireTenantOwner(params);
    const assignment = await planLimitsRepository.getLimitsByTenantCurrentPlan(db, params.tenantId);
    if (!assignment) {
      return { statusCode: 200, body: { tenantId: params.tenantId, noAssignment: true, profile: [] } };
    }
    const dimensions = await catalogRepository.listAllDimensions(db);
    return {
      statusCode: 200,
      body: {
        tenantId: params.tenantId,
        planSlug: assignment.planSlug,
        planStatus: assignment.planStatus,
        profile: dimensions.map((dimension) => formatProfileEntry({
          dimension,
          explicitValue: Object.prototype.hasOwnProperty.call(assignment.quotaDimensions, dimension.dimensionKey) ? assignment.quotaDimensions[dimension.dimensionKey] : null
        }))
      }
    };
  } catch (error) {
    error.statusCode = error.statusCode ?? ERROR_STATUS_CODES[error.code] ?? 500;
    throw error;
  }
}
