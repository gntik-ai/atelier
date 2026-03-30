import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { main as managementMain, revealSecretRecords } from '../../services/webhook-engine/actions/webhook-management.mjs';
import { verifyIncomingWebhook } from '../../services/webhook-engine/src/webhook-signing.mjs';

function makeDb() {
  const state = { subscriptions: new Map(), secrets: new Map(), deliveries: new Map(), attempts: new Map(), events: new Map() };
  return {
    state,
    async getWorkspaceSubscriptionCount(tenantId, workspaceId) { return [...state.subscriptions.values()].filter((row) => row.tenant_id === tenantId && row.workspace_id === workspaceId && !row.deleted_at).length; },
    async insertSubscription(row) { state.subscriptions.set(row.id, row); },
    async insertSecret(subscriptionId, encrypted) { state.secrets.set(subscriptionId, [{ subscription_id: subscriptionId, secret_cipher: encrypted.cipher, secret_iv: encrypted.iv, status: 'active' }]); },
    async getSubscription(id) { return state.subscriptions.get(id); },
    async listSubscriptions(ctx, query) { return [...state.subscriptions.values()].filter((row) => row.tenant_id === ctx.tenantId && row.workspace_id === ctx.workspaceId && !row.deleted_at && (!query.status || row.status === query.status)); },
    async updateSubscription(id, patch) { const row = { ...state.subscriptions.get(id), ...patch, updated_at: new Date().toISOString() }; state.subscriptions.set(id, row); return row; },
    async replaceSubscription(row) { state.subscriptions.set(row.id, row); return row; },
    async cancelPendingDeliveries(subscriptionId) { for (const [id, row] of state.deliveries) if (row.subscription_id === subscriptionId && row.status === 'pending') state.deliveries.set(id, { ...row, status: 'cancelled' }); },
    async rotateSecret(subscriptionId, encrypted, graceExpiresAt) { const rows = state.secrets.get(subscriptionId) ?? []; for (const row of rows) if (row.status === 'active') { row.status = 'grace'; row.grace_expires_at = graceExpiresAt; } rows.push({ subscription_id: subscriptionId, secret_cipher: encrypted.cipher, secret_iv: encrypted.iv, status: 'active' }); state.secrets.set(subscriptionId, rows); },
    async listSecrets(subscriptionId) { return state.secrets.get(subscriptionId) ?? []; },
    async listDeliveries(subscriptionId) { return [...state.deliveries.values()].filter((row) => row.subscription_id === subscriptionId); },
    async getDelivery(subscriptionId, deliveryId) { const row = state.deliveries.get(deliveryId); if (!row || row.subscription_id !== subscriptionId) return null; return { deliveryId: row.id, status: row.status, attemptCount: row.attempt_count, attempts: [...state.attempts.values()].filter((a) => a.delivery_id === row.id).sort((a,b)=>a.attempt_num-b.attempt_num) }; }
  };
}

const auth = { tenantId: 't1', workspaceId: 'w1', actorId: 'u1' };

