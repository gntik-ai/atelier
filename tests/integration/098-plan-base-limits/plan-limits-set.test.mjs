import test from 'node:test';
import assert from 'node:assert/strict';
import { main as setLimit } from '../../../services/provisioning-orchestrator/src/actions/plan-limits-set.mjs';
import { main as profileGet } from '../../../services/provisioning-orchestrator/src/actions/plan-limits-profile-get.mjs';
import { ensureCatalogSeeded } from './fixtures/seed-catalog.mjs';
import { createFakeDb, createFakeProducer, seedPlans } from './fixtures/seed-plans.mjs';

const admin = { callerContext: { actor: { id: 'admin-1', type: 'superadmin' } } };

test('draft plan mutation persists without Kafka emission', async () => {
  const db = createFakeDb();
  const producer = createFakeProducer();
  await ensureCatalogSeeded(db);
  await seedPlans(db);
  const response = await setLimit({ ...admin, planId: 'plan-draft', dimensionKey: 'max_workspaces', value: 9 }, { db, producer });
  assert.equal(response.statusCode, 200);
  assert.equal(db.plans.get('plan-draft').quota_dimensions.max_workspaces, 9);
  assert.equal(producer.messages.length, 0);
});

test('active plan mutation persists and emits Kafka event', async () => {
  const db = createFakeDb();
  const producer = createFakeProducer();
  await ensureCatalogSeeded(db);
  await seedPlans(db);
  const response = await setLimit({ ...admin, planId: 'plan-active', dimensionKey: 'max_workspaces', value: 10 }, { db, producer });
  assert.equal(response.body.newValue, 10);
  assert.equal(producer.messages.length, 1);
  assert.equal(JSON.parse(producer.messages[0].messages[0].value).newState.newValue, 10);
});

test('deprecated and archived plans are frozen', async () => {
  for (const planId of ['plan-deprecated', 'plan-archived']) {
    const db = createFakeDb();
    await ensureCatalogSeeded(db);
    await seedPlans(db);
    await assert.rejects(
      () => setLimit({ ...admin, planId, dimensionKey: 'max_workspaces', value: 2 }, { db, producer: createFakeProducer() }),
      (error) => error.code === 'PLAN_LIMITS_FROZEN' && error.statusCode === 409
    );
  }
});

test('unlimited and zero values round-trip correctly', async () => {
  const db = createFakeDb();
  await ensureCatalogSeeded(db);
  await seedPlans(db);
  await setLimit({ ...admin, planId: 'plan-active', dimensionKey: 'max_functions', value: -1 }, { db, producer: createFakeProducer() });
  await setLimit({ ...admin, planId: 'plan-active', dimensionKey: 'max_api_keys', value: 0 }, { db, producer: createFakeProducer() });
  const response = await profileGet({ ...admin, planId: 'plan-active' }, { db });
  assert.equal(response.body.profile.find((item) => item.dimensionKey === 'max_functions').unlimitedSentinel, true);
  assert.equal(response.body.profile.find((item) => item.dimensionKey === 'max_api_keys').effectiveValue, 0);
});

test('invalid negative and float values are rejected', async () => {
  const db = createFakeDb();
  await ensureCatalogSeeded(db);
  await seedPlans(db);
  for (const value of [-2, 1.5]) {
    await assert.rejects(
      () => setLimit({ ...admin, planId: 'plan-active', dimensionKey: 'max_workspaces', value }, { db, producer: createFakeProducer() }),
      (error) => error.code === 'INVALID_LIMIT_VALUE' && error.statusCode === 400
    );
  }
});
