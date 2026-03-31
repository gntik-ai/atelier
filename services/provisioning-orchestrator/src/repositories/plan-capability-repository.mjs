import * as catalogRepository from './boolean-capability-catalog-repository.mjs';

function resolveLockTimeoutMs(value = process.env.CAPABILITY_LOCK_TIMEOUT_MS) {
  const parsed = Number.parseInt(`${value ?? '5000'}`, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 5000;
}

function mapPlan(row) {
  return row ? {
    id: row.id,
    status: row.status,
    slug: row.slug,
    displayName: row.display_name,
    capabilities: row.capabilities ?? {}
  } : null;
}

async function rollbackQuietly(pgClient) {
  try { await pgClient.query('ROLLBACK'); } catch {}
}

async function insertAuditEvent(pgClient, { actionType, actorId, correlationId, planId, previousState, newState }) {
  await pgClient.query(
    `INSERT INTO plan_audit_events (action_type, actor_id, tenant_id, plan_id, previous_state, new_state, correlation_id)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`,
    [actionType, actorId, null, planId, JSON.stringify(previousState), JSON.stringify(newState), correlationId ?? null]
  );
}

function diffCapabilities(currentJsonb = {}, toSet = {}) {
  const changed = [];
  const unchanged = [];
  for (const [capabilityKey, newState] of Object.entries(toSet ?? {})) {
    const hasCurrent = Object.prototype.hasOwnProperty.call(currentJsonb ?? {}, capabilityKey);
    const previousState = hasCurrent ? Boolean(currentJsonb[capabilityKey]) : null;
    if (hasCurrent && previousState === newState) unchanged.push(capabilityKey);
    else changed.push({ capabilityKey, previousState, newState: Boolean(newState) });
  }
  return { changed, unchanged };
}

function buildEffectiveCapabilities(planCapabilities = {}, catalog = []) {
  return Object.fromEntries(catalog.map((entry) => [
    entry.capabilityKey,
    Object.prototype.hasOwnProperty.call(planCapabilities ?? {}, entry.capabilityKey)
      ? Boolean(planCapabilities[entry.capabilityKey])
      : Boolean(entry.platformDefault)
  ]));
}

export async function getPlanCapabilities(pgClient, planId) {
  const { rows } = await pgClient.query(`SELECT id, status, slug, display_name, capabilities FROM plans WHERE id = $1`, [planId]);
  return mapPlan(rows[0]);
}

export async function setCapabilities(pgClient, { planId, capabilitiesToSet, actorId, correlationId }) {
  await pgClient.query('BEGIN');
  try {
    await pgClient.query(`SET LOCAL lock_timeout = '${resolveLockTimeoutMs()}ms'`);
    const { rows } = await pgClient.query(`SELECT id, status, slug, display_name, capabilities FROM plans WHERE id = $1 FOR UPDATE`, [planId]);
    const plan = mapPlan(rows[0]);
    if (!plan) throw Object.assign(new Error('Plan not found'), { code: 'PLAN_NOT_FOUND' });
    if (plan.status === 'archived') throw Object.assign(new Error('Plan archived'), { code: 'PLAN_ARCHIVED' });

    await catalogRepository.validateCapabilityKeys(pgClient, Object.keys(capabilitiesToSet ?? {}));
    const { changed, unchanged } = diffCapabilities(plan.capabilities ?? {}, capabilitiesToSet ?? {});
    const catalog = await catalogRepository.listActiveCatalog(pgClient);
    if (changed.length === 0) {
      await pgClient.query('COMMIT');
      return { planId: plan.id, planSlug: plan.slug, changed, unchanged, effectiveCapabilities: buildEffectiveCapabilities(plan.capabilities ?? {}, catalog), planStatus: plan.status };
    }

    const nextCapabilities = { ...(plan.capabilities ?? {}), ...Object.fromEntries(changed.map((item) => [item.capabilityKey, item.newState])) };
    const updateResult = await pgClient.query(
      `UPDATE plans SET capabilities = $2::jsonb, updated_at = NOW(), updated_by = $3 WHERE id = $1 RETURNING id, status, slug, display_name, capabilities`,
      [planId, JSON.stringify(nextCapabilities), actorId ?? null]
    );

    for (const item of changed) {
      await insertAuditEvent(pgClient, {
        actionType: item.newState ? 'plan.capability.enabled' : 'plan.capability.disabled',
        actorId,
        correlationId,
        planId,
        previousState: { capabilityKey: item.capabilityKey, previousState: item.previousState },
        newState: { capabilityKey: item.capabilityKey, newState: item.newState }
      });
    }

    await pgClient.query('COMMIT');
    return {
      planId,
      planSlug: updateResult.rows[0].slug,
      changed,
      unchanged,
      effectiveCapabilities: buildEffectiveCapabilities(updateResult.rows[0].capabilities ?? {}, catalog),
      planStatus: updateResult.rows[0].status
    };
  } catch (error) {
    await rollbackQuietly(pgClient);
    if (error?.code === '55P03') throw Object.assign(new Error('Concurrent capability conflict'), { code: 'CONCURRENT_CAPABILITY_CONFLICT', cause: error });
    throw error;
  }
}
