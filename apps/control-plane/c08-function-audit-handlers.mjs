import { resolveWorkspaceAccess, canAuditAcrossPlatform } from './c08-authz.mjs';
import { validateC08Schema } from './c08-contracts.mjs';

const ACTION_TYPES = Object.freeze({
  DEPLOY: 'function.deployed',
  ADMIN: 'function.admin_action',
  ROLLBACK: 'function.rolled_back',
  QUOTA: 'function.quota_enforced'
});
const EXPECTED = Object.freeze(Object.values(ACTION_TYPES));
const err = (statusCode, code, message) => ({ statusCode, body: { code, message } });

function contractual(body) {
  const result = validateC08Schema('AuditPage', body);
  if (!result.valid) throw Object.assign(new Error('function audit projection violates OpenAPI'), {
    code: 'C08_OUTPUT_CONTRACT_VIOLATION', validationErrors: result.errors
  });
  return { statusCode: 200, body };
}

function q(ctx, name) {
  if (ctx.searchParams?.get) return ctx.searchParams.get(name);
  const value = ctx.query?.[name];
  return Array.isArray(value) ? value[0] : value;
}

function parseLimit(ctx) {
  const raw = q(ctx, 'limit');
  if (raw == null) return 50;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 && value <= 200 ? value : null;
}

function parseDate(value) {
  if (value == null) return null;
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) ? date.toISOString() : undefined;
}

function encodeCursor(row) {
  return Buffer.from(JSON.stringify({ createdAt: new Date(row.created_at).toISOString(), id: String(row.id) })).toString('base64url');
}

function decodeCursor(value) {
  if (!value) return null;
  try {
    const decoded = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    if (typeof decoded.id !== 'string' || parseDate(decoded.createdAt) === undefined) return undefined;
    return { id: decoded.id, createdAt: parseDate(decoded.createdAt) };
  } catch { return undefined; }
}

async function access(ctx) {
  return resolveWorkspaceAccess(ctx, {
    roles: ['workspace_owner', 'workspace_admin'],
    tenantRoles: [],
    platformPredicate: canAuditAcrossPlatform
  });
}

function filters(ctx) {
  const limit = parseLimit(ctx);
  const since = parseDate(q(ctx, 'since'));
  const until = parseDate(q(ctx, 'until'));
  const cursor = decodeCursor(q(ctx, 'cursor'));
  if (limit == null || since === undefined || until === undefined || cursor === undefined) return null;
  if (since && until && new Date(since) > new Date(until)) return null;
  return {
    limit, since, until, cursor,
    actionType: q(ctx, 'actionType') ? String(q(ctx, 'actionType')) : null,
    actor: q(ctx, 'actor') ? String(q(ctx, 'actor')) : null,
    functionId: q(ctx, 'functionId') ? String(q(ctx, 'functionId')) : null
  };
}

function addSharedWhere(where, params, f, { idExpression = 'id', timestampExpression = 'created_at', actorExpression = 'actor_id', functionExpression }) {
  if (f.since) { params.push(f.since); where.push(`${timestampExpression} >= $${params.length}::timestamptz`); }
  if (f.until) { params.push(f.until); where.push(`${timestampExpression} <= $${params.length}::timestamptz`); }
  if (f.actor) { params.push(f.actor); where.push(`${actorExpression} = $${params.length}`); }
  if (f.functionId && functionExpression) { params.push(f.functionId); where.push(`${functionExpression} = $${params.length}`); }
  if (f.cursor) {
    params.push(f.cursor.createdAt, f.cursor.id);
    where.push(`(${timestampExpression}, ${idExpression}::text) < ($${params.length - 1}::timestamptz, $${params.length})`);
  }
}

function page(rows, limit, mapper) {
  const hasMore = rows.length > limit;
  const selected = rows.slice(0, limit);
  const body = { items: selected.map(mapper), page: { size: selected.length } };
  if (hasMore) body.page.nextCursor = encodeCursor(selected[selected.length - 1]);
  return contractual(body);
}

