import * as assignmentRepository from '../repositories/plan-assignment-repository.mjs';

const ERROR_STATUS_CODES = { FORBIDDEN: 403, VALIDATION_ERROR: 400 };

function authorize(params) {
  const actor = params.callerContext?.actor;
  if (!actor?.id) throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
  const scopedTenantId = params.tenantId ?? params.callerContext?.tenantId ?? actor.tenantId;
  if (!scopedTenantId) throw Object.assign(new Error('tenantId is required'), { code: 'VALIDATION_ERROR' });
  if (actor.type === 'tenant-owner' && scopedTenantId !== (params.callerContext?.tenantId ?? actor.tenantId)) throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
  if (actor.type !== 'tenant-owner' && actor.type !== 'superadmin') throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
  return scopedTenantId;
}

export async function main(params = {}, overrides = {}) {
  const db = overrides.db ?? params.db;
  try {
    const tenantId = authorize(params);
    const current = await assignmentRepository.getCurrent(db, tenantId);
    if (!current) return { statusCode: 200, body: { noAssignment: true, tenantId } };
    return { statusCode: 200, body: { assignment: { assignmentId: current.assignmentId, tenantId: current.tenantId, planId: current.planId, effectiveFrom: current.effectiveFrom, assignedBy: current.assignedBy, assignmentMetadata: current.assignmentMetadata }, plan: { id: current.planId, slug: current.planSlug, displayName: current.planDisplayName, description: current.planDescription, capabilities: current.capabilities ?? {}, quotaDimensions: current.quotaDimensions ?? {}, status: current.planStatus } } };
  } catch (error) {
    error.statusCode = error.statusCode ?? ERROR_STATUS_CODES[error.code] ?? 500;
    throw error;
  }
}
