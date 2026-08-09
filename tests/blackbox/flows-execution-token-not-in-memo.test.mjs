// fix-flow-execution-token-at-rest (#633)
//
// The per-execution flow auth token (an HMAC bearer credential) was mirrored into the Temporal
// workflow memo as json/plain — unencrypted — despite a comment claiming it was "encrypted by
// Temporal" (no PayloadCodec is configured). Anyone with Temporal visibility access could read it.
// The memo copy was redundant: the worker reads the token from the workflow ARGS (tenant
// envelope), never the memo. The fix drops the memo. This boots the real control-plane server with
// an injected fake Temporal client that records every workflow.start(), publishes a flow, starts an
// execution, and asserts the memo carries no token while the args still do.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import { createConnectionRegistry } from '../../apps/control-plane-executor/src/runtime/connection-registry.mjs';
import { createFlowExecutor } from '../../apps/control-plane-executor/src/runtime/flow-executor.mjs';

const TEN = 'ten_memo';
const WS = 'ws_memo';
const authHeaders = {
  'content-type': 'application/json',
  'x-api-version': '2026-03-26',
  'x-correlation-id': 'corr-bbx-flow-memo',
  'x-tenant-id': TEN,
  'x-workspace-id': WS,
  'x-auth-subject': 'admin',
};
const DEF = { apiVersion: 'v1.0', name: 'memo-flow', nodes: [{ id: 's1', type: 'task', taskType: 'fetch-record' }] };

// Minimal @temporalio/client-shaped fake that records every start()'s opts.
function makeFakeTemporal() {
  const started = [];
  const handles = new Map();
  const handle = (workflowId, sa) => ({
    workflowId,
    firstExecutionRunId: `run-${workflowId.slice(-6)}`,
    async describe() { return { status: { name: 'Running' }, searchAttributes: sa ?? { flowVersion: ['1'] } }; },
    async fetchHistory() { return { events: [] }; },
    async cancel() {},
    async signal() {},
  });
  return {
    started,
    workflow: {
      async start(type, opts) {
        if (handles.has(opts.workflowId)) {
          throw Object.assign(new Error('already started'), { name: 'WorkflowExecutionAlreadyStartedError' });
        }
        const h = handle(opts.workflowId, opts.searchAttributes);
        handles.set(opts.workflowId, h);
        started.push({ type, opts });
        return h;
      },
      getHandle(id) { return handles.get(id) ?? handle(id, { flowVersion: ['1'] }); },
      async *list() { /* no running executions */ },
    },
  };
}

function makeRegistry() {
  return createConnectionRegistry({ resolveConnection: () => ({ dsn: 'postgres://unused/none' }) });
}

async function withServer(fn) {
  const temporal = makeFakeTemporal();
  const registry = makeRegistry();
  const flowExecutor = createFlowExecutor({ temporalClient: temporal, temporalAddress: 'fake:7233' });
  const server = createControlPlaneServer({ registry, flowExecutor, logger: { error() {} } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try { return await fn({ baseUrl, temporal }); } finally {
    await new Promise((r) => server.close(r));
    await registry.end().catch(() => {});
    await flowExecutor.close().catch(() => {});
  }
}

const flowsBase = `/v1/flows/workspaces/${WS}/flows`;

test('bbx-flow-memo-01: starting an execution does NOT write the execution token into the Temporal memo', async () => {
  await withServer(async ({ baseUrl, temporal }) => {
    const create = await fetch(`${baseUrl}${flowsBase}`, { method: 'POST', headers: authHeaders, body: JSON.stringify({ name: 'memo-flow', definition: DEF }) });
    const createBody = await create.json();
    assert.equal(create.status, 201, JSON.stringify(createBody));
    const { flowId } = createBody;

    const pub = await fetch(`${baseUrl}${flowsBase}/${flowId}/versions`, { method: 'POST', headers: authHeaders });
    const pubText = await pub.text();
    assert.equal(pub.status, 201, pubText);

    const start = await fetch(`${baseUrl}${flowsBase}/${flowId}/executions`, { method: 'POST', headers: authHeaders, body: JSON.stringify({ input: {} }) });
    const startText = await start.text();
    assert.equal(start.status, 201, startText);

    assert.equal(temporal.started.length, 1, 'exactly one workflow started');
    const opts = temporal.started[0].opts;

    // The memo must carry NO token (a memo is plaintext in Temporal visibility/history).
    const memoStr = JSON.stringify(opts.memo ?? {});
    assert.ok(opts.memo == null || Object.keys(opts.memo).length === 0, `no memo expected, got ${memoStr}`);
    assert.ok(!memoStr.includes('falconeExecutionToken'), 'memo has no execution-token key');

    // The token IS still carried in the workflow args (tenant envelope) where the worker reads it.
    const token = opts.args?.[0]?.tenant?.executionToken;
    assert.ok(typeof token === 'string' && token.length > 0, 'token is still passed via workflow args');

    // And the plaintext token value never appears in the memo.
    assert.ok(!memoStr.includes(token), 'token value absent from the memo');
  });
});
