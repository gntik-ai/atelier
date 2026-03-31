import test from 'node:test';
import assert from 'node:assert/strict';
import { main as setLimit } from '../../../services/provisioning-orchestrator/src/actions/plan-limits-set.mjs';
import { main as profileGet } from '../../../services/provisioning-orchestrator/src/actions/plan-limits-profile-get.mjs';
import { main as tenantProfileGet } from '../../../services/provisioning-orchestrator/src/actions/plan-limits-tenant-get.mjs';
import { ensureCatalogSeeded } from './fixtures/seed-catalog.mjs';
import { createFakeDb, createFakeProducer, seedPlans } from './fixtures/seed-plans.mjs';

const admin = { callerContext: { actor: { id: 'admin-1', type: 'superadmin' } } };

test('profile returns defaults and explicit values across all dimensions', async () => {
  const db = createFakeDb();
  await ensureCatalogSeeded(db);
  await seedPlans(db);
  await setLimit({ ...admin, planId: 'plan-active', dimensionKey: 'max_workspaces', value: 11 }, { db, producer: createFakeProducer() });
  const response = await profileGet({ ...admin, planId: 'plan-active' }, { db });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.profile.length, 8);
  assert.equal(response.body.profile.find((item) => item.dimensionKey === 'max_workspaces').source, 'explicit');
  assert.equal(response.body.profile.find((item) => item.dimensionKey === 'max_api_keys').source, 'default');
});

test('tenant owner can query own current plan and no-assignment returns empty profile', async () => {
  const db = createFakeDb();
  await ensureCatalogSeeded(db);
  await seedPlans(db);
  const ownerResponse = await tenantProfileGet({ tenantId: 'tenant-a', callerContext: { actor: { id: 'owner-1', type: 'tenant-owner', tenantId: 'tenant-a' } } }, { db });
  assert.equal(ownerResponse.statusCode, 200);
  assert.equal(ownerResponse.body.planSlug, 'starter-active');
  const noneResponse = await tenantProfileGet({ tenantId: 'tenant-missing', callerContext: { actor: { id: 'owner-2', type: 'tenant-owner', tenantId: 'tenant-missing' } } }, { db });
  assert.deepEqual(noneResponse.body, { tenantId: 'tenant-missing', noAssignment: true, profile: [] });
});

test('non-existent plan profile returns PLAN_NOT_FOUND', async () => {
  const db = createFakeDb();
  await ensureCatalogSeeded(db);
  await assert.rejects(
    () => profileGet({ ...admin, planId: 'missing-plan' }, { db }),
    (error) => error.code === 'PLAN_NOT_FOUND' && error.statusCode === 404
  );
});
