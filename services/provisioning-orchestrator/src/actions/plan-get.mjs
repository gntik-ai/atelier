import * as planRepository from '../repositories/plan-repository.mjs';

const ERROR_STATUS_CODES = { FORBIDDEN: 403, VALIDATION_ERROR: 400, PLAN_NOT_FOUND: 404 };

function requireAuthorized(params) {
  const actor = params.callerContext?.actor;
  if (!actor?.id) throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
  if (actor.type !== 'superadmin' && actor.type !== 'tenant-owner') throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
}

export async function main(params = {}, overrides = {}) {
  const db = overrides.db ?? params.db;
  try {
    requireAuthorized(params);
    if ((params.planId && params.slug) || (!params.planId && !params.slug)) throw Object.assign(new Error('Provide either planId or slug'), { code: 'VALIDATION_ERROR' });
    const plan = params.planId ? await planRepository.findById(db, params.planId) : await planRepository.findBySlug(db, params.slug);
    if (!plan) throw Object.assign(new Error('Plan not found'), { code: 'PLAN_NOT_FOUND' });
    return { statusCode: 200, body: plan };
  } catch (error) {
    error.statusCode = error.statusCode ?? ERROR_STATUS_CODES[error.code] ?? 500;
    throw error;
  }
}
