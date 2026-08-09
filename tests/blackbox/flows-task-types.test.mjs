// Black-box test suite for change add-console-flow-designer (#363) — task-type catalog endpoint.
//
// The console flow designer's palette is driven ENTIRELY by
// GET /v1/flows/workspaces/{workspaceId}/task-types (no hardcoded task types in the UI),
// so the endpoint's contract is pinned here: shape of the descriptors, identity gating,
// and conditional registration (absent without a flowExecutor, like the rest of the
// flows family). Public HTTP surface only; Temporal is an injected fake.
//
// Tests: bbx-flows-task-types-01 .. bbx-flows-task-types-04
import test from 'node:test';
import assert from 'node:assert/strict';

import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import { createConnectionRegistry } from '../../apps/control-plane-executor/src/runtime/connection-registry.mjs';
import { createFlowExecutor } from '../../apps/control-plane-executor/src/runtime/flow-executor.mjs';

const TEN = 'ten_bbx_flow_tt';
const WS = 'ws_bbx_flow_tt';
const authHeaders = {
  'content-type': 'application/json',
  'x-api-version': '2026-03-26',
  'x-correlation-id': 'corr-bbx-flow-task-types',
  'x-tenant-id': TEN,
  'x-workspace-id': WS,
  'x-auth-subject': 'admin-flow-tt',
};

function makeFakeTemporal() {
  return {
    workflowService: {},
    workflow: {
      start: async () => ({ workflowId: 'w', firstExecutionRunId: 'r' }),
      getHandle: () => ({}),
      list: async function* () {},
    },
  };
}

function makeRegistry() {
  return createConnectionRegistry({ resolveConnection: () => ({ dsn: 'postgres://unused/none' }) });
}

async function withServer(fn, { withFlows = true } = {}) {
  const registry = makeRegistry();
  const flowExecutor = withFlows
    ? createFlowExecutor({ temporalClient: makeFakeTemporal(), temporalAddress: 'fake:7233' })
    : undefined;
  const server = createControlPlaneServer({ registry, flowExecutor, logger: { error() {} } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(baseUrl);
  } finally {
    await new Promise((r) => server.close(r));
    await registry.end().catch(() => {});
    if (flowExecutor) await flowExecutor.close().catch(() => {});
  }
}

const taskTypesPath = (ws = WS) => `/v1/flows/workspaces/${ws}/task-types`;

test('bbx-flows-task-types-01: GET returns 200 with a non-empty descriptor list', async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}${taskTypesPath()}`, { headers: authHeaders });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.items), 'response carries an items array');
    assert.ok(body.items.length > 0, 'catalog is non-empty');
  });
});

test('bbx-flows-task-types-02: every descriptor carries id, label, category and a JSON-Schema inputSchema', async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}${taskTypesPath()}`, { headers: authHeaders });
    const { items } = await res.json();
    const ids = new Set();
    for (const descriptor of items) {
      assert.equal(typeof descriptor.id, 'string');
      assert.ok(descriptor.id.length > 0);
      assert.ok(!ids.has(descriptor.id), `descriptor id "${descriptor.id}" is unique`);
      ids.add(descriptor.id);
      assert.equal(typeof descriptor.label, 'string');
      assert.equal(typeof descriptor.category, 'string');
      // The property panel generates its form from this JSON Schema object.
      assert.equal(typeof descriptor.inputSchema, 'object');
      assert.equal(descriptor.inputSchema.type, 'object');
      assert.equal(typeof descriptor.inputSchema.properties, 'object');
    }
  });
});

test('bbx-flows-task-types-03: request without tenant identity is rejected with 401', async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}${taskTypesPath()}`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.code, 'GW_UNAUTHENTICATED');
  });
});

test('bbx-flows-task-types-04: route is absent (404) when no flowExecutor is wired', async () => {
  await withServer(
    async (baseUrl) => {
      const res = await fetch(`${baseUrl}${taskTypesPath()}`, { headers: authHeaders });
      assert.equal(res.status, 404);
    },
    { withFlows: false }
  );
});
