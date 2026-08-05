// add-data-export-import-clone (#683): Falcone advertised 15 export/import/clone routes but the
// runtime served none of the data ones (404 NO_ROUTE) and the 2 audit-export routes were 202 no-ops.
// This suite drives the PUBLIC runtime (routes.mjs route table + the per-family LOCAL handlers) for
// every family and encodes the issue's two acceptance scenarios:
//   Scenario 1 (served + performs the operation in scope): an authenticated OWNER calling any
//     advertised route is HANDLED (not 404 NO_ROUTE) and export -> import round-trips with fidelity.
//   Scenario 2 (cross-scope import denied): an import/clone/export targeting a workspace/tenant the
//     caller does NOT own is denied BEFORE any backend call, with no data crossing the boundary.
//
// Pattern (mirrors storage-object-io-completeness / pg-browse-tenant-scope / workspace-environment-
// promotion): a fake S3 fetch seam, an in-memory mock pool, an injected mongo/pg client seam, and a
// ctx builder. A fake backend proves the HANDLER LOGIC, WIRING, and ISOLATION — the live checker
// proves real SeaweedFS/FerretDB/Postgres behavior.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { routes } from '../../apps/control-plane/routes.mjs';
import { STORAGE_HANDLERS } from '../../apps/control-plane/storage-handlers.mjs';
import { MONGO_HANDLERS } from '../../apps/control-plane/mongo-handlers.mjs';
import { PG_HANDLERS, quoteIdent } from '../../apps/control-plane/pg-handlers.mjs';
import { FN_HANDLERS } from '../../apps/control-plane/fn-handlers.mjs';
import { METRICS_HANDLERS } from '../../apps/control-plane/metrics-handlers.mjs';
import { LOCAL_HANDLERS } from '../../apps/control-plane/b-handlers.mjs';
import { buildTenantConfigExport, stripSensitive } from '../../apps/control-plane/tenant-config-export.mjs';

// ---------------------------------------------------------------------------
// Fixtures: two tenants A/B with one workspace each + one owned bucket each.
// ---------------------------------------------------------------------------
const TENANT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const WS_A = 'ws-aaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const WS_B = 'ws-bbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const BUCKET_A = 'ws-abc123def456-assets';
const BUCKET_B = 'ws-zzz999yyy888-assets';
const DB_A = 'wsdb_a_app_dev';
const DB_B = 'wsdb_b_app_dev';

const ownerA = { sub: 'user-a', tenantId: TENANT_A, workspaceId: WS_A, actorType: 'tenant_owner' };
const ownerB = { sub: 'user-b', tenantId: TENANT_B, workspaceId: WS_B, actorType: 'tenant_owner' };

const BUCKET_ROWS = {
  [BUCKET_A]: { id: 'id-a', workspace_id: WS_A, tenant_id: TENANT_A, bucket_name: BUCKET_A, region: 'us-east-1', created_at: '2026-01-01T00:00:00Z' },
  [BUCKET_B]: { id: 'id-b', workspace_id: WS_B, tenant_id: TENANT_B, bucket_name: BUCKET_B, region: 'us-east-1', created_at: '2026-01-01T00:00:00Z' }
};
const WORKSPACE_ROWS = {
  [WS_A]: { id: WS_A, tenant_id: TENANT_A, slug: 'app-a', display_name: 'App A', status: 'active', environment: 'dev' },
  [WS_B]: { id: WS_B, tenant_id: TENANT_B, slug: 'app-b', display_name: 'App B', status: 'active', environment: 'dev' }
};
const DB_ROWS = {
  [DB_A]: { database_name: DB_A, workspace_id: WS_A, tenant_id: TENANT_A },
  [DB_B]: { database_name: DB_B, workspace_id: WS_B, tenant_id: TENANT_B }
};

// In-memory pool answering the small set of queries the handlers issue.
function makePool({ buckets = { ...BUCKET_ROWS }, workspaces = { ...WORKSPACE_ROWS }, databases = { ...DB_ROWS }, fnActions = {} } = {}) {
  const inserts = [];
  return {
    inserts,
    query(sql, params = []) {
      const s = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if (s.includes('from workspace_buckets') && s.includes('where bucket_name')) {
        return Promise.resolve({ rows: buckets[params[0]] ? [buckets[params[0]]] : [] });
      }
      if (s.includes('from workspace_buckets') && s.includes('where workspace_id')) {
        return Promise.resolve({ rows: Object.values(buckets).filter((r) => r.workspace_id === params[0]) });
      }
      if (s.startsWith('select') && s.includes('from workspaces') && s.includes('where id = $1 or slug')) {
        const w = workspaces[params[0]] ?? Object.values(workspaces).find((x) => x.slug === params[0]);
        return Promise.resolve({ rows: w ? [w] : [] });
      }
      if (s.includes('from workspace_databases') && (s.includes('database_name, workspace_id') || s.includes('select database_name'))) {
        return Promise.resolve({ rows: Object.values(databases) });
      }
      if (s.includes('from fn_actions') && s.includes('resource_id=$1') && s.includes('tenant_id=$2')) {
        const r = fnActions[params[0]];
        return Promise.resolve({ rows: r && r.tenant_id === params[1] ? [r] : [] });
      }
      if (s.includes('from fn_actions') && s.includes('resource_id=$1')) {
        const r = fnActions[params[0]];
        return Promise.resolve({ rows: r ? [r] : [] });
      }
      if (s.includes('from fn_actions') && s.includes('where workspace_id=$1')) {
        return Promise.resolve({ rows: Object.values(fnActions).filter((r) => r.workspace_id === params[0]) });
      }
      if (s.startsWith('insert into fn_actions')) {
        const rec = { resource_id: params[0], workspace_id: params[1], tenant_id: params[2], action_name: params[3], runtime: params[4], entrypoint: params[5], source_code: params[6], version: 1 };
        fnActions[rec.resource_id] = rec; inserts.push({ table: 'fn_actions', rec });
        return Promise.resolve({ rows: [rec] });
      }
      return Promise.resolve({ rows: [] });
    }
  };
}

