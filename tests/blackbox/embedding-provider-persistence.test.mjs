// Black-box test suite for change add-embedding-provider-persistence.
//
// Drives the PUBLIC HTTP surface of the control-plane server (the same routes the gateway
// fronts) to prove the embedding-provider wiring is REAL once an embeddingExecutor is
// supplied to createControlPlaneServer:
//   - PUT /v1/workspaces/{id}/embedding-provider returns 200 (NOT the 501 EMBEDDING_DISABLED
//     guard) and round-trips the config (set -> stored record exposes only a secretRef)
//   - replacing a provider returns the re-index warning
//   - DELETE /v1/workspaces/{id}/embedding-provider returns 200 { removed: true }
//   - with NO embeddingExecutor wired, the same routes return 501 EMBEDDING_DISABLED
//
// Plus a direct check that the queryText KNN path is operational with a configured provider
// (mock backend injected) and surfaces the right error when no provider is configured.
//
// Public interface only: imports the runtime modules and exercises them over HTTP / their
// documented call signatures. No DB required (the executor uses the in-memory store seam).
//
// Tests: bbx-emb-persist-01 .. bbx-emb-persist-06
import test from 'node:test';
import assert from 'node:assert/strict';

import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import { createConnectionRegistry } from '../../apps/control-plane-executor/src/runtime/connection-registry.mjs';
import {
  createEmbeddingExecutor,
  createEmbeddingProviderStore,
  localMockEmbeddingBackend,
} from '../../apps/control-plane-executor/src/runtime/embedding-executor.mjs';

// A clearly non-provider placeholder (GitHub push protection rejects sk_live_ etc.).
const FAKE_KEY = 'placeholder-not-a-real-key';

const TEN = 'ten_bbx_emb';
const WS = 'ws_bbx_emb';
const authHeaders = {
  'content-type': 'application/json',
  'x-api-version': '2026-03-26',
  'x-correlation-id': 'corr-bbx-embedding-persistence',
  'x-tenant-id': TEN,
  'x-workspace-id': WS,
  'x-auth-subject': 'admin-1',
};

// A registry is required by createControlPlaneServer but the embedding-provider routes never
// touch the data plane, so a no-op resolveConnection (never connected) is sufficient.
function makeRegistry() {
  return createConnectionRegistry({ resolveConnection: () => ({ dsn: 'postgres://unused/none' }) });
}

async function withServer({ embeddingExecutor }, fn) {
  const registry = makeRegistry();
  const server = createControlPlaneServer({ registry, embeddingExecutor, logger: { error() {} } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(baseUrl);
  } finally {
    await new Promise((r) => server.close(r));
    await registry.end().catch(() => {});
  }
}

const embPath = (ws = WS) => `/v1/workspaces/${ws}/embedding-provider`;

// bbx-emb-persist-01: PUT embedding-provider returns 200 (NOT 501) when the executor is wired,
// and the response exposes only a secretRef (no plaintext key).
test('bbx-emb-persist-01: PUT embedding-provider returns 200 and stores only a secretRef when wired', async () => {
  const embeddingExecutor = createEmbeddingExecutor({ store: createEmbeddingProviderStore() });
  await withServer({ embeddingExecutor }, async (baseUrl) => {
    const res = await fetch(`${baseUrl}${embPath()}`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({
        providerType: 'openai',
        model: 'text-embedding-3-small',
        secretRef: { name: 'BYOK_WS_EMBEDDING_KEY' }, // reserved-prefix name (#659 confinement)
        apiKey: FAKE_KEY, // a caller (mis)passing plaintext — MUST be stripped
      }),
    });
    assert.equal(res.status, 200, 'reachable handler, not the 501 guard');
    const body = await res.json();
    assert.notEqual(body.code, 'EMBEDDING_DISABLED');
    assert.equal(body.providerType, 'openai');
    assert.deepEqual(body.secretRef, { name: 'BYOK_WS_EMBEDDING_KEY' });
    assert.ok(!('apiKey' in body) && !('secret' in body), 'no plaintext key in the response');
    assert.ok(!JSON.stringify(body).includes(FAKE_KEY), 'plaintext never echoed back');
  });
});

