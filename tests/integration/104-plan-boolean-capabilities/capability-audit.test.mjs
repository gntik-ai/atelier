import test from 'node:test';
import assert from 'node:assert/strict';
import { main as setCapability } from '../../../services/provisioning-orchestrator/src/actions/plan-capability-set.mjs';
import { main as auditQuery } from '../../../services/provisioning-orchestrator/src/actions/plan-capability-audit-query.mjs';
import { createFakeDb, createFakeProducer } from './fixtures/seed-capability-catalog.mjs';
import { seedPlans } from './fixtures/seed-plans-with-capabilities.mjs';

const admin = { callerContext: { actor: { id: 'admin-1', type: 'superadmin' } } };

test('enable webhooks writes audit event', async () => {
  const db = createFakeDb(); const producer = createFakeProducer(); seedPlans(db);
  await setCapability({ ...admin, planId: 'plan-draft', capabilities: { webhooks: true } }, { db, producer });
  assert.equal(db._planAuditEvents[0].actor_id, 'admin-1');
  assert.equal(db._planAuditEvents[0].new_state.newState, true);
});

test('disable realtime writes audit event', async () => {
  const db = createFakeDb(); const producer = createFakeProducer(); seedPlans(db);
  await setCapability({ ...admin, planId: 'plan-deprecated', capabilities: { realtime: false } }, { db, producer });
  assert.equal(db._planAuditEvents[0].previous_state.previousState, true);
  assert.equal(db._planAuditEvents[0].new_state.newState, false);
});

test('audit query returns chronologically', async () => {
  const db = createFakeDb(); const producer = createFakeProducer(); seedPlans(db);
  await setCapability({ ...admin, planId: 'plan-draft', capabilities: { webhooks: true, realtime: true, custom_domains: true } }, { db, producer });
  const result = await auditQuery({ ...admin }, { db });
  assert.equal(result.body.events[0].timestamp <= result.body.events[1].timestamp, true);
});

test('audit query filters by capability key', async () => {
  const db = createFakeDb(); const producer = createFakeProducer(); seedPlans(db);
  await setCapability({ ...admin, planId: 'plan-draft', capabilities: { webhooks: true, realtime: true } }, { db, producer });
  const result = await auditQuery({ ...admin, capabilityKey: 'webhooks' }, { db });
  assert.equal(result.body.events.every((entry) => entry.capabilityKey === 'webhooks'), true);
});

test('kafka enable event emitted', async () => {
  const db = createFakeDb(); const producer = createFakeProducer(); seedPlans(db);
  await setCapability({ ...admin, planId: 'plan-draft', capabilities: { webhooks: true } }, { db, producer });
  assert.equal(producer.messages[0].topic, 'console.plan.capability.enabled');
});

test('kafka disable event emitted', async () => {
  const db = createFakeDb(); const producer = createFakeProducer(); seedPlans(db);
  await setCapability({ ...admin, planId: 'plan-active-basic', capabilities: { webhooks: false } }, { db, producer });
  assert.equal(producer.messages[0].topic, 'console.plan.capability.disabled');
});

test('no-op has no audit or kafka', async () => {
  const db = createFakeDb(); const producer = createFakeProducer(); seedPlans(db);
  await setCapability({ ...admin, planId: 'plan-deprecated', capabilities: { realtime: true } }, { db, producer });
  assert.equal(db._planAuditEvents.length, 0);
  assert.equal(producer.messages.length, 0);
});
