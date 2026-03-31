import { queryDenials } from '../repositories/scope-enforcement-repo.mjs';

const ALLOWED_DENIAL_TYPES = new Set(['SCOPE_INSUFFICIENT', 'PLAN_ENTITLEMENT_DENIED', 'WORKSPACE_SCOPE_MISMATCH', 'CONFIG_ERROR']);

export async function main(params = {}, overrides = {}) {
  const db = overrides.db ?? params.db;
  const callerContext = params.callerContext ?? {};
  const actorType = callerContext.actor?.type;
  if (!params.from || !params.to) return { statusCode: 400, body: { error: 'VALIDATION_ERROR', message: 'from and to are required' } };
  if (params.denial_type && !ALLOWED_DENIAL_TYPES.has(params.denial_type)) return { statusCode: 400, body: { error: 'INVALID_DENIAL_TYPE', message: 'Unknown denial_type' } };
  const forcedTenantId = actorType === 'platform_admin' || actorType === 'superadmin' ? params.tenant_id ?? null : callerContext.tenantId ?? null;
  try {
    const result = await queryDenials(db, {
      tenantId: forcedTenantId,
      workspaceId: params.workspace_id ?? null,
      denialType: params.denial_type ?? null,
      actorId: params.actor_id ?? null,
      from: params.from,
      to: params.to,
      limit: params.limit ?? 100,
      cursor: params.cursor ?? null
    });
    return { statusCode: 200, body: { denials: result.denials, next_cursor: result.nextCursor, total_in_window: result.totalInWindow } };
  } catch (error) {
    if (error.code === 'QUERY_WINDOW_EXCEEDED') return { statusCode: 400, body: { error: 'QUERY_WINDOW_EXCEEDED', message: error.message } };
    throw error;
  }
}