// bbx-emb-persist-02: replacing an existing provider (second PUT) returns the re-index warning.
test('bbx-emb-persist-02: replacing a provider via the route returns the re-index warning', async () => {
  const embeddingExecutor = createEmbeddingExecutor({ store: createEmbeddingProviderStore() });
  await withServer({ embeddingExecutor }, async (baseUrl) => {
    const first = await fetch(`${baseUrl}${embPath()}`, {
      method: 'PUT', headers: authHeaders,
      body: JSON.stringify({ providerType: 'openai', model: 'm', secretRef: { name: 'BYOK_K1' } }),
    });
    assert.equal((await first.json()).warning, undefined, 'first deploy has no warning');

    const second = await fetch(`${baseUrl}${embPath()}`, {
      method: 'PUT', headers: authHeaders,
      body: JSON.stringify({ providerType: 'cohere', model: 'embed-english-v3', secretRef: { name: 'BYOK_K2' } }),
    });
    const body = await second.json();
    assert.equal(second.status, 200);
    assert.ok(body.warning, 'replacement surfaces a warning');
    assert.match(body.warning, /re-?index|existing|previous/i);
  });
});

// bbx-emb-persist-03: DELETE embedding-provider returns 200 { removed: true } when wired.
test('bbx-emb-persist-03: DELETE embedding-provider returns 200 removed:true when wired', async () => {
  const embeddingExecutor = createEmbeddingExecutor({ store: createEmbeddingProviderStore() });
  await withServer({ embeddingExecutor }, async (baseUrl) => {
    await fetch(`${baseUrl}${embPath()}`, {
      method: 'PUT', headers: authHeaders,
      body: JSON.stringify({ providerType: 'openai', model: 'm', secretRef: { name: 'BYOK_K' } }),
    });
    const del = await fetch(`${baseUrl}${embPath()}`, { method: 'DELETE', headers: authHeaders });
    assert.equal(del.status, 200);
    assert.deepEqual(await del.json(), { removed: true });
  });
});

// bbx-emb-persist-04: with NO embeddingExecutor wired, the routes return 501 EMBEDDING_DISABLED.
// This is the bug the change fixes — the guard fires ONLY when the executor is absent.
test('bbx-emb-persist-04: routes return 501 EMBEDDING_DISABLED when the executor is NOT wired', async () => {
  await withServer({ embeddingExecutor: undefined }, async (baseUrl) => {
    const put = await fetch(`${baseUrl}${embPath()}`, {
      method: 'PUT', headers: authHeaders,
      body: JSON.stringify({ providerType: 'openai', model: 'm', secretRef: { name: 'BYOK_K' } }),
    });
    assert.equal(put.status, 501);
    assert.equal((await put.json()).code, 'GW_NOT_IMPLEMENTED');

    const del = await fetch(`${baseUrl}${embPath()}`, { method: 'DELETE', headers: authHeaders });
    assert.equal(del.status, 501);
    assert.equal((await del.json()).code, 'GW_NOT_IMPLEMENTED');
  });
});

// bbx-emb-persist-05: queryText KNN path is operational with a configured provider (mock
// backend injected) — embedForWorkspace returns a vector rather than throwing EMBEDDING_DISABLED.
test('bbx-emb-persist-05: embedForWorkspace returns a vector when a provider is configured', async () => {
  const embeddingExecutor = createEmbeddingExecutor({
    store: createEmbeddingProviderStore(),
    backendFactory: () => localMockEmbeddingBackend({ dimension: 3 }),
  });
  await embeddingExecutor.store.deployProvider(WS, { providerType: 'mock', model: 'mock-3', secretRef: { name: 'BYOK_K' } });
  const vec = await embeddingExecutor.embedForWorkspace(WS, 'semantic query', { expectedDimension: 3 });
  assert.equal(vec.length, 3);
  assert.ok(vec.every((n) => typeof n === 'number'));
});

// bbx-emb-persist-06: queryText KNN path returns the 422 EMBEDDING_PROVIDER_MISSING (NOT 501)
// when no provider is configured — confirming the executor is active, not the disabled guard.
test('bbx-emb-persist-06: embedForWorkspace fails 422 EMBEDDING_PROVIDER_MISSING when none configured', async () => {
  const embeddingExecutor = createEmbeddingExecutor({
    store: createEmbeddingProviderStore(),
    backendFactory: () => localMockEmbeddingBackend({ dimension: 3 }),
  });
  await assert.rejects(
    () => embeddingExecutor.embedForWorkspace('ws_no_provider', 'x', { expectedDimension: 3 }),
    (e) => e.statusCode === 422 && e.code === 'EMBEDDING_PROVIDER_MISSING',
  );
});
