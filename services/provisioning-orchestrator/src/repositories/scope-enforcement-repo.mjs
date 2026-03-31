const MAX_QUERY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function decodeCursor(cursor) {
  if (!cursor) return null;
  return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
}

function encodeCursor(row) {
  if (!row) return null;
  return Buffer.from(JSON.stringify({ denied_at: row.denied_at, id: row.id ?? null }), 'utf8').toString('base64url');
}

function ensureWindow(from, to) {
  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) throw Object.assign(new Error('Invalid date range'), { code: 'VALIDATION_ERROR' });
  if (toDate.getTime() - fromDate.getTime() > MAX_QUERY_WINDOW_MS) throw Object.assign(new Error('Query window exceeds 30 days'), { code: 'QUERY_WINDOW_EXCEEDED' });
  return { fromDate, toDate };
}

export async function insertDenial(client, record) {
  const result = await client.query(
    `INSERT INTO scope_enforcement_denials (
      id, tenant_id, workspace_id, actor_id, actor_type, denial_type, http_method, request_path,
      required_scopes, presented_scopes, missing_scopes, required_entitlement, current_plan_id,
      source_ip, correlation_id, denied_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    ON CONFLICT (correlation_id, denied_at) DO NOTHING
    RETURNING *`,
    [record.id, record.tenantId, record.workspaceId, record.actorId, record.actorType, record.denialType, record.httpMethod, record.requestPath, record.requiredScopes ?? [], record.presentedScopes ?? [], record.missingScopes ?? [], record.requiredEntitlement, record.currentPlanId, record.sourceIp, record.correlationId, record.deniedAt]
  );
  return result.rows[0] ?? null;
}

export async function countDenialsInWindow(client, { tenantId = null, from, to }) {
  const { fromDate, toDate } = ensureWindow(from, to);
  const clauses = ['denied_at >= $1', 'denied_at <= $2'];
  const params = [fromDate.toISOString(), toDate.toISOString()];
  if (tenantId) { clauses.push(`tenant_id = $${params.length + 1}`); params.push(tenantId); }
  const result = await client.query(`SELECT COUNT(*)::int AS total FROM scope_enforcement_denials WHERE ${clauses.join(' AND ')}`, params);
  return result.rows[0]?.total ?? 0;
}

export async function queryDenials(client, { tenantId = null, workspaceId = null, denialType = null, actorId = null, from, to, limit = 100, cursor = null }) {
  const { fromDate, toDate } = ensureWindow(from, to);
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const clauses = ['denied_at >= $1', 'denied_at <= $2'];
  const params = [fromDate.toISOString(), toDate.toISOString()];
  if (tenantId) { clauses.push(`tenant_id = $${params.length + 1}`); params.push(tenantId); }
  if (workspaceId) { clauses.push(`workspace_id = $${params.length + 1}`); params.push(workspaceId); }
  if (denialType) { clauses.push(`denial_type = $${params.length + 1}`); params.push(denialType); }
  if (actorId) { clauses.push(`actor_id = $${params.length + 1}`); params.push(actorId); }
  const decoded = decodeCursor(cursor);
  if (decoded?.denied_at) {
    clauses.push(`(denied_at, id) < ($${params.length + 1}::timestamptz, $${params.length + 2}::uuid)`);
    params.push(decoded.denied_at, decoded.id ?? '00000000-0000-0000-0000-000000000000');
  }
  params.push(safeLimit + 1);
  const result = await client.query(`SELECT * FROM scope_enforcement_denials WHERE ${clauses.join(' AND ')} ORDER BY denied_at DESC, id DESC LIMIT $${params.length}`, params);
  const rows = result.rows.slice(0, safeLimit);
  const totalInWindow = await countDenialsInWindow(client, { tenantId, from, to });
  return { denials: rows, nextCursor: result.rows.length > safeLimit ? encodeCursor(rows.at(-1)) : null, totalInWindow };
}
