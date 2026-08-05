// The Mongo list route reads filter/sort/page from the QUERY STRING (a GET has no body),
// and forwards them to the Mongo executor. Pure node:http test with a capturing stub
// executor — no real Mongo. Guards the pagination/filtering wiring (#334 follow-up).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';

const registry = { withWorkspaceClient() { throw new Error('registry must not be reached'); } };

let captured;
const mongoExecutor = {
  async executeMongoData(params) {
    captured = params;
    return { items: [], page: { size: params.page?.size, returned: 0 } };
  }
};

let server;
let base;
const path = '/v1/mongo/workspaces/ws1/data/appdb/collections/notes/documents';
const headers = { 'x-tenant-id': 'ten-a', 'x-workspace-id': 'ws1' };

before(async () => {
  server = createControlPlaneServer({ registry, mongoExecutor, logger: { error() {} } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) await new Promise((r) => server.close(r)); });

test('list forwards filter + sort + page (size/after) parsed from the query string', async () => {
  captured = undefined;
  const qs = new URLSearchParams();
  qs.set('filter', JSON.stringify({ status: 'active' }));
  qs.set('sort', JSON.stringify({ created_at: -1 }));
  qs.set('page[size]', '10');
  qs.set('page[after]', 'CURSOR1');
  const res = await fetch(`${base}${path}?${qs.toString()}`, { headers });
  assert.equal(res.status, 200);
  assert.deepEqual(captured.filter, { status: 'active' });
  assert.deepEqual(captured.sort, { created_at: -1 });
  assert.deepEqual(captured.page, { size: 10, after: 'CURSOR1' });
});

test('list without query params forwards no filter/sort (undefined)', async () => {
  captured = undefined;
  const res = await fetch(`${base}${path}`, { headers });
  assert.equal(res.status, 200);
  assert.equal(captured.filter, undefined);
  assert.equal(captured.sort, undefined);
});

test('a malformed ?filter JSON → 400 INVALID_QUERY_JSON', async () => {
  const res = await fetch(`${base}${path}?filter=${encodeURIComponent('{bad')}`, { headers });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, 'GW_INVALID_QUERY_JSON');
});
