import * as planRepository from '../repositories/plan-repository.mjs';

const ERROR_STATUS_CODES = { FORBIDDEN: 403, VALIDATION_ERROR: 400 };
const ALLOWED_STATUSES = new Set(['draft', 'active', 'deprecated', 'archived']);

function requireSuperadmin(params) {
  const actor = params.callerContext?.actor;
  if (!actor?.id || actor.type !== 'superadmin') throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
}

export async function main(params = {}, overrides = {}) {
  const db = overrides.db ?? params.db;
  try {
    requireSuperadmin(params);
    const page = Number.parseInt(`${params.page ?? 1}`, 10);
    const pageSize = Number.parseInt(`${params.pageSize ?? 20}`, 10);
    if (!Number.isInteger(page) || page < 1) throw Object.assign(new Error('page must be >= 1'), { code: 'VALIDATION_ERROR' });
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw Object.assign(new Error('pageSize must be 1..100'), { code: 'VALIDATION_ERROR' });
    if (params.status && !ALLOWED_STATUSES.has(params.status)) throw Object.assign(new Error('invalid status filter'), { code: 'VALIDATION_ERROR' });
    return { statusCode: 200, body: await planRepository.list(db, { status: params.status, page, pageSize }) };
  } catch (error) {
    error.statusCode = error.statusCode ?? ERROR_STATUS_CODES[error.code] ?? 500;
    throw error;
  }
}
