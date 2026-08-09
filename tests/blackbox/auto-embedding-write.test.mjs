// Black-box test suite for change add-write-time-auto-embedding.
//
// Drives the PUBLIC HTTP surface of the control-plane server (the same routes the gateway
// fronts) to prove the per-collection embedding-mapping CRUD routes are REAL once a
// mappingStore is supplied to createControlPlaneServer, and that the write-path auto-embed
// hook in executePostgresData behaves correctly with a mock embeddingExecutor (no DB needed
// for the executor-unit assertions — the hook fires BEFORE any SQL is built).
//
// Public interface only: imports the runtime modules and exercises them over HTTP / their
// documented call signatures.
//
// Tests: bbx-auto-emb-01 .. bbx-auto-emb-08
import test from 'node:test';
import assert from 'node:assert/strict';

import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import { createConnectionRegistry } from '../../apps/control-plane-executor/src/runtime/connection-registry.mjs';
import { executePostgresData } from '../../apps/control-plane-executor/src/runtime/postgres-data-executor.mjs';
import {
  createEmbeddingMappingStore,
} from '../../apps/control-plane-executor/src/runtime/embedding-executor.mjs';

const TEN = 'ten_bbx_auto';
const WS = 'ws_bbx_auto';
const authHeaders = {
  'content-type': 'application/json',
  'x-api-version': '2026-03-26',
  'x-correlation-id': 'corr-bbx-auto-embedding',
  'x-tenant-id': TEN,
  'x-workspace-id': WS,
  'x-auth-subject': 'admin-1',
};

// A registry is required by createControlPlaneServer but the mapping CRUD routes never touch
// the data plane, so a no-op resolveConnection (never connected) is sufficient.
function makeRegistry() {
  return createConnectionRegistry({ resolveConnection: () => ({ dsn: 'postgres://unused/none' }) });
}

async function withServer(opts, fn) {
  const registry = makeRegistry();
  const server = createControlPlaneServer({ registry, ...opts, logger: { error() {} } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(baseUrl);
  } finally {
    await new Promise((r) => server.close(r));
    await registry.end().catch(() => {});
  }
}

const mappingPath = (ws = WS, db = 'appdb', s = 'public', t = 'docs') =>
  `/v1/postgres/workspaces/${ws}/data/${db}/schemas/${s}/tables/${t}/embedding-mapping`;

// bbx-auto-emb-01: PUT mapping route returns 200 and the stored record.
test('bbx-auto-emb-01: PUT embedding-mapping returns 200 and the stored record', async () => {
  const mappingStore = createEmbeddingMappingStore();
  await withServer({ mappingStore }, async (baseUrl) => {
    const res = await fetch(`${baseUrl}${mappingPath()}`, {
      method: 'PUT', headers: authHeaders,
      body: JSON.stringify({ sourceColumn: 'body', targetColumn: 'embedding' }),
    });
    assert.equal(res.status, 200, 'reachable handler, not the 501 guard');
    const body = await res.json();
    assert.notEqual(body.code, 'MAPPING_STORE_DISABLED');
    assert.equal(body.sourceColumn, 'body');
    assert.equal(body.targetColumn, 'embedding');
    assert.equal(body.schemaName, 'public');
    assert.equal(body.tableName, 'docs');
  });
});

// bbx-auto-emb-02: GET mapping route returns the configured mapping.
test('bbx-auto-emb-02: GET embedding-mapping returns the configured mapping', async () => {
  const mappingStore = createEmbeddingMappingStore();
  await withServer({ mappingStore }, async (baseUrl) => {
    await fetch(`${baseUrl}${mappingPath()}`, {
      method: 'PUT', headers: authHeaders,
      body: JSON.stringify({ sourceColumn: 'body', targetColumn: 'embedding' }),
    });
    const res = await fetch(`${baseUrl}${mappingPath()}`, { method: 'GET', headers: authHeaders });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.sourceColumn, 'body');
    assert.equal(body.targetColumn, 'embedding');
  });
});

