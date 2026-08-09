// Black-box test suite for change fix-677-flow-execution-control-client-errors (#677).
//
// Flow execution cancel/signal must map a missing or already-closed Temporal run to a clean
// client error, NOT a 500 CONTROL_PLANE_ERROR. Temporal raises a WorkflowNotFoundError for BOTH
// "workflow not found for ID" (the run never existed) AND "workflow execution already completed"
// (the run is terminal), so the executor detects that error by NAME and returns:
//   - cancel  -> 404 EXECUTION_NOT_FOUND   (matches GET .../executions/{id} which already 404s)
//   - signal  -> 409 EXECUTION_NOT_RUNNING (the run described OK but is no longer signalable)
// Genuine infra errors (no WorkflowNotFoundError name / no gRPC NOT_FOUND code) must STILL surface
// as 500 — the fix must not over-catch.
//
// Public interface only: boots the real control-plane server in-process and drives the HTTP routes
// the gateway fronts at /v1/flows/workspaces/{workspaceId}/…, with an INJECTED fake Temporal client
// (no infra) and the in-memory definition/version store — the same no-infra mode the rest of the
// flows blackbox suite runs in (see flows-api.test.mjs).
//
// Tests: bbx-flows-exec-ctl-01 .. bbx-flows-exec-ctl-06
import test from 'node:test';
import assert from 'node:assert/strict';

import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import { createConnectionRegistry } from '../../apps/control-plane-executor/src/runtime/connection-registry.mjs';
import { createFlowExecutor } from '../../apps/control-plane-executor/src/runtime/flow-executor.mjs';

const TEN = 'ten_bbx_exec_ctl';
const WS = 'ws_bbx_exec_ctl';
const authHeaders = {
  'content-type': 'application/json',
  'x-api-version': '2026-03-26',
  'x-correlation-id': 'corr-bbx-flows-control',
  'x-tenant-id': TEN,
  'x-workspace-id': WS,
  'x-auth-subject': 'admin-exec-ctl',
};

// A flow with a human-approval node so the signal allowlist accepts "human-approval" and the
// sendSignal path actually reaches `source.signal(...)` (rather than short-circuiting on 422).
const APPROVAL_DEF = {
  apiVersion: 'v1.0',
  name: 'human-approval-then-publish',
  nodes: [
    { id: 'review', type: 'approval', approvers: ['role:workspace_admin'], timeout: 'P2D', next: 'publish' },
    { id: 'publish', type: 'task', taskType: 'publish-document' },
  ],
};

// A @temporalio/client-shaped fake. Each started run gets a handle; `behaviour` lets a single test
// make that handle's cancel()/signal()/describe() throw a chosen error (Temporal-shaped or generic)
// to exercise the error-mapping branches without real infra.
function makeFakeTemporal({ behaviour = {} } = {}) {
  const handles = new Map();
  const started = [];
  function handleFor(workflowId, searchAttributes) {
    return {
      workflowId,
      firstExecutionRunId: `run-${workflowId.slice(-6)}`,
      _searchAttributes: searchAttributes ?? { flowVersion: ['1'] },
      _status: behaviour.describeStatus ?? 'Running',
      async describe() {
        if (behaviour.describeThrows) throw behaviour.describeThrows;
        return {
          status: { name: this._status },
          searchAttributes: this._searchAttributes,
          startTime: '2026-01-01T00:00:00Z',
          closeTime: this._status === 'Running' ? null : '2026-01-01T00:05:00Z',
        };
      },
      async fetchHistory() {
        return { events: [] };
      },
      async cancel() {
        if (behaviour.cancelThrows) throw behaviour.cancelThrows;
        this._status = 'Cancelled';
        started.push({ cancel: workflowId });
      },
      async signal(name, payload) {
        if (behaviour.signalThrows) throw behaviour.signalThrows;
        started.push({ signal: name, payload, workflowId });
      },
    };
  }
  return {
    started,
    handles,
    workflow: {
      async start(type, opts) {
        const h = handleFor(opts.workflowId, opts.searchAttributes);
        handles.set(opts.workflowId, h);
        started.push({ type, workflowId: opts.workflowId, opts });
        return h;
      },
      getHandle(id) {
        return handles.get(id) ?? handleFor(id, { flowVersion: ['1'] });
      },
      async *list({ query }) {
        const flowMatch = /flowId = '([^']+)'/.exec(query ?? '');
        const wantRunning = /ExecutionStatus = 'Running'/.test(query ?? '');
        for (const h of handles.values()) {
          if (flowMatch && !h.workflowId.includes(`:${flowMatch[1]}:`)) continue;
          if (wantRunning && h._status !== 'Running') continue;
          yield { workflowId: h.workflowId, runId: h.firstExecutionRunId, status: { name: h._status }, startTime: 't', closeTime: null };
        }
      },
    },
  };
}

