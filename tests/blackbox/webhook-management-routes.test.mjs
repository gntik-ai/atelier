// bbx-webhook-management-routes
//
// Black-box coverage for change add-webhook-engine-kind-runtime (GitHub #643).
//
// The kind control-plane serves `/v1/webhooks/*` via a LOCAL handler
// (`webhookManage`) that wraps the code-complete webhook-management action. These
// tests drive that handler with the SAME ctx shape the control-plane server
// builds (ctx.req.method/url, ctx.body, ctx.query, ctx.identity, ctx.pool) and an
// injected in-memory db, asserting the wrapper glue: method + pathname parsing
// from ctx.req.url, verified-identity -> tenant/workspace/actor mapping (body
// cannot spoof tenant), status pass-through, and tenant isolation. Routing
// reaches the action (no `NO_ROUTE`).
//
// Scenarios:
//   bbx-643-rt-01: GET /v1/webhooks/event-types -> 200 with the event catalogue
//   bbx-643-rt-02: POST /v1/webhooks/subscriptions (valid) -> 201 with subscriptionId + signingSecret, scoped to caller
//   bbx-643-rt-03: POST past the per-workspace quota -> 409 QUOTA_EXCEEDED
//   bbx-643-rt-04: GET list is scoped to the caller's tenant (tenant B never sees tenant A)
//   bbx-643-rt-05: cross-tenant GET by id -> 404 (no leak)
//   bbx-643-rt-06: pathname is parsed from ctx.req.url ignoring the query string
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
const { routes } = await import('../../apps/control-plane/routes.mjs');
const { LOCAL_HANDLERS } = await import('../../apps/control-plane/b-handlers.mjs');

// In-memory, multi-tenant db implementing the adapter interface the action calls.
function memDb() {
  const subs = new Map();
  const secrets = [];
  const deliveries = [];
  return {
    _subs: subs, _secrets: secrets,
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
    async getSubscription(id) { return subs.get(id) ?? null; },
    async updateSubscription(id, patch) { const s = { ...subs.get(id), ...patch, updated_at: new Date().toISOString() }; subs.set(id, s); return s; },
    async replaceSubscription(rec) { subs.set(rec.id, { ...rec }); return subs.get(rec.id); },
    async cancelPendingDeliveries() {},
    async rotateSecret(id, enc, grace, t, w, encryptionKeyId) {
      for (const s of secrets) if (s.subscription_id === id && s.status === 'active') { s.status = 'grace'; s.grace_expires_at = grace; }
      secrets.push({ subscription_id: id, secret_cipher: enc.cipher, secret_iv: enc.iv, encryption_key_id: encryptionKeyId, status: 'active', tenant_id: t, workspace_id: w });
    },
    async listDeliveries(id) { return deliveries.filter((d) => d.subscription_id === id); },
    async getDelivery(id, did) { return deliveries.find((d) => d.subscription_id === id && d.id === did) ?? null; },
  };
}

// Build the ctx the control-plane server hands a local handler.
const CONTROL_PLANE_POOL = { kind: 'global-control-plane', async query() {} };
const WEBHOOK_RUNTIME_POOL = { kind: 'webhook-runtime', async query() {} };
const WEBHOOK_WRITE_POOL = { kind: 'webhook-writer', async query() {} };
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
const B = { sub: 'user-b', tenantId: 'tenant-b', workspaceId: 'ws-b', actorType: 'tenant_owner' };
// IP-literal HTTPS target -> validator takes the IP-blocklist path, no DNS (deterministic, offline).
const TARGET = 'https://93.184.216.34/hook';

test('bbx-643-rt-01: GET /v1/webhooks/event-types -> 200 with the event catalogue', async () => {
  const db = memDb();
  const res = await webhookManage(ctx({ method: 'GET', url: '/v1/webhooks/event-types', identity: A }), { buildDb: () => db });
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.body.eventTypes) && res.body.eventTypes.some((e) => e.id === 'document.created'));
});

