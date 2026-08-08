import test from 'node:test';
import assert from 'node:assert/strict';

import { createMcpRuntimeCleaner } from '../../apps/control-plane-executor/src/runtime/mcp-runtime-cleaner.mjs';

const resolveRuntimeNamespace = ({ tenantId }) => `runtime-${tenantId}`;

test('mcp-runtime-cleaner-01: cleanup targets only tenant/server-owned ksvc, revisions, routes, RBAC and NetworkPolicy', async () => {
  const calls = [];
  const listCounts = new Map();
  const cleaner = createMcpRuntimeCleaner({
    apiBase: 'https://kubernetes.default.svc',
    env: {},
    resolveRuntimeNamespace,
    readFile: (path) => path.endsWith('token') ? 'secret-token' : Buffer.from('ca'),
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (init.method !== 'GET') return { status: 200 };
      const count = (listCounts.get(url) ?? 0) + 1;
      listCounts.set(url, count);
      return {
        status: 200,
        body: {
          items: count === 1 ? [{
            metadata: {
              name: 'mcp-srv-shared', uid: 'u1', resourceVersion: '7',
              labels: { 'in-falcone.io/tenant': 'tenant-a', 'in-falcone.io/mcp-server': 'srv-shared' },
            },
          }] : [],
        },
      };
    },
  });
  await cleaner.deleteOwnedRuntimeResources({ tenantId: 'tenant-a', resourceId: 'srv-shared' });
  assert.equal(calls.length, 18);
  for (const call of calls) {
    assert.match(call.url, /\/namespaces\/runtime-tenant-a\//);
    const parsed = new URL(call.url);
    if (call.init.method === 'GET') assert.equal(parsed.searchParams.get('labelSelector'), 'in-falcone.io/tenant=tenant-a,in-falcone.io/mcp-server=srv-shared');
    assert.ok(['GET', 'DELETE'].includes(call.init.method));
    assert.ok(!call.url.includes('secret-token'));
  }
  assert.ok(calls.some((call) => call.url.includes('/services?')));
  assert.ok(calls.some((call) => call.url.includes('/revisions?')));
  assert.ok(calls.some((call) => call.url.includes('/routes?')));
  assert.ok(calls.some((call) => call.url.includes('/roles?')));
  assert.ok(calls.some((call) => call.url.includes('/rolebindings?')));
  assert.ok(calls.some((call) => call.url.includes('/networkpolicies?')));
});

test('mcp-runtime-cleaner-02: invalid namespace input fails before any Kubernetes request', async () => {
  let calls = 0;
  const cleaner = createMcpRuntimeCleaner({
    apiBase: 'https://kubernetes.default.svc',
    resolveRuntimeNamespace: () => '../tenant-b',
    readFile: () => 'token',
    fetchImpl: async () => { calls += 1; return { status: 200 }; },
  });
  await assert.rejects(
    () => cleaner.deleteOwnedRuntimeResources({ tenantId: '../tenant-b', resourceId: 'srv-a' }),
    /valid Kubernetes DNS label/,
  );
  assert.equal(calls, 0);
});

test('mcp-runtime-cleaner-03: genuinely missing preconditions reject without deletion', async () => {
  let deletes = 0;
  const cleaner = createMcpRuntimeCleaner({ apiBase: 'https://k', resolveRuntimeNamespace, readFile: () => 't', fetchImpl: async (url, init) => init.method === 'GET' ? { status: 200, body: { items: [{ metadata: { name: 'x', labels: { 'in-falcone.io/tenant': 'tenant-a', 'in-falcone.io/mcp-server': 's' } } }] } } : (() => { deletes++; return { status: 409 }; })() });
  await assert.rejects(
    () => cleaner.deleteOwnedRuntimeResources({ tenantId: 'tenant-a', resourceId: 's' }),
    (error) => error.code === 'MCP_RUNTIME_DELETE_PRECONDITION_MISSING',
  );
  assert.equal(deletes, 0);
});

test('mcp-runtime-cleaner-04: non-success LIST and DELETE conflict remain retryable failures', async () => {
  for (const status of [401, 403, 500]) {
    const cleaner = createMcpRuntimeCleaner({
      apiBase: 'https://k',
      resolveRuntimeNamespace,
      readFile: () => 't',
      fetchImpl: async () => ({ status, body: JSON.stringify({ kind: 'Status', code: status }) }),
    });
    await assert.rejects(
      () => cleaner.deleteOwnedRuntimeResources({ tenantId: 'tenant-a', resourceId: 's' }),
      (error) => error.code === 'MCP_RUNTIME_LIST_FAILED' && error.statusCode === status,
    );
  }

  const cleaner = createMcpRuntimeCleaner({
    apiBase: 'https://k',
    resolveRuntimeNamespace,
    readFile: () => 't',
    fetchImpl: async (_url, init) => init.method === 'GET'
      ? { status: 200, body: { items: [{ metadata: { name: 'x', uid: 'u', resourceVersion: '7', labels: { 'in-falcone.io/tenant': 'tenant-a', 'in-falcone.io/mcp-server': 's' } } }] } }
      : { status: 409 },
  });
  await assert.rejects(
    () => cleaner.deleteOwnedRuntimeResources({ tenantId: 'tenant-a', resourceId: 's' }),
    (error) => error.code === 'MCP_RUNTIME_DELETE_CONFLICT',
  );
});
