// bbx-flows-ten-iso
//
// Two-tenant cross-tenant isolation probe suite for change add-flows-tenancy-isolation-limits.
// Drives the PUBLIC flows HTTP surface only, through the control-plane server, with distinct
// gateway-injected identities for TENANT_A and TENANT_B (the executor derives tenant + workspace
// ONLY from resolveIdentity, never from the request body or path). Every cross-tenant probe MUST
// return 404/403 with ZERO tenant data leakage in the response body.
//
// Covers every flows route + execution observation path (workflows spec: "Cross-tenant isolation
// probe suite covers all flows routes and execution paths") plus the tenant-isolation capability
// deltas: visibility-query filter-injection resistance and forged-workflow-ID interception
// before any Temporal RPC.
//
// Scenarios:
//   bbx-flows-ten-iso-01: A list-flows targeting B's workspace → scoped to A (no B data)
//   bbx-flows-ten-iso-02: A get-flow of a B-owned flow → 404, no flow data
//   bbx-flows-ten-iso-03: A start-execution against a B-owned flow → 404
//   bbx-flows-ten-iso-04: A get-execution-detail with tenantB: workflowId → 404, no Temporal RPC
//   bbx-flows-ten-iso-05: list-executions with injected tenantId filter override → only A's runs
//   bbx-flows-ten-iso-06: A send-signal with tenantB: workflowId → 404/403, no Temporal RPC
//   bbx-flows-ten-iso-07: A cancel + retry with tenantB: workflowId → 404/403, no Temporal RPC
//   bbx-flows-ten-iso-08: A get-execution-history with tenantB: workflowId → 404, no Temporal RPC
//   bbx-flows-ten-iso-09: forged UUID-shaped tenantB: workflowId → 404 with NO Temporal RPC (spy)
//   bbx-flows-ten-iso-10: error bodies never contain another tenant's identifiers
import test from 'node:test';
import assert from 'node:assert/strict';

import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import { createConnectionRegistry } from '../../apps/control-plane-executor/src/runtime/connection-registry.mjs';
import { createFlowExecutor } from '../../apps/control-plane-executor/src/runtime/flow-executor.mjs';

const DEF = {
  apiVersion: 'v1.0',
  name: 'f',
  nodes: [{ id: 'a', type: 'task', taskType: 't', next: 'b' }, { id: 'b', type: 'task', taskType: 't' }],
};

const headersFor = (tenant, ws) => ({
  'content-type': 'application/json',
  'x-tenant-id': tenant,
  'x-workspace-id': ws,
  'x-auth-subject': `admin-${tenant}`,
});
const A = headersFor('tenant_A', 'ws_A');
const B = headersFor('tenant_B', 'ws_B');

// A fake Temporal client that COUNTS rpc calls so a probe can assert "no Temporal RPC was made"
// when a forged/foreign workflow id is intercepted at the API layer.
function makeSpyTemporal() {
  const handles = new Map();
  const rpc = { describe: 0, fetchHistory: 0, cancel: 0, signal: 0, start: 0, list: 0 };
  function handleFor(workflowId, sa) {
    return {
      workflowId,
      firstExecutionRunId: `run-${workflowId.slice(-6)}`,
      _sa: sa ?? { flowVersion: ['1'] },
      _status: 'Running',
      async describe() { rpc.describe += 1; return { status: { name: this._status }, searchAttributes: this._sa, startTime: 't', closeTime: null }; },
      async fetchHistory() { rpc.fetchHistory += 1; return { events: [{ eventId: 1, activityTaskScheduledEventAttributes: { activityId: 'a' } }] }; },
      async cancel() { rpc.cancel += 1; this._status = 'Cancelled'; },
      async signal() { rpc.signal += 1; },
    };
  }
  return {
    rpc,
    workflow: {
      async start(type, opts) { rpc.start += 1; const h = handleFor(opts.workflowId, opts.searchAttributes); handles.set(opts.workflowId, h); return h; },
      getHandle(id) { return handles.get(id) ?? handleFor(id); },
      async *list() { rpc.list += 1; for (const h of handles.values()) yield { workflowId: h.workflowId, runId: h.firstExecutionRunId, status: { name: h._status } }; },
    },
  };
}

function makeRegistry() {
  return createConnectionRegistry({ resolveConnection: () => ({ dsn: 'postgres://unused/none' }) });
}

