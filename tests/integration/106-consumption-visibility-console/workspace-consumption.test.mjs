import test from 'node:test';
import assert from 'node:assert/strict';
import { main as workspaceConsumption } from '../../../services/provisioning-orchestrator/src/actions/workspace-consumption-get.mjs';
import { seedWorkspaceWithSubQuotas } from './fixtures/seed-workspace-with-sub-quotas.mjs';

const admin = { callerContext: { actor: { id: 'admin-1', type: 'superadmin' } } };

test('workspace consumption returns sub-quota source and current usage', async () => {
  const db = seedWorkspaceWithSubQuotas();
  const result = await workspaceConsumption({ ...admin, tenantId: 'pro-corp', workspaceId: 'ws-prod' }, { db });
  const entry = result.body.dimensions.find((x) => x.dimensionKey === 'max_pg_databases');
  assert.equal(entry.workspaceSource, 'workspace_sub_quota');
  assert.equal(entry.workspaceLimit, 6);
  assert.equal(entry.currentUsage, 4);
});
