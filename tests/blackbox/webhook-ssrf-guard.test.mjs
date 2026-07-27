// bbx-webhook-ssrf-guard
//
// Black-box reproduction for GitHub issue #216 / change harden-webhook-ssrf-guard.
// Drives the public `main` of webhook-management and webhook-delivery-worker actions only.
//
// Scenarios:
//   bbx-webhook-ssrf-01: IPv4 link-local 169.254.169.254 → INVALID_URL, not created
//   bbx-webhook-ssrf-02: Decimal-encoded 2852039166 (= 169.254.169.254) → INVALID_URL
//   bbx-webhook-ssrf-03: 0.0.0.0 → INVALID_URL
//   bbx-webhook-ssrf-04: DNS hostname resolving to 169.254.169.254 → INVALID_URL
//   bbx-webhook-ssrf-05: DNS resolution failure → INVALID_URL (fail-closed)
//   bbx-webhook-ssrf-06: Legitimate public hostname (resolves to 93.184.216.34) → 201
//   bbx-webhook-ssrf-07: DNS-rebinding at delivery time → delivery aborted, permanently_failed, no http call

import test from 'node:test';
import assert from 'node:assert/strict';
import { main as managementMain } from '../../packages/webhook-engine/actions/webhook-management.mjs';
import { main as deliveryMain } from '../../packages/webhook-engine/actions/webhook-delivery-worker.mjs';
import { encryptSecret } from '../../packages/webhook-engine/src/webhook-signing.mjs';
import { TEST_WEBHOOK_KEY_CONTEXT } from '../helpers/webhook-key.mjs';

// Minimal in-memory db stub for the POST subscription path
function makeManagementDb() {
  const state = { subscriptions: new Map(), secrets: new Map() };
  return {
    state,
    async getWorkspaceSubscriptionCount() { return 0; },
    async insertSubscriptionWithSecret(row, encrypted) {
      state.subscriptions.set(row.id, row);
      state.secrets.set(row.id, [{ subscription_id: row.id, secret_cipher: encrypted.cipher, secret_iv: encrypted.iv, status: 'active' }]);
    }
  };
}

const auth = { tenantId: 't1', workspaceId: 'w1', actorId: 'u1' };
const env = {};
const keyContext = TEST_WEBHOOK_KEY_CONTEXT;
const kafka = { publish: async () => {} };

// -------------------------------------------------------------------------
// bbx-webhook-ssrf-01: IPv4 link-local 169.254.169.254
// -------------------------------------------------------------------------
test('bbx-webhook-ssrf-01: https://169.254.169.254/latest/meta-data/ → INVALID_URL', async () => {
  const db = makeManagementDb();
  const result = await managementMain({
    db, kafka, keyContext, env, auth,
    method: 'POST',
    path: '/v1/webhooks/subscriptions',
    body: { targetUrl: 'https://169.254.169.254/latest/meta-data/', eventTypes: ['document.created'] }
  });
  assert.equal(result.statusCode, 400, `expected 400 but got ${result.statusCode}`);
  assert.equal(result.body.code, 'INVALID_URL', `expected INVALID_URL but got ${result.body.code}`);
  assert.equal(db.state.subscriptions.size, 0, 'subscription must not be created');
});

// -------------------------------------------------------------------------
// bbx-webhook-ssrf-02: Decimal-encoded IP 2852039166 = 169.254.169.254
// -------------------------------------------------------------------------
test('bbx-webhook-ssrf-02: https://2852039166/path → INVALID_URL (decimal encoding)', async () => {
  const db = makeManagementDb();
  const result = await managementMain({
    db, kafka, keyContext, env, auth,
    method: 'POST',
    path: '/v1/webhooks/subscriptions',
    body: { targetUrl: 'https://2852039166/path', eventTypes: ['document.created'] }
  });
  assert.equal(result.statusCode, 400, `expected 400 but got ${result.statusCode}`);
  assert.equal(result.body.code, 'INVALID_URL', `expected INVALID_URL but got ${result.body.code}`);
  assert.equal(db.state.subscriptions.size, 0, 'subscription must not be created');
});