async function withServer(fn) {
  const registry = makeRegistry();
  const temporal = makeSpyTemporal();
  const flowExecutor = createFlowExecutor({ temporalClient: temporal, temporalAddress: 'fake:7233' });
  const server = createControlPlaneServer({ registry, flowExecutor, logger: { error() {} } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(baseUrl, temporal);
  } finally {
    await new Promise((r) => server.close(r));
    await registry.end().catch(() => {});
    await flowExecutor.close().catch(() => {});
  }
}

async function seedFlow(baseUrl, headers, ws) {
  const res = await fetch(`${baseUrl}/v1/flows/workspaces/${ws}/flows`, {
    method: 'POST', headers, body: JSON.stringify({ name: 'A flow', definition: DEF }),
  });
  return (await res.json()).flowId;
}

async function seedRunningExecution(baseUrl, headers, ws, flowId) {
  await fetch(`${baseUrl}/v1/flows/workspaces/${ws}/flows/${flowId}/versions`, { method: 'POST', headers });
  const start = await (await fetch(`${baseUrl}/v1/flows/workspaces/${ws}/flows/${flowId}/executions`, {
    method: 'POST', headers, body: JSON.stringify({ version: 1 }),
  })).json();
  return start.workflowId;
}

// A forged workflow id with a valid UUID structure but a tenant_B prefix.
const FORGED_B_WORKFLOW_ID = 'tenant_B:ws_B:flow_x:00000000-0000-4000-8000-000000000000';

function assertNoTenantBLeak(body) {
  const text = JSON.stringify(body);
  assert.ok(!text.includes('tenant_B'), `error body must not leak tenant_B: ${text}`);
  assert.ok(!text.includes('ws_B'), `error body must not leak ws_B: ${text}`);
}

test('bbx-flows-ten-iso-01: list-flows targeting B workspace is scoped to A (no B data)', async () => {
  await withServer(async (baseUrl) => {
    const flowB = await seedFlow(baseUrl, B, 'ws_B');
    // A lists, even spoofing B's workspace in the path — identity (A) wins; sees none of B's flows.
    const listA = await (await fetch(`${baseUrl}/v1/flows/workspaces/ws_B/flows`, { headers: A })).json();
    assert.equal(listA.items.length, 0);
    assert.ok(!JSON.stringify(listA).includes(flowB));
  });
});

test('bbx-flows-ten-iso-02: get-flow of a B-owned flow returns 404 with no flow data', async () => {
  await withServer(async (baseUrl) => {
    const flowB = await seedFlow(baseUrl, B, 'ws_B');
    const res = await fetch(`${baseUrl}/v1/flows/workspaces/ws_B/flows/${flowB}`, { headers: A });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.code, 'GW_FLOW_NOT_FOUND');
    assert.ok(!('definition' in body) && !('name' in body));
  });
});

test('bbx-flows-ten-iso-03: start-execution against a B-owned flow returns 404', async () => {
  await withServer(async (baseUrl) => {
    const flowB = await seedFlow(baseUrl, B, 'ws_B');
    await fetch(`${baseUrl}/v1/flows/workspaces/ws_B/flows/${flowB}/versions`, { method: 'POST', headers: B });
    // A starts an execution addressing B's flow id → A has no such flow → VERSION_NOT_FOUND/404.
    const res = await fetch(`${baseUrl}/v1/flows/workspaces/ws_B/flows/${flowB}/executions`, {
      method: 'POST', headers: A, body: JSON.stringify({ version: 1 }),
    });
    assert.ok(res.status === 404 || res.status === 403, `got ${res.status}`);
  });
});

test('bbx-flows-ten-iso-04: get-execution-detail with tenantB workflowId returns 404, no Temporal RPC', async () => {
  await withServer(async (baseUrl, temporal) => {
    const flowB = await seedFlow(baseUrl, B, 'ws_B');
    const wfB = await seedRunningExecution(baseUrl, B, 'ws_B', flowB);
    const before = temporal.rpc.describe + temporal.rpc.fetchHistory;
    const flowA = await seedFlow(baseUrl, A, 'ws_A');
    const res = await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows/${flowA}/executions/${encodeURIComponent(wfB)}`, { headers: A });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.code, 'GW_EXECUTION_NOT_FOUND');
    assertNoTenantBLeak(body);
    assert.equal(temporal.rpc.describe + temporal.rpc.fetchHistory, before, 'no Temporal RPC for a foreign execution detail');
  });
});

test('bbx-flows-ten-iso-05: list-executions with injected tenantId filter override returns only A runs', async () => {
  await withServer(async (baseUrl) => {
    const flowA = await seedFlow(baseUrl, A, 'ws_A');
    await seedRunningExecution(baseUrl, A, 'ws_A', flowA);
    const flowB = await seedFlow(baseUrl, B, 'ws_B');
    await seedRunningExecution(baseUrl, B, 'ws_B', flowB);

    // A crafts a query that tries to override the tenant filter to tenant_B.
    const crafted = encodeURIComponent("tenantId = 'tenant_B' OR workspaceId = 'ws_B'");
    const res = await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows/${flowA}/executions?query=${crafted}`, { headers: A });
    assert.equal(res.status, 200);
    const body = await res.json();
    for (const item of body.items) {
      assert.match(item.workflowId, /^tenant_A:/, 'only tenant A runs surface despite the injected filter');
    }
    assertNoTenantBLeak(body);
  });
});

