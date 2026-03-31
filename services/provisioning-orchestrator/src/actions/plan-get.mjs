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
    const candidate = params.planIdOrSlug ?? params.planId ?? params.slug;
    if (!candidate) throw Object.assign(new Error('Provide either planId or slug'), { code: 'VALIDATION_ERROR' });
    const looksLikeId = /^pln_|^[0-9a-fA-F-]{8,}$/.test(candidate);
    const plan = looksLikeId ? await planRepository.findById(db, candidate) : await planRepository.findBySlug(db, candidate);
    if (!plan) throw Object.assign(new Error('Plan not found'), { code: 'PLAN_NOT_FOUND' });
    return { statusCode: 200, body: plan };
  } catch (error) {
    error.statusCode = error.statusCode ?? ERROR_STATUS_CODES[error.code] ?? 500;
    throw error;
  }
}
