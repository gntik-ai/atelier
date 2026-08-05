// bbx-flows-ten-quota
//
// Per-tenant / per-workspace flow quota enforcement for change
// add-flows-tenancy-isolation-limits. Drives the PUBLIC flows HTTP surface through the
// control-plane server with an INJECTED quota gate (a deterministic fake evaluator), so the test
// proves the 429 + dimension contract and noisy-neighbor isolation without a live quota DB.
//
// The five dimensions (design D6): max_flows, max_flow_versions, max_concurrent_executions,
// flow_starts_per_minute, flow_signal_rate_per_minute.
//
// Scenarios:
//   bbx-flows-ten-quota-01: max_concurrent_executions hard limit → 429 QUOTA_EXCEEDED + dimension
//   bbx-flows-ten-quota-02: tenant B unaffected while tenant A is at its concurrency limit
//   bbx-flows-ten-quota-03: max_flows hard limit → flow-create 429
//   bbx-flows-ten-quota-04: max_flow_versions hard limit → publish 429
//   bbx-flows-ten-quota-05: flow_starts_per_minute hard limit → start 429, NO Temporal workflow
//   bbx-flows-ten-quota-06: unmetered (no gate) → starts succeed (default black-box mode)
//   bbx-flows-ten-quota-07: the five flow quota dimension keys are the documented set
import test from 'node:test';
import assert from 'node:assert/strict';

import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import { createConnectionRegistry } from '../../apps/control-plane-executor/src/runtime/connection-registry.mjs';
import { createFlowExecutor } from '../../apps/control-plane-executor/src/runtime/flow-executor.mjs';
import { createFlowQuotaGate, FLOW_QUOTA_DIMENSIONS } from '../../apps/control-plane-executor/src/runtime/flow-quota-gate.mjs';

const DEF = { apiVersion: 'v1.0', name: 'f', nodes: [{ id: 'a', type: 'task', taskType: 't' }] };
const headersFor = (t, w) => ({ 'content-type': 'application/json', 'x-tenant-id': t, 'x-workspace-id': w, 'x-auth-subject': `admin-${t}` });
const A = headersFor('tenant_A', 'ws_A');
const B = headersFor('tenant_B', 'ws_B');

function makeFakeTemporal() {
  const handles = new Map();
  let startCount = 0;
  const h = (id, sa) => ({ workflowId: id, firstExecutionRunId: `run-${id.slice(-4)}`, _sa: sa ?? { flowVersion: ['1'] }, _status: 'Running',
    async describe() { return { status: { name: this._status }, searchAttributes: this._sa, startTime: 't', closeTime: null }; },
    async fetchHistory() { return { events: [] }; }, async cancel() {}, async signal() {} });
  return {
    get startCount() { return startCount; },
    workflow: {
      async start(type, opts) { startCount += 1; const x = h(opts.workflowId, opts.searchAttributes); handles.set(opts.workflowId, x); return x; },
      getHandle(id) { return handles.get(id) ?? h(id); },
      async *list() { for (const x of handles.values()) yield { workflowId: x.workflowId, runId: x.firstExecutionRunId, status: { name: x._status } }; },
    },
  };
}

// A quota gate evaluator that DENIES the configured dimension for the configured tenant, and
// ALLOWS everything else. Lets a test pin "tenant A is at its max_concurrent_executions limit".
function denyingEvaluator({ denyTenant, denyDimension }) {
  return ({ dimensionKey, tenantId }) => {
    if (tenantId === denyTenant && dimensionKey === denyDimension) {
      return { allowed: false, decision: 'hard_blocked', effectiveLimit: 0, currentUsage: 1 };
    }
    return { allowed: true, decision: 'allowed' };
  };
}