// Fake S3 backend over globalThis.fetch keyed by an in-memory object map per call set.
function withS3(store, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(String(url));
    const method = (opts.method ?? 'GET').toUpperCase();
    calls.push({ method, path: u.pathname, query: u.search });
    // List: GET /<bucket>?list-type=2
    if (method === 'GET' && u.searchParams.get('list-type') === '2') {
      const bucket = u.pathname.split('/')[1];
      const keys = Object.keys(store).filter((k) => k.startsWith(`${bucket}/`)).map((k) => k.slice(bucket.length + 1));
      const xml = `<?xml version="1.0"?><ListBucketResult>${keys.map((k) => `<Contents><Key>${k}</Key><Size>${store[`${bucket}/${k}`].body.length}</Size><ETag>&#34;e&#34;</ETag><LastModified>2026-01-01T00:00:00Z</LastModified><StorageClass>STANDARD</StorageClass></Contents>`).join('')}<IsTruncated>false</IsTruncated></ListBucketResult>`;
      return s3Res({ status: 200, body: xml });
    }
    const key = u.pathname.slice(1); // bucket/key
    if (method === 'PUT') { store[key] = { body: Buffer.from(opts.body ?? ''), contentType: (opts.headers?.['content-type']) ?? 'application/octet-stream' }; return s3Res({ status: 200, headers: { etag: '"e"' } }); }
    if (method === 'GET') {
      const obj = store[key];
      if (!obj) return s3Res({ status: 404, body: '<Error><Code>NoSuchKey</Code></Error>' });
      return s3Res({ status: 200, headers: { 'content-type': obj.contentType, 'content-length': String(obj.body.length) }, body: obj.body });
    }
    if (method === 'HEAD') { const obj = store[key]; return obj ? s3Res({ status: 200, headers: { 'content-type': obj.contentType, 'content-length': String(obj.body.length) } }) : s3Res({ status: 404 }); }
    if (method === 'DELETE') { delete store[key]; return s3Res({ status: 204 }); }
    return s3Res({ status: 200 });
  };
  globalThis.fetch.calls = calls;
  return Promise.resolve().then(() => fn(calls)).finally(() => { globalThis.fetch = original; });
}
function s3Res({ status = 200, headers = {}, body = '' } = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  return {
    ok: status >= 200 && status < 300, status,
    headers: new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    text: async () => buf.toString('utf8')
  };
}

const ctx = (params, { identity = ownerA, body = {}, pool, query = {}, ...rest } = {}) => ({ params, body, identity, pool, query, callerContext: { correlationId: 'c1' }, ...rest });

// ===========================================================================
// Wiring: all 15 advertised routes are SERVED (not NO_ROUTE) with a handler
// ===========================================================================
const FAMILY_ROUTES = [
  ['GET', '/v1/functions/actions/{resourceId}/definition-export', 'fnDefinitionExport'],
  ['POST', '/v1/functions/workspaces/{workspaceId}/definition-imports', 'fnDefinitionImport'],
  ['POST', '/v1/functions/workspaces/{workspaceId}/package-definition-imports', 'fnPackageDefinitionImport'],
  ['GET', '/v1/functions/workspaces/{workspaceId}/packages/{packageName}/definition-export', 'fnPackageDefinitionExport'],
  ['POST', '/v1/metrics/tenants/{tenantId}/audit-exports', 'metricsTenantAuditExport'],
  ['POST', '/v1/metrics/workspaces/{workspaceId}/audit-exports', 'metricsWorkspaceAuditExport'],
  ['POST', '/v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/exports', 'mongoDataExport'],
  ['POST', '/v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/imports', 'mongoDataImport'],
  ['POST', '/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/exports', 'pgDataExport'],
  ['POST', '/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/imports', 'pgDataImport'],
  ['POST', '/v1/storage/workspaces/{workspaceId}/buckets/{bucketId}/exports', 'storageBucketExport'],
  ['GET', '/v1/storage/workspaces/{workspaceId}/buckets/{bucketId}/exports/{manifestId}', 'storageBucketExportManifestGet'],
  ['POST', '/v1/storage/workspaces/{workspaceId}/buckets/{bucketId}/imports', 'storageBucketImport'],
  ['POST', '/v1/tenants/{tenantId}/exports', 'exportTenantConfiguration'],
  ['POST', '/v1/workspaces/{workspaceId}/clone', 'cloneWorkspace']
];

