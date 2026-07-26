import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { main as managementMain, revealSecretRecords } from '../../packages/webhook-engine/actions/webhook-management.mjs';
import { verifyIncomingWebhook } from '../../packages/webhook-engine/src/webhook-signing.mjs';
import { TEST_WEBHOOK_KEY_CONTEXT } from '../helpers/webhook-key.mjs';

function makeDb() {
  const state = { subscriptions: new Map(), secrets: new Map(), deliveries: new Map(), attempts: new Map(), events: new Map() };
  return {
    state,
    async getWorkspaceSubscriptionCount(tenantId, workspaceId) { return [...state.subscriptions.values()].filter((row) => row.tenant_id === tenantId && row.workspace_id === workspaceId && !row.deleted_at).length; },
    async insertSubscriptionWithSecret(row, encrypted, encryptionKeyId) {
      state.subscriptions.set(row.id, row);
      state.secrets.set(row.id, [{
        subscription_id: row.id,
        secret_cipher: encrypted.cipher,
        secret_iv: encrypted.iv,
        encryption_key_id: encryptionKeyId,
        status: 'active',
      }]);
    },
    async getSubscription(id) { return state.subscriptions.get(id); },
    async listSubscriptions(ctx, query) { return [...state.subscriptions.values()].filter((row) => row.tenant_id === ctx.tenantId && row.workspace_id === ctx.workspaceId && !row.deleted_at && (!query.status || row.status === query.status)); },
    async updateSubscription(id, patch) { const row = { ...state.subscriptions.get(id), ...patch, updated_at: new Date().toISOString() }; state.subscriptions.set(id, row); return row; },
    async replaceSubscription(row) { state.subscriptions.set(row.id, row); return row; },
    async cancelPendingDeliveries(subscriptionId) { for (const [id, row] of state.deliveries) if (row.subscription_id === subscriptionId && row.status === 'pending') state.deliveries.set(id, { ...row, status: 'cancelled' }); },
    async rotateSecret(subscriptionId, encrypted, graceExpiresAt, tenantId, workspaceId, encryptionKeyId) { const rows = state.secrets.get(subscriptionId) ?? []; for (const row of rows) if (row.status === 'active') { row.status = 'grace'; row.grace_expires_at = graceExpiresAt; } rows.push({ subscription_id: subscriptionId, secret_cipher: encrypted.cipher, secret_iv: encrypted.iv, encryption_key_id: encryptionKeyId, status: 'active' }); state.secrets.set(subscriptionId, rows); },
    async listSecrets(subscriptionId) { return state.secrets.get(subscriptionId) ?? []; },
    async listDeliveries(subscriptionId) { return [...state.deliveries.values()].filter((row) => row.subscription_id === subscriptionId); },
    async getDelivery(subscriptionId, deliveryId) { const row = state.deliveries.get(deliveryId); if (!row || row.subscription_id !== subscriptionId) return null; return { deliveryId: row.id, status: row.status, attemptCount: row.attempt_count, attempts: [...state.attempts.values()].filter((a) => a.delivery_id === row.id).sort((a,b)=>a.attempt_num-b.attempt_num) }; }
  };
}

const auth = { tenantId: 't1', workspaceId: 'w1', actorId: 'u1' };
const resolver = async () => ['93.184.216.34']; // deterministic offline resolver

