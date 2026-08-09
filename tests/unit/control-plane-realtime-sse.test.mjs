// The realtime route streams a tenant-scoped change stream to the client as Server-Sent
// Events: text/event-stream, one `event:`/`data:` frame per change, and it tears down the
// subscription when the client disconnects. Pure node:http test with a stub realtime
// executor — no Mongo. Auth + tenant identity are enforced by the shared dispatcher.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';

const registry = { withWorkspaceClient() { throw new Error('registry must not be reached'); } };

let lastSubscribe;
let closed = false;
const realtimeExecutor = {
  async subscribe(params) {
    lastSubscribe = params;
    // emit one change shortly after subscribe
    setTimeout(() => params.onChange({ type: 'insert', documentId: 'd1', document: { _id: 'd1', tenantId: 'ten-a', body: 'hi' } }), 10);
    return { close() { closed = true; } };
  }
};

let server;
let base;
const path = '/v1/realtime/workspaces/ws1/data/appdb/collections/notes/changes';
const traceHeaders = {
  'x-api-version': '2026-03-26',
  'x-correlation-id': 'corr-c03-unit-realtime',
};

// Stub key store so the ?apikey= (EventSource) auth path can resolve a valid anon key.
const apiKeyStore = {
  async verifyKey(key) {
    return key === 'flc_anon_good'
      ? { tenantId: 'ten-a', workspaceId: 'ws1', keyType: 'anon', roleName: 'falcone_app', dbRole: 'falcone_anon', scopes: [] }
      : undefined;
  }
};

before(async () => {
  server = createControlPlaneServer({ registry, realtimeExecutor, apiKeyStore, logger: { error() {} } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) await new Promise((r) => server.close(r)); });

test('streams change events as SSE, tenant identity passed through, and tears down on disconnect', async () => {
  lastSubscribe = undefined;
  closed = false;
  const controller = new AbortController();
  const res = await fetch(`${base}${path}`, {
    headers: { ...traceHeaders, 'x-tenant-id': 'ten-a', 'x-workspace-id': 'ws1' },
    signal: controller.signal
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);

  // read the first change frame off the stream
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (!buffer.includes('event: insert')) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
  }
  assert.match(buffer, /event: insert/);
  assert.match(buffer, /"documentId":"d1"/);

  // the subscription got the verified tenant identity
  assert.equal(lastSubscribe.identity.tenantId, 'ten-a');
  assert.equal(lastSubscribe.databaseName, 'appdb');
  assert.equal(lastSubscribe.collectionName, 'notes');

  // disconnecting aborts the subscription
  await reader.cancel();
  controller.abort();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(closed, true, 'subscription closed on client disconnect');
});

test('realtime route requires tenant identity → 401', async () => {
  const res = await fetch(`${base}${path}`);
  assert.equal(res.status, 401);
  await res.body?.cancel?.();
});

test('authenticates via ?apikey= (EventSource cannot set headers)', async () => {
  lastSubscribe = undefined;
  const res = await fetch(`${base}${path}?apikey=flc_anon_good`, { headers: traceHeaders });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
  assert.equal(lastSubscribe.identity.tenantId, 'ten-a'); // tenant from the verified key, not headers
  await res.body?.cancel?.();
});

test('an invalid ?apikey= → 401 (no stream)', async () => {
  const res = await fetch(`${base}${path}?apikey=flc_anon_bogus`, { headers: traceHeaders });
  assert.equal(res.status, 401);
  await res.body?.cancel?.();
});
