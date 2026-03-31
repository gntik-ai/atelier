import { getDefaultValue } from './quota-dimension-catalog-repository.mjs';

function resolveLockTimeoutMs(value = process.env.PLAN_LIMITS_LOCK_TIMEOUT_MS) {
  const parsed = Number.parseInt(`${value ?? '5000'}`, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 5000;
}

function mapPlan(row) {
  return row ? {
    id: row.id,
    status: row.status,
    slug: row.slug,
    quotaDimensions: row.quota_dimensions ?? {}
  } : null;
}

async function rollbackQuietly(pgClient) {
  try {
    await pgClient.query('ROLLBACK');
  } catch {
    // noop
  }
}

async function insertAuditEvent(pgClient, { actionType, actorId, correlationId, planId, previousState, newState }) {
  await pgClient.query(
    `INSERT INTO plan_audit_events (action_type, actor_id, tenant_id, plan_id, previous_state, new_state, correlation_id)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`,
    [actionType, actorId, null, planId, JSON.stringify(previousState), JSON.stringify(newState), correlationId ?? null]
  );
}

export async function getPlanWithLock(pgClient, planId) {
  const { rows } = await pgClient.query(
    `SELECT id, status, slug, quota_dimensions
       FROM plans
      WHERE id = $1
      FOR UPDATE`,
    [planId]
  );
  return mapPlan(rows[0]);
}

export async function getPlanById(pgClient, planId) {
  const { rows } = await pgClient.query(
    `SELECT id, status, slug, quota_dimensions
       FROM plans
      WHERE id = $1`,
    [planId]
  );
  return mapPlan(rows[0]);
}

export async function setLimit(pgClient, { planId, dimensionKey, value, actorId = 'system', correlationId = null }) {
  await pgClient.query('BEGIN');
  try {
    await pgClient.query(`SET LOCAL lock_timeout = '${resolveLockTimeoutMs()}ms'`);
    const plan = await getPlanWithLock(pgClient, planId);
    if (!plan) throw Object.assign(new Error('Plan not found'), { code: 'PLAN_NOT_FOUND' });
    if (plan.status === 'deprecated' || plan.status === 'archived') throw Object.assign(new Error('Plan limits are frozen'), { code: 'PLAN_LIMITS_FROZEN' });

    const previousValue = Object.prototype.hasOwnProperty.call(plan.quotaDimensions, dimensionKey) ? plan.quotaDimensions[dimensionKey] : null;
    const { rows } = await pgClient.query(
      `UPDATE plans
          SET quota_dimensions = COALESCE(quota_dimensions, '{}'::jsonb) || jsonb_build_object($2::text, $3::bigint)
        WHERE id = $1
        RETURNING id, status, slug, quota_dimensions`,
      [planId, dimensionKey, value]
    );

    await insertAuditEvent(pgClient, {
      actionType: 'plan.limit.set',
      actorId,
      correlationId,
      planId,
      previousState: { dimensionKey, previousValue },
      newState: { dimensionKey, newValue: value }
    });

    await pgClient.query('COMMIT');
    return { planId, dimensionKey, previousValue, newValue: value, planStatus: rows[0].status, planSlug: rows[0].slug };
  } catch (error) {
    await rollbackQuietly(pgClient);
    if (error?.code === '55P03') throw Object.assign(new Error('Concurrent plan limit conflict'), { code: 'CONCURRENT_PLAN_LIMIT_CONFLICT', cause: error });
    throw error;
  }
}

export async function removeLimit(pgClient, { planId, dimensionKey, actorId = 'system', correlationId = null }) {
  await pgClient.query('BEGIN');
  try {
    await pgClient.query(`SET LOCAL lock_timeout = '${resolveLockTimeoutMs()}ms'`);
    const plan = await getPlanWithLock(pgClient, planId);
    if (!plan) throw Object.assign(new Error('Plan not found'), { code: 'PLAN_NOT_FOUND' });
    if (plan.status === 'deprecated' || plan.status === 'archived') throw Object.assign(new Error('Plan limits are frozen'), { code: 'PLAN_LIMITS_FROZEN' });
    if (!Object.prototype.hasOwnProperty.call(plan.quotaDimensions, dimensionKey)) throw Object.assign(new Error('Limit not set'), { code: 'LIMIT_NOT_SET' });

    const previousValue = plan.quotaDimensions[dimensionKey];
    const effectiveValue = await getDefaultValue(pgClient, dimensionKey);
    const { rows } = await pgClient.query(
      `UPDATE plans
          SET quota_dimensions = COALESCE(quota_dimensions, '{}'::jsonb) - $2::text
        WHERE id = $1
        RETURNING id, status, slug, quota_dimensions`,
      [planId, dimensionKey]
    );

    await insertAuditEvent(pgClient, {
      actionType: 'plan.limit.removed',
      actorId,
      correlationId,
      planId,
      previousState: { dimensionKey, previousValue },
      newState: { dimensionKey, effectiveValue }
    });

    await pgClient.query('COMMIT');
    return { planId, dimensionKey, removedValue: previousValue, effectiveValue, planStatus: rows[0].status, planSlug: rows[0].slug };
  } catch (error) {
    await rollbackQuietly(pgClient);
    if (error?.code === '55P03') throw Object.assign(new Error('Concurrent plan limit conflict'), { code: 'CONCURRENT_PLAN_LIMIT_CONFLICT', cause: error });
    throw error;
  }
}

export async function getExplicitLimits(pgClient, planId) {
  const { rows } = await pgClient.query('SELECT quota_dimensions FROM plans WHERE id = $1', [planId]);
  return rows[0] ? { quota_dimensions: rows[0].quota_dimensions ?? {} } : null;
}

export async function getLimitsByTenantCurrentPlan(pgClient, tenantId) {
  const { rows } = await pgClient.query(
    `SELECT p.id AS plan_id, p.slug AS plan_slug, p.status AS plan_status, p.quota_dimensions
       FROM tenant_plan_assignments tpa
       JOIN plans p ON p.id = tpa.plan_id
      WHERE tpa.tenant_id = $1
        AND tpa.superseded_at IS NULL`,
    [tenantId]
  );
  return rows[0] ? {
    planId: rows[0].plan_id,
    planSlug: rows[0].plan_slug,
    planStatus: rows[0].plan_status,
    quotaDimensions: rows[0].quota_dimensions ?? {}
  } : null;
}