test('bbx-683-wiring: all 15 advertised export/import/clone routes are registered, authed, and have a handler (not NO_ROUTE)', () => {
  for (const [method, path, handler] of FAMILY_ROUTES) {
    const route = routes.find((r) => r.method === method && r.path === path);
    assert.ok(route, `${method} ${path} is registered (not NO_ROUTE)`);
    assert.equal(route.localHandler, handler, `${method} ${path} maps to ${handler}`);
    assert.equal(route.auth, 'authenticated', `${method} ${path} requires auth`);
    assert.equal(typeof LOCAL_HANDLERS[handler], 'function', `${handler} resolves in LOCAL_HANDLERS`);
  }
});

test('bbx-683-catalog: the published catalog advertises all 15 operations (the contract was already there)', () => {
  const cat = JSON.parse(readFileSync(fileURLToPath(new URL('../../packages/internal-contracts/src/public-route-catalog.json', import.meta.url)), 'utf8'));
  const routesArr = Array.isArray(cat) ? cat : (cat.routes ?? cat.operations ?? []);
  const ids = ['exportFunctionDefinition', 'importFunctionDefinition', 'importFunctionPackageDefinition', 'exportFunctionPackageDefinition',
    'exportTenantAuditRecords', 'exportWorkspaceAuditRecords', 'exportMongoDataDocuments', 'importMongoDataDocuments',
    'exportPostgresDataRows', 'importPostgresDataRows', 'exportStorageBucketObjects', 'getStorageBucketExportManifest',
    'importStorageBucketObjects', 'exportTenantConfiguration', 'cloneWorkspace'];
  for (const id of ids) {
    assert.ok(routesArr.find((r) => (r.operationId ?? r.operation_id) === id), `catalog advertises ${id}`);
  }
});

// ===========================================================================
// STORAGE family
// ===========================================================================
test('bbx-683-storage-roundtrip: export -> import round-trips objects with byte fidelity (owner)', async () => {
  const srcStore = { [`${BUCKET_A}/a.txt`]: { body: Buffer.from('HELLO-A'), contentType: 'text/plain' }, [`${BUCKET_A}/b.bin`]: { body: Buffer.from([0, 1, 2, 255]), contentType: 'application/octet-stream' } };
  let manifest;
  await withS3(srcStore, async () => {
    const res = await STORAGE_HANDLERS.storageBucketExport(ctx({ workspaceId: WS_A, bucketId: BUCKET_A }, { pool: makePool() }));
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    manifest = res.body;
    assert.equal(manifest.entityType, 'storage_export_manifest');
    assert.equal(manifest.totalObjects, 2);
    assert.equal(manifest.sourceTenantId, TENANT_A);
    // a reserved manifest object was persisted to the bucket
    assert.ok(Object.keys(srcStore).some((k) => k.includes('.falcone/exports/')), 'manifest persisted as a reserved object');
    // and the persisted manifest is readable back via GET
    const got = await STORAGE_HANDLERS.storageBucketExportManifestGet(ctx({ workspaceId: WS_A, bucketId: BUCKET_A, manifestId: manifest.manifestId }, { pool: makePool() }));
    assert.equal(got.statusCode, 200);
    assert.equal(got.body.manifestId, manifest.manifestId);
  });
  // Import the manifest into the SAME-owner target bucket; objects round-trip byte-identically.
  const dstStore = {};
  await withS3(dstStore, async () => {
    const res = await STORAGE_HANDLERS.storageBucketImport(ctx({ workspaceId: WS_A, bucketId: BUCKET_A }, { pool: makePool(), body: { manifest } }));
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.importedCount, 2);
    assert.equal(res.body.failedCount, 0);
    assert.deepEqual(dstStore[`${BUCKET_A}/a.txt`].body, Buffer.from('HELLO-A'));
    assert.deepEqual(dstStore[`${BUCKET_A}/b.bin`].body, Buffer.from([0, 1, 2, 255]));
  });
});

test('bbx-683-storage-idor: cross-tenant export/import/manifest is 404 BEFORE any S3 call (Scenario 2)', async () => {
  for (const handler of ['storageBucketExport', 'storageBucketImport', 'storageBucketExportManifestGet']) {
    let fetched = false;
    await withS3({}, async () => {
      globalThis.fetch = new Proxy(globalThis.fetch, { apply: (t, th, a) => { fetched = true; return Reflect.apply(t, th, a); } });
      const res = await STORAGE_HANDLERS[handler](ctx({ workspaceId: WS_A, bucketId: BUCKET_A, manifestId: 'smf_000000000000000000' }, { identity: ownerB, pool: makePool(), body: { manifest: { formatVersion: 1, entries: [] } } }));
      assert.equal(res.statusCode, 404, `${handler} cross-tenant must 404`);
      assert.equal(res.body.code, 'BUCKET_NOT_FOUND');
    });
    assert.equal(fetched, false, `${handler}: ownership gate must run before any S3 call`);
  }
});