function makeRegistry() {
  return createConnectionRegistry({ resolveConnection: () => ({ dsn: 'postgres://unused/none' }) });
}

async function withFlowsServer(fn, { temporal } = {}) {
  const registry = makeRegistry();
  const flowExecutor = createFlowExecutor({
    temporalClient: temporal ?? makeFakeTemporal(),
    temporalAddress: 'fake:7233',
  });
  const server = createControlPlaneServer({ registry, flowExecutor, logger: { error() {} } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(baseUrl, flowExecutor);
  } finally {
    await new Promise((r) => server.close(r));
    await registry.end().catch(() => {});
    await flowExecutor.close().catch(() => {});
  }
}

const flowsBase = (ws = WS) => `/v1/flows/workspaces/${ws}/flows`;

// Create + publish an approval flow, start a run, and return its (encoded) executionId.
async function startApprovalRun(baseUrl) {
  const created = await (await fetch(`${baseUrl}${flowsBase()}`, {
    method: 'POST', headers: authHeaders, body: JSON.stringify({ name: 'Approval Flow', definition: APPROVAL_DEF }),
  })).json();
  await fetch(`${baseUrl}${flowsBase()}/${created.flowId}/versions`, { method: 'POST', headers: authHeaders });
  const start = await (await fetch(`${baseUrl}${flowsBase()}/${created.flowId}/executions`, {
    method: 'POST', headers: authHeaders, body: JSON.stringify({ version: 1 }),
  })).json();
  return { flowId: created.flowId, executionId: start.workflowId, eid: encodeURIComponent(start.workflowId) };
}

const NOT_FOUND_ERR = Object.assign(new Error('workflow not found for ID'), { name: 'WorkflowNotFoundError' });
const TERMINAL_ERR = Object.assign(new Error('workflow execution already completed'), { name: 'WorkflowNotFoundError' });

// bbx-flows-exec-ctl-01 (Scenario A): cancel of a run Temporal reports as not-found -> 404 (not 500).
test('bbx-flows-exec-ctl-01: cancel of a missing/closed Temporal run returns 404 EXECUTION_NOT_FOUND', async () => {
  const temporal = makeFakeTemporal({ behaviour: { cancelThrows: NOT_FOUND_ERR } });
  await withFlowsServer(async (baseUrl) => {
    const { flowId, eid } = await startApprovalRun(baseUrl);
    const res = await fetch(`${baseUrl}${flowsBase()}/${flowId}/executions/${eid}/cancellations`, { method: 'POST', headers: authHeaders });
    assert.equal(res.status, 404, 'must be a clean 404, not 500 CONTROL_PLANE_ERROR');
    const body = await res.json();
    assert.equal(body.code, 'GW_EXECUTION_NOT_FOUND');
    assert.notEqual(body.code, 'GW_CONTROL_PLANE_ERROR');
  }, { temporal });
});

// bbx-flows-exec-ctl-02 (Scenario B): signal to a run that describes OK but is terminal -> 409 (not 500).
test('bbx-flows-exec-ctl-02: signal to a terminal run returns 409 EXECUTION_NOT_RUNNING', async () => {
  const temporal = makeFakeTemporal({ behaviour: { describeStatus: 'Completed', signalThrows: TERMINAL_ERR } });
  await withFlowsServer(async (baseUrl) => {
    const { flowId, eid } = await startApprovalRun(baseUrl);
    const res = await fetch(`${baseUrl}${flowsBase()}/${flowId}/executions/${eid}/signals/human-approval`, {
      method: 'POST', headers: authHeaders, body: JSON.stringify({ approved: true, nodeId: 'review' }),
    });
    assert.equal(res.status, 409, 'must be a graceful 409, not 500 CONTROL_PLANE_ERROR');
    const body = await res.json();
    assert.equal(body.code, 'GW_EXECUTION_NOT_RUNNING');
    assert.notEqual(body.code, 'GW_CONTROL_PLANE_ERROR');
  }, { temporal });
});

// bbx-flows-exec-ctl-03 (happy path): cancel of a running run still returns 202.
test('bbx-flows-exec-ctl-03: cancel of a running execution still returns 202 (Cancelling)', async () => {
  const temporal = makeFakeTemporal();
  await withFlowsServer(async (baseUrl) => {
    const { flowId, eid } = await startApprovalRun(baseUrl);
    const res = await fetch(`${baseUrl}${flowsBase()}/${flowId}/executions/${eid}/cancellations`, { method: 'POST', headers: authHeaders });
    assert.equal(res.status, 202);
    assert.equal((await res.json()).status, 'Cancelling');
  }, { temporal });
});

// bbx-flows-exec-ctl-04 (happy path): signal of a running run still returns 202 delivered:true.
test('bbx-flows-exec-ctl-04: signal of a running execution still returns 202 (delivered)', async () => {
  const temporal = makeFakeTemporal();
  await withFlowsServer(async (baseUrl) => {
    const { flowId, eid } = await startApprovalRun(baseUrl);
    const res = await fetch(`${baseUrl}${flowsBase()}/${flowId}/executions/${eid}/signals/human-approval`, {
      method: 'POST', headers: authHeaders, body: JSON.stringify({ approved: true, nodeId: 'review' }),
    });
    assert.equal(res.status, 202);
    assert.equal((await res.json()).delivered, true);
  }, { temporal });
});

// bbx-flows-exec-ctl-05 (over-catch guard): a NON-not-found error from cancel() still surfaces 500.
test('bbx-flows-exec-ctl-05: a generic cancel() failure still surfaces 500 (not mapped to 4xx)', async () => {
  const temporal = makeFakeTemporal({ behaviour: { cancelThrows: new Error('boom') } });
  await withFlowsServer(async (baseUrl) => {
    const { flowId, eid } = await startApprovalRun(baseUrl);
    const res = await fetch(`${baseUrl}${flowsBase()}/${flowId}/executions/${eid}/cancellations`, { method: 'POST', headers: authHeaders });
    assert.equal(res.status, 500, 'genuine infra errors must NOT be swallowed as a client error');
    assert.equal((await res.json()).code, 'GW_CONTROL_PLANE_ERROR');
  }, { temporal });
});

// bbx-flows-exec-ctl-06 (over-catch guard): a NON-not-found error from signal() still surfaces 500.
test('bbx-flows-exec-ctl-06: a generic signal() failure still surfaces 500 (not mapped to 4xx)', async () => {
  const temporal = makeFakeTemporal({ behaviour: { signalThrows: new Error('boom') } });
  await withFlowsServer(async (baseUrl) => {
    const { flowId, eid } = await startApprovalRun(baseUrl);
    const res = await fetch(`${baseUrl}${flowsBase()}/${flowId}/executions/${eid}/signals/human-approval`, {
      method: 'POST', headers: authHeaders, body: JSON.stringify({ approved: true, nodeId: 'review' }),
    });
    assert.equal(res.status, 500, 'genuine infra errors must NOT be swallowed as a client error');
    assert.equal((await res.json()).code, 'GW_CONTROL_PLANE_ERROR');
  }, { temporal });
});
