// C-08 authorization and scope resolution.  All decisions use verified JWT identity
// fields populated by server.mjs; request x-tenant/x-workspace headers are never read.
import * as store from './tenant-store.mjs';

const TENANT_ID = /^ten_[0-9a-z]+$/;
const WORKSPACE_ID = /^wrk_[0-9a-z]+$/;

const roleSet = (identity) => new Set(Array.isArray(identity?.roles) ? identity.roles.map(String) : []);

export function isPlatformTeam(identity) {
  if (!identity) return false;
  const roles = roleSet(identity);
  return identity.actorType === 'superadmin'
    || roles.has('superadmin')
    || roles.has('platform_admin')
    || roles.has('platform_operator')
    || roles.has('platform_auditor');
}

export function canMutatePlatform(identity) {
  if (!identity) return false;
  const roles = roleSet(identity);
  return identity.actorType === 'superadmin' || roles.has('superadmin') || roles.has('platform_admin');
}

export function canAuditAcrossPlatform(identity) {
  if (!identity) return false;
  const roles = roleSet(identity);
  return identity.actorType === 'superadmin'
    || roles.has('superadmin')
    || roles.has('platform_admin')
    || roles.has('platform_auditor');
}

function error(statusCode, code, message) {
  return { error: { statusCode, body: { code, message } } };
}

export async function resolveTenantAccess(ctx, {
  roles = ['tenant_owner', 'tenant_admin'],
  allowPlatform = true,
  platformPredicate = isPlatformTeam,
  tenantId = ctx.params?.tenantId
} = {}) {
  const requested = String(tenantId ?? '');
  if (!TENANT_ID.test(requested)) return error(400, 'INVALID_IDENTIFIER', 'malformed tenantId');

  const platform = allowPlatform && platformPredicate(ctx.identity);
  if (!platform && String(ctx.identity?.tenantId ?? '') !== requested) {
    return error(404, 'TENANT_NOT_FOUND', `tenant ${requested} not found`);
  }
  const identityRoles = roleSet(ctx.identity);
  if (!platform && !roles.some((role) => identityRoles.has(role))) {
    return error(403, 'FORBIDDEN', 'insufficient tenant permission');
  }
  const tenant = await store.getTenant(ctx.pool, requested);
  if (!tenant) return error(404, 'TENANT_NOT_FOUND', `tenant ${requested} not found`);
  return { tenant, tenantId: tenant.id ?? requested, platform };
}

export async function resolveWorkspaceAccess(ctx, {
  roles = ['workspace_owner', 'workspace_admin'],
  tenantRoles = ['tenant_owner', 'tenant_admin'],
  allowPlatform = true,
  platformPredicate = isPlatformTeam,
  workspaceId = ctx.params?.workspaceId
} = {}) {
  const requested = String(workspaceId ?? '');
  if (!WORKSPACE_ID.test(requested)) return error(400, 'INVALID_IDENTIFIER', 'malformed workspaceId');
  const platform = allowPlatform && platformPredicate(ctx.identity);
  const workspace = await store.getWorkspace(ctx.pool, requested);
  if (!workspace) return error(404, 'WORKSPACE_NOT_FOUND', `workspace ${requested} not found`);
  const tenantId = String(workspace.tenant_id ?? workspace.tenantId ?? '');

  // Scope masking precedes role checks.  A foreign tenant/workspace is indistinguishable
  // from a missing one to a constrained caller.
  if (!platform && String(ctx.identity?.tenantId ?? '') !== tenantId) {
    return error(404, 'WORKSPACE_NOT_FOUND', `workspace ${requested} not found`);
  }
  if (!platform) {
    const identityRoles = roleSet(ctx.identity);
    const tenantRole = tenantRoles.some((role) => identityRoles.has(role));
    const workspaceRole = roles.some((role) => identityRoles.has(role));
    const boundWorkspaceIds = new Set([
      ...(Array.isArray(ctx.identity?.workspaceIds) ? ctx.identity.workspaceIds : []),
      ...(ctx.identity?.workspaceId ? [ctx.identity.workspaceId] : [])
    ].map(String));
    if (!tenantRole && !(workspaceRole && boundWorkspaceIds.has(requested))) {
      return error(403, 'FORBIDDEN', 'insufficient workspace permission');
    }
  }
  return { workspace, workspaceId: workspace.id ?? requested, tenantId, platform };
}

export const C08_ID_PATTERNS = Object.freeze({ tenantId: TENANT_ID, workspaceId: WORKSPACE_ID });
