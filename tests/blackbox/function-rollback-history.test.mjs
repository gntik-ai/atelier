/**
 * Regression coverage for fix-786-function-rollback-history (#786).
 *
 * The issue was not a route problem: the kind control-plane accepted rollback requests but kept no
 * durable version history, returned a single active `vN` row, and did not mutate function state.
 * These tests drive the public FN_HANDLERS surface with an in-memory pg-like pool and a fake
 * Knative deploy helper, so they are deterministic and do not require Kubernetes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { FN_HANDLERS } from '../../apps/control-plane/fn-handlers.mjs';
import { KNATIVE_RUNTIME_HANDLERS } from '../../apps/control-plane/knative-runtime-handlers.mjs';
import { syntheticFnVersionId } from '../../apps/control-plane/tenant-store.mjs';

const TENANT_ID = 'ten_alpha';
const WORKSPACE_ID = 'wrk_alpha';
const OWNER = {
  sub: 'user_alpha_owner',
  tenantId: TENANT_ID,
  workspaceId: WORKSPACE_ID,
  actorType: 'workspace_owner',
  roles: ['workspace_owner']
};
const MEMBER = {
  sub: 'user_alpha_member',
  tenantId: TENANT_ID,
  workspaceId: WORKSPACE_ID,
  actorType: 'tenant_member',
  roles: ['tenant_member']
};
const WRONG_WORKSPACE_OWNER = {
  sub: 'user_alpha_other_workspace_owner',
  tenantId: TENANT_ID,
  workspaceId: 'wrk_other',
  credentialWorkspaceId: 'wrk_other',
  actorType: 'workspace_owner',
  roles: ['workspace_owner']
};

function makePool() {
  let tick = 0;
  const actions = new Map();
  const versions = new Map();
  const activations = new Map();
  const counters = { versionActivations: 0, actionUpdates: 0 };
  const workspace = {
    id: WORKSPACE_ID,
    tenant_id: TENANT_ID,
    slug: 'alpha',
    display_name: 'Alpha',
    status: 'active',
    environment: 'dev',
    created_at: iso()
  };

  function iso() {
    tick += 1;
    return new Date(Date.UTC(2026, 2, 29, 7, tick, 0)).toISOString();
  }

  function clone(row) {
    return row == null ? row : structuredClone(row);
  }

  function parseJson(value) {
    if (typeof value !== 'string') return value ?? null;
    try { return JSON.parse(value); } catch { return value; }
  }

  function actionByWorkspaceName(workspaceId, actionName) {
    return [...actions.values()].find((row) => row.workspace_id === workspaceId && row.action_name === actionName);
  }

  function versionByResourceNumber(resourceId, versionNumber) {
    return [...versions.values()].find((row) => row.resource_id === resourceId && row.version_number === versionNumber);
  }

  function versionsForResource(resourceId) {
    return [...versions.values()]
      .filter((row) => row.resource_id === resourceId)
      .sort((a, b) => b.version_number - a.version_number || String(b.created_at).localeCompare(String(a.created_at)));
  }

  return {
    actions,
    versions,
    activations,
    counters,
    seedAction(overrides = {}) {
      const now = iso();
      const row = {
        resource_id: 'fn_legacy786',
        workspace_id: WORKSPACE_ID,
        tenant_id: TENANT_ID,
        action_name: 'legacy-fn',
        runtime: 'nodejs:20',
        entrypoint: 'main',
        source_code: 'module.exports=async()=>({version:"legacy-active"})',
        parameters: {},
        memory_mb: 256,
        timeout_ms: 60000,
        version: 2,
        ksvc_name: null,
        created_at: now,
        updated_at: now,
        created_by: OWNER.sub,
        ...overrides
      };
      actions.set(row.resource_id, row);
      return row;
    },
    seedActivation(overrides = {}) {
      const row = {
        activation_id: 'act_933_workspace_scope',
        resource_id: 'fn_933_workspace_scope',
        tenant_id: TENANT_ID,
        workspace_id: WORKSPACE_ID,
        status: 'success',
        status_code: 200,
        result: { secret: 'owner-only-result' },
        logs: ['owner-only-log'],
        duration_ms: 12,
        started_at: iso(),
        finished_at: iso(),
        ...overrides,
      };
      activations.set(row.activation_id, row);
      return row;
    },
    async query(sql, params = []) {
      const s = sql.replace(/\s+/g, ' ').trim().toLowerCase();

      if (s.includes('from workspaces') && s.includes('where id = $1 or slug')) {
        return { rows: params[0] === WORKSPACE_ID || params[0] === workspace.slug ? [clone(workspace)] : [] };
      }

      if (s.startsWith('insert into fn_actions')) {
        const [
          resourceId, workspaceId, tenantId, actionName, runtime, entrypoint, sourceCode,
          parameters, memoryMb, timeoutMs, ksvcName, createdBy
        ] = params;
        const now = iso();
        let row = actionByWorkspaceName(workspaceId, actionName);
        if (row) {
          row = {
            ...row,
            runtime,
            entrypoint,
            source_code: sourceCode,
            parameters: parseJson(parameters),
            memory_mb: memoryMb,
            timeout_ms: timeoutMs,
            ksvc_name: ksvcName,
            version: row.version + 1,
            updated_at: now
          };
        } else {
          row = {
            resource_id: resourceId,
            workspace_id: workspaceId,
            tenant_id: tenantId,
            action_name: actionName,
            runtime,
            entrypoint,
            source_code: sourceCode,
            parameters: parseJson(parameters),
            memory_mb: memoryMb,
            timeout_ms: timeoutMs,
            version: 1,
            ksvc_name: ksvcName,
            created_at: now,
            updated_at: now,
            created_by: createdBy
          };
        }
        actions.set(row.resource_id, row);
        return { rows: [clone(row)] };
      }

      if (s.includes('from fn_actions') && s.includes('where resource_id=$1 and tenant_id=$2')) {
        const row = actions.get(params[0]);
        const workspaceMatches = !s.includes('workspace_id=') || params.includes(row?.workspace_id);
        return { rows: row && row.tenant_id === params[1] && workspaceMatches ? [clone(row)] : [] };
      }

      if (s.includes('from fn_actions') && s.includes('where resource_id=$1')) {
        const row = actions.get(params[0]);
        return { rows: row ? [clone(row)] : [] };
      }

      if (s.includes('from fn_actions') && s.includes('where workspace_id=$1 and action_name=$2')) {
        const row = actionByWorkspaceName(params[0], params[1]);
        return { rows: row ? [clone(row)] : [] };
      }

      if (s.includes('from fn_actions') && s.includes('where workspace_id=$1')) {
        return { rows: [...actions.values()].filter((row) => row.workspace_id === params[0]).map(clone) };
      }

      if (s.startsWith('insert into fn_action_versions')) {
        const [
          versionId, resourceId, workspaceId, tenantId, actionName, versionNumber, originType,
          originVersionId, runtime, entrypoint, sourceCode, parameters, memoryMb, timeoutMs,
          ksvcName, createdBy
        ] = params;
        const now = iso();
        let row = versionByResourceNumber(resourceId, versionNumber);
        if (row) {
          row = {
            ...row,
            action_name: actionName,
            origin_type: originType,
            origin_version_id: originVersionId,
            runtime,
            entrypoint,
            source_code: sourceCode,
            parameters: parseJson(parameters),
            memory_mb: memoryMb,
            timeout_ms: timeoutMs,
            ksvc_name: ksvcName,
            updated_at: now,
            created_by: createdBy ?? row.created_by
          };
        } else {
          row = {
            version_id: versionId,
            resource_id: resourceId,
            workspace_id: workspaceId,
            tenant_id: tenantId,
            action_name: actionName,
            version_number: versionNumber,
            status: 'historical',
            origin_type: originType,
            origin_version_id: originVersionId,
            runtime,
            entrypoint,
            source_code: sourceCode,
            parameters: parseJson(parameters),
            memory_mb: memoryMb,
            timeout_ms: timeoutMs,
            ksvc_name: ksvcName,
            created_at: now,
            updated_at: now,
            activated_at: null,
            created_by: createdBy
          };
        }
        versions.set(row.version_id, row);
        return { rows: [clone(row)] };
      }

      if (s.startsWith('update fn_action_versions') && s.includes("set status='historical'")) {
        const [resourceId, keepVersionId] = params;
        for (const row of versions.values()) {
          if (row.resource_id === resourceId && row.version_id !== keepVersionId && row.status === 'active') {
            row.status = 'historical';
            row.updated_at = iso();
          }
        }
        return { rows: [] };
      }

      if (s.startsWith('update fn_action_versions') && s.includes("set status='active'")) {
        const versionId = params.length === 1 ? params[0] : params[1];
        const row = versions.get(versionId);
        if (!row) return { rows: [] };
        counters.versionActivations += 1;
        row.status = 'active';
        row.activated_at = iso();
        row.updated_at = row.activated_at;
        return { rows: [clone(row)] };
      }

      if (s.includes('from fn_action_versions') && s.includes('where resource_id=$1 and version_id=$2 and tenant_id=$3')) {
        const row = versions.get(params[1]);
        return { rows: row && row.resource_id === params[0] && row.tenant_id === params[2] ? [clone(row)] : [] };
      }

      if (s.includes('from fn_action_versions') && s.includes('where resource_id=$1 and version_id=$2')) {
        const row = versions.get(params[1]);
        return { rows: row && row.resource_id === params[0] ? [clone(row)] : [] };
      }

      if (s.includes('from fn_action_versions') && s.includes('where resource_id=$1')) {
        return { rows: versionsForResource(params[0]).map(clone) };
      }

      if (s.startsWith('update fn_actions set')) {
        const [resourceId, tenantId, sourceCode, runtime, entrypoint, parameters, memoryMb, timeoutMs, ksvcName] = params;
        const row = actions.get(resourceId);
        if (!row || row.tenant_id !== tenantId) return { rows: [] };
        row.source_code = sourceCode;
        row.runtime = runtime;
        row.entrypoint = entrypoint;
        row.parameters = parseJson(parameters);
        row.memory_mb = memoryMb;
        row.timeout_ms = timeoutMs;
        row.ksvc_name = ksvcName ?? row.ksvc_name;
        row.updated_at = iso();
        counters.actionUpdates += 1;
        actions.set(resourceId, row);
        return { rows: [clone(row)] };
      }

      if (s.includes('from fn_activations') && s.includes('activation_id')) {
        const row = activations.get(params.find((value) => activations.has(value)));
        const workspaceMatches = !s.includes('workspace_id') || params.includes(row?.workspace_id);
        return { rows: row && workspaceMatches ? [clone(row)] : [] };
      }

      if (s.includes('from fn_activations') && s.includes('resource_id')) {
        const rows = [...activations.values()].filter((row) => (
          row.resource_id === params[0]
          && (!s.includes('workspace_id') || params.includes(row.workspace_id))
        ));
        return { rows: rows.map(clone) };
      }

      if (s.includes('from fn_activations')) return { rows: [] };

      return { rows: [] };
    }
  };
}

function deployBody(inlineCode) {
  return {
    workspaceId: WORKSPACE_ID,
    actionName: 'hello-fn',
    source: { kind: 'inline_code', inlineCode, entryFile: 'index.js' },
    execution: {
      runtime: 'nodejs:20',
      entrypoint: 'main',
      parameters: { mode: 'test' },
      limits: { memoryMb: 256, timeoutMs: 60000 }
    },
    activationPolicy: {
      logsAccess: 'workspace_developers',
      resultAccess: 'workspace_developers',
      rerunPolicy: 'manual_only',
      retentionHours: 168
    }
  };
}

const READY_RUNTIME = {
  functionsEnabled: true,
  status: () => ({ mode: 'managed', state: 'ready', reason: 'READY' }),
  canServeWorkloads: () => true,
};

const OUTAGE_RUNTIME = {
  functionsEnabled: true,
  status: () => ({ mode: 'managed', state: 'degraded', reason: 'CONTROL_PLANE_NOT_READY' }),
  canServeWorkloads: () => false,
};

function ctx(pool, {
  params = {},
  body = {},
  identity = OWNER,
  deployKnativeService = async () => {},
  knativeRuntime = READY_RUNTIME,
} = {}) {
  return {
    pool,
    params,
    body,
    identity,
    callerContext: { correlationId: 'corr_786_rollback', actor: { id: identity.sub, type: identity.actorType }, tenantId: identity.tenantId },
    knativeRuntime,
    deployKnativeService
  };
}

test('bbx-786-01: owner deploys two versions, rolls back to retained prior version, and history remains', async () => {
  const pool = makePool();
  const deployCalls = [];
  const fakeDeploy = async (...args) => { deployCalls.push(args); };
  const codeV1 = 'module.exports=async()=>({version:"one"})';
  const codeV2 = 'module.exports=async()=>({version:"two"})';

  const create = await FN_HANDLERS.fnDeploy(ctx(pool, { body: deployBody(codeV1), deployKnativeService: fakeDeploy }));
  assert.equal(create.statusCode, 202);
  assert.equal(create.body.family, 'functions');
  assert.equal(create.body.resourceType, 'function_action');
  const resourceId = create.body.resourceId;

  const update = await FN_HANDLERS.fnDeploy(ctx(pool, {
    params: { actionId: resourceId },
    body: deployBody(codeV2),
    deployKnativeService: fakeDeploy
  }));
  assert.equal(update.statusCode, 202);
  assert.equal(update.body.family, 'functions');
  assert.equal(update.body.resourceType, 'function_action');

  const detailBefore = await FN_HANDLERS.fnActionDetail(ctx(pool, { params: { actionId: resourceId } }));
  assert.equal(detailBefore.statusCode, 200);
  assert.equal(detailBefore.body.rollbackAvailable, true);
  assert.equal(detailBefore.body.versionCount, 2);
  assert.match(detailBefore.body.activeVersionId, /^fnv_[0-9a-z]+$/);
  assert.equal(detailBefore.body.source.inlineCode, codeV2);

  const listedBefore = await FN_HANDLERS.fnVersions(ctx(pool, { params: { actionId: resourceId } }));
  assert.equal(listedBefore.statusCode, 200);
  assert.deepEqual(listedBefore.body.page, { size: 2 });
  assert.equal(listedBefore.body.items.length, 2);
  assert.deepEqual(listedBefore.body.items.map((item) => item.versionNumber), [2, 1]);
  assert.ok(listedBefore.body.items.every((item) => /^fnv_[0-9a-z]+$/.test(item.versionId)));
  assert.ok(listedBefore.body.items.every((item) => item.source?.kind === 'inline_code'));
  assert.ok(listedBefore.body.items.every((item) => item.execution?.runtime === 'nodejs:20'));
  assert.ok(listedBefore.body.items.every((item) => item.activationPolicy?.rerunPolicy === 'manual_only'));

  const active = listedBefore.body.items.find((item) => item.status === 'active');
  const prior = listedBefore.body.items.find((item) => item.rollbackEligible);
  assert.equal(active.versionNumber, 2);
  assert.equal(prior.versionNumber, 1);

  const currentRollback = await FN_HANDLERS.fnRollback(ctx(pool, {
    params: { actionId: resourceId },
    body: { versionId: active.versionId },
    deployKnativeService: fakeDeploy
  }));
  assert.equal(currentRollback.statusCode, 409);
  assert.equal(currentRollback.body.code, 'VERSION_NOT_ELIGIBLE');

  const rollback = await FN_HANDLERS.fnRollback(ctx(pool, {
    params: { actionId: resourceId },
    body: { versionId: prior.versionId },
    deployKnativeService: fakeDeploy
  }));
  assert.equal(rollback.statusCode, 202);
  assert.equal(rollback.body.requestedVersionId, prior.versionId);
  assert.equal(rollback.body.correlationId, 'corr_786_rollback');

  const rollbackDeploy = deployCalls.at(-1);
  assert.equal(rollbackDeploy[1], codeV1, 'rollback redeploys the selected retained source snapshot');

  const detailAfter = await FN_HANDLERS.fnActionDetail(ctx(pool, { params: { actionId: resourceId } }));
  assert.equal(detailAfter.statusCode, 200);
  assert.equal(detailAfter.body.activeVersionId, prior.versionId);
  assert.equal(detailAfter.body.source.inlineCode, codeV1);
  assert.equal(detailAfter.body.rollbackAvailable, false);

  const listedAfter = await FN_HANDLERS.fnVersions(ctx(pool, { params: { actionId: resourceId } }));
  assert.equal(listedAfter.statusCode, 200);
  assert.deepEqual(listedAfter.body.page, { size: 2 });
  assert.equal(listedAfter.body.items.length, 2, 'retained history remains visible after rollback');
  assert.equal(listedAfter.body.items.find((item) => item.versionId === prior.versionId).status, 'active');
  assert.equal(listedAfter.body.items.find((item) => item.versionId === active.versionId).status, 'historical');
});

test('bbx-786-02: first post-upgrade update of a legacy action retains the pre-update rollback target', async () => {
  const pool = makePool();
  const deployCalls = [];
  const fakeDeploy = async (...args) => { deployCalls.push(args); };
  const legacyCode = 'module.exports=async()=>({version:"legacy-before-update"})';
  const updatedCode = 'module.exports=async()=>({version:"after-update"})';
  const legacy = pool.seedAction({
    resource_id: 'fn_legacy786',
    action_name: 'hello-fn',
    version: 1,
    source_code: legacyCode,
    ksvc_name: 'ksvc-legacy-786'
  });

  const update = await FN_HANDLERS.fnDeploy(ctx(pool, {
    params: { actionId: legacy.resource_id },
    body: deployBody(updatedCode),
    deployKnativeService: fakeDeploy
  }));
  assert.equal(update.statusCode, 202);
  assert.equal(update.body.family, 'functions');
  assert.equal(update.body.resourceType, 'function_action');

  const listed = await FN_HANDLERS.fnVersions(ctx(pool, { params: { actionId: legacy.resource_id } }));
  assert.equal(listed.statusCode, 200);
  assert.deepEqual(listed.body.page, { size: 2 });
  assert.equal(listed.body.items.length, 2, 'first post-fix update must produce legacy + new retained snapshots');
  assert.deepEqual(listed.body.items.map((item) => item.versionNumber), [2, 1]);

  const prior = listed.body.items.find((item) => item.versionNumber === 1);
  const active = listed.body.items.find((item) => item.versionNumber === 2);
  assert.equal(active.status, 'active');
  assert.equal(active.rollbackEligible, false);
  assert.equal(prior.status, 'historical');
  assert.equal(prior.rollbackEligible, true);
  assert.equal(prior.source.inlineCode, legacyCode);

  const detailBeforeRollback = await FN_HANDLERS.fnActionDetail(ctx(pool, { params: { actionId: legacy.resource_id } }));
  assert.equal(detailBeforeRollback.statusCode, 200);
  assert.equal(detailBeforeRollback.body.rollbackAvailable, true);
  assert.equal(detailBeforeRollback.body.source.inlineCode, updatedCode);

  const rollback = await FN_HANDLERS.fnRollback(ctx(pool, {
    params: { actionId: legacy.resource_id },
    body: { versionId: prior.versionId },
    deployKnativeService: fakeDeploy
  }));
  assert.equal(rollback.statusCode, 202);
  assert.equal(deployCalls.at(-1)[1], legacyCode);

  const detailAfterRollback = await FN_HANDLERS.fnActionDetail(ctx(pool, { params: { actionId: legacy.resource_id } }));
  assert.equal(detailAfterRollback.statusCode, 200);
  assert.equal(detailAfterRollback.body.activeVersionId, prior.versionId);
  assert.equal(detailAfterRollback.body.source.inlineCode, legacyCode);
});

test('bbx-786-03: same-tenant non-admin rollback is 403 and performs no deploy or DB activation', async () => {
  const pool = makePool();
  const deployCalls = [];
  const fakeDeploy = async (...args) => { deployCalls.push(args); };
  const codeV1 = 'module.exports=async()=>({version:"one"})';
  const codeV2 = 'module.exports=async()=>({version:"two"})';

  const create = await FN_HANDLERS.fnDeploy(ctx(pool, { body: deployBody(codeV1), deployKnativeService: fakeDeploy }));
  const resourceId = create.body.resourceId;
  await FN_HANDLERS.fnDeploy(ctx(pool, {
    params: { actionId: resourceId },
    body: deployBody(codeV2),
    deployKnativeService: fakeDeploy
  }));
  const listed = await FN_HANDLERS.fnVersions(ctx(pool, { params: { actionId: resourceId } }));
  const prior = listed.body.items.find((item) => item.rollbackEligible);
  assert.ok(prior, 'setup must have an eligible prior version');

  const deployCountBefore = deployCalls.length;
  const versionActivationsBefore = pool.counters.versionActivations;
  const actionUpdatesBefore = pool.counters.actionUpdates;
  const activeBefore = listed.body.items.find((item) => item.status === 'active').versionId;

  const denied = await FN_HANDLERS.fnRollback(ctx(pool, {
    params: { actionId: resourceId },
    body: { versionId: prior.versionId },
    identity: MEMBER,
    deployKnativeService: fakeDeploy
  }));

  assert.equal(denied.statusCode, 403);
  assert.equal(denied.body.code, 'FORBIDDEN');
  assert.equal(deployCalls.length, deployCountBefore, 'denied rollback must not redeploy function code');
  assert.equal(pool.counters.versionActivations, versionActivationsBefore, 'denied rollback must not activate a retained version');
  assert.equal(pool.counters.actionUpdates, actionUpdatesBefore, 'denied rollback must not update fn_actions');

  const listedAfter = await FN_HANDLERS.fnVersions(ctx(pool, { params: { actionId: resourceId } }));
  assert.equal(listedAfter.body.items.find((item) => item.status === 'active').versionId, activeBefore);
});

test('bbx-786-04: legacy active rows without retained history list only active snapshot and cannot roll back', async () => {
  const pool = makePool();
  const legacy = pool.seedAction();

  const detail = await FN_HANDLERS.fnActionDetail(ctx(pool, { params: { actionId: legacy.resource_id } }));
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.body.rollbackAvailable, false, 'legacy version counter alone must not claim rollback is available');
  assert.equal(detail.body.versionCount, 1);

  const listed = await FN_HANDLERS.fnVersions(ctx(pool, { params: { actionId: legacy.resource_id } }));
  assert.equal(listed.statusCode, 200);
  assert.deepEqual(listed.body.page, { size: 1 });
  assert.equal(listed.body.items.length, 1);
  assert.equal(listed.body.items[0].versionId, syntheticFnVersionId(legacy));
  assert.match(listed.body.items[0].versionId, /^fnv_[0-9a-z]+$/);
  assert.equal(listed.body.items[0].status, 'active');
  assert.equal(listed.body.items[0].rollbackEligible, false);

  const rollback = await FN_HANDLERS.fnRollback(ctx(pool, {
    params: { actionId: legacy.resource_id },
    body: { versionId: listed.body.items[0].versionId }
  }));
  assert.equal(rollback.statusCode, 404);
  assert.equal(rollback.body.code, 'VERSION_NOT_FOUND');
});

/**
 * bbx-933-src-fn-mutation-roles-13 | fn-function-workspace-authorization
 * OpenSpec #### Scenario: Version and rollback preserve Function semantics
 */