test('bbx-flows-ten-iso-06: send-signal with tenantB workflowId returns 403, no Temporal RPC', async () => {
  await withServer(async (baseUrl, temporal) => {
    const flowA = await seedFlow(baseUrl, A, 'ws_A');
    const before = temporal.rpc.signal + temporal.rpc.describe;
    const res = await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows/${flowA}/executions/${encodeURIComponent(FORGED_B_WORKFLOW_ID)}/signals/human-approval`, {
      method: 'POST', headers: A, body: JSON.stringify({ approved: true }),
    });
    assert.ok(res.status === 403 || res.status === 404, `got ${res.status}`);
    assertNoTenantBLeak(await res.json());
    assert.equal(temporal.rpc.signal + temporal.rpc.describe, before, 'no Temporal RPC for a foreign signal');
  });
});

test('bbx-flows-ten-iso-07: cancel + retry with tenantB workflowId returns 403, no Temporal RPC', async () => {
  await withServer(async (baseUrl, temporal) => {
    const flowA = await seedFlow(baseUrl, A, 'ws_A');
    const beforeCancel = temporal.rpc.cancel;
    const beforeStart = temporal.rpc.start;
    const cancel = await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows/${flowA}/executions/${encodeURIComponent(FORGED_B_WORKFLOW_ID)}/cancellations`, { method: 'POST', headers: A });
    assert.ok(cancel.status === 403 || cancel.status === 404);
    const retry = await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows/${flowA}/executions/${encodeURIComponent(FORGED_B_WORKFLOW_ID)}/retries`, { method: 'POST', headers: A });
    assert.ok(retry.status === 403 || retry.status === 404);
    assert.equal(temporal.rpc.cancel, beforeCancel, 'no cancel RPC for a foreign workflow');
    assert.equal(temporal.rpc.start, beforeStart, 'no retry start RPC for a foreign workflow');
  });
});

test('bbx-flows-ten-iso-08: get-execution-history with tenantB workflowId returns 404, no Temporal RPC', async () => {
  await withServer(async (baseUrl, temporal) => {
    const flowA = await seedFlow(baseUrl, A, 'ws_A');
    const before = temporal.rpc.fetchHistory + temporal.rpc.describe;
    // The detail endpoint also surfaces history events; a foreign id is intercepted first.
    const res = await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows/${flowA}/executions/${encodeURIComponent(FORGED_B_WORKFLOW_ID)}`, { headers: A });
    assert.equal(res.status, 404);
    assert.equal(temporal.rpc.fetchHistory + temporal.rpc.describe, before, 'no history RPC for a foreign execution');
  });
});

test('bbx-flows-ten-iso-09: forged UUID-shaped tenantB workflowId returns 404 with NO Temporal RPC', async () => {
  await withServer(async (baseUrl, temporal) => {
    const flowA = await seedFlow(baseUrl, A, 'ws_A');
    const totalBefore = temporal.rpc.describe + temporal.rpc.fetchHistory + temporal.rpc.cancel + temporal.rpc.signal;
    const res = await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows/${flowA}/executions/${encodeURIComponent(FORGED_B_WORKFLOW_ID)}`, { headers: A });
    assert.equal(res.status, 404);
    const totalAfter = temporal.rpc.describe + temporal.rpc.fetchHistory + temporal.rpc.cancel + temporal.rpc.signal;
    assert.equal(totalAfter, totalBefore, 'a forged foreign workflow id never reaches Temporal');
  });
});

test('bbx-flows-ten-iso-10: every cross-tenant error body is free of the other tenant identifiers', async () => {
  await withServer(async (baseUrl) => {
    const flowB = await seedFlow(baseUrl, B, 'ws_B');
    const probes = [
      fetch(`${baseUrl}/v1/flows/workspaces/ws_B/flows/${flowB}`, { headers: A }),
      fetch(`${baseUrl}/v1/flows/workspaces/ws_B/flows/${flowB}/versions/1`, { headers: A }),
      fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows/x/executions/${encodeURIComponent(FORGED_B_WORKFLOW_ID)}`, { headers: A }),
    ];
    for (const p of probes) {
      const res = await p;
      assert.ok(res.status >= 400, `cross-tenant probe must be denied (got ${res.status})`);
      assertNoTenantBLeak(await res.json());
    }
  });
});
