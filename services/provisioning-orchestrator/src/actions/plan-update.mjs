import { randomUUID } from 'node:crypto';
import * as planRepository from '../repositories/plan-repository.mjs';
import { emitPlanEvent } from '../events/plan-events.mjs';

const ERROR_STATUS_CODES = { FORBIDDEN: 403, VALIDATION_ERROR: 400, PLAN_NOT_FOUND: 404, PLAN_ARCHIVED: 409 };

function requireSuperadmin(params) {
  const actor = params.callerContext?.actor;
  if (!actor?.id || actor.type !== 'superadmin') throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
  return actor;
}

async function insertAudit(db, input) {
  await db.query(
    `INSERT INTO plan_audit_events (action_type, actor_id, tenant_id, plan_id, previous_state, new_state, correlation_id)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`,
    [input.actionType, input.actorId, input.tenantId ?? null, input.planId ?? null, JSON.stringify(input.previousState), JSON.stringify(input.newState), input.correlationId]
  );
}

export async function main(params = {}, overrides = {}) {
  const db = overrides.db ?? params.db;
  const producer = overrides.producer ?? params.producer;
  try {
    const actor = requireSuperadmin(params);
    const updates = {
      displayName: params.displayName,
      description: params.description,
      capabilities: params.capabilities,
      quotaDimensions: params.quotaDimensions,
      updatedBy: actor.id
    };
    if (Object.values(updates).slice(0, 4).every((value) => value === undefined)) throw Object.assign(new Error('No updates provided'), { code: 'VALIDATION_ERROR' });
    const result = await planRepository.update(db, params.planId, updates);
    const correlationId = params.correlationId ?? randomUUID();
    await insertAudit(db, { actionType: 'plan.updated', actorId: actor.id, planId: params.planId, previousState: result.previous, newState: result.current, correlationId });
    await emitPlanEvent(producer, 'plan.updated', { correlationId, actorId: actor.id, planId: params.planId, previousState: result.previous, newState: result.current });
    return { statusCode: 200, body: result.current };
  } catch (error) {
    error.statusCode = error.statusCode ?? ERROR_STATUS_CODES[error.code] ?? 500;
    throw error;
  }
}