test('bbx-643-rt-02: POST /v1/webhooks/subscriptions (valid) -> 201 with id + signingSecret, scoped to caller', async () => {
  const db = memDb();
  const res = await webhookManage(ctx({
    method: 'POST', url: '/v1/webhooks/subscriptions', identity: A,
    body: { targetUrl: TARGET, eventTypes: ['document.created'] },
  }), { buildDb: () => db });
  assert.equal(res.statusCode, 201);
  assert.ok(res.body.subscriptionId, 'returns a subscription id');
  assert.ok(res.body.signingSecret, 'returns the signing secret once on create');
  const stored = db._subs.get(res.body.subscriptionId);
  assert.equal(stored.tenant_id, 'tenant-a');
  assert.equal(stored.workspace_id, 'ws-a');
  assert.equal(db._secrets[0].tenant_id, 'tenant-a', 'secret inherits tenant from subscription');
});

test('bbx-643-rt-03: POST past the per-workspace quota -> 409 QUOTA_EXCEEDED', async () => {
  const prev = process.env.WEBHOOK_MAX_SUBSCRIPTIONS_PER_WORKSPACE;
  process.env.WEBHOOK_MAX_SUBSCRIPTIONS_PER_WORKSPACE = '1';
  try {
    const db = memDb();
    const make = () => webhookManage(ctx({
      method: 'POST', url: '/v1/webhooks/subscriptions', identity: A,
      body: { targetUrl: TARGET, eventTypes: ['document.created'] },
    }), { buildDb: () => db });
    assert.equal((await make()).statusCode, 201);
    const second = await make();
    assert.equal(second.statusCode, 409);
    assert.equal(second.body.code, 'QUOTA_EXCEEDED');
  } finally {
    if (prev === undefined) delete process.env.WEBHOOK_MAX_SUBSCRIPTIONS_PER_WORKSPACE;
    else process.env.WEBHOOK_MAX_SUBSCRIPTIONS_PER_WORKSPACE = prev;
  }
});

test('bbx-643-rt-04: GET list is scoped to the caller tenant (B never sees A)', async () => {
  const db = memDb();
  const opts = { buildDb: () => db };
  await webhookManage(ctx({ method: 'POST', url: '/v1/webhooks/subscriptions', identity: A, body: { targetUrl: TARGET, eventTypes: ['document.created'] } }), opts);
  const listB = await webhookManage(ctx({ method: 'GET', url: '/v1/webhooks/subscriptions', identity: B }), opts);
  assert.equal(listB.statusCode, 200);
  assert.equal(listB.body.items.length, 0, 'tenant B sees none of tenant A subscriptions');
  const listA = await webhookManage(ctx({ method: 'GET', url: '/v1/webhooks/subscriptions', identity: A }), opts);
  assert.equal(listA.body.items.length, 1);
});

test('bbx-643-rt-05: cross-tenant GET by id -> 404 (no leak)', async () => {
  const db = memDb();
  const opts = { buildDb: () => db };
  const created = await webhookManage(ctx({ method: 'POST', url: '/v1/webhooks/subscriptions', identity: A, body: { targetUrl: TARGET, eventTypes: ['document.created'] } }), opts);
  const id = created.body.subscriptionId;
  const asB = await webhookManage(ctx({ method: 'GET', url: `/v1/webhooks/subscriptions/${id}`, identity: B }), opts);
  assert.equal(asB.statusCode, 404);
  const asA = await webhookManage(ctx({ method: 'GET', url: `/v1/webhooks/subscriptions/${id}`, identity: A }), opts);
  assert.equal(asA.statusCode, 200);
  assert.equal(asA.body.subscriptionId, id);
});

test('bbx-643-rt-06: pathname is parsed from ctx.req.url ignoring the query string', async () => {
  const db = memDb();
  const res = await webhookManage(ctx({ method: 'GET', url: '/v1/webhooks/subscriptions?cursor=abc&limit=10', identity: A }), { buildDb: () => db });
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.body.items), 'query string did not break route resolution');
});

