import test from 'node:test';
import assert from 'node:assert/strict';
import { main as setLimit } from '../../../services/provisioning-orchestrator/src/actions/plan-limits-set.mjs';
import { main as removeLimit } from '../../../services/provisioning-orchestrator/src/actions/plan-limits-remove.mjs';
import { ensureCatalogSeeded } from './fixtures/seed-catalog.mjs';
import { createFakeDb, createFakeProducer, seedPlans } from './fixtures/seed-plans.mjs';

const admin = { callerContext: { actor: { id: 'admin-1', type: 'superadmin' } } };

test('active plan mutations create audit rows and Kafka events', async () => {
  const db = createFakeDb();
  const producer = createFakeProducer();
  await ensureCatalogSeeded(db);
  await seedPlans(db);
  await setLimit({ ...admin, planId: 'plan-active', dimensionKey: 'max_workspaces', value: 12, correlationId: 'corr-1' }, { db, producer });
  await removeLimit({ ...admin, planId: 'plan-active', dimensionKey: 'max_workspaces', correlationId: 'corr-2' }, { db, producer });
  assert.equal(db.auditEvents.length, 2);
  assert.equal(db.auditEvents[0].action_type, 'plan.limit.set');
  assert.equal(db.auditEvents[1].action_type, 'plan.limit.removed');
  assert.equal(producer.messages.length, 2);
});

test('draft mutations are audited but do not emit Kafka events', async () => {
  const db = createFakeDb();
  const producer = createFakeProducer();
  await ensureCatalogSeeded(db);
  await seedPlans(db);
  await setLimit({ ...admin, planId: 'plan-draft', dimensionKey: 'max_workspaces', value: 6, correlationId: 'corr-draft' }, { db, producer });
  assert.equal(db.auditEvents.length, 1);
  assert.equal(db.auditEvents[0].correlation_id, 'corr-draft');
  assert.equal(producer.messages.length, 0);
});