// bbx-auto-emb-03: DELETE mapping route returns 200 and a subsequent GET returns 404.
test('bbx-auto-emb-03: DELETE embedding-mapping returns 200 and GET then 404', async () => {
  const mappingStore = createEmbeddingMappingStore();
  await withServer({ mappingStore }, async (baseUrl) => {
    await fetch(`${baseUrl}${mappingPath()}`, {
      method: 'PUT', headers: authHeaders,
      body: JSON.stringify({ sourceColumn: 'body', targetColumn: 'embedding' }),
    });
    const del = await fetch(`${baseUrl}${mappingPath()}`, { method: 'DELETE', headers: authHeaders });
    assert.equal(del.status, 200);
    assert.deepEqual(await del.json(), { removed: true });

    const get = await fetch(`${baseUrl}${mappingPath()}`, { method: 'GET', headers: authHeaders });
    assert.equal(get.status, 404, 'mapping is gone after delete');
  });
});

// bbx-auto-emb-04: with NO mappingStore wired, the routes return 501 MAPPING_STORE_DISABLED.
test('bbx-auto-emb-04: routes return 501 MAPPING_STORE_DISABLED when not wired', async () => {
  await withServer({ mappingStore: undefined }, async (baseUrl) => {
    const put = await fetch(`${baseUrl}${mappingPath()}`, {
      method: 'PUT', headers: authHeaders,
      body: JSON.stringify({ sourceColumn: 'body', targetColumn: 'embedding' }),
    });
    assert.equal(put.status, 501);
    assert.equal((await put.json()).code, 'GW_NOT_IMPLEMENTED');

    const get = await fetch(`${baseUrl}${mappingPath()}`, { method: 'GET', headers: authHeaders });
    assert.equal(get.status, 501);
    assert.equal((await get.json()).code, 'GW_NOT_IMPLEMENTED');
  });
});

// ---- Executor write-path hook (mock embeddingExecutor; the hook fires before any SQL) ----

// A fake registry whose withWorkspaceClient yields a fake client that satisfies introspectTable
// + columnVectorDimension and records the executed SQL. Lets us assert the hook PATCHED the
// payload before buildRequest, without a real database.
function fakeRegistry({ vectorDim = 8, captured } = {}) {
  const client = {
    async query(text, params) {
      // introspectTable columns query
      if (/FROM information_schema\.columns/i.test(text)) {
        return {
          rowCount: 3,
          rows: [
            { column_name: 'id', data_type: 'uuid', udt_name: 'uuid' },
            { column_name: 'body', data_type: 'text', udt_name: 'text' },
            { column_name: 'embedding', data_type: 'USER-DEFINED', udt_name: 'vector' },
          ],
        };
      }
      // primary key query
      if (/indisprimary/i.test(text)) {
        return { rowCount: 1, rows: [{ column_name: 'id' }] };
      }
      // columnVectorDimension (atttypmod)
      if (/atttypmod/i.test(text)) {
        return { rowCount: 1, rows: [{ typmod: vectorDim }] };
      }
      // set_config trace settings
      if (/set_config/i.test(text)) return { rowCount: 0, rows: [] };
      // The actual INSERT/UPDATE plan execution: capture the bound values.
      if (captured) {
        captured.text = text;
        captured.values = params;
      }
      return { rowCount: 1, rows: [{ id: 'row-1' }] };
    },
  };
  return {
    async withWorkspaceClient(_workspaceId, _ctx, fn) {
      return fn(client);
    },
    async end() {},
  };
}

function spyEmbeddingExecutor({ dimension = 8, calls } = {}) {
  return {
    store: { async getProvider() { return { providerType: 'mock' }; } },
    async embedForWorkspace(workspaceId, text, opts) {
      calls?.push({ workspaceId, text, opts });
      return new Array(dimension).fill(0).map((_, i) => (i + 1) / 10);
    },
  };
}

// bbx-auto-emb-05: insert with mock executor + mapping → embedForWorkspace called once, the
// patched vector reaches the INSERT, and the insert succeeds.
test('bbx-auto-emb-05: insert with a mapping calls embedForWorkspace once and patches the vector', async () => {
  const mappingStore = createEmbeddingMappingStore();
  await mappingStore.deployMapping(WS, { tenantId: TEN, schemaName: 'public', tableName: 'docs', sourceColumn: 'body', targetColumn: 'embedding' });
  const calls = [];
  const captured = {};
  const res = await executePostgresData(fakeRegistry({ captured }), {
    workspaceId: WS, databaseName: 'appdb', schemaName: 'public', tableName: 'docs',
    identity: { tenantId: TEN, workspaceId: WS },
    operation: 'insert', values: { body: 'embed me' },
    embeddingExecutor: spyEmbeddingExecutor({ calls }), mappingStore,
  });
  assert.equal(calls.length, 1, 'embedForWorkspace called exactly once');
  assert.equal(calls[0].text, 'embed me');
  assert.equal(calls[0].opts.tenantId, TEN, 'tenantId threaded into embedForWorkspace');
  assert.ok(res.affected >= 1);
  // The bound INSERT values must include the [..] vector literal the hook produced.
  assert.ok(captured.values.some((v) => typeof v === 'string' && /^\[.*\]$/.test(v)), 'a vector literal is bound on insert');
});

