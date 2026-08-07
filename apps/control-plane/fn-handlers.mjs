// Console Functions page (/console/functions) handlers — REAL execution.
//
// Wires the repo's /v1/functions/* surface to the real Kubernetes function
// executor (function-executor.mjs): deploy stores the nodejs source; invoke runs
// it in an ephemeral Job and records a real activation (result + logs). Shapes
// match what ConsoleFunctionsPage consumes (FunctionAction / FunctionActivation /
// FunctionInvocationAccepted / GatewayMutationAccepted).
import { randomUUID } from 'node:crypto';
import * as store from './tenant-store.mjs';
import { deployKnativeService, deleteKnativeService, invokeKnative, waitKsvcReady, ksvcNameForWorkspace, ksvcHost } from './function-executor.mjs';
import { vaultStoreFromEnv } from './vault-secrets.mjs';
import { canManageTenant } from './tenant-scope.mjs';
import { functionsDisabledResponse, knativeUnavailableResponse } from './knative-runtime.mjs';
import { createRuntimeCleanupRepository } from './runtime-cleanup-repository.mjs';
import { recordKnativeDependencyEvent } from './metrics-registry.mjs';

// Scope-validation builder for function definition import (#683). It lives in apps/control-plane-executor
// (vendored into the CP image at /repo/apps/control-plane-executor, alongside packages/internal-contracts
// which it imports) but is LAZILY loaded so this module also imports cleanly in the blackbox test
// harness (which runs from the repo root, where `/repo` does not exist). The image path is tried
// first; the repo-relative path is the test fallback. Cached after first resolution.
const IMPORT_ERROR_CODES = Object.freeze({
  COLLISION: 'IMPORT_COLLISION', POLICY_CONFLICT: 'IMPORT_POLICY_CONFLICT',
  SCOPE_VIOLATION: 'IMPORT_SCOPE_VIOLATION', UNSUPPORTED_BUNDLE: 'IMPORT_UNSUPPORTED_BUNDLE'
});
let _validateImportBundle = null;
async function loadValidateImportBundle() {
  if (_validateImportBundle) return _validateImportBundle;
  const candidates = [
    '/repo/apps/control-plane-executor/src/functions-import-export.mjs',
    new URL('../control-plane-executor/src/functions-import-export.mjs', import.meta.url).href
  ];
  for (const c of candidates) {
    try { const m = await import(c); if (m?.validateImportBundle) { _validateImportBundle = m.validateImportBundle; return _validateImportBundle; } }
    catch { /* try the next candidate */ }
  }
  // Last-resort inline fallback (keeps imports working even if neither path resolves): enforce the
  // same tenant/workspace scope guard the product builder enforces.
  _validateImportBundle = (bundle = {}, context = {}) => {
    for (const r of Array.isArray(bundle.resources) ? bundle.resources : []) {
      const t = r.tenantId ?? bundle.tenantId ?? context.tenantId;
      const w = r.workspaceId ?? bundle.workspaceId ?? context.workspaceId;
      if ((context.tenantId && t && t !== context.tenantId) || (context.workspaceId && w && w !== context.workspaceId)) {
        return { valid: false, code: IMPORT_ERROR_CODES.SCOPE_VIOLATION, violations: ['import bundle references a resource outside the caller scope.'] };
      }
    }
    return { valid: true, code: null, violations: [] };
  };
  return _validateImportBundle;
}

const ok = (statusCode, body) => ({ statusCode, body });
const err = (statusCode, code, message) => ({ statusCode, body: { code, message } });

// OpenBao-backed workspace-secret store (add-vault-secret-consumption, #612). Null when OpenBao is not
// configured (BAO_ADDR/BAO_TOKEN or compatible VAULT_* env unset) — the secrets API reports the backend disabled and
// function deploys ignore secret refs, so default behaviour is unchanged.
const vaultStore = vaultStoreFromEnv();

// Resolve the caller's workspace, returning null on cross-tenant access (no existence leak) so a
// secret read/write can never reach another tenant's workspace. Superadmin/internal may operate
// cross-tenant (callerTenantId → null). The Postgres store is taken from ctx.store ?? store so tests
// can inject a fake (repo DI seam, parity with b-handlers.mjs).
async function ownedWorkspace(ctx, workspaceId) {
  if (!workspaceId) return null;
  const st = ctx.store ?? store;
  const ws = await st.getWorkspace(ctx.pool, workspaceId);
  if (!ws) return null;
  const t = callerTenantId(ctx.identity);
  if (t && ws.tenant_id !== t) return null;
  return ws;
}

// Best-effort count of the workspace's deployed functions that reference `secretName` (the advisory
// `resolvedRefCount` of FunctionWorkspaceSecret — used only for the pre-delete warning, never a
// delete gate). Scans the existing fn_actions registry rows' declared secret refs
// (`execution.secrets`, or a top-level `secrets`); a ref is a bare name or { name|secretName }.
// Returns 0 when not cheaply computable (e.g. the kind fn_actions row does not persist secret refs)
// — a conservative under-count is acceptable for an advisory signal.
async function resolvedRefCount(ctx, ws, secretName) {
  try {
    const st = ctx.store ?? store;
    const rows = await st.listFnActions(ctx.pool, ws.id);
    if (!Array.isArray(rows)) return 0;
    let n = 0;
    for (const r of rows) {
      const refs = r?.execution?.secrets ?? r?.secrets ?? r?.parameters?.execution?.secrets ?? [];
      if (!Array.isArray(refs)) continue;
      for (const ref of refs) {
        const name = typeof ref === 'string' ? ref : (ref?.name ?? ref?.secretName);
        if (name === secretName) { n += 1; break; }
      }
    }
    return n;
  } catch { return 0; }
}

// Stamp the published FunctionWorkspaceSecret metadata onto a store meta object: tenantId/workspaceId
// come from the VERIFIED workspace (never the body), resolvedRefCount is advisory. The store already
// supplies { secretName, name (alias), timestamps, description? } and NEVER a value or KV version.
function secretMetaOut(meta, ws, refCount) {
  return {
    secretName: meta.secretName ?? meta.name,
    name: meta.name ?? meta.secretName, // backward-compat alias
    tenantId: ws.tenant_id,
    workspaceId: ws.id,
    resolvedRefCount: refCount ?? 0,
    timestamps: meta.timestamps ?? { createdAt: null, updatedAt: null },
    ...(meta.description !== undefined ? { description: meta.description } : {}),
  };
}

// Resolve the function's invocation input from the request body. The documented body is the
// `{ parameters: {...} }` envelope (OpenAPI FunctionInvocationWriteRequest); a bare top-level
// input map is also accepted so a body like {n:21} is honored, not silently dropped. Envelope-only
// fields are never passed to the function as input.
export function invocationInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
  if (body.parameters && typeof body.parameters === 'object' && !Array.isArray(body.parameters)) {
    return body.parameters;
  }
  const { parameters, responseMode, triggerContext, idempotencyScope, versionId, execution, ...rest } = body;
  return rest;
}

