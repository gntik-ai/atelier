// bbx-webhook-secret-tenant-scope
//
// Black-box coverage for GitHub issue #262 / change add-webhook-secret-tenant-scope.
// Drives the public `main` of webhook-management and webhook-delivery-worker actions only.
//
// The `webhook_signing_secrets` table historically carried only `subscription_id`
// (no `tenant_id`/`workspace_id`). This change threads the subscription's
// `tenant_id`/`workspace_id` through every secret db call so the injected db
// layer (whose SQL is deployed out of source) can add an
// `AND tenant_id = $N AND workspace_id = $M` predicate. These tests assert the
// scoping arguments are supplied by the in-source action contract and that an
// app-layer consistency guard rejects tenant-mismatched secret inserts.
//
// Scenarios:
//   bbx-webhook-secret-scope-01: create → insertSecret receives subscription tenant_id/workspace_id
//   bbx-webhook-secret-scope-02: rotate → rotateSecret receives subscription tenant_id/workspace_id
//   bbx-webhook-secret-scope-03: delivery → listSecrets receives subscription tenant_id/workspace_id
//   bbx-webhook-secret-scope-04: consistency guard rejects missing tenant_id on the record/subscription
//   bbx-webhook-secret-scope-05: a tenant-scoping db returns no secret for a wrong tenant (predicate honoured)

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { main as managementMain } from '../../packages/webhook-engine/actions/webhook-management.mjs';
import { main as deliveryMain } from '../../packages/webhook-engine/actions/webhook-delivery-worker.mjs';
import { encryptSecret } from '../../packages/webhook-engine/src/webhook-signing.mjs';
import { TEST_WEBHOOK_KEY_CONTEXT } from '../helpers/webhook-key.mjs';

const env = {};
const keyContext = TEST_WEBHOOK_KEY_CONTEXT;
const kafka = { publish: async () => {} };
const tenantA = { tenantId: 'tenant-a', workspaceId: 'ws-a', actorId: 'user-a' };
const publicResolver = async () => ['93.184.216.34']; // example.com, public IP

// Management db that records the exact args passed to the atomic create/rotate operations.
function makeManagementDb(subscription) {
  const calls = { insertSubscriptionWithSecret: [], rotateSecret: [] };
  return {
    calls,
    state: { subscriptions: new Map(), secrets: new Map() },
    async getWorkspaceSubscriptionCount() { return 0; },
    async insertSubscriptionWithSecret(...args) {
      calls.insertSubscriptionWithSecret.push(args);
      this.state.subscriptions.set(args[0].id, args[0]);
    },
    // For rotate/getSubscription paths
    async getSubscription(id) { return subscription && subscription.id === id ? subscription : this.state.subscriptions.get(id); },
    async rotateSecret(...args) { calls.rotateSecret.push(args); }
  };
}

// -------------------------------------------------------------------------
// bbx-webhook-secret-scope-01: create propagates tenant_id/workspace_id
// -------------------------------------------------------------------------
test('bbx-webhook-secret-scope-01: atomic create receives a tenant/workspace-scoped subscription', async () => {
  const db = makeManagementDb();
  const result = await managementMain({
    db, kafka, keyContext, env, auth: tenantA,
    resolver: publicResolver,
    method: 'POST',
    path: '/v1/webhooks/subscriptions',
    body: { targetUrl: 'https://example.com/hook', eventTypes: ['document.created'] }
  });

  assert.equal(result.statusCode, 201, `expected 201 but got ${result.statusCode}: ${JSON.stringify(result.body)}`);
  assert.equal(db.calls.insertSubscriptionWithSecret.length, 1, 'atomic create must be called exactly once');

  const [record, encrypted, encryptionKeyId] = db.calls.insertSubscriptionWithSecret[0];
  assert.equal(record.tenant_id, 'tenant-a');
  assert.equal(record.workspace_id, 'ws-a');
  assert.equal(typeof encrypted.cipher, 'string');
  assert.equal(encryptionKeyId, keyContext.keyId);
});

