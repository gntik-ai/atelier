import test from 'node:test';
import assert from 'node:assert/strict';
import { main as catalogList } from '../../../services/provisioning-orchestrator/src/actions/capability-catalog-list.mjs';
import { createFakeDb } from './fixtures/seed-capability-catalog.mjs';

const admin = { callerContext: { actor: { id: 'admin-1', type: 'superadmin' } } };

test('catalog query returns all 7 active capabilities', async () => {
  const db = createFakeDb();
  const result = await catalogList({ ...admin }, { db });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.total, 7);
  assert.ok(result.body.capabilities.every((entry) => 'capabilityKey' in entry && 'displayLabel' in entry && 'description' in entry && 'platformDefault' in entry && 'isActive' in entry && 'sortOrder' in entry));
});

test('catalog includes all expected keys', async () => {
  const db = createFakeDb();
  const result = await catalogList({ ...admin }, { db });
  assert.deepEqual(result.body.capabilities.map((entry) => entry.capabilityKey), ['sql_admin_api', 'passthrough_admin', 'realtime', 'webhooks', 'public_functions', 'custom_domains', 'scheduled_functions']);
});

test('includeInactive false excludes inactive entries', async () => {
  const db = createFakeDb();
  db._boolCatalog.push({ capability_key: 'legacy_flag', display_label: 'Legacy Flag', description: 'Legacy', platform_default: false, is_active: false, sort_order: 80 });
  const result = await catalogList({ ...admin }, { db });
  assert.equal(result.body.capabilities.some((entry) => entry.capabilityKey === 'legacy_flag'), false);
});

test('includeInactive true includes inactive entries', async () => {
  const db = createFakeDb();
  db._boolCatalog.push({ capability_key: 'legacy_flag', display_label: 'Legacy Flag', description: 'Legacy', platform_default: false, is_active: false, sort_order: 80 });
  const result = await catalogList({ ...admin, includeInactive: true }, { db });
  assert.equal(result.body.capabilities.some((entry) => entry.capabilityKey === 'legacy_flag'), true);
});

test('non-superadmin receives 403', async () => {
  const db = createFakeDb();
  await assert.rejects(() => catalogList({ callerContext: { actor: { id: 'tenant-1', type: 'tenant' } } }, { db }), (error) => error.statusCode === 403);
});
