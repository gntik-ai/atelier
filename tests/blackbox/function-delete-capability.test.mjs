/**
 * bbx-fix-787-00..03 | fn-function-delete-capability
 * OpenSpec scenarios:
 * - #### Scenario: Workspace owner deletes an action and its owned runtime
 * - #### Scenario: Cross-tenant action lookup is hidden
 * - #### Scenario: A caller without the target workspace claim receives a hidden denial
 *
 * Regression coverage for fix-787-function-delete-capability (#787).
 *
 * The kind control-plane advertised DELETE /v1/functions/actions/{resourceId} in the public
 * contract but did not route it at runtime. These tests drive the real FN_HANDLERS surface with an
 * in-memory pg-like pool and an injected Knative delete seam, so they are deterministic and never
 * mutate a live cluster.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { routes } from '../../apps/control-plane/routes.mjs';
import { FN_HANDLERS } from '../../apps/control-plane/fn-handlers.mjs';

const TENANT_ID = 'ten_alpha';
const FOREIGN_TENANT_ID = 'ten_beta';
const WORKSPACE_ID = 'wrk_alpha';
const FOREIGN_WORKSPACE_ID = 'wrk_beta';

const OWNER = {
  sub: 'user_alpha_owner',
  tenantId: TENANT_ID,
  workspaceId: WORKSPACE_ID,
  credentialWorkspaceId: WORKSPACE_ID,
  workspaceIds: [WORKSPACE_ID],
  actorType: 'workspace_owner',
  roles: ['workspace_owner']
};

const ADJACENT_WORKSPACE_OWNER = {
  sub: 'user_alpha_adjacent_workspace_owner',
  tenantId: TENANT_ID,
  workspaceId: FOREIGN_WORKSPACE_ID,
  credentialWorkspaceId: FOREIGN_WORKSPACE_ID,
  workspaceIds: [FOREIGN_WORKSPACE_ID],
  actorType: 'workspace_owner',
  roles: ['workspace_owner']
};

function compilePath(tmpl) {
  const rx = tmpl
    .replace(/[.+^${}()|[\]\\]/g, (m) => '\\' + m)
    .replace(/\\\{([a-zA-Z0-9_]+)\\\}/g, '(?<$1>[^/]+)')
    .replace(/\/\\\*$/, '(?:/.*)?')
    .replace(/\\\*/g, '.*');
  return new RegExp('^' + rx + '/?$');
}

function matchRoute(compiledRoutes, method, path) {
  for (const r of compiledRoutes) {
    if (r.method !== method && r.method !== 'ANY') continue;
    const m = r._rx.exec(path);
    if (m) return { route: r, params: m.groups ?? {} };
  }
  return null;
}

const COMPILED = routes.map((r) => ({ ...r, _rx: compilePath(r.path) }));