async function withServer(fn, { gate } = {}) {
  const registry = createConnectionRegistry({ resolveConnection: () => ({ dsn: 'postgres://unused/none' }) });
  const temporal = makeFakeTemporal();
  const flowExecutor = createFlowExecutor({ temporalClient: temporal, temporalAddress: 'fake:7233', quotaGate: gate });
  const server = createControlPlaneServer({ registry, flowExecutor, logger: { error() {} } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try { return await fn(baseUrl, temporal); }
  finally { await new Promise((r) => server.close(r)); await registry.end().catch(() => {}); await flowExecutor.close().catch(() => {}); }
}

async function seedPublishedFlow(baseUrl, headers, ws) {
  const flowId = (await (await fetch(`${baseUrl}/v1/flows/workspaces/${ws}/flows`, { method: 'POST', headers, body: JSON.stringify({ name: 'f', definition: DEF }) })).json()).flowId;
  await fetch(`${baseUrl}/v1/flows/workspaces/${ws}/flows/${flowId}/versions`, { method: 'POST', headers });
  return flowId;
}

test('bbx-flows-ten-quota-01: max_concurrent_executions hard limit → 429 with dimension', async () => {
  const gate = createFlowQuotaGate({ evaluate: denyingEvaluator({ denyTenant: 'tenant_A', denyDimension: 'max_concurrent_executions' }) });
  await withServer(async (baseUrl, temporal) => {
    const flowA = await seedPublishedFlow(baseUrl, A, 'ws_A');
    const before = temporal.startCount;
    const res = await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows/${flowA}/executions`, { method: 'POST', headers: A, body: JSON.stringify({ version: 1 }) });
    assert.equal(res.status, 429);
    const body = await res.json();
    assert.equal(body.code, 'GW_QUOTA_EXCEEDED');
    assert.equal(body.detail?.dimension, 'max_concurrent_executions');
    assert.equal(temporal.startCount, before, 'no Temporal workflow started when over the limit');
  }, { gate });
});

test('bbx-flows-ten-quota-02: tenant B unaffected while tenant A is at its concurrency limit', async () => {
  const gate = createFlowQuotaGate({ evaluate: denyingEvaluator({ denyTenant: 'tenant_A', denyDimension: 'max_concurrent_executions' }) });
  await withServer(async (baseUrl) => {
    const flowA = await seedPublishedFlow(baseUrl, A, 'ws_A');
    const flowB = await seedPublishedFlow(baseUrl, B, 'ws_B');
    const resA = await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows/${flowA}/executions`, { method: 'POST', headers: A, body: JSON.stringify({ version: 1 }) });
    assert.equal(resA.status, 429, 'tenant A is throttled');
    const resB = await fetch(`${baseUrl}/v1/flows/workspaces/ws_B/flows/${flowB}/executions`, { method: 'POST', headers: B, body: JSON.stringify({ version: 1 }) });
    assert.equal(resB.status, 201, 'tenant B with headroom is unaffected by tenant A rate state');
  }, { gate });
});

test('bbx-flows-ten-quota-03: max_flows hard limit → flow-create 429', async () => {
  const gate = createFlowQuotaGate({ evaluate: denyingEvaluator({ denyTenant: 'tenant_A', denyDimension: 'max_flows' }) });
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows`, { method: 'POST', headers: A, body: JSON.stringify({ name: 'f', definition: DEF }) });
    assert.equal(res.status, 429);
    assert.equal((await res.json()).detail?.dimension, 'max_flows');
  }, { gate });
});

test('bbx-flows-ten-quota-04: max_flow_versions hard limit → publish 429', async () => {
  const gate = createFlowQuotaGate({ evaluate: denyingEvaluator({ denyTenant: 'tenant_A', denyDimension: 'max_flow_versions' }) });
  await withServer(async (baseUrl) => {
    const flowId = (await (await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows`, { method: 'POST', headers: A, body: JSON.stringify({ name: 'f', definition: DEF }) })).json()).flowId;
    const res = await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows/${flowId}/versions`, { method: 'POST', headers: A });
    assert.equal(res.status, 429);
    assert.equal((await res.json()).detail?.dimension, 'max_flow_versions');
  }, { gate });
});

test('bbx-flows-ten-quota-05: flow_starts_per_minute hard limit → start 429, no Temporal workflow', async () => {
  const gate = createFlowQuotaGate({ evaluate: denyingEvaluator({ denyTenant: 'tenant_A', denyDimension: 'flow_starts_per_minute' }) });
  await withServer(async (baseUrl, temporal) => {
    const flowA = await seedPublishedFlow(baseUrl, A, 'ws_A');
    const before = temporal.startCount;
    const res = await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows/${flowA}/executions`, { method: 'POST', headers: A, body: JSON.stringify({ version: 1 }) });
    assert.equal(res.status, 429);
    assert.equal((await res.json()).detail?.dimension, 'flow_starts_per_minute');
    assert.equal(temporal.startCount, before);
  }, { gate });
});

test('bbx-flows-ten-quota-06: unmetered (no gate) → starts succeed', async () => {
  await withServer(async (baseUrl) => {
    const flowA = await seedPublishedFlow(baseUrl, A, 'ws_A');
    const res = await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows/${flowA}/executions`, { method: 'POST', headers: A, body: JSON.stringify({ version: 1 }) });
    assert.equal(res.status, 201);
  });
});

test('bbx-flows-ten-quota-07: the five flow quota dimension keys are the documented set', () => {
  assert.deepEqual(
    Object.values(FLOW_QUOTA_DIMENSIONS).sort(),
    ['flow_signal_rate_per_minute', 'flow_starts_per_minute', 'max_concurrent_executions', 'max_flow_versions', 'max_flows'],
  );
});
