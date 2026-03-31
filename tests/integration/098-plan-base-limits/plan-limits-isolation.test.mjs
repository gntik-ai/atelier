import test from 'node:test';
import assert from 'node:assert/strict';
import { main as tenantProfileGet } from '../../../services/provisioning-orchestrator/src/actions/plan-limits-tenant-get.mjs';
import { main as profileGet } from '../../../services/provisioning-orchestrator/src/actions/plan-limits-profile-get.mjs';
import { ensureCatalogSeeded } from './fixtures/seed-catalog.mjs';
import { createFakeDb, seedPlans } from './fixtures/seed-plans.mjs';

test('tenant owner cannot access another tenant profile', async () => {
  const db = createFakeDb();
  await ensureCatalogSeeded(db);
  await seedPlans(db);
  await assert.rejects(
    () => tenantProfileGet({ tenantId: 'tenant-b', callerContext: { actor: { id: 'owner-1', type: 'tenant-owner', tenantId: 'tenant-a' } } }, { db }),
    (error) => error.code === 'FORBIDDEN' && error.statusCode === 403
  );
});

test('tenant profile omits internal metadata and superadmin can query any plan', async () => {
  const db = createFakeDb();
  await ensureCatalogSeeded(db);
  await seedPlans(db);
  const tenantResponse = await tenantProfileGet({ tenantId: 'tenant-a', callerContext: { actor: { id: 'owner-1', type: 'tenant-owner', tenantId: 'tenant-a' } } }, { db });
  assert.equal(tenantResponse.statusCode, 200);
  assert.equal(Object.hasOwn(tenantResponse.body, 'actorId'), false);
  assert.equal(Object.hasOwn(tenantResponse.body, 'correlationId'), false);
  assert.equal(Object.hasOwn(tenantResponse.body.profile[0], 'id'), false);
  const adminResponse = await profileGet({ planId: 'plan-active', callerContext: { actor: { id: 'admin-1', type: 'superadmin' } } }, { db });
  assert.equal(adminResponse.statusCode, 200);
});
