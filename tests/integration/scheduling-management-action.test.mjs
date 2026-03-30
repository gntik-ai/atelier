import test from 'node:test';
import assert from 'node:assert/strict';
import main from '../../services/scheduling-engine/actions/scheduling-management.mjs';

function createPg() {
  const state = { jobs: [], configs: [], executions: [] };
  return {
    state,
    async query(sql, params = []) {
      if (sql.startsWith('SELECT * FROM scheduling_configurations WHERE tenant_id = $1 AND workspace_id = $2')) {
        return { rows: state.configs.filter((row) => row.tenant_id === params[0] && row.workspace_id === params[1]) };
      }
      if (sql.startsWith('SELECT * FROM scheduling_configurations WHERE tenant_id = $1 AND workspace_id IS NULL')) {
        return { rows: state.configs.filter((row) => row.tenant_id === params[0] && row.workspace_id == null) };
      }
      if (sql.startsWith('INSERT INTO scheduling_configurations')) {
        const row = { tenant_id: params[0], workspace_id: params[1], scheduling_enabled: params[2], max_active_jobs: params[3], min_interval_seconds: params[4], max_consecutive_failures: params[5] };
        state.configs = state.configs.filter((item) => !(item.tenant_id === row.tenant_id && item.workspace_id === row.workspace_id));
        state.configs.push(row);
        return { rows: [row] };
      }
      if (sql.includes('COUNT(*)::int AS count') && sql.includes('status = \'active\'')) {
        return { rows: [{ count: state.jobs.filter((j) => j.tenant_id === params[0] && j.workspace_id === params[1] && j.status === 'active' && !j.deleted_at).length }] };
      }
      if (sql.startsWith('INSERT INTO scheduled_jobs')) {
        const row = { id: params[0], tenant_id: params[1], workspace_id: params[2], name: params[3], cron_expression: params[4], target_action: params[5], payload: params[6], status: params[7], consecutive_failure_count: params[8], max_consecutive_failures: params[9], next_run_at: params[10], created_by: params[11], created_at: params[12], updated_at: params[13], deleted_at: null, last_triggered_at: null };
        state.jobs.push(row);
        return { rows: [row] };
      }
      if (sql.startsWith('SELECT * FROM scheduled_jobs WHERE tenant_id = $1 AND workspace_id = $2')) {
        return { rows: state.jobs.filter((j) => j.tenant_id === params[0] && j.workspace_id === params[1] && !j.deleted_at) };
      }
      if (sql.startsWith('SELECT * FROM scheduled_jobs WHERE id = $1')) {
        return { rows: state.jobs.filter((j) => j.id === params[0] && j.tenant_id === params[1] && j.workspace_id === params[2] && !j.deleted_at) };
      }
      if (sql.startsWith('UPDATE scheduled_jobs SET status = $2, updated_at = $3')) {
        const job = state.jobs.find((j) => j.id === params[0]); job.status = params[1]; job.updated_at = params[2]; return { rows: [job] };
      }
      if (sql.startsWith('UPDATE scheduled_jobs SET status = $2, next_run_at = $3')) {
        const job = state.jobs.find((j) => j.id === params[0]); job.status = params[1]; job.next_run_at = params[2]; job.updated_at = params[3]; return { rows: [job] };
      }
      if (sql.startsWith('UPDATE scheduled_jobs SET name = $2')) {
        const job = state.jobs.find((j) => j.id === params[0]);
        Object.assign(job, { name: params[1], cron_expression: params[2], target_action: params[3], payload: params[4], next_run_at: params[5] });
        return { rows: [job] };
      }
      if (sql.startsWith("UPDATE scheduled_jobs SET status = 'deleted'")) {
        const job = state.jobs.find((j) => j.id === params[0] && j.tenant_id === params[1] && j.workspace_id === params[2]);
        if (!job) return { rows: [] };
        job.status = 'deleted'; job.deleted_at = new Date().toISOString();
        return { rows: [job] };
      }
      if (sql.startsWith('SELECT status, COUNT(*)::int AS count FROM scheduled_jobs')) {
        const rows = ['active', 'paused', 'errored', 'deleted'].map((status) => ({ status, count: state.jobs.filter((j) => j.tenant_id === params[0] && j.workspace_id === params[1] && j.status === status).length })).filter((row) => row.count > 0);
        return { rows };
      }
      if (sql.startsWith('SELECT id\n       FROM scheduled_jobs')) {
        return { rows: state.jobs.filter((j) => j.tenant_id === params[0] && j.workspace_id === params[1] && j.status === 'active' && !j.deleted_at).map((j) => ({ id: j.id })) };
      }
      if (sql.startsWith("UPDATE scheduled_jobs SET status = 'paused'")) {
        for (const id of params[0]) { const job = state.jobs.find((j) => j.id === id); if (job) job.status = 'paused'; }
        return { rows: [] };
      }
      if (sql.startsWith('SELECT * FROM scheduled_executions')) return { rows: [] };
      throw new Error(`Unhandled SQL: ${sql}`);
    },
  };
}

