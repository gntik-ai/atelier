// Real-HTTP + real-Postgres proof for the control-plane service (add-control-plane-executor).
// Boots the actual HTTP server, sends requests with gateway-style identity headers, and
// asserts the data-row family works end-to-end (server → executor → adapter plan → Postgres).
// Run via tests/env/executor/run.sh (it also runs the executor unit-of-work test).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createConnectionRegistry } from '../../../apps/control-plane-executor/src/runtime/connection-registry.mjs';
import { createControlPlaneServer } from '../../../apps/control-plane-executor/src/runtime/server.mjs';
import { createApiKeyStore } from '../../../apps/control-plane-executor/src/runtime/api-keys.mjs';
import { PUBLIC_API_VERSION } from '../../../apps/shared/error-envelope.mjs';

const { Pool } = pg;

const ADMIN_URL =
  process.env.DB_URL ??
  `postgres://${process.env.PGUSER ?? 'falcone'}:${process.env.PGPASSWORD ?? 'falcone'}@${
    process.env.PGHOST ?? 'localhost'
  }:${process.env.PGPORT ?? '55432'}/${process.env.PGDATABASE ?? 'falcone_test'}`;

const PROBE_DB = 'cp_http_probe';
const APP_LOGIN = 'cp_http_app';
const APP_PW = 'cp_http_local_only';
const TEN_A = 'ten_http_a';
const WS_A = 'ws_http_a';

let bootstrap;
let admin;
let registry;
let server;
let baseUrl;

function probeUrl(role, pw) {
  const base = ADMIN_URL.replace(/\/[^/]+$/, `/${PROBE_DB}`);
  return role ? base.replace(/\/\/[^:]+:[^@]+@/, `//${role}:${pw}@`) : base;
}

const rowsPath = `/v1/postgres/workspaces/${WS_A}/data/appdb/schemas/public/tables/notes/rows`;
const publicTraceHeaders = { 'x-api-version': PUBLIC_API_VERSION };
const authHeaders = { ...publicTraceHeaders, 'content-type': 'application/json', 'x-tenant-id': TEN_A, 'x-workspace-id': WS_A, 'x-auth-subject': 'user-1' };
const adminAuthHeaders = { ...authHeaders, 'x-actor-roles': 'tenant_owner' };

