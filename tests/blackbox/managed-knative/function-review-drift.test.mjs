/**
 * Public Function/MCP contract regressions found during independent review of issue #933.
 *
 * The tests use only the exported Function handler boundary and authoritative published
 * OpenAPI/catalog documents. Fixtures are in memory, deterministic, and contact neither
 * Kubernetes nor a network service.
 *
 * bbx-933-function-representation-27 | fn-function-runtime-availability-gate |
 * OpenSpec #### Scenario: Degraded metadata read remains honest
 * bbx-933-mcp-curation-catalog-28 | fn-mcp-hosted-publish |
 * OpenSpec #### Scenario: Publish fails explicitly while Knative is degraded
 * bbx-933-function-audit-workspace-29 | fn-function-runtime-audit |
 * OpenSpec #### Scenario: Version and rollback preserve Function semantics
 * bbx-933-function-production-id-30 | fn-function-runtime-availability-gate |
 * OpenSpec #### Scenario: Degraded metadata read remains honest
 * bbx-933-mcp-rpc-response-31 | fn-mcp-hosted-invoke |
 * OpenSpec #### Scenario: Consumer receives honest unavailable status
 * bbx-933-mcp-list-response-32 | fn-mcp-hosted-publish |
 * OpenSpec #### Scenario: Degraded audit read remains available
 * bbx-933-mcp-route-errors-33 | fn-mcp-hosted-invoke |
 * OpenSpec #### Scenario: Authentication and ownership precede dependency status
 * bbx-933-aggregate-pending-response-34 | fn-managed-knative-owner-scoped-teardown |
 * OpenSpec #### Scenario: Teardown is deferred safely during an outage
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

import Ajv from 'ajv';

import { FN_HANDLERS } from '../../../apps/control-plane/fn-handlers.mjs';
import { METRICS_HANDLERS } from '../../../apps/control-plane/metrics-handlers.mjs';
import { LOCAL_HANDLERS } from '../../../apps/control-plane/b-handlers.mjs';
import { recordRouteAudit } from '../../../apps/control-plane/audit-writer.mjs';
import { routes } from '../../../apps/control-plane/routes.mjs';
import { BASE_SCOPE } from '../../../apps/control-plane-executor/src/mcp-official-catalog.mjs';
import { createMcpEngine } from '../../../apps/control-plane-executor/src/runtime/mcp-engine.mjs';
import { createControlPlaneServer } from '../../../apps/control-plane-executor/src/runtime/server.mjs';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '../../..');

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(REPO_ROOT, relativePath), 'utf8'));
}

const openapi = readJson('apps/control-plane-executor/openapi/control-plane.openapi.json');
const mcpFamily = readJson('apps/control-plane-executor/openapi/families/mcp.openapi.json');
const routeCatalog = readJson('packages/internal-contracts/src/public-route-catalog.json').routes;

const ACTION_PATH = '/v1/functions/actions/{resourceId}';
const ACTIONS_PATH = '/v1/functions/workspaces/{workspaceId}/actions';
const CURATIONS_PATH = '/v1/mcp/workspaces/{workspaceId}/servers/{serverId}/curations';
const MCP_SERVERS_PATH = '/v1/mcp/workspaces/{workspaceId}/servers';
const MCP_RPC_PATH = '/v1/mcp/workspaces/{workspaceId}/servers/{serverId}/rpc';
const TENANT_PURGE_PATH = '/v1/tenants/{tenantId}/purge';
const WORKSPACE_PATH = '/v1/workspaces/{workspaceId}';
const TENANT_ID = 'ten_alpha';
const WORKSPACE_ID = 'wrk_alpha';
const ADJACENT_WORKSPACE_ID = 'wrk_adjacent';
const CREATED_AT = '2026-08-07T09:00:00.000Z';

const OWNER = {
  sub: 'function-owner',
  tenantId: TENANT_ID,
  workspaceId: WORKSPACE_ID,
  actorType: 'workspace_owner',
  roles: ['workspace_owner'],
};

const READY_RUNTIME = {
  functionsEnabled: true,
  status: () => ({ mode: 'managed', state: 'ready', reason: 'READY' }),
  canServeWorkloads: () => true,
};

const UNAVAILABLE_RUNTIME = {
  functionsEnabled: true,
  status: () => ({ mode: 'managed', state: 'unavailable', reason: 'SERVING_UNAVAILABLE' }),
  canServeWorkloads: () => false,
};

function functionRow({ resourceId, lifecycleStatus = 'active' }) {
  return {
    resource_id: resourceId,
    tenant_id: TENANT_ID,
    workspace_id: WORKSPACE_ID,
    action_name: `orders-${resourceId.slice(4)}`,
    runtime: 'nodejs:20',
    entrypoint: 'main',
    source_code: 'export async function main() { return { ok: true }; }',
    parameters: {},
    memory_mb: 256,
    timeout_ms: 60_000,
    version: 1,
    lifecycle_status: lifecycleStatus,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
  };
}

function storeFor(row) {
  return {
    async getWorkspace(_pool, workspaceId) {
      return workspaceId === WORKSPACE_ID
        ? { id: WORKSPACE_ID, tenant_id: TENANT_ID }
        : null;
    },
    async getFnAction(_pool, resourceId) {
      return resourceId === row.resource_id ? structuredClone(row) : null;
    },
    async listFnActions() {
      return [structuredClone(row)];
    },
    async latestFnActivation() {
      return null;
    },
    async getFnActionVersionSummary() {
      return {
        activeVersionId: `fnv_${row.resource_id.slice(4)}`,
        versionCount: 1,
        rollbackAvailable: false,
      };
    },
  };
}

function handlerContext(row, runtime, params) {
  return {
    pool: {},
    store: storeFor(row),
    params,
    body: {},
    identity: OWNER,
    callerContext: {
      correlationId: `corr-${row.resource_id}`,
      actor: { id: OWNER.sub, type: OWNER.actorType },
      tenantId: TENANT_ID,
    },
    knativeRuntime: runtime,
  };
}

function responseSchemaRef(method, publicPath, status) {
  const operation = openapi.paths?.[publicPath]?.[method];
  assert.ok(operation, `authoritative OpenAPI must contain ${method.toUpperCase()} ${publicPath}`);
  const ref = operation.responses?.[String(status)]?.content?.['application/json']?.schema?.$ref;
  assert.match(ref ?? '', /^#\/components\/schemas\/[A-Za-z][A-Za-z0-9]*$/);
  return ref;
}

function responseSchema(method, publicPath, status) {
  const operation = openapi.paths?.[publicPath]?.[method];
  assert.ok(operation, `authoritative OpenAPI must contain ${method.toUpperCase()} ${publicPath}`);
  const schema = operation.responses?.[String(status)]?.content?.['application/json']?.schema;
  assert.ok(schema, `${method.toUpperCase()} ${publicPath} must publish an application/json ${status} schema`);
  return structuredClone(schema);
}

function validatorFor(ref) {
  const ajv = new Ajv({
    allErrors: true,
    strict: false,
    formats: { 'date-time': true, uri: true },
  });
  return ajv.compile({
    $ref: ref,
    components: openapi.components,
  });
}

function validatorForResponse(method, publicPath, status) {
  const ajv = new Ajv({
    allErrors: true,
    strict: false,
    formats: { 'date-time': true, uri: true },
  });
  return ajv.compile({
    $ref: '#/$defs/response',
    $defs: { response: responseSchema(method, publicPath, status) },
    components: openapi.components,
  });
}

function validationErrors(validate, value) {
  if (validate(value)) return [];
  return structuredClone(validate.errors ?? []);
}

/**
 * bbx-933-function-representation-27 | fn-function-runtime-availability-gate
 * OpenSpec #### Scenario: Degraded metadata read remains honest
 */
