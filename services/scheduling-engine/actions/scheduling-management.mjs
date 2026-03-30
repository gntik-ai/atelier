import { buildJobRecord, applyTransition, applyNextRunAt } from '../src/job-model.mjs';
import { validateCronExpression } from '../src/cron-validator.mjs';
import { checkJobCreationQuota, checkResumeQuota, getActiveJobCount } from '../src/quota.mjs';
import { getConfig, isSchedulingEnabled, upsertConfig, getActiveJobsToSuspend } from '../src/config-model.mjs';
import { jobCreatedEvent, jobUpdatedEvent, jobPausedEvent, jobResumedEvent, jobDeletedEvent, capabilityToggledEvent, quotaExceededEvent } from '../src/audit.mjs';

function response(statusCode, body = null) {
  return { statusCode, body };
}

function errorResponse(statusCode, code, message, details = {}) {
  return response(statusCode, { code, message, details });
}

function parseIdentity(params) {
  return {
    tenantId: params.jwt?.tenantId ?? params.tenantId,
    workspaceId: params.jwt?.workspaceId ?? params.workspaceId,
    actorId: params.jwt?.sub ?? params.actorId ?? 'system',
    roles: params.jwt?.roles ?? [],
  };
}

function mapJob(job) {
  return {
    jobId: job.id,
    name: job.name,
    cronExpression: job.cron_expression,
    targetAction: job.target_action,
    payload: job.payload,
    status: job.status,
    nextRunAt: job.next_run_at,
    lastTriggeredAt: job.last_triggered_at,
    consecutiveFailureCount: job.consecutive_failure_count,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
  };
}

async function publish(params, event) {
  if (typeof params.publishAudit === 'function') {
    await params.publishAudit(event);
  }
}

async function requireTargetAction(params, targetAction, workspaceId) {
  if (typeof params.validateTargetAction === 'function') {
    const valid = await params.validateTargetAction(targetAction, workspaceId);
    if (!valid) {
      throw Object.assign(new Error('Target action is invalid.'), { statusCode: 400, code: 'INVALID_TARGET_ACTION' });
    }
  }
}

