import test from 'node:test';
import assert from 'node:assert/strict';
import { main as tenantConsumption } from '../../../services/provisioning-orchestrator/src/actions/tenant-consumption-snapshot-get.mjs';
import { seedTenantWithPlanAndResources } from './fixtures/seed-tenant-with-plan-and-resources.mjs';

const admin = { callerContext: { actor: { id: 'admin-1', type: 'superadmin' } } };

test('unlimited dimension remains within_limit while exposing usage', async () => {
  const db = seedTenantWithPlanAndResources();
  db.functions.push(...Array.from({ length: 5 }, () => ({ tenantId: 'unlimited-corp', workspaceId: 'ws-u' })));
  const result = await tenantConsumption({ ...admin, tenantId: 'unlimited-corp' }, { db });
  const entry = result.body.dimensions.find((x) => x.dimensionKey === 'max_functions');
  assert.equal(entry.currentUsage, 5);
  assert.equal(entry.usageStatus, 'within_limit');
});
