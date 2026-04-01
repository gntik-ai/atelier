import test from 'node:test';
import assert from 'node:assert/strict';
import { main as tenantBackupScopeGet } from '../../../services/provisioning-orchestrator/src/actions/tenant-backup-scope-get.mjs';
import { createFakeDb, createFakeProducer } from './fixtures/seed-backup-scope.mjs';

const superadmin = { callerContext: { actor: { id: 'admin-1', type: 'superadmin' } } };
const tenantOwnerA = { callerContext: { actor: { id: 'user-a', type: 'tenant:owner' }, tenantId: 'ten-xyz' } };
const tenantOwnerB = { callerContext: { actor: { id: 'user-b', type: 'tenant:owner' }, tenantId: 'ten-other' } };

test('superadmin GET /v1/tenants/{tenantId}/backup/scope returns entries', async () => {
  const db = createFakeDb();
  const producer = createFakeProducer();
  const result = await tenantBackupScopeGet({ ...superadmin, tenantId: 'ten-xyz' }, { db, producer });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.tenantId, 'ten-xyz');
  assert.equal(result.body.activeProfile, 'standard');
  assert.ok(result.body.entries.length > 0);
});

test('tenant owner querying own tenant succeeds', async () => {
  const db = createFakeDb();
  const producer = createFakeProducer();
  const result = await tenantBackupScopeGet({ ...tenantOwnerA, tenantId: 'ten-xyz' }, { db, producer });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.tenantId, 'ten-xyz');
  assert.ok(result.body.entries.every((e) => 'coverageStatus' in e && 'tenantHasResources' in e));
});

test('tenant owner querying another tenant gets 403', async () => {
  const db = createFakeDb();
  const producer = createFakeProducer();
  await assert.rejects(
    () => tenantBackupScopeGet({ ...tenantOwnerB, tenantId: 'ten-xyz' }, { db, producer }),
    (error) => error.statusCode === 403
  );
});

test('unknown tenantId returns 404', async () => {
  const db = createFakeDb();
  const producer = createFakeProducer();
  await assert.rejects(
    () => tenantBackupScopeGet({ ...superadmin, tenantId: 'ten-nonexistent' }, { db, producer }),
    (error) => error.statusCode === 404
  );
});

test('response includes planId and correlationId', async () => {
  const db = createFakeDb();
  const producer = createFakeProducer();
  const result = await tenantBackupScopeGet({ ...superadmin, tenantId: 'ten-xyz' }, { db, producer });
  assert.equal(result.body.planId, 'plan-pro');
  assert.ok(result.body.correlationId);
  assert.ok(result.body.generatedAt);
});

test('not-supported entries have recommendation', async () => {
  const db = createFakeDb();
  const producer = createFakeProducer();
  const result = await tenantBackupScopeGet({ ...superadmin, tenantId: 'ten-xyz' }, { db, producer });
  const notSupported = result.body.entries.filter((e) => e.coverageStatus === 'not-supported');
  for (const entry of notSupported) {
    assert.ok(entry.recommendation, `Expected recommendation for not-supported entry ${entry.componentKey}`);
  }
});
