import test from 'node:test';
import assert from 'node:assert/strict';
import management from '../../services/scheduling-engine/actions/scheduling-management.mjs';

function pgStub() {
  const config = { tenant_id: 't1', workspace_id: 'w1', scheduling_enabled: true, max_active_jobs: 10, min_interval_seconds: 60, max_consecutive_failures: 5 };
  const job = { id: 'job-1', tenant_id: 't1', workspace_id: 'w1', name: 'cleanup', cron_expression: '0 * * * *', target_action: 'w1/cleanup', payload: { mode: 'soft' }, status: 'active', next_run_at: '2026-03-30T11:00:00.000Z', last_triggered_at: null, consecutive_failure_count: 0, created_at: '2026-03-30T10:00:00.000Z', updated_at: '2026-03-30T10:00:00.000Z' };
  return {
    async query(sql) {
      if (sql.includes('scheduling_configurations')) return { rows: [config] };
      if (sql.includes('COUNT(*)::int AS count')) return { rows: [{ count: 0 }] };
      if (sql.startsWith('INSERT INTO scheduled_jobs')) return { rows: [job] };
      if (sql.startsWith('SELECT * FROM scheduled_jobs WHERE tenant_id')) return { rows: [job] };
      if (sql.startsWith('SELECT * FROM scheduled_jobs WHERE id = $1')) return { rows: [job] };
      if (sql.startsWith('SELECT * FROM scheduled_executions')) return { rows: [{ id: 'exec-1', status: 'succeeded', scheduled_at: '2026-03-30T11:00:00.000Z', started_at: '2026-03-30T11:00:01.000Z', finished_at: '2026-03-30T11:00:02.000Z', duration_ms: 1000, error_summary: null, correlation_id: 'corr' }] };
      if (sql.startsWith('SELECT status, COUNT(*)::int AS count')) return { rows: [{ status: 'active', count: 1 }] };
      if (sql.startsWith('INSERT INTO scheduling_configurations')) return { rows: [config] };
      if (sql.startsWith('SELECT id')) return { rows: [] };
      throw new Error(`Unhandled SQL: ${sql}`);
    },
  };
}

test('request/response shapes follow contract', async () => {
  const pg = pgStub();
  const created = await management({ pg, method: 'POST', path: '/v1/scheduling/jobs', jwt: { tenantId: 't1', workspaceId: 'w1', sub: 'u1' }, body: { name: 'cleanup', cronExpression: '0 * * * *', targetAction: 'w1/cleanup', payload: { mode: 'soft' } }, validateTargetAction: async () => true });
  assert.equal(typeof created.body.jobId, 'string');
  assert.equal(typeof created.body.nextRunAt, 'string');

  const list = await management({ pg, method: 'GET', path: '/v1/scheduling/jobs', jwt: { tenantId: 't1', workspaceId: 'w1' }, query: {} });
  assert.ok(Array.isArray(list.body.items));
  assert.ok('nextCursor' in list.body);

  const detail = await management({ pg, method: 'GET', path: '/v1/scheduling/jobs/job-1', jwt: { tenantId: 't1', workspaceId: 'w1' } });
  assert.ok('payload' in detail.body);

  const executions = await management({ pg, method: 'GET', path: '/v1/scheduling/jobs/job-1/executions', jwt: { tenantId: 't1', workspaceId: 'w1' }, query: {} });
  assert.ok(Array.isArray(executions.body.items));
  assert.ok('executionId' in executions.body.items[0]);

  const summary = await management({ pg, method: 'GET', path: '/v1/scheduling/summary', jwt: { tenantId: 't1', workspaceId: 'w1' } });
  assert.equal(typeof summary.body.activeJobs, 'number');

  const config = await management({ pg, method: 'PATCH', path: '/v1/scheduling/config', jwt: { tenantId: 't1', workspaceId: 'w1' }, body: { schedulingEnabled: false } });
  assert.equal(typeof config.body.schedulingEnabled, 'boolean');
});

test('error envelope shape is stable', async () => {
  const pg = pgStub();
  const response = await management({ pg, method: 'POST', path: '/v1/scheduling/jobs', jwt: { tenantId: 't1', workspaceId: 'w1' }, body: { name: 'bad', cronExpression: '* * *', targetAction: 'w1/cleanup', payload: {} } });
  assert.deepEqual(Object.keys(response.body), ['code', 'message', 'details']);
});