test('bbx-933-function-representation-27: detail and list are OpenAPI-valid and distinguish active, unavailable, and deletion_pending', async () => {
  const validateDetail = validatorFor(responseSchemaRef('get', ACTION_PATH, 200));
  const validateList = validatorFor(responseSchemaRef('get', ACTIONS_PATH, 200));
  const failures = [];

  for (const fixture of [
    { expectedState: 'active', row: functionRow({ resourceId: 'res_active' }), runtime: READY_RUNTIME },
    { expectedState: 'unavailable', row: functionRow({ resourceId: 'res_unavailable' }), runtime: UNAVAILABLE_RUNTIME },
    {
      expectedState: 'deletion_pending',
      row: functionRow({ resourceId: 'res_pending', lifecycleStatus: 'deletion_pending' }),
      runtime: UNAVAILABLE_RUNTIME,
    },
  ]) {
    const detail = await FN_HANDLERS.fnActionDetail(handlerContext(
      fixture.row,
      fixture.runtime,
      { actionId: fixture.row.resource_id },
    ));
    const listed = await FN_HANDLERS.fnListActions(handlerContext(
      fixture.row,
      fixture.runtime,
      { workspaceId: WORKSPACE_ID },
    ));

    assert.equal(detail.statusCode, 200, JSON.stringify(detail.body));
    assert.equal(listed.statusCode, 200, JSON.stringify(listed.body));
    assert.equal(listed.body.items.length, 1);

    for (const [surface, body] of [
      ['detail', detail.body],
      ['list item', listed.body.items[0]],
    ]) {
      assert.equal(body.status, fixture.expectedState, `${surface} must expose the lifecycle state`);
      assert.equal(
        body.provisioning?.state,
        fixture.expectedState,
        `${surface} provisioning must distinguish ${fixture.expectedState}`,
      );
    }

    const detailErrors = validationErrors(validateDetail, detail.body);
    if (detailErrors.length > 0) failures.push({ state: fixture.expectedState, surface: 'detail', errors: detailErrors });
    const listErrors = validationErrors(validateList, listed.body);
    if (listErrors.length > 0) failures.push({ state: fixture.expectedState, surface: 'list', errors: listErrors });
  }

  assert.deepEqual(
    failures,
    [],
    `public Function payloads must validate against their authoritative response schemas:\n${JSON.stringify(failures, null, 2)}`,
  );
});

