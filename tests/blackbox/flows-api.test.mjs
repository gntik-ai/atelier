// Black-box test suite for change add-flows-control-plane-api (#361).
//
// Drives the PUBLIC HTTP surface of the control-plane server (the routes the gateway fronts at
// /v1/flows/workspaces/{workspaceId}/…) to prove the flows API family is real once a
// flowExecutor is injected into createControlPlaneServer. Temporal is supplied as an INJECTED
// fake client (no infra needed); the definition/version store is the in-memory fallback (no
// Postgres needed) — exactly the no-infra mode the blackbox suite must stay green in.
//
// Public interface only: boots the real server in-process and exercises it over HTTP.
//
// Tests: bbx-flows-api-01 .. bbx-flows-api-16
import test from 'node:test';
import assert from 'node:assert/strict';

import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import { createConnectionRegistry } from '../../apps/control-plane-executor/src/runtime/connection-registry.mjs';
import { createFlowExecutor } from '../../apps/control-plane-executor/src/runtime/flow-executor.mjs';

const TEN = 'ten_bbx_flows';
const WS = 'ws_bbx_flows';
const authHeaders = {
  'content-type': 'application/json',
  'x-api-version': '2026-03-26',
  'x-correlation-id': 'corr-bbx-flows-api',
  'x-tenant-id': TEN,
  'x-workspace-id': WS,
  'x-auth-subject': 'admin-flows',
};

const MINIMAL_DEF = {
  apiVersion: 'v1.0',
  name: 'minimal-three-step',
  nodes: [
    { id: 'step-1', type: 'task', taskType: 'fetch-record', next: 'step-2' },
    { id: 'step-2', type: 'task', taskType: 'transform-record', next: 'step-3' },
    { id: 'step-3', type: 'task', taskType: 'persist-record' },
  ],
};

const APPROVAL_DEF = {
  apiVersion: 'v1.0',
  name: 'human-approval-then-publish',
  nodes: [
    { id: 'review', type: 'approval', approvers: ['role:workspace_admin'], timeout: 'P2D', next: 'publish' },
    { id: 'publish', type: 'task', taskType: 'publish-document' },
  ],
};

// Invalid: duplicate node ids (FLW-E001) + a dangling next reference (FLW-E003).
const INVALID_DEF = {
  apiVersion: 'v1.0',
  name: 'broken',
  nodes: [
    { id: 'dup', type: 'task', taskType: 't', next: 'ghost' },
    { id: 'dup', type: 'task', taskType: 't' },
  ],
};

