import * as assignmentRepository from '../repositories/plan-assignment-repository.mjs';
import * as catalogRepository from '../repositories/boolean-capability-catalog-repository.mjs';
import * as planCapabilityRepository from '../repositories/plan-capability-repository.mjs';
import { buildTenantCapabilityView } from '../models/boolean-capability.mjs';

const ERROR_STATUS_CODES = { FORBIDDEN: 403, TENANT_NOT_FOUND: 404 };

function resolveTenantId(params) {
  const actor = params.callerContext?.actor;
  if (!actor?.id) throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
  if (actor.type === 'superadmin' || actor.type === 'internal') {
    if (!params.tenantId) throw Object.assign(new Error('Tenant not found'), { code: 'TENANT_NOT_FOUND' });
    return params.tenantId;
  }
  const actorTenantId = actor.tenantId ?? actor.tenant?.id ?? params.tenantId;
  if (!actorTenantId) throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
  if (params.tenantId && params.tenantId !== actorTenantId) throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
  return actorTenantId;
}

export async function main(params = {}, overrides = {}) {
  const db = overrides.db ?? params.db;
  try {
    const tenantId = resolveTenantId(params);
    const assignment = await assignmentRepository.getCurrent(db, tenantId);
    if (!assignment) return { statusCode: 200, body: { tenantId, noAssignment: true, capabilities: [] } };
    const plan = await planCapabilityRepository.getPlanCapabilities(db, assignment.planId);
    const activeCatalog = await catalogRepository.listActiveCatalog(db);
    return {
      statusCode: 200,
      body: {
        tenantId,
        planSlug: plan?.slug ?? null,
        capabilities: buildTenantCapabilityView(plan?.capabilities ?? {}, activeCatalog)
      }
    };
  } catch (error) {
    error.statusCode = error.statusCode ?? ERROR_STATUS_CODES[error.code] ?? 500;
    throw error;
  }
}