test('bbx-643-rt-07: every webhook route (tenant- and workspace-addressed) is wired to webhookManage', () => {
  const wh = routes.filter((r) => r.path.includes('/webhooks'));
  assert.ok(wh.length >= 22, `expected both webhook route forms in the kind route table, got ${wh.length}`);
  assert.ok(wh.some((r) => r.path.startsWith('/v1/webhooks/')), 'tenant-addressed form present');
  assert.ok(wh.some((r) => r.path.startsWith('/v1/workspaces/')), 'workspace-addressed form present');
  assert.equal(typeof LOCAL_HANDLERS.webhookManage, 'function', 'webhookManage is registered in LOCAL_HANDLERS');
  for (const r of wh) {
    assert.equal(r.localHandler, 'webhookManage', `${r.method} ${r.path} dispatches to webhookManage`);
    assert.equal(r.auth, 'authenticated', `${r.method} ${r.path} requires authentication`);
  }
});

// ---- workspace-addressed form: /v1/workspaces/{workspaceId}/webhooks/... -----
// Workspace from PATH, authorized against the caller's verified tenant. A
// tenant_owner (no workspace_id in the JWT) CAN manage its workspace's webhooks.
const ownedWs = (tenantId) => async (_pool, wsId) => ({ id: wsId, tenant_id: tenantId });

test('bbx-643-rt-08: workspace-path create -> 201, scoped to the PATH workspace + caller tenant', async () => {
  const db = memDb();
  const res = await webhookManage(ctx({
    method: 'POST', url: '/v1/workspaces/ws-a/webhooks/subscriptions', identity: A, params: { workspaceId: 'ws-a' },
    body: { targetUrl: TARGET, eventTypes: ['document.created'] },
  }), { buildDb: () => db, getWorkspace: ownedWs('tenant-a') });
  assert.equal(res.statusCode, 201);
  const stored = db._subs.get(res.body.subscriptionId);
  assert.equal(stored.tenant_id, 'tenant-a');
  assert.equal(stored.workspace_id, 'ws-a', 'scoped to the workspace from the path');
});

test('bbx-643-rt-09: workspace-path on a cross-tenant workspace -> 404 (no leak, no create)', async () => {
  const db = memDb();
  // The workspace belongs to tenant-b; caller A (tenant-a) must not reach it.
  const res = await webhookManage(ctx({
    method: 'POST', url: '/v1/workspaces/ws-b/webhooks/subscriptions', identity: A, params: { workspaceId: 'ws-b' },
    body: { targetUrl: TARGET, eventTypes: ['document.created'] },
  }), { buildDb: () => db, getWorkspace: ownedWs('tenant-b') });
  assert.equal(res.statusCode, 404);
  assert.equal(db._subs.size, 0, 'nothing was persisted');
});

test('bbx-643-rt-10: workspace-path list rewrites the path and scopes to the workspace', async () => {
  const db = memDb();
  const opts = { buildDb: () => db, getWorkspace: ownedWs('tenant-a') };
  await webhookManage(ctx({ method: 'POST', url: '/v1/workspaces/ws-a/webhooks/subscriptions', identity: A, params: { workspaceId: 'ws-a' }, body: { targetUrl: TARGET, eventTypes: ['document.created'] } }), opts);
  const list = await webhookManage(ctx({ method: 'GET', url: '/v1/workspaces/ws-a/webhooks/subscriptions?limit=10', identity: A, params: { workspaceId: 'ws-a' } }), opts);
  assert.equal(list.statusCode, 200, 'path rewrite reached the list route (not 404)');
  assert.equal(list.body.items.length, 1);
});

test('bbx-643-rt-11: workspace-path event-types -> 200 (workspace authorized, path rewritten)', async () => {
  const db = memDb();
  const res = await webhookManage(ctx({ method: 'GET', url: '/v1/workspaces/ws-a/webhooks/event-types', identity: A, params: { workspaceId: 'ws-a' } }), { buildDb: () => db, getWorkspace: ownedWs('tenant-a') });
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.body.eventTypes));
});