// A fake @temporalio/client-shaped object the executor uses instead of a real connection.
function makeFakeTemporal() {
  const handles = new Map();
  const started = [];
  function handleFor(workflowId, searchAttributes) {
    return {
      workflowId,
      firstExecutionRunId: `run-${workflowId.slice(-6)}`,
      _searchAttributes: searchAttributes ?? { flowVersion: ['1'] },
      _status: 'Running',
      async describe() {
        return {
          status: { name: this._status },
          searchAttributes: this._searchAttributes,
          startTime: '2026-01-01T00:00:00Z',
          closeTime: null,
        };
      },
      async fetchHistory() {
        return {
          events: [
            { eventId: 5, activityTaskScheduledEventAttributes: { activityId: 'step-1' } },
            { eventId: 9, activityTaskScheduledEventAttributes: { activityId: 'step-2#1' } },
          ],
        };
      },
      async cancel() { this._status = 'Cancelled'; started.push({ cancel: workflowId }); },
      async signal(name, payload) { started.push({ signal: name, payload, workflowId }); },
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
        // Honour the flowId + ExecutionStatus filters the executor injects, so list/delete probes
        // are modelled accurately (the real Temporal visibility index does this server-side).
        const flowMatch = /flowId = '([^']+)'/.exec(query ?? '');
        const wantRunning = /ExecutionStatus = 'Running'/.test(query ?? '');
        for (const h of handles.values()) {
          if (flowMatch && !h.workflowId.includes(`:${flowMatch[1]}:`)) continue;
          if (wantRunning && h._status !== 'Running') continue;
          yield { workflowId: h.workflowId, runId: h.firstExecutionRunId, status: { name: h._status }, startTime: 't', closeTime: null };
        }
        // an unrelated cross-tenant run that the executor must filter out
        if (!flowMatch) yield { workflowId: 'tenOTHER:wsOTHER:f:rX', runId: 'rX', status: { name: 'Running' } };
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

async function createFlow(baseUrl, def = MINIMAL_DEF, name = 'My Flow') {
  const res = await fetch(`${baseUrl}${flowsBase()}`, {
    method: 'POST', headers: authHeaders, body: JSON.stringify({ name, definition: def }),
  });
  const body = await res.json();
  return { res, body };
}

// bbx-flows-api-01: create returns 201 with the created resource.
test('bbx-flows-api-01: POST creates a flow definition (201)', async () => {
  await withFlowsServer(async (baseUrl) => {
    const { res, body } = await createFlow(baseUrl);
    assert.equal(res.status, 201, 'reachable handler, not the 501 guard');
    assert.ok(body.flowId, 'a flowId was assigned');
    assert.equal(body.name, 'My Flow');
    assert.equal(body.status, 'draft');
  });
});

// bbx-flows-api-02: list returns only the created flow.
test('bbx-flows-api-02: GET lists the tenant flows', async () => {
  await withFlowsServer(async (baseUrl) => {
    await createFlow(baseUrl);
    const res = await fetch(`${baseUrl}${flowsBase()}`, { headers: authHeaders });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.items.length, 1);
  });
});

// bbx-flows-api-03: get a specific definition (200) / unknown (404).
test('bbx-flows-api-03: GET one definition returns 200; unknown returns 404', async () => {
  await withFlowsServer(async (baseUrl) => {
    const { body } = await createFlow(baseUrl);
    const got = await fetch(`${baseUrl}${flowsBase()}/${body.flowId}`, { headers: authHeaders });
    assert.equal(got.status, 200);
    assert.equal((await got.json()).flowId, body.flowId);

    const missing = await fetch(`${baseUrl}${flowsBase()}/does-not-exist`, { headers: authHeaders });
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).code, 'GW_FLOW_NOT_FOUND');
  });
});

// bbx-flows-api-04: PATCH updates the draft head only.
test('bbx-flows-api-04: PATCH updates the draft head', async () => {
  await withFlowsServer(async (baseUrl) => {
    const { body } = await createFlow(baseUrl);
    const patched = await fetch(`${baseUrl}${flowsBase()}/${body.flowId}`, {
      method: 'PATCH', headers: authHeaders, body: JSON.stringify({ name: 'Renamed' }),
    });
    assert.equal(patched.status, 200);
    assert.equal((await patched.json()).name, 'Renamed');
  });
});

// bbx-flows-api-05: DELETE removes the draft head.
test('bbx-flows-api-05: DELETE removes the definition', async () => {
  await withFlowsServer(async (baseUrl) => {
    const { body } = await createFlow(baseUrl);
    const del = await fetch(`${baseUrl}${flowsBase()}/${body.flowId}`, { method: 'DELETE', headers: authHeaders });
    assert.equal(del.status, 200);
    assert.deepEqual(await del.json(), { removed: true });
    const got = await fetch(`${baseUrl}${flowsBase()}/${body.flowId}`, { headers: authHeaders });
    assert.equal(got.status, 404);
  });
});

