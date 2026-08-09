// The Postgres realtime route streams a tenant-scoped table change capture to the client as
// SSE, distinct from the Mongo collection route. Pure node:http test with a stub pg realtime
// executor — no Postgres. Identity/auth are enforced by the shared dispatcher.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';

const registry = { withWorkspaceClient() { throw new Error('registry must not be reached'); } };

let lastSubscribe;
let closed = false;
const pgRealtimeExecutor = {
  async subscribe(params) {
    lastSubscribe = params;
    setTimeout(() => params.onChange({ type: 'insert', documentId: 'r1', document: { id: 'r1', tenant_id: 'ten-a', body: 'hi' } }), 10);
    return { close() { closed = true; } };
  }
};

let server;
let base;
const path = '/v1/realtime/workspaces/ws1/data/appdb/schemas/public/tables/notes/changes';
const traceHeaders = {
  'x-api-version': '2026-03-26',
  'x-correlation-id': 'corr-c03-unit-pg-realtime',
};

before(async () => {
  server = createControlPlaneServer({ registry, pgRealtimeExecutor, logger: { error() {} } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) await new Promise((r) => server.close(r)); });

test('streams Postgres table changes as SSE with the table target + tenant identity', async () => {
  lastSubscribe = undefined;
  closed = false;
  const res = await fetch(`${base}${path}`, {
    headers: { ...traceHeaders, 'x-tenant-id': 'ten-a', 'x-workspace-id': 'ws1' },
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (!buffer.includes('event: insert')) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
  }
  assert.match(buffer, /event: insert/);
  assert.match(buffer, /"documentId":"r1"/);
  assert.equal(lastSubscribe.identity.tenantId, 'ten-a');
  assert.equal(lastSubscribe.schemaName, 'public');
  assert.equal(lastSubscribe.tableName, 'notes');

  await reader.cancel();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(closed, true, 'subscription closed on client disconnect');
});

test('pg realtime route requires tenant identity → 401', async () => {
  const res = await fetch(`${base}${path}`);
  assert.equal(res.status, 401);
  await res.body?.cancel?.();
});
