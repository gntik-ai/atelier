// bbx-webhook-subscription-id-validation
//
// Black-box coverage for change fix-672-webhook-subscription-id-validation
// (GitHub #672).
//
// A webhook subscription request whose path id is NOT a well-formed UUID used to
// return 500 CONTROL_PLANE_ERROR instead of 404: the malformed id flowed into the
// Postgres `WHERE id = $1` predicate against a `uuid` column, raising SQLSTATE
// 22P02 (`invalid input syntax for type uuid`) with no try/catch on the by-id read
// path, so it bubbled to the control-plane central catch as a generic 500. A
// well-formed-but-nonexistent UUID correctly returned 404 ("Subscription not
// found"). The fix guards the id at the single chokepoint `requireSubscription`
// (covering GET/PATCH/DELETE/pause/resume/rotate-secret/deliveries) and the
// delivery id on the deliveries sub-route, so a malformed id is treated exactly
// like a nonexistent one (404) and never reaches the db.
//
// These tests drive the SAME local handler (`webhookManage`) and ctx shape as
// webhook-management-routes.test.mjs, with an injected in-memory db that is
// FAITHFUL to production: getSubscription / getDelivery THROW a pg-like 22P02
// error when handed a non-UUID id (modeling the uuid column). On the pre-fix code
// the throw propagates out of `main` and `webhookManage(...)` REJECTS; after the
// fix the guard returns 404 before the throwing db method is ever reached.
//
// Scenarios:
//   bbx-672-uuid-01: GET tenant-addressed by non-uuid id -> 404, resolves (no reject), db never touched
//   bbx-672-uuid-02: GET workspace-addressed `.../undefined` -> 404
//   bbx-672-uuid-03: PATCH/DELETE/pause/resume/rotate-secret with a non-uuid id -> never 500 (all 404)
//   bbx-672-uuid-04: control — valid-but-nonexistent uuid -> 404; valid EXISTING id -> 200
//   bbx-672-uuid-05: deliveries sub-route — valid sub id + non-uuid delivery id -> 404 "Delivery not found"
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEST_WEBHOOK_KEY_CONTEXT } from '../helpers/webhook-key.mjs';

// The handler lazily imports the action from ${REPO_ROOT}/packages/webhook-engine/...
// Point REPO_ROOT at this checkout so the import resolves outside the image.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
process.env.REPO_ROOT = REPO_ROOT;

const { webhookManage, setWebhookKeyContext } = await import('../../apps/control-plane/webhook-handlers.mjs');
setWebhookKeyContext(TEST_WEBHOOK_KEY_CONTEXT);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// pg raises this on `WHERE <uuid col> = $1` when $1 is not a valid UUID. Model it
// faithfully so a malformed id that reaches the db blows up exactly as in prod.
function pgUuidError(value) {
  return Object.assign(new Error(`invalid input syntax for type uuid: "${value}"`), { code: '22P02' });
}

// In-memory db implementing the adapter the action calls. getSubscription /
// getDelivery THROW the pg 22P02 error for a non-UUID id (the uuid column), so the
// only way to avoid a throw is for the action to reject the id before the db call.
function memDb() {
  const subs = new Map();
  const secrets = [];
  const deliveries = [];
  return {
    _subs: subs, _secrets: secrets, _deliveries: deliveries,
    _getSubscriptionCalls: [], _getDeliveryCalls: [],
    async getWorkspaceSubscriptionCount(t, w) {
      return [...subs.values()].filter((s) => s.tenant_id === t && s.workspace_id === w && !s.deleted_at).length;
    },
    async insertSubscriptionWithSecret(r, enc, encryptionKeyId) {
      subs.set(r.id, { ...r });
      secrets.push({ subscription_id: r.id, secret_cipher: enc.cipher, secret_iv: enc.iv, encryption_key_id: encryptionKeyId, status: 'active', tenant_id: r.tenant_id, workspace_id: r.workspace_id });
    },
    async listSubscriptions(ctx) {
      return [...subs.values()].filter((s) => s.tenant_id === ctx.tenantId && s.workspace_id === ctx.workspaceId && !s.deleted_at);
    },
    async getSubscription(id) {
      this._getSubscriptionCalls.push(id);
      if (!UUID_RE.test(String(id ?? ''))) throw pgUuidError(id); // uuid column: 22P02
      return subs.get(id) ?? null;
    },
    async updateSubscription(id, patch) { const s = { ...subs.get(id), ...patch, updated_at: new Date().toISOString() }; subs.set(id, s); return s; },
    async replaceSubscription(rec) { subs.set(rec.id, { ...rec }); return subs.get(rec.id); },
    async cancelPendingDeliveries() {},
    async rotateSecret(id, enc, grace, t, w, encryptionKeyId) {
      for (const s of secrets) if (s.subscription_id === id && s.status === 'active') { s.status = 'grace'; s.grace_expires_at = grace; }
      secrets.push({ subscription_id: id, secret_cipher: enc.cipher, secret_iv: enc.iv, encryption_key_id: encryptionKeyId, status: 'active', tenant_id: t, workspace_id: w });
    },
    async listDeliveries(id) { return deliveries.filter((d) => d.subscription_id === id); },
    async getDelivery(id, did) {
      this._getDeliveryCalls.push(did);
      if (!UUID_RE.test(String(did ?? ''))) throw pgUuidError(did); // uuid column: 22P02
      return deliveries.find((d) => d.subscription_id === id && d.id === did) ?? null;
    },
  };
}

