import test from 'node:test';
import assert from 'node:assert/strict';
import { main as managementMain } from '../../packages/webhook-engine/actions/webhook-management.mjs';
import { TEST_WEBHOOK_KEY_CONTEXT } from '../helpers/webhook-key.mjs';

const db = {
  async getWorkspaceSubscriptionCount() { return 0; },
  async insertSubscriptionWithSecret() {},
  async listSubscriptions() { return []; }
};

const resolver = async () => ['93.184.216.34']; // deterministic offline resolver

test('create/list contract shapes and error envelope', async () => {
  const created = await managementMain({ db, kafka: { publish: async () => {} }, keyContext: TEST_WEBHOOK_KEY_CONTEXT, auth: { tenantId: 't1', workspaceId: 'w1', actorId: 'u1' }, resolver, method: 'POST', path: '/v1/webhooks/subscriptions', body: { targetUrl: 'https://example.com/hook', eventTypes: ['document.created'] } });
  assert.equal(created.statusCode, 201);
  assert.equal(typeof created.body.subscriptionId, 'string');
  assert.equal(Array.isArray(created.body.eventTypes), true);
  assert.equal(typeof created.body.signingSecret, 'string');

  const list = await managementMain({ db, kafka: { publish: async () => {} }, keyContext: TEST_WEBHOOK_KEY_CONTEXT, auth: { tenantId: 't1', workspaceId: 'w1', actorId: 'u1' }, resolver, method: 'GET', path: '/v1/webhooks/subscriptions' });
  assert.deepEqual(Object.keys(list.body), ['items', 'nextCursor']);

  const bad = await managementMain({ db, kafka: { publish: async () => {} }, keyContext: TEST_WEBHOOK_KEY_CONTEXT, auth: { tenantId: 't1', workspaceId: 'w1', actorId: 'u1' }, resolver, method: 'POST', path: '/v1/webhooks/subscriptions', body: { targetUrl: 'http://bad', eventTypes: ['document.created'] } });
  assert.deepEqual(Object.keys(bad.body), ['code', 'message']);
});
