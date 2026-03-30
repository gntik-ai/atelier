import { nextRunAt } from '../src/cron-validator.mjs';
import { buildMissedExecutionRecord } from '../src/execution-model.mjs';
import { executionMissedEvent } from '../src/audit.mjs';

async function publish(params, event) {
  if (typeof params.publishAudit === 'function') {
    await params.publishAudit(event);
  }
}

export default async function main(params) {
  if (String(process.env.SCHEDULING_ENGINE_ENABLED ?? 'true') === 'false') {
    return { statusCode: 200, body: { triggered: 0, skipped: 'disabled' } };
  }

  const { pg } = params;
  const now = new Date(params.now ?? Date.now());
  const dueJobs = await pg.query(
    `SELECT * FROM scheduled_jobs WHERE status = 'active' AND deleted_at IS NULL AND next_run_at <= $1 ORDER BY next_run_at ASC`,
    [now.toISOString()],
  );

  let triggered = 0;
  const missedCap = Number(process.env.SCHEDULING_MISSED_WINDOW_CAP ?? 10);

  for (const job of dueJobs.rows) {
    if (job.last_triggered_at) {
      const missed = [];
      let probe = new Date(job.last_triggered_at);
      while (missed.length < missedCap) {
        const candidate = nextRunAt(job.cron_expression, probe);
        if (new Date(candidate) >= now || candidate === job.next_run_at) break;
        missed.push(candidate);
        probe = new Date(candidate);
      }

      for (const scheduledAt of missed) {
        const record = buildMissedExecutionRecord(job, scheduledAt);
        await pg.query(
          `INSERT INTO scheduled_executions (id, job_id, tenant_id, workspace_id, status, scheduled_at, correlation_id, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (job_id, scheduled_at) DO NOTHING`,
          [record.id, record.job_id, record.tenant_id, record.workspace_id, record.status, record.scheduled_at, record.correlation_id, record.created_at],
        );
        await publish(params, executionMissedEvent({ tenantId: job.tenant_id, workspaceId: job.workspace_id, actorId: 'system', resourceId: job.id }));
      }
    }

    const insert = await pg.query(
      `INSERT INTO scheduled_executions (id, job_id, tenant_id, workspace_id, status, scheduled_at, correlation_id, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, 'running', $4, $5, now())
       ON CONFLICT (job_id, scheduled_at) DO NOTHING
       RETURNING id`,
      [job.id, job.tenant_id, job.workspace_id, job.next_run_at, params.correlationId ?? null],
    );

    if (insert.rowCount === 0) {
      continue;
    }

    if (typeof params.invokeRunner === 'function') {
      await params.invokeRunner({ jobId: job.id, executionId: insert.rows[0].id, scheduledAt: job.next_run_at, correlationId: params.correlationId ?? null });
    }

    await pg.query(
      `UPDATE scheduled_jobs SET last_triggered_at = $2, next_run_at = $3, updated_at = now() WHERE id = $1`,
      [job.id, job.next_run_at, nextRunAt(job.cron_expression, new Date(job.next_run_at))],
    );
    triggered += 1;
  }

  return { statusCode: 200, body: { triggered } };
}
