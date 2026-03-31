import test from 'node:test';
import assert from 'node:assert/strict';
import { main as setCapability } from '../../../services/provisioning-orchestrator/src/actions/plan-capability-set.mjs';
import { createFakeDb, createFakeProducer } from './fixtures/seed-capability-catalog.mjs';
import { seedPlans } from './fixtures/seed-plans-with-capabilities.mjs';

const admin = { callerContext: { actor: { id: 'admin-1', type: 'superadmin' } } };

test('enable realtime and webhooks on draft plan', async () => {
  const db = createFakeDb(); const producer = createFakeProducer(); seedPlans(db);
  const result = await setCapability({ ...admin, planId: 'plan-draft', capabilities: { realtime: true, webhooks: true } }, { db, producer });
  assert.equal(result.body.changed.length, 2);
  assert.equal(result.body.effectiveCapabilities.realtime, true);
});

test('disable webhooks records audit event', async () => {
  const db = createFakeDb(); const producer = createFakeProducer(); seedPlans(db);
  const result = await setCapability({ ...admin, planId: 'plan-active-basic', capabilities: { webhooks: false } }, { db, producer });
  assert.equal(result.body.changed[0].previousState, true);
  assert.equal(result.body.changed[0].newState, false);
  assert.equal(db._planAuditEvents[0].action_type, 'plan.capability.disabled');
});

test('enable nonexistent feature rejected', async () => {
  const db = createFakeDb(); const producer = createFakeProducer(); seedPlans(db);
  await assert.rejects(() => setCapability({ ...admin, planId: 'plan-draft', capabilities: { nonexistent_feature: true } }, { db, producer }), (error) => error.statusCode === 400 && error.code === 'INVALID_CAPABILITY_KEY');
});

test('no-op produces no audit event', async () => {
  const db = createFakeDb(); const producer = createFakeProducer(); seedPlans(db);
  const result = await setCapability({ ...admin, planId: 'plan-deprecated', capabilities: { realtime: true } }, { db, producer });
  assert.equal(result.body.changed.length, 0);
  assert.equal(db._planAuditEvents.length, 0);
});

test('archived plan rejected', async () => {
  const db = createFakeDb(); const producer = createFakeProducer(); seedPlans(db);
  await assert.rejects(() => setCapability({ ...admin, planId: 'plan-archived', capabilities: { realtime: true } }, { db, producer }), (error) => error.statusCode === 409);
});

test('deprecated plan accepted with audit', async () => {
  const db = createFakeDb(); const producer = createFakeProducer(); seedPlans(db);
  const result = await setCapability({ ...admin, planId: 'plan-deprecated', capabilities: { webhooks: true } }, { db, producer });
  assert.equal(result.statusCode, 200);
  assert.equal(db._planAuditEvents.length, 1);
});

test('multiple capabilities create individual audit events', async () => {
  const db = createFakeDb(); const producer = createFakeProducer(); seedPlans(db);
  await setCapability({ ...admin, planId: 'plan-draft', capabilities: { realtime: true, webhooks: true, custom_domains: true } }, { db, producer });
  assert.equal(db._planAuditEvents.length, 3);
});

test('no capabilities specified rejected', async () => {
  const db = createFakeDb(); const producer = createFakeProducer(); seedPlans(db);
  await assert.rejects(() => setCapability({ ...admin, planId: 'plan-draft', capabilities: {} }, { db, producer }), (error) => error.statusCode === 400 && error.code === 'NO_CAPABILITIES_SPECIFIED');
});

test('non boolean value rejected', async () => {
  const db = createFakeDb(); const producer = createFakeProducer(); seedPlans(db);
  await assert.rejects(() => setCapability({ ...admin, planId: 'plan-draft', capabilities: { realtime: 'yes' } }, { db, producer }), (error) => error.statusCode === 400 && error.code === 'INVALID_CAPABILITY_VALUE');
});

test('two plans have identical effective capability keys', async () => {
  const db = createFakeDb(); const producer = createFakeProducer(); seedPlans(db);
  const draft = await setCapability({ ...admin, planId: 'plan-draft', capabilities: { realtime: true } }, { db, producer });
  const basic = await setCapability({ ...admin, planId: 'plan-active-basic', capabilities: { custom_domains: true } }, { db, producer });
  assert.deepEqual(Object.keys(draft.body.effectiveCapabilities), Object.keys(basic.body.effectiveCapabilities));
});
