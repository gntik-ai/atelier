import test from 'node:test';
import assert from 'node:assert/strict';
import { main as tenantCaps } from '../../../services/provisioning-orchestrator/src/actions/tenant-effective-capabilities-get.mjs';
import { main as setCapability } from '../../../services/provisioning-orchestrator/src/actions/plan-capability-set.mjs';
import { createFakeDb, createFakeProducer } from './fixtures/seed-capability-catalog.mjs';
import { seedPlans, seedAssignments } from './fixtures/seed-plans-with-capabilities.mjs';

test('tenant capabilities are isolated by plan', async () => {
  const db = createFakeDb(); seedPlans(db); seedAssignments(db);
  const basic = await tenantCaps({ callerContext: { actor: { id: 'tenant-basic-owner', type: 'tenant', tenantId: 'tenant-basic' } } }, { db });
  const full = await tenantCaps({ callerContext: { actor: { id: 'tenant-full-owner', type: 'tenant', tenantId: 'tenant-full' } } }, { db });
  assert.notDeepEqual(basic.body.capabilities, full.body.capabilities);
});

test('tenant owner can read own capabilities', async () => {
  const db = createFakeDb(); seedPlans(db); seedAssignments(db);
  const result = await tenantCaps({ callerContext: { actor: { id: 'tenant-basic-owner', type: 'tenant', tenantId: 'tenant-basic' } } }, { db });
  assert.equal(result.statusCode, 200);
});

test('tenant owner cannot modify capabilities', async () => {
  const db = createFakeDb(); const producer = createFakeProducer(); seedPlans(db); seedAssignments(db);
  await assert.rejects(() => setCapability({ planId: 'plan-active-basic', capabilities: { realtime: true }, callerContext: { actor: { id: 'tenant-basic-owner', type: 'tenant', tenantId: 'tenant-basic' } } }, { db, producer }), (error) => error.statusCode === 403);
});

test('tenant owner response excludes metadata', async () => {
  const db = createFakeDb(); seedPlans(db); seedAssignments(db);
  const result = await tenantCaps({ callerContext: { actor: { id: 'tenant-full-owner', type: 'tenant', tenantId: 'tenant-full' } } }, { db });
  assert.equal(result.body.capabilities.every((entry) => !('description' in entry) && !('source' in entry) && !('platformDefault' in entry)), true);
});