function baseAuditEntry(row, fallbackActionType) {
  const detail = row.new_state && typeof row.new_state === 'object' ? row.new_state : {};
  const entry = {
    recordId: String(row.id),
    actionType: row.action_type ?? fallbackActionType,
    tenantId: String(row.tenant_id),
    workspaceId: String(row.workspace_id ?? detail.workspaceId),
    actor: String(row.actor_id ?? 'system'),
    createdAt: new Date(row.created_at).toISOString()
  };
  const functionId = detail.functionId ?? detail.resourceId;
  if (functionId) entry.functionId = String(functionId);
  if (row.correlation_id) entry.correlationId = String(row.correlation_id);
  if (detail.originSurface ?? detail.initiatingSurface) entry.initiatingSurface = String(detail.originSurface ?? detail.initiatingSurface);
  return { entry, detail };
}

async function queryPlanAudit(ctx, scope, f, actionTypes) {
  const params = [scope.tenantId, scope.workspaceId, actionTypes];
  const where = [
    'tenant_id = $1',
    `new_state->>'workspaceId' = $2`,
    'action_type = ANY($3::text[])'
  ];
  if (f.actionType) { params.push(f.actionType); where.push(`action_type = $${params.length}`); }
  addSharedWhere(where, params, f, {
    functionExpression: `COALESCE(new_state->>'functionId', new_state->>'resourceId')`
  });
  params.push(f.limit + 1);
  const result = await ctx.pool.query(
    `SELECT id, action_type, actor_id, tenant_id,
            new_state->>'workspaceId' AS workspace_id, new_state,
            correlation_id, outcome, created_at
       FROM plan_audit_events
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC, id DESC LIMIT $${params.length}`,
    params
  );
  return result.rows ?? [];
}

async function listFunctionDeploymentAudit(ctx) {
  const scope = await access(ctx);
  if (scope.error) return scope.error;
  const f = filters(ctx);
  if (!f) return err(400, 'INVALID_AUDIT_QUERY', 'invalid function audit query');
  const rows = await queryPlanAudit(ctx, scope, f, [ACTION_TYPES.DEPLOY, ACTION_TYPES.ADMIN, 'workspace.function.register']);
  return page(rows, f.limit, (row) => {
    const { entry, detail } = baseAuditEntry(row, ACTION_TYPES.DEPLOY);
    if (row.action_type === ACTION_TYPES.ADMIN) return { ...entry, adminAction: String(detail.adminAction ?? 'delete') };
    return {
      ...entry,
      actionType: ACTION_TYPES.DEPLOY,
      deploymentNature: ['create', 'update', 'redeploy'].includes(detail.deploymentNature)
        ? detail.deploymentNature
        : (row.action_type === 'workspace.function.register' ? 'create' : 'update')
    };
  });
}

async function listFunctionRollbackEvidence(ctx) {
  const scope = await access(ctx);
  if (scope.error) return scope.error;
  const f = filters(ctx);
  if (!f) return err(400, 'INVALID_AUDIT_QUERY', 'invalid function audit query');
  const rows = await queryPlanAudit(ctx, scope, f, [ACTION_TYPES.ROLLBACK]);
  return page(rows, f.limit, (row) => {
    const { entry, detail } = baseAuditEntry(row, ACTION_TYPES.ROLLBACK);
    return {
      ...entry,
      actionType: ACTION_TYPES.ROLLBACK,
      sourceVersionId: String(detail.sourceVersionId ?? detail.requestedVersionId ?? 'unknown'),
      targetVersionId: String(detail.targetVersionId ?? detail.activeVersionId ?? detail.requestedVersionId ?? 'unknown'),
      outcome: row.outcome === 'succeeded' ? 'success' : 'failure'
    };
  });
}

