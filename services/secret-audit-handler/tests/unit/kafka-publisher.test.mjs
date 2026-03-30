import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublisher } from '../../src/kafka-publisher.mjs';

function createMockProducer() {
  return {
    sent: [],
    connected: false,
    disconnected: false,
    async connect() { this.connected = true; },
    async send(payload) { this.sent.push(payload); },
    async disconnect() { this.disconnected = true; }
  };
}

test('publishAuditEvent sends to expected topic with domain key', async () => {
  const producer = createMockProducer();
  const publisher = createPublisher({ brokers: ['kafka:9092'], topic: 'console.secrets.audit', producer });
  await publisher.connect();
  await publisher.publishAuditEvent({
    eventId: '123e4567-e89b-12d3-a456-426614174000',
    timestamp: '2026-03-30T00:00:00.000Z',
    operation: 'read',
    domain: 'platform',
    secretPath: 'platform/postgresql/app-password',
    secretName: 'app-password',
    requestorIdentity: { type: 'service', name: 'svc', namespace: 'ns', serviceAccount: 'sa' },
    result: 'success',
    denialReason: null,
    vaultRequestId: 'req-1'
  });
  assert.equal(producer.sent[0].topic, 'console.secrets.audit');
  assert.equal(producer.sent[0].messages[0].key, 'platform');
  await publisher.disconnect();
  assert.equal(producer.disconnected, true);
});

test('publishAuditEvent rejects forbidden fields', async () => {
  const producer = createMockProducer();
  const publisher = createPublisher({ brokers: ['kafka:9092'], topic: 'console.secrets.audit', producer });
  await assert.rejects(() => publisher.publishAuditEvent({
    eventId: '123e4567-e89b-12d3-a456-426614174000',
    timestamp: '2026-03-30T00:00:00.000Z',
    operation: 'read',
    domain: 'platform',
    secretPath: 'platform/postgresql/app-password',
    secretName: 'app-password',
    requestorIdentity: { type: 'service', name: 'svc', namespace: 'ns', serviceAccount: 'sa' },
    result: 'success',
    denialReason: null,
    vaultRequestId: 'req-1',
    value: 'secret'
  }));
});