/**
 * bbx-933-mcp-curation-catalog-28 | fn-mcp-hosted-publish
 * OpenSpec #### Scenario: Publish fails explicitly while Knative is degraded
 */
test('bbx-933-mcp-curation-catalog-28: hosted MCP curation POST is published in OpenAPI, route catalog, and MCP family', () => {
  const authoritativeOperation = openapi.paths?.[CURATIONS_PATH]?.post;
  assert.ok(authoritativeOperation, `authoritative OpenAPI must publish POST ${CURATIONS_PATH}`);
  assert.equal(authoritativeOperation['x-family'], 'mcp');
  assert.equal(authoritativeOperation['x-scope'], 'workspace');
  assert.deepEqual(authoritativeOperation.security, [{ bearerAuth: [] }]);

  const familyOperation = mcpFamily.paths?.[CURATIONS_PATH]?.post;
  assert.ok(familyOperation, `MCP family OpenAPI must publish POST ${CURATIONS_PATH}`);
  assert.equal(familyOperation['x-family'], 'mcp');
  assert.equal(familyOperation.operationId, authoritativeOperation.operationId);

  const catalogMatches = routeCatalog.filter((route) => (
    route.method === 'POST' && route.path === CURATIONS_PATH
  ));
  assert.equal(catalogMatches.length, 1, `generated route catalog must contain one POST ${CURATIONS_PATH}`);
  assert.equal(catalogMatches[0].family, 'mcp');
  assert.equal(catalogMatches[0].scope, 'workspace');
  assert.equal(catalogMatches[0].operationId, authoritativeOperation.operationId);
});

function lifecycleStore() {
  let action = null;
  let versions = [];
  let versionNumber = 0;

  return {
    async getWorkspace(_pool, workspaceId) {
      return [WORKSPACE_ID, ADJACENT_WORKSPACE_ID].includes(workspaceId)
        ? { id: workspaceId, tenant_id: TENANT_ID }
        : null;
    },
    async getFnAction(_pool, resourceId) {
      return action?.resource_id === resourceId ? structuredClone(action) : null;
    },
    async listFnActions(_pool, workspaceId) {
      return action?.workspace_id === workspaceId ? [structuredClone(action)] : [];
    },
    async latestFnActivation() {
      return null;
    },
    async getFnActionVersionSummary() {
      const active = versions.find((version) => version.status === 'active');
      return {
        activeVersionId: active?.version_id ?? null,
        versionCount: versions.length,
        rollbackAvailable: versions.length > 1,
      };
    },
    async upsertFnAction(_pool, input) {
      versionNumber += 1;
      versions = versions.map((version) => ({ ...version, status: 'historical' }));
      action = {
        ...(action ?? {}),
        resource_id: input.resourceId,
        tenant_id: input.tenantId,
        workspace_id: input.workspaceId,
        action_name: input.actionName,
        runtime: input.runtime,
        entrypoint: input.entrypoint,
        source_code: input.sourceCode,
        parameters: input.parameters,
        memory_mb: input.memoryMb,
        timeout_ms: input.timeoutMs,
        ksvc_name: input.ksvcName,
        version: versionNumber,
        created_at: action?.created_at ?? CREATED_AT,
        updated_at: CREATED_AT,
      };
      versions.push({
        version_id: `fnv_${versionNumber === 1 ? 'one' : 'two'}`,
        version_number: versionNumber,
        resource_id: action.resource_id,
        tenant_id: action.tenant_id,
        workspace_id: action.workspace_id,
        source_code: action.source_code,
        runtime: action.runtime,
        entrypoint: action.entrypoint,
        parameters: action.parameters,
        memory_mb: action.memory_mb,
        timeout_ms: action.timeout_ms,
        ksvc_name: action.ksvc_name,
        status: 'active',
        created_at: CREATED_AT,
        updated_at: CREATED_AT,
      });
      return structuredClone(action);
    },
    async listFnActionVersions() {
      return structuredClone(versions);
    },
    async activateFnActionVersion(_pool, _action, target) {
      versions = versions.map((version) => ({
        ...version,
        status: version.version_id === target.version_id ? 'active' : 'historical',
      }));
      action = { ...action, source_code: target.source_code, version: target.version_number };
      return structuredClone(action);
    },
    async insertFnActivation() {
      return undefined;
    },
    async deleteFnAction(_pool, row) {
      if (action?.resource_id !== row.resource_id) return null;
      const deleted = structuredClone(action);
      action = null;
      return deleted;
    },
  };
}

