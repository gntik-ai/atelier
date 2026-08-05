// add-llm-agent-flow-task (#640) — BYOK LLM completion plane public HTTP surface.
//
// Drives the executor's five LLM routes in-process (no external provider; a deterministic mock
// backend + a stub secret resolver are injected). Covers: provider config round-trip (secretRef
// only, never the plaintext key), model allow-listing, fail-closed secret resolution, token-usage
// metering + rollup, streaming SSE, and cross-tenant isolation of BOTH config and usage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import { createConnectionRegistry } from '../../apps/control-plane-executor/src/runtime/connection-registry.mjs';
import {
  createLlmExecutor,
  createLlmProviderStore,
  createLlmUsageStore,
  localMockLlmBackend,
} from '../../apps/control-plane-executor/src/runtime/llm-executor.mjs';

const WS = 'ws_llm';
const FAKE_KEY = 'placeholder-not-a-real-key'; // clearly non-provider placeholder (push protection)
const headersFor = (tenant) => ({ 'content-type': 'application/json', 'x-tenant-id': tenant, 'x-workspace-id': WS, 'x-auth-subject': 'admin' });

function makeRegistry() {
  return createConnectionRegistry({ resolveConnection: () => ({ dsn: 'postgres://unused/none' }) });
}

// BYOK confinement (#659): the executor now confines the secretRef name to a reserved prefix
// (default `BYOK_`) and SSRF-validates the endpoint at deploy + request time. The provider config
// below uses a `BYOK_`-prefixed name; the injected resolver (gated by the allow-list) returns the
// stub key, and an injected DNS resolver maps the example endpoint host to a public IP so the SSRF
// guard passes deterministically/offline.
const PUBLIC_RESOLVER = async () => ['93.184.216.34']; // example.test → public IP (offline determinism)

function makeExecutor({ secretResolver = () => FAKE_KEY } = {}) {
  return createLlmExecutor({
    providerStore: createLlmProviderStore(),
    usageStore: createLlmUsageStore(),
    secretResolver,
    backendFactory: () => localMockLlmBackend(),
    endpointResolver: PUBLIC_RESOLVER,
  });
}

