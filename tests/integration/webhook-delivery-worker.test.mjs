import test from 'node:test';
import assert from 'node:assert/strict';
import { main as deliveryMain } from '../../services/webhook-engine/actions/webhook-delivery-worker.mjs';
import { main as retryMain } from '../../services/webhook-engine/actions/webhook-retry-scheduler.mjs';

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

import { encryptSecret } from '../../services/webhook-engine/src/webhook-signing.mjs';

function seededDb() {
  const db = makeDb();
  const encrypted = encryptSecret('signing-secret', 'master');
  db.state.secrets.set('s1', [{ status: 'active', secret_cipher: encrypted.cipher, secret_iv: encrypted.iv }]);
  return db;
}

test('delivery worker succeeds on 2xx and records attempts', async () => {
  const db = seededDb();
  const kafkaEvents = [];
  const scheduler = { main: retryMain, invoker: { invoke: async () => {} } };
  let seenHeaders;
  const http = async (url, options) => {
    seenHeaders = options.headers;
    return new Response('', { status: 200, headers: { 'x-ok': 'yes' } });
  };
  const result = await deliveryMain({ db, kafka: { publish: async (t, p) => kafkaEvents.push({ t, p }) }, scheduler, http, deliveryId: 'd1', env: { WEBHOOK_SIGNING_KEY: 'master', WEBHOOK_MAX_PAYLOAD_BYTES: '5000', WEBHOOK_RESPONSE_TIMEOUT_MS: '1000' } });
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
  const scheduler = { main: retryMain, invoker: { invoke: async (name, payload) => schedulerInvocations.push({ name, payload }) } };
  const kafkaEvents = [];
  const redirectHttp = async () => new Response('', { status: 302 });
  const first = await deliveryMain({ db, kafka: { publish: async (t, p) => kafkaEvents.push({ t, p }) }, scheduler, http: redirectHttp, deliveryId: 'd1', env: { WEBHOOK_SIGNING_KEY: 'master', WEBHOOK_AUTO_DISABLE_THRESHOLD: '1', WEBHOOK_RESPONSE_TIMEOUT_MS: '1000' } });
  assert.equal(first.status, 'scheduled');
  db.state.deliveries.set('d1', { ...db.state.deliveries.get('d1'), attempt_count: 1, status: 'pending' });
  const second = await deliveryMain({ db, kafka: { publish: async (t, p) => kafkaEvents.push({ t, p }) }, scheduler, http: async () => { throw new Error('timeout'); }, deliveryId: 'd1', env: { WEBHOOK_SIGNING_KEY: 'master', WEBHOOK_AUTO_DISABLE_THRESHOLD: '1', WEBHOOK_RESPONSE_TIMEOUT_MS: '1' } });
  assert.equal(['permanently_failed', 'auto_disabled'].includes(second.status), true);
  assert.ok(db.state.attempts.length >= 2);
  assert.ok(kafkaEvents.length >= 1);
});
