import test from 'node:test';
import assert from 'node:assert/strict';
import { main as backupScopeGet } from '../../../services/provisioning-orchestrator/src/actions/backup-scope-get.mjs';
import { createFakeDb, createFakeProducer } from './fixtures/seed-backup-scope.mjs';

const superadmin = { callerContext: { actor: { id: 'admin-1', type: 'superadmin' } } };
const sre = { callerContext: { actor: { id: 'sre-1', type: 'sre' } } };
const tenant = { callerContext: { actor: { id: 'tenant-1', type: 'tenant:owner' }, tenantId: 'ten-abc' } };

test('GET /v1/admin/backup/scope as superadmin returns 7 entries for active profile', async () => {
  const db = createFakeDb();
  const producer = createFakeProducer();
  const result = await backupScopeGet({ ...superadmin }, { db, producer });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.entries.length, 7);
  assert.equal(result.body.activeProfile, 'standard');
  assert.ok(result.body.entries.every((e) => e.coverageStatus !== null && e.coverageStatus !== undefined));
});

test('GET /v1/admin/backup/scope?profile=all returns 21 entries', async () => {
  const db = createFakeDb();
  const producer = createFakeProducer();
  const result = await backupScopeGet({ ...superadmin, profile: 'all' }, { db, producer });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.entries.length, 21);
});

test('GET /v1/admin/backup/scope?profile=ha returns 7 entries with profileKey=ha', async () => {
  const db = createFakeDb();
  const producer = createFakeProducer();
  const result = await backupScopeGet({ ...superadmin, profile: 'ha' }, { db, producer });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.entries.length, 7);
  assert.ok(result.body.entries.every((e) => e.profileKey === 'ha'));
});

test('GET /v1/admin/backup/scope?profile=chaos returns 400 BACKUP_SCOPE_UNKNOWN_PROFILE', async () => {
  const db = createFakeDb();
  const producer = createFakeProducer();
  const result = await backupScopeGet({ ...superadmin, profile: 'chaos' }, { db, producer });
  assert.equal(result.statusCode, 400);
  assert.equal(result.body.error, 'BACKUP_SCOPE_UNKNOWN_PROFILE');
});

test('GET /v1/admin/backup/scope as unauthorized role returns 403', async () => {
  const db = createFakeDb();
  const producer = createFakeProducer();
  await assert.rejects(
    () => backupScopeGet({ ...tenant }, { db, producer }),
    (error) => error.statusCode === 403
  );
});

test('GET /v1/admin/backup/scope as SRE succeeds', async () => {
  const db = createFakeDb();
  const producer = createFakeProducer();
  const result = await backupScopeGet({ ...sre }, { db, producer });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.entries.length, 7);
});

test('all entries have operationalStatus unknown when health join disabled', async () => {
  const db = createFakeDb({ healthJoinEnabled: false });
  const producer = createFakeProducer();
  const result = await backupScopeGet({ ...superadmin }, { db, producer });
  assert.equal(result.statusCode, 200);
  assert.ok(result.body.entries.every((e) => e.operationalStatus === 'unknown'));
});

test('response includes correlationId and generatedAt', async () => {
  const db = createFakeDb();
  const producer = createFakeProducer();
  const result = await backupScopeGet({ ...superadmin }, { db, producer });
  assert.ok(result.body.correlationId);
  assert.ok(result.body.generatedAt);
});
