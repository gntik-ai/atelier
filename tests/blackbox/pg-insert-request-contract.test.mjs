// Black-box tests for change fix-pg-insert-request-contract (#571).
//
// The OpenAPI PostgresDataInsertRequest documents the body `{ "row": { ... } }`, but the
// executor's POST .../rows route only unwrapped `body.values` (else treated the whole body as
// the column map). So the documented `{row:{...}}` body was interpreted as a column named
// `row` → 400 PLAN_REJECTED "Unknown column row".
//
// These tests drive the PUBLIC HTTP surface of createControlPlaneServer with a capturing fake
// registry (answers introspectTable, records the bound INSERT values — no real DB needed) and
// prove that:
//   - the documented `{row:{...}}` body inserts the row (the fix),
//   - the legacy `{values:{...}}` body still inserts (regression),
//   - a bare top-level column map still inserts (lenient back-compat),
//   - an unknown column inside `row` is still rejected with a 4xx (column validation intact).
//
// bbx-pg-insert-01 .. bbx-pg-insert-04
import test from 'node:test';
import assert from 'node:assert/strict';

import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';

const TEN = 'ten_pg_insert';
const WS = 'ws_pg_insert';
const ROWS_PATH = `/v1/postgres/workspaces/${WS}/data/appdb/schemas/public/tables/docs/rows`;

// Minimal in-memory API key store: issues one service key (data:write) bound to WS.
function makeApiKeyStore() {
  const store = new Map();
  return {
    async ensureSchema() {},
    async issueKey({ tenantId, workspaceId, keyType }) {
      const key = `flc_${keyType}_test_${tenantId}_${workspaceId}`;
      store.set(key, {
        tenantId, workspaceId, keyType,
        scopes: ['data:read', 'data:write', 'ddl:write'],
        dbRole: `falcone_${keyType}`, roleName: `falcone_${keyType}`,
      });
      return { id: `id_${key}`, key, prefix: key.slice(0, 16), keyType, scopes: [], createdAt: new Date() };
    },
    async verifyKey(presentedKey) { return store.get(presentedKey) ?? null; },
    async listKeys() { return []; },
    async revokeKey() { return { revoked: true }; },
    async rotateKey() { return {}; },
  };
}

// Fake registry whose withWorkspaceClient yields a client that satisfies introspectTable for a
// (id, body) table and captures the bound INSERT values. No real database.
function fakeRegistry({ captured } = {}) {
  const client = {
    async query(text, params) {
      if (/FROM information_schema\.columns/i.test(text)) {
        return {
          rowCount: 2,
          rows: [
            { column_name: 'id', data_type: 'uuid', udt_name: 'uuid' },
            { column_name: 'body', data_type: 'text', udt_name: 'text' },
          ],
        };
      }
      if (/indisprimary/i.test(text)) return { rowCount: 1, rows: [{ column_name: 'id' }] };
      if (/set_config/i.test(text)) return { rowCount: 0, rows: [] };
      if (captured) { captured.text = text; captured.values = params; }
      return { rowCount: 1, rows: [{ id: 'row-1', body: params?.[0] }] };
    },
  };
  return {
    async withWorkspaceClient(_workspaceId, _ctx, fn) { return fn(client); },
    async end() {},
  };
}

async function withServer({ captured } = {}, fn) {
  const apiKeyStore = makeApiKeyStore();
  const { key } = await apiKeyStore.issueKey({ tenantId: TEN, workspaceId: WS, keyType: 'service' });
  const server = createControlPlaneServer({
    registry: fakeRegistry({ captured }), apiKeyStore, logger: { error() {} },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(baseUrl, key);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

function postRows(baseUrl, key, body) {
  return fetch(`${baseUrl}${ROWS_PATH}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      'x-api-version': '2026-03-26',
      'x-correlation-id': 'corr-bbx-pg-insert',
    },
    body: JSON.stringify(body),
  });
}

// bbx-pg-insert-01: the documented `{row:{...}}` body inserts the row (the fix).
test('bbx-pg-insert-01: documented {row:{...}} body inserts the row', async () => {
  const captured = {};
  await withServer({ captured }, async (baseUrl, key) => {
    const res = await postRows(baseUrl, key, { row: { body: 'hello' } });
    assert.equal(res.status, 201, `documented body should insert (got ${res.status}: ${await res.clone().text()})`);
    assert.ok(captured.values?.includes('hello'), 'the row value must be bound on the INSERT');
  });
});

// bbx-pg-insert-02: legacy `{values:{...}}` body still inserts (regression).
test('bbx-pg-insert-02: legacy {values:{...}} body still inserts', async () => {
  const captured = {};
  await withServer({ captured }, async (baseUrl, key) => {
    const res = await postRows(baseUrl, key, { values: { body: 'legacy' } });
    assert.equal(res.status, 201, `legacy body should still insert (got ${res.status})`);
    assert.ok(captured.values?.includes('legacy'));
  });
});

// bbx-pg-insert-03: a bare top-level column map still inserts (lenient back-compat).
test('bbx-pg-insert-03: bare top-level column map still inserts', async () => {
  const captured = {};
  await withServer({ captured }, async (baseUrl, key) => {
    const res = await postRows(baseUrl, key, { body: 'bare' });
    assert.equal(res.status, 201, `bare body should still insert (got ${res.status})`);
    assert.ok(captured.values?.includes('bare'));
  });
});

// bbx-pg-insert-04: an unknown column inside `row` is still rejected (validation intact, not 500).
test('bbx-pg-insert-04: unknown column inside {row} is rejected with a 4xx', async () => {
  await withServer({}, async (baseUrl, key) => {
    const res = await postRows(baseUrl, key, { row: { nope: 'x' } });
    assert.ok(res.status >= 400 && res.status < 500, `unknown column should be a 4xx (got ${res.status})`);
  });
});
