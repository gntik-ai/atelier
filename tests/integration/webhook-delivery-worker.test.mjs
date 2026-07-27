import test from 'node:test';
import assert from 'node:assert/strict';
import { main as deliveryMain } from '../../packages/webhook-engine/actions/webhook-delivery-worker.mjs';
import { main as retryMain } from '../../packages/webhook-engine/actions/webhook-retry-scheduler.mjs';
import { createWebhookRuntimeAdapter } from '../../apps/control-plane/webhook-runtime.mjs';
import {
  createCanonicalWebhookKeyContext,
  createRuntimeWebhookKeyContext,
  deriveWebhookKeyId,
  formatCanonicalWebhookKey,
} from '../../packages/webhook-engine/src/webhook-master-key.mjs';
import { computeSignature } from '../../packages/webhook-engine/src/webhook-signing.mjs';
import { TEST_WEBHOOK_KEY_CONTEXT } from '../helpers/webhook-key.mjs';

function makeDb() {
  const state = {
    subscriptions: new Map([['s1', { id: 's1', tenant_id: 't1', workspace_id: 'w1', target_url: 'https://example.com/hook', status: 'active', consecutive_failures: 0 }]]),
    deliveries: new Map([['d1', { id: 'd1', subscription_id: 's1', tenant_id: 't1', workspace_id: 'w1', event_type: 'document.created', event_id: 'e1', attempt_count: 0, max_attempts: 2, status: 'pending' }]]),
    attempts: [],
    secrets: new Map([['s1', [{ status: 'active', secret_cipher: '5vAkzPLhHf5l6NI7afqXNy2wK4fA', secret_iv: 'c29tZWl2' }]]]),
    events: new Map([['e1', { eventId: 'e1', data: { ok: true } }]])
  };
  return {
    state,
    async getDeliveryById(id) { return state.deliveries.get(id); },
    async getSubscription(id) { return state.subscriptions.get(id); },
    async listSecrets(subscriptionId) { return state.secrets.get(subscriptionId) ?? []; },
    async getEvent(id) { return state.events.get(id); },
    async insertAttempt(row) { state.attempts.push(row); },
    async updateDelivery(id, patch) { const row = { ...state.deliveries.get(id), ...patch }; state.deliveries.set(id, row); return row; },
    async incrementSubscriptionFailures(id) { const row = { ...state.subscriptions.get(id), consecutive_failures: state.subscriptions.get(id).consecutive_failures + 1 }; state.subscriptions.set(id, row); return row; },
    async updateSubscription(id, patch) { const row = { ...state.subscriptions.get(id), ...patch }; state.subscriptions.set(id, row); return row; }
  };
}

import { encryptSecret } from '../../packages/webhook-engine/src/webhook-signing.mjs';

function seededDb() {
  const db = makeDb();
  const encrypted = encryptSecret('signing-secret', TEST_WEBHOOK_KEY_CONTEXT);
  db.state.secrets.set('s1', [{ status: 'active', secret_cipher: encrypted.cipher, secret_iv: encrypted.iv, encryption_key_id: TEST_WEBHOOK_KEY_CONTEXT.keyId }]);
  return db;
}

const resolver = async () => ['93.184.216.34']; // deterministic offline resolver (example.com → public IP)

test('delivery worker succeeds on 2xx and records attempts', async () => {
  const db = seededDb();
  const kafkaEvents = [];
  const scheduler = { main: retryMain, invoker: { invokeWebhookDelivery: async () => {} } };
  let seenHeaders;
  const http = async (url, options) => {
    seenHeaders = options.headers;
    return new Response('', { status: 200, headers: { 'x-ok': 'yes' } });
  };
  const result = await deliveryMain({ db, kafka: { publish: async (t, p) => kafkaEvents.push({ t, p }) }, keyContext: TEST_WEBHOOK_KEY_CONTEXT, scheduler, http, resolver, deliveryId: 'd1', env: { WEBHOOK_MAX_PAYLOAD_BYTES: '5000', WEBHOOK_RESPONSE_TIMEOUT_MS: '1000' } });
  assert.equal(result.status, 'succeeded');
  assert.equal(db.state.deliveries.get('d1').status, 'succeeded');
  assert.equal(db.state.attempts.length, 1);
  assert.equal(seenHeaders['x-platform-webhook-event'], 'document.created');
  assert.match(seenHeaders['x-platform-webhook-signature'], /^sha256=/);
  assert.equal(kafkaEvents.length, 1);
});

