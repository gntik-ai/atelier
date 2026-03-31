import test from 'node:test';
import assert from 'node:assert/strict';
import { main as tenantCaps } from '../../../services/provisioning-orchestrator/src/actions/tenant-effective-capabilities-get.mjs';
import { createFakeDb } from './fixtures/seed-capability-catalog.mjs';
import { seedPlans, seedAssignments } from './fixtures/seed-plans-with-capabilities.mjs';

const admin = { callerContext: { actor: { id: 'admin-1', type: 'superadmin' } } };

test('tenant on full plan sees correct capabilities', async () => {
  const db = createFakeDb(); seedPlans(db); seedAssignments(db);
  const result = await tenantCaps({ ...admin, tenantId: 'tenant-full' }, { db });
  assert.equal(result.body.capabilities.length, 7);
  assert.equal(result.body.capabilities.find((entry) => entry.displayLabel === 'SQL Admin API').enabled, true);
  assert.equal(result.body.capabilities.find((entry) => entry.displayLabel === 'Custom Domains').enabled, false);
});

test('tenant response excludes internal metadata', async () => {
  const db = createFakeDb(); seedPlans(db); seedAssignments(db);
  const result = await tenantCaps({ ...admin, tenantId: 'tenant-full' }, { db });
  assert.equal(result.body.capabilities.every((entry) => Object.keys(entry).join(',') === 'displayLabel,enabled'), true);
});

test('tenant with no assignment returns noAssignment true', async () => {
  const db = createFakeDb(); seedPlans(db); seedAssignments(db);
  const result = await tenantCaps({ ...admin, tenantId: 'tenant-none' }, { db });
  assert.equal(result.body.noAssignment, true);
  assert.equal(result.body.capabilities.length, 0);
});

test('tenant owner cannot query other tenant', async () => {
  const db = createFakeDb(); seedPlans(db); seedAssignments(db);
  await assert.rejects(() => tenantCaps({ tenantId: 'tenant-basic', callerContext: { actor: { id: 'tenant-full-owner', type: 'tenant', tenantId: 'tenant-full' } } }, { db }), (error) => error.statusCode === 403);
});

test('superadmin can query any tenant', async () => {
  const db = createFakeDb(); seedPlans(db); seedAssignments(db);
  const result = await tenantCaps({ ...admin, tenantId: 'tenant-full' }, { db });
  assert.equal(result.statusCode, 200);
});
