import { PlanAssignment } from '../models/plan-assignment.mjs';

function resolveLockTimeoutMs(value = process.env.PLAN_ASSIGNMENT_LOCK_TIMEOUT_MS) {
  const parsed = Number.parseInt(`${value ?? '5000'}`, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 5000;
}

function mapAssignment(row) {
  return row ? {
    assignmentId: row.id,
    tenantId: row.tenant_id,
    planId: row.plan_id,
    effectiveFrom: row.effective_from,
    supersededAt: row.superseded_at,
    assignedBy: row.assigned_by,
    assignmentMetadata: row.assignment_metadata ?? {},
    planSlug: row.plan_slug,
    planDisplayName: row.plan_display_name,
    planStatus: row.plan_status,
    planDescription: row.plan_description,
    capabilities: row.capabilities,
    quotaDimensions: row.quota_dimensions
  } : null;
}

export async function assign(client, input) {
  const assignment = new PlanAssignment(input);
  await client.query('BEGIN');
  try {
    await client.query(`SET LOCAL lock_timeout = '${resolveLockTimeoutMs()}ms'`);
    const currentResult = await client.query(
      `SELECT id, plan_id FROM tenant_plan_assignments
       WHERE tenant_id = $1 AND superseded_at IS NULL
       FOR UPDATE`,
      [assignment.tenantId]
    );
    const current = currentResult.rows[0] ?? null;
    if (current) {
      await client.query('UPDATE tenant_plan_assignments SET superseded_at = NOW() WHERE id = $1', [current.id]);
    }
    const { rows } = await client.query(
      `INSERT INTO tenant_plan_assignments (tenant_id, plan_id, assigned_by, assignment_metadata)
       VALUES ($1,$2,$3,$4::jsonb)
       RETURNING *`,
      [assignment.tenantId, assignment.planId, assignment.assignedBy, JSON.stringify(assignment.assignmentMetadata)]
    );
    await client.query('COMMIT');
    return { assignment: mapAssignment(rows[0]), previousPlanId: current?.plan_id ?? null };
  } catch (error) {
    await client.query('ROLLBACK');
    if (error?.code === '55P03') throw Object.assign(new Error('Concurrent assignment conflict'), { code: 'CONCURRENT_ASSIGNMENT_CONFLICT', cause: error });
    throw error;
  }
}

export async function getCurrent(client, tenantId) {
  const { rows } = await client.query(
    `SELECT tpa.*, p.slug AS plan_slug, p.display_name AS plan_display_name, p.status AS plan_status,
            p.description AS plan_description, p.capabilities, p.quota_dimensions
       FROM tenant_plan_assignments tpa
       JOIN plans p ON p.id = tpa.plan_id
      WHERE tpa.tenant_id = $1 AND tpa.superseded_at IS NULL`,
    [tenantId]
  );
  return mapAssignment(rows[0]);
}

export async function getHistory(client, tenantId, { page = 1, pageSize = 20 } = {}) {
  const offset = (page - 1) * pageSize;
  const [countResult, rowsResult] = await Promise.all([
    client.query('SELECT COUNT(*)::int AS total FROM tenant_plan_assignments WHERE tenant_id = $1', [tenantId]),
    client.query(
      `SELECT tpa.*, p.slug AS plan_slug, p.display_name AS plan_display_name, p.status AS plan_status,
              p.description AS plan_description, p.capabilities, p.quota_dimensions
         FROM tenant_plan_assignments tpa
         JOIN plans p ON p.id = tpa.plan_id
        WHERE tpa.tenant_id = $1
        ORDER BY tpa.effective_from DESC
        LIMIT $2 OFFSET $3`,
      [tenantId, pageSize, offset]
    )
  ]);
  return { assignments: rowsResult.rows.map(mapAssignment), total: countResult.rows[0]?.total ?? 0, page, pageSize };
}

export async function hasActiveAssignments(client, planId) {
  const { rows } = await client.query(
    'SELECT tenant_id FROM tenant_plan_assignments WHERE plan_id = $1 AND superseded_at IS NULL ORDER BY tenant_id',
    [planId]
  );
  return { hasAssignments: rows.length > 0, blockingTenants: rows.map((row) => row.tenant_id) };
}
