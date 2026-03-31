import { randomUUID } from 'node:crypto';
import * as planRepository from '../repositories/plan-repository.mjs';
import * as assignmentRepository from '../repositories/plan-assignment-repository.mjs';
import { emitPlanEvent } from '../events/plan-events.mjs';

const ERROR_STATUS_CODES = { FORBIDDEN: 403, VALIDATION_ERROR: 400, PLAN_NOT_FOUND: 404, PLAN_NOT_ACTIVE: 409, CONCURRENT_ASSIGNMENT_CONFLICT: 409, TENANT_NOT_FOUND: 404 };

function requireSuperadmin(params) {
  const actor = params.callerContext?.actor;
  if (!actor?.id || actor.type !== 'superadmin') throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
  return actor;
}

async function ensureTenantExists(db, tenantId) {
  if (!tenantId) throw Object.assign(new Error('tenantId is required'), { code: 'VALIDATION_ERROR' });
  try {
    const { rows } = await db.query('SELECT 1 AS present FROM tenants WHERE id = $1 OR tenant_id = $1 LIMIT 1', [tenantId]);
    if (!rows.length) throw Object.assign(new Error('Tenant not found'), { code: 'TENANT_NOT_FOUND' });
  } catch (error) {
    if (error.code === '42P01') return true;
    throw error;
  }
  return true;
}

async function insertAudit(db, input) {
  await db.query(
    `INSERT INTO plan_audit_events (action_type, actor_id, tenant_id, plan_id, previous_state, new_state, correlation_id)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`,
    [input.actionType, input.actorId, input.tenantId ?? null, input.planId ?? null, input.previousState ? JSON.stringify(input.previousState) : null, JSON.stringify(input.newState), input.correlationId]
  );
}

export async function main(params = {}, overrides = {}) {
  const db = overrides.db ?? params.db;
  const producer = overrides.producer ?? params.producer;
  try {
    const actor = requireSuperadmin(params);
    if (!params.planId || !params.tenantId || !params.assignedBy) throw Object.assign(new Error('tenantId, planId, assignedBy are required'), { code: 'VALIDATION_ERROR' });
    await ensureTenantExists(db, params.tenantId);
    const plan = await planRepository.findById(db, params.planId);
    if (!plan) throw Object.assign(new Error('Plan not found'), { code: 'PLAN_NOT_FOUND' });
    if (plan.status !== 'active') throw Object.assign(new Error('Plan is not active'), { code: 'PLAN_NOT_ACTIVE' });
    const result = await assignmentRepository.assign(db, { tenantId: params.tenantId, planId: params.planId, assignedBy: params.assignedBy, assignmentMetadata: params.assignmentMetadata ?? {} });
    const correlationId = params.correlationId ?? randomUUID();
    if (result.previousPlanId) {
      await insertAudit(db, { actionType: 'assignment.superseded', actorId: actor.id, tenantId: params.tenantId, planId: result.previousPlanId, previousState: { tenantId: params.tenantId, planId: result.previousPlanId }, newState: { tenantId: params.tenantId, supersededByPlanId: params.planId }, correlationId });
      await emitPlanEvent(producer, 'assignment.superseded', { correlationId, actorId: actor.id, tenantId: params.tenantId, planId: result.previousPlanId, previousState: { tenantId: params.tenantId, planId: result.previousPlanId }, newState: { tenantId: params.tenantId, supersededByPlanId: params.planId } });
    }
    await insertAudit(db, { actionType: 'assignment.created', actorId: actor.id, tenantId: params.tenantId, planId: params.planId, previousState: result.previousPlanId ? { tenantId: params.tenantId, planId: result.previousPlanId } : null, newState: result.assignment, correlationId });
    await emitPlanEvent(producer, 'assignment.created', { correlationId, actorId: actor.id, tenantId: params.tenantId, planId: params.planId, previousState: result.previousPlanId ? { tenantId: params.tenantId, planId: result.previousPlanId } : null, newState: result.assignment });
    return { statusCode: 200, body: { assignmentId: result.assignment.assignmentId, tenantId: result.assignment.tenantId, planId: result.assignment.planId, effectiveFrom: result.assignment.effectiveFrom, previousPlanId: result.previousPlanId } };
  } catch (error) {
    error.statusCode = error.statusCode ?? ERROR_STATUS_CODES[error.code] ?? 500;
    throw error;
  }
}
