// fix-embedding-provider-gateway-route (#635)
//
// The only BYOK surface (per-workspace embedding provider) had no working public route: PUT/GET
// /v1/workspaces/{id}/embedding-provider returned 404 NO_ROUTE because the gateway routed
// /v1/workspaces/* to the control-plane (no embedding handler) while the handler lives in the
// executor. This covers BOTH halves: (1) the executor now serves GET (a set->get round-trip that
// returns only a secretRef, never the plaintext key), and (2) the APISIX config forwards the
// embedding-provider subpath to the executor. Pure: in-process server + a config-file assertion.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import { createConnectionRegistry } from '../../apps/control-plane-executor/src/runtime/connection-registry.mjs';
import { createEmbeddingExecutor, createEmbeddingProviderStore } from '../../apps/control-plane-executor/src/runtime/embedding-executor.mjs';

const TEN = 'ten_emb_get';
const WS = 'ws_emb_get';
const authHeaders = {
  'content-type': 'application/json',
  'x-api-version': '2026-03-26',
  'x-correlation-id': 'corr-bbx-embedding-get',
  'x-tenant-id': TEN,
  'x-workspace-id': WS,
  'x-auth-subject': 'admin',
  'x-actor-roles': 'tenant_owner',
};
const FAKE_KEY = 'placeholder-not-a-real-key'; // a clearly non-provider placeholder (push protection)

function makeRegistry() {
  return createConnectionRegistry({ resolveConnection: () => ({ dsn: 'postgres://unused/none' }) });
}

async function withServer(embeddingExecutor, fn) {
  const registry = makeRegistry();
  const server = createControlPlaneServer({ registry, embeddingExecutor, logger: { error() {} } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try { return await fn(baseUrl); } finally {
    await new Promise((r) => server.close(r));
    await registry.end().catch(() => {});
  }
}

const path = (ws = WS) => `/v1/workspaces/${ws}/embedding-provider`;

test('bbx-emb-get-01: GET round-trips a PUT and returns only a secretRef (never the plaintext key)', async () => {
  const embeddingExecutor = createEmbeddingExecutor({ store: createEmbeddingProviderStore() });
  await withServer(embeddingExecutor, async (baseUrl) => {
    const put = await fetch(`${baseUrl}${path()}`, {
      method: 'PUT', headers: authHeaders,
      body: JSON.stringify({ providerType: 'openai', model: 'text-embedding-3-small', secretRef: { name: 'BYOK_K' }, apiKey: FAKE_KEY }),
    });
    assert.equal(put.status, 200, await put.text());
    const get = await fetch(`${baseUrl}${path()}`, { method: 'GET', headers: authHeaders });
    assert.equal(get.status, 200, 'GET reaches the handler (not 404 NO_ROUTE)');
    const body = await get.json();
    assert.equal(body.providerType, 'openai');
    assert.deepEqual(body.secretRef, { name: 'BYOK_K' });
    assert.ok(!('apiKey' in body) && !('secret' in body), 'GET never returns the plaintext key');
    assert.ok(!JSON.stringify(body).includes(FAKE_KEY), 'plaintext never echoed back');
  });
});

test('bbx-emb-get-02: GET on an unconfigured workspace returns 404 (not 500)', async () => {
  const embeddingExecutor = createEmbeddingExecutor({ store: createEmbeddingProviderStore() });
  await withServer(embeddingExecutor, async (baseUrl) => {
    const get = await fetch(`${baseUrl}${path()}`, { method: 'GET', headers: authHeaders });
    assert.equal(get.status, 404);
    const body = await get.json();
    assert.equal(body.code, 'GW_EMBEDDING_PROVIDER_NOT_FOUND');
  });
});

// The gateway half: assert the APISIX config forwards the embedding-provider subpath to the
// EXECUTOR (not the control-plane, which has no handler) at higher priority than the generic
// /v1/workspaces/* route.
test('bbx-emb-get-03: APISIX routes /v1/workspaces/{id}/embedding-provider to the executor', () => {
  const src = readFileSync(fileURLToPath(new URL('../../deploy/kind/apisix/apisix.yaml', import.meta.url)), 'utf8');
  const idx = src.indexOf('2003-embedding');
  assert.ok(idx > -1, 'a dedicated 2003-embedding route exists in apisix.yaml');
  const block = src.slice(idx, idx + 1200);
  assert.match(block, /embedding-provider/, 'route matches the embedding-provider subpath');
  assert.match(block, /falcone-control-plane-executor/, 'route forwards to the executor, not the control-plane');
});