test('bbx-933-src-fn-mutation-roles-13: target-bound workspace owner/admin/developer can reach Function mutation', async () => {
  const roles = ['workspace_owner', 'workspace_admin', 'workspace_developer'];
  const observed = {};

  for (const role of roles) {
    const response = await FN_HANDLERS.fnDeploy(ctx(makePool(), {
      identity: {
        sub: `user_${role}`,
        tenantId: TENANT_ID,
        workspaceId: WORKSPACE_ID,
        actorType: role,
        roles: [role],
      },
      body: { ...deployBody(`module.exports=async()=>({role:${JSON.stringify(role)}})`), actionName: `fn-${role}` },
    }));
    observed[role] = response.statusCode;
  }

  assert.deepEqual(observed, {
    workspace_owner: 202,
    workspace_admin: 202,
    workspace_developer: 202,
  });
});

/**
 * bbx-933-src-fn-mutation-deny-14 | fn-function-workspace-authorization
 * OpenSpec #### Scenario: Deploy fails explicitly while managed runtime is degraded
 * OpenSpec #### Scenario: Adjacent tenant cannot use dependency status to enumerate workloads
 */
test('bbx-933-src-fn-mutation-deny-14: non-workspace roles are denied before Knative outage disclosure', async () => {
  const denied = {
    tenant_owner: {
      sub: 'tenant_owner_only', tenantId: TENANT_ID, workspaceId: WORKSPACE_ID,
      actorType: 'tenant_owner', roles: ['tenant_owner'],
    },
    tenant_admin: {
      sub: 'tenant_admin_only', tenantId: TENANT_ID, workspaceId: WORKSPACE_ID,
      actorType: 'tenant_admin', roles: ['tenant_admin'],
    },
    platform_operator: {
      sub: 'platform_operator_only', tenantId: TENANT_ID, workspaceId: WORKSPACE_ID,
      actorType: 'platform_operator', roles: ['platform_operator'], trust: { kind: 'platform' },
    },
    internal_actor: {
      sub: 'internal_actor_only', tenantId: null, workspaceId: null,
      actorType: 'internal', roles: [], trust: { kind: 'internal' },
    },
    actor_type_superadmin: {
      sub: 'actor_type_superadmin', tenantId: null, workspaceId: null,
      actorType: 'superadmin', roles: [], trust: { kind: 'platform' },
    },
  };
  const observed = {};

  for (const [name, identity] of Object.entries(denied)) {
    const pool = makePool();
    const response = await FN_HANDLERS.fnDeploy(ctx(pool, {
      identity,
      knativeRuntime: OUTAGE_RUNTIME,
      body: { ...deployBody('module.exports=async()=>({denied:true})'), actionName: `denied-${name}` },
    }));
    observed[name] = {
      statusCode: response.statusCode,
      disclosedDependency: JSON.stringify(response.body).includes('KNATIVE'),
      persistedActions: pool.actions.size,
    };
  }

  assert.deepEqual(observed, Object.fromEntries(
    Object.keys(denied).map((name) => [name, {
      statusCode: 403,
      disclosedDependency: false,
      persistedActions: 0,
    }]),
  ));
});