test('bbx-683-storage-import-guard: a cross-tenant manifest entry is rejected per-entry (no write)', async () => {
  const dstStore = {};
  await withS3(dstStore, async () => {
    const manifest = { formatVersion: 1, entries: [
      // a path-traversal key, a protected reserved key, and a foreign-tenant body
      { objectKey: '../escape', bodyReference: { encoding: 'base64', inlineBase64: Buffer.from('x').toString('base64') } },
      { objectKey: '.falcone/exports/evil.json', bodyReference: { encoding: 'base64', inlineBase64: Buffer.from('x').toString('base64') } },
      { objectKey: 'ok.txt', bodyReference: { tenantId: TENANT_B, encoding: 'base64', inlineBase64: Buffer.from('x').toString('base64') } }
    ] };
    const res = await STORAGE_HANDLERS.storageBucketImport(ctx({ workspaceId: WS_A, bucketId: BUCKET_A }, { pool: makePool(), body: { manifest } }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.importedCount, 0, 'no malicious entry is imported');
    assert.equal(res.body.failedCount, 3);
    const reasons = res.body.outcomes.map((o) => o.reason);
    assert.ok(reasons.includes('INVALID_OBJECT_KEY'));
    assert.ok(reasons.includes('OBJECT_PROTECTED'));
    assert.ok(reasons.includes('CROSS_TENANT_VIOLATION'));
    assert.equal(Object.keys(dstStore).length, 0, 'nothing was written to the backend');
  });
});

test('bbx-683-storage-conflict-policy: skip and fail both leave an existing object untouched (never overwrite)', async () => {
  const manifest = { formatVersion: 1, entries: [
    { objectKey: 'existing.txt', bodyReference: { encoding: 'base64', inlineBase64: Buffer.from('NEW-CONTENT').toString('base64') } },
    { objectKey: 'fresh.txt', bodyReference: { encoding: 'base64', inlineBase64: Buffer.from('FRESH').toString('base64') } }
  ] };
  // skip -> conflicting entry reported as 'skipped'; fail -> reported as 'failed'. Neither overwrites.
  for (const [policy, conflictStatus] of [['skip', 'skipped'], ['fail', 'failed']]) {
    const store = { [`${BUCKET_A}/existing.txt`]: { body: Buffer.from('ORIGINAL'), contentType: 'text/plain' } };
    await withS3(store, async () => {
      const res = await STORAGE_HANDLERS.storageBucketImport(ctx({ workspaceId: WS_A, bucketId: BUCKET_A }, { pool: makePool(), body: { manifest, conflictPolicy: policy } }));
      assert.equal(res.statusCode, 200, JSON.stringify(res.body));
      const byKey = Object.fromEntries(res.body.outcomes.map((o) => [o.objectKey, o]));
      assert.deepEqual(store[`${BUCKET_A}/existing.txt`].body, Buffer.from('ORIGINAL'), `${policy}: existing object must NOT be overwritten`);
      assert.equal(byKey['existing.txt'].status, conflictStatus, `${policy}: conflicting entry status`);
      assert.equal(byKey['existing.txt'].reason, 'OBJECT_EXISTS', `${policy}: conflicting entry reason`);
      assert.equal(byKey['fresh.txt'].status, 'imported', `${policy}: non-conflicting entry still imports`);
      assert.deepEqual(store[`${BUCKET_A}/fresh.txt`].body, Buffer.from('FRESH'));
      assert.equal(res.body.importedCount, 1);
    });
  }
});

// ===========================================================================
// MONGO family (injected client seam)
// ===========================================================================
function makeMongoClient(collections = {}) {
  // collections keyed by `${db}.${col}` -> array of docs
  const inserted = [];
  const client = {
    db: (dbName) => ({
      collection: (colName) => ({
        find: (filter) => ({
          limit: () => ({
            toArray: async () => (collections[`${dbName}.${colName}`] ?? []).filter((d) =>
              (!filter.tenantId || d.tenantId === filter.tenantId) && (!filter.workspaceId || d.workspaceId === filter.workspaceId))
          })
        }),
        insertOne: async (doc) => { inserted.push({ db: dbName, col: colName, doc }); (collections[`${dbName}.${colName}`] ??= []).push(doc); return { insertedId: 'x' }; }
      })
    })
  };
  client.inserted = inserted;
  return client;
}

test('bbx-683-mongo-roundtrip: export reads only the workspace scope; import re-stamps the verified scope', async () => {
  const mongoClient = makeMongoClient({
    'appdb.users': [
      { _id: '1', tenantId: TENANT_A, workspaceId: WS_A, name: 'alice' },
      { _id: '2', tenantId: TENANT_A, workspaceId: 'ws-other', name: 'sibling-ws' }, // different workspace
      { _id: '3', tenantId: TENANT_B, workspaceId: WS_B, name: 'other-tenant' }
    ]
  });
  const exp = await MONGO_HANDLERS.mongoDataExport(ctx({ workspaceId: WS_A, databaseName: 'appdb', collectionName: 'users' }, { pool: makePool(), mongoClient }));
  assert.equal(exp.statusCode, 200, JSON.stringify(exp.body));
  assert.equal(exp.body.documentCount, 1, 'only the caller-workspace document is exported');
  assert.equal(exp.body.documents[0].name, 'alice');
  assert.ok(!('tenantId' in exp.body.documents[0]) && !('_id' in exp.body.documents[0]), 'scope + _id stripped from the export');

  // Import a doc carrying a FORGED foreign scope — it must be re-stamped to the caller's scope.
  const imp = await MONGO_HANDLERS.mongoDataImport(ctx({ workspaceId: WS_A, databaseName: 'appdb', collectionName: 'users' }, { pool: makePool(), mongoClient, body: { documents: [{ name: 'bob', tenantId: TENANT_B, workspaceId: WS_B, _id: 'forged' }] } }));
  assert.equal(imp.statusCode, 200, JSON.stringify(imp.body));
  assert.equal(imp.body.importedCount, 1);
  const stamped = mongoClient.inserted.find((i) => i.doc.name === 'bob').doc;
  assert.equal(stamped.tenantId, TENANT_A, 'import stamps the VERIFIED tenant, never the body tenant');
  assert.equal(stamped.workspaceId, WS_A, 'import stamps the VERIFIED workspace');
  assert.ok(!('_id' in stamped), 'forged _id dropped');
});

test('bbx-683-mongo-idor: cross-tenant export/import is 404 BEFORE touching the document store (Scenario 2)', async () => {
  const mongoClient = makeMongoClient({ 'appdb.users': [{ _id: '1', tenantId: TENANT_A, workspaceId: WS_A }] });
  let touched = false;
  const spyClient = { db: () => { touched = true; return mongoClient.db('x'); } };
  for (const [handler, body] of [['mongoDataExport', {}], ['mongoDataImport', { documents: [{ x: 1 }] }]]) {
    const res = await MONGO_HANDLERS[handler](ctx({ workspaceId: WS_A, databaseName: 'appdb', collectionName: 'users' }, { identity: ownerB, pool: makePool(), mongoClient: spyClient, body }));
    assert.equal(res.statusCode, 404, `${handler} cross-tenant must 404`);
    assert.equal(res.body.code, 'WORKSPACE_NOT_FOUND');
  }
  assert.equal(touched, false, 'the workspace-ownership gate runs before any mongo call');
});

// ===========================================================================
// POSTGRES family (injected client seam + identifier guard)
// ===========================================================================
function makePgClient({ table = 'people', schema = 'public', columns = ['id', 'name'], rows = [] } = {}) {
  const inserted = [];
  const client = {
    query: async (sql, params = []) => {
      const s = sql.replace(/\s+/g, ' ').toLowerCase();
      if (s.includes('information_schema.tables')) return { rows: (params[0] === schema && params[1] === table) ? [{ table_name: table }] : [] };
      if (s.includes('information_schema.columns')) return { rows: (params[0] === schema && params[1] === table) ? columns.map((c) => ({ column_name: c })) : [] };
      if (s.startsWith('select * from')) return { rows };
      if (s.startsWith('insert into')) { inserted.push({ sql, params }); return { rows: [] }; }
      return { rows: [] };
    }
  };
  client.inserted = inserted;
  return client;
}

test('bbx-683-pg-roundtrip: export returns rows; import inserts only known columns with bound values', async () => {
  const pgClient = makePgClient({ rows: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }] });
  const exp = await PG_HANDLERS.pgDataExport(ctx({ workspaceId: WS_A, databaseName: DB_A, schemaName: 'public', tableName: 'people' }, { pool: makePool(), pgClient }));
  assert.equal(exp.statusCode, 200, JSON.stringify(exp.body));
  assert.equal(exp.body.rowCount, 2);
  assert.deepEqual(exp.body.columns, ['id', 'name']);

  // Import: an UNKNOWN column ("evil") is dropped; values are bound as parameters.
  const imp = await PG_HANDLERS.pgDataImport(ctx({ workspaceId: WS_A, databaseName: DB_A, schemaName: 'public', tableName: 'people' }, { pool: makePool(), pgClient, body: { rows: [{ id: 3, name: 'c', evil: 'DROP TABLE' }] } }));
  assert.equal(imp.statusCode, 200, JSON.stringify(imp.body));
  assert.equal(imp.body.importedCount, 1);
  const insert = pgClient.inserted[0];
  assert.ok(/INSERT INTO "public"\."people" \("id", "name"\) VALUES \(\$1, \$2\)/.test(insert.sql), `quoted+parameterized insert, got: ${insert.sql}`);
  assert.ok(!/evil|DROP TABLE/i.test(insert.sql), 'the unknown column / payload never reaches the SQL text');
  assert.deepEqual(insert.params, [3, 'c']);
});