test('management lifecycle create-read-update-pause-resume-rotate-delete and deliveries history', async () => {
  const db = makeDb();
  const published = [];
  const kafka = { publish: async (topic, payload) => published.push({ topic, payload }) };
  const env = { WEBHOOK_SIGNING_KEY: 'master', WEBHOOK_MAX_SUBSCRIPTIONS_PER_WORKSPACE: '5', WEBHOOK_SECRET_GRACE_PERIOD_SECONDS: '3600' };

  const created = await managementMain({ db, kafka, env, auth, method: 'POST', path: '/v1/webhooks/subscriptions', body: { targetUrl: 'https://example.com/hook', eventTypes: ['document.created'] } });
  assert.equal(created.statusCode, 201);
  assert.ok(created.body.signingSecret);
  const subscriptionId = created.body.subscriptionId;

  const detail = await managementMain({ db, kafka, env, auth, method: 'GET', path: `/v1/webhooks/subscriptions/${subscriptionId}` });
  assert.equal('signingSecret' in detail.body, false);

  const updated = await managementMain({ db, kafka, env, auth, method: 'PATCH', path: `/v1/webhooks/subscriptions/${subscriptionId}`, body: { targetUrl: 'https://example.com/new', eventTypes: ['document.updated'] } });
  assert.equal(updated.body.targetUrl, 'https://example.com/new');

  const paused = await managementMain({ db, kafka, env, auth, method: 'POST', path: `/v1/webhooks/subscriptions/${subscriptionId}/pause` });
  assert.equal(paused.body.status, 'paused');
  const resumed = await managementMain({ db, kafka, env, auth, method: 'POST', path: `/v1/webhooks/subscriptions/${subscriptionId}/resume` });
  assert.equal(resumed.body.status, 'active');

  const rotated = await managementMain({ db, kafka, env, auth, method: 'POST', path: `/v1/webhooks/subscriptions/${subscriptionId}/rotate-secret`, body: { gracePeriodSeconds: 1 } });
  assert.ok(rotated.body.newSigningSecret);
  const secrets = revealSecretRecords(await db.listSecrets(subscriptionId), env);
  assert.equal(secrets.length, 2);
  const payload = '{}';
  const oldSecret = created.body.signingSecret;
  const newSecret = rotated.body.newSigningSecret;
  assert.equal(verifyIncomingWebhook(payload, `sha256=${crypto.createHmac('sha256', oldSecret).update(payload).digest('hex')}`, oldSecret), true);
  assert.notEqual(oldSecret, newSecret);

  db.state.deliveries.set('d1', { id: 'd1', subscription_id: subscriptionId, status: 'permanently_failed', attempt_count: 2 });
  db.state.attempts.set('a1', { delivery_id: 'd1', attempt_num: 1, http_status: 503, response_ms: 10, outcome: 'failed' });
  db.state.attempts.set('a2', { delivery_id: 'd1', attempt_num: 2, http_status: 503, response_ms: 11, outcome: 'failed' });
  const deliveries = await managementMain({ db, kafka, env, auth, method: 'GET', path: `/v1/webhooks/subscriptions/${subscriptionId}/deliveries` });
  assert.equal(deliveries.body.items.length, 1);
  const delivery = await managementMain({ db, kafka, env, auth, method: 'GET', path: `/v1/webhooks/subscriptions/${subscriptionId}/deliveries/d1` });
  assert.equal(delivery.body.attempts.length, 2);

  const deleted = await managementMain({ db, kafka, env, auth, method: 'DELETE', path: `/v1/webhooks/subscriptions/${subscriptionId}` });
  assert.equal(deleted.statusCode, 204);
  assert.ok(published.length >= 5);
});

test('management validation and isolation errors', async () => {
  const db = makeDb();
  const kafka = { publish: async () => {} };
  const env = { WEBHOOK_SIGNING_KEY: 'master', WEBHOOK_MAX_SUBSCRIPTIONS_PER_WORKSPACE: '1' };
  const bad = await managementMain({ db, kafka, env, auth, method: 'POST', path: '/v1/webhooks/subscriptions', body: { targetUrl: 'http://nope', eventTypes: ['document.created'] } });
  assert.equal(bad.statusCode, 400);
  const ok = await managementMain({ db, kafka, env, auth, method: 'POST', path: '/v1/webhooks/subscriptions', body: { targetUrl: 'https://example.com/hook', eventTypes: ['document.created'] } });
  assert.equal(ok.statusCode, 201);
  const quota = await managementMain({ db, kafka, env, auth, method: 'POST', path: '/v1/webhooks/subscriptions', body: { targetUrl: 'https://example.com/other', eventTypes: ['document.created'] } });
  assert.equal(quota.statusCode, 409);
  const wrongWorkspace = await managementMain({ db, kafka, env, auth: { ...auth, workspaceId: 'other' }, method: 'GET', path: `/v1/webhooks/subscriptions/${ok.body.subscriptionId}` });
  assert.equal(wrongWorkspace.statusCode, 404);
});