// -------------------------------------------------------------------------
// bbx-webhook-secret-scope-02: rotate propagates tenant_id/workspace_id
// -------------------------------------------------------------------------
test('bbx-webhook-secret-scope-02: rotateSecret receives the subscription tenant_id and workspace_id', async () => {
  // webhook_subscriptions.id is a UUID column (migration 001); the path id must be
  // a valid UUID or it is now correctly rejected as 404 before the db (see #672).
  const subscriptionId = crypto.randomUUID();
  const subscription = {
    id: subscriptionId,
    tenant_id: 'tenant-a',
    workspace_id: 'ws-a',
    target_url: 'https://example.com/hook',
    event_types: ['document.created'],
    status: 'active',
    consecutive_failures: 0,
    deleted_at: null
  };
  const db = makeManagementDb(subscription);

  const result = await managementMain({
    db, kafka, keyContext, env, auth: tenantA,
    resolver: publicResolver,
    method: 'POST',
    path: `/v1/webhooks/subscriptions/${subscriptionId}/rotate-secret`,
    body: { gracePeriodSeconds: 3600 }
  });

  assert.equal(result.statusCode, 200, `expected 200 but got ${result.statusCode}: ${JSON.stringify(result.body)}`);
  assert.equal(db.calls.rotateSecret.length, 1, 'rotateSecret must be called exactly once');

  const args = db.calls.rotateSecret[0];
  // args: [subscriptionId, encrypted, graceExpiresAt, tenant_id, workspace_id]
  assert.ok(args.includes('tenant-a'), `rotateSecret must be passed the subscription tenant_id; got args=${JSON.stringify(args)}`);
  assert.ok(args.includes('ws-a'), `rotateSecret must be passed the subscription workspace_id; got args=${JSON.stringify(args)}`);
});

// -------------------------------------------------------------------------
// bbx-webhook-secret-scope-03: delivery propagates tenant_id/workspace_id to listSecrets
// -------------------------------------------------------------------------
test('bbx-webhook-secret-scope-03: listSecrets receives the subscription tenant_id and workspace_id at delivery time', async () => {
  const encrypted = encryptSecret('signing-secret', keyContext);
  const listSecretsCalls = [];
  const deliveryDb = {
    state: {
      deliveries: new Map([['d1', {
        id: 'd1', subscription_id: 's1', tenant_id: 'tenant-a', workspace_id: 'ws-a',
        event_type: 'document.created', event_id: 'e1', attempt_count: 0, max_attempts: 3, status: 'pending'
      }]]),
      subscriptions: new Map([['s1', {
        id: 's1', tenant_id: 'tenant-a', workspace_id: 'ws-a',
        target_url: 'https://hooks.example.com/endpoint', status: 'active', consecutive_failures: 0
      }]]),
      events: new Map([['e1', { eventId: 'e1', data: { ok: true } }]]),
      attempts: []
    },
    async getDeliveryById(id) { return this.state.deliveries.get(id); },
    async getSubscription(id) { return this.state.subscriptions.get(id); },
    async listSecrets(...args) {
      listSecretsCalls.push(args);
      return [{ status: 'active', secret_cipher: encrypted.cipher, secret_iv: encrypted.iv, encryption_key_id: keyContext.keyId }];
    },
    async getEvent(id) { return this.state.events.get(id); },
    async insertAttempt(row) { this.state.attempts.push(row); },
    async updateDelivery(id, patch) {
      const row = { ...this.state.deliveries.get(id), ...patch };
      this.state.deliveries.set(id, row);
      return row;
    }
  };

  const resolver = async () => ['203.0.113.10']; // public TEST-NET-3
  const dispatcherFactory = async () => ({ isFake: true });
  const http = async () => new Response('', { status: 200 });
  const scheduler = { main: async () => ({ status: 'scheduled' }), invoker: { invoke: async () => {} } };

  const result = await deliveryMain({
    db: deliveryDb, kafka, keyContext, scheduler, http, resolver, dispatcherFactory,
    deliveryId: 'd1',
    env: { WEBHOOK_MAX_PAYLOAD_BYTES: '524288', WEBHOOK_RESPONSE_TIMEOUT_MS: '5000' }
  });

  assert.equal(result.status, 'succeeded', `expected succeeded but got ${result.status}`);
  assert.equal(listSecretsCalls.length, 1, 'listSecrets must be called exactly once');
  const args = listSecretsCalls[0];
  // args: [subscriptionId, tenant_id, workspace_id]
  assert.ok(args.includes('tenant-a'), `listSecrets must be passed the subscription tenant_id; got args=${JSON.stringify(args)}`);
  assert.ok(args.includes('ws-a'), `listSecrets must be passed the subscription workspace_id; got args=${JSON.stringify(args)}`);
});