// -------------------------------------------------------------------------
// bbx-webhook-ssrf-03: 0.0.0.0
// -------------------------------------------------------------------------
test('bbx-webhook-ssrf-03: https://0.0.0.0/path → INVALID_URL', async () => {
  const db = makeManagementDb();
  const result = await managementMain({
    db, kafka, keyContext, env, auth,
    method: 'POST',
    path: '/v1/webhooks/subscriptions',
    body: { targetUrl: 'https://0.0.0.0/path', eventTypes: ['document.created'] }
  });
  assert.equal(result.statusCode, 400, `expected 400 but got ${result.statusCode}`);
  assert.equal(result.body.code, 'INVALID_URL', `expected INVALID_URL but got ${result.body.code}`);
  assert.equal(db.state.subscriptions.size, 0, 'subscription must not be created');
});

// -------------------------------------------------------------------------
// bbx-webhook-ssrf-04: DNS hostname resolving to 169.254.169.254 → INVALID_URL
// (injectable resolver simulates a name that resolves to link-local)
// -------------------------------------------------------------------------
test('bbx-webhook-ssrf-04: DNS hostname resolving to 169.254.169.254 → INVALID_URL', async () => {
  const db = makeManagementDb();
  const resolver = async () => ['169.254.169.254'];
  const result = await managementMain({
    db, kafka, keyContext, env, auth,
    resolver,
    method: 'POST',
    path: '/v1/webhooks/subscriptions',
    body: { targetUrl: 'https://metadata.evil.example.com/hook', eventTypes: ['document.created'] }
  });
  assert.equal(result.statusCode, 400, `expected 400 but got ${result.statusCode}`);
  assert.equal(result.body.code, 'INVALID_URL', `expected INVALID_URL but got ${result.body.code}`);
  assert.equal(db.state.subscriptions.size, 0, 'subscription must not be created');
});

// -------------------------------------------------------------------------
// bbx-webhook-ssrf-05: DNS resolution failure → INVALID_URL (fail-closed)
// -------------------------------------------------------------------------
test('bbx-webhook-ssrf-05: DNS resolution failure → INVALID_URL (fail-closed)', async () => {
  const db = makeManagementDb();
  const resolver = async () => { throw new Error('ENOTFOUND'); };
  const result = await managementMain({
    db, kafka, keyContext, env, auth,
    resolver,
    method: 'POST',
    path: '/v1/webhooks/subscriptions',
    body: { targetUrl: 'https://does-not-exist.invalid/hook', eventTypes: ['document.created'] }
  });
  assert.equal(result.statusCode, 400, `expected 400 but got ${result.statusCode}`);
  assert.equal(result.body.code, 'INVALID_URL', `expected INVALID_URL but got ${result.body.code}`);
  assert.equal(db.state.subscriptions.size, 0, 'subscription must not be created');
});

// -------------------------------------------------------------------------
// bbx-webhook-ssrf-06: Legitimate public hostname → 201 accepted
// -------------------------------------------------------------------------
test('bbx-webhook-ssrf-06: legitimate public HTTPS URL is accepted → 201', async () => {
  const db = makeManagementDb();
  const resolver = async () => ['93.184.216.34']; // example.com, public IP
  const result = await managementMain({
    db, kafka, keyContext, env, auth,
    resolver,
    method: 'POST',
    path: '/v1/webhooks/subscriptions',
    body: { targetUrl: 'https://example.com/hook', eventTypes: ['document.created'] }
  });
  assert.equal(result.statusCode, 201, `expected 201 but got ${result.statusCode}: ${JSON.stringify(result.body)}`);
  assert.equal(db.state.subscriptions.size, 1, 'subscription must be created');
});