before(async () => {
  bootstrap = new Pool({ connectionString: ADMIN_URL, max: 1 });
  await bootstrap.query(`DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE)`);
  await bootstrap.query(`CREATE DATABASE ${PROBE_DB}`);
  admin = new Pool({ connectionString: probeUrl(), max: 2 });
  await admin.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await admin.query(`CREATE TABLE public.notes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id text NOT NULL, workspace_id text NOT NULL, body text NOT NULL)`);
  await admin.query(`DROP ROLE IF EXISTS ${APP_LOGIN}`);
  await admin.query(`CREATE ROLE ${APP_LOGIN} LOGIN PASSWORD '${APP_PW}' NOSUPERUSER NOBYPASSRLS`);
  await admin.query(`GRANT USAGE ON SCHEMA public TO ${APP_LOGIN}`);
  await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON public.notes TO ${APP_LOGIN}`);
  await admin.query(`INSERT INTO public.notes (tenant_id, workspace_id, body) VALUES ($1,$2,'seed-a')`, [TEN_A, WS_A]);

  const appDsn = probeUrl(APP_LOGIN, APP_PW);
  // data path = app role; DDL/admin path = superuser probe DSN.
  registry = createConnectionRegistry({ resolveConnection: () => ({ dsn: appDsn, adminDsn: probeUrl() }) });
  const apiKeyStore = createApiKeyStore({ pool: admin });
  await apiKeyStore.ensureSchema();
  server = createControlPlaneServer({ registry, apiKeyStore, logger: { error() {} } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await registry?.end().catch(() => {});
  await admin?.end().catch(() => {});
  if (bootstrap) {
    // Plain (non-FORCE) drop — pools are already ended; FORCE could kill a still-closing
    // local connection, which node:test flags as async-after-teardown. Residue is cleaned by
    // the next run's before() FORCE-drop (fresh process, no live local connection).
    await bootstrap.query(`DROP DATABASE IF EXISTS ${PROBE_DB}`).catch(() => {});
    await bootstrap.query(`DROP ROLE IF EXISTS ${APP_LOGIN}`).catch(() => {});
    await bootstrap.end().catch(() => {});
  }
});

test('GET /healthz → 200', async () => {
  const res = await fetch(`${baseUrl}/healthz`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, 'ok');
});

test('POST rows inserts (tenant stamped) → 201', async () => {
  const res = await fetch(`${baseUrl}${rowsPath}`, {
    method: 'POST', headers: authHeaders, body: JSON.stringify({ values: { body: 'http-one' } }),
  });
  assert.equal(res.status, 201);
  const out = await res.json();
  assert.equal(out.item.tenant_id, TEN_A);
  assert.equal(out.item.body, 'http-one');
});

test('GET rows lists only the caller tenant rows → 200', async () => {
  const res = await fetch(`${baseUrl}${rowsPath}`, { headers: authHeaders });
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.items.length, 2); // seed-a + http-one
  assert.ok(out.items.every((r) => r.tenant_id === TEN_A));
});

test('GET rows without tenant identity → 401', async () => {
  const res = await fetch(`${baseUrl}${rowsPath}`, { headers: { 'content-type': 'application/json' } });
  assert.equal(res.status, 401);
});

test('POST DDL create table → 201 and the table exists', async () => {
  const res = await fetch(`${baseUrl}/v1/postgres/databases/appdb/schemas/public/tables`, {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ tableName: 'http_items', columns: [
      { columnName: 'id', dataType: 'uuid', nullable: false, constraints: { primaryKey: true } },
      { columnName: 'label', dataType: 'text' },
    ] }),
  });
  assert.equal(res.status, 201);
  const r = await admin.query("SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='http_items'");
  assert.equal(r.rowCount, 1);
});

test('POST bulk insert → 201 affected=2', async () => {
  const res = await fetch(`${baseUrl}${rowsPath}/bulk/insert`, {
    method: 'POST', headers: authHeaders, body: JSON.stringify({ rows: [{ body: 'h1' }, { body: 'h2' }] }),
  });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).affected, 2);
});

test('POST bulk insert via the documented catalog path (…/tables/{t}/bulk/insert) → 201', async () => {
  // fix-data-api-contract-mismatches (#601): the route catalog documents bulk insert at
  // `.../tables/{t}/bulk/insert` (no `/rows`); a gateway-proxied catalog path must not 404.
  const tablePath = rowsPath.replace(/\/rows$/, '');
  const res = await fetch(`${baseUrl}${tablePath}/bulk/insert`, {
    method: 'POST', headers: authHeaders, body: JSON.stringify({ rows: [{ body: 'h3' }, { body: 'h4' }] }),
  });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).affected, 2);
});

test('API-key lifecycle over HTTP: issue (201) → list → anon-key cannot manage keys (403) → revoke', async () => {
  // issue an anon key (admin/JWT identity)
  const issueRes = await fetch(`${baseUrl}/v1/workspaces/${WS_A}/api-keys`, {
    method: 'POST', headers: adminAuthHeaders, body: JSON.stringify({ keyType: 'anon' }),
  });
  assert.equal(issueRes.status, 201);
  const issued = await issueRes.json();
  assert.ok(issued.key.startsWith('flc_anon_'));

  // list shows it (no secret)
  const listRes = await fetch(`${baseUrl}/v1/workspaces/${WS_A}/api-keys`, { headers: adminAuthHeaders });
  assert.equal(listRes.status, 200);
  const list = await listRes.json();
  assert.ok(list.items.some((k) => k.id === issued.id));
  assert.ok(list.items.every((k) => !('key' in k) && !('key_hash' in k)));
  // fix-data-api-contract-mismatches (#601): list items use the same camelCase shape as mint
  // (keyType/createdAt), not snake_case (key_type/created_at).
  assert.ok(list.items.every((k) => 'keyType' in k && 'createdAt' in k && !('key_type' in k) && !('created_at' in k)));

  // an API key may NOT manage API keys
  const escalate = await fetch(`${baseUrl}/v1/workspaces/${WS_A}/api-keys`, {
    method: 'POST', headers: { ...publicTraceHeaders, 'content-type': 'application/json', authorization: `ApiKey ${issued.key}` }, body: JSON.stringify({ keyType: 'service' }),
  });
  assert.equal(escalate.status, 403);

  // revoke
  const del = await fetch(`${baseUrl}/v1/workspaces/${WS_A}/api-keys/${issued.id}`, { method: 'DELETE', headers: adminAuthHeaders });
  assert.equal(del.status, 200);
});

test('GET unknown path → 404 NO_ROUTE', async () => {
  const res = await fetch(`${baseUrl}/v1/nope`, { headers: authHeaders });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).code, 'GW_NO_ROUTE');
});

test('GET rows on unknown table → 404 TABLE_NOT_FOUND (sanitized)', async () => {
  const res = await fetch(`${baseUrl}/v1/postgres/workspaces/${WS_A}/data/appdb/schemas/public/tables/ghost/rows`, { headers: authHeaders });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).code, 'GW_TABLE_NOT_FOUND');
});

test('list supports PostgREST-style filters + keyset pagination (cursor)', async () => {
  // Seed three rows sharing a marker so a filter can isolate them from earlier test rows.
  for (const body of ['pg1', 'pg2', 'pg3']) {
    const r = await fetch(`${baseUrl}${rowsPath}`, { method: 'POST', headers: authHeaders, body: JSON.stringify({ values: { body } }) });
    assert.equal(r.status, 201);
  }
  const filtered = `${baseUrl}${rowsPath}?body=ilike.pg%25&page[size]=2&countMode=exact`;

  // Page 1: filter matches the 3 pg rows; page size 2 → 2 items + a next cursor + exact count.
  const res1 = await fetch(filtered, { headers: authHeaders });
  assert.equal(res1.status, 200);
  const page1 = await res1.json();
  assert.equal(page1.items.length, 2);
  assert.ok(page1.items.every((row) => /^pg/.test(row.body)));
  assert.equal(page1.count, 3);
  assert.ok(typeof page1.page.after === 'string' && page1.page.after.length > 0, 'a next cursor for a full page');

  // Page 2 via the cursor: the remaining pg row, distinct from page 1, and no further cursor.
  const res2 = await fetch(`${filtered}&page[after]=${encodeURIComponent(page1.page.after)}`, { headers: authHeaders });
  const page2 = await res2.json();
  assert.equal(page2.items.length, 1);
  const page1Ids = new Set(page1.items.map((row) => row.id));
  assert.ok(!page1Ids.has(page2.items[0].id), 'page 2 does not repeat page 1 rows');
  assert.equal(page2.page.after, undefined);

  // eq filter narrows to a single row.
  const res3 = await fetch(`${baseUrl}${rowsPath}?body=eq.pg2`, { headers: authHeaders });
  const page3 = await res3.json();
  assert.equal(page3.items.length, 1);
  assert.equal(page3.items[0].body, 'pg2');
});

test('list rejects a filter on an unknown column → 400', async () => {
  const res = await fetch(`${baseUrl}${rowsPath}?nope=eq.x`, { headers: authHeaders });
  assert.equal(res.status, 400);
});