// bbx-flows-api-17: DELETE is rejected with 409 while a non-terminal execution references the flow.
test('bbx-flows-api-17: DELETE returns 409 when an active execution references the flow', async () => {
  await withFlowsServer(async (baseUrl) => {
    const { body } = await createFlow(baseUrl);
    await fetch(`${baseUrl}${flowsBase()}/${body.flowId}/versions`, { method: 'POST', headers: authHeaders });
    // start a run (status Running in the fake) → delete must be rejected
    await fetch(`${baseUrl}${flowsBase()}/${body.flowId}/executions`, {
      method: 'POST', headers: authHeaders, body: JSON.stringify({ version: 1 }),
    });
    const del = await fetch(`${baseUrl}${flowsBase()}/${body.flowId}`, { method: 'DELETE', headers: authHeaders });
    assert.equal(del.status, 409);
    assert.equal((await del.json()).code, 'GW_FLOW_HAS_ACTIVE_EXECUTIONS');
    // the flow still exists
    const got = await fetch(`${baseUrl}${flowsBase()}/${body.flowId}`, { headers: authHeaders });
    assert.equal(got.status, 200);
  });
});

// bbx-flows-api-06: validate passes for a good draft (200 {valid:true}).
test('bbx-flows-api-06: POST validate returns 200 {valid:true} for a good draft', async () => {
  await withFlowsServer(async (baseUrl) => {
    const { body } = await createFlow(baseUrl);
    const res = await fetch(`${baseUrl}${flowsBase()}/${body.flowId}/validate`, { method: 'POST', headers: authHeaders });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { valid: true });
  });
});

// bbx-flows-api-07: validate fails with 422 + node-scoped FLW-E codes for a bad draft; no version created.
test('bbx-flows-api-07: POST validate returns 422 with node-scoped errors for a bad draft', async () => {
  await withFlowsServer(async (baseUrl) => {
    const { body } = await createFlow(baseUrl, INVALID_DEF, 'Broken');
    const res = await fetch(`${baseUrl}${flowsBase()}/${body.flowId}/validate`, { method: 'POST', headers: authHeaders });
    assert.equal(res.status, 422);
    const out = await res.json();
    assert.ok(Array.isArray(out.errors) && out.errors.length > 0, 'errors array present');
    for (const e of out.errors) {
      assert.match(e.code, /^FLW-E00\d$/, 'a stable FLW-E code');
      assert.ok('nodeId' in e, 'each error has a nodeId');
    }
    // validate must not create a version
    const versions = await fetch(`${baseUrl}${flowsBase()}/${body.flowId}/versions`, { headers: authHeaders });
    assert.equal((await versions.json()).items.length, 0);
  });
});

// bbx-flows-api-08: publish succeeds (201 {version:1}); draft remains.
test('bbx-flows-api-08: POST versions publishes an immutable version (201)', async () => {
  await withFlowsServer(async (baseUrl) => {
    const { body } = await createFlow(baseUrl);
    const pub = await fetch(`${baseUrl}${flowsBase()}/${body.flowId}/versions`, { method: 'POST', headers: authHeaders });
    assert.equal(pub.status, 201);
    const pubBody = await pub.json();
    assert.equal(pubBody.version, 1);
    assert.equal(pubBody.flowId, body.flowId);
    // draft head still editable
    const draft = await fetch(`${baseUrl}${flowsBase()}/${body.flowId}`, { headers: authHeaders });
    assert.equal(draft.status, 200);
  });
});

// bbx-flows-api-09: publish fails with 422 for an invalid draft; no version row.
test('bbx-flows-api-09: POST versions returns 422 for an invalid draft (no version)', async () => {
  await withFlowsServer(async (baseUrl) => {
    const { body } = await createFlow(baseUrl, INVALID_DEF, 'Broken');
    const pub = await fetch(`${baseUrl}${flowsBase()}/${body.flowId}/versions`, { method: 'POST', headers: authHeaders });
    assert.equal(pub.status, 422);
    const versions = await fetch(`${baseUrl}${flowsBase()}/${body.flowId}/versions`, { headers: authHeaders });
    assert.equal((await versions.json()).items.length, 0);
  });
});

