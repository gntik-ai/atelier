import * as catalogRepository from '../repositories/quota-dimension-catalog-repository.mjs';
import * as planLimitsRepository from '../repositories/plan-limits-repository.mjs';
import { formatProfileEntry } from '../models/quota-dimension.mjs';

const ERROR_STATUS_CODES = { FORBIDDEN: 403, PLAN_NOT_FOUND: 404 };

function requireSuperadmin(params) {
  const actor = params.callerContext?.actor;
  if (!actor?.id || actor.type !== 'superadmin') throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
}

export async function main(params = {}, overrides = {}) {
  const db = overrides.db ?? params.db;
  try {
    requireSuperadmin(params);
    const plan = await planLimitsRepository.getPlanById(db, params.planId);
    if (!plan) throw Object.assign(new Error('Plan not found'), { code: 'PLAN_NOT_FOUND' });
    const dimensions = await catalogRepository.listAllDimensions(db);
    return {
      statusCode: 200,
      body: {
        planId: plan.id,
        planSlug: plan.slug,
        planStatus: plan.status,
        profile: dimensions.map((dimension) => formatProfileEntry({
          dimension,
          explicitValue: Object.prototype.hasOwnProperty.call(plan.quotaDimensions, dimension.dimensionKey) ? plan.quotaDimensions[dimension.dimensionKey] : null
        }))
      }
    };
  } catch (error) {
    error.statusCode = error.statusCode ?? ERROR_STATUS_CODES[error.code] ?? 500;
    throw error;
  }
}