test('bbx-683-pg-injection: a malicious table/column name cannot break out (validated + quoted)', () => {
  // The identifier quoter escapes embedded quotes; combined with the information_schema existence
  // check (a fabricated name is simply NOT FOUND), an injection attempt cannot reach raw SQL.
  assert.equal(quoteIdent('people'), '"people"');
  assert.equal(quoteIdent('a"; DROP TABLE x; --'), '"a""; DROP TABLE x; --"');
});

test('bbx-683-pg-idor: cross-tenant and unmapped-db export are 404 BEFORE connecting (Scenario 2)', async () => {
  // cross-tenant: tenant B cannot export tenant A's workspace/db
  const r1 = await PG_HANDLERS.pgDataExport(ctx({ workspaceId: WS_A, databaseName: DB_A, schemaName: 'public', tableName: 'people' }, { identity: ownerB, pool: makePool() }));
  assert.equal(r1.statusCode, 404);
  assert.equal(r1.body.code, 'WORKSPACE_NOT_FOUND');
  // a db NOT mapped to the caller's workspace is 404 (even as the workspace owner)
  const r2 = await PG_HANDLERS.pgDataExport(ctx({ workspaceId: WS_A, databaseName: DB_B, schemaName: 'public', tableName: 'people' }, { identity: ownerA, pool: makePool() }));
  assert.equal(r2.statusCode, 404);
  assert.equal(r2.body.code, 'PG_DATABASE_NOT_FOUND');
});

