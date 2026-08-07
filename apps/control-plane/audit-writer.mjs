// Dispatch-level audit + scope-enforcement denial writer (kind deploy, #557).
//
// Hooks the audit store (audit-store.mjs) and the scope_enforcement_denials store
// (packages/provisioning-orchestrator 093 migration) into the control-plane request
// dispatch, so REAL control-plane actions (tenant/user/workspace lifecycle, governance
// mutations, ...) record an audit entry WITH the request correlation_id, and scope
// denials are recorded too. Both are best-effort: auditing must NEVER fail the action
// it describes.
//
// Isolation: the audit descriptor's tenant_id is resolved from the verified identity /
// path scope (never from the request body), and the denial writer carries tenant_id +
// workspace_id + actor_id, so a record can never land under another tenant.
import { randomUUID } from 'node:crypto';
import { recordAuditEvent } from './audit-store.mjs';

// Local handlers whose effect is a STATE MUTATION worth auditing, mapped to a stable
// action_type. Read handlers (list*/get*/iam list*/metrics*) are intentionally absent,
// so a GET never produces an audit record.
const AUDITABLE_LOCAL_HANDLERS = {
  createTenant: 'tenant.create', deleteTenant: 'tenant.delete', purgeTenant: 'tenant.purge',
  createTenantUser: 'tenant.user.create',
  setAuthConfig: 'tenant.auth-config.update', setSocialProvider: 'tenant.social-provider.upsert',
  deleteSocialProvider: 'tenant.social-provider.delete',
  createWorkspace: 'workspace.create',
  promoteWorkspace: 'workspace.promote',
  createServiceAccount: 'workspace.service-account.create',
  issueCredential: 'workspace.service-account.credential.issue',
  rotateCredential: 'workspace.service-account.credential.rotate',
  revokeCredential: 'workspace.service-account.credential.revoke',
  provisionDatabase: 'workspace.database.provision',
  provisionDatabaseGeneric: 'workspace.database.provision',
  rotateDatabaseCredential: 'workspace.database.credential.rotate',
  registerFunction: 'workspace.function.register',
  iamCreateUser: 'iam.user.create', iamDeleteUser: 'iam.user.delete', iamSetUserStatus: 'iam.user.status',
  iamCreateRole: 'iam.role.create', iamCreateGroup: 'iam.group.create',
  iamAssignUserRoles: 'iam.user.role-assign', iamRemoveUserRoles: 'iam.user.role-remove',
  iamAddUserToGroup: 'iam.user.group-add', iamRemoveUserFromGroup: 'iam.user.group-remove',
  // Secret-access (#644): writes AND reads are security-relevant and audited (the
  // handlers are authenticated and carry ctx.identity + ctx.params.workspaceId).
  secretSet: 'workspace.secret.set', secretGet: 'workspace.secret.get',
  secretList: 'workspace.secret.list', secretDelete: 'workspace.secret.delete',
  fnDeploy: 'workspace.function.deploy',
  fnDelete: 'workspace.function.delete',
  fnInvoke: 'workspace.function.invoke',
  fnRollback: 'workspace.function.rollback',
  fnActivationRerun: 'workspace.function.activation.rerun'
};

// Map an HTTP status to the audited outcome (#644): the TRUE result of the action,
// recorded at write time (was hardcoded 'succeeded' at read time).
export function outcomeFromStatus(statusCode) {
  const s = Number(statusCode ?? 200);
  if (s < 400) return 'succeeded';
  if (s === 403) return 'denied';
  if (s < 500) return 'failed';
  return 'error';
}

// Resolve the OWNING tenant id of an action from the verified identity + path scope —
// never from the request body. The path tenantId (superadmin acting on a tenant) wins;
// otherwise the caller's own tenant. For workspace-scoped actions the owning tenant is
// the caller's tenant (the handler already 403s cross-tenant), with the workspaceId from
// the response when the action created it, else the path param.
function resolveScope(route, ctx, result) {
  const params = ctx.params ?? {};
  const identity = ctx.identity ?? {};
  const body = result?.body ?? {};
  const trustedScope = result?.auditScope ?? {};
  const tenantId = trustedScope.tenantId ?? params.tenantId
    ?? body.tenantId ?? body.tenant?.tenantId ?? body.tenant?.id
    ?? identity.tenantId ?? null;
  const workspaceId = trustedScope.workspaceId ?? params.workspaceId
    ?? body.workspaceId ?? body.workspace?.workspaceId ?? body.workspace?.id
    ?? null;
  return { tenantId, workspaceId };
}