test('bbx-c25-pools: webhook adapter never receives the global control-plane pool', async () => {
  const db = memDb();
  let adapterRuntimePool;
  let adapterWritePool;
  let workspacePool;
  const res = await webhookManage(ctx({
    method: 'GET',
    url: '/v1/workspaces/ws-a/webhooks/event-types',
    identity: A,
    params: { workspaceId: 'ws-a' },
  }), {
    buildDb(runtimePool, { writePool }) {
      adapterRuntimePool = runtimePool;
      adapterWritePool = writePool;
      return db;
    },
    async getWorkspace(pool, wsId) {
      workspacePool = pool;
      return { id: wsId, tenant_id: 'tenant-a' };
    },
  });
  assert.equal(res.statusCode, 200);
  assert.strictEqual(workspacePool, CONTROL_PLANE_POOL);
  assert.strictEqual(adapterRuntimePool, WEBHOOK_RUNTIME_POOL);
  assert.strictEqual(adapterWritePool, WEBHOOK_WRITE_POOL);
  assert.notStrictEqual(adapterRuntimePool, CONTROL_PLANE_POOL);
  assert.notStrictEqual(adapterWritePool, CONTROL_PLANE_POOL);
});

test('bbx-c25-pools-invalid: missing, shared, and global webhook pools fail before dispatch', async () => {
  for (const [label, overrides, expectedCode] of [
    [
      'missing writer',
      { webhookWritePool: null },
      'WEBHOOK_DATABASE_PRINCIPALS_REQUIRED',
    ],
    [
      'shared runtime/writer',
      { webhookWritePool: WEBHOOK_RUNTIME_POOL },
      'WEBHOOK_DATABASE_PRINCIPALS_INVALID',
    ],
    [
      'global writer',
      { webhookWritePool: CONTROL_PLANE_POOL },
      'WEBHOOK_DATABASE_PRINCIPALS_INVALID',
    ],
  ]) {
    let dispatched = false;
    const requestContext = {
      ...ctx({
        method: 'GET',
        url: '/v1/webhooks/event-types',
        identity: A,
      }),
      ...overrides,
    };
    const response = await webhookManage(requestContext, {
      buildDb() {
        dispatched = true;
        return memDb();
      },
    });
    assert.deepEqual(
      response,
      {
        statusCode: 503,
        body: {
          code: expectedCode,
          message: 'Webhook database principal configuration is unavailable',
        },
      },
      label,
    );
    assert.equal(dispatched, false, `${label} must fail before adapter dispatch`);
  }
});

test('bbx-c25-rotate-fence: stale lifecycle rotation returns bounded 503 without changing rows', async () => {
  const db = memDb();
  const options = { buildDb: () => db };
  const created = await webhookManage(ctx({
    method: 'POST',
    url: '/v1/webhooks/subscriptions',
    identity: A,
    body: { targetUrl: TARGET, eventTypes: ['document.created'] },
  }), options);
  assert.equal(created.statusCode, 201);
  const before = structuredClone(db._secrets);
  db.rotateSecret = async () => {
    throw Object.assign(
      new Error('WEBHOOK_KEY_WRITE_FENCED cipher key_id sql detail'),
      { code: '55000' },
    );
  };

  const response = await webhookManage(ctx({
    method: 'POST',
    url: `/v1/webhooks/subscriptions/${created.body.subscriptionId}/rotate-secret`,
    identity: A,
    body: { gracePeriodSeconds: 60 },
  }), options);
  assert.deepEqual(response, {
    statusCode: 503,
    body: {
      code: 'WEBHOOK_KEY_UNAVAILABLE',
      message: 'Webhook key lifecycle is not ready',
    },
  });
  assert.deepEqual(db._secrets, before);
  assert.doesNotMatch(
    JSON.stringify(response),
    /55000|WRITE_FENCED|cipher|key_id|sql|dsn/i,
  );
});