test('management lifecycle create-read-update-pause-resume-rotate-delete and deliveries history', async () => {
  const db = makeDb();
  const published = [];
  const kafka = { publish: async (topic, payload) => published.push({ topic, payload }) };
  const env = { WEBHOOK_MAX_SUBSCRIPTIONS_PER_WORKSPACE: '5', WEBHOOK_SECRET_GRACE_PERIOD_SECONDS: '3600' };
  const keyContext = TEST_WEBHOOK_KEY_CONTEXT;

  const created = await managementMain({ db, kafka, keyContext, env, auth, resolver, method: 'POST', path: '/v1/webhooks/subscriptions', body: { targetUrl: 'https://example.com/hook', eventTypes: ['document.created'] } });
  assert.equal(created.statusCode, 201);
  assert.ok(created.body.signingSecret);
  const subscriptionId = created.body.subscriptionId;

  const detail = await managementMain({ db, kafka, keyContext, env, auth, method: 'GET', path: `/v1/webhooks/subscriptions/${subscriptionId}` });
  assert.equal('signingSecret' in detail.body, false);

  const updated = await managementMain({ db, kafka, keyContext, env, auth, resolver, method: 'PATCH', path: `/v1/webhooks/subscriptions/${subscriptionId}`, body: { targetUrl: 'https://example.com/new', eventTypes: ['document.updated'] } });
  assert.equal(updated.body.targetUrl, 'https://example.com/new');

  const paused = await managementMain({ db, kafka, keyContext, env, auth, method: 'POST', path: `/v1/webhooks/subscriptions/${subscriptionId}/pause` });
  assert.equal(paused.body.status, 'paused');
  const resumed = await managementMain({ db, kafka, keyContext, env, auth, method: 'POST', path: `/v1/webhooks/subscriptions/${subscriptionId}/resume` });
  assert.equal(resumed.body.status, 'active');

  const rotated = await managementMain({ db, kafka, keyContext, env, auth, method: 'POST', path: `/v1/webhooks/subscriptions/${subscriptionId}/rotate-secret`, body: { gracePeriodSeconds: 1 } });
  assert.ok(rotated.body.newSigningSecret);
  const secrets = revealSecretRecords(await db.listSecrets(subscriptionId), keyContext);
  assert.equal(secrets.length, 2);
  const payload = '{}';
  const oldSecret = created.body.signingSecret;
  const newSecret = rotated.body.newSigningSecret;
  assert.equal(verifyIncomingWebhook(payload, `sha256=${crypto.createHmac('sha256', oldSecret).update(payload).digest('hex')}`, oldSecret), true);
  assert.notEqual(oldSecret, newSecret);

  // webhook_deliveries.id is a UUID column (migration 001); use a real UUID so the
  // fixture is faithful to the schema and reaches the by-id read path (a non-UUID
  // delivery id is now correctly rejected as 404 — see #672).
  const deliveryId = crypto.randomUUID();
  db.state.deliveries.set(deliveryId, { id: deliveryId, subscription_id: subscriptionId, status: 'permanently_failed', attempt_count: 2 });
  db.state.attempts.set('a1', { delivery_id: deliveryId, attempt_num: 1, http_status: 503, response_ms: 10, outcome: 'failed' });
  db.state.attempts.set('a2', { delivery_id: deliveryId, attempt_num: 2, http_status: 503, response_ms: 11, outcome: 'failed' });
  const deliveries = await managementMain({ db, kafka, keyContext, env, auth, method: 'GET', path: `/v1/webhooks/subscriptions/${subscriptionId}/deliveries` });
  assert.equal(deliveries.body.items.length, 1);
  const delivery = await managementMain({ db, kafka, keyContext, env, auth, method: 'GET', path: `/v1/webhooks/subscriptions/${subscriptionId}/deliveries/${deliveryId}` });
  assert.equal(delivery.body.attempts.length, 2);

  const deleted = await managementMain({ db, kafka, keyContext, env, auth, method: 'DELETE', path: `/v1/webhooks/subscriptions/${subscriptionId}` });
  assert.equal(deleted.statusCode, 204);
  assert.ok(published.length >= 5);
});