/**
 * bbx-933-src-fn-wrong-workspace-read-15 | fn-function-workspace-isolation
 * OpenSpec #### Scenario: Degraded metadata read remains honest
 * OpenSpec #### Scenario: Adjacent tenant cannot use dependency status to enumerate workloads
 */
test('bbx-933-src-fn-wrong-workspace-read-15: same-tenant wrong-workspace identity cannot read, invoke, or inspect Function evidence', async () => {
  const pool = makePool();
  const action = pool.seedAction({
    resource_id: 'fn_933_workspace_scope',
    action_name: 'workspace-private-fn',
    version: 1,
    source_code: 'module.exports=async()=>({secret:"owner-only"})',
  });
  const activation = pool.seedActivation({ resource_id: action.resource_id });
  const request = (body = {}) => ctx(pool, {
    params: { actionId: action.resource_id, activationId: activation.activation_id },
    body,
    identity: WRONG_WORKSPACE_OWNER,
    knativeRuntime: OUTAGE_RUNTIME,
  });
  const responses = {
    detail: await FN_HANDLERS.fnActionDetail(request()),
    invoke: await FN_HANDLERS.fnInvoke(request({ parameters: { probe: true } })),
    versions: await FN_HANDLERS.fnVersions(request()),
    activations: await FN_HANDLERS.fnActivations(request()),
    activation: await FN_HANDLERS.fnActivation(request()),
    logs: await FN_HANDLERS.fnActivationLogs(request()),
    result: await FN_HANDLERS.fnActivationResult(request()),
  };

  assert.deepEqual(
    Object.fromEntries(Object.entries(responses).map(([name, response]) => [name, {
      statusCode: response.statusCode,
      disclosedDependency: JSON.stringify(response.body).includes('KNATIVE'),
    }])),
    Object.fromEntries(Object.keys(responses).map((name) => [name, {
      statusCode: 404,
      disclosedDependency: false,
    }])),
  );
});