test('3xx and thrown errors schedule retry/permanent failure/auto-disable', async () => {
  const db = seededDb();
  const schedulerInvocations = [];
  const scheduler = { main: retryMain, invoker: { invokeWebhookDelivery: async (payload) => schedulerInvocations.push(payload) } };
  const kafkaEvents = [];
  const redirectHttp = async () => new Response('', { status: 302 });
  const first = await deliveryMain({ db, kafka: { publish: async (t, p) => kafkaEvents.push({ t, p }) }, keyContext: TEST_WEBHOOK_KEY_CONTEXT, scheduler, http: redirectHttp, resolver, deliveryId: 'd1', env: { WEBHOOK_AUTO_DISABLE_THRESHOLD: '1', WEBHOOK_RESPONSE_TIMEOUT_MS: '1000' } });
  assert.equal(first.status, 'scheduled');
  db.state.deliveries.set('d1', { ...db.state.deliveries.get('d1'), attempt_count: 1, status: 'pending' });
  const second = await deliveryMain({ db, kafka: { publish: async (t, p) => kafkaEvents.push({ t, p }) }, keyContext: TEST_WEBHOOK_KEY_CONTEXT, scheduler, http: async () => { throw new Error('timeout'); }, resolver, deliveryId: 'd1', env: { WEBHOOK_AUTO_DISABLE_THRESHOLD: '1', WEBHOOK_RESPONSE_TIMEOUT_MS: '1' } });
  assert.equal(['permanently_failed', 'auto_disabled'].includes(second.status), true);
  assert.ok(db.state.attempts.length >= 2);
  assert.ok(kafkaEvents.length >= 1);
});

test('runtime adapter injects the verified context for initial delivery without serializing it', async () => {
  const db = seededDb();
  let request;
  const adapter = createWebhookRuntimeAdapter({
    keyContext: TEST_WEBHOOK_KEY_CONTEXT,
    db,
    http: async (_url, options) => {
      request = options;
      return new Response('', { status: 200 });
    },
    resolver,
    env: { WEBHOOK_MAX_PAYLOAD_BYTES: '5000', WEBHOOK_RESPONSE_TIMEOUT_MS: '1000' },
  });
  const message = Object.freeze({ deliveryId: 'd1' });
  const result = await adapter.invokeWebhookDelivery(message);
  assert.equal(result.status, 'succeeded');
  assert.deepEqual(message, { deliveryId: 'd1' });
  assert.equal(Object.keys(message).includes('keyContext'), false);
  assert.equal(request.headers['x-platform-webhook-signature'], computeSignature(request.body, 'signing-secret'));
});

test('runtime adapter re-resolves its verified context on retry and never puts it in retry metadata', async () => {
  const db = seededDb();
  const requests = [];
  const adapter = createWebhookRuntimeAdapter({
    keyContext: TEST_WEBHOOK_KEY_CONTEXT,
    db,
    http: async (_url, options) => {
      requests.push(options);
      return new Response('', { status: requests.length === 1 ? 503 : 200 });
    },
    resolver,
    env: {
      WEBHOOK_MAX_PAYLOAD_BYTES: '5000',
      WEBHOOK_RESPONSE_TIMEOUT_MS: '1000',
      WEBHOOK_MAX_RETRY_ATTEMPTS: '2',
      WEBHOOK_RETRY_BASE_DELAY_MS: '1',
    },
  });
  const result = await adapter.invokeWebhookDelivery({ deliveryId: 'd1' });
  assert.equal(result.status, 'scheduled');
  assert.equal(requests.length, 2);
  assert.equal(db.state.deliveries.get('d1').status, 'succeeded');
  assert.ok(requests.every((request) => (
    request.headers['x-platform-webhook-signature'] === computeSignature(request.body, 'signing-secret')
  )));
});

test('runtime adapter rejects absent, unverified, wrong-identity, and serialized contexts', async () => {
  const db = seededDb();
  assert.throws(
    () => createWebhookRuntimeAdapter({ keyContext: null, db }),
    { code: 'WEBHOOK_KEY_CONTEXT_INVALID' },
  );
  assert.throws(
    () => createWebhookRuntimeAdapter({
      keyContext: createCanonicalWebhookKeyContext(
        formatCanonicalWebhookKey(Buffer.alloc(32, 0x6b)),
        deriveWebhookKeyId('test-namespace', 'unverified-webhook-key', 'key'),
      ),
      db,
    }),
    { code: 'WEBHOOK_KEY_CONTEXT_NOT_VERIFIED' },
  );

  const wrongId = deriveWebhookKeyId('test-namespace', 'wrong-webhook-key', 'key');
  const wrongMaterial = formatCanonicalWebhookKey(Buffer.alloc(32, 0x6b));
  const wrongContext = createRuntimeWebhookKeyContext({
    material: wrongMaterial,
    keyId: wrongId,
    mode: 'canonical-v1',
    lifecycleState: {
      lifecycle_state: 'serving',
      current_key_id: wrongId,
      current_mode: 'canonical-v1',
    },
  });
  const wrongAdapter = createWebhookRuntimeAdapter({
    keyContext: wrongContext,
    db,
    http: async () => new Response('', { status: 200 }),
    resolver,
  });
  await assert.rejects(
    wrongAdapter.invokeWebhookDelivery({ deliveryId: 'd1' }),
    { code: 'WEBHOOK_ROW_KEY_MISMATCH' },
  );
  await assert.rejects(
    wrongAdapter.invokeWebhookDelivery({ deliveryId: 'd1', keyContext: TEST_WEBHOOK_KEY_CONTEXT }),
    { code: 'WEBHOOK_DELIVERY_MESSAGE_INVALID' },
  );
});
