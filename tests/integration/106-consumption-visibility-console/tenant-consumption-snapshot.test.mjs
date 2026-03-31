import test from 'node:test';
import assert from 'node:assert/strict';
import { main as tenantConsumption } from '../../../services/provisioning-orchestrator/src/actions/tenant-consumption-snapshot-get.mjs';
import { main as tenantEntitlements } from '../../../services/provisioning-orchestrator/src/actions/tenant-effective-entitlements-get.mjs';
import { seedTenantWithPlanAndResources } from './fixtures/seed-tenant-with-plan-and-resources.mjs';

const admin = { callerContext: { actor: { id: 'admin-1', type: 'superadmin' } } };

test('tenant consumption snapshot returns counts and threshold status', async () => {
  const db = seedTenantWithPlanAndResources();
  const result = await tenantConsumption({ ...admin, tenantId: 'pro-corp' }, { db });
  assert.equal(result.body.dimensions.find((x) => x.dimensionKey === 'max_workspaces').currentUsage, 3);
  assert.equal(result.body.dimensions.find((x) => x.dimensionKey === 'max_pg_databases').usageStatus, 'approaching_limit');
});

test('effective entitlements include consumption when requested', async () => {
  const db = seedTenantWithPlanAndResources();
  const result = await tenantEntitlements({ ...admin, tenantId: 'pro-corp', include: 'consumption' }, { db });
  assert.equal(result.body.quantitativeLimits.find((x) => x.dimensionKey === 'max_workspaces').currentUsage, 3);
});