// Build the ctx the control-plane server hands a local handler.
const CONTROL_PLANE_POOL = { async query() {} };
const WEBHOOK_RUNTIME_POOL = { async query() {} };
const WEBHOOK_WRITE_POOL = { async query() {} };
function ctx({ method = 'GET', url, body = {}, query = {}, identity, params = {} }) {
  return {
    req: { method, url },
    body,
    query,
    identity,
    params,
    pool: CONTROL_PLANE_POOL,
    webhookRuntimePool: WEBHOOK_RUNTIME_POOL,
    webhookWritePool: WEBHOOK_WRITE_POOL,
  };
}
const A = { sub: 'user-a', tenantId: 'tenant-a', workspaceId: 'ws-a', actorType: 'tenant_owner' };
const ownedWs = (tenantId) => async (_pool, wsId) => ({ id: wsId, tenant_id: tenantId });
const TARGET = 'https://93.184.216.34/hook'; // IP-literal HTTPS -> offline IP-blocklist path
const NONEXISTENT_UUID = '00000000-0000-0000-0000-000000000000';

async function createOne(db) {
  const res = await webhookManage(ctx({
    method: 'POST', url: '/v1/webhooks/subscriptions', identity: A,
    body: { targetUrl: TARGET, eventTypes: ['document.created'] },
  }), { buildDb: () => db });
  assert.equal(res.statusCode, 201, 'fixture: create returns 201');
  return res.body.subscriptionId;
}

test('bbx-672-uuid-01: GET by a non-uuid id resolves to 404 (no reject) and never touches the db', async () => {
  const db = memDb();
  // The throwing getSubscription must never be reached: the guard returns 404 first.
  const res = await webhookManage(ctx({ method: 'GET', url: '/v1/webhooks/subscriptions/not-a-uuid', identity: A }), { buildDb: () => db });
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, 'NOT_FOUND');
  assert.equal(res.body.message, 'Subscription not found');
  assert.deepEqual(db._getSubscriptionCalls, [], 'the malformed id never reached db.getSubscription (no 22P02)');
});

test('bbx-672-uuid-02: GET workspace-addressed `.../undefined` -> 404 (no 500)', async () => {
  const db = memDb();
  const res = await webhookManage(ctx({
    method: 'GET', url: '/v1/workspaces/ws-a/webhooks/subscriptions/undefined', identity: A, params: { workspaceId: 'ws-a' },
  }), { buildDb: () => db, getWorkspace: ownedWs('tenant-a') });
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, 'NOT_FOUND');
  assert.deepEqual(db._getSubscriptionCalls, [], 'literal "undefined" id never reached the db');
});

test('bbx-672-uuid-03: PATCH/DELETE/pause/resume/rotate-secret with a non-uuid id are 404, never 500', async () => {
  const cases = [
    { method: 'PATCH', url: '/v1/webhooks/subscriptions/not-a-uuid', body: { targetUrl: TARGET, eventTypes: ['document.created'] } },
    { method: 'DELETE', url: '/v1/webhooks/subscriptions/not-a-uuid' },
    { method: 'POST', url: '/v1/webhooks/subscriptions/not-a-uuid/pause' },
    { method: 'POST', url: '/v1/webhooks/subscriptions/not-a-uuid/resume' },
    { method: 'POST', url: '/v1/webhooks/subscriptions/not-a-uuid/rotate-secret' },
  ];
  for (const c of cases) {
    const db = memDb();
    const res = await webhookManage(ctx({ ...c, identity: A }), { buildDb: () => db });
    assert.equal(res.statusCode, 404, `${c.method} ${c.url} -> 404 (got ${res.statusCode})`);
    assert.notEqual(res.statusCode, 500, `${c.method} ${c.url} must never be 500`);
    assert.deepEqual(db._getSubscriptionCalls, [], `${c.method} ${c.url}: malformed id never reached the db`);
  }
});

test('bbx-672-uuid-04: control — valid-but-nonexistent uuid -> 404; valid EXISTING id -> 200', async () => {
  const db = memDb();
  // valid-but-nonexistent: passes the format guard, reaches the db, returns null -> 404
  const missing = await webhookManage(ctx({ method: 'GET', url: `/v1/webhooks/subscriptions/${NONEXISTENT_UUID}`, identity: A }), { buildDb: () => db });
  assert.equal(missing.statusCode, 404, 'valid-but-nonexistent uuid is still 404');
  assert.deepEqual(db._getSubscriptionCalls, [NONEXISTENT_UUID], 'a valid uuid DOES reach the db');
  // valid existing: create one (gets a real crypto.randomUUID id) then GET it
  const id = await createOne(db);
  assert.ok(UUID_RE.test(id), 'created subscription id is a uuid');
  const got = await webhookManage(ctx({ method: 'GET', url: `/v1/webhooks/subscriptions/${id}`, identity: A }), { buildDb: () => db });
  assert.equal(got.statusCode, 200, 'happy path unchanged: an existing subscription is 200');
  assert.equal(got.body.subscriptionId, id);
});

test('bbx-672-uuid-05: deliveries sub-route — valid sub id + non-uuid delivery id -> 404 "Delivery not found"', async () => {
  const db = memDb();
  const id = await createOne(db); // real uuid subscription so requireSubscription passes
  const res = await webhookManage(ctx({ method: 'GET', url: `/v1/webhooks/subscriptions/${id}/deliveries/not-a-uuid`, identity: A }), { buildDb: () => db });
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, 'NOT_FOUND');
  assert.equal(res.body.message, 'Delivery not found');
  assert.deepEqual(db._getDeliveryCalls, [], 'malformed delivery id never reached db.getDelivery (no 22P02)');
});
