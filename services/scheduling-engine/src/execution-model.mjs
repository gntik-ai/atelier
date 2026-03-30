import { randomUUID } from 'node:crypto';

export function buildExecutionRecord(job, scheduledAt, correlationId = randomUUID()) {
  return {
    id: randomUUID(),
    job_id: job.id,
    tenant_id: job.tenant_id,
    workspace_id: job.workspace_id,
    status: 'running',
    scheduled_at: scheduledAt,
    started_at: null,
    finished_at: null,
    duration_ms: null,
    error_summary: null,
    correlation_id: correlationId,
    created_at: new Date().toISOString(),
  };
}

export function buildMissedExecutionRecord(job, scheduledAt) {
  return {
    ...buildExecutionRecord(job, scheduledAt),
    status: 'missed',
  };
}

export function resolveOutcome(startedAt, finishedAt, openWhiskResult) {
  if (openWhiskResult?.timeout || (finishedAt && startedAt && finishedAt - startedAt > (openWhiskResult?.timeoutMs ?? Infinity))) {
    return 'timed_out';
  }
  if (openWhiskResult?.ok === false || openWhiskResult?.error) {
    return 'failed';
  }
  return 'succeeded';
}

export function finalizeExecution(record, outcome, errorSummary = null) {
  const finishedAt = new Date();
  const startedAt = record.started_at ? new Date(record.started_at) : finishedAt;
  return {
    ...record,
    status: outcome,
    finished_at: finishedAt.toISOString(),
    duration_ms: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
    error_summary: errorSummary,
  };
}
