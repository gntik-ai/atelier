// Black-box test suite for change add-flows-control-plane-api (#361) — tenant isolation,
// server wiring, and version pinning.
//
// Cross-tenant probes use distinct gateway-injected identities (the executor derives tenant +
// workspace ONLY from resolveIdentity, never from the request body or path). Probes assert a
// tenant can never see or act on another tenant's flows, versions, or executions.
//
// Tests: bbx-flows-iso-01 .. bbx-flows-iso-09
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
  'x-api-version': '2026-03-26',
  'x-correlation-id': 'corr-bbx-flow-isolation',
  'x-tenant-id': tenant,
  'x-workspace-id': ws,
  'x-auth-subject': `admin-${tenant}`,
});
const A = headersFor('tenant_A', 'ws_A');
const B = headersFor('tenant_B', 'ws_B');

function makeFakeTemporal() {
  const handles = new Map();
  function handleFor(workflowId, sa) {
    return {
      workflowId,
      firstExecutionRunId: `run-${workflowId.slice(-6)}`,
      _sa: sa ?? { flowVersion: ['1'] },
      _status: 'Running',
      async describe() { return { status: { name: this._status }, searchAttributes: this._sa, startTime: 't', closeTime: null }; },
      async fetchHistory() { return { events: [{ eventId: 1, activityTaskScheduledEventAttributes: { activityId: 'a' } }] }; },
      async cancel() { this._status = 'Cancelled'; },
      async signal() {},
    };
  }
  return {
    handles,
    workflow: {
      async start(type, opts) { const h = handleFor(opts.workflowId, opts.searchAttributes); handles.set(opts.workflowId, h); return h; },
      getHandle(id) { return handles.get(id) ?? handleFor(id); },
      async *list() { for (const h of handles.values()) yield { workflowId: h.workflowId, runId: h.firstExecutionRunId, status: { name: h._status } }; },
    },
  };
}

function makeRegistry() {
  return createConnectionRegistry({ resolveConnection: () => ({ dsn: 'postgres://unused/none' }) });
}

async function withServer(fn, { withFlows = true } = {}) {
  const registry = makeRegistry();
  const flowExecutor = withFlows ? createFlowExecutor({ temporalClient: makeFakeTemporal(), temporalAddress: 'fake:7233' }) : undefined;
  const server = createControlPlaneServer({ registry, flowExecutor, logger: { error() {} } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(baseUrl, flowExecutor);
  } finally {
    await new Promise((r) => server.close(r));
    await registry.end().catch(() => {});
    await flowExecutor?.close().catch(() => {});
  }
}

// Tenant A creates a flow in their workspace; returns its flowId.
async function seedFlow(baseUrl, headers, ws) {
  const res = await fetch(`${baseUrl}/v1/flows/workspaces/${ws}/flows`, {
    method: 'POST', headers, body: JSON.stringify({ name: 'A flow', definition: DEF }),
  });
  return (await res.json()).flowId;
}

// bbx-flows-iso-01: tenant B cannot GET tenant A's flow → 404, no data disclosed.
test('bbx-flows-iso-01: cross-tenant GET definition returns 404 with no data', async () => {
  await withServer(async (baseUrl) => {
    const flowId = await seedFlow(baseUrl, A, 'ws_A');
    // B addresses A's flow id, even spoofing A's workspace in the path. Identity (B) wins.
    const res = await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows/${flowId}`, { headers: B });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.code, 'GW_FLOW_NOT_FOUND');
    assert.ok(!('name' in body) && !('definition' in body), 'no flow data leaked');
  });
});

// bbx-flows-iso-02: tenant B's list never contains tenant A's flows.
test('bbx-flows-iso-02: list is scoped to the requesting tenant', async () => {
  await withServer(async (baseUrl) => {
    await seedFlow(baseUrl, A, 'ws_A');
    const listB = await (await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows`, { headers: B })).json();
    assert.equal(listB.items.length, 0, "B sees none of A's flows even when addressing A's workspace");
  });
});

// bbx-flows-iso-03: cross-tenant version get/list returns 404 / empty.
test('bbx-flows-iso-03: cross-tenant version access is denied', async () => {
  await withServer(async (baseUrl) => {
    const flowId = await seedFlow(baseUrl, A, 'ws_A');
    await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows/${flowId}/versions`, { method: 'POST', headers: A });
    // B tries to read A's version
    const ver = await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows/${flowId}/versions/1`, { headers: B });
    assert.equal(ver.status, 404);
    // B tries to list A's versions → FLOW_NOT_FOUND (the flow is not B's)
    const list = await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows/${flowId}/versions`, { headers: B });
    assert.equal(list.status, 404);
  });
});

// bbx-flows-iso-04: cross-tenant execution detail returns 404 (workflow-ID prefix mismatch).
test('bbx-flows-iso-04: cross-tenant execution detail returns 404', async () => {
  await withServer(async (baseUrl) => {
    const flowId = await seedFlow(baseUrl, A, 'ws_A');
    await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows/${flowId}/versions`, { method: 'POST', headers: A });
    const start = await (await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows/${flowId}/executions`, {
      method: 'POST', headers: A, body: JSON.stringify({ version: 1 }),
    })).json();
    // B requests A's execution by its (tenant_A-prefixed) workflow id
    const eid = encodeURIComponent(start.workflowId);
    const detail = await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows/${flowId}/executions/${eid}`, { headers: B });
    assert.equal(detail.status, 404);
    assert.equal((await detail.json()).code, 'GW_EXECUTION_NOT_FOUND');
  });
});