// bbx-flows-api-10: list + get version (including YAML field), ascending order, monotonic.
test('bbx-flows-api-10: versions list + get includes the definition; numbers are monotonic', async () => {
  await withFlowsServer(async (baseUrl) => {
    const { body } = await createFlow(baseUrl);
    await fetch(`${baseUrl}${flowsBase()}/${body.flowId}/versions`, { method: 'POST', headers: authHeaders });
    await fetch(`${baseUrl}${flowsBase()}/${body.flowId}/versions`, { method: 'POST', headers: authHeaders });
    const list = await (await fetch(`${baseUrl}${flowsBase()}/${body.flowId}/versions`, { headers: authHeaders })).json();
    assert.deepEqual(list.items.map((v) => v.version), [1, 2]);
    const v2 = await fetch(`${baseUrl}${flowsBase()}/${body.flowId}/versions/2`, { headers: authHeaders });
    assert.equal(v2.status, 200);
    const v2body = await v2.json();
    assert.equal(v2body.version, 2);
    assert.ok('definitionYaml' in v2body, 'version detail exposes definitionYaml for the editor');
    assert.ok(v2body.definition, 'version detail includes the parsed definition');
  });
});

// bbx-flows-api-11: start execution returns 201 with a server-generated workflow ID.
test('bbx-flows-api-11: POST executions starts a run with a server-generated workflow ID', async () => {
  await withFlowsServer(async (baseUrl) => {
    const { body } = await createFlow(baseUrl);
    await fetch(`${baseUrl}${flowsBase()}/${body.flowId}/versions`, { method: 'POST', headers: authHeaders });
    const res = await fetch(`${baseUrl}${flowsBase()}/${body.flowId}/executions`, {
      method: 'POST', headers: authHeaders, body: JSON.stringify({ version: 1, input: { hello: 'world' } }),
    });
    assert.equal(res.status, 201);
    const out = await res.json();
    assert.equal(out.version, 1);
    assert.match(out.workflowId, new RegExp(`^${TEN}:${WS}:${body.flowId}:`), 'workflowId follows the server pattern');
    assert.equal(out.executionId, out.workflowId);
    assert.ok(out.runId, 'a runId is returned');
  });
});

// bbx-flows-api-12: a client-supplied workflowId in the body is IGNORED.
test('bbx-flows-api-12: a client-supplied workflowId is ignored; server generates the canonical ID', async () => {
  await withFlowsServer(async (baseUrl) => {
    const { body } = await createFlow(baseUrl);
    await fetch(`${baseUrl}${flowsBase()}/${body.flowId}/versions`, { method: 'POST', headers: authHeaders });
    const res = await fetch(`${baseUrl}${flowsBase()}/${body.flowId}/executions`, {
      method: 'POST', headers: authHeaders,
      body: JSON.stringify({ version: 1, workflowId: 'attacker:owned:workflow:id' }),
    });
    assert.equal(res.status, 201);
    const out = await res.json();
    assert.notEqual(out.workflowId, 'attacker:owned:workflow:id');
    assert.match(out.workflowId, new RegExp(`^${TEN}:${WS}:`));
  });
});

// bbx-flows-api-13: start with a non-existent version returns 404 (nothing submitted).
test('bbx-flows-api-13: start with a non-existent version returns 404', async () => {
  await withFlowsServer(async (baseUrl) => {
    const { body } = await createFlow(baseUrl);
    await fetch(`${baseUrl}${flowsBase()}/${body.flowId}/versions`, { method: 'POST', headers: authHeaders });
    const res = await fetch(`${baseUrl}${flowsBase()}/${body.flowId}/executions`, {
      method: 'POST', headers: authHeaders, body: JSON.stringify({ version: 99 }),
    });
    assert.equal(res.status, 404);
    assert.equal((await res.json()).code, 'GW_VERSION_NOT_FOUND');
  });
});