// -------------------------------------------------------------------------
// bbx-webhook-secret-scope-04: consistency guard rejects missing tenant context
// A subscription record that somehow lacks a tenant_id must NOT result in a
// secret being persisted (would orphan secret material off the tenant dimension).
// -------------------------------------------------------------------------
test('bbx-webhook-secret-scope-04: secret create is rejected when the subscription record has no tenant_id', async () => {
  const db = makeManagementDb();

  const result = await managementMain({
    db, kafka, keyContext, env,
    auth: { tenantId: '', workspaceId: 'ws-a', actorId: 'user-a' },
    resolver: publicResolver,
    method: 'POST',
    path: '/v1/webhooks/subscriptions',
    body: { targetUrl: 'https://example.com/hook', eventTypes: ['document.created'] }
  });

  assert.notEqual(result.statusCode, 201, `secret create must be rejected for a record missing tenant_id (got ${result.statusCode})`);
  assert.equal(
    db.calls.insertSubscriptionWithSecret.length,
    0,
    'atomic create must NOT be called when tenant_id is missing',
  );
});

// -------------------------------------------------------------------------
// bbx-webhook-secret-scope-05: a tenant-scoping db returns no secret for the wrong tenant
// Mirrors proposal 2.3/2.5 at the contract level: the action supplies the
// predicate args the db needs; a db that honours them yields no rows for a
// mismatched tenant, so delivery signs nothing (no http call / failure).
// -------------------------------------------------------------------------
test('bbx-webhook-secret-scope-05: tenant-scoping listSecrets returns no rows for a mismatched tenant', async () => {
  const encrypted = encryptSecret('signing-secret', keyContext);
  // Secret physically belongs to tenant-a; the db enforces the predicate.
  const storedSecret = { status: 'active', secret_cipher: encrypted.cipher, secret_iv: encrypted.iv, encryption_key_id: keyContext.keyId, tenant_id: 'tenant-a', workspace_id: 'ws-a' };

  let httpCalled = false;
  const deliveryDb = {
    state: {
      // Delivery + subscription mislabeled as tenant-b (e.g. tampered/guessed)
      deliveries: new Map([['d1', {
        id: 'd1', subscription_id: 's1', tenant_id: 'tenant-b', workspace_id: 'ws-b',
        event_type: 'document.created', event_id: 'e1', attempt_count: 0, max_attempts: 3, status: 'pending'
      }]]),
      subscriptions: new Map([['s1', {
        id: 's1', tenant_id: 'tenant-b', workspace_id: 'ws-b',
        target_url: 'https://hooks.example.com/endpoint', status: 'active', consecutive_failures: 0
      }]]),
      events: new Map([['e1', { eventId: 'e1', data: { ok: true } }]]),
      attempts: []
    },
    async getDeliveryById(id) { return this.state.deliveries.get(id); },
    async getSubscription(id) { return this.state.subscriptions.get(id); },
    async listSecrets(subscriptionId, tenantId, workspaceId) {
      // Honour the tenant predicate the action must supply.
      if (storedSecret.tenant_id === tenantId && storedSecret.workspace_id === workspaceId) return [storedSecret];
      return [];
    },
    async getEvent(id) { return this.state.events.get(id); },
    async insertAttempt(row) { this.state.attempts.push(row); },
    async updateDelivery(id, patch) {
      const row = { ...this.state.deliveries.get(id), ...patch };
      this.state.deliveries.set(id, row);
      return row;
    }
  };

  const resolver = async () => ['203.0.113.10'];
  const dispatcherFactory = async () => ({ isFake: true });
  const http = async () => { httpCalled = true; return new Response('', { status: 200 }); };
  const scheduler = { main: async () => ({ status: 'scheduled' }), invoker: { invoke: async () => {} } };

  let threw = false;
  let result;
  try {
    result = await deliveryMain({
      db: deliveryDb, kafka, keyContext, scheduler, http, resolver, dispatcherFactory,
      deliveryId: 'd1',
      env: { WEBHOOK_MAX_PAYLOAD_BYTES: '524288', WEBHOOK_RESPONSE_TIMEOUT_MS: '5000' }
    });
  } catch {
    threw = true;
  }

  // With the predicate honoured, no secret is available for tenant-b's view of
  // s1, so the payload is never signed and delivered with that secret. Either
  // the action throws (no secret to sign) or it does not succeed; in no case
  // does it succeed by leaking tenant-a's secret.
  assert.ok(threw || (result && result.status !== 'succeeded'), `delivery must not succeed by leaking another tenant's secret; httpCalled=${httpCalled}, result=${JSON.stringify(result)}`);
});
