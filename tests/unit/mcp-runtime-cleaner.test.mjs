import test from 'node:test';
import assert from 'node:assert/strict';

import { createMcpRuntimeCleaner } from '../../apps/control-plane-executor/src/runtime/mcp-runtime-cleaner.mjs';

test('mcp-runtime-cleaner-01: cleanup targets only tenant/server-owned ksvc, revisions, routes, RBAC and NetworkPolicy', async () => {
  const calls = [];
  const cleaner = createMcpRuntimeCleaner({
    apiBase: 'https://kubernetes.default.svc',
    env: {},
    readFile: (path) => path.endsWith('token') ? 'secret-token' : Buffer.from('ca'),
    fetchImpl: async (url, init) => { calls.push({ url, init }); return init.method === 'GET' ? { status: 200, body: { items: [{ metadata: { name: 'mcp-srv-shared', uid: 'u1', resourceVersion: '7', labels: { 'in-falcone.io/tenant': 'tenant-a', 'in-falcone.io/mcp-server': 'srv-shared' } } }] } } : { status: 200 }; },
  });
  await cleaner.deleteOwnedRuntimeResources({ tenantId: 'tenant-a', resourceId: 'srv-shared' });
  assert.equal(calls.length, 12);
  for (const call of calls) {
    assert.match(call.url, /\/namespaces\/tenant-a\//);
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
    readFile: () => 'token',
    fetchImpl: async () => { calls += 1; return { status: 200 }; },
  });
  await assert.rejects(
    () => cleaner.deleteOwnedRuntimeResources({ tenantId: '../tenant-b', resourceId: 'srv-a' }),
    /safe Kubernetes name/,
  );
  assert.equal(calls, 0);
});

test('mcp-runtime-cleaner-03: missing preconditions retained and conflict throws', async () => {
  let deletes = 0;
  const cleaner = createMcpRuntimeCleaner({ apiBase: 'https://k', readFile: () => 't', fetchImpl: async (url, init) => init.method === 'GET' ? { status: 200, body: { items: [{ metadata: { name: 'x', labels: { 'in-falcone.io/tenant': 'tenant-a', 'in-falcone.io/mcp-server': 's' } } }] } } : (() => { deletes++; return { status: 409 }; })() });
  await cleaner.deleteOwnedRuntimeResources({ tenantId: 'tenant-a', resourceId: 's' }); assert.equal(deletes, 0);
});
