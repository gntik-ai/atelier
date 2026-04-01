import test from 'node:test';
import assert from 'node:assert/strict';
import { main as backupScopeGet } from '../../../services/provisioning-orchestrator/src/actions/backup-scope-get.mjs';
import { main as tenantBackupScopeGet } from '../../../services/provisioning-orchestrator/src/actions/tenant-backup-scope-get.mjs';
import { createFakeDb, createFakeProducer } from './fixtures/seed-backup-scope.mjs';

const superadmin = { callerContext: { actor: { id: 'admin-1', type: 'superadmin' } } };

test('admin scope query publishes audit event to Kafka', async () => {
  const db = createFakeDb();
  const producer = createFakeProducer();
  await backupScopeGet({ ...superadmin }, { db, producer });

  // Allow fire-and-forget to settle
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(producer.messages.length, 1);
  const msg = producer.messages[0];
  assert.equal(msg.topic, 'console.backup.scope.queried');
  const event = JSON.parse(msg.messages[0].value);
  assert.equal(event.eventType, 'backup.scope.queried');
  assert.ok(event.correlationId);
  assert.equal(event.actor.id, 'admin-1');
  assert.equal(event.actor.role, 'superadmin');
  assert.ok(event.timestamp);
  assert.equal(event.tenantId, null);
});

test('tenant scope query publishes audit event with tenantId', async () => {
  const db = createFakeDb();
  const producer = createFakeProducer();
  await tenantBackupScopeGet({ ...superadmin, tenantId: 'ten-xyz' }, { db, producer });

  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(producer.messages.length, 1);
  const event = JSON.parse(producer.messages[0].messages[0].value);
  assert.equal(event.eventType, 'backup.scope.queried');
  assert.equal(event.tenantId, 'ten-xyz');
  assert.equal(event.actor.id, 'admin-1');
});

test('audit event conforms to backup-scope-query-event.json schema', async () => {
  const db = createFakeDb();
  const producer = createFakeProducer();
  await backupScopeGet({ ...superadmin, profile: 'ha' }, { db, producer });

  await new Promise((resolve) => setTimeout(resolve, 50));

  const event = JSON.parse(producer.messages[0].messages[0].value);

  // Validate required fields from schema
  assert.equal(typeof event.eventType, 'string');
  assert.equal(event.eventType, 'backup.scope.queried');
  assert.equal(typeof event.correlationId, 'string');
  assert.equal(typeof event.actor, 'object');
  assert.equal(typeof event.actor.id, 'string');
  assert.equal(typeof event.actor.role, 'string');
  assert.equal(typeof event.timestamp, 'string');

  // Optional fields
  assert.ok(event.tenantId === null || typeof event.tenantId === 'string');
  assert.ok(event.requestedProfile === null || typeof event.requestedProfile === 'string');
  assert.equal(event.requestedProfile, 'ha');

  // No extra properties (additionalProperties: false in schema)
  const allowedKeys = new Set(['eventType', 'correlationId', 'actor', 'tenantId', 'requestedProfile', 'timestamp']);
  for (const key of Object.keys(event)) {
    assert.ok(allowedKeys.has(key), `Unexpected property: ${key}`);
  }
});
