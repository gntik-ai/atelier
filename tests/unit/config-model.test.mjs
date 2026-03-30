import test from 'node:test';
import assert from 'node:assert/strict';
import { getConfig, isSchedulingEnabled, getActiveJobsToSuspend } from '../../services/scheduling-engine/src/config-model.mjs';

function makePg(workspaceRow, tenantRow, activeRows = []) {
  return {
    async query(sql) {
      if (sql.includes('FROM scheduled_jobs')) return { rows: activeRows };
      if (sql.includes('workspace_id = $2')) return { rows: workspaceRow ? [workspaceRow] : [] };
      if (sql.includes('workspace_id IS NULL')) return { rows: tenantRow ? [tenantRow] : [] };
      return { rows: [] };
    },
  };
}

test('getConfig prefers workspace override then tenant default', async () => {
  const workspace = await getConfig(makePg({ scheduling_enabled: true }, { scheduling_enabled: false }), 't1', 'w1');
  assert.equal(workspace.scheduling_enabled, true);
  const tenant = await getConfig(makePg(null, { scheduling_enabled: false, max_active_jobs: 7, min_interval_seconds: 120, max_consecutive_failures: 4 }), 't1', 'w1');
  assert.equal(tenant.scheduling_enabled, false);
});

test('getConfig falls back to env defaults and enabled check works', async () => {
  process.env.SCHEDULING_ENABLED_BY_DEFAULT = 'true';
  const config = await getConfig(makePg(null, null), 't1', 'w1');
  assert.equal(isSchedulingEnabled(config), true);
});

test('getActiveJobsToSuspend returns active job ids only', async () => {
  const ids = await getActiveJobsToSuspend(makePg(null, null, [{ id: 'a' }, { id: 'b' }]), 't1', 'w1');
  assert.deepEqual(ids, ['a', 'b']);
});