test('management validation and isolation errors', async () => {
  const db = makeDb();
  const kafka = { publish: async () => {} };
  const env = { WEBHOOK_MAX_SUBSCRIPTIONS_PER_WORKSPACE: '1' };
  const keyContext = TEST_WEBHOOK_KEY_CONTEXT;
  const bad = await managementMain({ db, kafka, keyContext, env, auth, resolver, method: 'POST', path: '/v1/webhooks/subscriptions', body: { targetUrl: 'http://nope', eventTypes: ['document.created'] } });
  assert.equal(bad.statusCode, 400);
  const ok = await managementMain({ db, kafka, keyContext, env, auth, resolver, method: 'POST', path: '/v1/webhooks/subscriptions', body: { targetUrl: 'https://example.com/hook', eventTypes: ['document.created'] } });
  assert.equal(ok.statusCode, 201);
  const quota = await managementMain({ db, kafka, keyContext, env, auth, resolver, method: 'POST', path: '/v1/webhooks/subscriptions', body: { targetUrl: 'https://example.com/other', eventTypes: ['document.created'] } });
  assert.equal(quota.statusCode, 409);
  const wrongWorkspace = await managementMain({ db, kafka, keyContext, env, auth: { ...auth, workspaceId: 'other' }, method: 'GET', path: `/v1/webhooks/subscriptions/${ok.body.subscriptionId}` });
  assert.equal(wrongWorkspace.statusCode, 404);
});

test('create failure is bounded, atomic, and does not consume quota before retry', async () => {
  const db = makeDb();
  let rejectFence = true;
  const atomicInsert = db.insertSubscriptionWithSecret.bind(db);
  db.insertSubscriptionWithSecret = async (...args) => {
    if (rejectFence) {
      rejectFence = false;
      throw Object.assign(new Error('internal trigger detail must not escape'), {
        code: 'WEBHOOK_KEY_UNAVAILABLE',
      });
    }
    return atomicInsert(...args);
  };
  const env = { WEBHOOK_MAX_SUBSCRIPTIONS_PER_WORKSPACE: '1' };
  const params = {
    db,
    kafka: { publish: async () => {} },
    keyContext: TEST_WEBHOOK_KEY_CONTEXT,
    env,
    auth,
    resolver,
    method: 'POST',
    path: '/v1/webhooks/subscriptions',
    body: { targetUrl: 'https://example.com/hook', eventTypes: ['document.created'] },
  };

  const rejected = await managementMain(params);
  assert.deepEqual(rejected, {
    statusCode: 503,
    body: {
      code: 'WEBHOOK_KEY_UNAVAILABLE',
      message: 'Webhook key lifecycle is not ready',
    },
  });
  assert.equal(db.state.subscriptions.size, 0);
  assert.equal(db.state.secrets.size, 0);
  assert.doesNotMatch(JSON.stringify(rejected), /trigger detail|55000|cipher|keyBytes/);

  const retried = await managementMain(params);
  assert.equal(retried.statusCode, 201);
  assert.equal(db.state.subscriptions.size, 1);
  assert.equal(db.state.secrets.size, 1);
});

test('create action collapses raw PostgreSQL codes and trigger messages', async () => {
  const params = {
    kafka: { publish: async () => assert.fail('failed create must not publish') },
    keyContext: TEST_WEBHOOK_KEY_CONTEXT,
    env: { WEBHOOK_MAX_SUBSCRIPTIONS_PER_WORKSPACE: '1' },
    auth,
    resolver,
    method: 'POST',
    path: '/v1/webhooks/subscriptions',
    body: { targetUrl: 'https://example.com/hook', eventTypes: ['document.created'] },
  };
  const rawDatabase = await managementMain({
    ...params,
    db: {
      async getWorkspaceSubscriptionCount() { return 0; },
      async insertSubscriptionWithSecret() {
        throw Object.assign(new Error('raw constraint detail'), { code: '23514' });
      },
    },
  });
  assert.deepEqual(rawDatabase, {
    statusCode: 500,
    body: {
      code: 'WEBHOOK_CREATE_FAILED',
      message: 'Webhook subscription could not be created',
    },
  });
  const rawTrigger = await managementMain({
    ...params,
    db: {
      async getWorkspaceSubscriptionCount() { return 0; },
      async insertSubscriptionWithSecret() {
        throw Object.assign(new Error('WEBHOOK_KEY_WRITE_FENCED'), { code: 'XX000' });
      },
    },
  });
  assert.deepEqual(rawTrigger, {
    statusCode: 503,
    body: {
      code: 'WEBHOOK_KEY_UNAVAILABLE',
      message: 'Webhook key lifecycle is not ready',
    },
  });
  assert.doesNotMatch(JSON.stringify({ rawDatabase, rawTrigger }), /23514|XX000|WRITE_FENCED|constraint/);
});