/**
 * bbx-933-src-fn-wrong-workspace-mutate-16 | fn-function-workspace-isolation
 * OpenSpec #### Scenario: Deploy fails explicitly while managed runtime is degraded
 * OpenSpec #### Scenario: Adjacent tenant cannot use dependency status to enumerate workloads
 */
test('bbx-933-src-fn-wrong-workspace-mutate-16: same-tenant wrong-workspace Function mutation is concealed before runtime disclosure', async () => {
  const pool = makePool();
  const action = pool.seedAction({
    resource_id: 'fn_933_workspace_mutation',
    action_name: 'workspace-private-mutation',
    version: 1,
  });
  const response = await FN_HANDLERS.fnDeploy(ctx(pool, {
    params: { actionId: action.resource_id },
    body: { ...deployBody('module.exports=async()=>({blocked:true})'), actionName: action.action_name },
    identity: WRONG_WORKSPACE_OWNER,
    knativeRuntime: OUTAGE_RUNTIME,
  }));

  assert.ok([403, 404].includes(response.statusCode), JSON.stringify(response.body));
  assert.equal(JSON.stringify(response.body).includes('KNATIVE'), false);
  assert.equal(pool.counters.actionUpdates, 0);
});

const KNATIVE_STATUS = {
  mode: 'managed',
  owner: 'falcone',
  version: '1.22.1',
  compatibility: 'compatible',
  state: 'ready',
  stage: 'ready',
  reason: 'READY',
  lastTransitionAt: '2026-08-07T00:00:00.000Z',
};