function auditPool() {
  const events = [];
  const query = async (sql, params = []) => {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    const lower = normalized.toLowerCase();

    if (/^(begin|commit|rollback)$/i.test(normalized) || lower.includes('pg_advisory_xact_lock')) {
      return { rows: [] };
    }
    if (lower.includes('select row_hash from plan_audit_events')) {
      const tenantEvents = events.filter((event) => event.tenant_id === params[0]);
      return { rows: tenantEvents.length > 0 ? [{ row_hash: tenantEvents.at(-1).row_hash }] : [] };
    }
    if (lower.includes('insert into plan_audit_events')) {
      const [
        id, actionType, actorId, tenantId, previousState, newState,
        outcome, correlationId, createdAt, prevHash, rowHash,
      ] = params;
      const parsedNewState = JSON.parse(newState);
      const row = {
        id,
        action_type: actionType,
        actor_id: actorId,
        tenant_id: tenantId,
        workspace_id: parsedNewState.workspaceId ?? null,
        previous_state: previousState ? JSON.parse(previousState) : null,
        new_state: parsedNewState,
        outcome,
        correlation_id: correlationId,
        created_at: createdAt,
        prev_hash: prevHash,
        row_hash: rowHash,
      };
      events.push(row);
      return { rows: [structuredClone(row)] };
    }
    if (lower.includes('from workspaces')) {
      const workspaceId = params[0];
      return {
        rows: [WORKSPACE_ID, ADJACENT_WORKSPACE_ID].includes(workspaceId)
          ? [{ id: workspaceId, tenant_id: TENANT_ID }]
          : [],
      };
    }
    if (lower.includes('from plan_audit_events')) {
      let rows = events.filter((event) => event.tenant_id === params[0]);
      if (normalized.includes("new_state->>'workspaceId' =")) {
        rows = rows.filter((event) => event.workspace_id === params[1]);
      }
      return { rows: rows.map((row) => structuredClone(row)) };
    }
    throw new Error(`Unexpected audit fixture query: ${normalized}`);
  };
  const client = { query, release() {} };
  return { query, connect: async () => client };
}

function localRoute(method, handler) {
  const matches = routes.filter((route) => route.method === method && route.localHandler === handler);
  assert.equal(matches.length, 1, `public dispatch must expose one ${method} route for ${handler}`);
  return matches[0];
}

function lifecycleContext(store, {
  correlationId,
  params = {},
  body = {},
} = {}) {
  const identity = {
    sub: 'workspace-owner-both',
    tenantId: TENANT_ID,
    workspaceId: ADJACENT_WORKSPACE_ID,
    workspaceIds: [ADJACENT_WORKSPACE_ID, WORKSPACE_ID],
    actorType: 'workspace_owner',
    roles: ['workspace_owner'],
  };
  return {
    pool: {},
    store,
    params,
    body,
    identity,
    callerContext: {
      correlationId,
      actor: { id: identity.sub, type: identity.actorType },
      tenantId: TENANT_ID,
      workspaceId: ADJACENT_WORKSPACE_ID,
    },
    knativeRuntime: READY_RUNTIME,
    deployKnativeService: async () => undefined,
    waitKsvcReady: async () => true,
    invokeKnative: async () => ({
      status: 'success', statusCode: 200, result: { ok: true }, logs: [], durationMs: 1,
    }),
    deleteKnativeService: async () => undefined,
  };
}

function deployBody(source) {
  return {
    tenantId: TENANT_ID,
    workspaceId: WORKSPACE_ID,
    actionName: 'orders-audit',
    source: { kind: 'inline_code', inlineCode: source, entryFile: 'index.js' },
    execution: {
      runtime: 'nodejs:20',
      entrypoint: 'main',
      parameters: {},
      limits: { memoryMb: 256, timeoutMs: 60_000 },
    },
    activationPolicy: {
      logsAccess: 'workspace_developers',
      resultAccess: 'workspace_developers',
      rerunPolicy: 'manual_only',
      retentionHours: 168,
    },
  };
}

/**
 * bbx-933-function-production-id-30 | fn-function-runtime-availability-gate
 * OpenSpec #### Scenario: Degraded metadata read remains honest
 */
