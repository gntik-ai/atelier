/**
 * Black-box test suite for spec change fix-flows-create-validate-schema
 * (live E2E campaign, GitHub issue #625).
 *
 * Drives the PUBLIC HTTP surface of the control-plane flows API (the routes the gateway fronts at
 * /v1/flows/workspaces/{ws}/…) with an injected fake Temporal client and the in-memory definition
 * store (no infra). Proves the DSL JSON Schema is enforced at the write boundary (create / PATCH) and
 * at validate / publish.
 *
 * Defect: a flow whose task node used the wrong param field (`params`/`parameters` instead of the
 * schema's `input`) was accepted at create (201) and validate ({valid:true}) — the structural JSON
 * Schema step was never run — then failed confusingly at runtime ("Table undefined.undefined not
 * found", because the interpreter reads node.input which was empty). Fix: run the DSL JSON Schema
 * (additionalProperties:false, field `input`) before the semantic validator, rejecting (400) at
 * create/validate/publish; semantic violations keep returning 422.
 *
 * Scenario coverage (capability: workflows / spec.md):
 *   bbx-625-01  create with a task node using `params` → 400 (not 201)
 *   bbx-625-02  create with `parameters` → 400
 *   bbx-625-03  create with a Step-Functions-style {startAt,states} shape → 400
 *   bbx-625-04  create with the schema field `input` → 201, then validate 200, then publish 201
 *   bbx-625-05  a semantic-only violation (dup ids / dangling) still creates (201) and fails 422 at validate/publish
 *   bbx-625-06  PATCH that supplies a `params` definition → 400 (write boundary)
 *   bbx-625-07  validate of a structurally-bad stored draft → 400 FLOW_DEFINITION_INVALID
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import { createConnectionRegistry } from '../../apps/control-plane-executor/src/runtime/connection-registry.mjs';
import { createFlowExecutor, createFlowStore } from '../../apps/control-plane-executor/src/runtime/flow-executor.mjs';

const authHeaders = {
  'content-type': 'application/json',
  'x-api-version': '2026-03-26',
  'x-correlation-id': 'corr-bbx-flows-schema',
  'x-tenant-id': 'ten_bbx_schema',
  'x-workspace-id': 'ws_bbx_schema',
  'x-auth-subject': 'admin-schema',
  'x-actor-roles': 'workspace_admin',
};
const WS = 'ws_bbx_schema';
const flowsBase = `/v1/flows/workspaces/${WS}/flows`;

const node = (over) => ({ id: 's1', type: 'task', taskType: 'db.query', ...over });
const PARAMS_DEF = { apiVersion: 'v1.0', name: 'p', nodes: [node({ params: { engine: 'postgres', operation: 'list' } })] };
const PARAMETERS_DEF = { apiVersion: 'v1.0', name: 'p', nodes: [node({ parameters: { engine: 'postgres' } })] };
const SFN_DEF = { startAt: 'n1', states: { n1: { type: 'task' } } };
const INPUT_DEF = { apiVersion: 'v1.0', name: 'p', nodes: [node({ input: { engine: 'postgres', operation: 'list' } })] };
// Structurally valid (each node well-formed) but semantically broken: duplicate id + dangling next.
const SEMANTIC_DEF = {
  apiVersion: 'v1.0', name: 'd',
  nodes: [{ id: 'dup', type: 'task', taskType: 't', next: 'ghost' }, { id: 'dup', type: 'task', taskType: 't' }],
};

function makeFakeTemporal() {
  return { started: [], workflow: { async start() { return {}; }, getHandle() { return {}; }, async *list() {} } };
}

async function withServer(fn, { store } = {}) {
  const registry = createConnectionRegistry({ resolveConnection: () => ({ dsn: 'postgres://unused/none' }) });
  const flowExecutor = createFlowExecutor({
    store, temporalClient: makeFakeTemporal(), temporalAddress: 'fake:7233',
  });
  const server = createControlPlaneServer({ registry, flowExecutor, logger: { error() {} } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(baseUrl, flowExecutor);
  } finally {
    await new Promise((r) => server.close(r));
    await registry.end().catch(() => {});
    await flowExecutor.close().catch(() => {});
  }
}

const createFlow = (baseUrl, definition, name = 'f') =>
  fetch(`${baseUrl}${flowsBase}`, { method: 'POST', headers: authHeaders, body: JSON.stringify({ name, definition }) });

test('bbx-625-01 create with a `params` task node is rejected (400)', async () => {
  await withServer(async (baseUrl) => {
    const res = await createFlow(baseUrl, PARAMS_DEF);
    assert.equal(res.status, 400, 'a schema-violating definition must be rejected at create, not 201');
    const body = await res.json();
    assert.equal(body.code, 'GW_FLOW_DEFINITION_INVALID');
    assert.ok(Array.isArray(body.detail?.errors) && body.detail.errors.some((e) => /params/.test(e.message)),
      `errors should name the offending field: ${JSON.stringify(body.detail?.errors)}`);
  });
});

test('bbx-625-02 create with `parameters` is rejected (400)', async () => {
  await withServer(async (baseUrl) => {
    const res = await createFlow(baseUrl, PARAMETERS_DEF);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, 'GW_FLOW_DEFINITION_INVALID');
  });
});

test('bbx-625-03 create with a {startAt,states} shape is rejected (400)', async () => {
  await withServer(async (baseUrl) => {
    const res = await createFlow(baseUrl, SFN_DEF);
    assert.equal(res.status, 400, 'an unsupported top-level shape must be rejected at create');
    assert.equal((await res.json()).code, 'GW_FLOW_DEFINITION_INVALID');
  });
});

test('bbx-625-04 create with `input` succeeds (201) and validates + publishes', async () => {
  await withServer(async (baseUrl) => {
    const created = await createFlow(baseUrl, INPUT_DEF);
    assert.equal(created.status, 201, 'the schema-correct definition must be accepted');
    const { flowId } = await created.json();
    assert.ok(flowId);

    const validate = await fetch(`${baseUrl}${flowsBase}/${flowId}/validate`, { method: 'POST', headers: authHeaders });
    assert.equal(validate.status, 200);
    assert.deepEqual(await validate.json(), { valid: true });

    const publish = await fetch(`${baseUrl}${flowsBase}/${flowId}/versions`, { method: 'POST', headers: authHeaders });
    assert.equal(publish.status, 201);
  });
});

test('bbx-625-05 a semantic-only violation still creates (201) and fails 422 at validate/publish', async () => {
  await withServer(async (baseUrl) => {
    const created = await createFlow(baseUrl, SEMANTIC_DEF);
    assert.equal(created.status, 201, 'structurally-valid definition is accepted at create');
    const { flowId } = await created.json();

    const validate = await fetch(`${baseUrl}${flowsBase}/${flowId}/validate`, { method: 'POST', headers: authHeaders });
    assert.equal(validate.status, 422, 'semantic violations keep their 422 contract');
    assert.equal((await validate.json()).code, 'GW_FLOW_VALIDATION_FAILED');

    const publish = await fetch(`${baseUrl}${flowsBase}/${flowId}/versions`, { method: 'POST', headers: authHeaders });
    assert.equal(publish.status, 422);
  });
});

test('bbx-625-06 PATCH supplying a `params` definition is rejected (400)', async () => {
  await withServer(async (baseUrl) => {
    const { flowId } = await (await createFlow(baseUrl, INPUT_DEF)).json();
    const patched = await fetch(`${baseUrl}${flowsBase}/${flowId}`, {
      method: 'PATCH', headers: authHeaders, body: JSON.stringify({ definition: PARAMS_DEF }),
    });
    assert.equal(patched.status, 400, 'a malformed definition must not be smuggled in via PATCH');
    assert.equal((await patched.json()).code, 'GW_FLOW_DEFINITION_INVALID');
  });
});

test('bbx-625-07 validate of a structurally-bad stored draft returns 400', async () => {
  // Seed the store directly to bypass create-time validation, then exercise validate's structural gate.
  const store = createFlowStore();
  await store.createDefinition({
    tenantId: 'ten_bbx_schema', workspaceId: WS, flowId: 'seeded-bad', name: 'bad',
    definition: PARAMS_DEF, dslApiVersion: 'v1.0', createdBy: 'seed',
  });
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}${flowsBase}/seeded-bad/validate`, { method: 'POST', headers: authHeaders });
    assert.equal(res.status, 400, 'validate must reject a structurally-bad stored draft (not {valid:true})');
    assert.equal((await res.json()).code, 'GW_FLOW_DEFINITION_INVALID');
  }, { store });
});