// ===========================================================================
// FUNCTIONS family
// ===========================================================================
const FN_ROW = { resource_id: 'fn_src', workspace_id: WS_A, tenant_id: TENANT_A, action_name: 'pkg/greet', runtime: 'nodejs:22', entrypoint: 'main', source_code: 'exports.main=()=>({ok:1})', parameters: { a: 1 }, version: 1 };

test('bbx-683-fn-roundtrip: export emits a deployable bundle; import re-scopes + upserts the registry', async () => {
  const exp = await FN_HANDLERS.fnDefinitionExport(ctx({ resourceId: 'fn_src' }, { pool: makePool({ fnActions: { fn_src: FN_ROW } }) }));
  assert.equal(exp.statusCode, 200, JSON.stringify(exp.body));
  assert.equal(exp.body.scope.tenantId, TENANT_A);
  assert.equal(exp.body.definitions.length, 1);
  const def = exp.body.definitions[0];
  assert.equal(def.actionName, 'pkg/greet');
  assert.equal(def.sourceCode, FN_ROW.source_code, 'the source code round-trips');
  assert.equal(def.packageName, 'pkg');

  // Import the bundle into the caller's OWN workspace -> upserts a registry row.
  const pool = makePool();
  const imp = await FN_HANDLERS.fnDefinitionImport(ctx({ workspaceId: WS_A }, { pool, body: exp.body }));
  assert.equal(imp.statusCode, 200, JSON.stringify(imp.body));
  assert.equal(imp.body.importedCount, 1);
  assert.equal(imp.body.targetTenantId, TENANT_A);
  const ins = pool.inserts.find((i) => i.table === 'fn_actions');
  assert.equal(ins.rec.tenant_id, TENANT_A, 'imported row carries the VERIFIED tenant');
  assert.equal(ins.rec.source_code, FN_ROW.source_code);
});

test('bbx-683-fn-scope-violation: an import bundle scoped to another tenant is rejected (403, no write)', async () => {
  const pool = makePool();
  const foreignBundle = { bundleVersion: '2026-03-27', tenantId: TENANT_B, workspaceId: WS_B,
    resources: [{ resourceType: 'function_action', name: 'pkg/x', tenantId: TENANT_B, workspaceId: WS_B }],
    definitions: [{ actionName: 'pkg/x', sourceCode: 'x', runtime: 'nodejs:22' }] };
  const res = await FN_HANDLERS.fnDefinitionImport(ctx({ workspaceId: WS_A }, { pool, identity: ownerA, body: foreignBundle }));
  assert.equal(res.statusCode, 403, JSON.stringify(res.body));
  assert.equal(res.body.code, 'IMPORT_SCOPE_VIOLATION');
  assert.equal(pool.inserts.length, 0, 'no registry row written for a cross-scope bundle');
});