test('bbx-933-function-production-id-30: production-created Function detail and list satisfy the authoritative resourceId contract', async () => {
  const store = lifecycleStore();
  const deployed = await FN_HANDLERS.fnDeploy(lifecycleContext(store, {
    correlationId: 'corr-function-production-id',
    body: deployBody('export async function main() { return { productionId: true }; }'),
  }));

  assert.equal(deployed.statusCode, 202, JSON.stringify(deployed.body));
  assert.match(
    deployed.body.resourceId,
    /^fn_[0-9a-f]{8}-[0-9a-f]{3}$/,
    'the public production handler must generate its normal Function resource identity',
  );

  const detail = await FN_HANDLERS.fnActionDetail(lifecycleContext(store, {
    params: { actionId: deployed.body.resourceId },
  }));
  const listed = await FN_HANDLERS.fnListActions(lifecycleContext(store, {
    params: { workspaceId: WORKSPACE_ID },
  }));

  assert.equal(detail.statusCode, 200, JSON.stringify(detail.body));
  assert.equal(listed.statusCode, 200, JSON.stringify(listed.body));
  assert.equal(detail.body.resourceId, deployed.body.resourceId);
  assert.equal(listed.body.items.length, 1);
  assert.equal(listed.body.items[0].resourceId, deployed.body.resourceId);

  const validateDetail = validatorFor(responseSchemaRef('get', ACTION_PATH, 200));
  const validateList = validatorFor(responseSchemaRef('get', ACTIONS_PATH, 200));
  const failures = [
    ...validationErrors(validateDetail, detail.body).map((error) => ({ surface: 'detail', error })),
    ...validationErrors(validateList, listed.body).map((error) => ({ surface: 'list', error })),
  ];
  assert.deepEqual(
    failures,
    [],
    `production-shaped Function identities must validate on public reads:\n${JSON.stringify(failures, null, 2)}`,
  );
});

const MCP_TENANT_ID = 'ten_mcp_contract';
const MCP_WORKSPACE_ID = 'wrk_mcp_contract';

function mcpStateStore() {
  let state = {};
  let tail = Promise.resolve();
  return {
    async ensureSchema() {},
    async loadState() { return structuredClone(state); },
    async saveState(next) { state = structuredClone(next); },
    async withStateTransaction(mutator) {
      let release;
      const previous = tail;
      tail = new Promise((resolve) => { release = resolve; });
      await previous;
      try {
        const outcome = await mutator(structuredClone(state), { query: async () => ({ rows: [] }) });
        state = structuredClone(outcome.state);
        return outcome.result;
      } finally {
        release();
      }
    },
  };
}

function mcpHeaders({ correlationId = 'corr-mcp-contract', authenticated = true } = {}) {
  const base = {
    'content-type': 'application/json',
    'x-correlation-id': correlationId,
  };
  if (!authenticated) return base;
  return {
    ...base,
    'x-tenant-id': MCP_TENANT_ID,
    'x-workspace-id': MCP_WORKSPACE_ID,
    'x-auth-subject': 'mcp-contract-owner',
    'x-auth-scopes': BASE_SCOPE,
    'x-actor-roles': 'tenant_owner',
  };
}

