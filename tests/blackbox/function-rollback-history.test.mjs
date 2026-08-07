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
import { syntheticFnVersionId } from '../../apps/control-plane/tenant-store.mjs';

const TENANT_ID = 'ten_alpha';
const WORKSPACE_ID = 'wrk_alpha';
const OWNER = {
  sub: 'user_alpha_owner',
  tenantId: TENANT_ID,
  workspaceId: WORKSPACE_ID,
  actorType: 'tenant_owner',
  roles: ['tenant_owner']
};
const MEMBER = {
  sub: 'user_alpha_member',
  tenantId: TENANT_ID,
  workspaceId: WORKSPACE_ID,
  actorType: 'tenant_member',
  roles: ['tenant_member']
};

function makePool() {
  let tick = 0;
  const actions = new Map();
  const versions = new Map();
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
        return { rows: row && row.tenant_id === params[1] ? [clone(row)] : [] };
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

function ctx(pool, { params = {}, body = {}, identity = OWNER, deployKnativeService = async () => {} } = {}) {
  return {
    pool,
    params,
    body,
    identity,
    callerContext: { correlationId: 'corr_786_rollback', actor: { id: identity.sub, type: identity.actorType }, tenantId: identity.tenantId },
    knativeRuntime: { functionsEnabled: true, status: () => ({ mode: 'managed', state: 'ready', reason: 'READY' }), canServeWorkloads: () => true },
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