async function withServer(llmExecutor, fn) {
  const registry = makeRegistry();
  const server = createControlPlaneServer({ registry, llmExecutor, logger: { error() {} } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try { return await fn(baseUrl); } finally {
    await new Promise((r) => server.close(r));
    await registry.end().catch(() => {});
  }
}

const provPath = (ws = WS) => `/v1/workspaces/${ws}/llm-provider`;
const compPath = (ws = WS) => `/v1/workspaces/${ws}/llm/completions`;
const usagePath = (ws = WS) => `/v1/workspaces/${ws}/llm-usage`;

const PROVIDER = {
  providerType: 'openai',
  endpoint: 'https://api.example.test/v1/chat/completions',
  allowedModels: ['gpt-allowed'],
  defaultModel: 'gpt-allowed',
  secretRef: { name: 'BYOK_LLM_KEY' }, // reserved-prefix name (#659 confinement)
};

async function putProvider(baseUrl, tenant, body = PROVIDER) {
  return fetch(`${baseUrl}${provPath()}`, { method: 'PUT', headers: headersFor(tenant), body: JSON.stringify(body) });
}

test('bbx-llm-01: provider PUT→GET round-trips and never returns the plaintext key', async () => {
  await withServer(makeExecutor(), async (baseUrl) => {
    const put = await putProvider(baseUrl, 'ten_a', { ...PROVIDER, apiKey: FAKE_KEY, secret: FAKE_KEY });
    assert.equal(put.status, 200, await put.text());

    const get = await fetch(`${baseUrl}${provPath()}`, { headers: headersFor('ten_a') });
    assert.equal(get.status, 200);
    const body = await get.json();
    assert.equal(body.providerType, 'openai');
    assert.deepEqual(body.allowedModels, ['gpt-allowed']);
    assert.deepEqual(body.secretRef, { name: 'BYOK_LLM_KEY' });
    assert.ok(!('apiKey' in body) && !('secret' in body), 'GET never returns a plaintext key');
    assert.ok(!JSON.stringify(body).includes(FAKE_KEY), 'plaintext is never echoed back');
  });
});

test('bbx-llm-02: GET on an unconfigured workspace returns 404 LLM_PROVIDER_NOT_FOUND', async () => {
  await withServer(makeExecutor(), async (baseUrl) => {
    const get = await fetch(`${baseUrl}${provPath()}`, { headers: headersFor('ten_a') });
    assert.equal(get.status, 404);
    assert.equal((await get.json()).code, 'GW_LLM_PROVIDER_NOT_FOUND');
  });
});

test('bbx-llm-03: DELETE removes the provider; subsequent GET is 404', async () => {
  await withServer(makeExecutor(), async (baseUrl) => {
    await putProvider(baseUrl, 'ten_a');
    const del = await fetch(`${baseUrl}${provPath()}`, { method: 'DELETE', headers: headersFor('ten_a') });
    assert.equal(del.status, 200);
    assert.equal((await del.json()).removed, true);
    const get = await fetch(`${baseUrl}${provPath()}`, { headers: headersFor('ten_a') });
    assert.equal(get.status, 404);
  });
});

test('bbx-llm-04: completion with an allowed model returns content + usage and meters tokens', async () => {
  await withServer(makeExecutor(), async (baseUrl) => {
    await putProvider(baseUrl, 'ten_a');
    const res = await fetch(`${baseUrl}${compPath()}`, {
      method: 'POST', headers: headersFor('ten_a'),
      body: JSON.stringify({ model: 'gpt-allowed', messages: [{ role: 'user', content: 'ping' }] }),
    });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.match(body.content, /ping/);
    assert.equal(body.model, 'gpt-allowed');
    assert.ok(body.usage.totalTokens > 0, 'usage carries a non-zero token total');

    // Metering: the completion appended a usage row visible in the rollup.
    const usage = await fetch(`${baseUrl}${usagePath()}`, { headers: headersFor('ten_a') });
    assert.equal(usage.status, 200);
    const rollup = await usage.json();
    const row = rollup.items.find((i) => i.model === 'gpt-allowed');
    assert.ok(row && row.totalTokens > 0, 'usage rollup totals tokens for the model');
  });
});

test('bbx-llm-05: a disallowed model is rejected 422 MODEL_NOT_ALLOWED before any provider call', async () => {
  await withServer(makeExecutor(), async (baseUrl) => {
    await putProvider(baseUrl, 'ten_a');
    const res = await fetch(`${baseUrl}${compPath()}`, {
      method: 'POST', headers: headersFor('ten_a'),
      body: JSON.stringify({ model: 'gpt-forbidden', messages: [{ role: 'user', content: 'x' }] }),
    });
    assert.equal(res.status, 422);
    assert.equal((await res.json()).code, 'GW_MODEL_NOT_ALLOWED');
  });
});

test('bbx-llm-06: completion with no provider configured is 422 LLM_PROVIDER_MISSING', async () => {
  await withServer(makeExecutor(), async (baseUrl) => {
    const res = await fetch(`${baseUrl}${compPath()}`, {
      method: 'POST', headers: headersFor('ten_a'),
      body: JSON.stringify({ model: 'gpt-allowed', messages: [{ role: 'user', content: 'x' }] }),
    });
    assert.equal(res.status, 422);
    assert.equal((await res.json()).code, 'GW_LLM_PROVIDER_MISSING');
  });
});

test('bbx-llm-07: an unresolvable secret fails closed with the generic 500 class', async () => {
  await withServer(makeExecutor({ secretResolver: () => null }), async (baseUrl) => {
    await putProvider(baseUrl, 'ten_a');
    const res = await fetch(`${baseUrl}${compPath()}`, {
      method: 'POST', headers: headersFor('ten_a'),
      body: JSON.stringify({ model: 'gpt-allowed', messages: [{ role: 'user', content: 'x' }] }),
    });
    assert.equal((await res.json()).code, 'GW_CONTROL_PLANE_ERROR');
  });
});

test('bbx-llm-08: streaming returns SSE delta frames then a terminal usage frame', async () => {
  await withServer(makeExecutor(), async (baseUrl) => {
    await putProvider(baseUrl, 'ten_a');
    const res = await fetch(`${baseUrl}${compPath()}`, {
      method: 'POST', headers: headersFor('ten_a'),
      body: JSON.stringify({ model: 'gpt-allowed', stream: true, messages: [{ role: 'user', content: 'streamme' }] }),
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
    const text = await res.text();
    assert.match(text, /"type":"delta"/, 'stream carries incremental delta frames');
    assert.match(text, /"type":"usage"/, 'stream ends with a usage frame');
  });
});

test('bbx-llm-09: cross-tenant isolation of provider config and usage under a shared workspaceId', async () => {
  await withServer(makeExecutor(), async (baseUrl) => {
    // Two tenants configure DIFFERENT providers under the same workspaceId value.
    await putProvider(baseUrl, 'ten_a', { ...PROVIDER, allowedModels: ['model-a'], defaultModel: 'model-a' });
    await putProvider(baseUrl, 'ten_b', { ...PROVIDER, allowedModels: ['model-b'], defaultModel: 'model-b' });

    const aGet = await (await fetch(`${baseUrl}${provPath()}`, { headers: headersFor('ten_a') })).json();
    assert.deepEqual(aGet.allowedModels, ['model-a'], "tenant A sees only A's allow-list");

    // Tenant A's model is NOT allowed for tenant B (its provider only allows model-b).
    await fetch(`${baseUrl}${compPath()}`, {
      method: 'POST', headers: headersFor('ten_a'),
      body: JSON.stringify({ model: 'model-a', messages: [{ role: 'user', content: 'a' }] }),
    });
    const bUsage = await (await fetch(`${baseUrl}${usagePath()}`, { headers: headersFor('ten_b') })).json();
    assert.equal(bUsage.items.length, 0, "tenant B's usage rollup excludes tenant A completions");
  });
});