// Returns the caller's tenantId to use as a scope predicate on fn_actions queries,
// or null for superadmin/internal callers (they may operate cross-tenant).
function callerTenantId(identity) {
  if (!identity) return null;
  if (identity.actorType === 'superadmin' || identity.actorType === 'internal') return null;
  return identity.tenantId ?? null;
}

const FUNCTION_WORKSPACE_MUTATION_ROLES = new Set([
  'workspace_owner',
  'workspace_admin',
  'workspace_developer',
]);

// Function writes are workspace mutations, not merely same-tenant operations. Tenant/platform
// control-plane identities retain their existing administrative bypass, while ordinary principals
// must carry both a write-capable workspace role and a verified binding for the target workspace.
// The workspace is always resolved from persisted state (or the create target), never trusted from
// a caller-supplied Function body alone.
export function canMutateFunctionWorkspace(identity, workspace) {
  if (!identity || !workspace?.id || !workspace?.tenant_id) return false;
  const roles = new Set(Array.isArray(identity.roles) ? identity.roles : []);
  if (identity.tenantId !== workspace.tenant_id) return false;
  if (![...roles].some((role) => FUNCTION_WORKSPACE_MUTATION_ROLES.has(role))) return false;

  const claimedWorkspaceIds = new Set(
    [identity.workspaceId, ...(Array.isArray(identity.workspaceIds) ? identity.workspaceIds : [])]
      .filter(Boolean)
      .map(String),
  );
  return claimedWorkspaceIds.has(String(workspace.id));
}

const FUNCTION_READ_ROLES = new Set([
  'workspace_owner', 'workspace_admin', 'workspace_developer', 'workspace_operator',
  'workspace_viewer', 'workspace_auditor', 'service_account', 'developer_external',
]);
const FUNCTION_PLATFORM_READ_ROLES = new Set([
  'platform_operator', 'platform_auditor', 'platform_admin', 'superadmin',
]);
const FUNCTION_INVOKE_ROLES = new Set([
  'workspace_owner', 'workspace_admin', 'workspace_developer', 'workspace_operator',
  'service_account', 'developer_external',
]);
function hasFunctionWorkspaceClaim(identity, workspaceId) {
  return new Set([identity?.workspaceId, ...(identity?.workspaceIds ?? [])].filter(Boolean).map(String))
    .has(String(workspaceId));
}
export function canAccessFunctionWorkspace(identity, workspace, mode = 'read') {
  if (!identity || !workspace?.id || !workspace?.tenant_id) return false;
  const roles = new Set(Array.isArray(identity.roles) ? identity.roles : []);
  const trustedPlatformReader = (identity.trustKind ?? identity.trust?.kind) === 'platform'
    && [...roles].some((role) => FUNCTION_PLATFORM_READ_ROLES.has(role));
  if (mode === 'read' && trustedPlatformReader) return true;
  if (identity.tenantId !== workspace.tenant_id) return false;
  if (mode === 'read' && (roles.has('tenant_owner') || roles.has('tenant_admin'))) return true;
  const allowed = mode === 'invoke' ? FUNCTION_INVOKE_ROLES : FUNCTION_READ_ROLES;
  return [...roles].some((role) => allowed.has(role)) && hasFunctionWorkspaceClaim(identity, workspace.id);
}

function functionVisible(ctx, row, mode = 'read') {
  return row && canAccessFunctionWorkspace(ctx.identity, { id: row.workspace_id, tenant_id: row.tenant_id }, mode);
}

function functionAuditScope(row) {
  return { tenantId: row.tenant_id, workspaceId: row.workspace_id, resourceId: row.resource_id };
}

function auditedFunctionOk(statusCode, body, row) {
  return { ...ok(statusCode, body), auditScope: functionAuditScope(row) };
}

// Public dispatch always injects this source. Requiring it at the handler boundary prevents a
// direct call from silently bypassing the dependency gate; focused tests inject a deterministic
// ready/unavailable source explicitly.
function runtimeFor(ctx) {
  if (!ctx.knativeRuntime || typeof ctx.knativeRuntime.status !== 'function'
      || typeof ctx.knativeRuntime.canServeWorkloads !== 'function') {
    throw new Error('knativeRuntime dependency is required');
  }
  return ctx.knativeRuntime;
}

function functionDependencyGate(ctx, operation, scope) {
  const runtime = runtimeFor(ctx);
  const correlationId = ctx.callerContext?.correlationId ?? randomUUID();
  if (!runtime.functionsEnabled) {
    return { statusCode: 501, body: functionsDisabledResponse(correlationId), auditScope: scope };
  }
  const status = runtime.status();
  if (!runtime.canServeWorkloads(status)) {
    (ctx.recordKnativeDependencyEvent ?? recordKnativeDependencyEvent)({
      capability: 'function', operation, mode: status.mode, state: status.state,
      reason: status.reason, result: 'unavailable',
    });
    return {
      statusCode: 503,
      body: knativeUnavailableResponse(status, correlationId),
      auditScope: scope,
      knativeEvidence: {
        capability: 'function', operation, mode: status.mode, state: status.state,
        reason: status.reason, result: 'unavailable',
      },
    };
  }
  return null;
}

function activationOut(r) {
  return {
    activationId: r.activation_id, resourceId: r.resource_id,
    status: r.status === 'success' ? 'succeeded' : 'failed',
    startedAt: r.started_at, finishedAt: r.finished_at, durationMs: r.duration_ms ?? 0,
    triggerKind: 'manual', statusCode: r.status_code ?? undefined
  };
}

function jsonObject(value) {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch { return {}; }
  }
  return typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function activationPolicyOut() {
  return {
    logsAccess: 'workspace_developers',
    resultAccess: 'workspace_developers',
    rerunPolicy: 'manual_only',
    retentionHours: 168
  };
}

function sourceOut(r) {
  return { kind: 'inline_code', language: 'javascript', inlineCode: r.source_code, entryFile: 'index.js' };
}

function actionExecutionOut(r) {
  return {
    entrypoint: r.entrypoint,
    runtime: r.runtime,
    parameters: jsonObject(r.parameters),
    limits: { timeoutMs: r.timeout_ms, memoryMb: r.memory_mb }
  };
}

function versionExecutionOut(r) {
  return {
    entrypoint: r.entrypoint,
    runtime: r.runtime,
    parameters: jsonObject(r.parameters),
    environment: {},
    limits: { timeoutSeconds: Math.max(1, Math.ceil((Number(r.timeout_ms) || 60000) / 1000)), memoryMb: r.memory_mb },
    webAction: { enabled: false, requireAuthentication: true, rawHttpResponse: false }
  };
}

function timestampsOut(r) {
  return { createdAt: r.created_at, updatedAt: r.updated_at ?? r.created_at, ...(r.activated_at ? { activatedAt: r.activated_at } : {}) };
}

