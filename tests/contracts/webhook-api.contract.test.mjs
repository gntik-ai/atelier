import test from 'node:test';
import assert from 'node:assert/strict';
import { main as managementMain } from '../../services/webhook-engine/actions/webhook-management.mjs';

const db = {
  async getWorkspaceSubscriptionCount() { return 0; },
  async insertSubscription() {},
  async insertSecret() {},
  async listSubscriptions() { return []; }
};

test('create/list contract shapes and error envelope', async () => {
  const created = await managementMain({ db, kafka: { publish: async () => {} }, env: { WEBHOOK_SIGNING_KEY: 'master' }, auth: { tenantId: 't1', workspaceId: 'w1', actorId: 'u1' }, method: 'POST', path: '/v1/webhooks/subscriptions', body: { targetUrl: 'https://example.com/hook', eventTypes: ['document.created'] } });
  assert.equal(created.statusCode, 201);
  assert.equal(typeof created.body.subscriptionId, 'string');
  assert.equal(Array.isArray(created.body.eventTypes), true);
  assert.equal(typeof created.body.signingSecret, 'string');

  const list = await managementMain({ db, kafka: { publish: async () => {} }, env: { WEBHOOK_SIGNING_KEY: 'master' }, auth: { tenantId: 't1', workspaceId: 'w1', actorId: 'u1' }, method: 'GET', path: '/v1/webhooks/subscriptions' });
  assert.deepEqual(Object.keys(list.body), ['items', 'nextCursor']);

  const bad = await managementMain({ db, kafka: { publish: async () => {} }, env: { WEBHOOK_SIGNING_KEY: 'master' }, auth: { tenantId: 't1', workspaceId: 'w1', actorId: 'u1' }, method: 'POST', path: '/v1/webhooks/subscriptions', body: { targetUrl: 'http://bad', eventTypes: ['document.created'] } });
  assert.deepEqual(Object.keys(bad.body), ['code', 'message']);
});
