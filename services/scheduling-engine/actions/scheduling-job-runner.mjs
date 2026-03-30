import { incrementFailureCount, resetFailureCount } from '../src/job-model.mjs';
import { finalizeExecution, resolveOutcome } from '../src/execution-model.mjs';
import { executionSucceededEvent, executionFailedEvent, executionTimedOutEvent, jobErroredEvent } from '../src/audit.mjs';

async function publish(params, event) {
  if (typeof params.publishAudit === 'function') {
    await params.publishAudit(event);
  }
}

export default async function main(params) {
  const { pg, jobId, executionId } = params;
  const job = (await pg.query(`SELECT * FROM scheduled_jobs WHERE id = $1`, [jobId])).rows[0];
  if (!job || job.status !== 'active' || job.deleted_at) {
    return { statusCode: 200, body: { skipped: true } };
  }

  const startedAt = new Date().toISOString();
  const started = (await pg.query(`UPDATE scheduled_executions SET started_at = $2 WHERE id = $1 RETURNING *`, [executionId, startedAt])).rows[0];

  let result;
  let errorSummary = null;
  try {
    result = await params.invokeAction({ targetAction: job.target_action, payload: job.payload, correlationId: params.correlationId });
  } catch (error) {
    result = { ok: false, error: error.message };
    errorSummary = error.message;
  }

  const outcome = resolveOutcome(new Date(startedAt), new Date(), result);
  const finalized = finalizeExecution(started, outcome, errorSummary ?? result?.error ?? null);
  await pg.query(
    `UPDATE scheduled_executions SET status = $2, finished_at = $3, duration_ms = $4, error_summary = $5 WHERE id = $1`,
    [executionId, finalized.status, finalized.finished_at, finalized.duration_ms, finalized.error_summary],
  );

  if (outcome === 'succeeded') {
    const nextJob = resetFailureCount(job);
    await pg.query(`UPDATE scheduled_jobs SET consecutive_failure_count = 0, updated_at = $2 WHERE id = $1`, [job.id, nextJob.updated_at]);
    await publish(params, executionSucceededEvent({ tenantId: job.tenant_id, workspaceId: job.workspace_id, actorId: 'system', resourceId: executionId }));
    return { statusCode: 200, body: { outcome } };
  }

  const nextJob = incrementFailureCount(job);
  await pg.query(`UPDATE scheduled_jobs SET consecutive_failure_count = $2, status = $3, updated_at = $4 WHERE id = $1`, [job.id, nextJob.consecutive_failure_count, nextJob.status, nextJob.updated_at]);

  if (outcome === 'timed_out') {
    await publish(params, executionTimedOutEvent({ tenantId: job.tenant_id, workspaceId: job.workspace_id, actorId: 'system', resourceId: executionId }));
  } else {
    await publish(params, executionFailedEvent({ tenantId: job.tenant_id, workspaceId: job.workspace_id, actorId: 'system', resourceId: executionId }));
  }
  if (nextJob.status === 'errored') {
    await publish(params, jobErroredEvent({ tenantId: job.tenant_id, workspaceId: job.workspace_id, actorId: 'system', resourceId: job.id }));
  }

  return { statusCode: 200, body: { outcome } };
}
