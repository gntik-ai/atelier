import test from 'node:test';
import assert from 'node:assert/strict';
import main from '../../services/scheduling-engine/actions/scheduling-trigger.mjs';

function createPg(jobs) {
  const state = { jobs, executions: [] };
  return {
    state,
    async query(sql, params = []) {
      if (sql.startsWith("SELECT * FROM scheduled_jobs WHERE status = 'active'")) {
        return { rows: state.jobs.filter((job) => job.status === 'active' && !job.deleted_at && new Date(job.next_run_at) <= new Date(params[0])) };
      }
      if (sql.startsWith('INSERT INTO scheduled_executions')) {
        const exists = state.executions.find((row) => row.job_id === params[0] && row.scheduled_at === params[3]);
        if (exists) return { rowCount: 0, rows: [] };
        const row = { id: `exec-${state.executions.length + 1}`, job_id: params[0], tenant_id: params[1], workspace_id: params[2], status: 'running', scheduled_at: params[3] };
        state.executions.push(row);
        return { rowCount: 1, rows: [{ id: row.id }] };
      }
      if (sql.startsWith('UPDATE scheduled_jobs SET last_triggered_at = $2')) {
        const job = state.jobs.find((row) => row.id === params[0]);
        job.last_triggered_at = params[1];
        job.next_run_at = params[2];
        return { rows: [job] };
      }
      throw new Error(`Unhandled SQL: ${sql}`);
    },
  };
}

test('triggers due jobs, skips future/paused/deleted, and prevents duplicates', async () => {
  const pg = createPg([
    { id: 'job-1', tenant_id: 't1', workspace_id: 'w1', status: 'active', deleted_at: null, cron_expression: '0 * * * *', next_run_at: '2026-03-30T10:00:00.000Z', last_triggered_at: null },
    { id: 'job-2', tenant_id: 't1', workspace_id: 'w1', status: 'active', deleted_at: null, cron_expression: '0 * * * *', next_run_at: '2026-03-30T12:00:00.000Z', last_triggered_at: null },
    { id: 'job-3', tenant_id: 't1', workspace_id: 'w1', status: 'paused', deleted_at: null, cron_expression: '0 * * * *', next_run_at: '2026-03-30T10:00:00.000Z', last_triggered_at: null },
    { id: 'job-4', tenant_id: 't1', workspace_id: 'w1', status: 'active', deleted_at: '2026-03-30T09:00:00.000Z', cron_expression: '0 * * * *', next_run_at: '2026-03-30T10:00:00.000Z', last_triggered_at: null },
  ]);

  const runnerCalls = [];
  const first = await main({ pg, now: '2026-03-30T10:05:00.000Z', invokeRunner: async (payload) => runnerCalls.push(payload) });
  assert.equal(first.body.triggered, 1);
  assert.equal(pg.state.executions.length, 1);
  assert.equal(runnerCalls.length, 1);

  const second = await main({ pg, now: '2026-03-30T10:05:00.000Z', invokeRunner: async (payload) => runnerCalls.push(payload) });
  assert.equal(second.body.triggered, 0);
});

test('logs missed windows and supports early exit', async () => {
  const events = [];
  const previous = process.env.SCHEDULING_ENGINE_ENABLED;
  process.env.SCHEDULING_ENGINE_ENABLED = 'false';
  const disabled = await main({ pg: createPg([]) });
  assert.equal(disabled.body.skipped, 'disabled');
  process.env.SCHEDULING_ENGINE_ENABLED = previous ?? 'true';

  const pg = createPg([
    { id: 'job-1', tenant_id: 't1', workspace_id: 'w1', status: 'active', deleted_at: null, cron_expression: '*/5 * * * *', next_run_at: '2026-03-30T10:15:00.000Z', last_triggered_at: '2026-03-30T10:00:00.000Z' },
  ]);
  await main({ pg, now: '2026-03-30T10:16:00.000Z', invokeRunner: async () => {}, publishAudit: async (event) => events.push(event) });
  assert.ok(events.length >= 1);
});