function legacyVersionOut(action) {
  return {
    versionId: store.syntheticFnVersionId(action),
    resourceId: action.resource_id,
    tenantId: action.tenant_id,
    workspaceId: action.workspace_id,
    versionNumber: Number(action.version ?? 1) || 1,
    status: 'active',
    originType: 'publish',
    rollbackEligible: false,
    source: sourceOut(action),
    execution: versionExecutionOut(action),
    activationPolicy: activationPolicyOut(),
    timestamps: timestampsOut(action)
  };
}

function versionOut(r, activeVersionNumber) {
  const versionNumber = Number(r.version_number ?? 1) || 1;
  const active = r.status === 'active';
  return {
    versionId: r.version_id,
    resourceId: r.resource_id,
    tenantId: r.tenant_id,
    workspaceId: r.workspace_id,
    versionNumber,
    status: active ? 'active' : 'historical',
    originType: r.origin_type === 'rollback_restore' ? 'rollback_restore' : 'publish',
    ...(r.origin_version_id ? { originVersionId: r.origin_version_id } : {}),
    rollbackEligible: !active && versionNumber < activeVersionNumber,
    source: sourceOut(r),
    execution: versionExecutionOut(r),
    activationPolicy: activationPolicyOut(),
    timestamps: timestampsOut(r)
  };
}

function activeVersionNumber(versions, action) {
  const active = versions.find((row) => row.status === 'active') ?? versions[0];
  return Number(active?.version_number ?? action?.version ?? 1) || 1;
}

function actionOut(r, latest, versionState = null, runtimeStatus = null) {
  const effectiveVersionState = versionState ?? {
    activeVersionId: store.syntheticFnVersionId(r),
    versionCount: 1,
    rollbackAvailable: false
  };
  const deletionPending = r.lifecycle_status === 'deletion_pending';
  const runtimeReady = runtimeStatus?.state === 'ready';
  const publicState = deletionPending ? 'deletion_pending'
    : (runtimeStatus && !runtimeReady ? 'unavailable' : 'active');
  return {
    resourceId: r.resource_id, tenantId: r.tenant_id, workspaceId: r.workspace_id,
    actionName: r.action_name, namespaceName: r.workspace_id, status: publicState,
    activeVersionId: effectiveVersionState.activeVersionId,
    rollbackAvailable: Boolean(effectiveVersionState.rollbackAvailable),
    versionCount: Number(effectiveVersionState.versionCount ?? 1),
    execution: actionExecutionOut(r),
    source: sourceOut(r),
    activationPolicy: activationPolicyOut(),
    secretReferences: [],
    unresolvedSecretRefs: 0,
    provisioning: { state: publicState },
    ...(runtimeStatus ? {
      // Deliberately omit owner/version/cluster identity from tenant-scoped metadata. Developers
      // need an honest dependency state, while operator-only detail remains on the platform route.
      runtimeDependency: {
        mode: runtimeStatus.mode,
        state: runtimeStatus.state,
        reason: runtimeStatus.reason,
        ready: runtimeReady,
      },
    } : {}),
    timestamps: { createdAt: r.created_at, updatedAt: r.updated_at },
    latestActivation: latest ? activationOut(latest) : undefined
  };
}

// POST /v1/functions/actions  (create/deploy) | PATCH /v1/functions/actions/{actionId} (update)
// PATCH matches the published `updateFunctions` contract (public-route-catalog.json,
// control-plane.openapi.json); the console's "Actualizar función" submits PATCH (#785).
async function fnDeploy(ctx) {
  const st = ctx.store ?? store;
  const b = ctx.body ?? {};
  const actionId = ctx.params.actionId ?? ctx.params.resourceId ?? null;
  const actionName = b.actionName ?? b.name;
  if (!actionName) return err(400, 'VALIDATION_ERROR', 'workspaceId and actionName are required');
  // Preserve the create/update no-oracle behavior for an explicitly supplied foreign or unknown
  // workspace before looking up the Function path id. The persisted Function still remains the
  // authoritative update scope below.
  const requestedWorkspace = actionId && b.workspaceId != null
    ? await ownedWorkspace(ctx, b.workspaceId)
    : null;
  if (actionId && b.workspaceId != null && !requestedWorkspace) {
    return err(403, 'FORBIDDEN', 'not authorized for this workspace');
  }
  // On update, the persisted Function determines the authorization workspace. A body.workspaceId
  // cannot move an existing Function or substitute a same-tenant workspace the caller does own.
  const existing = actionId
    ? await st.getFnAction(ctx.pool, actionId, callerTenantId(ctx.identity))
    : null;
  if (actionId && !existing) return err(404, 'ACTION_NOT_FOUND', `action ${actionId} not found`);
  const workspaceId = existing?.workspace_id ?? b.workspaceId ?? ctx.params.workspaceId;
  if (!workspaceId) return err(400, 'VALIDATION_ERROR', 'workspaceId and actionName are required');
  if (existing && b.workspaceId != null && String(b.workspaceId) !== String(existing.workspace_id)) {
    return err(403, 'FORBIDDEN', 'not authorized for this workspace');
  }
  // Tenant isolation (#869, the write twin of #784): resolve + own-check the workspace BEFORE any
  // write or Knative deploy side effect. ownedWorkspace returns null for a foreign or unknown
  // workspace (no existence oracle) → 403; the check is skipped for superadmin/internal callers
  // (callerTenantId → null), preserving the cross-tenant deploy bypass.
  const ws = requestedWorkspace?.id === workspaceId
    ? requestedWorkspace
    : await ownedWorkspace(ctx, workspaceId);
  if (!ws) return err(403, 'FORBIDDEN', 'not authorized for this workspace');
  if (!canMutateFunctionWorkspace(ctx.identity, ws)) {
    return err(403, 'FORBIDDEN', 'requires a write-capable role bound to this workspace');
  }
  const code = b.source?.inlineCode ?? b.source?.code;
  if (!code) return err(400, 'VALIDATION_ERROR', 'source.inlineCode is required');
  // Ownership and validation precede dependency status, but the gate precedes secret resolution,
  // registry writes, and every Kubernetes call. An adjacent tenant therefore gets no status oracle.
  const dependencyError = functionDependencyGate(ctx, ctx.params.actionId ? 'update' : 'deploy', {
    tenantId: ws.tenant_id, workspaceId: ws.id,
  });
  if (dependencyError) return dependencyError;
  const resourceId = existing?.resource_id ?? `fn_${randomUUID().slice(0, 12)}`;
  const limits = b.execution?.limits ?? {};
  const memoryMb = Number(limits.memoryMb) || 256;
  const timeoutMs = Number(limits.timeoutMs) || 60000;
  // Per-(tenant, workspace) ksvc name so two tenants' same-named workspaces never
  // collide on a shared Knative Service (P0 ISO-FUNCTIONS).
  const name = ksvcNameForWorkspace(ws, actionName);
  // Resolve any declared workspace-secret references from OpenBao and inject them as env vars
  // (add-vault-secret-consumption, #612). The values are read from THIS workspace's own KV path,
  // so a function only ever sees its own tenant/workspace secrets.
  let secretEnv = [];
  const secretRefs = b.execution?.secrets ?? b.secrets ?? [];
  if (Array.isArray(secretRefs) && secretRefs.length > 0) {
    if (!vaultStore) return err(501, 'SECRETS_BACKEND_DISABLED', 'workspace secrets require the OpenBao backend (not configured)');
    try { secretEnv = await vaultStore.resolveEnv(ws.tenant_id, ws.id, secretRefs); }
    catch (e) { return err(502, 'SECRET_RESOLVE_FAILED', String(e.message ?? e)); }
  }
  // Deploy/update the function's Knative Service (new revision on code change).
  try {
    await (ctx.deployKnativeService ?? deployKnativeService)(name, code, {
      tenantId: ws.tenant_id,
      functionResourceId: resourceId,
      memoryMb,
      timeoutMs,
      secretEnv,
    });
  } catch (e) {
    return err(e.statusCode && e.statusCode < 500 ? e.statusCode : 502, 'FN_DEPLOY_FAILED', String(e.message ?? e));
  }
  const rec = await st.upsertFnAction(ctx.pool, {
    resourceId, workspaceId: ws.id, tenantId: ws.tenant_id, actionName,
    runtime: b.execution?.runtime ?? 'nodejs:22', entrypoint: b.execution?.entrypoint ?? 'main',
    sourceCode: code, parameters: b.execution?.parameters ?? null, memoryMb, timeoutMs,
    ksvcName: name, createdBy: ctx.identity?.sub
  });
  return auditedFunctionOk(202, {
    requestId: randomUUID(), correlationId: ctx.callerContext?.correlationId ?? randomUUID(),
    family: 'functions', resourceType: 'function_action',
    resourceId: rec.resource_id, status: 'accepted', acceptedAt: new Date().toISOString()
  }, rec);
}