test('bbx-683-fn-idor: exporting another tenant action / importing into a foreign workspace is 404 (Scenario 2)', async () => {
  // export another tenant's action: caller B cannot read A's action
  const r1 = await FN_HANDLERS.fnDefinitionExport(ctx({ resourceId: 'fn_src' }, { identity: ownerB, pool: makePool({ fnActions: { fn_src: FN_ROW } }) }));
  assert.equal(r1.statusCode, 404);
  // import into a workspace the caller does not own
  const r2 = await FN_HANDLERS.fnDefinitionImport(ctx({ workspaceId: WS_A }, { identity: ownerB, pool: makePool(), body: { definitions: [{ actionName: 'x', sourceCode: 'x' }] } }));
  assert.equal(r2.statusCode, 404);
  assert.equal(r2.body.code, 'WORKSPACE_NOT_FOUND');
});

test('bbx-683-fn-package-export: a package export collects only its package actions', async () => {
  const rows = {
    a: { resource_id: 'a', workspace_id: WS_A, tenant_id: TENANT_A, action_name: 'billing/charge', runtime: 'nodejs:22', entrypoint: 'main', source_code: 's1', version: 1 },
    b: { resource_id: 'b', workspace_id: WS_A, tenant_id: TENANT_A, action_name: 'billing/refund', runtime: 'nodejs:22', entrypoint: 'main', source_code: 's2', version: 1 },
    c: { resource_id: 'c', workspace_id: WS_A, tenant_id: TENANT_A, action_name: 'other/ping', runtime: 'nodejs:22', entrypoint: 'main', source_code: 's3', version: 1 }
  };
  const res = await FN_HANDLERS.fnPackageDefinitionExport(ctx({ workspaceId: WS_A, packageName: 'billing' }, { pool: makePool({ fnActions: rows }) }));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.definitions.map((d) => d.actionName).sort(), ['billing/charge', 'billing/refund']);
});