// bbx-flows-api-14: execution detail maps history events to DSL node IDs.
test('bbx-flows-api-14: execution detail maps history to DSL node IDs', async () => {
  await withFlowsServer(async (baseUrl) => {
    const { body } = await createFlow(baseUrl);
    await fetch(`${baseUrl}${flowsBase()}/${body.flowId}/versions`, { method: 'POST', headers: authHeaders });
    const start = await (await fetch(`${baseUrl}${flowsBase()}/${body.flowId}/executions`, {
      method: 'POST', headers: authHeaders, body: JSON.stringify({ version: 1 }),
    })).json();
    const detail = await fetch(`${baseUrl}${flowsBase()}/${body.flowId}/executions/${encodeURIComponent(start.workflowId)}`, { headers: authHeaders });
    assert.equal(detail.status, 200);
    const out = await detail.json();
    assert.ok(Array.isArray(out.events), 'events array present');
    assert.deepEqual(out.events.map((e) => e.nodeId), ['step-1', 'step-2'], 'activityId mapped to node id (loop suffix dropped)');
  });
});

// bbx-flows-api-15: cancel returns 202; retry returns 201 with a new run on the same version.
test('bbx-flows-api-15: cancel (202) and retry (201, new run same version)', async () => {
  await withFlowsServer(async (baseUrl) => {
    const { body } = await createFlow(baseUrl);
    await fetch(`${baseUrl}${flowsBase()}/${body.flowId}/versions`, { method: 'POST', headers: authHeaders });
    const start = await (await fetch(`${baseUrl}${flowsBase()}/${body.flowId}/executions`, {
      method: 'POST', headers: authHeaders, body: JSON.stringify({ version: 1 }),
    })).json();
    const eid = encodeURIComponent(start.workflowId);

    const cancel = await fetch(`${baseUrl}${flowsBase()}/${body.flowId}/executions/${eid}/cancellations`, { method: 'POST', headers: authHeaders });
    assert.equal(cancel.status, 202);

    const retry = await fetch(`${baseUrl}${flowsBase()}/${body.flowId}/executions/${eid}/retries`, { method: 'POST', headers: authHeaders });
    assert.equal(retry.status, 201);
    const retryBody = await retry.json();
    assert.equal(retryBody.version, 1, 'retry pins the same version');
    assert.notEqual(retryBody.workflowId, start.workflowId, 'retry is a new run');
    assert.equal(retryBody.retriedFrom, start.workflowId);
  });
});

// bbx-flows-api-16: signal to a valid approval node returns 202; unknown signal name returns 422.
test('bbx-flows-api-16: signal a known approval node (202); unknown signal name (422)', async () => {
  await withFlowsServer(async (baseUrl) => {
    const { body } = await createFlow(baseUrl, APPROVAL_DEF, 'Approval Flow');
    await fetch(`${baseUrl}${flowsBase()}/${body.flowId}/versions`, { method: 'POST', headers: authHeaders });
    const start = await (await fetch(`${baseUrl}${flowsBase()}/${body.flowId}/executions`, {
      method: 'POST', headers: authHeaders, body: JSON.stringify({ version: 1 }),
    })).json();
    const eid = encodeURIComponent(start.workflowId);

    // "human-approval" is the conventional alias and is always allowed
    const ok = await fetch(`${baseUrl}${flowsBase()}/${body.flowId}/executions/${eid}/signals/human-approval`, {
      method: 'POST', headers: authHeaders, body: JSON.stringify({ approved: true, nodeId: 'review' }),
    });
    assert.equal(ok.status, 202);

    const bad = await fetch(`${baseUrl}${flowsBase()}/${body.flowId}/executions/${eid}/signals/not-a-signal`, {
      method: 'POST', headers: authHeaders, body: JSON.stringify({}),
    });
    assert.equal(bad.status, 422);
    assert.equal((await bad.json()).code, 'GW_UNKNOWN_SIGNAL');
  });
});