export default async function main(params) {
  const { pg } = params;
  const identity = parseIdentity(params);
  const method = params.method ?? 'GET';
  const path = params.path ?? '/v1/scheduling/jobs';
  const segments = path.replace(/^\/v1\/scheduling/, '').split('/').filter(Boolean);

  try {
    if (segments[0] === 'config') {
      if (method === 'GET') {
        const config = await getConfig(pg, identity.tenantId, identity.workspaceId);
        return response(200, {
          schedulingEnabled: config.scheduling_enabled,
          maxActiveJobs: config.max_active_jobs,
          minIntervalSeconds: config.min_interval_seconds,
          maxConsecutiveFailures: config.max_consecutive_failures,
        });
      }

      if (method === 'PATCH') {
        const config = await upsertConfig(pg, identity.tenantId, identity.workspaceId, params.body ?? {});
        let pausedJobCount = 0;
        if ((params.body ?? {}).schedulingEnabled === false) {
          const jobIds = await getActiveJobsToSuspend(pg, identity.tenantId, identity.workspaceId);
          pausedJobCount = jobIds.length;
          if (jobIds.length) {
            await pg.query(
              `UPDATE scheduled_jobs SET status = 'paused', updated_at = now() WHERE id = ANY($1::uuid[])`,
              [jobIds],
            );
          }
        }
        await publish(params, capabilityToggledEvent({
          tenantId: identity.tenantId,
          workspaceId: identity.workspaceId,
          actorId: identity.actorId,
          resourceId: `${identity.tenantId}:${identity.workspaceId}`,
          metadata: { enabled: config.scheduling_enabled, pausedJobCount },
        }));
        return response(200, {
          schedulingEnabled: config.scheduling_enabled,
          maxActiveJobs: config.max_active_jobs,
          minIntervalSeconds: config.min_interval_seconds,
          maxConsecutiveFailures: config.max_consecutive_failures,
        });
      }
    }

    if (segments[0] === 'summary' && method === 'GET') {
      const counts = await pg.query(
        `SELECT status, COUNT(*)::int AS count FROM scheduled_jobs WHERE tenant_id = $1 AND workspace_id = $2 GROUP BY status`,
        [identity.tenantId, identity.workspaceId],
      );
      const config = await getConfig(pg, identity.tenantId, identity.workspaceId);
      const summary = { activeJobs: 0, pausedJobs: 0, erroredJobs: 0, deletedJobs: 0 };
      for (const row of counts.rows) {
        if (row.status === 'active') summary.activeJobs = row.count;
        if (row.status === 'paused') summary.pausedJobs = row.count;
        if (row.status === 'errored') summary.erroredJobs = row.count;
        if (row.status === 'deleted') summary.deletedJobs = row.count;
      }
      return response(200, {
        ...summary,
        quotaLimit: config.max_active_jobs,
        quotaUsed: summary.activeJobs,
        schedulingEnabled: config.scheduling_enabled,
      });
    }

    if (segments[0] === 'jobs' && method === 'POST' && segments.length === 1) {
      const config = await getConfig(pg, identity.tenantId, identity.workspaceId);
      if (!isSchedulingEnabled(config)) {
        return errorResponse(403, 'SCHEDULING_DISABLED', 'Scheduling capability is disabled for this workspace.');
      }
      const validation = validateCronExpression(params.body.cronExpression);
      if (!validation.valid) {
        return errorResponse(400, 'INVALID_CRON_EXPRESSION', validation.error);
      }
      await requireTargetAction(params, params.body.targetAction, identity.workspaceId);
      const activeCount = await getActiveJobCount(pg, identity.tenantId, identity.workspaceId);
      const quota = checkJobCreationQuota(activeCount, config.max_active_jobs);
      if (!quota.allowed) {
        await publish(params, quotaExceededEvent({ tenantId: identity.tenantId, workspaceId: identity.workspaceId, actorId: identity.actorId, resourceId: identity.workspaceId }));
        return errorResponse(409, 'QUOTA_EXCEEDED', quota.reason);
      }
      const record = buildJobRecord(params.body, {
        tenantId: identity.tenantId,
        workspaceId: identity.workspaceId,
        actorId: identity.actorId,
        maxConsecutiveFailures: config.max_consecutive_failures,
      });
      const inserted = await pg.query(
        `INSERT INTO scheduled_jobs (id, tenant_id, workspace_id, name, cron_expression, target_action, payload, status, consecutive_failure_count, max_consecutive_failures, next_run_at, created_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING *`,
        [record.id, record.tenant_id, record.workspace_id, record.name, record.cron_expression, record.target_action, record.payload, record.status, record.consecutive_failure_count, record.max_consecutive_failures, record.next_run_at, record.created_by, record.created_at, record.updated_at],
      );
      await publish(params, jobCreatedEvent({ tenantId: identity.tenantId, workspaceId: identity.workspaceId, actorId: identity.actorId, resourceId: record.id }));
      return response(201, mapJob(inserted.rows[0]));
    }

    if (segments[0] === 'jobs' && method === 'GET' && segments.length === 1) {
      const result = await pg.query(
        `SELECT * FROM scheduled_jobs WHERE tenant_id = $1 AND workspace_id = $2 AND deleted_at IS NULL ${params.query?.status ? "AND status = '" + params.query.status + "'" : ''} ORDER BY id ASC LIMIT $3`,
        [identity.tenantId, identity.workspaceId, Math.min(Number(params.query?.limit ?? 100), 100)],
      );
      return response(200, { items: result.rows.map(mapJob), nextCursor: null });
    }

    if (segments[0] === 'jobs' && segments[2] === 'pause' && method === 'POST') {
      const current = (await pg.query(`SELECT * FROM scheduled_jobs WHERE id = $1 AND tenant_id = $2 AND workspace_id = $3 AND deleted_at IS NULL`, [segments[1], identity.tenantId, identity.workspaceId])).rows[0];
      if (!current) return errorResponse(404, 'NOT_FOUND', 'Job not found.');
      if (current.status !== 'active') return errorResponse(409, 'JOB_NOT_ACTIVE', 'Job is not active.');
      const next = applyTransition(current, 'paused');
      const updated = await pg.query(`UPDATE scheduled_jobs SET status = $2, updated_at = $3 WHERE id = $1 RETURNING *`, [current.id, next.status, next.updated_at]);
      await publish(params, jobPausedEvent({ tenantId: identity.tenantId, workspaceId: identity.workspaceId, actorId: identity.actorId, resourceId: current.id }));
      return response(200, mapJob(updated.rows[0]));
    }

    if (segments[0] === 'jobs' && segments[2] === 'resume' && method === 'POST') {
      const current = (await pg.query(`SELECT * FROM scheduled_jobs WHERE id = $1 AND tenant_id = $2 AND workspace_id = $3 AND deleted_at IS NULL`, [segments[1], identity.tenantId, identity.workspaceId])).rows[0];
      if (!current) return errorResponse(404, 'NOT_FOUND', 'Job not found.');
      if (current.status !== 'paused') return errorResponse(409, 'JOB_NOT_PAUSED', 'Job is not paused.');
      const config = await getConfig(pg, identity.tenantId, identity.workspaceId);
      if (!isSchedulingEnabled(config)) return errorResponse(403, 'SCHEDULING_DISABLED', 'Scheduling capability is disabled for this workspace.');
      const activeCount = await getActiveJobCount(pg, identity.tenantId, identity.workspaceId);
      const quota = checkResumeQuota(activeCount, config.max_active_jobs);
      if (!quota.allowed) return errorResponse(409, 'QUOTA_EXCEEDED', quota.reason);
      const next = applyNextRunAt(applyTransition(current, 'active'));
      const updated = await pg.query(`UPDATE scheduled_jobs SET status = $2, next_run_at = $3, updated_at = $4 WHERE id = $1 RETURNING *`, [current.id, next.status, next.next_run_at, next.updated_at]);
      await publish(params, jobResumedEvent({ tenantId: identity.tenantId, workspaceId: identity.workspaceId, actorId: identity.actorId, resourceId: current.id }));
      return response(200, mapJob(updated.rows[0]));
    }

    if (segments[0] === 'jobs' && segments.length === 2 && method === 'GET') {
      const job = (await pg.query(`SELECT * FROM scheduled_jobs WHERE id = $1 AND tenant_id = $2 AND workspace_id = $3 AND deleted_at IS NULL`, [segments[1], identity.tenantId, identity.workspaceId])).rows[0];
      if (!job) return errorResponse(404, 'NOT_FOUND', 'Job not found.');
      return response(200, mapJob(job));
    }

    if (segments[0] === 'jobs' && segments[2] === 'executions' && method === 'GET') {
      const result = await pg.query(`SELECT * FROM scheduled_executions WHERE job_id = $1 AND tenant_id = $2 AND workspace_id = $3 ORDER BY scheduled_at DESC LIMIT $4`, [segments[1], identity.tenantId, identity.workspaceId, Math.min(Number(params.query?.limit ?? 100), 100)]);
      return response(200, {
        items: result.rows.map((row) => ({ executionId: row.id, status: row.status, scheduledAt: row.scheduled_at, startedAt: row.started_at, finishedAt: row.finished_at, durationMs: row.duration_ms, errorSummary: row.error_summary, correlationId: row.correlation_id })),
        nextCursor: null,
      });
    }

    if (segments[0] === 'jobs' && segments.length === 2 && method === 'PATCH') {
      const current = (await pg.query(`SELECT * FROM scheduled_jobs WHERE id = $1 AND tenant_id = $2 AND workspace_id = $3 AND deleted_at IS NULL`, [segments[1], identity.tenantId, identity.workspaceId])).rows[0];
      if (!current) return errorResponse(404, 'NOT_FOUND', 'Job not found.');
      if (params.body.cronExpression) {
        const validation = validateCronExpression(params.body.cronExpression);
        if (!validation.valid) return errorResponse(400, 'INVALID_CRON_EXPRESSION', validation.error);
      }
      if (params.body.targetAction) {
        await requireTargetAction(params, params.body.targetAction, identity.workspaceId);
      }
      const next = params.body.cronExpression ? applyNextRunAt(current, params.body.cronExpression) : current;
      const updated = await pg.query(
        `UPDATE scheduled_jobs SET name = $2, cron_expression = $3, target_action = $4, payload = $5, next_run_at = $6, updated_at = now() WHERE id = $1 RETURNING *`,
        [current.id, params.body.name ?? current.name, params.body.cronExpression ?? current.cron_expression, params.body.targetAction ?? current.target_action, params.body.payload ?? current.payload, next.next_run_at],
      );
      await publish(params, jobUpdatedEvent({ tenantId: identity.tenantId, workspaceId: identity.workspaceId, actorId: identity.actorId, resourceId: current.id }));
      return response(200, mapJob(updated.rows[0]));
    }

    if (segments[0] === 'jobs' && segments.length === 2 && method === 'DELETE') {
      const updated = await pg.query(`UPDATE scheduled_jobs SET status = 'deleted', deleted_at = now(), updated_at = now() WHERE id = $1 AND tenant_id = $2 AND workspace_id = $3 RETURNING *`, [segments[1], identity.tenantId, identity.workspaceId]);
      if (!updated.rows[0]) return errorResponse(404, 'NOT_FOUND', 'Job not found.');
      await publish(params, jobDeletedEvent({ tenantId: identity.tenantId, workspaceId: identity.workspaceId, actorId: identity.actorId, resourceId: segments[1] }));
      return response(204, null);
    }

    return errorResponse(404, 'NOT_FOUND', 'Route not found.');
  } catch (error) {
    return errorResponse(error.statusCode ?? 500, error.code ?? 'INTERNAL_ERROR', error.message);
  }
}
