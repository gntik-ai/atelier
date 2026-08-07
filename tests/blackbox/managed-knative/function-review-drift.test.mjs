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
 * bbx-933-aggregate-completed-response-35 | fn-managed-knative-owner-scoped-teardown |
 * OpenSpec #### Scenario: Tenant teardown leaves no function workloads
 * bbx-933-mcp-external-canary-response-36 | fn-mcp-hosted-invoke |
 * OpenSpec #### Scenario: Consumer receives honest unavailable status
 * bbx-933-function-identity-contract-37 | fn-function-runtime-availability-gate |
 * OpenSpec #### Scenario: Version and rollback preserve Function semantics
 * bbx-933-aggregate-obligation-contract-38 | fn-managed-knative-owner-scoped-teardown |
 * OpenSpec #### Scenario: Runtime outage defers cleanup honestly
 * bbx-933-mcp-runtime-errors-39 | fn-mcp-hosted-invoke |
 * OpenSpec #### Scenario: Authentication and ownership precede dependency status
 * bbx-933-aggregate-completion-residual-40 | fn-managed-knative-owner-scoped-teardown |
 * OpenSpec #### Scenario: Tenant teardown leaves no function workloads
 * bbx-933-aggregate-coordinator-error-41 | fn-managed-knative-owner-scoped-teardown |
 * OpenSpec #### Scenario: Runtime outage defers cleanup honestly
 * bbx-933-mcp-list-pagination-42 | fn-mcp-hosted-publish |
 * OpenSpec #### Scenario: Degraded audit read remains available
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import { isDeepStrictEqual } from 'node:util';

import Ajv from 'ajv';

