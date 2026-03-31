import { Plan } from '../models/plan.mjs';

function mapPlan(row) {
  return row ? {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    description: row.description,
    status: row.status,
    capabilities: row.capabilities ?? {},
    quotaDimensions: row.quota_dimensions ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by
  } : null;
}

function normalizePgError(error, fallback) {
  if (error?.constraint === 'uq_plans_slug_lower') throw Object.assign(new Error('Plan slug conflict'), { code: 'PLAN_SLUG_CONFLICT', cause: error });
  throw error ?? fallback;
}

export async function create(client, planData) {
  const plan = new Plan(planData);
  try {
    const { rows } = await client.query(
      `INSERT INTO plans (slug, display_name, description, status, capabilities, quota_dimensions, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8)
       RETURNING *`,
      [plan.slug, plan.displayName, plan.description, plan.status, JSON.stringify(plan.capabilities), JSON.stringify(plan.quotaDimensions), plan.createdBy, plan.updatedBy]
    );
    return mapPlan(rows[0]);
  } catch (error) {
    normalizePgError(error);
  }
}

export async function findById(client, id) {
  const { rows } = await client.query('SELECT * FROM plans WHERE id = $1', [id]);
  return mapPlan(rows[0]);
}

export async function findBySlug(client, slug) {
  const normalized = Plan.normalizeSlug(slug);
  const { rows } = await client.query('SELECT * FROM plans WHERE lower(slug) = $1', [normalized]);
  return mapPlan(rows[0]);
}

export async function update(client, id, updates = {}) {
  const existing = await findById(client, id);
  if (!existing) throw Object.assign(new Error('Plan not found'), { code: 'PLAN_NOT_FOUND' });
  if (existing.status === 'archived') throw Object.assign(new Error('Archived plans cannot be updated'), { code: 'PLAN_ARCHIVED' });

  const merged = new Plan({
    ...existing,
    displayName: updates.displayName ?? existing.displayName,
    description: updates.description ?? existing.description,
    capabilities: updates.capabilities ?? existing.capabilities,
    quotaDimensions: updates.quotaDimensions ?? existing.quotaDimensions,
    createdBy: existing.createdBy,
    updatedBy: updates.updatedBy ?? existing.updatedBy
  });

  const { rows } = await client.query(
    `UPDATE plans
        SET display_name = $2,
            description = $3,
            capabilities = $4::jsonb,
            quota_dimensions = $5::jsonb,
            updated_by = $6
      WHERE id = $1
      RETURNING *`,
    [id, merged.displayName, merged.description, JSON.stringify(merged.capabilities), JSON.stringify(merged.quotaDimensions), merged.updatedBy]
  );
  return { previous: existing, current: mapPlan(rows[0]) };
}

export async function transitionStatus(client, id, targetStatus) {
  const existing = await findById(client, id);
  if (!existing) throw Object.assign(new Error('Plan not found'), { code: 'PLAN_NOT_FOUND' });
  if (!Plan.canTransition(existing.status, targetStatus)) throw Object.assign(new Error('Invalid transition'), { code: 'INVALID_TRANSITION', currentStatus: existing.status, targetStatus });
  if (targetStatus === 'archived') {
    const { rows } = await client.query('SELECT tenant_id FROM tenant_plan_assignments WHERE plan_id = $1 AND superseded_at IS NULL ORDER BY tenant_id', [id]);
    if (rows.length) throw Object.assign(new Error('Plan has active assignments'), { code: 'PLAN_HAS_ACTIVE_ASSIGNMENTS', blockingTenants: rows.map((row) => row.tenant_id) });
  }
  const { rows } = await client.query('UPDATE plans SET status = $2 WHERE id = $1 RETURNING *', [id, targetStatus]);
  return { previous: existing, current: mapPlan(rows[0]) };
}

export async function list(client, { status, page = 1, pageSize = 20 } = {}) {
  const values = [];
  const where = [];
  if (status) {
    values.push(status);
    where.push(`status = $${values.length}`);
  }
  const baseWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const offset = (page - 1) * pageSize;
  const totalQuery = `SELECT COUNT(*)::int AS total FROM plans ${baseWhere}`;
  const listQuery = `SELECT * FROM plans ${baseWhere} ORDER BY created_at DESC, slug ASC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
  const [countResult, listResult] = await Promise.all([
    client.query(totalQuery, values),
    client.query(listQuery, [...values, pageSize, offset])
  ]);
  return {
    plans: listResult.rows.map(mapPlan),
    total: countResult.rows[0]?.total ?? 0,
    page,
    pageSize
  };
}