// -------------------------------------------------------------------------
// Shared delivery-db factory for delivery-worker black-box tests
// -------------------------------------------------------------------------
function makeDeliveryDb(targetUrl = 'https://hooks.example.com/endpoint') {
  const encrypted = encryptSecret('signing-secret', keyContext);
  return {
    state: {
      deliveries: new Map([['d1', {
        id: 'd1',
        subscription_id: 's1',
        tenant_id: 't1',
        workspace_id: 'w1',
        event_type: 'document.created',
        event_id: 'e1',
        attempt_count: 0,
        max_attempts: 3,
        status: 'pending'
      }]]),
      subscriptions: new Map([['s1', {
        id: 's1',
        tenant_id: 't1',
        workspace_id: 'w1',
        target_url: targetUrl,
        status: 'active',
        consecutive_failures: 0
      }]]),
      secrets: new Map([['s1', [{ status: 'active', secret_cipher: encrypted.cipher, secret_iv: encrypted.iv, encryption_key_id: keyContext.keyId }]]]),
      events: new Map([['e1', { eventId: 'e1', data: { ok: true } }]]),
      attempts: []
    },
    async getDeliveryById(id) { return this.state.deliveries.get(id); },
    async getSubscription(id) { return this.state.subscriptions.get(id); },
    async listSecrets(subscriptionId) { return this.state.secrets.get(subscriptionId) ?? []; },
    async getEvent(id) { return this.state.events.get(id); },
    async insertAttempt(row) { this.state.attempts.push(row); },
    async updateDelivery(id, patch) {
      const row = { ...this.state.deliveries.get(id), ...patch };
      this.state.deliveries.set(id, row);
      return row;
    },
    async incrementSubscriptionFailures(id) {
      const row = { ...this.state.subscriptions.get(id), consecutive_failures: (this.state.subscriptions.get(id).consecutive_failures ?? 0) + 1 };
      this.state.subscriptions.set(id, row);
      return row;
    },
    async updateSubscription(id, patch) {
      const row = { ...this.state.subscriptions.get(id), ...patch };
      this.state.subscriptions.set(id, row);
      return row;
    }
  };
}

// -------------------------------------------------------------------------
// bbx-webhook-ssrf-07: DNS-rebinding — delivery-time re-validation
// A URL valid at registration time later resolves to a blocked IP.
// The delivery must be aborted (no HTTP call) and recorded as permanently_failed.
// -------------------------------------------------------------------------
test('bbx-webhook-ssrf-07: DNS rebinding at delivery time → abort, permanently_failed, no http call', async () => {
  const deliveryDb = makeDeliveryDb();
  let httpCalled = false;
  const http = async () => {
    httpCalled = true;
    return new Response('', { status: 200 });
  };

  // Resolver simulates DNS rebinding: the name now resolves to 169.254.169.254
  const resolver = async () => ['169.254.169.254'];

  const scheduler = { main: async () => ({ status: 'scheduled' }), invoker: { invoke: async () => {} } };

  const result = await deliveryMain({
    db: deliveryDb,
    kafka: { publish: async () => {} },
    keyContext,
    scheduler,
    http,
    resolver,
    deliveryId: 'd1',
    env: { WEBHOOK_MAX_PAYLOAD_BYTES: '524288', WEBHOOK_RESPONSE_TIMEOUT_MS: '5000' }
  });

  assert.equal(httpCalled, false, 'http must NOT be called when SSRF guard triggers');
  const delivery = deliveryDb.state.deliveries.get('d1');
  assert.equal(delivery.status, 'permanently_failed', `expected permanently_failed but got ${delivery.status}`);
});

// -------------------------------------------------------------------------
// bbx-webhook-rebind: DNS-rebinding re-validation (alias / req-1 explicit)
// Same guard as ssrf-07; explicit name for the spec scenario.
// -------------------------------------------------------------------------
test('bbx-webhook-rebind: rebind to blocked IP at delivery → permanently_failed, http NOT called', async () => {
  const deliveryDb = makeDeliveryDb();
  let httpCalled = false;
  const http = async () => { httpCalled = true; return new Response('', { status: 200 }); };
  const resolver = async () => ['192.168.1.100'];  // RFC-1918 private
  const scheduler = { main: async () => ({ status: 'scheduled' }), invoker: { invoke: async () => {} } };

  await deliveryMain({
    db: deliveryDb,
    kafka: { publish: async () => {} },
    keyContext,
    scheduler, http, resolver,
    deliveryId: 'd1',
    env: { WEBHOOK_MAX_PAYLOAD_BYTES: '524288', WEBHOOK_RESPONSE_TIMEOUT_MS: '5000' }
  });

  assert.equal(httpCalled, false, 'http must NOT be called on rebind');
  const delivery = deliveryDb.state.deliveries.get('d1');
  assert.equal(delivery.status, 'permanently_failed', `expected permanently_failed but got ${delivery.status}`);
});

