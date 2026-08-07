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
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

import Ajv from 'ajv';

import { FN_HANDLERS } from '../../../apps/control-plane/fn-handlers.mjs';
import { METRICS_HANDLERS } from '../../../apps/control-plane/metrics-handlers.mjs';
import { recordRouteAudit } from '../../../apps/control-plane/audit-writer.mjs';
import { routes } from '../../../apps/control-plane/routes.mjs';

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