// Build the audit descriptor an auditable local route produces, or null when the
// route is non-auditable (a read not in the auditable set) or cannot be attributed
// to a tenant. The TRUE outcome (succeeded/denied/failed/error) is derived from the
// status — failures and denials ARE recorded now (#644), distinguished by outcome.
// Returned shape is the recordAuditEvent() input (sans correlationId, added by the caller).
export function auditEventForRoute(route, ctx, result) {
  if (!route?.localHandler) return null;
  const actionType = AUDITABLE_LOCAL_HANDLERS[route.localHandler];
  if (!actionType) return null;
  const status = result?.statusCode ?? 200;
  const { tenantId, workspaceId } = resolveScope(route, ctx, result);
  if (!tenantId) return null; // never record an action we cannot attribute to a tenant
  const evidence = result?.knativeEvidence;
  const safeEvidence = evidence && typeof evidence === 'object' ? {
    capability: evidence.capability === 'mcp' ? 'mcp' : 'function',
    operation: ['deploy', 'update', 'invoke', 'rollback', 'delete', 'cleanup'].includes(evidence.operation)
      ? evidence.operation : 'cleanup',
    mode: ['managed', 'external', 'disabled'].includes(evidence.mode) ? evidence.mode : 'disabled',
    state: ['ready', 'unverified', 'degraded', 'unavailable', 'disabled'].includes(evidence.state)
      ? evidence.state : 'unavailable',
    reason: /^[A-Z][A-Z0-9_]{0,63}$/.test(evidence.reason ?? '')
      ? evidence.reason : 'STATUS_UNAVAILABLE',
    result: ['unavailable', 'deferred', 'recovered', 'retry_failed'].includes(evidence.result)
      ? evidence.result : 'unavailable',
  } : null;
  return {
    actionType, actorId: ctx.identity?.sub ?? 'unknown', tenantId, workspaceId,
    outcome: outcomeFromStatus(status),
    newState: {
      method: route.method,
      path: route.path,
      status,
      ...(safeEvidence ? { knative: safeEvidence } : {}),
      ...(actionType === 'workspace.function.activation.rerun' && result?.auditScope?.resourceId
        ? { resourceId: result.auditScope.resourceId } : {}),
    }
  };
}

// Record the audit event for a dispatched local action (best-effort). Swallows any
// error so auditing never breaks the action; logs at warn for diagnosability.
export async function recordRouteAudit(db, route, ctx, result, correlationId, log = console) {
  try {
    const desc = auditEventForRoute(route, ctx, result);
    if (!desc) return null;
    return await recordAuditEvent(db, { ...desc, correlationId: correlationId ?? null });
  } catch (e) {
    log.warn?.(`[control-plane] audit write skipped: ${e?.message ?? e}`);
    return null;
  }
}

// Record a scope-enforcement denial into scope_enforcement_denials (the store the
// scope-enforcement audit query reads). Reuses the product repo's insert via the same
// SQL contract; tenant_id/workspace_id/actor_id/correlation_id are mandatory carriers.
// Best-effort: a denial-record failure must not change the (already-denied) response.
export async function recordScopeDenial(db, {
  tenantId, workspaceId = null, actorId, actorType = 'user', denialType = 'SCOPE_INSUFFICIENT',
  httpMethod, requestPath, requiredScopes = [], presentedScopes = [], missingScopes = [],
  requiredEntitlement = null, currentPlanId = null, sourceIp = null,
  correlationId, deniedAt = new Date().toISOString()
} = {}, log = console) {
  try {
    if (!tenantId || !actorId || !correlationId) return null;
    const res = await db.query(
      `INSERT INTO scope_enforcement_denials (
        id, tenant_id, workspace_id, actor_id, actor_type, denial_type, http_method, request_path,
        required_scopes, presented_scopes, missing_scopes, required_entitlement, current_plan_id,
        source_ip, correlation_id, denied_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      ON CONFLICT (correlation_id, denied_at) DO NOTHING
      RETURNING *`,
      [randomUUID(), tenantId, workspaceId, actorId, actorType, denialType, httpMethod ?? 'GET',
        requestPath ?? '/', requiredScopes ?? [], presentedScopes ?? [], missingScopes ?? [],
        requiredEntitlement, currentPlanId, sourceIp, correlationId, deniedAt]
    );
    return res.rows[0] ?? null;
  } catch (e) {
    log.warn?.(`[control-plane] scope denial write skipped: ${e?.message ?? e}`);
    return null;
  }
}