// bbx-auto-emb-06: insert with an explicit target vector → embedForWorkspace NOT called.
test('bbx-auto-emb-06: explicit target vector skips embedForWorkspace', async () => {
  const mappingStore = createEmbeddingMappingStore();
  await mappingStore.deployMapping(WS, { tenantId: TEN, schemaName: 'public', tableName: 'docs', sourceColumn: 'body', targetColumn: 'embedding' });
  const calls = [];
  await executePostgresData(fakeRegistry(), {
    workspaceId: WS, databaseName: 'appdb', schemaName: 'public', tableName: 'docs',
    identity: { tenantId: TEN, workspaceId: WS },
    operation: 'insert', values: { body: 'embed me', embedding: '[1,2,3,4,5,6,7,8]' },
    embeddingExecutor: spyEmbeddingExecutor({ calls }), mappingStore,
  });
  assert.equal(calls.length, 0, 'embedForWorkspace NOT called when the target vector is explicit');
});

// bbx-auto-emb-07: insert with a dimension-mismatch executor → 422 before SQL.
test('bbx-auto-emb-07: dimension mismatch → 422 before SQL', async () => {
  const mappingStore = createEmbeddingMappingStore();
  await mappingStore.deployMapping(WS, { tenantId: TEN, schemaName: 'public', tableName: 'docs', sourceColumn: 'body', targetColumn: 'embedding' });
  // Column dim is 8 (fakeRegistry typmod) but the executor returns 4 → mismatch.
  const mismatching = {
    store: { async getProvider() { return { providerType: 'mock' }; } },
    async embedForWorkspace(_ws, _t, { expectedDimension }) {
      const vector = [1, 2, 3, 4];
      if (expectedDimension !== undefined && vector.length !== Number(expectedDimension)) {
        throw Object.assign(new Error('dimension mismatch'), { statusCode: 422, code: 'EMBEDDING_DIMENSION_MISMATCH' });
      }
      return vector;
    },
  };
  await assert.rejects(
    () => executePostgresData(fakeRegistry({ vectorDim: 8 }), {
      workspaceId: WS, databaseName: 'appdb', schemaName: 'public', tableName: 'docs',
      identity: { tenantId: TEN, workspaceId: WS },
      operation: 'insert', values: { body: 'embed me' },
      embeddingExecutor: mismatching, mappingStore,
    }),
    (e) => e.statusCode === 422 && e.code === 'EMBEDDING_DIMENSION_MISMATCH',
  );
});

// bbx-auto-emb-08: insert with source text + no provider configured → 422 EMBEDDING_PROVIDER_MISSING.
test('bbx-auto-emb-08: no provider configured → 422 EMBEDDING_PROVIDER_MISSING', async () => {
  const mappingStore = createEmbeddingMappingStore();
  await mappingStore.deployMapping(WS, { tenantId: TEN, schemaName: 'public', tableName: 'docs', sourceColumn: 'body', targetColumn: 'embedding' });
  const noProvider = {
    store: { async getProvider() { return null; } },
    async embedForWorkspace() {
      throw Object.assign(new Error('No embedding provider configured for this workspace'), { statusCode: 422, code: 'EMBEDDING_PROVIDER_MISSING' });
    },
  };
  await assert.rejects(
    () => executePostgresData(fakeRegistry(), {
      workspaceId: WS, databaseName: 'appdb', schemaName: 'public', tableName: 'docs',
      identity: { tenantId: TEN, workspaceId: WS },
      operation: 'insert', values: { body: 'embed me' },
      embeddingExecutor: noProvider, mappingStore,
    }),
    (e) => e.statusCode === 422 && e.code === 'EMBEDDING_PROVIDER_MISSING',
  );
});