test('per-subscription rotation maps a stale lifecycle fence to a bounded retryable response', async () => {
  const db = makeDb();
  const published = [];
  const kafka = {
    publish: async (topic, payload) => published.push({ topic, payload }),
  };
  const create = await managementMain({
    db,
    kafka,
    keyContext: TEST_WEBHOOK_KEY_CONTEXT,
    env: {},
    auth,
    resolver,
    method: 'POST',
    path: '/v1/webhooks/subscriptions',
    body: {
      targetUrl: 'https://example.com/hook',
      eventTypes: ['document.created'],
    },
  });
  assert.equal(create.statusCode, 201);
  const subscriptionId = create.body.subscriptionId;
  const before = structuredClone(db.state.secrets.get(subscriptionId));
  const eventsBeforeRotation = published.length;
  const rotate = db.rotateSecret.bind(db);
  let stale = true;
  db.rotateSecret = async (...args) => {
    if (stale) {
      stale = false;
      throw Object.assign(
        new Error('WEBHOOK_KEY_WRITE_FENCED raw table/key detail'),
        { code: '55000' },
      );
    }
    return rotate(...args);
  };
  const params = {
    db,
    kafka,
    keyContext: TEST_WEBHOOK_KEY_CONTEXT,
    env: {},
    auth,
    method: 'POST',
    path: `/v1/webhooks/subscriptions/${subscriptionId}/rotate-secret`,
    body: { gracePeriodSeconds: 60 },
  };

  const rejected = await managementMain(params);
  assert.deepEqual(rejected, {
    statusCode: 503,
    body: {
      code: 'WEBHOOK_KEY_UNAVAILABLE',
      message: 'Webhook key lifecycle is not ready',
    },
  });
  assert.deepEqual(db.state.secrets.get(subscriptionId), before);
  assert.equal(published.length, eventsBeforeRotation);
  assert.doesNotMatch(
    JSON.stringify(rejected),
    /55000|WRITE_FENCED|table|key detail|cipher|secret_iv|dsn/i,
  );

  const retried = await managementMain(params);
  assert.equal(retried.statusCode, 200);
  assert.equal(typeof retried.body.newSigningSecret, 'string');
  assert.equal(db.state.secrets.get(subscriptionId).length, 2);
  assert.equal(published.length, eventsBeforeRotation + 1);
  assert.equal(published.at(-1).topic, 'console.webhook.secret.rotated');
});

test('per-subscription rotation collapses unexpected storage detail', async () => {
  const db = makeDb();
  const create = await managementMain({
    db,
    kafka: { publish: async () => {} },
    keyContext: TEST_WEBHOOK_KEY_CONTEXT,
    env: {},
    auth,
    resolver,
    method: 'POST',
    path: '/v1/webhooks/subscriptions',
    body: {
      targetUrl: 'https://example.com/hook',
      eventTypes: ['document.created'],
    },
  });
  const before = structuredClone(db.state.secrets.get(create.body.subscriptionId));
  db.rotateSecret = async () => {
    throw Object.assign(new Error('constraint ciphertext key_id'), { code: '23514' });
  };
  const response = await managementMain({
    db,
    kafka: { publish: async () => assert.fail('failed rotation must not publish') },
    keyContext: TEST_WEBHOOK_KEY_CONTEXT,
    env: {},
    auth,
    method: 'POST',
    path: `/v1/webhooks/subscriptions/${create.body.subscriptionId}/rotate-secret`,
    body: {},
  });
  assert.deepEqual(response, {
    statusCode: 500,
    body: {
      code: 'WEBHOOK_ROTATE_FAILED',
      message: 'Webhook signing secret could not be rotated',
    },
  });
  assert.deepEqual(db.state.secrets.get(create.body.subscriptionId), before);
  assert.doesNotMatch(JSON.stringify(response), /23514|constraint|cipher|key_id/);
});