// GET /v1/functions/workspaces/{workspaceId}/inventory
async function fnInventory(ctx) {
  const st = ctx.store ?? store;
  // Tenant isolation (#784): resolve + own-check the workspace before listing. ownedWorkspace returns
  // null for a foreign or unknown workspace (the caller's tenant does not own it) → 403, with no body
  // that distinguishes "not yours" from "does not exist" (no existence oracle). For superadmin/internal
  // callers callerTenantId is null, so the ownership check is skipped and the workspace IS returned,
  // preserving the cross-tenant read. The tenant predicate on listFnActions is defense-in-depth.
  const ws = await ownedWorkspace(ctx, ctx.params.workspaceId);
  if (!ws) return err(403, 'FORBIDDEN', 'not authorized for this workspace');
  const rows = await st.listFnActions(ctx.pool, ws.id, callerTenantId(ctx.identity));
  const runtimeStatus = runtimeFor(ctx).status();
  const actions = [];
  for (const r of rows) {
    actions.push(actionOut(
      r,
      await st.latestFnActivation(ctx.pool, r.resource_id),
      await st.getFnActionVersionSummary(ctx.pool, r),
      runtimeStatus
    ));
  }
  return ok(200, { workspaceId: ws.id, actions, counts: { actions: actions.length, packages: 0, rules: 0, triggers: 0, httpExposures: 0 } });
}
// GET /v1/functions/workspaces/{workspaceId}/actions
async function fnListActions(ctx) {
  const st = ctx.store ?? store;
  const ws = await ownedWorkspace(ctx, ctx.params.workspaceId);
  if (!ws) return err(403, 'FORBIDDEN', 'not authorized for this workspace');
  const rows = await st.listFnActions(ctx.pool, ws.id, callerTenantId(ctx.identity));
  const runtimeStatus = runtimeFor(ctx).status();
  const items = [];
  for (const r of rows) items.push(actionOut(r, null, await st.getFnActionVersionSummary(ctx.pool, r), runtimeStatus));
  return ok(200, { items, page: { total: rows.length } });
}
// GET /v1/functions/actions/{actionId}
async function fnActionDetail(ctx) {
  const st = ctx.store ?? store;
  const r = await st.getFnAction(ctx.pool, ctx.params.actionId, callerTenantId(ctx.identity));
  if (!functionVisible(ctx, r, 'read')) return err(404, 'ACTION_NOT_FOUND', `action ${ctx.params.actionId} not found`);
  return ok(200, actionOut(
    r,
    await st.latestFnActivation(ctx.pool, r.resource_id),
    await st.getFnActionVersionSummary(ctx.pool, r),
    runtimeFor(ctx).status()
  ));
}
// DELETE /v1/functions/actions/{actionId}
async function fnDelete(ctx) {
  const st = ctx.store ?? store;
  const actionId = ctx.params.actionId ?? ctx.params.resourceId;
  const r = await st.getFnAction(ctx.pool, actionId, callerTenantId(ctx.identity));
  if (!functionVisible(ctx, r, 'read')) return err(404, 'ACTION_NOT_FOUND', `action ${actionId} not found`);
  if (!canMutateFunctionWorkspace(ctx.identity, { id: r.workspace_id, tenant_id: r.tenant_id })) {
    return err(403, 'FORBIDDEN', 'requires a write-capable role bound to this workspace');
  }

  const runtime = runtimeFor(ctx);
  const correlationId = ctx.callerContext?.correlationId ?? randomUUID();
  if (!runtime.functionsEnabled) {
    return { statusCode: 501, body: functionsDisabledResponse(correlationId) };
  }
  const runtimeStatus = runtime.status();
  if (!runtime.canServeWorkloads(runtimeStatus)) {
    // One SQL statement marks the logical Function and inserts/reuses its durable cleanup
    // obligation. No Kubernetes request is attempted while the source-of-truth gate is closed.
    const repository = ctx.runtimeCleanupRepository ?? createRuntimeCleanupRepository(ctx.pool);
    const obligation = await repository.deferFunctionDeletion({
      tenantId: r.tenant_id,
      workspaceId: r.workspace_id,
      resourceId: r.resource_id,
      runtimeResourceName: r.ksvc_name ?? null,
      correlationId,
    });
    (ctx.recordKnativeDependencyEvent ?? recordKnativeDependencyEvent)({
      capability: 'function', operation: 'delete', mode: runtimeStatus.mode,
      state: runtimeStatus.state, reason: runtimeStatus.reason, result: 'deferred',
    });
    return {
      ...ok(202, {
        requestId: randomUUID(),
        correlationId: obligation.correlationId,
        resourceId: r.resource_id,
        status: 'deletion_pending',
        acceptedAt: obligation.createdAt ?? new Date().toISOString(),
      }),
      auditScope: { tenantId: r.tenant_id, workspaceId: r.workspace_id, resourceId: r.resource_id },
      knativeEvidence: {
        capability: 'function', operation: 'delete', mode: runtimeStatus.mode,
        state: runtimeStatus.state, reason: runtimeStatus.reason, result: 'deferred',
      },
    };
  }

  if (r.ksvc_name) {
    try {
      await (ctx.deleteKnativeService ?? deleteKnativeService)(r.ksvc_name, {
        tenantId: r.tenant_id,
        functionResourceId: r.resource_id,
      });
    } catch (e) {
      return err(e.statusCode && e.statusCode < 500 ? e.statusCode : 502, 'FN_DELETE_FAILED', String(e.message ?? e));
    }
  }

  const deleted = await st.deleteFnAction(ctx.pool, r);
  if (!deleted) return err(404, 'ACTION_NOT_FOUND', `action ${actionId} not found`);

  return auditedFunctionOk(202, {
    requestId: randomUUID(),
    correlationId,
    resourceId: deleted.resource_id,
    status: 'accepted',
    acceptedAt: new Date().toISOString()
  }, deleted);
}
// POST /v1/functions/actions/{actionId}/invocations  — REAL execution
async function fnInvoke(ctx) {
  const st = ctx.store ?? store;
  const r = await st.getFnAction(ctx.pool, ctx.params.actionId, callerTenantId(ctx.identity));
  if (!functionVisible(ctx, r, 'invoke')) return err(404, 'ACTION_NOT_FOUND', `action ${ctx.params.actionId} not found`);
  const dependencyError = functionDependencyGate(ctx, 'invoke', {
    tenantId: r.tenant_id, workspaceId: r.workspace_id, resourceId: r.resource_id,
  });
  if (dependencyError) return dependencyError;
  const params = invocationInput(ctx.body);
  const startedAt = new Date().toISOString();
  let run;
  if (!r.ksvc_name) {
    run = { status: 'failure', result: { error: 'function has no Knative service (redeploy it)' }, logs: [], durationMs: 0, statusCode: 502 };
  } else {
    // Verified caller context (#639): tenant/principal/roles from the JWT-verified
    // ctx.identity; workspace from the resolved function row (the resource being
    // invoked), falling back to the caller's ambient workspace. Delivered to the
    // function as X-Falcone-* headers — never from the user-controlled body.
    const caller = {
      tenantId: ctx.identity?.tenantId ?? null,
      workspaceId: r.workspace_id ?? ctx.identity?.workspaceId ?? null,
      principal: ctx.identity?.sub ?? null,
      actorType: ctx.identity?.actorType ?? null,
      roles: ctx.identity?.roles ?? [],
    };
    // Cold start: the cluster-local DNS only resolves once the ksvc is Ready.
    const ready = await (ctx.waitKsvcReady ?? waitKsvcReady)(r.ksvc_name, 90000);
    run = ready
      ? await (ctx.invokeKnative ?? invokeKnative)(ksvcHost(r.ksvc_name), params, { timeoutMs: (r.timeout_ms || 60000) + 30000, caller })
      : { status: 'failure', result: { error: 'function (Knative service) is not ready' }, logs: [], durationMs: 0, statusCode: 503 };
  }
  const activationId = `act_${randomUUID().slice(0, 12)}`;
  await st.insertFnActivation(ctx.pool, {
    activationId, resourceId: r.resource_id, workspaceId: r.workspace_id,
    status: run.status, statusCode: run.statusCode, result: run.result, logs: run.logs,
    durationMs: run.durationMs, startedAt, finishedAt: new Date().toISOString()
  });
  return auditedFunctionOk(202, {
    invocationId: activationId, resourceId: r.resource_id,
    status: run.status === 'success' ? 'completed' : 'failed', acceptedAt: startedAt
  }, r);
}
// GET /v1/functions/actions/{actionId}/activations
async function fnActivations(ctx) {
  // Verify the action exists and belongs to the caller's tenant before listing its activations.
  const action = await store.getFnAction(ctx.pool, ctx.params.actionId, callerTenantId(ctx.identity));
  if (!functionVisible(ctx, action, 'read')) return err(404, 'ACTION_NOT_FOUND', `action ${ctx.params.actionId} not found`);
  const rows = await store.listFnActivations(ctx.pool, ctx.params.actionId);
  return ok(200, { items: rows.map(activationOut), page: { total: rows.length } });
}
// GET /v1/functions/actions/{actionId}/activations/{activationId}
async function fnActivation(ctx) {
  const st = ctx.store ?? store;
  const r = await st.getFnActivation(ctx.pool, ctx.params.activationId);
  if (!r || r.resource_id !== ctx.params.actionId) return err(404, 'ACTIVATION_NOT_FOUND', 'activation not found');
  // Verify the parent function belongs to the caller's tenant (fail-closed, no existence leak).
  const action = await store.getFnAction(ctx.pool, r.resource_id, callerTenantId(ctx.identity));
  if (!functionVisible(ctx, action, 'read')) return err(404, 'ACTIVATION_NOT_FOUND', 'activation not found');
  return ok(200, activationOut(r));
}
// GET .../activations/{activationId}/logs
async function fnActivationLogs(ctx) {
  const st = ctx.store ?? store;
  const r = await st.getFnActivation(ctx.pool, ctx.params.activationId);
  if (!r || r.resource_id !== ctx.params.actionId) return err(404, 'ACTIVATION_NOT_FOUND', 'activation not found');
  const action = await store.getFnAction(ctx.pool, r.resource_id, callerTenantId(ctx.identity));
  if (!functionVisible(ctx, action, 'read')) return err(404, 'ACTIVATION_NOT_FOUND', 'activation not found');
  return ok(200, { activationId: r.activation_id, lines: Array.isArray(r.logs) ? r.logs : [], truncated: false, policy: activationPolicyOut() });
}
// GET .../activations/{activationId}/result
async function fnActivationResult(ctx) {
  const st = ctx.store ?? store;
  const r = await st.getFnActivation(ctx.pool, ctx.params.activationId);
  if (!r || r.resource_id !== ctx.params.actionId) return err(404, 'ACTIVATION_NOT_FOUND', 'activation not found');
  const action = await store.getFnAction(ctx.pool, r.resource_id, callerTenantId(ctx.identity));
  if (!functionVisible(ctx, action, 'read')) return err(404, 'ACTIVATION_NOT_FOUND', 'activation not found');
  return ok(200, { activationId: r.activation_id, status: 'available', result: r.result ?? {}, contentType: 'application/json', policy: activationPolicyOut() });
}
async function fnActivationRerun(ctx) {
  const st = ctx.store ?? store;
  const source = await st.getFnActivation(ctx.pool, ctx.params.activationId);
  if (!source || source.resource_id !== ctx.params.actionId) return err(404, 'ACTIVATION_NOT_FOUND', 'activation not found');
  const action = await st.getFnAction(ctx.pool, ctx.params.actionId, callerTenantId(ctx.identity));
  if (!functionVisible(ctx, action, 'invoke')) return err(404, 'ACTIVATION_NOT_FOUND', 'activation not found');
  const invoked = await fnInvoke({ ...ctx, store: st, params: { ...ctx.params, actionId: ctx.params.actionId }, body: ctx.body ?? {} });
  if (!invoked || invoked.statusCode !== 202) return invoked;
  const body = invoked.body ?? {};
  return { ...invoked, body: { activationId: source.activation_id, rerunInvocationId: body.invocationId, status: 'accepted', acceptedAt: body.acceptedAt } };
}
// GET /v1/functions/actions/{actionId}/versions
async function fnVersions(ctx) {
  const r = await store.getFnAction(ctx.pool, ctx.params.actionId, callerTenantId(ctx.identity));
  if (!functionVisible(ctx, r, 'read')) return err(404, 'ACTION_NOT_FOUND', 'action not found');
  const rows = await store.listFnActionVersions(ctx.pool, r.resource_id);
  const items = rows.length
    ? rows.map((row) => versionOut(row, activeVersionNumber(rows, r)))
    : [legacyVersionOut(r)];
  return ok(200, { items, page: { size: items.length } });
}
// POST /v1/functions/actions/{actionId}/rollback
async function fnRollback(ctx) {
  const st = ctx.store ?? store;
  const r = await st.getFnAction(ctx.pool, ctx.params.actionId, callerTenantId(ctx.identity));
  if (!r) return err(404, 'ACTION_NOT_FOUND', 'action not found');
  if (!canMutateFunctionWorkspace(ctx.identity, { id: r.workspace_id, tenant_id: r.tenant_id })) {
    return err(403, 'FORBIDDEN', 'requires a write-capable role bound to this workspace');
  }
  const dependencyError = functionDependencyGate(ctx, 'rollback', {
    tenantId: r.tenant_id, workspaceId: r.workspace_id, resourceId: r.resource_id,
  });
  if (dependencyError) return dependencyError;
  const versionId = ctx.body?.versionId;
  if (typeof versionId !== 'string' || !/^fnv_[0-9a-z]+$/.test(versionId)) {
    return err(400, 'VALIDATION_ERROR', 'versionId is required and must match fnv_[0-9a-z]+');
  }

  const rows = await st.listFnActionVersions(ctx.pool, r.resource_id);
  const target = rows.find((row) => row.version_id === versionId && row.tenant_id === r.tenant_id && row.workspace_id === r.workspace_id);
  if (!target) return err(404, 'VERSION_NOT_FOUND', 'function version not found');

  const activeNumber = activeVersionNumber(rows, r);
  const targetNumber = Number(target.version_number ?? 0);
  if (target.status === 'active' || targetNumber >= activeNumber) {
    return err(409, 'VERSION_NOT_ELIGIBLE', 'rollback target must be a retained prior version');
  }

  const deployName = r.ksvc_name ?? target.ksvc_name;
  if (deployName) {
    try {
      await (ctx.deployKnativeService ?? deployKnativeService)(deployName, target.source_code, {
        tenantId: r.tenant_id,
        functionResourceId: r.resource_id,
        memoryMb: target.memory_mb,
        timeoutMs: target.timeout_ms,
        secretEnv: []
      });
    } catch (e) {
      return err(e.statusCode && e.statusCode < 500 ? e.statusCode : 502, 'FN_ROLLBACK_DEPLOY_FAILED', String(e.message ?? e));
    }
  }

  const updated = await st.activateFnActionVersion(ctx.pool, r, target);
  if (!updated) return err(409, 'ROLLBACK_STATE_CONFLICT', 'function version could not be activated');
  return auditedFunctionOk(202, {
    requestId: randomUUID(),
    resourceId: r.resource_id,
    requestedVersionId: versionId,
    status: 'accepted',
    correlationId: ctx.callerContext?.correlationId ?? randomUUID(),
    acceptedAt: new Date().toISOString()
  }, r);
}