test('full lifecycle and summary/config flow', async () => {
  const pg = createPg();
  const events = [];
  await main({ pg, method: 'PATCH', path: '/v1/scheduling/config', jwt: { tenantId: 't1', workspaceId: 'w1', sub: 'u1' }, body: { schedulingEnabled: true, maxActiveJobs: 2 } , publishAudit: async (event) => events.push(event) });

  const created = await main({ pg, method: 'POST', path: '/v1/scheduling/jobs', jwt: { tenantId: 't1', workspaceId: 'w1', sub: 'u1' }, body: { name: 'cleanup', cronExpression: '0 * * * *', targetAction: 'w1/cleanup', payload: { mode: 'soft' } }, validateTargetAction: async () => true, publishAudit: async (event) => events.push(event) });
  assert.equal(created.statusCode, 201);

  const listed = await main({ pg, method: 'GET', path: '/v1/scheduling/jobs', jwt: { tenantId: 't1', workspaceId: 'w1' }, query: {} });
  assert.equal(listed.body.items.length, 1);

  const updated = await main({ pg, method: 'PATCH', path: `/v1/scheduling/jobs/${created.body.jobId}`, jwt: { tenantId: 't1', workspaceId: 'w1', sub: 'u1' }, body: { cronExpression: '*/5 * * * *' }, validateTargetAction: async () => true, publishAudit: async (event) => events.push(event) });
  assert.equal(updated.statusCode, 200);

  const paused = await main({ pg, method: 'POST', path: `/v1/scheduling/jobs/${created.body.jobId}/pause`, jwt: { tenantId: 't1', workspaceId: 'w1', sub: 'u1' }, publishAudit: async (event) => events.push(event) });
  assert.equal(paused.body.status, 'paused');

  const resumed = await main({ pg, method: 'POST', path: `/v1/scheduling/jobs/${created.body.jobId}/resume`, jwt: { tenantId: 't1', workspaceId: 'w1', sub: 'u1' }, publishAudit: async (event) => events.push(event) });
  assert.equal(resumed.body.status, 'active');

  const summary = await main({ pg, method: 'GET', path: '/v1/scheduling/summary', jwt: { tenantId: 't1', workspaceId: 'w1' } });
  assert.equal(summary.body.activeJobs, 1);

  const disabled = await main({ pg, method: 'PATCH', path: '/v1/scheduling/config', jwt: { tenantId: 't1', workspaceId: 'w1', sub: 'u1' }, body: { schedulingEnabled: false }, publishAudit: async (event) => events.push(event) });
  assert.equal(disabled.body.schedulingEnabled, false);

  const blockedResume = await main({ pg, method: 'POST', path: `/v1/scheduling/jobs/${created.body.jobId}/resume`, jwt: { tenantId: 't1', workspaceId: 'w1', sub: 'u1' } });
  assert.equal(blockedResume.statusCode, 403);

  const deleted = await main({ pg, method: 'DELETE', path: `/v1/scheduling/jobs/${created.body.jobId}`, jwt: { tenantId: 't1', workspaceId: 'w1', sub: 'u1' }, publishAudit: async (event) => events.push(event) });
  assert.equal(deleted.statusCode, 204);
  assert.ok(events.length >= 5);
});

test('quota and tenant isolation checks', async () => {
  const pg = createPg();
  await main({ pg, method: 'PATCH', path: '/v1/scheduling/config', jwt: { tenantId: 't1', workspaceId: 'w1' }, body: { schedulingEnabled: true, maxActiveJobs: 1 } });
  await main({ pg, method: 'POST', path: '/v1/scheduling/jobs', jwt: { tenantId: 't1', workspaceId: 'w1' }, body: { name: 'one', cronExpression: '0 * * * *', targetAction: 'w1/a', payload: {} }, validateTargetAction: async () => true });
  const quota = await main({ pg, method: 'POST', path: '/v1/scheduling/jobs', jwt: { tenantId: 't1', workspaceId: 'w1' }, body: { name: 'two', cronExpression: '0 * * * *', targetAction: 'w1/b', payload: {} }, validateTargetAction: async () => true });
  assert.equal(quota.statusCode, 409);
  const notFound = await main({ pg, method: 'GET', path: `/v1/scheduling/jobs/${pg.state.jobs[0].id}`, jwt: { tenantId: 't2', workspaceId: 'w2' } });
  assert.equal(notFound.statusCode, 404);
});