// -------------------------------------------------------------------------
// bbx-webhook-pin-01: IP pinning (req-2)
// After validation, the HTTP call must use the exact pinned address from the
// resolver. A fake dispatcherFactory records the address it was given; a fake
// http records the dispatcher it received. Asserts pinning without undici.
// -------------------------------------------------------------------------
test('bbx-webhook-pin-01: delivery pins HTTP connection to the validated IP address', async () => {
  const deliveryDb = makeDeliveryDb();
  const PINNED_IP = '203.0.113.10';  // TEST-NET-3, public documentation IP
  const resolver = async () => [PINNED_IP];

  // Sentinel dispatcher object so we can test identity equality
  const sentinelDispatcher = { isSentinel: true };

  let factoryCalledWith = null;
  const dispatcherFactory = async ({ address, family }) => {
    factoryCalledWith = { address, family };
    return sentinelDispatcher;
  };

  let httpCalledWithDispatcher = null;
  const http = async (url, opts) => {
    httpCalledWithDispatcher = opts?.dispatcher ?? null;
    return new Response('', { status: 200 });
  };

  const scheduler = { main: async () => ({ status: 'scheduled' }), invoker: { invoke: async () => {} } };

  const result = await deliveryMain({
    db: deliveryDb,
    kafka: { publish: async () => {} },
    keyContext,
    scheduler, http, resolver,
    dispatcherFactory,
    deliveryId: 'd1',
    env: { WEBHOOK_MAX_PAYLOAD_BYTES: '524288', WEBHOOK_RESPONSE_TIMEOUT_MS: '5000' }
  });

  assert.equal(result.status, 'succeeded', `expected succeeded but got ${result.status}`);
  assert.ok(factoryCalledWith !== null, 'dispatcherFactory must be called');
  assert.equal(factoryCalledWith.address, PINNED_IP, `dispatcherFactory must receive the validated IP, got ${factoryCalledWith?.address}`);
  assert.strictEqual(httpCalledWithDispatcher, sentinelDispatcher, 'http must receive the sentinel dispatcher from dispatcherFactory');
});

// -------------------------------------------------------------------------
// bbx-webhook-redirect-01: redirect to blocked IP (req-3)
// A 302 whose Location resolves to a blocked address must permanently_fail.
// http is called once (the initial POST) but redirect is NOT followed.
// -------------------------------------------------------------------------
test('bbx-webhook-redirect-01: 302 redirect to blocked IP → permanently_failed, redirect not followed', async () => {
  const deliveryDb = makeDeliveryDb();
  // Public IP for initial delivery target
  const resolver = async (hostname) => {
    if (hostname === 'hooks.example.com') return ['203.0.113.10'];
    if (hostname === 'evil.example') return ['169.254.169.254'];
    return ['93.184.216.34'];
  };

  let httpCallCount = 0;
  const http = async () => {
    httpCallCount += 1;
    // Return a 302 redirect to a hostname that resolves to a blocked IP
    return new Response(null, {
      status: 302,
      headers: { location: 'https://evil.example/x' }
    });
  };

  // No-op dispatcherFactory (pinning)
  const dispatcherFactory = async () => ({ isFake: true });
  const scheduler = { main: async () => ({ status: 'scheduled' }), invoker: { invoke: async () => {} } };

  const result = await deliveryMain({
    db: deliveryDb,
    kafka: { publish: async () => {} },
    keyContext,
    scheduler, http, resolver,
    dispatcherFactory,
    deliveryId: 'd1',
    env: { WEBHOOK_MAX_PAYLOAD_BYTES: '524288', WEBHOOK_RESPONSE_TIMEOUT_MS: '5000' }
  });

  assert.equal(result.status, 'permanently_failed', `expected permanently_failed but got ${result.status}`);
  assert.equal(httpCallCount, 1, 'http must be called exactly once (no redirect following)');
  const delivery = deliveryDb.state.deliveries.get('d1');
  assert.equal(delivery.status, 'permanently_failed', `delivery record must be permanently_failed, got ${delivery.status}`);
});