// ---- Workspace secrets (add-vault-secret-consumption, #612; console convergence,
// add-console-secrets-management) -----------------------------------------------------------------
// Tenant/workspace-scoped secrets-as-a-service backed by OpenBao KV v2. Values are write-only: a
// create/replace stores the value in the backend; GET/LIST return the published
// FunctionWorkspaceSecret metadata ONLY (secretName/name/tenantId/workspaceId/resolvedRefCount/
// timestamps/description? — NO value, NO KV version); a function deploy resolves the value
// server-side to inject as env. Every path is derived from the caller's verified tenant + the URL
// workspace (never the request body), so no tenant can read/write another's secrets.
//
// POST is CREATE-only (409 on an existing name, no overwrite); PUT is REPLACE-only (404
// SECRET_NOT_FOUND when the secret does not exist, no implicit create) and writes the new value at the
// same KV path — this matches the already-published catalog/OpenAPI (5 function_workspace_secret
// routes; the PUT op enumerates 404). The vault store is taken from ctx.vaultStore ?? vaultStore so
// tests can inject a fake KV-v2 store.

const SECRET_VALUE_MAX = 65535;

// Validate the write body's value, returning an err(...) response or null when valid.
function validateSecretValue(value) {
  if (typeof value !== 'string' || value.length === 0) return err(400, 'VALIDATION_ERROR', 'secret value is required');
  if (value.length > SECRET_VALUE_MAX) return err(413, 'VALUE_TOO_LARGE', `secret value exceeds ${SECRET_VALUE_MAX} characters`);
  return null;
}

