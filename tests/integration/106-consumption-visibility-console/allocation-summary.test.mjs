import test from 'node:test';
import assert from 'node:assert/strict';
import { main as allocationSummary } from '../../../services/provisioning-orchestrator/src/actions/tenant-workspace-allocation-summary-get.mjs';
import { seedWorkspaceWithSubQuotas } from './fixtures/seed-workspace-with-sub-quotas.mjs';

const admin = { callerContext: { actor: { id: 'admin-1', type: 'superadmin' } } };

test('allocation summary returns arithmetic per dimension', async () => {
  const db = seedWorkspaceWithSubQuotas();
  const result = await allocationSummary({ ...admin, tenantId: 'pro-corp' }, { db });
  const entry = result.body.dimensions.find((x) => x.dimensionKey === 'max_pg_databases');
  assert.equal(entry.totalAllocated, 11);
  assert.equal(entry.unallocated, 0);
  assert.equal(entry.isFullyAllocated, true);
});
