import * as catalogRepository from '../repositories/boolean-capability-catalog-repository.mjs';
import * as planCapabilityRepository from '../repositories/plan-capability-repository.mjs';
import { buildCapabilityProfile } from '../models/boolean-capability.mjs';

const ERROR_STATUS_CODES = { FORBIDDEN: 403, PLAN_NOT_FOUND: 404 };

function requireSuperadmin(params) {
  const actor = params.callerContext?.actor;
  if (!actor?.id || actor.type !== 'superadmin') throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
}

export async function main(params = {}, overrides = {}) {
  const db = overrides.db ?? params.db;
  try {
    requireSuperadmin(params);
    const plan = await planCapabilityRepository.getPlanCapabilities(db, params.planId);
    if (!plan) throw Object.assign(new Error('Plan not found'), { code: 'PLAN_NOT_FOUND' });
    const activeCatalog = await catalogRepository.listActiveCatalog(db);
    const profile = buildCapabilityProfile(plan.capabilities, activeCatalog);
    return {
      statusCode: 200,
      body: {
        planId: plan.id,
        planSlug: plan.slug,
        planDisplayName: plan.displayName,
        planStatus: plan.status,
        capabilityProfile: profile.filter((entry) => entry.status !== 'orphaned'),
        orphanedCapabilities: profile.filter((entry) => entry.status === 'orphaned')
      }
    };
  } catch (error) {
    error.statusCode = error.statusCode ?? ERROR_STATUS_CODES[error.code] ?? 500;
    throw error;
  }
}