// ===========================================================================
// METRICS audit-export upgrade (was a 202 no-op)
// ===========================================================================
test('bbx-683-audit-export: tenant audit-export returns a REAL 200 export (not the 202 no-op ack)', async () => {
  const AUDIT_ROWS = [
    { id: 'e1', action_type: 'tenant.create', actor_id: 'u1', tenant_id: TENANT_A, created_at: '2026-01-01T00:00:00Z', outcome: 'success', correlation_id: 'c1', new_state: { foo: 'bar' } }
  ];
  const pool = {
    query: async (sql, params = []) => {
      const s = sql.toLowerCase();
      if (s.includes('from tenants')) {
        return {
          rows: params[0] === TENANT_A ? [{
            id: TENANT_A,
            slug: 'tenant-a',
            display_name: 'Tenant A',
            status: 'active',
            iam_realm: 'tenant-a',
            created_at: '2026-01-01T00:00:00.000Z',
            created_by: 'blackbox'
          }] : []
        };
      }
      if (s.includes('from workspaces')) return { rows: [WORKSPACE_ROWS[WS_A]] };
      if (s.includes('plan_audit_events')) return { rows: AUDIT_ROWS };
      return { rows: [] };
    }
  };
  const res = await METRICS_HANDLERS.metricsTenantAuditExport(ctx(
    { tenantId: TENANT_A },
    { pool, identity: ownerA, body: { format: 'jsonl' } }
  ));
  assert.equal(res.statusCode, 200, `expected a real 200 export, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
  assert.notEqual(res.statusCode, 202, 'must no longer be the no-op 202 ack');
  assert.ok(res.body.itemCount >= 1, 'the real audit record is exported');
  assert.ok('items' in res.body, 'the export carries items');
});

test('bbx-683-audit-export-idor: cross-tenant audit-export is denied (403, guarded chokepoint)', async () => {
  const pool = { query: async () => ({ rows: [] }) };
  const res = await METRICS_HANDLERS.metricsTenantAuditExport(ctx({ tenantId: TENANT_A }, { pool, identity: ownerB }));
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'FORBIDDEN');
});

// ===========================================================================
// TENANT CONFIG export + WORKSPACE clone (b-handlers)
// ===========================================================================
test('bbx-683-tenant-export: snapshot has metadata + workspaces + quotas and EXCLUDES secrets', () => {
  const snap = buildTenantConfigExport({
    tenant: { id: TENANT_A, slug: 'app-a', display_name: 'App A', status: 'active' },
    workspaces: [{ id: WS_A, slug: 'app-a', display_name: 'App A', environment: 'dev', status: 'active', clientSecret: 'LEAK', password: 'LEAK' }],
    environments: [{ environment: 'dev', workspaceCount: 1 }],
    quotaLimits: [{ dimensionKey: 'max_workspaces', effectiveValue: 5, quotaType: 'hard' }],
    environmentCatalog: ['dev', 'prod']
  });
  assert.equal(snap.tenant.tenantId, TENANT_A);
  assert.equal(snap.workspaces.length, 1);
  assert.equal(snap.quotas[0].dimension, 'max_workspaces');
  // No sensitive field anywhere in the serialized snapshot.
  const json = JSON.stringify(snap);
  assert.ok(!json.includes('LEAK'), 'secrets/credentials are stripped from the snapshot');
  assert.ok(snap.excluded.includes('secrets') && snap.excluded.includes('credentials'));
});

test('bbx-683-stripSensitive: recursively drops forbidden keys', () => {
  const out = stripSensitive({ a: 1, password: 'x', nested: { token: 'y', keep: 2 }, list: [{ apiKey: 'z', ok: 3 }] });
  assert.deepEqual(out, { a: 1, nested: { keep: 2 }, list: [{ ok: 3 }] });
});

test('bbx-683-tenant-export-idor: exporting another tenant config is 404 (Scenario 2)', async () => {
  const pool = { query: async (sql) => (/from tenants/i.test(sql) ? { rows: [{ id: TENANT_A, slug: 'app-a', display_name: 'App A', status: 'active' }] } : { rows: [] }) };
  const res = await LOCAL_HANDLERS.exportTenantConfiguration(ctx({ tenantId: TENANT_A }, { pool, identity: ownerB }));
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, 'TENANT_NOT_FOUND');
});

test('bbx-683-clone: clones a workspace within the tenant; copies functions; never copies credentials', async () => {
  const fns = { ws_src: [{ name: 'fn-a', runtime: 'nodejs:20', handler: 'main', source_ref: 'sha' }] };
  const src = { id: 'ws_src', tenant_id: TENANT_A, slug: 'src', display_name: 'Src', status: 'active', environment: 'dev' };
  const inserted = [];
  const pool = {
    query: async (sql, params = []) => {
      const s = sql.replace(/\s+/g, ' ').toLowerCase();
      if (s.includes('from workspaces') && s.includes('where id = $1 or slug')) {
        return { rows: (params[0] === 'ws_src' || params[0] === 'src') ? [src] : [] };
      }
      if (s.includes('select 1 from workspaces where tenant_id=$1 and slug=$2')) return { rows: [] }; // slug free
      if (s.includes("count(*)::int as n from workspaces")) return { rows: [{ n: 1 }] };
      if (s.startsWith('insert into workspaces')) { const w = { id: params[0], tenant_id: params[1], slug: params[2], display_name: params[3], status: 'active', environment: params[4] }; inserted.push({ table: 'workspaces', w }); return { rows: [w] }; }
      if (s.includes('from workspace_functions where workspace_id=$1 order by')) { return { rows: fns[params[0]] ?? [] }; }
      if (s.includes('select 1 from workspace_functions where workspace_id=$1 and name=$2')) return { rows: [] };
      if (s.startsWith('insert into workspace_functions')) { inserted.push({ table: 'workspace_functions', name: params[3], workspaceId: params[1], tenantId: params[2] }); return { rows: [{}] }; }
      return { rows: [] };
    }
  };
  const res = await LOCAL_HANDLERS.cloneWorkspace(ctx({ workspaceId: 'ws_src' }, { pool, identity: { actorType: 'tenant_owner', tenantId: TENANT_A, sub: 'u1' }, body: { displayName: 'Cloned', slug: 'cloned' }, skipDbProvision: true }));
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  assert.equal(res.body.clone.tenantId, TENANT_A);
  assert.deepEqual(res.body.clone.copied.functions, ['fn-a']);
  assert.ok(res.body.clone.notCopied.includes('credentials') && res.body.clone.notCopied.includes('service-accounts'));
  // The new workspace + the copied function both belong to the source tenant.
  const fnIns = inserted.find((i) => i.table === 'workspace_functions');
  assert.equal(fnIns.tenantId, TENANT_A);
});

test('bbx-683-clone-idor: cloning a workspace the caller does not own is 404; a foreign target tenant is denied (Scenario 2)', async () => {
  const src = { id: 'ws_src', tenant_id: TENANT_A, slug: 'src', display_name: 'Src', status: 'active', environment: 'dev' };
  const inserted = [];
  const pool = {
    query: async (sql, params = []) => {
      const s = sql.replace(/\s+/g, ' ').toLowerCase();
      if (s.includes('from workspaces') && s.includes('where id = $1 or slug')) return { rows: (params[0] === 'ws_src') ? [src] : [] };
      if (s.startsWith('insert into')) { inserted.push(sql); return { rows: [{}] }; }
      return { rows: [] };
    }
  };
  // caller B does not own ws_src -> 404, nothing created
  const r1 = await LOCAL_HANDLERS.cloneWorkspace(ctx({ workspaceId: 'ws_src' }, { pool, identity: ownerB, body: { slug: 'x' }, skipDbProvision: true }));
  assert.equal(r1.statusCode, 404);
  assert.equal(inserted.length, 0, 'no workspace created for a non-owner clone');
  // owner A, but explicitly targeting ANOTHER tenant -> denied (no cross-tenant clone)
  const r2 = await LOCAL_HANDLERS.cloneWorkspace(ctx({ workspaceId: 'ws_src' }, { pool, identity: { actorType: 'tenant_owner', tenantId: TENANT_A, sub: 'u1' }, body: { slug: 'x', targetTenantId: TENANT_B }, skipDbProvision: true }));
  assert.equal(r2.statusCode, 404);
  assert.equal(r2.body.code, 'TENANT_NOT_FOUND');
});