async function withMcpApi(run) {
  let runtimeStatus = { mode: 'managed', state: 'ready', reason: 'READY' };
  const runtime = {
    status: () => structuredClone(runtimeStatus),
    canServeWorkloads: (status = runtimeStatus) => status.state === 'ready',
  };
  const engine = createMcpEngine({
    selfBaseUrl: 'http://executor.contract.test',
    gatewayBaseUrl: 'https://gateway.contract.test',
    runtimeImageDigest: `sha256:${'d'.repeat(64)}`,
    store: mcpStateStore(),
    fetchImpl: async () => ({
      status: 200,
      async json() { return { ok: true }; },
    }),
  });
  const server = createControlPlaneServer({
    registry: {},
    mcpEngine: engine,
    knativeRuntime: runtime,
    logger: { error() {} },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    return await run({
      baseUrl,
      setRuntimeStatus(next) { runtimeStatus = structuredClone(next); },
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function createMcpServer(baseUrl, name) {
  const response = await fetch(`${baseUrl}/v1/mcp/workspaces/${MCP_WORKSPACE_ID}/servers`, {
    method: 'POST',
    headers: mcpHeaders({ correlationId: `corr-create-${name}` }),
    body: JSON.stringify({ name, source: 'instant' }),
  });
  const body = await response.json();
  assert.equal(response.status, 202, JSON.stringify(body));
  assert.match(body.resourceId, /^srv-[a-z0-9-]+$/);
  return body.resourceId;
}

async function postMcpRpc(baseUrl, serverId, message, options = {}) {
  const response = await fetch(
    `${baseUrl}/v1/mcp/workspaces/${MCP_WORKSPACE_ID}/servers/${serverId}/rpc`,
    {
      method: 'POST',
      headers: mcpHeaders({ correlationId: options.correlationId ?? 'corr-mcp-rpc' }),
      body: JSON.stringify(message),
    },
  );
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return body;
}

/**
 * bbx-933-mcp-list-response-32 | fn-mcp-hosted-publish
 * OpenSpec #### Scenario: Degraded audit read remains available
 */
test('bbx-933-mcp-list-response-32: public hosted MCP list payload satisfies its authoritative OpenAPI schema', async () => {
  await withMcpApi(async ({ baseUrl }) => {
    const serverId = await createMcpServer(baseUrl, 'contract-list');
    const response = await fetch(
      `${baseUrl}/v1/mcp/workspaces/${MCP_WORKSPACE_ID}/servers`,
      { headers: mcpHeaders() },
    );
    const body = await response.json();

    assert.equal(response.status, 200, JSON.stringify(body));
    assert.ok(body.items.some((item) => item.serverId === serverId));
    assert.deepEqual(body.runtimeDependency, {
      mode: 'managed', state: 'ready', reason: 'READY', ready: true,
    });

    const validate = validatorForResponse('get', MCP_SERVERS_PATH, 200);
    assert.deepEqual(
      validationErrors(validate, body),
      [],
      `hosted MCP list payload must validate against the published response schema:\n${JSON.stringify(validate.errors, null, 2)}`,
    );
  });
});

/**
 * bbx-933-mcp-rpc-response-31 | fn-mcp-hosted-invoke
 * OpenSpec #### Scenario: Consumer receives honest unavailable status
 * OpenSpec #### Scenario: Authentication and ownership precede dependency status
 */
test('bbx-933-mcp-rpc-response-31: JSON-RPC schema accepts runtime responses and rejects unavailable-contract drift', async () => {
  await withMcpApi(async ({ baseUrl, setRuntimeStatus }) => {
    const serverId = await createMcpServer(baseUrl, 'contract-rpc');
    const curation = await fetch(
      `${baseUrl}/v1/mcp/workspaces/${MCP_WORKSPACE_ID}/servers/${serverId}/curations`,
      { method: 'POST', headers: mcpHeaders(), body: JSON.stringify({ decisions: {} }) },
    );
    assert.equal(curation.status, 200, await curation.text());
    const publish = await fetch(
      `${baseUrl}/v1/mcp/workspaces/${MCP_WORKSPACE_ID}/servers/${serverId}/versions`,
      { method: 'POST', headers: mcpHeaders(), body: JSON.stringify({ version: 'v1' }) },
    );
    assert.equal(publish.status, 201, await publish.text());

    const initialize = await postMcpRpc(baseUrl, serverId, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'contract-test', version: '1' } },
    });
    const toolsList = await postMcpRpc(baseUrl, serverId, {
      jsonrpc: '2.0', id: 2, method: 'tools/list', params: {},
    });
    assert.ok(Array.isArray(toolsList.result?.tools));
    assert.ok(toolsList.result.tools.length > 0);
    const toolsCall = await postMcpRpc(baseUrl, serverId, {
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: toolsList.result.tools[0].name, arguments: {} },
    });
    const notFound = await postMcpRpc(baseUrl, 'srv-missing-contract', {
      jsonrpc: '2.0', id: 4, method: 'tools/list', params: {},
    });
    assert.equal(notFound.error?.code, -32001);

    setRuntimeStatus({ mode: 'managed', state: 'degraded', reason: 'CONTROL_PLANE_NOT_READY' });
    const unavailable = await postMcpRpc(
      baseUrl,
      serverId,
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: toolsList.result.tools[0].name, arguments: {} } },
      { correlationId: 'corr-rpc-contract-unavailable' },
    );
    assert.deepEqual(unavailable, {
      jsonrpc: '2.0',
      id: 5,
      error: {
        code: -32005,
        message: 'Hosted MCP runtime is unavailable.',
        data: {
          code: 'KNATIVE_UNAVAILABLE',
          state: 'degraded',
          reason: 'CONTROL_PLANE_NOT_READY',
          correlationId: 'corr-rpc-contract-unavailable',
        },
      },
    });

    const validate = validatorForResponse('post', MCP_RPC_PATH, 200);
    const validRuntimeResponses = { initialize, toolsList, toolsCall, notFound, unavailable };
    const rejectedValidResponses = Object.entries(validRuntimeResponses)
      .filter(([, body]) => !validate(body))
      .map(([name]) => name);
    const driftCandidates = {
      wrongRpcCode: { ...unavailable, error: { ...unavailable.error, code: -32004 } },
      wrongMessage: { ...unavailable, error: { ...unavailable.error, message: 'Runtime temporarily unavailable.' } },
      wrongDependencyCode: {
        ...unavailable,
        error: { ...unavailable.error, data: { ...unavailable.error.data, code: 'MCP_UNAVAILABLE' } },
      },
      missingCorrelationId: {
        ...unavailable,
        error: {
          ...unavailable.error,
          data: Object.fromEntries(Object.entries(unavailable.error.data).filter(([key]) => key !== 'correlationId')),
        },
      },
      fabricatedToolResult: { ...unavailable, result: { content: [{ type: 'text', text: 'fabricated' }] } },
    };
    const acceptedDrift = Object.entries(driftCandidates)
      .filter(([, body]) => validate(body))
      .map(([name]) => name);

    assert.deepEqual(
      { rejectedValidResponses, acceptedDrift },
      { rejectedValidResponses: [], acceptedDrift: [] },
      'the JSON-RPC 200 schema must preserve real successes/not-found while constraining the normative -32005 envelope',
    );
  });
});

