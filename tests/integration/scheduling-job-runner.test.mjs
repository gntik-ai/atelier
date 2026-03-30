import test from 'node:test';
import assert from 'node:assert/strict';
import main from '../../services/scheduling-engine/actions/scheduling-job-runner.mjs';

function createPg(job) {
  const state = { job: { ...job }, execution: { id: 'exec-1', started_at: null } };
  return {
    state,
    async query(sql, params = []) {
      if (sql.startsWith('SELECT * FROM scheduled_jobs')) return { rows: [state.job] };
      if (sql.startsWith('UPDATE scheduled_executions SET started_at')) {
        state.execution.started_at = params[1];
        return { rows: [{ ...state.execution }] };
      }
      if (sql.startsWith('UPDATE scheduled_executions SET status')) {
        Object.assign(state.execution, { status: params[1], finished_at: params[2], duration_ms: params[3], error_summary: params[4] });
        return { rows: [state.execution] };
      }
      if (sql.startsWith('UPDATE scheduled_jobs SET consecutive_failure_count = 0')) {
        state.job.consecutive_failure_count = 0; return { rows: [state.job] };
      }
      if (sql.startsWith('UPDATE scheduled_jobs SET consecutive_failure_count = $2')) {
        state.job.consecutive_failure_count = params[1]; state.job.status = params[2]; return { rows: [state.job] };
      }
      throw new Error(`Unhandled SQL: ${sql}`);
    },
  };
}

test('successful invocation records succeeded and resets failures', async () => {
  const pg = createPg({ id: 'job-1', tenant_id: 't1', workspace_id: 'w1', status: 'active', deleted_at: null, target_action: 'w1/cleanup', payload: {}, consecutive_failure_count: 2, max_consecutive_failures: 3 });
  const events = [];
  const result = await main({ pg, jobId: 'job-1', executionId: 'exec-1', invokeAction: async () => ({ ok: true }), publishAudit: async (event) => events.push(event) });
  assert.equal(result.body.outcome, 'succeeded');
  assert.equal(pg.state.job.consecutive_failure_count, 0);
  assert.equal(events[0].action, 'execution.succeeded');
});

test('failed invocation increments failures and errored threshold emits event', async () => {
  const pg = createPg({ id: 'job-1', tenant_id: 't1', workspace_id: 'w1', status: 'active', deleted_at: null, target_action: 'w1/cleanup', payload: {}, consecutive_failure_count: 1, max_consecutive_failures: 2 });
  const events = [];
  const result = await main({ pg, jobId: 'job-1', executionId: 'exec-1', invokeAction: async () => { throw new Error('boom'); }, publishAudit: async (event) => events.push(event) });
  assert.equal(result.body.outcome, 'failed');
  assert.equal(pg.state.job.status, 'errored');
  assert.ok(events.some((event) => event.action === 'job.errored'));
});

test('timeout maps to timed_out and inactive jobs exit cleanly', async () => {
  const pg = createPg({ id: 'job-1', tenant_id: 't1', workspace_id: 'w1', status: 'active', deleted_at: null, target_action: 'w1/cleanup', payload: {}, consecutive_failure_count: 0, max_consecutive_failures: 5 });
  const timeout = await main({ pg, jobId: 'job-1', executionId: 'exec-1', invokeAction: async () => ({ timeout: true }), publishAudit: async () => {} });
  assert.equal(timeout.body.outcome, 'timed_out');

  const skipped = await main({ pg: createPg({ id: 'job-2', tenant_id: 't1', workspace_id: 'w1', status: 'paused', deleted_at: null }), jobId: 'job-2', executionId: 'exec-2', invokeAction: async () => ({ ok: true }) });
  assert.equal(skipped.body.skipped, true);
});
