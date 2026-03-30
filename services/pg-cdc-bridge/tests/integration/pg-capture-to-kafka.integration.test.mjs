import test from 'node:test';
import assert from 'node:assert/strict';
import { KafkaChangePublisher } from '../../src/KafkaChangePublisher.mjs';

test('publishes change envelope to workspace topic', async () => {
  const sent = [];
  const kafka = { producerObj: { connect: async () => {}, send: async (payload) => { sent.push(payload); }, disconnect: async () => {} } };
  const publisher = new KafkaChangePublisher({ kafka });
  await publisher.initialize();
  await publisher.publish({ id: 'c1', tenant_id: 't1', workspace_id: 'w1', data_source_ref: 'db1' }, { type: 'insert', relation: { namespace: 'public', relationName: 'orders' }, newRow: { id: '1' } }, '0/1', new Date().toISOString());
  assert.equal(sent[0].topic, 't1.w1.pg-changes');
});
