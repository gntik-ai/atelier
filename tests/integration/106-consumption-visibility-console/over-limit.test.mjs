import test from 'node:test';
import assert from 'node:assert/strict';
import { main as tenantConsumption } from '../../../services/provisioning-orchestrator/src/actions/tenant-consumption-snapshot-get.mjs';
import { seedTenantWithPlanAndResources } from './fixtures/seed-tenant-with-plan-and-resources.mjs';

const admin = { callerContext: { actor: { id: 'admin-1', type: 'superadmin' } } };

test('over-limit dimension reports over_limit status', async () => {
  const db = seedTenantWithPlanAndResources();
  db.functions.push(...Array.from({ length: 40 }, () => ({ tenantId: 'acme-corp', workspaceId: 'ws-fn' })));
  const result = await tenantConsumption({ ...admin, tenantId: 'acme-corp' }, { db });
  const entry = result.body.dimensions.find((x) => x.dimensionKey === 'max_functions');
  assert.equal(entry.currentUsage, 55);
  assert.equal(entry.usageStatus, 'over_limit');
});
