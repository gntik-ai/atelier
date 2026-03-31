import * as assignmentRepository from '../repositories/plan-assignment-repository.mjs';

const ERROR_STATUS_CODES = { FORBIDDEN: 403, VALIDATION_ERROR: 400 };

function requireSuperadmin(params) {
  const actor = params.callerContext?.actor;
  if (!actor?.id || actor.type !== 'superadmin') throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
}

export async function main(params = {}, overrides = {}) {
  const db = overrides.db ?? params.db;
  try {
    requireSuperadmin(params);
    if (!params.tenantId) throw Object.assign(new Error('tenantId is required'), { code: 'VALIDATION_ERROR' });
    const page = Number.parseInt(`${params.page ?? 1}`, 10);
    const pageSize = Number.parseInt(`${params.pageSize ?? 20}`, 10);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw Object.assign(new Error('Invalid pagination'), { code: 'VALIDATION_ERROR' });
    return { statusCode: 200, body: await assignmentRepository.getHistory(db, params.tenantId, { page, pageSize }) };
  } catch (error) {
    error.statusCode = error.statusCode ?? ERROR_STATUS_CODES[error.code] ?? 500;
    throw error;
  }
}