function runtimeStatusCtx(identity) {
  return {
    identity,
    callerContext: { correlationId: 'corr_933_platform_trust' },
    knativeRuntime: { status: () => KNATIVE_STATUS },
  };
}

/**
 * bbx-933-src-runtime-platform-trust-17 | fn-managed-knative-runtime-status
 * OpenSpec #### Scenario: Read-only status does not grant mutation
 * OpenSpec #### Scenario: Adjacent tenant cannot observe or mutate the runtime
 */
test('bbx-933-src-runtime-platform-trust-17: tenant-realm identity cannot copy a platform role to read Knative status', async () => {
  const response = await KNATIVE_RUNTIME_HANDLERS.getKnativeRuntimeStatus(runtimeStatusCtx({
    sub: 'tenant_copied_platform_operator',
    tenantId: TENANT_ID,
    workspaceId: WORKSPACE_ID,
    actorType: 'platform_operator',
    roles: ['platform_operator'],
    trust: { kind: 'tenant', realm: TENANT_ID },
  }));

  assert.equal(response.statusCode, 403, JSON.stringify(response.body));
  assert.equal(response.body.code, 'FORBIDDEN');
  assert.equal(response.body.state, undefined, 'authorization failure must not disclose runtime state');
});

/**
 * bbx-933-src-runtime-platform-role-18 | fn-managed-knative-runtime-status
 * OpenSpec #### Scenario: Read-only status does not grant mutation
 */
test('bbx-933-src-runtime-platform-role-18: platform-trusted identity still needs an exact platform observer role', async () => {
  const trustedObserver = await KNATIVE_RUNTIME_HANDLERS.getKnativeRuntimeStatus(runtimeStatusCtx({
    sub: 'platform_auditor',
    tenantId: null,
    workspaceId: null,
    actorType: 'platform_auditor',
    roles: ['platform_auditor'],
    trust: { kind: 'platform', realm: 'in-falcone-platform' },
  }));
  const trustedWithoutRole = await KNATIVE_RUNTIME_HANDLERS.getKnativeRuntimeStatus(runtimeStatusCtx({
    sub: 'platform_roleless',
    tenantId: null,
    workspaceId: null,
    actorType: 'platform_user',
    roles: [],
    trust: { kind: 'platform', realm: 'in-falcone-platform' },
  }));

  assert.equal(trustedObserver.statusCode, 200, JSON.stringify(trustedObserver.body));
  assert.equal(trustedObserver.body.state, 'ready');
  assert.equal(trustedWithoutRole.statusCode, 403, JSON.stringify(trustedWithoutRole.body));
  assert.equal(trustedWithoutRole.body.state, undefined);
});