// Record a quota-enforcement decision into quota_enforcement_log (the store the quota audit
// reads). Called at an enforcement point (e.g. a 402 QUOTA_EXCEEDED) so a denial leaves a
// correlated row. Best-effort: a logging failure must not change the (already-decided)
// response. dimension_key must exist in quota_dimension_catalog (it does whenever a real
// decision was made — a missing dimension fails open, so no denial reaches here).
export async function recordQuotaEnforcement(db, {
  tenantId, workspaceId = null, dimensionKey, attemptedAction = null, currentUsage = null,
  effectiveLimit, quotaType = 'hard', graceMargin = 0, effectiveCeiling,
  source = 'default', decision, actorId = null, correlationId = null, warning = null
} = {}, log = console) {
  try {
    if (!tenantId || !dimensionKey || effectiveLimit == null || effectiveCeiling == null || !decision) return null;
    const res = await db.query(
      `INSERT INTO quota_enforcement_log (
        id, tenant_id, workspace_id, dimension_key, attempted_action, current_usage,
        effective_limit, quota_type, grace_margin, effective_ceiling, source, decision,
        actor_id, correlation_id, warning
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING *`,
      [randomUUID(), tenantId, workspaceId, dimensionKey, attemptedAction, currentUsage,
        effectiveLimit, quotaType, graceMargin ?? 0, effectiveCeiling, source ?? 'default', decision,
        actorId, correlationId, warning]
    );
    return res.rows[0] ?? null;
  } catch (e) {
    log.warn?.(`[control-plane] quota enforcement write skipped: ${e?.message ?? e}`);
    return null;
  }
}

// Map a verified identity's actorType to the scope_enforcement_denials.actor_type domain.
function denialActorType(actorType) {
  const t = String(actorType ?? '').toLowerCase();
  if (t.includes('api') && t.includes('key')) return 'api_key';
  if (t.includes('service')) return 'service_account';
  if (t === 'anonymous' || t === 'anon') return 'anonymous';
  return 'user';
}

// Record a scope-enforcement denial for a dispatched local action that returned 403
// (best-effort). Attributed to the caller's verified tenant + actor and the request
// correlation id (generated if absent), so a tenant's audit query surfaces its own denied
// attempts. A non-403 result, or an action with no attributable tenant/actor, records nothing.
export async function recordRouteDenial(db, route, ctx, result, correlationId, log = console) {
  try {
    if ((result?.statusCode ?? 200) !== 403) return null;
    const identity = ctx.identity ?? {};
    const tenantId = identity.tenantId ?? null;
    const actorId = identity.sub ?? identity.actorId ?? null;
    if (!tenantId || !actorId) return null; // cannot attribute (e.g. unauthenticated/superadmin)
    return await recordScopeDenial(db, {
      tenantId,
      workspaceId: ctx.params?.workspaceId ?? identity.workspaceId ?? null,
      actorId,
      actorType: denialActorType(identity.actorType),
      denialType: 'SCOPE_INSUFFICIENT',
      httpMethod: route?.method ?? ctx.req?.method ?? 'GET',
      requestPath: route?.path ?? '/',
      correlationId: correlationId ?? randomUUID(),
    }, log);
  } catch (e) {
    log.warn?.(`[control-plane] route denial write skipped: ${e?.message ?? e}`);
    return null;
  }
}

export { AUDITABLE_LOCAL_HANDLERS };
