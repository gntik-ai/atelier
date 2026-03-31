import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { main as catalogList } from '../../../services/provisioning-orchestrator/src/actions/quota-dimension-catalog-list.mjs';
import { main as setLimit } from '../../../services/provisioning-orchestrator/src/actions/plan-limits-set.mjs';
import { ensureCatalogSeeded, SEEDED_DIMENSIONS } from './fixtures/seed-catalog.mjs';
import { createFakeDb } from './fixtures/seed-plans.mjs';

test('catalog list returns all seeded dimensions for superadmin', async () => {
  const db = createFakeDb();
  await ensureCatalogSeeded(db);
  const response = await catalogList({ callerContext: { actor: { id: 'admin-1', type: 'superadmin' } } }, { db });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.total, 8);
  assert.deepEqual(response.body.dimensions.map((item) => item.dimensionKey), SEEDED_DIMENSIONS.map((item) => item.dimensionKey).sort());
});

test('unrecognized dimension key is rejected consistently', async () => {
  const db = createFakeDb();
  await ensureCatalogSeeded(db);
  await assert.rejects(
    () => setLimit({ planId: 'plan-active', dimensionKey: 'unknown_limit', value: 1, callerContext: { actor: { id: 'admin-1', type: 'superadmin' } } }, { db }),
    (error) => error.code === 'INVALID_DIMENSION_KEY' && error.statusCode === 400
  );
});

test('catalog action requires superadmin auth', async () => {
  const db = createFakeDb();
  await ensureCatalogSeeded(db);
  await assert.rejects(
    () => catalogList({ callerContext: { actor: { id: 'owner-1', type: 'tenant-owner' } } }, { db }),
    (error) => error.code === 'FORBIDDEN' && error.statusCode === 403
  );
});

test('migration file contains quota dimension DDL and seed markers', () => {
  const sql = readFileSync(new URL('../../../services/provisioning-orchestrator/src/migrations/098-plan-base-limits.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS quota_dimension_catalog/);
  assert.match(sql, /ON CONFLICT \(dimension_key\) DO NOTHING/);
});
