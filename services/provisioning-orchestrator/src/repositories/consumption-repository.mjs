const DIMENSION_QUERY_MAP = {
  max_workspaces: makeDimensionQuery('workspaces'),
  max_pg_databases: makeDimensionQuery('pg_databases'),
  max_functions: makeDimensionQuery('functions'),
  max_kafka_topics: makeDimensionQuery('kafka_topics'),
  max_realtime_channels: makeDimensionQuery('realtime_channels'),
  max_storage_gb: makeStorageQuery(),
  max_monthly_api_calls: makeMonthlyCallsQuery(),
  max_members: makeDimensionQuery('workspace_members')
};

function makeDimensionQuery(tableName) {
  return async (client, tenantId, workspaceId) => {
    if (client.catalogDimensions !== undefined || client.plans !== undefined) {
      const rows = client[tableName] ?? client[`_${tableName}`] ?? [];
      return rows.filter((row) => matchesScope(row, tenantId, workspaceId)).length;
    }
    const values = workspaceId ? [tenantId, workspaceId] : [tenantId];
    const clause = workspaceId ? 'tenant_id = $1 AND workspace_id = $2' : 'tenant_id = $1';
    const { rows } = await client.query(`SELECT COUNT(*)::bigint AS value FROM ${tableName} WHERE ${clause}`, values);
    return Number(rows[0]?.value ?? 0);
  };
}

function makeStorageQuery() {
  return async (client, tenantId, workspaceId) => {
    if (client.catalogDimensions !== undefined || client.plans !== undefined) {
      const rows = client.storage_objects ?? client._storage_objects ?? [];
      const totalBytes = rows.filter((row) => matchesScope(row, tenantId, workspaceId)).reduce((sum, row) => sum + Number(row.size_bytes ?? row.sizeBytes ?? 0), 0);
      return Number((totalBytes / 1e9).toFixed(3));
    }
    const values = workspaceId ? [tenantId, workspaceId] : [tenantId];
    const clause = workspaceId ? 'tenant_id = $1 AND workspace_id = $2' : 'tenant_id = $1';
    const { rows } = await client.query(`SELECT COALESCE(SUM(size_bytes), 0)::float8 / 1000000000 AS value FROM storage_objects WHERE ${clause}`, values);
    return Number(rows[0]?.value ?? 0);
  };
}

function makeMonthlyCallsQuery() {
  return async (client, tenantId, workspaceId) => {
    if (client.catalogDimensions !== undefined || client.plans !== undefined) {
      const rows = client.api_call_logs ?? client._api_call_logs ?? [];
      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);
      return rows.filter((row) => matchesScope(row, tenantId, workspaceId) && new Date(row.created_at ?? row.createdAt ?? Date.now()) >= monthStart).length;
    }
    const values = workspaceId ? [tenantId, workspaceId] : [tenantId];
    const clause = workspaceId ? 'tenant_id = $1 AND workspace_id = $2' : 'tenant_id = $1';
    const { rows } = await client.query(`SELECT COUNT(*)::bigint AS value FROM api_call_logs WHERE ${clause} AND created_at >= date_trunc('month', NOW())`, values);
    return Number(rows[0]?.value ?? 0);
  };
}

function matchesScope(row, tenantId, workspaceId) {
  const rowTenantId = row.tenant_id ?? row.tenantId;
  const rowWorkspaceId = row.workspace_id ?? row.workspaceId ?? null;
  if (rowTenantId !== tenantId) return false;
  if (!workspaceId) return true;
  return rowWorkspaceId === workspaceId;
}

function withTimeout(promise, timeoutMs = 500) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('CONSUMPTION_QUERY_FAILED')), timeoutMs))
  ]);
}

export function computeUsageStatus(currentUsage, effectiveLimit) {
  if (currentUsage === null || currentUsage === undefined) return 'unknown';
  if (effectiveLimit === -1) return 'within_limit';
  if (effectiveLimit === 0) return currentUsage > 0 ? 'over_limit' : 'at_limit';
  if (currentUsage > effectiveLimit) return 'over_limit';
  if (currentUsage === effectiveLimit) return 'at_limit';
  if (currentUsage / effectiveLimit >= 0.8) return 'approaching_limit';
  return 'within_limit';
}

export async function resolveDimensionCounts(client, tenantId, dimensions, workspaceId = undefined) {
  const entries = await Promise.allSettled(dimensions.map(async (dimension) => {
    const dimensionKey = typeof dimension === 'string' ? dimension : dimension.dimensionKey;
    const effectiveLimit = typeof dimension === 'string' ? undefined : dimension.effectiveValue;
    const resolver = DIMENSION_QUERY_MAP[dimensionKey];
    if (!resolver) {
      return [dimensionKey, { currentUsage: null, usageStatus: 'unknown', usageUnknownReason: 'NO_QUERY_MAPPING' }];
    }
    try {
      const currentUsage = await withTimeout(Promise.resolve(resolver(client, tenantId, workspaceId)));
      return [dimensionKey, { currentUsage, usageStatus: computeUsageStatus(currentUsage, effectiveLimit), usageUnknownReason: null }];
    } catch {
      return [dimensionKey, { currentUsage: null, usageStatus: 'unknown', usageUnknownReason: 'CONSUMPTION_QUERY_FAILED' }];
    }
  }));

  const result = new Map();
  for (const entry of entries) {
    if (entry.status === 'fulfilled') {
      result.set(entry.value[0], entry.value[1]);
    }
  }
  return result;
}

export { DIMENSION_QUERY_MAP };
