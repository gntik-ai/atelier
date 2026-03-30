import { assertAboveFloor } from './cron-validator.mjs';

export function checkJobCreationQuota(currentActiveCount, maxActiveJobs) {
  const allowed = currentActiveCount < maxActiveJobs;
  return {
    allowed,
    reason: allowed ? null : `Workspace has reached the maximum number of active scheduled jobs (${maxActiveJobs}).`,
  };
}

export function checkResumeQuota(currentActiveCount, maxActiveJobs) {
  return checkJobCreationQuota(currentActiveCount, maxActiveJobs);
}

export function assertCronFloor(expr, minIntervalSeconds) {
  return assertAboveFloor(expr, minIntervalSeconds);
}

export async function getActiveJobCount(pg, tenantId, workspaceId) {
  const result = await pg.query(
    `SELECT COUNT(*)::int AS count
       FROM scheduled_jobs
      WHERE tenant_id = $1
        AND workspace_id = $2
        AND status = 'active'
        AND deleted_at IS NULL`,
    [tenantId, workspaceId],
  );
  return result.rows[0]?.count ?? 0;
}

export function readDefaultLimits(env = process.env) {
  return {
    maxActiveJobs: Number(env.SCHEDULING_DEFAULT_MAX_ACTIVE_JOBS ?? 10),
    minIntervalSeconds: Number(env.SCHEDULING_DEFAULT_MIN_INTERVAL_SECONDS ?? 60),
    maxConsecutiveFailures: Number(env.SCHEDULING_DEFAULT_MAX_CONSECUTIVE_FAILURES ?? 5),
  };
}
