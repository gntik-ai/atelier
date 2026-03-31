import { randomUUID } from 'node:crypto';
import { Plan } from '../models/plan.mjs';
import * as planRepository from '../repositories/plan-repository.mjs';
import * as assignmentRepository from '../repositories/plan-assignment-repository.mjs';
import { emitPlanEvent } from '../events/plan-events.mjs';

const ERROR_STATUS_CODES = { FORBIDDEN: 403, VALIDATION_ERROR: 400, PLAN_NOT_FOUND: 404, INVALID_TRANSITION: 409, PLAN_HAS_ACTIVE_ASSIGNMENTS: 409 };

function requireSuperadmin(params) {
  const actor = params.callerContext?.actor;
  if (!actor?.id || actor.type !== 'superadmin') throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
  return actor;
}

async function insertAudit(db, input) {
  await db.query(
    `INSERT INTO plan_audit_events (action_type, actor_id, tenant_id, plan_id, previous_state, new_state, correlation_id)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`,
    [input.actionType, input.actorId, null, input.planId, JSON.stringify(input.previousState), JSON.stringify(input.newState), input.correlationId]
  );
}

export async function main(params = {}, overrides = {}) {
  const db = overrides.db ?? params.db;
  const producer = overrides.producer ?? params.producer;
  try {
    const actor = requireSuperadmin(params);
    if (!params.planId || !params.targetStatus) throw Object.assign(new Error('planId and targetStatus are required'), { code: 'VALIDATION_ERROR' });
    const existing = await planRepository.findById(db, params.planId);
    if (!existing) throw Object.assign(new Error('Plan not found'), { code: 'PLAN_NOT_FOUND' });
    if (!Plan.canTransition(existing.status, params.targetStatus)) throw Object.assign(new Error('Invalid transition'), { code: 'INVALID_TRANSITION', currentStatus: existing.status, targetStatus: params.targetStatus });
    if (params.targetStatus === 'archived') {
      const activeAssignments = await assignmentRepository.hasActiveAssignments(db, params.planId);
      if (activeAssignments.hasAssignments) throw Object.assign(new Error('Plan has active assignments'), { code: 'PLAN_HAS_ACTIVE_ASSIGNMENTS', blockingTenants: activeAssignments.blockingTenants });
    }
    const result = await planRepository.transitionStatus(db, params.planId, params.targetStatus);
    const correlationId = params.correlationId ?? randomUUID();
    await insertAudit(db, { actionType: 'plan.lifecycle_transitioned', actorId: actor.id, planId: params.planId, previousState: { status: result.previous.status }, newState: { status: result.current.status }, correlationId });
    await emitPlanEvent(producer, 'plan.lifecycle_transitioned', { correlationId, actorId: actor.id, planId: params.planId, previousState: { status: result.previous.status }, newState: { status: result.current.status } });
    return { statusCode: 200, body: { planId: result.current.id, previousStatus: result.previous.status, newStatus: result.current.status, transitionedAt: result.current.updatedAt } };
  } catch (error) {
    error.statusCode = error.statusCode ?? ERROR_STATUS_CODES[error.code] ?? 500;
    throw error;
  }
}