function makePool() {
  const actions = new Map();
  const versions = new Map();
  const activations = new Map();

  const seedAction = (row) => {
    actions.set(row.resource_id, structuredClone(row));
    versions.set(`${row.resource_id}:v1`, {
      version_id: `${row.resource_id}_v1`,
      resource_id: row.resource_id,
      tenant_id: row.tenant_id,
      workspace_id: row.workspace_id
    });
    activations.set(`${row.resource_id}:act1`, {
      activation_id: `${row.resource_id}_act1`,
      resource_id: row.resource_id,
      workspace_id: row.workspace_id
    });
  };

  seedAction({
    resource_id: 'res_fn_1',
    workspace_id: WORKSPACE_ID,
    tenant_id: TENANT_ID,
    action_name: 'hello-fn',
    runtime: 'nodejs:22',
    entrypoint: 'main',
    source_code: 'exports.main = async () => ({ ok: true })',
    parameters: {},
    memory_mb: 256,
    timeout_ms: 60000,
    version: 1,
    ksvc_name: 'ksvc-alpha',
    created_at: '2026-03-29T07:00:00.000Z',
    updated_at: '2026-03-29T07:00:00.000Z',
    created_by: OWNER.sub
  });

  seedAction({
    resource_id: 'res_fn_foreign',
    workspace_id: FOREIGN_WORKSPACE_ID,
    tenant_id: FOREIGN_TENANT_ID,
    action_name: 'foreign-fn',
    runtime: 'nodejs:22',
    entrypoint: 'main',
    source_code: 'exports.main = async () => ({ foreign: true })',
    parameters: {},
    memory_mb: 256,
    timeout_ms: 60000,
    version: 1,
    ksvc_name: 'ksvc-foreign',
    created_at: '2026-03-29T07:00:00.000Z',
    updated_at: '2026-03-29T07:00:00.000Z',
    created_by: 'user_beta_owner'
  });

  function clone(row) {
    return row == null ? row : structuredClone(row);
  }

  return {
    actions,
    versions,
    activations,
    async query(sql, params = []) {
      const s = sql.replace(/\s+/g, ' ').trim().toLowerCase();

      if (s.startsWith('delete from fn_actions')) {
        const [resourceId, tenantId] = params;
        const row = actions.get(resourceId);
        if (row && row.tenant_id === tenantId) {
          actions.delete(resourceId);
          return { rows: [clone(row)] };
        }
        return { rows: [] };
      }

      if (s.includes('from fn_actions') && s.includes('where resource_id=$1 and tenant_id=$2')) {
        const row = actions.get(params[0]);
        return { rows: row && row.tenant_id === params[1] ? [clone(row)] : [] };
      }

      if (s.includes('from fn_actions') && s.includes('where resource_id=$1')) {
        const row = actions.get(params[0]);
        return { rows: row ? [clone(row)] : [] };
      }

      if (s.startsWith('delete from fn_activations')) {
        const [resourceId, workspaceId] = params;
        for (const [key, row] of [...activations.entries()]) {
          if (row.resource_id === resourceId && row.workspace_id === workspaceId) activations.delete(key);
        }
        return { rows: [] };
      }

      if (s.startsWith('delete from fn_action_versions')) {
        const [resourceId, tenantId] = params;
        for (const [key, row] of [...versions.entries()]) {
          if (row.resource_id === resourceId && row.tenant_id === tenantId) versions.delete(key);
        }
        return { rows: [] };
      }

      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
}

function ctx(pool, { identity = OWNER, actionId = 'res_fn_1', deleteKnativeService } = {}) {
  return {
    pool,
    params: { actionId },
    identity,
    callerContext: { correlationId: 'corr_787' },
    knativeRuntime: { functionsEnabled: true, status: () => ({ mode: 'managed', state: 'ready', reason: 'READY' }), canServeWorkloads: () => true },
    deleteKnativeService
  };
}

function countFor(map, resourceId) {
  return [...map.values()].filter((row) => row.resource_id === resourceId).length;
}

test('fix-787-00: DELETE /v1/functions/actions/{id} resolves to fnDelete', () => {
  const deleteEntries = routes.filter(
    (r) => r.path === '/v1/functions/actions/{actionId}' && r.localHandler === 'fnDelete'
  );
  assert.equal(deleteEntries.length, 1);
  assert.equal(deleteEntries[0].method, 'DELETE');
  assert.equal(deleteEntries[0].auth, 'authenticated');

  const hit = matchRoute(COMPILED, 'DELETE', '/v1/functions/actions/res_fn_1');
  assert.ok(hit, 'DELETE /v1/functions/actions/{id} must resolve to a route');
  assert.equal(hit.route.localHandler, 'fnDelete');
  assert.equal(hit.params.actionId, 'res_fn_1');
});

test('fix-787-01: target-bound workspace owner delete removes owned action rows and owned Knative service', async () => {
  const pool = makePool();
  const deletedKsvcs = [];

  const response = await FN_HANDLERS.fnDelete(ctx(pool, {
    deleteKnativeService: async (name) => { deletedKsvcs.push(name); }
  }));

  assert.equal(response.statusCode, 202);
  assert.equal(response.body.resourceId, 'res_fn_1');
  assert.equal(response.body.status, 'accepted');
  assert.deepEqual(deletedKsvcs, ['ksvc-alpha']);
  assert.equal(pool.actions.has('res_fn_1'), false);
  assert.equal(countFor(pool.versions, 'res_fn_1'), 0);
  assert.equal(countFor(pool.activations, 'res_fn_1'), 0);

  assert.equal(pool.actions.has('res_fn_foreign'), true, 'foreign tenant action must not be deleted');
  assert.equal(countFor(pool.versions, 'res_fn_foreign'), 1);
  assert.equal(countFor(pool.activations, 'res_fn_foreign'), 1);
});

test('fix-787-02: cross-tenant delete is scoped 404 and has no side effects', async () => {
  const pool = makePool();
  const deletedKsvcs = [];

  const response = await FN_HANDLERS.fnDelete(ctx(pool, {
    actionId: 'res_fn_foreign',
    deleteKnativeService: async (name) => { deletedKsvcs.push(name); }
  }));

  assert.equal(response.statusCode, 404);
  assert.equal(response.body.code, 'ACTION_NOT_FOUND');
  assert.deepEqual(deletedKsvcs, []);
  assert.equal(pool.actions.has('res_fn_foreign'), true);
  assert.equal(countFor(pool.versions, 'res_fn_foreign'), 1);
  assert.equal(countFor(pool.activations, 'res_fn_foreign'), 1);
});

test('fix-787-03: same-tenant owner without the target workspace claim receives a hidden denial', async () => {
  const pool = makePool();
  const deletedKsvcs = [];

  const response = await FN_HANDLERS.fnDelete(ctx(pool, {
    identity: ADJACENT_WORKSPACE_OWNER,
    deleteKnativeService: async (name) => { deletedKsvcs.push(name); }
  }));

  assert.equal(response.statusCode, 404);
  assert.equal(response.body.code, 'ACTION_NOT_FOUND');
  assert.deepEqual(deletedKsvcs, []);
  assert.equal(pool.actions.has('res_fn_1'), true);
  assert.equal(countFor(pool.versions, 'res_fn_1'), 1);
  assert.equal(countFor(pool.activations, 'res_fn_1'), 1);
});
