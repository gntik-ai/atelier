import test from 'node:test';
import assert from 'node:assert/strict';
import { main as tenantConsumption } from '../../../services/provisioning-orchestrator/src/actions/tenant-consumption-snapshot-get.mjs';
import { seedTenantWithPlanAndResources } from './fixtures/seed-tenant-with-plan-and-resources.mjs';

const tenantOwner = { callerContext: { actor: { id: 'owner-1', type: 'tenant_owner', tenantId: 'tenant-b' } } };

test('tenant owner cannot read another tenant consumption snapshot', async () => {
  const db = seedTenantWithPlanAndResources();
  await assert.rejects(() => tenantConsumption({ ...tenantOwner, tenantId: 'pro-corp' }, { db }), (error) => error.code === 'FORBIDDEN');
});
