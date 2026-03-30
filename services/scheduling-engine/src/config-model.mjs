import { readDefaultLimits } from './quota.mjs';

export async function getConfig(pg, tenantId, workspaceId) {
  const fallback = readDefaultLimits();
  const workspace = await pg.query(
    `SELECT * FROM scheduling_configurations WHERE tenant_id = $1 AND workspace_id = $2`,
    [tenantId, workspaceId],
  );
  if (workspace.rows[0]) {
    return workspace.rows[0];
  }

  const tenant = await pg.query(
    `SELECT * FROM scheduling_configurations WHERE tenant_id = $1 AND workspace_id IS NULL`,
    [tenantId],
  );
  if (tenant.rows[0]) {
    return tenant.rows[0];
  }

  return {
    tenant_id: tenantId,
    workspace_id: workspaceId,
    scheduling_enabled: String(process.env.SCHEDULING_ENABLED_BY_DEFAULT ?? 'false') === 'true',
    max_active_jobs: fallback.maxActiveJobs,
    min_interval_seconds: fallback.minIntervalSeconds,
    max_consecutive_failures: fallback.maxConsecutiveFailures,
  };
}

export async function upsertConfig(pg, tenantId, workspaceId, patch) {
  const current = await getConfig(pg, tenantId, workspaceId);
  const next = {
    scheduling_enabled: patch.schedulingEnabled ?? current.scheduling_enabled,
    max_active_jobs: patch.maxActiveJobs ?? current.max_active_jobs,
    min_interval_seconds: patch.minIntervalSeconds ?? current.min_interval_seconds,
    max_consecutive_failures: patch.maxConsecutiveFailures ?? current.max_consecutive_failures,
  };

  const result = await pg.query(
    `INSERT INTO scheduling_configurations (tenant_id, workspace_id, scheduling_enabled, max_active_jobs, min_interval_seconds, max_consecutive_failures)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (tenant_id, workspace_id)
     DO UPDATE SET scheduling_enabled = EXCLUDED.scheduling_enabled,
                   max_active_jobs = EXCLUDED.max_active_jobs,
                   min_interval_seconds = EXCLUDED.min_interval_seconds,
                   max_consecutive_failures = EXCLUDED.max_consecutive_failures,
                   updated_at = now()
     RETURNING *`,
    [tenantId, workspaceId, next.scheduling_enabled, next.max_active_jobs, next.min_interval_seconds, next.max_consecutive_failures],
  );

  return result.rows[0];
}

export function isSchedulingEnabled(config) {
  return Boolean(config?.scheduling_enabled);
}

export async function getActiveJobsToSuspend(pg, tenantId, workspaceId) {
  const result = await pg.query(
    `SELECT id
       FROM scheduled_jobs
      WHERE tenant_id = $1
        AND workspace_id = $2
        AND status = 'active'
        AND deleted_at IS NULL`,
    [tenantId, workspaceId],
  );
  return result.rows.map((row) => row.id);
}