/**
 * bbx-933-mcp-route-errors-33 | fn-mcp-hosted-invoke
 * OpenSpec #### Scenario: Authentication and ownership precede dependency status
 */
test('bbx-933-mcp-route-errors-33: curation not-found and RPC authentication errors satisfy their route schemas', async () => {
  await withMcpApi(async ({ baseUrl }) => {
    const curation = await fetch(
      `${baseUrl}/v1/mcp/workspaces/${MCP_WORKSPACE_ID}/servers/srv-missing-contract/curations`,
      { method: 'POST', headers: mcpHeaders(), body: '{}' },
    );
    const curationBody = await curation.json();
    assert.equal(curation.status, 404, JSON.stringify(curationBody));
    assert.deepEqual(curationBody, {
      code: 'MCP_SERVER_NOT_FOUND',
      message: 'No such MCP server for this tenant/workspace.',
    });

    const rpc = await fetch(
      `${baseUrl}/v1/mcp/workspaces/${MCP_WORKSPACE_ID}/servers/srv-missing-contract/rpc`,
      {
        method: 'POST',
        headers: mcpHeaders({ authenticated: false }),
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      },
    );
    const rpcBody = await rpc.json();
    assert.equal(rpc.status, 401, JSON.stringify(rpcBody));
    assert.equal(rpcBody.code, 'UNAUTHENTICATED');

    const failures = [
      ...validationErrors(
        validatorForResponse('post', CURATIONS_PATH, 404),
        curationBody,
      ).map((error) => ({ route: 'curation', status: 404, error })),
      ...validationErrors(
        validatorForResponse('post', MCP_RPC_PATH, 401),
        rpcBody,
      ).map((error) => ({ route: 'rpc', status: 401, error })),
    ];
    assert.deepEqual(
      failures,
      [],
      `route error envelopes must validate against their published MCP response schemas:\n${JSON.stringify(failures, null, 2)}`,
    );
  });
});

/**
 * bbx-933-aggregate-pending-response-34 | fn-managed-knative-owner-scoped-teardown
 * OpenSpec #### Scenario: Teardown is deferred safely during an outage
 * OpenSpec #### Scenario: Runtime outage defers cleanup honestly
 */
test('bbx-933-aggregate-pending-response-34: tenant purge and workspace delete pending acknowledgements satisfy their 202 schemas', async () => {
  const identity = {
    sub: 'platform-superadmin',
    actorType: 'superadmin',
    roles: ['superadmin'],
  };
  const obligations = [{
    resourceType: 'function',
    resourceId: 'fn_pending-runtime',
    status: 'pending',
  }];
  const runtimeTeardownCoordinator = {
    async purgeTenant() { return { pending: true, obligations: structuredClone(obligations) }; },
    async purgeWorkspace() { return { pending: true, obligations: structuredClone(obligations) }; },
  };

  const tenant = await LOCAL_HANDLERS.purgeTenant({
    params: { tenantId: 'ten_pending' },
    identity,
    pool: { async query() { return { rows: [{ id: 'ten_pending', iam_realm: 'tenant-pending' }] }; } },
    callerContext: { correlationId: 'corr-tenant-pending' },
    runtimeTeardownCoordinator,
  });
  const workspace = await LOCAL_HANDLERS.deleteWorkspace({
    params: { workspaceId: 'wrk_pending' },
    identity,
    pool: { async query() { return { rows: [{ id: 'wrk_pending', tenant_id: 'ten_pending' }] }; } },
    callerContext: { correlationId: 'corr-workspace-pending' },
    runtimeTeardownCoordinator,
  });

  assert.deepEqual(tenant, {
    statusCode: 202,
    body: { tenantId: 'ten_pending', status: 'cleanup_pending', obligations },
  });
  assert.deepEqual(workspace, {
    statusCode: 202,
    body: { workspaceId: 'wrk_pending', tenantId: 'ten_pending', status: 'cleanup_pending', obligations },
  });

  const failures = [
    ...validationErrors(
      validatorForResponse('post', TENANT_PURGE_PATH, 202),
      tenant.body,
    ).map((error) => ({ route: 'tenant purge', error })),
    ...validationErrors(
      validatorForResponse('delete', WORKSPACE_PATH, 202),
      workspace.body,
    ).map((error) => ({ route: 'workspace delete', error })),
  ];
  assert.deepEqual(
    failures,
    [],
    `pending aggregate teardown acknowledgements must validate against their published 202 schemas:\n${JSON.stringify(failures, null, 2)}`,
  );
});

