import { randomUUID } from 'node:crypto';
import { Plan } from '../models/plan.mjs';
import * as planRepository from '../repositories/plan-repository.mjs';
import { emitPlanEvent } from '../events/plan-events.mjs';

const ERROR_STATUS_CODES = { INVALID_SLUG: 400, VALIDATION_ERROR: 400, PLAN_SLUG_CONFLICT: 409, FORBIDDEN: 403 };

function requireSuperadmin(params) {
  const actor = params.callerContext?.actor;
  if (!actor?.id || actor.type !== 'superadmin') throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
  return actor;
}

async function insertAudit(db, { actionType, actorId, tenantId = null, planId = null, previousState = null, newState, correlationId }) {
  await db.query(
    `INSERT INTO plan_audit_events (action_type, actor_id, tenant_id, plan_id, previous_state, new_state, correlation_id)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`,
    [actionType, actorId, tenantId, planId, previousState ? JSON.stringify(previousState) : null, JSON.stringify(newState), correlationId]
  );
}

export async function main(params = {}, overrides = {}) {
  const db = overrides.db ?? params.db;
  const producer = overrides.producer ?? params.producer;
  try {
    const actor = requireSuperadmin(params);
    const plan = new Plan({
      slug: params.slug,
      displayName: params.displayName,
      description: params.description ?? null,
      capabilities: params.capabilities ?? {},
      quotaDimensions: params.quotaDimensions ?? {},
      createdBy: actor.id,
      updatedBy: actor.id
    });
    const created = await planRepository.create(db, plan);
    const correlationId = params.correlationId ?? randomUUID();
    await insertAudit(db, { actionType: 'plan.created', actorId: actor.id, planId: created.id, newState: created, correlationId });
    await emitPlanEvent(producer, 'plan.created', { correlationId, actorId: actor.id, planId: created.id, newState: created });
    return { statusCode: 201, body: created };
  } catch (error) {
    error.statusCode = error.statusCode ?? ERROR_STATUS_CODES[error.code] ?? 500;
    throw error;
  }
}