async function listFunctionQuotaEnforcement(ctx) {
  const scope = await access(ctx);
  if (scope.error) return scope.error;
  const f = filters(ctx);
  if (!f) return err(400, 'INVALID_AUDIT_QUERY', 'invalid function audit query');
  if (f.actionType && f.actionType !== ACTION_TYPES.QUOTA) return contractual({ items: [], page: { size: 0 } });
  const params = [scope.tenantId, scope.workspaceId];
  const where = [
    'tenant_id = $1', 'workspace_id = $2',
    `(attempted_action ILIKE '%function%' OR dimension_key ILIKE '%function%')`
  ];
  addSharedWhere(where, params, f, {
    functionExpression: `NULLIF(split_part(attempted_action, ':', 2), '')`
  });
  params.push(f.limit + 1);
  const result = await ctx.pool.query(
    `SELECT id, tenant_id, workspace_id, actor_id, attempted_action, dimension_key,
            current_usage, effective_limit, effective_ceiling, decision, warning,
            correlation_id, created_at
       FROM quota_enforcement_log
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC, id DESC LIMIT $${params.length}`,
    params
  );
  return page(result.rows ?? [], f.limit, (row) => {
    const allowed = ['allowed', 'soft_grace_allowed', 'unlimited'].includes(row.decision);
    const item = {
      recordId: String(row.id), actionType: ACTION_TYPES.QUOTA,
      tenantId: String(row.tenant_id), workspaceId: String(row.workspace_id),
      actor: String(row.actor_id ?? 'system'),
      createdAt: new Date(row.created_at).toISOString(),
      decision: allowed ? 'allowed' : 'denied',
      quotaDimension: String(row.dimension_key)
    };
    const functionId = String(row.attempted_action ?? '').split(':')[1];
    if (functionId) item.functionId = functionId;
    if (row.correlation_id) item.correlationId = String(row.correlation_id);
    if (allowed) item.remainingCapacity = Math.max(0, Number(row.effective_ceiling) - Number(row.current_usage ?? 0));
    else item.denialReason = String(row.warning ?? row.decision);
    return item;
  });
}

async function getFunctionAuditCoverage(ctx) {
  if (!canAuditAcrossPlatform(ctx.identity)) return err(403, 'FORBIDDEN', 'requires function audit coverage permission');
  const since = parseDate(q(ctx, 'since'));
  const until = parseDate(q(ctx, 'until'));
  if (since === undefined || until === undefined || (since && until && new Date(since) > new Date(until))) {
    return err(400, 'INVALID_AUDIT_QUERY', 'invalid coverage time window');
  }
  const timeWhere = [];
  const params = [];
  if (since) { params.push(since); timeWhere.push(`created_at >= $${params.length}::timestamptz`); }
  if (until) { params.push(until); timeWhere.push(`created_at <= $${params.length}::timestamptz`); }
  const suffix = timeWhere.length ? ` AND ${timeWhere.join(' AND ')}` : '';
  const [activeResult, auditResult, quotaResult] = await Promise.all([
    ctx.pool.query(`SELECT COUNT(DISTINCT workspace_id) AS count FROM fn_actions`),
    ctx.pool.query(
      `SELECT action_type, COUNT(DISTINCT new_state->>'workspaceId') AS covered
         FROM plan_audit_events
        WHERE action_type = ANY($${params.length + 1}::text[])
          AND new_state->>'workspaceId' IS NOT NULL${suffix}
        GROUP BY action_type`,
      [...params, [ACTION_TYPES.DEPLOY, ACTION_TYPES.ADMIN, ACTION_TYPES.ROLLBACK]]
    ),
    ctx.pool.query(
      `SELECT COUNT(DISTINCT workspace_id) AS covered
         FROM quota_enforcement_log
        WHERE workspace_id IS NOT NULL
          AND (attempted_action ILIKE '%function%' OR dimension_key ILIKE '%function%')${suffix}`,
      params
    )
  ]);
  const activeScopes = Number(activeResult.rows?.[0]?.count ?? 0);
  const byAction = new Map((auditResult.rows ?? []).map((row) => [row.action_type, Number(row.covered)]));
  byAction.set(ACTION_TYPES.QUOTA, Number(quotaResult.rows?.[0]?.covered ?? 0));
  const body = {
    generatedAt: new Date().toISOString(), expectedActionTypes: [...EXPECTED], activeScopes,
    coverageByActionType: EXPECTED.map((actionType) => {
      const coveredScopes = byAction.get(actionType) ?? 0;
      return { actionType, coveredScopes, missingScopes: Math.max(0, activeScopes - coveredScopes) };
    })
  };
  const validation = validateC08Schema('AuditCoverageReport', body);
  if (!validation.valid) throw Object.assign(new Error('coverage projection violates OpenAPI'), {
    code: 'C08_OUTPUT_CONTRACT_VIOLATION', validationErrors: validation.errors
  });
  return { statusCode: 200, body };
}

export const C08_FUNCTION_AUDIT_HANDLERS = Object.freeze({
  listFunctionDeploymentAudit,
  listFunctionQuotaEnforcement,
  listFunctionRollbackEvidence,
  getFunctionAuditCoverage
});