// POST /v1/functions/workspaces/{workspaceId}/secrets  { secretName, secretValue, description? }
// CREATE-only: 409 SECRET_ALREADY_EXISTS if the name already exists (the stored value is preserved).
async function secretSet(ctx) {
  const vault = ctx.vaultStore ?? vaultStore;
  if (!vault) return err(501, 'SECRETS_BACKEND_DISABLED', 'workspace secrets require the OpenBao backend (not configured)');
  const ws = await ownedWorkspace(ctx, ctx.params.workspaceId);
  if (!ws) return err(404, 'WORKSPACE_NOT_FOUND', `workspace ${ctx.params.workspaceId} not found`);
  // Role gate (#798): mutating a workspace secret requires an admin tenant role. ownedWorkspace only
  // proves tenant membership/isolation (cross-tenant → 404 above), so a tenant_member (tenant_viewer/
  // tenant_developer) would otherwise reach this write. Gate AFTER the 404 so cross-tenant stays 404
  // (no existence leak) and own-tenant-non-admin is 403, mirroring b-handlers' canManageTenantId.
  if (!canManageTenant(ctx.identity, ws.tenant_id)) {
    return err(403, 'FORBIDDEN', 'requires superadmin or tenant owner/admin');
  }
  const b = ctx.body ?? {};
  const name = b.secretName ?? b.name;
  const value = b.secretValue ?? b.value;
  const description = typeof b.description === 'string' ? b.description : undefined;
  if (!vault.validName(name)) return err(400, 'VALIDATION_ERROR', 'secret name must match ^[a-z][a-z0-9_-]{0,62}$');
  const valueError = validateSecretValue(value);
  if (valueError) return valueError;
  try {
    // Create-only: do not overwrite an existing secret — the explicit PUT replace path is required
    // to change a value. The existing value is preserved.
    if (await vault.exists(ws.tenant_id, ws.id, name)) {
      return err(409, 'SECRET_ALREADY_EXISTS', `secret ${name} already exists; use PUT to replace it`);
    }
    const meta = await vault.set(ws.tenant_id, ws.id, name, value, description);
    const refCount = await resolvedRefCount(ctx, ws, name);
    return ok(201, secretMetaOut(meta, ws, refCount));
  } catch (e) { return err(502, 'SECRET_WRITE_FAILED', String(e.message ?? e)); }
}

