// Black-box tests for change fix-llm-completions-scope-gate (#662).
//
// POST /v1/workspaces/{ws}/llm/completions is a BILLABLE BYOK operation (#640): each call spends
// the workspace's LLM provider quota. It previously had NO scope gate (requiredDataScope returned
// null for the path and the role gate only covered /api-keys), so a data:read-only api-key OR a
// scopeless/anon api-key reached provider resolution (observed 422 LLM_PROVIDER_MISSING = auth
// passed) instead of being denied. The fix makes requiredDataScope return 'data:write' for the
// completion path, so the existing executor-side API-key scope gate (#624) denies read-only /
// scopeless credentials 403 BEFORE provider resolution.
//
// All tests drive createControlPlaneServer over its public HTTP interface only, with a stub
// llmExecutor that records whether the route reached provider resolution. A NON-streaming body
// (no stream:true) is sent so the route's complete() path runs and returns 200 on success.
//
// bbx-662-01: data:read-only api-key POST /llm/completions  -> 403 (executor.complete NOT called)
// bbx-662-02: anon api-key (scopes ['data:read'])           -> 403 (executor.complete NOT called)
// bbx-662-03: write-capable service api-key (data:write)    -> 200 (executor.complete WAS called)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import { createConnectionRegistry } from '../../apps/control-plane-executor/src/runtime/connection-registry.mjs';

const TEN = 'tenant_llm';
const WS = 'ws_llm';

// API keys keyed by presented secret → scope set. Every key is bound to (TEN, WS).
// flc_anon_readonly models an anon key (anon SCOPES_BY_TYPE = ['data:read']).
const KEY_SCOPES = {
  flc_service_read: ['data:read'],
  flc_anon_readonly: ['data:read'],
  flc_service_full: ['data:read', 'data:write', 'ddl:write'],
};

function makeStores() {
  const completeCalls = [];
  const apiKeyStore = {
    async ensureSchema() {},
    async verifyKey(presented) {
      const scopes = KEY_SCOPES[presented];
      if (!scopes) return null;
      const keyType = presented.startsWith('flc_anon') ? 'anon' : 'service';
      const dbRole = keyType === 'anon' ? 'falcone_anon' : 'falcone_service';
      return { tenantId: TEN, workspaceId: WS, keyType, roleName: dbRole, dbRole, scopes };
    },
  };
  // Stub LLM executor: records the call and returns a fake non-streaming result. If the scope gate
  // fails to fire, completeCalls.length > 0 proves the request reached provider resolution.
  const llmExecutor = {
    async complete(workspaceId, request) {
      completeCalls.push({ workspaceId, request });
      return { id: 'cmpl_stub', model: request.model, content: 'stub', usage: { totalTokens: 1 } };
    },
    completeStream() { throw new Error('completeStream should not be reached by these non-streaming tests'); },
  };
  return { apiKeyStore, llmExecutor, completeCalls };
}

// A registry that throws if any data plan is executed — completions never touch it, so this just
// guarantees no accidental data-plane execution masks the result.
function neverConnectRegistry() {
  return createConnectionRegistry({ resolveConnection: () => { throw new Error('registry reached — completions must not touch the data plane'); } });
}

async function withServer(fn) {
  const { apiKeyStore, llmExecutor, completeCalls } = makeStores();
  const registry = neverConnectRegistry();
  const server = createControlPlaneServer({ registry, apiKeyStore, llmExecutor, logger: { error() {} } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn({ baseUrl, completeCalls });
  } finally {
    await new Promise((r) => server.close(r));
    await registry.end().catch(() => {});
  }
}

const completions = (ws = WS) => `/v1/workspaces/${ws}/llm/completions`;
// A non-streaming completion request (no stream:true → runLlmComplete calls executor.complete()).
const body = JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] });
const TRACE_HEADERS = {
  'x-api-version': '2026-03-26',
  'x-correlation-id': 'corr-bbx-llm-scope',
};

test('bbx-662-01: a data:read-only api-key cannot drive billable completions -> 403 (provider not reached)', async () => {
  await withServer(async ({ baseUrl, completeCalls }) => {
    const res = await fetch(`${baseUrl}${completions()}`, {
      method: 'POST', headers: { ...TRACE_HEADERS, apikey: 'flc_service_read', 'content-type': 'application/json' }, body,
    });
    assert.equal(res.status, 403, `expected 403, got ${res.status}: ${await res.clone().text()}`);
    const json = await res.json();
    assert.equal(json.code, 'GW_FORBIDDEN', `expected GW_FORBIDDEN, got ${json.code}`);
    assert.doesNotMatch(JSON.stringify(json), /data:write/, 'the required scope must not be disclosed');
    assert.equal(completeCalls.length, 0, 'a denied completion must not reach provider resolution');
  });
});

test('bbx-662-02: an anon (scopeless) api-key cannot drive billable completions -> 403 (provider not reached)', async () => {
  await withServer(async ({ baseUrl, completeCalls }) => {
    const res = await fetch(`${baseUrl}${completions()}`, {
      method: 'POST', headers: { ...TRACE_HEADERS, apikey: 'flc_anon_readonly', 'content-type': 'application/json' }, body,
    });
    assert.equal(res.status, 403, `expected 403, got ${res.status}: ${await res.clone().text()}`);
    assert.equal(completeCalls.length, 0, 'a denied completion must not reach provider resolution');
  });
});

test('bbx-662-03: a write-capable service api-key may drive completions -> 200 (no regression)', async () => {
  await withServer(async ({ baseUrl, completeCalls }) => {
    const res = await fetch(`${baseUrl}${completions()}`, {
      method: 'POST', headers: { ...TRACE_HEADERS, apikey: 'flc_service_full', 'content-type': 'application/json' }, body,
    });
    assert.notEqual(res.status, 403, `expected NOT 403, got 403: ${await res.clone().text()}`);
    assert.equal(res.status, 200, `expected 200 from the stub, got ${res.status}: ${await res.clone().text()}`);
    assert.equal(completeCalls.length, 1, 'an in-scope completion reaches provider resolution');
  });
});
