/**
 * Data access layer for backup_operations table.
 */
let _client = null;
function getClient() {
    if (_client)
        return _client;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DB_URL });
    _client = pool;
    return _client;
}
/** Allow injecting a mock client for testing */
export function setClient(client) {
    _client = client;
}
function readJsonObject(value) {
    if (!value)
        return null;
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return typeof parsed === 'object' && parsed !== null ? parsed : null;
        }
        catch {
            return null;
        }
    }
    return typeof value === 'object' ? value : null;
}
function rowToRecord(row) {
    return {
        id: row.id,
        type: row.type,
        tenantId: row.tenant_id,
        componentType: row.component_type,
        instanceId: row.instance_id,
        status: row.status,
        requesterId: row.requester_id,
        requesterRole: row.requester_role,
        snapshotId: row.snapshot_id ?? null,
        failureReason: row.failure_reason ?? null,
        failureReasonPublic: row.failure_reason_public ?? null,
        adapterOperationId: row.adapter_operation_id ?? null,
        acceptedAt: new Date(row.accepted_at),
        inProgressAt: row.in_progress_at ? new Date(row.in_progress_at) : null,
        completedAt: row.completed_at ? new Date(row.completed_at) : null,
        failedAt: row.failed_at ? new Date(row.failed_at) : null,
        metadata: readJsonObject(row.metadata),
    };
}
export async function create(record) {
    const client = getClient();
    const result = await client.query(`INSERT INTO backup_operations
      (type, tenant_id, component_type, instance_id, requester_id, requester_role, snapshot_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`, [
        record.type,
        record.tenantId,
        record.componentType,
        record.instanceId,
        record.requesterId,
        record.requesterRole,
        record.snapshotId ?? null,
        record.metadata ? JSON.stringify(record.metadata) : null,
    ]);
    return rowToRecord(result.rows[0]);
}
export async function findById(id) {
    const client = getClient();
    const result = await client.query('SELECT * FROM backup_operations WHERE id = $1', [id]);
    return result.rows.length > 0 ? rowToRecord(result.rows[0]) : null;
}
export async function findActive(tenantId, componentType, instanceId, type) {
    const client = getClient();
    const result = await client.query(`SELECT * FROM backup_operations
     WHERE tenant_id = $1
       AND component_type = $2
       AND instance_id = $3
       AND type = $4
       AND status IN ('accepted', 'in_progress')
     LIMIT 1`, [tenantId, componentType, instanceId, type]);
    return result.rows.length > 0 ? rowToRecord(result.rows[0]) : null;
}
export async function updateStatus(id, status, opts) {
    const timestampCol = status === 'in_progress' ? 'in_progress_at'
        : status === 'completed' ? 'completed_at'
            : status === 'failed' ? 'failed_at'
                : null;
    const setClauses = ['status = $2'];
    const params = [id, status];
    let paramIdx = 3;
    if (timestampCol) {
        setClauses.push(`${timestampCol} = NOW()`);
    }
    if (opts?.failureReason !== undefined) {
        setClauses.push(`failure_reason = $${paramIdx}`);
        params.push(opts.failureReason);
        paramIdx++;
    }
    if (opts?.failureReasonPublic !== undefined) {
        setClauses.push(`failure_reason_public = $${paramIdx}`);
        params.push(opts.failureReasonPublic);
        paramIdx++;
    }
    if (opts?.adapterOperationId !== undefined) {
        setClauses.push(`adapter_operation_id = $${paramIdx}`);
        params.push(opts.adapterOperationId);
        paramIdx++;
    }
    if (opts?.metadataPatch !== undefined) {
        setClauses.push(`metadata = COALESCE(metadata, '{}'::jsonb) || $${paramIdx}::jsonb`);
        params.push(JSON.stringify(opts.metadataPatch));
        paramIdx++;
    }
    const client = getClient();
    const result = await client.query(`UPDATE backup_operations SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`, params);
    return result.rows.length > 0 ? rowToRecord(result.rows[0]) : null;
}
export async function listByTenant(tenantId, limit = 20) {
    const client = getClient();
    const result = await client.query('SELECT * FROM backup_operations WHERE tenant_id = $1 ORDER BY accepted_at DESC LIMIT $2', [tenantId, limit]);
    return result.rows.map(rowToRecord);
}
