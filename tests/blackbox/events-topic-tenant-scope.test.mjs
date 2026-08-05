/**
 * Black-box tests for cross-tenant Events/Kafka topic access isolation in the
 * control-plane events routes (fix-events-topic-tenant-scope, P0 ISO-EVENTS).
 *
 * Drives the public KAFKA_HANDLERS interface only — no internal knowledge.
 * The cross-tenant cases must be rejected BEFORE any Kafka call, so these tests
 * never touch a broker. The positive cases use eventsTopicAccess, which builds
 * its response from the topic row alone (no Kafka).
 *
 * bbx-events-scope-01: Tenant B reads Tenant A topic detail → 404
 * bbx-events-scope-02: Tenant B reads Tenant A topic metadata → 404
 * bbx-events-scope-03: Tenant B reads Tenant A topic access policy → 404
 * bbx-events-scope-04: Tenant B publishes into Tenant A topic → 404
 * bbx-events-scope-05: Tenant B consumes (SSE) Tenant A topic → 404
 * bbx-events-scope-06: Tenant B lists Tenant A workspace topic inventory → 404
 * bbx-events-scope-07: Tenant A reads its own topic access → 200 (own-tenant)
 * bbx-events-scope-08: Superadmin reads any tenant's topic access → 200 (bypass)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { KAFKA_HANDLERS } from '../../apps/control-plane/kafka-handlers.mjs';
import { normalizeErrorResponse } from '../../apps/shared/error-envelope.mjs';

const TOPIC_A = {
  id: 'res_topic_aaaa',
  workspace_id: 'ws-a',
  tenant_id: 'tenant-a',
  topic_name: 'orders',
  physical_topic_name: 'ws.acme.orders',
  partitions: 1,
  created_at: new Date().toISOString(),
};
const WS_A = { id: 'ws-a', tenant_id: 'tenant-a', slug: 'app-staging', display_name: 'App Staging', status: 'active', environment: 'staging' };

/** Fake pg pool: returns TOPIC_A for the topic lookup and WS_A for the workspace
 *  lookup, regardless of caller. The tenant boundary is enforced in the handler,
 *  not the SQL, so the pool stays dumb (mirrors the live unscoped store). */
function fakePool() {
  return {
    async query(sql) {
      if (sql.includes('workspace_topics')) return { rows: [TOPIC_A] };
      if (sql.includes('FROM workspaces')) return { rows: [WS_A] };
      return { rows: [] };
    },
  };
}

const IDENTITY_A = { sub: 'user-a', tenantId: 'tenant-a', workspaceId: 'ws-a', actorType: 'tenant_owner', roles: ['tenant_owner'], scopes: [] };
const IDENTITY_B = { sub: 'user-b', tenantId: 'tenant-b', workspaceId: 'ws-b', actorType: 'tenant_owner', roles: ['tenant_owner'], scopes: [] };
const IDENTITY_SA = { sub: 'sa', tenantId: null, workspaceId: null, actorType: 'superadmin', roles: ['superadmin'], scopes: [] };

function ctx(identity, { params = {}, body = {} } = {}) {
  return {
    pool: fakePool(),
    params: { topicId: 'res_topic_aaaa', workspaceId: 'ws-a', ...params },
    query: {},
    body,
    identity,
    cors: {},
  };
}

/** Minimal fake ServerResponse capturing the status of a streamed reply. */
function fakeRes() {
  return {
    statusCode: null,
    headers: null,
    body: '',
    writeHead(code, headers) { this.statusCode = code; this.headers = headers; },
    write(chunk) { this.body += chunk; },
    end(chunk) { if (chunk) this.body += chunk; this.ended = true; },
  };
}

test('bbx-events-scope-01: eventsTopicDetail cross-tenant → 404', async () => {
  const r = await KAFKA_HANDLERS.eventsTopicDetail(ctx(IDENTITY_B));
  assert.equal(r.statusCode, 404, `got ${r.statusCode} (${JSON.stringify(r.body)})`);
  assert.ok(!r.body?.physicalTopicName, 'must not leak the physical topic name');
});

test('bbx-events-scope-02: eventsTopicMetadata cross-tenant → 404', async () => {
  const r = await KAFKA_HANDLERS.eventsTopicMetadata(ctx(IDENTITY_B));
  assert.equal(r.statusCode, 404, `got ${r.statusCode} (${JSON.stringify(r.body)})`);
});

test('bbx-events-scope-03: eventsTopicAccess cross-tenant → 404', async () => {
  const r = await KAFKA_HANDLERS.eventsTopicAccess(ctx(IDENTITY_B));
  assert.equal(r.statusCode, 404, `got ${r.statusCode} (${JSON.stringify(r.body)})`);
});

test('bbx-events-scope-04: eventsTopicPublish cross-tenant → 404 (no event injected)', async () => {
  const r = await KAFKA_HANDLERS.eventsTopicPublish(ctx(IDENTITY_B, { body: { payload: { evil: true } } }));
  assert.equal(r.statusCode, 404, `got ${r.statusCode} (${JSON.stringify(r.body)})`);
  assert.notEqual(r.statusCode, 202, 'cross-tenant publish must never be accepted');
});

test('bbx-events-scope-05: eventsTopicStream cross-tenant → 404', async () => {
  const res = fakeRes();
  const streamCtx = ctx(IDENTITY_B);
  streamCtx.sendJson = (statusCode, body, headers = {}) => {
    const payload = JSON.stringify(normalizeErrorResponse(statusCode, body, {
      resource: `/v1/events/topics/${streamCtx.params.topicId}/stream`
    }));
    res.writeHead(statusCode, { 'content-type': 'application/json', ...headers });
    res.end(payload);
  };
  await KAFKA_HANDLERS.eventsTopicStream(streamCtx, res);
  assert.equal(res.statusCode, 404, `got ${res.statusCode} (${res.body})`);
  const body = JSON.parse(res.body);
  assert.equal(body.code, 'GW_TOPIC_NOT_FOUND');
  assert.equal(body.status, 404);
  assert.equal(body.resource.path, '/v1/events/topics/{id}/stream');
  assert.doesNotMatch(JSON.stringify(body), /res_topic_aaaa|tenant-a|tenant-b/);
});

test('bbx-events-scope-06: eventsInventory cross-tenant workspace → 404', async () => {
  const r = await KAFKA_HANDLERS.eventsInventory(ctx(IDENTITY_B));
  assert.equal(r.statusCode, 404, `got ${r.statusCode} (${JSON.stringify(r.body)})`);
});

test('bbx-events-scope-07: eventsTopicAccess own-tenant → 200', async () => {
  const r = await KAFKA_HANDLERS.eventsTopicAccess(ctx(IDENTITY_A));
  assert.equal(r.statusCode, 200, `got ${r.statusCode} (${JSON.stringify(r.body)})`);
  assert.equal(r.body?.resourceId, 'res_topic_aaaa');
});

test('bbx-events-scope-08: eventsTopicAccess superadmin cross-tenant bypass → 200', async () => {
  const r = await KAFKA_HANDLERS.eventsTopicAccess(ctx(IDENTITY_SA));
  assert.equal(r.statusCode, 200, `got ${r.statusCode} (${JSON.stringify(r.body)})`);
  assert.equal(r.body?.resourceId, 'res_topic_aaaa');
});