function metricsContext(pool, workspaceId) {
  const identity = {
    sub: 'tenant-auditor',
    tenantId: TENANT_ID,
    workspaceId: null,
    actorType: 'tenant_owner',
    roles: ['tenant_owner'],
  };
  return {
    pool,
    params: { workspaceId },
    query: { 'page[size]': '50' },
    body: {},
    identity,
    callerContext: {
      actor: { id: identity.sub, type: identity.actorType },
      tenantId: TENANT_ID,
    },
  };
}

/**
 * bbx-933-function-audit-workspace-29 | fn-function-runtime-audit
 * OpenSpec #### Scenario: Version and rollback preserve Function semantics
 * OpenSpec #### Scenario: Adjacent tenant cannot use dependency status to enumerate workloads
 */
test('bbx-933-function-audit-workspace-29: successful lifecycle audits use persisted workspace scope and are absent from an adjacent workspace', async () => {
  const store = lifecycleStore();
  const pool = auditPool();
  const operations = [];

  const createContext = lifecycleContext(store, {
    correlationId: 'corr-function-create',
    body: deployBody('export async function main() { return { version: 1 }; }'),
  });
  const create = await FN_HANDLERS.fnDeploy(createContext);
  assert.equal(create.statusCode, 202, JSON.stringify(create.body));
  operations.push({
    route: localRoute('POST', 'fnDeploy'), context: createContext, result: create,
    correlationId: 'corr-function-create',
  });
  const resourceId = create.body.resourceId;

  const updateContext = lifecycleContext(store, {
    correlationId: 'corr-function-update',
    params: { actionId: resourceId },
    body: deployBody('export async function main() { return { version: 2 }; }'),
  });
  const update = await FN_HANDLERS.fnDeploy(updateContext);
  assert.equal(update.statusCode, 202, JSON.stringify(update.body));
  operations.push({
    route: localRoute('PATCH', 'fnDeploy'), context: updateContext, result: update,
    correlationId: 'corr-function-update',
  });

  const invokeContext = lifecycleContext(store, {
    correlationId: 'corr-function-invoke',
    params: { actionId: resourceId },
    body: { parameters: { orderId: 'order-1' } },
  });
  const invoke = await FN_HANDLERS.fnInvoke(invokeContext);
  assert.equal(invoke.statusCode, 202, JSON.stringify(invoke.body));
  operations.push({
    route: localRoute('POST', 'fnInvoke'), context: invokeContext, result: invoke,
    correlationId: 'corr-function-invoke',
  });

  const rollbackContext = lifecycleContext(store, {
    correlationId: 'corr-function-rollback',
    params: { actionId: resourceId },
    body: { versionId: 'fnv_one' },
  });
  const rollback = await FN_HANDLERS.fnRollback(rollbackContext);
  assert.equal(rollback.statusCode, 202, JSON.stringify(rollback.body));
  operations.push({
    route: localRoute('POST', 'fnRollback'), context: rollbackContext, result: rollback,
    correlationId: 'corr-function-rollback',
  });

  const deleteContext = lifecycleContext(store, {
    correlationId: 'corr-function-delete',
    params: { actionId: resourceId },
  });
  const deleted = await FN_HANDLERS.fnDelete(deleteContext);
  assert.equal(deleted.statusCode, 202, JSON.stringify(deleted.body));
  assert.equal(deleted.body.status, 'accepted', 'fixture must cover immediate ready-runtime cleanup');
  operations.push({
    route: localRoute('DELETE', 'fnDelete'), context: deleteContext, result: deleted,
    correlationId: 'corr-function-delete',
  });

  for (const operation of operations) {
    await recordRouteAudit(
      pool,
      operation.route,
      operation.context,
      operation.result,
      operation.correlationId,
    );
  }

  const targetAudit = await METRICS_HANDLERS.metricsWorkspaceAudit(metricsContext(pool, WORKSPACE_ID));
  assert.equal(targetAudit.statusCode, 200, JSON.stringify(targetAudit.body));
  assert.equal(targetAudit.body.items.length, 5, JSON.stringify(targetAudit.body.items));
  assert.deepEqual(
    new Set(targetAudit.body.items.map((item) => item.correlationId)),
    new Set(operations.map((operation) => operation.correlationId)),
  );
  assert.ok(targetAudit.body.items.every((item) => (
    item.scope.tenantId === TENANT_ID && item.scope.workspaceId === WORKSPACE_ID
  )), JSON.stringify(targetAudit.body.items));

  const adjacentAudit = await METRICS_HANDLERS.metricsWorkspaceAudit(metricsContext(pool, ADJACENT_WORKSPACE_ID));
  assert.equal(adjacentAudit.statusCode, 200, JSON.stringify(adjacentAudit.body));
  assert.deepEqual(adjacentAudit.body.items, [], 'adjacent workspace must see no target Function event');
});