// PUT /v1/functions/workspaces/{workspaceId}/secrets/{secretName}  { secretValue, description? }
// REPLACE-only: the secret MUST already exist (404 SECRET_NOT_FOUND otherwise); creating a new secret
// is the explicit POST path (create-only, 409 on conflict). On replace, write at the same KV path
// (prior value superseded) → 200 with metadata (no value/version). Value validation runs BEFORE the
// existence check so an invalid PUT to a never-created name is 400/413, not 404.
async function secretReplace(ctx) {
  const vault = ctx.vaultStore ?? vaultStore;
  if (!vault) return err(501, 'SECRETS_BACKEND_DISABLED', 'workspace secrets require the OpenBao backend (not configured)');
  const ws = await ownedWorkspace(ctx, ctx.params.workspaceId);
  if (!ws) return err(404, 'WORKSPACE_NOT_FOUND', `workspace ${ctx.params.workspaceId} not found`);
  // Role gate (#798): replacing a secret value requires an admin tenant role (see secretSet). After
  // the 404 so cross-tenant stays 404; own-tenant non-admin is 403, before any existence probe/write.
  if (!canManageTenant(ctx.identity, ws.tenant_id)) {
    return err(403, 'FORBIDDEN', 'requires superadmin or tenant owner/admin');
  }
  const name = ctx.params.secretName;
  const b = ctx.body ?? {};
  const value = b.secretValue ?? b.value;
  const description = typeof b.description === 'string' ? b.description : undefined;
  if (!vault.validName(name)) return err(400, 'VALIDATION_ERROR', 'secret name must match ^[a-z][a-z0-9_-]{0,62}$');
  const valueError = validateSecretValue(value);
  if (valueError) return valueError;
  try {
    // Replace-only: a PUT to a non-existent secret must NOT silently create it (POST is create-only).
    // Probe existence at the verified tenant/workspace path; if absent, 404 and write nothing.
    if (!(await vault.exists(ws.tenant_id, ws.id, name))) {
      return err(404, 'SECRET_NOT_FOUND', `secret ${name} not found`);
    }
    const meta = await vault.replace(ws.tenant_id, ws.id, name, value, description);
    const refCount = await resolvedRefCount(ctx, ws, name);
    return ok(200, secretMetaOut(meta, ws, refCount));
  } catch (e) { return err(502, 'SECRET_WRITE_FAILED', String(e.message ?? e)); }
}

// GET /v1/functions/workspaces/{workspaceId}/secrets  → FunctionWorkspaceSecretCollection
async function secretList(ctx) {
  const vault = ctx.vaultStore ?? vaultStore;
  if (!vault) return err(501, 'SECRETS_BACKEND_DISABLED', 'workspace secrets require the OpenBao backend (not configured)');
  const ws = await ownedWorkspace(ctx, ctx.params.workspaceId);
  if (!ws) return err(404, 'WORKSPACE_NOT_FOUND', `workspace ${ctx.params.workspaceId} not found`);
  try {
    const metas = await vault.list(ws.tenant_id, ws.id);
    const items = [];
    for (const meta of metas) {
      items.push(secretMetaOut(meta, ws, await resolvedRefCount(ctx, ws, meta.secretName ?? meta.name)));
    }
    return ok(200, { items, page: { size: items.length } });
  } catch (e) { return err(502, 'SECRET_LIST_FAILED', String(e.message ?? e)); }
}

// GET /v1/functions/workspaces/{workspaceId}/secrets/{secretName}  (metadata only — never the value)
async function secretGet(ctx) {
  const vault = ctx.vaultStore ?? vaultStore;
  if (!vault) return err(501, 'SECRETS_BACKEND_DISABLED', 'workspace secrets require the OpenBao backend (not configured)');
  const ws = await ownedWorkspace(ctx, ctx.params.workspaceId);
  if (!ws) return err(404, 'WORKSPACE_NOT_FOUND', `workspace ${ctx.params.workspaceId} not found`);
  try {
    const meta = await vault.getMeta(ws.tenant_id, ws.id, ctx.params.secretName);
    if (!meta) return err(404, 'SECRET_NOT_FOUND', `secret ${ctx.params.secretName} not found`);
    return ok(200, secretMetaOut(meta, ws, await resolvedRefCount(ctx, ws, ctx.params.secretName)));
  } catch (e) { return err(502, 'SECRET_READ_FAILED', String(e.message ?? e)); }
}

// DELETE /v1/functions/workspaces/{workspaceId}/secrets/{secretName}
async function secretDelete(ctx) {
  const vault = ctx.vaultStore ?? vaultStore;
  if (!vault) return err(501, 'SECRETS_BACKEND_DISABLED', 'workspace secrets require the OpenBao backend (not configured)');
  const ws = await ownedWorkspace(ctx, ctx.params.workspaceId);
  if (!ws) return err(404, 'WORKSPACE_NOT_FOUND', `workspace ${ctx.params.workspaceId} not found`);
  // Role gate (#798): deleting a secret requires an admin tenant role (see secretSet). After the 404
  // so cross-tenant stays 404; own-tenant non-admin is 403, before the vault delete side effect.
  if (!canManageTenant(ctx.identity, ws.tenant_id)) {
    return err(403, 'FORBIDDEN', 'requires superadmin or tenant owner/admin');
  }
  const name = ctx.params.secretName;
  if (!vault.validName(name)) return err(400, 'VALIDATION_ERROR', 'secret name must match ^[a-z][a-z0-9_-]{0,62}$');
  try {
    if (!(await vault.exists(ws.tenant_id, ws.id, name))) {
      return err(404, 'SECRET_NOT_FOUND', `secret ${name} not found`);
    }
    await vault.delete(ws.tenant_id, ws.id, name);
    return ok(204, null);
  } catch (e) { return err(502, 'SECRET_DELETE_FAILED', String(e.message ?? e)); }
}

// ---- function definition export / import (#683, data-export-import-clone) ---
// Self-contained bundle movement. Export emits both the spec `resources` reference shape AND the
// deployable `definitions` (source/runtime/entrypoint/parameters) so an export -> import round-trips
// the real function code. Import re-scopes the bundle to the caller's VERIFIED tenant/workspace and
// rejects any cross-scope bundle (IMPORT_SCOPE_VIOLATION via validateImportBundle), then upserts the
// fn_action registry row(s). Persisting the registry row IS the in-scope "import"; redeploying the
// Knative service from imported source is deferred (a separate deploy concern) and noted in the docs.

