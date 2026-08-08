import { resolveTenantAccess } from './c08-authz.mjs';
import { validateC08Schema } from './c08-contracts.mjs';

const err = (statusCode, code, message) => ({ statusCode, body: { code, message } });

function entityState(value) {
  const state = String(value ?? '').toLowerCase();
  if (['active', 'suspended', 'soft_deleted', 'deleted', 'draft', 'provisioning', 'pending_activation'].includes(state)) return state;
  if (['pending', 'creating', 'registered'].includes(state)) return 'provisioning';
  return 'active';
}

function tenantState(value) {
  const state = String(value ?? '').toLowerCase();
  if (['active', 'suspended', 'deleted', 'pending_activation'].includes(state)) return state;
  if (['pending', 'creating', 'provisioning'].includes(state)) return 'pending_activation';
  return 'active';
}

function addCount(target, key, value = 1) {
  target[key] = (target[key] ?? 0) + Number(value);
}

async function getTenantGovernanceDashboard(ctx) {
  const access = await resolveTenantAccess(ctx, {
    roles: ['tenant_owner', 'tenant_admin', 'tenant_viewer']
  });
  if (access.error) return access.error;

  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const generatedAt = new Date().toISOString();
    const [workspaceResult, appResult, accountResult, resourceResult, quotaResult] = await Promise.all([
      client.query(
        `SELECT id, slug, environment, status FROM workspaces
          WHERE tenant_id = $1 ORDER BY created_at, id`, [access.tenantId]
      ),
      client.query(
        `SELECT workspace_id, COUNT(*)::int AS count FROM external_applications
          WHERE tenant_id = $1 GROUP BY workspace_id`, [access.tenantId]
      ),
      client.query(
        `SELECT workspace_id, COUNT(*)::int AS count FROM service_accounts
          WHERE tenant_id = $1 GROUP BY workspace_id`, [access.tenantId]
      ),
      client.query(
        `SELECT workspace_id, resource_kind, resource_state, COUNT(*)::int AS count
           FROM (
             SELECT workspace_id, 'postgresql_database'::text AS resource_kind, status::text AS resource_state
               FROM workspace_databases WHERE tenant_id = $1
             UNION ALL
             SELECT workspace_id, 'mongodb_database', 'active' FROM workspace_mongo_databases WHERE tenant_id = $1
             UNION ALL
             SELECT workspace_id, 'storage_bucket', 'active' FROM workspace_buckets WHERE tenant_id = $1
             UNION ALL
             SELECT workspace_id, 'kafka_topic', 'active' FROM workspace_topics WHERE tenant_id = $1
             UNION ALL
             SELECT workspace_id, 'function_action', 'active' FROM fn_actions WHERE tenant_id = $1
             UNION ALL
             SELECT workspace_id, 'function_definition', status FROM workspace_functions WHERE tenant_id = $1
           ) resources
          GROUP BY workspace_id, resource_kind, resource_state`, [access.tenantId]
      ),
      client.query(
        `SELECT DISTINCT ON (dimension_key)
                dimension_key, current_usage, effective_limit, effective_ceiling, decision
           FROM quota_enforcement_log
          WHERE tenant_id = $1
            AND decision IN ('hard_blocked','soft_grace_allowed','soft_grace_exhausted')
          ORDER BY dimension_key, created_at DESC`, [access.tenantId]
      )
    ]);

    const appsByWorkspace = new Map((appResult.rows ?? []).map((row) => [String(row.workspace_id), Number(row.count)]));
    const accountsByWorkspace = new Map((accountResult.rows ?? []).map((row) => [String(row.workspace_id), Number(row.count)]));
    const resourcesByWorkspace = new Map();
    for (const row of resourceResult.rows ?? []) {
      const key = String(row.workspace_id);
      if (!resourcesByWorkspace.has(key)) resourcesByWorkspace.set(key, []);
      resourcesByWorkspace.get(key).push(row);
    }

    const resourcesByKind = {};
    const resourcesByState = {};
    let applicationCount = 0;
    let serviceAccountCount = 0;
    let managedResourceCount = 0;
    const workspaces = (workspaceResult.rows ?? []).map((workspace) => {
      const workspaceResources = resourcesByWorkspace.get(String(workspace.id)) ?? [];
      const resourceKinds = {};
      const resourceStates = {};
      let count = 0;
      for (const row of workspaceResources) {
        const n = Number(row.count);
        const state = entityState(row.resource_state);
        count += n;
        addCount(resourceKinds, row.resource_kind, n);
        addCount(resourceStates, state, n);
        addCount(resourcesByKind, row.resource_kind, n);
        addCount(resourcesByState, state, n);
      }
      const apps = appsByWorkspace.get(String(workspace.id)) ?? 0;
      const accounts = accountsByWorkspace.get(String(workspace.id)) ?? 0;
      applicationCount += apps;
      serviceAccountCount += accounts;
      managedResourceCount += count;
      return {
        workspaceId: String(workspace.id),
        workspaceSlug: String(workspace.slug),
        environment: String(workspace.environment),
        state: entityState(workspace.status),
        applicationCount: apps,
        serviceAccountCount: accounts,
        managedResourceCount: count,
        resourceKinds,
        resourceStates
      };
    });

    const state = tenantState(access.tenant.status);
    const quotaAlerts = (quotaResult.rows ?? []).map((row) => {
      const limit = Math.max(0, Number(row.effective_limit));
      const used = Math.max(0, Number(row.current_usage ?? 0));
      return {
        metricKey: String(row.dimension_key),
        scope: String(row.dimension_key).startsWith('workspace.') ? 'workspace' : 'tenant',
        limit,
        used,
        remaining: Math.max(0, Number(row.effective_ceiling) - used),
        utilizationPercent: limit > 0 ? Number(((used / limit) * 100).toFixed(1)) : 0,
        severity: row.decision === 'soft_grace_allowed' ? 'warning' : 'blocked'
      };
    });
    const allowedActions = {
      pending_activation: ['activate', 'delete'],
      active: ['suspend', 'delete'],
      suspended: ['activate', 'delete'],
      deleted: []
    }[state];
    const body = {
      tenantId: access.tenantId,
      state,
      labels: [],
      provisioningStatus: state === 'pending_activation' ? 'in_progress' : 'completed',
      governanceStatus: state === 'suspended' ? 'suspended' : (quotaAlerts.length ? 'warning' : 'nominal'),
      inventory: {
        tenantId: access.tenantId,
        generatedAt,
        lastConsistentAt: generatedAt,
        workspaceCount: workspaces.length,
        applicationCount,
        serviceAccountCount,
        managedResourceCount,
        sharedResourceCount: 0,
        resourcesByKind,
        resourcesByState,
        workspaces
      },
      quotaAlerts,
      allowedActions,
      deleteProtection: state !== 'deleted'
    };
    const validation = validateC08Schema('TenantGovernanceDashboard', body);
    if (!validation.valid) throw Object.assign(new Error('tenant dashboard projection violates OpenAPI'), {
      code: 'C08_OUTPUT_CONTRACT_VIOLATION', validationErrors: validation.errors
    });
    await client.query('COMMIT');
    ctx.resolvedScope = { tenantId: access.tenantId };
    return { statusCode: 200, body };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* keep original */ }
    if (error?.code === '42P01') return err(503, 'GOVERNANCE_SOURCE_UNAVAILABLE', 'tenant governance source is unavailable');
    throw error;
  } finally {
    client.release();
  }
}

export const C08_DASHBOARD_HANDLERS = Object.freeze({ getTenantGovernanceDashboard });