// bbx-flows-iso-05: cross-tenant cancel/signal returns 403 (prefix mismatch, no Temporal call).
test('bbx-flows-iso-05: cross-tenant cancel and signal return 403', async () => {
  await withServer(async (baseUrl) => {
    const flowId = await seedFlow(baseUrl, A, 'ws_A');
    await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows/${flowId}/versions`, { method: 'POST', headers: A });
    const start = await (await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows/${flowId}/executions`, {
      method: 'POST', headers: A, body: JSON.stringify({ version: 1 }),
    })).json();
    const eid = encodeURIComponent(start.workflowId);

    const cancel = await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows/${flowId}/executions/${eid}/cancellations`, { method: 'POST', headers: B });
    assert.equal(cancel.status, 403);
    assert.equal((await cancel.json()).code, 'GW_FORBIDDEN');

    const signal = await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows/${flowId}/executions/${eid}/signals/human-approval`, {
      method: 'POST', headers: B, body: JSON.stringify({ approved: true }),
    });
    assert.equal(signal.status, 403);
  });
});

// bbx-flows-iso-06: execution list injects the identity tenantId; foreign runs filtered out.
test('bbx-flows-iso-06: execution list never returns another tenant runs', async () => {
  await withServer(async (baseUrl) => {
    const flowA = await seedFlow(baseUrl, A, 'ws_A');
    await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows/${flowA}/versions`, { method: 'POST', headers: A });
    await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows/${flowA}/executions`, { method: 'POST', headers: A, body: JSON.stringify({ version: 1 }) });

    // B starts their OWN flow/run so the fake Temporal has a B run too.
    const flowB = await seedFlow(baseUrl, B, 'ws_B');
    await fetch(`${baseUrl}/v1/flows/workspaces/ws_B/flows/${flowB}/versions`, { method: 'POST', headers: B });
    await fetch(`${baseUrl}/v1/flows/workspaces/ws_B/flows/${flowB}/executions`, { method: 'POST', headers: B, body: JSON.stringify({ version: 1 }) });

    // B lists executions for THEIR flow → must contain only B-prefixed runs.
    const listB = await (await fetch(`${baseUrl}/v1/flows/workspaces/ws_B/flows/${flowB}/executions`, { headers: B })).json();
    for (const item of listB.items) {
      assert.match(item.workflowId, /^tenant_B:/, 'only tenant B workflow ids surface to B');
    }
  });
});

// bbx-flows-iso-07: version pinning — start on v1, publish v2, detail still reports v1.
test('bbx-flows-iso-07: version pinning — v1 run reports v1 after v2 is published', async () => {
  await withServer(async (baseUrl) => {
    const flowId = await seedFlow(baseUrl, A, 'ws_A');
    await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows/${flowId}/versions`, { method: 'POST', headers: A }); // v1
    const start = await (await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows/${flowId}/executions`, {
      method: 'POST', headers: A, body: JSON.stringify({ version: 1 }),
    })).json();
    assert.equal(start.version, 1);
    // publish v2 AFTER starting the v1 run
    const pub2 = await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows/${flowId}/versions`, { method: 'POST', headers: A });
    assert.equal((await pub2.json()).version, 2);
    // the v1 run's detail still reports flowVersion 1 (search attribute stamped at start)
    const detail = await (await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows/${flowId}/executions/${encodeURIComponent(start.workflowId)}`, { headers: A })).json();
    assert.equal(String(detail.version), '1', 'the in-flight v1 run is unaffected by publishing v2');
  });
});

// bbx-flows-iso-08: server OMITS flows routes when no flowExecutor is wired → 404 NO_ROUTE.
test('bbx-flows-iso-08: flows routes are absent when no flowExecutor is injected', async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows`, { headers: A });
    assert.equal(res.status, 404);
    assert.equal((await res.json()).code, 'GW_NO_ROUTE', 'falls through to the standalone 404 path');
    // healthz still works
    const health = await fetch(`${baseUrl}/healthz`);
    assert.equal(health.status, 200);
  }, { withFlows: false });
});

// bbx-flows-iso-09: existing executor routes are unaffected when flowExecutor is present.
test('bbx-flows-iso-09: healthz + an unmatched non-flows path behave normally with flowExecutor wired', async () => {
  await withServer(async (baseUrl) => {
    const health = await fetch(`${baseUrl}/healthz`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, 'ok');
    // a non-flows path with no upstream still 404s NO_ROUTE (proxy fall-through unchanged)
    const other = await fetch(`${baseUrl}/v1/some/unmatched/path`, { headers: A });
    assert.equal(other.status, 404);
    assert.equal((await other.json()).code, 'GW_NO_ROUTE');
  });
});