// OpenWhisk-style package convention: an action's `action_name` is `<packageName>/<actionName>`
// (or a bare action with no package). Derive both parts for the export shapes.
function splitActionName(actionName) {
  const s = String(actionName ?? '');
  const i = s.indexOf('/');
  return i > 0 ? { packageName: s.slice(0, i), shortName: s.slice(i + 1) } : { packageName: null, shortName: s };
}

// Build one export resource (spec reference shape) + its deployable payload from a fn_actions row.
function fnRowToExport(row) {
  const { packageName, shortName } = splitActionName(row.action_name);
  return {
    resource: {
      resourceType: 'function_action',
      name: row.action_name,
      actionName: shortName,
      ...(packageName ? { packageName } : {}),
      visibility: 'private'
    },
    definition: {
      actionName: row.action_name,
      ...(packageName ? { packageName } : {}),
      runtime: row.runtime,
      entrypoint: row.entrypoint,
      sourceCode: row.source_code,
      parameters: row.parameters ?? {},
      metadata: { sourceResourceId: row.resource_id, version: row.version }
    }
  };
}

function exportBundle(ws, rows) {
  const built = rows.map(fnRowToExport);
  return {
    bundleVersion: '2026-03-27',
    tenantId: ws.tenant_id,
    workspaceId: ws.id,
    scope: { tenantId: ws.tenant_id, workspaceId: ws.id },
    resources: built.map((b) => b.resource),
    definitions: built.map((b) => b.definition)
  };
}

// GET /v1/functions/actions/{resourceId}/definition-export — export ONE owned action.
async function fnDefinitionExport(ctx) {
  const row = await store.getFnAction(ctx.pool, ctx.params.resourceId, callerTenantId(ctx.identity));
  if (!row) return err(404, 'ACTION_NOT_FOUND', `action ${ctx.params.resourceId} not found`);
  const ws = await store.getWorkspace(ctx.pool, row.workspace_id);
  if (!ws) return err(404, 'ACTION_NOT_FOUND', `action ${ctx.params.resourceId} not found`);
  return ok(200, exportBundle(ws, [row]));
}

// GET /v1/functions/workspaces/{workspaceId}/packages/{packageName}/definition-export — export every
// action in a package within an owned workspace.
async function fnPackageDefinitionExport(ctx) {
  const ws = await ownedWorkspace(ctx, ctx.params.workspaceId);
  if (!ws) return err(404, 'WORKSPACE_NOT_FOUND', `workspace ${ctx.params.workspaceId} not found`);
  const pkg = String(ctx.params.packageName ?? '');
  const rows = (await store.listFnActions(ctx.pool, ws.id))
    .filter((r) => splitActionName(r.action_name).packageName === pkg);
  return ok(200, exportBundle(ws, rows));
}

// Shared import: re-scope the bundle to the caller's verified tenant/workspace, reject cross-scope,
// then upsert every definition as a registry row. `expectPackage` (for the package-import route)
// requires every definition to carry a packageName.
async function importDefinitions(ctx, { expectPackage = false } = {}) {
  const ws = await ownedWorkspace(ctx, ctx.params.workspaceId);
  if (!ws) return err(404, 'WORKSPACE_NOT_FOUND', `workspace ${ctx.params.workspaceId} not found`);
  const bundle = ctx.body ?? {};
  // Scope validation (reuse the product builder): a bundle whose resources reference another
  // tenant/workspace is rejected BEFORE any write. The kind runtime keys scope on the workspace's
  // canonical tenant/workspace ids — pass those as the caller context so the gate compares against
  // the VERIFIED owner, never body-supplied ids.
  const validateImportBundle = await loadValidateImportBundle();
  const verdict = validateImportBundle(
    { ...bundle, bundleVersion: bundle.bundleVersion ?? '2026-03-27' },
    { tenantId: ws.tenant_id, workspaceId: ws.id });
  if (!verdict.valid && verdict.code === IMPORT_ERROR_CODES.SCOPE_VIOLATION) {
    return err(403, 'IMPORT_SCOPE_VIOLATION', verdict.violations?.[0] ?? 'import bundle is out of the caller scope');
  }
  const defs = Array.isArray(bundle.definitions) ? bundle.definitions : [];
  if (defs.length === 0) return err(400, 'VALIDATION_ERROR', 'definitions (array) is required to import function code');
  const imported = [];
  const skipped = [];
  for (const def of defs) {
    const actionName = String(def?.actionName ?? '');
    const hasPackage = actionName.includes('/') || Boolean(def?.packageName);
    if (expectPackage && !hasPackage) { skipped.push({ actionName, reason: 'NOT_A_PACKAGE_ACTION' }); continue; }
    // Normalize to the package-qualified name when a packageName is provided separately.
    const qualifiedName = def?.packageName && !actionName.includes('/') ? `${def.packageName}/${actionName}` : actionName;
    if (!qualifiedName || !def?.sourceCode) { skipped.push({ actionName: qualifiedName, reason: 'MISSING_NAME_OR_SOURCE' }); continue; }
    const rec = await store.upsertFnAction(ctx.pool, {
      resourceId: `fn_${randomUUID().slice(0, 12)}`,
      workspaceId: ws.id, tenantId: ws.tenant_id, actionName: qualifiedName,
      runtime: def.runtime ?? 'nodejs:22', entrypoint: def.entrypoint ?? 'main',
      sourceCode: def.sourceCode, parameters: def.parameters ?? null,
      memoryMb: 256, timeoutMs: 60000, ksvcName: null, createdBy: ctx.identity?.sub
    });
    imported.push({ resourceId: rec.resource_id, actionName: qualifiedName });
  }
  return ok(200, {
    entityType: 'function_definition_import_result',
    targetTenantId: ws.tenant_id, targetWorkspaceId: ws.id,
    importedAt: new Date().toISOString(),
    totalEntries: defs.length, importedCount: imported.length, skippedCount: skipped.length,
    imported, skipped,
    // Registry rows are created; redeploying the Knative service from imported source is a separate
    // deploy step (POST /v1/functions/actions) and is intentionally not performed here.
    notDeployed: imported.length > 0 ? 'knative-service' : null
  });
}

// POST /v1/functions/workspaces/{workspaceId}/definition-imports
async function fnDefinitionImport(ctx) { return importDefinitions(ctx, { expectPackage: false }); }
// POST /v1/functions/workspaces/{workspaceId}/package-definition-imports
async function fnPackageDefinitionImport(ctx) { return importDefinitions(ctx, { expectPackage: true }); }

export const FN_HANDLERS = {
  fnDeploy, fnInventory, fnListActions, fnActionDetail, fnDelete, fnInvoke,
  fnActivations, fnActivation, fnActivationLogs, fnActivationResult, fnActivationRerun, fnVersions, fnRollback,
  secretSet, secretReplace, secretList, secretGet, secretDelete,
  fnDefinitionExport, fnPackageDefinitionExport, fnDefinitionImport, fnPackageDefinitionImport
};
