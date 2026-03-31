import test from 'node:test';
import assert from 'node:assert/strict';
import { main as profileGet } from '../../../services/provisioning-orchestrator/src/actions/plan-capability-profile-get.mjs';
import { createFakeDb } from './fixtures/seed-capability-catalog.mjs';
import { seedPlans } from './fixtures/seed-plans-with-capabilities.mjs';

const admin = { callerContext: { actor: { id: 'admin-1', type: 'superadmin' } } };

test('profile contains all 7 active catalog entries', async () => {
  const db = createFakeDb(); seedPlans(db);
  const result = await profileGet({ ...admin, planId: 'plan-active-full' }, { db });
  assert.equal(result.body.capabilityProfile.length, 7);
});

test('explicit capability has explicit source', async () => {
  const db = createFakeDb(); seedPlans(db);
  const result = await profileGet({ ...admin, planId: 'plan-active-full' }, { db });
  assert.equal(result.body.capabilityProfile.find((entry) => entry.capabilityKey === 'realtime').source, 'explicit');
});

test('unset capability has platform_default source', async () => {
  const db = createFakeDb(); seedPlans(db);
  const result = await profileGet({ ...admin, planId: 'plan-active-full' }, { db });
  const entry = result.body.capabilityProfile.find((item) => item.capabilityKey === 'custom_domains');
  assert.equal(entry.source, 'platform_default');
  assert.equal(entry.enabled, false);
});

test('orphaned capability flagged separately', async () => {
  const db = createFakeDb(); seedPlans(db);
  const result = await profileGet({ ...admin, planId: 'plan-with-orphan' }, { db });
  assert.deepEqual(result.body.orphanedCapabilities[0], { capabilityKey: 'legacy_feature', enabled: true, status: 'orphaned' });
});

test('two plans produce identical profile schemas', async () => {
  const db = createFakeDb(); seedPlans(db);
  const left = await profileGet({ ...admin, planId: 'plan-active-full' }, { db });
  const right = await profileGet({ ...admin, planId: 'plan-active-basic' }, { db });
  assert.deepEqual(Object.keys(left.body.capabilityProfile[0]), Object.keys(right.body.capabilityProfile[0]));
});

test('missing plan yields 404', async () => {
  const db = createFakeDb(); seedPlans(db);
  await assert.rejects(() => profileGet({ ...admin, planId: 'missing' }, { db }), (error) => error.statusCode === 404);
});
