import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../src/actions/secret-consumer-ack.mjs';

test('secret-consumer-ack returns ack true and is idempotent', async () => {
  let inserted = 0;
  const repo = {
    async listPendingPropagations() { return inserted === 0 ? [{ consumer_id: 'apisix' }] : []; },
    async confirmPropagation() { return {}; },
    async getVersionByVaultVersion() { return { domain: 'platform', tenant_id: null }; },
    async insertRotationEvent() { inserted += 1; }
  };
  const first = await main({ db: {}, repo, consumerId: 'apisix', secretPath: 'platform/a', vaultVersion: 1, publishEvent: async () => {} });
  const second = await main({ db: {}, repo, consumerId: 'apisix', secretPath: 'platform/a', vaultVersion: 1, publishEvent: async () => {} });
  assert.deepEqual(first, { ack: true });
  assert.deepEqual(second, { ack: true });
  assert.equal(inserted, 1);
});
