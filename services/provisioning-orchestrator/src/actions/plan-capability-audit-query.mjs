const ERROR_STATUS_CODES = { FORBIDDEN: 403 };

function requireSuperadmin(params) {
  const actor = params.callerContext?.actor;
  if (!actor?.id || actor.type !== 'superadmin') throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
}

export async function main(params = {}, overrides = {}) {
  const db = overrides.db ?? params.db;
  try {
    requireSuperadmin(params);
    const page = Number.isInteger(params.page) && params.page > 0 ? params.page : 1;
    const pageSize = Number.isInteger(params.pageSize) && params.pageSize > 0 ? params.pageSize : 50;
    const offset = (page - 1) * pageSize;
    const queryParams = [params.planId ?? null, params.capabilityKey ?? null, params.actorId ?? null, params.fromDate ?? null, params.toDate ?? null, pageSize, offset];
    const { rows } = await db.query(
      `SELECT event_id, plan_id, action_type, previous_state, new_state, actor_id, created_at
         FROM plan_audit_events
        WHERE action_type IN ('plan.capability.enabled', 'plan.capability.disabled')
          AND ($1::uuid IS NULL OR plan_id = $1)
          AND ($2::text IS NULL OR previous_state->>'capabilityKey' = $2 OR new_state->>'capabilityKey' = $2)
          AND ($3::text IS NULL OR actor_id = $3)
          AND ($4::timestamptz IS NULL OR created_at >= $4)
          AND ($5::timestamptz IS NULL OR created_at <= $5)
        ORDER BY created_at ASC
        LIMIT $6 OFFSET $7`,
      queryParams
    );
    const countResult = await db.query(
      `SELECT COUNT(*)::int AS total
         FROM plan_audit_events
        WHERE action_type IN ('plan.capability.enabled', 'plan.capability.disabled')
          AND ($1::uuid IS NULL OR plan_id = $1)
          AND ($2::text IS NULL OR previous_state->>'capabilityKey' = $2 OR new_state->>'capabilityKey' = $2)
          AND ($3::text IS NULL OR actor_id = $3)
          AND ($4::timestamptz IS NULL OR created_at >= $4)
          AND ($5::timestamptz IS NULL OR created_at <= $5)`,
      queryParams.slice(0, 5)
    );
    return {
      statusCode: 200,
      body: {
        events: rows.map((row) => ({
          eventId: row.event_id,
          planId: row.plan_id,
          planSlug: row.plan_slug ?? null,
          actionType: row.action_type,
          capabilityKey: row.previous_state?.capabilityKey ?? row.new_state?.capabilityKey ?? null,
          previousState: row.previous_state?.previousState ?? null,
          newState: row.new_state?.newState ?? null,
          actorId: row.actor_id,
          timestamp: row.created_at
        })),
        total: countResult.rows[0]?.total ?? 0,
        page,
        pageSize
      }
    };
  } catch (error) {
    error.statusCode = error.statusCode ?? ERROR_STATUS_CODES[error.code] ?? 500;
    throw error;
  }
}