import { FN_HANDLERS } from '../../../apps/control-plane/fn-handlers.mjs';
import { METRICS_HANDLERS } from '../../../apps/control-plane/metrics-handlers.mjs';
import { LOCAL_HANDLERS } from '../../../apps/control-plane/b-handlers.mjs';
import { createRuntimeTeardownCoordinator } from '../../../apps/control-plane/runtime-teardown-coordinator.mjs';
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
const FUNCTION_INVOCATIONS_PATH = '/v1/functions/actions/{resourceId}/invocations';
const FUNCTION_VERSIONS_PATH = '/v1/functions/actions/{resourceId}/versions';
const FUNCTION_ROLLBACK_PATH = '/v1/functions/actions/{resourceId}/rollback';
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
  let activations = [];
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
    async latestFnActivation(_pool, resourceId) {
      return structuredClone(activations.findLast((activation) => activation.resource_id === resourceId) ?? null);
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
    async insertFnActivation(_pool, input) {
      activations.push({
        activation_id: input.activationId,
        resource_id: input.resourceId,
        workspace_id: input.workspaceId,
        status: input.status,
        status_code: input.statusCode,
        result: structuredClone(input.result),
        logs: structuredClone(input.logs),
        duration_ms: input.durationMs,
        started_at: input.startedAt,
        finished_at: input.finishedAt,
      });
      return structuredClone(activations.at(-1));
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

/**
 * bbx-933-function-identity-contract-37 | fn-function-runtime-availability-gate
 * OpenSpec #### Scenario: Version and rollback preserve Function semantics
 */
test('bbx-933-function-identity-contract-37: production Function IDs satisfy action paths and literal lifecycle response schemas', async () => {
  const store = lifecycleStore();
  const created = await FN_HANDLERS.fnDeploy(lifecycleContext(store, {
    correlationId: 'corr-function-identity-create',
    body: deployBody('export async function main() { return { version: 1 }; }'),
  }));
  assert.equal(created.statusCode, 202, JSON.stringify(created.body));
  const resourceId = created.body.resourceId;
  assert.match(resourceId, /^fn_[0-9a-f]{8}-[0-9a-f]{3}$/);

  const updated = await FN_HANDLERS.fnDeploy(lifecycleContext(store, {
    correlationId: 'corr-function-identity-update',
    params: { actionId: resourceId },
    body: deployBody('export async function main() { return { version: 2 }; }'),
  }));
  assert.equal(updated.statusCode, 202, JSON.stringify(updated.body));
  assert.equal(updated.body.resourceId, resourceId);

  const invoked = await FN_HANDLERS.fnInvoke(lifecycleContext(store, {
    correlationId: 'corr-function-identity-invoke',
    params: { actionId: resourceId },
    body: { parameters: { orderId: 'order-contract-37' } },
  }));
  assert.equal(invoked.statusCode, 202, JSON.stringify(invoked.body));
  assert.equal(invoked.body.resourceId, resourceId);
  assert.match(invoked.body.invocationId, /^act_[0-9a-f]{8}-[0-9a-f]{3}$/);
  assert.equal(invoked.body.status, 'completed');

  const detail = await FN_HANDLERS.fnActionDetail(lifecycleContext(store, {
    params: { actionId: resourceId },
  }));
  assert.equal(detail.statusCode, 200, JSON.stringify(detail.body));
  const activation = detail.body.latestActivation;
  assert.equal(activation.resourceId, resourceId);
  assert.equal(activation.activationId, invoked.body.invocationId);
  assert.equal(activation.status, 'succeeded');
  assert.equal(activation.triggerKind, 'manual');

  const rolledBack = await FN_HANDLERS.fnRollback(lifecycleContext(store, {
    correlationId: 'corr-function-identity-rollback',
    params: { actionId: resourceId },
    body: { versionId: 'fnv_one' },
  }));
  assert.equal(rolledBack.statusCode, 202, JSON.stringify(rolledBack.body));
  assert.equal(rolledBack.body.resourceId, resourceId);

  const resolveParameter = (parameter) => {
    if (!parameter?.$ref) return parameter;
    const name = parameter.$ref.match(/^#\/components\/parameters\/([^/]+)$/)?.[1];
    return name ? openapi.components?.parameters?.[name] : null;
  };
  const functionOperations = [
    ['detail', 'get', ACTION_PATH],
    ['update', 'patch', ACTION_PATH],
    ['delete', 'delete', ACTION_PATH],
    ['invoke', 'post', FUNCTION_INVOCATIONS_PATH],
    ['versions', 'get', FUNCTION_VERSIONS_PATH],
    ['rollback', 'post', FUNCTION_ROLLBACK_PATH],
  ];
  const pathFailures = [];
  for (const [name, method, publicPath] of functionOperations) {
    const operation = openapi.paths?.[publicPath]?.[method];
    assert.ok(operation, `authoritative OpenAPI must contain Function ${name} operation`);
    const raw = operation.parameters?.find((parameter) => resolveParameter(parameter)?.name === 'resourceId');
    const resolved = resolveParameter(raw);
    assert.ok(resolved?.schema, `Function ${name} must publish a resourceId path parameter schema`);
    const acceptsProductionId = new Ajv({ strict: false }).compile(resolved.schema)(resourceId);
    if (raw?.$ref === '#/components/parameters/ResourceId' || !acceptsProductionId) {
      pathFailures.push({
        operation: name,
        reference: raw?.$ref ?? 'inline',
        acceptsProductionId,
      });
    }
  }

  const globalResourceId = new Ajv({ strict: false })
    .compile(openapi.components.parameters.ResourceId.schema);
  assert.equal(
    globalResourceId(resourceId),
    false,
    'the generic res_* ResourceId contract must stay narrow; Function paths need a Function-specific parameter',
  );

  const responseFailures = [
    ...validationErrors(
      validatorForResponse('post', FUNCTION_INVOCATIONS_PATH, 202),
      invoked.body,
    ).map((error) => ({ response: 'FunctionInvocationAccepted', error })),
    ...validationErrors(
      validatorFor('#/components/schemas/FunctionActivation'),
      activation,
    ).map((error) => ({ response: 'FunctionActivation', error })),
    ...validationErrors(
      validatorForResponse('post', FUNCTION_ROLLBACK_PATH, 202),
      rolledBack.body,
    ).map((error) => ({ response: 'FunctionRollbackAccepted', error })),
  ];
  assert.deepEqual(
    { pathFailures, responseFailures },
    { pathFailures: [], responseFailures: [] },
    'Function-specific path and lifecycle response contracts must accept literal production fn_* identities and handler payloads',
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

function mcpHeaders({
  correlationId = 'corr-mcp-contract',
  authenticated = true,
  roles = ['tenant_owner'],
  workspaceIds,
} = {}) {
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
    'x-actor-roles': roles.join(','),
    ...(workspaceIds ? { 'x-actor-workspace-ids': workspaceIds.join(',') } : {}),
  };
}

async function withMcpApi(run, {
  initialRuntimeStatus = { mode: 'managed', state: 'ready', reason: 'READY' },
} = {}) {
  let runtimeStatus = structuredClone(initialRuntimeStatus);
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
 * bbx-933-mcp-list-pagination-42 | fn-mcp-hosted-publish
 * OpenSpec #### Scenario: Degraded audit read remains available
 */
test('bbx-933-mcp-list-pagination-42: hosted MCP list does not advertise pagination its public runtime ignores', async () => {
  await withMcpApi(async ({ baseUrl }) => {
    await createMcpServer(baseUrl, 'pagination-one');
    await createMcpServer(baseUrl, 'pagination-two');
    const listUrl = `${baseUrl}/v1/mcp/workspaces/${MCP_WORKSPACE_ID}/servers`;
    const unpagedResponse = await fetch(listUrl, { headers: mcpHeaders() });
    const pagedResponse = await fetch(
      `${listUrl}?page%5Bsize%5D=1&page%5Bafter%5D=srv-cursor-that-runtime-does-not-read`,
      { headers: mcpHeaders() },
    );
    const unpaged = await unpagedResponse.json();
    const paged = await pagedResponse.json();
    assert.equal(unpagedResponse.status, 200, JSON.stringify(unpaged));
    assert.equal(pagedResponse.status, 200, JSON.stringify(paged));
    assert.equal(unpaged.items.length, 2);
    assert.deepEqual(paged, unpaged, 'the registered runtime currently ignores both advertised pagination inputs');
    assert.equal(Object.hasOwn(paged, 'page'), false);

    const operation = openapi.paths?.[MCP_SERVERS_PATH]?.get;
    assert.ok(operation);
    const parameterNames = (operation.parameters ?? []).map((parameter) => {
      if (!parameter?.$ref) return parameter?.name;
      const name = parameter.$ref.match(/^#\/components\/parameters\/([^/]+)$/)?.[1];
      return openapi.components?.parameters?.[name]?.name;
    });
    const unsupportedAdvertisedPagination = parameterNames
      .filter((name) => name === 'page[size]' || name === 'page[after]');
    assert.deepEqual(
      unsupportedAdvertisedPagination,
      [],
      'MCP list must not advertise page[size]/page[after] until the registered runtime implements page state and cursors',
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
 * bbx-933-mcp-external-canary-response-36 | fn-mcp-hosted-invoke
 * OpenSpec #### Scenario: Consumer receives honest unavailable status
 */
test('bbx-933-mcp-external-canary-response-36: enabled-hosting external-unverified and runtime-disabled RPC responses satisfy the JSON-RPC schema', async () => {
  await withMcpApi(async ({ baseUrl, setRuntimeStatus }) => {
    const serverId = await createMcpServer(baseUrl, 'contract-external-canary');
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

    setRuntimeStatus({ mode: 'external', state: 'unverified', reason: 'EXTERNAL_CANARY_MISSING' });
    const unavailable = await postMcpRpc(
      baseUrl,
      serverId,
      { jsonrpc: '2.0', id: 36, method: 'tools/list', params: {} },
      { correlationId: 'corr-external-canary-missing' },
    );
    assert.deepEqual(unavailable, {
      jsonrpc: '2.0',
      id: 36,
      error: {
        code: -32005,
        message: 'Hosted MCP runtime is unavailable.',
        data: {
          code: 'KNATIVE_UNAVAILABLE',
          state: 'unverified',
          reason: 'EXTERNAL_CANARY_MISSING',
          correlationId: 'corr-external-canary-missing',
        },
      },
    });

    setRuntimeStatus({ mode: 'disabled', state: 'disabled', reason: 'DISABLED' });
    const runtimeDisabled = await postMcpRpc(
      baseUrl,
      serverId,
      { jsonrpc: '2.0', id: 37, method: 'tools/list', params: {} },
      { correlationId: 'corr-enabled-hosting-runtime-disabled' },
    );
    assert.deepEqual(runtimeDisabled, {
      jsonrpc: '2.0',
      id: 37,
      error: {
        code: -32005,
        message: 'Hosted MCP runtime is unavailable.',
        data: {
          code: 'KNATIVE_UNAVAILABLE',
          state: 'disabled',
          reason: 'DISABLED',
          correlationId: 'corr-enabled-hosting-runtime-disabled',
        },
      },
    });

    const validate = validatorForResponse('post', MCP_RPC_PATH, 200);
    const failures = [
      ...validationErrors(validate, unavailable).map((error) => ({ state: 'unverified', error })),
      ...validationErrors(validate, runtimeDisabled).map((error) => ({ state: 'disabled', error })),
    ];
    assert.deepEqual(
      failures,
      [],
      `enabled-hosting unavailable responses must validate for actual external-unverified and runtime-disabled states:\n${JSON.stringify(failures, null, 2)}`,
    );
  }, {
    initialRuntimeStatus: { mode: 'external', state: 'ready', reason: 'READY' },
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
 * bbx-933-mcp-runtime-errors-39 | fn-mcp-hosted-invoke
 * OpenSpec #### Scenario: Authentication and ownership precede dependency status
 */
test('bbx-933-mcp-runtime-errors-39: runtime-originated MCP 400/403 envelopes have explicit bounded schemas', async () => {
  await withMcpApi(async ({ baseUrl }) => {
    const serverId = await createMcpServer(baseUrl, 'contract-runtime-errors');
    const curationUrl = `${baseUrl}/v1/mcp/workspaces/${MCP_WORKSPACE_ID}/servers/${serverId}/curations`;
    const rpcUrl = `${baseUrl}/v1/mcp/workspaces/${MCP_WORKSPACE_ID}/servers/${serverId}/rpc`;

    const malformedCurationResponse = await fetch(curationUrl, {
      method: 'POST', headers: mcpHeaders(), body: '{',
    });
    const malformedCuration = await malformedCurationResponse.json();
    assert.equal(malformedCurationResponse.status, 400, JSON.stringify(malformedCuration));
    assert.deepEqual(malformedCuration, { code: 'INVALID_JSON', message: 'Body is not valid JSON' });

    const readonlyCurationResponse = await fetch(curationUrl, {
      method: 'POST',
      headers: mcpHeaders({ roles: ['workspace_viewer'], workspaceIds: [MCP_WORKSPACE_ID] }),
      body: '{}',
    });
    const readonlyCuration = await readonlyCurationResponse.json();
    assert.equal(readonlyCurationResponse.status, 403, JSON.stringify(readonlyCuration));
    assert.deepEqual(readonlyCuration, {
      code: 'FORBIDDEN', message: 'Caller role may not perform structural writes',
    });

    const malformedRpcResponse = await fetch(rpcUrl, {
      method: 'POST', headers: mcpHeaders(), body: '{',
    });
    const malformedRpc = await malformedRpcResponse.json();
    assert.equal(malformedRpcResponse.status, 400, JSON.stringify(malformedRpc));
    assert.deepEqual(malformedRpc, { code: 'INVALID_JSON', message: 'Body is not valid JSON' });

    const pluralDeniedResponse = await fetch(rpcUrl, {
      method: 'POST',
      headers: mcpHeaders({ workspaceIds: ['wrk_other'] }),
      body: JSON.stringify({ jsonrpc: '2.0', id: 39, method: 'tools/list', params: {} }),
    });
    const pluralDenied = await pluralDeniedResponse.json();
    assert.equal(pluralDeniedResponse.status, 403, JSON.stringify(pluralDenied));
    assert.deepEqual(pluralDenied, {
      code: 'FORBIDDEN', message: 'Caller workspace scope does not include the requested workspace',
    });

    const cases = [
      { name: 'curation malformed JSON', method: 'post', path: CURATIONS_PATH, status: 400, body: malformedCuration },
      { name: 'curation readonly denial', method: 'post', path: CURATIONS_PATH, status: 403, body: readonlyCuration },
      { name: 'RPC malformed JSON', method: 'post', path: MCP_RPC_PATH, status: 400, body: malformedRpc },
      { name: 'RPC plural-workspace denial', method: 'post', path: MCP_RPC_PATH, status: 403, body: pluralDenied },
    ];
    const contractFailures = [];
    for (const candidate of cases) {
      const schema = openapi.paths?.[candidate.path]?.[candidate.method]
        ?.responses?.[String(candidate.status)]?.content?.['application/json']?.schema;
      if (!schema) {
        contractFailures.push({ case: candidate.name, error: 'missing application/json response schema' });
        continue;
      }
      const errors = validationErrors(
        validatorForResponse(candidate.method, candidate.path, candidate.status),
        candidate.body,
      );
      contractFailures.push(...errors.map((error) => ({ case: candidate.name, error })));
    }
    assert.deepEqual(
      contractFailures,
      [],
      `runtime-originated MCP errors must use bounded executor schemas without changing gateway-only error contracts:\n${JSON.stringify(contractFailures, null, 2)}`,
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

/**
 * bbx-933-aggregate-obligation-contract-38 | fn-managed-knative-owner-scoped-teardown
 * OpenSpec #### Scenario: Runtime outage defers cleanup honestly
 */
test('bbx-933-aggregate-obligation-contract-38: real coordinator pending obligations are projected to a secret-safe public shape', async () => {
  const identity = { sub: 'platform-superadmin', actorType: 'superadmin', roles: ['superadmin'] };
  const internalOwnership = {
    tenantId: 'ten_obligation',
    functions: [{
      type: 'function', resourceId: 'fn_obligation', tenantId: 'ten_obligation',
      workspaceId: 'wrk_obligation', ksvcName: 'function-orders-internal', name: 'orders',
    }],
    mcp: [{
      type: 'mcp', resourceId: 'srv-obligation', tenantId: 'ten_obligation',
      workspaceId: 'wrk_obligation', name: 'payments-internal',
    }],
  };
  const coordinator = createRuntimeTeardownCoordinator({
    store: {
      async listRuntimeOwnership() { return structuredClone(internalOwnership); },
      async deferAggregateCleanup() { return undefined; },
    },
    runtime: {
      async cleanup({ functions, mcp }) {
        return { ready: false, pending: [...functions, ...mcp] };
      },
    },
  });
  const scopedPool = ({ tenant, workspace }) => ({
    async query(sql) {
      const statement = String(sql).replace(/\s+/g, ' ').trim();
      if (statement.includes('FROM tenants WHERE id = $1 OR slug = $1')) return { rows: tenant ? [tenant] : [] };
      if (statement.includes('FROM workspaces WHERE id = $1 OR slug = $1')) return { rows: workspace ? [workspace] : [] };
      return { rows: [] };
    },
  });
  const tenant = await LOCAL_HANDLERS.purgeTenant({
    params: { tenantId: 'ten_obligation' }, identity,
    pool: scopedPool({ tenant: { id: 'ten_obligation', iam_realm: null } }),
    callerContext: { correlationId: 'corr-tenant-obligation' },
    runtimeTeardownCoordinator: coordinator,
  });
  const workspace = await LOCAL_HANDLERS.deleteWorkspace({
    params: { workspaceId: 'wrk_obligation' }, identity,
    pool: scopedPool({ workspace: { id: 'wrk_obligation', tenant_id: 'ten_obligation' } }),
    callerContext: { correlationId: 'corr-workspace-obligation' },
    runtimeTeardownCoordinator: coordinator,
  });
  assert.equal(tenant.statusCode, 202, JSON.stringify(tenant.body));
  assert.equal(workspace.statusCode, 202, JSON.stringify(workspace.body));

  const canonical = [
    { resourceType: 'function', resourceId: 'fn_obligation', status: 'pending' },
    { resourceType: 'mcp', resourceId: 'srv-obligation', status: 'pending' },
  ];
  const failures = [];
  for (const [operation, result, method, publicPath] of [
    ['tenant purge', tenant, 'post', TENANT_PURGE_PATH],
    ['workspace delete', workspace, 'delete', WORKSPACE_PATH],
  ]) {
    if (!isDeepStrictEqual(result.body.obligations, canonical)) {
      failures.push({ operation, error: 'obligations are not normalized', obligations: result.body.obligations });
    }
    for (const obligation of result.body.obligations) {
      const leakedFields = Object.keys(obligation)
        .filter((key) => ['tenantId', 'workspaceId', 'ksvcName', 'name', 'type'].includes(key));
      if (leakedFields.length) failures.push({ operation, resourceId: obligation.resourceId, leakedFields });
    }
    failures.push(...validationErrors(
      validatorForResponse(method, publicPath, 202),
      result.body,
    ).map((error) => ({ operation, error })));
  }
  assert.deepEqual(
    failures,
    [],
    `aggregate pending responses must expose only canonical secret-safe obligations:\n${JSON.stringify(failures, null, 2)}`,
  );
});

/**
 * bbx-933-aggregate-completed-response-35 | fn-managed-knative-owner-scoped-teardown
 * OpenSpec #### Scenario: Tenant teardown leaves no function workloads
 * OpenSpec #### Scenario: Tenant deprovision removes the complete MCP footprint
 */
test('bbx-933-aggregate-completed-response-35: completed tenant purge and workspace delete bodies have drift-safe 200 schemas', async () => {
  const identity = {
    sub: 'platform-superadmin',
    actorType: 'superadmin',
    roles: ['superadmin'],
  };
  const runtimeTeardownCoordinator = {
    async purgeTenant() { return { pending: false, obligations: [] }; },
    async purgeWorkspace() { return { pending: false, obligations: [] }; },
  };
  const poolFor = ({ tenant = null, workspace = null }) => ({
    async query(sql) {
      const statement = String(sql).replace(/\s+/g, ' ').trim();
      if (statement.includes('FROM tenants WHERE id = $1 OR slug = $1')) {
        return { rows: tenant ? [structuredClone(tenant)] : [] };
      }
      if (statement.includes('FROM workspaces WHERE id = $1 OR slug = $1')) {
        return { rows: workspace ? [structuredClone(workspace)] : [] };
      }
      return { rows: [] };
    },
  });

  const tenant = await LOCAL_HANDLERS.purgeTenant({
    params: { tenantId: 'ten_completed' },
    identity,
    pool: poolFor({ tenant: { id: 'ten_completed', iam_realm: null } }),
    callerContext: { correlationId: 'corr-tenant-completed' },
    runtimeTeardownCoordinator,
  });
  const workspace = await LOCAL_HANDLERS.deleteWorkspace({
    params: { workspaceId: 'wrk_completed' },
    identity,
    pool: poolFor({ workspace: { id: 'wrk_completed', tenant_id: 'ten_completed' } }),
    callerContext: { correlationId: 'corr-workspace-completed' },
    runtimeTeardownCoordinator,
    dropWorkspaceDatabase: async () => undefined,
    deleteBucket: async () => undefined,
    deleteTopics: async () => undefined,
  });

  assert.deepEqual(tenant, {
    statusCode: 200,
    body: {
      tenantId: 'ten_completed',
      purged: true,
      removed: {
        workspaces: 0,
        databases: [],
        realm: null,
        buckets: [],
        topics: [],
        mongoDatabases: [],
        mongoDatabasesRetained: [],
      },
      residual: { knativeServices: [] },
    },
  });
  assert.deepEqual(workspace, {
    statusCode: 200,
    body: {
      workspaceId: 'wrk_completed',
      tenantId: 'ten_completed',
      deleted: true,
      removed: {
        databases: [],
        buckets: [],
        topics: [],
        mongoDatabases: [],
        mongoDatabasesRetained: [],
      },
      residual: { knativeServices: [] },
    },
  });

  const published200 = {
    tenantPurge: openapi.paths?.[TENANT_PURGE_PATH]?.post?.responses?.['200']
      ?.content?.['application/json']?.schema ?? null,
    workspaceDelete: openapi.paths?.[WORKSPACE_PATH]?.delete?.responses?.['200']
      ?.content?.['application/json']?.schema ?? null,
  };
  assert.deepEqual(
    Object.entries(published200).filter(([, schema]) => !schema).map(([operation]) => operation),
    [],
    'authoritative OpenAPI must publish application/json 200 schemas for both completed teardown operations',
  );

  const validateTenant = validatorForResponse('post', TENANT_PURGE_PATH, 200);
  const validateWorkspace = validatorForResponse('delete', WORKSPACE_PATH, 200);
  const rejectedActual = [
    ...(!validateTenant(tenant.body) ? [{ operation: 'tenantPurge', errors: structuredClone(validateTenant.errors) }] : []),
    ...(!validateWorkspace(workspace.body) ? [{ operation: 'workspaceDelete', errors: structuredClone(validateWorkspace.errors) }] : []),
  ];
  const driftCandidates = {
    tenantNotPurged: [validateTenant, { ...tenant.body, purged: false }],
    tenantWrongIdentityKind: [validateTenant, { ...tenant.body, tenantId: 'wrk_completed' }],
    tenantPendingClaim: [validateTenant, { ...tenant.body, status: 'cleanup_pending' }],
    workspaceNotDeleted: [validateWorkspace, { ...workspace.body, deleted: false }],
    workspaceWrongIdentityKind: [validateWorkspace, { ...workspace.body, workspaceId: 'ten_completed' }],
    workspacePendingClaim: [validateWorkspace, { ...workspace.body, status: 'cleanup_pending' }],
  };
  const acceptedDrift = Object.entries(driftCandidates)
    .filter(([, [validate, body]]) => validate(body))
    .map(([name]) => name);
  assert.deepEqual(
    { rejectedActual, acceptedDrift },
    { rejectedActual: [], acceptedDrift: [] },
    'completed teardown schemas must accept real bodies and reject completion or identity drift',
  );
});

/**
 * bbx-933-aggregate-completion-residual-40 | fn-managed-knative-owner-scoped-teardown
 * OpenSpec #### Scenario: Tenant teardown leaves no function workloads
 */
test('bbx-933-aggregate-completion-residual-40: successfully cleaned Function ownership is not reported as residual', async () => {
  const identity = { sub: 'platform-superadmin', actorType: 'superadmin', roles: ['superadmin'] };
  const cleaned = [];
  const coordinator = createRuntimeTeardownCoordinator({
    store: {
      async listRuntimeOwnership(_pool, scope) {
        const workspaceId = scope.workspaceId ?? 'wrk_cleanup_success';
        return {
          tenantId: 'ten_cleanup_success',
          functions: [{
            type: 'function', resourceId: 'fn_cleanup_success', tenantId: 'ten_cleanup_success',
            workspaceId, ksvcName: `ksvc-${workspaceId}`,
          }],
          mcp: [],
        };
      },
      async deferAggregateCleanup() { throw new Error('successful cleanup must not be deferred'); },
    },
    runtime: {
      async cleanup({ functions }) {
        cleaned.push(...structuredClone(functions));
        return { ready: true, pending: [] };
      },
    },
  });
  const completionPool = ({ tenant, workspace, ksvcName }) => ({
    async query(sql) {
      const statement = String(sql).replace(/\s+/g, ' ').trim();
      if (statement.includes('FROM tenants WHERE id = $1 OR slug = $1')) return { rows: tenant ? [tenant] : [] };
      if (statement.includes('FROM workspaces WHERE id = $1 OR slug = $1')) return { rows: workspace ? [workspace] : [] };
      if (statement.includes('SELECT ksvc_name FROM fn_actions')) return { rows: [{ ksvc_name: ksvcName }] };
      return { rows: [] };
    },
  });
  const tenant = await LOCAL_HANDLERS.purgeTenant({
    params: { tenantId: 'ten_cleanup_success' }, identity,
    pool: completionPool({
      tenant: { id: 'ten_cleanup_success', iam_realm: null },
      ksvcName: 'ksvc-wrk_cleanup_success',
    }),
    callerContext: { correlationId: 'corr-tenant-cleanup-success' },
    runtimeTeardownCoordinator: coordinator,
  });
  const workspace = await LOCAL_HANDLERS.deleteWorkspace({
    params: { workspaceId: 'wrk_cleanup_success' }, identity,
    pool: completionPool({
      workspace: { id: 'wrk_cleanup_success', tenant_id: 'ten_cleanup_success' },
      ksvcName: 'ksvc-wrk_cleanup_success',
    }),
    callerContext: { correlationId: 'corr-workspace-cleanup-success' },
    runtimeTeardownCoordinator: coordinator,
    dropWorkspaceDatabase: async () => undefined,
    deleteBucket: async () => undefined,
    deleteTopics: async () => undefined,
  });
  assert.equal(tenant.statusCode, 200, JSON.stringify(tenant.body));
  assert.equal(workspace.statusCode, 200, JSON.stringify(workspace.body));
  assert.equal(cleaned.length, 2, 'the real coordinator must confirm both owner-scoped Function cleanups');
  assert.deepEqual(
    {
      tenantResidual: tenant.body.residual?.knativeServices,
      workspaceResidual: workspace.body.residual?.knativeServices,
    },
    { tenantResidual: [], workspaceResidual: [] },
    'a completed aggregate response must not describe successfully deleted Knative Services as residual',
  );
});

/**
 * bbx-933-aggregate-coordinator-error-41 | fn-managed-knative-owner-scoped-teardown
 * OpenSpec #### Scenario: Runtime outage defers cleanup honestly
 */
test('bbx-933-aggregate-coordinator-error-41: missing teardown coordinator 503 responses have explicit bounded schemas', async () => {
  const identity = { sub: 'platform-superadmin', actorType: 'superadmin', roles: ['superadmin'] };
  const poolFor = ({ tenant, workspace }) => ({
    async query(sql) {
      const statement = String(sql).replace(/\s+/g, ' ').trim();
      if (statement.includes('FROM tenants WHERE id = $1 OR slug = $1')) return { rows: tenant ? [tenant] : [] };
      if (statement.includes('FROM workspaces WHERE id = $1 OR slug = $1')) return { rows: workspace ? [workspace] : [] };
      return { rows: [] };
    },
  });
  const tenant = await LOCAL_HANDLERS.purgeTenant({
    params: { tenantId: 'ten_no_coordinator' }, identity,
    pool: poolFor({ tenant: { id: 'ten_no_coordinator', iam_realm: null } }),
  });
  const workspace = await LOCAL_HANDLERS.deleteWorkspace({
    params: { workspaceId: 'wrk_no_coordinator' }, identity,
    pool: poolFor({ workspace: { id: 'wrk_no_coordinator', tenant_id: 'ten_no_coordinator' } }),
  });
  const expected = {
    code: 'RUNTIME_TEARDOWN_UNAVAILABLE',
    message: 'runtime teardown coordinator is required',
  };
  assert.deepEqual(tenant, { statusCode: 503, body: expected });
  assert.deepEqual(workspace, { statusCode: 503, body: expected });

  const failures = [];
  for (const [operation, method, publicPath, body] of [
    ['tenant purge', 'post', TENANT_PURGE_PATH, tenant.body],
    ['workspace delete', 'delete', WORKSPACE_PATH, workspace.body],
  ]) {
    const schema = openapi.paths?.[publicPath]?.[method]?.responses?.['503']
      ?.content?.['application/json']?.schema;
    if (!schema) {
      failures.push({ operation, error: 'missing application/json 503 schema' });
      continue;
    }
    failures.push(...validationErrors(
      validatorForResponse(method, publicPath, 503), body,
    ).map((error) => ({ operation, error })));
  }
  assert.deepEqual(
    failures,
    [],
    `aggregate coordinator-unavailable responses must validate against explicit bounded 503 contracts:\n${JSON.stringify(failures, null, 2)}`,
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
