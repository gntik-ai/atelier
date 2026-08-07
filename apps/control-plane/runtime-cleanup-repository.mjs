const BATCH_LIMIT = 25;

function rowOut(row) {
  if (!row) return null;
  return {
    obligationId: row.obligation_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    resourceId: row.resource_id,
    runtimeResourceName: row.runtime_resource_name,
    correlationId: row.correlation_id,
    status: row.status,
    attempts: Number(row.attempts ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createRuntimeCleanupRepository(pool) {
  return {
    async deferFunctionDeletion({ tenantId, workspaceId, resourceId, runtimeResourceName, correlationId }) {
      const { rows } = await pool.query(
        `WITH target AS (
           UPDATE fn_actions
              SET lifecycle_status='deletion_pending',
                  deletion_requested_at=COALESCE(deletion_requested_at, NOW()),
                  updated_at=NOW()
            WHERE tenant_id=$1 AND workspace_id=$2 AND resource_id=$3
            RETURNING tenant_id, workspace_id, resource_id
         )
         INSERT INTO runtime_cleanup_obligations
           (obligation_id, resource_type, operation, tenant_id, workspace_id, resource_id,
            runtime_resource_name, correlation_id, status)
         SELECT 'function:' || tenant_id || ':' || resource_id || ':delete',
                'function', 'delete', tenant_id, workspace_id, resource_id, $4, $5, 'pending'
           FROM target
         ON CONFLICT (resource_type, tenant_id, resource_id, operation) DO UPDATE
           SET updated_at=runtime_cleanup_obligations.updated_at
         RETURNING *`,
        [tenantId, workspaceId, resourceId, runtimeResourceName, correlationId],
      );
      if (!rows[0]) throw Object.assign(new Error('Function no longer exists'), { code: 'ACTION_NOT_FOUND' });
      return rowOut(rows[0]);
    },

    async claimPendingFunctions(limit = BATCH_LIMIT) {
      const boundedLimit = Math.max(1, Math.min(Number(limit) || BATCH_LIMIT, BATCH_LIMIT));
      const { rows } = await pool.query(
        `WITH candidates AS (
           SELECT obligation_id
             FROM runtime_cleanup_obligations
            WHERE resource_type='function' AND operation='delete'
              AND (status='pending'
                OR (status='processing' AND updated_at < NOW() - INTERVAL '2 minutes'))
            ORDER BY created_at, obligation_id
            FOR UPDATE SKIP LOCKED
            LIMIT $1
         )
         UPDATE runtime_cleanup_obligations AS obligation
            SET status='processing', attempts=attempts+1, updated_at=NOW()
           FROM candidates
          WHERE obligation.obligation_id=candidates.obligation_id
         RETURNING obligation.*`,
        [boundedLimit],
      );
      return rows.map(rowOut);
    },

    // The MCP engine updates its JSON state and calls this method with the SAME PostgreSQL client
    // held by mcp-pg-store.withStateTransaction(). That makes `deletion_pending` plus the durable
    // obligation one commit; a retry preserves the original correlation id.
    async deferMcpDeletion({ tenantId, workspaceId, resourceId, runtimeResourceName, correlationId }, queryable = pool) {
      const { rows } = await queryable.query(
        `INSERT INTO runtime_cleanup_obligations
           (obligation_id, resource_type, operation, tenant_id, workspace_id, resource_id,
            runtime_resource_name, correlation_id, status)
         VALUES ('mcp:' || $1 || ':' || $3 || ':delete', 'mcp', 'delete', $1, $2, $3, $4, $5, 'pending')
         ON CONFLICT (resource_type, tenant_id, resource_id, operation) DO UPDATE
           SET updated_at=runtime_cleanup_obligations.updated_at
         RETURNING *`,
        [tenantId, workspaceId, resourceId, runtimeResourceName, correlationId],
      );
      return rowOut(rows[0]);
    },

    async claimPendingMcps(limit = BATCH_LIMIT) {
      const boundedLimit = Math.max(1, Math.min(Number(limit) || BATCH_LIMIT, BATCH_LIMIT));
      const { rows } = await pool.query(
        `WITH candidates AS (
           SELECT obligation_id
             FROM runtime_cleanup_obligations
            WHERE resource_type='mcp' AND operation='delete'
              AND (status='pending'
                OR (status='processing' AND updated_at < NOW() - INTERVAL '2 minutes'))
            ORDER BY created_at, obligation_id
            FOR UPDATE SKIP LOCKED
            LIMIT $1
         )
         UPDATE runtime_cleanup_obligations AS obligation
            SET status='processing', attempts=attempts+1, updated_at=NOW()
           FROM candidates
          WHERE obligation.obligation_id=candidates.obligation_id
         RETURNING obligation.*`,
        [boundedLimit],
      );
      return rows.map(rowOut);
    },

    async completeMcpDeletion({ obligationId, tenantId, resourceId }, queryable = pool) {
      const { rows } = await queryable.query(
        `UPDATE runtime_cleanup_obligations
            SET status='completed', completed_at=COALESCE(completed_at, NOW()),
                last_error_code=NULL, updated_at=NOW()
          WHERE obligation_id=$1 AND tenant_id=$2 AND resource_id=$3
            AND resource_type='mcp' AND operation='delete'
         RETURNING *`,
        [obligationId, tenantId, resourceId],
      );
      return rowOut(rows[0]);
    },

    async completeFunctionDeletion({ obligationId, tenantId, resourceId }) {
      const { rows } = await pool.query(
        `WITH target AS (
           SELECT obligation_id, tenant_id, workspace_id, resource_id
             FROM runtime_cleanup_obligations
            WHERE obligation_id=$1 AND tenant_id=$2 AND resource_id=$3
              AND resource_type='function' AND operation='delete'
         ), deleted_activations AS (
           DELETE FROM fn_activations
            WHERE resource_id IN (SELECT resource_id FROM target)
              AND workspace_id IN (SELECT workspace_id FROM target)
         ), deleted_versions AS (
           DELETE FROM fn_action_versions
            WHERE resource_id IN (SELECT resource_id FROM target)
              AND tenant_id IN (SELECT tenant_id FROM target)
         ), deleted_action AS (
           DELETE FROM fn_actions
            WHERE resource_id IN (SELECT resource_id FROM target)
              AND tenant_id IN (SELECT tenant_id FROM target)
         )
         UPDATE runtime_cleanup_obligations AS obligation
            SET status='completed', completed_at=COALESCE(completed_at, NOW()),
                last_error_code=NULL, updated_at=NOW()
           FROM target
          WHERE obligation.obligation_id=target.obligation_id
         RETURNING obligation.*`,
        [obligationId, tenantId, resourceId],
      );
      return rowOut(rows[0]);
    },

    async releaseForRetry({ obligationId, tenantId, errorCode = 'CLEANUP_RETRY_REQUIRED' }) {
      const boundedCode = /^[A-Z][A-Z0-9_]{0,63}$/.test(errorCode) ? errorCode : 'CLEANUP_RETRY_REQUIRED';
      const { rows } = await pool.query(
        `UPDATE runtime_cleanup_obligations
            SET status='pending', last_error_code=$3, updated_at=NOW()
          WHERE obligation_id=$1 AND tenant_id=$2 AND status='processing'
         RETURNING *`,
        [obligationId, tenantId, boundedCode],
      );
      return rowOut(rows[0]);
    },
  };
}

export async function recoverFunctionCleanupObligations({
  runtime,
  repository,
  deleteRuntimeResource,
  batchSize = BATCH_LIMIT,
  onRecovered = async () => {},
  onFailed = async () => {},
}) {
  const initialStatus = typeof runtime.status === 'function' ? runtime.status() : null;
  if (!runtime.canServeWorkloads(initialStatus)) {
    return { skipped: 'knative_unavailable', recovered: 0, failed: 0 };
  }
  const obligations = await repository.claimPendingFunctions(batchSize);
  let recovered = 0;
  let failed = 0;
  for (const obligation of obligations) {
    try {
      const currentStatus = typeof runtime.status === 'function' ? runtime.status() : null;
      if (!runtime.canServeWorkloads(currentStatus)) {
        await repository.releaseForRetry({
          obligationId: obligation.obligationId,
          tenantId: obligation.tenantId,
          errorCode: 'KNATIVE_UNAVAILABLE',
        });
        failed += 1;
        await onFailed(obligation);
        continue;
      }
      if (obligation.runtimeResourceName) {
        await deleteRuntimeResource(obligation.runtimeResourceName);
      }
      await repository.completeFunctionDeletion({
        obligationId: obligation.obligationId,
        tenantId: obligation.tenantId,
        resourceId: obligation.resourceId,
      });
      recovered += 1;
      try { await onRecovered(obligation); } catch { /* observability cannot undo completed cleanup */ }
    } catch {
      failed += 1;
      await repository.releaseForRetry({
        obligationId: obligation.obligationId,
        tenantId: obligation.tenantId,
        errorCode: 'RUNTIME_DELETE_FAILED',
      });
      try { await onFailed(obligation); } catch { /* keep the durable retry even if audit is down */ }
    }
  }
  return { recovered, failed };
}

export async function recoverMcpCleanupObligations({
  runtime,
  repository,
  deleteOwnedRuntimeResources,
  completeDeferredDeletion,
  batchSize = BATCH_LIMIT,
  onRecovered = async () => {},
  onFailed = async () => {},
}) {
  const initialStatus = typeof runtime.status === 'function' ? runtime.status() : null;
  if (!runtime.canServeWorkloads(initialStatus)) {
    return { skipped: 'knative_unavailable', recovered: 0, failed: 0 };
  }
  const obligations = await repository.claimPendingMcps(batchSize);
  let recovered = 0;
  let failed = 0;
  for (const obligation of obligations) {
    try {
      const currentStatus = typeof runtime.status === 'function' ? runtime.status() : null;
      if (!runtime.canServeWorkloads(currentStatus)) {
        await repository.releaseForRetry({
          obligationId: obligation.obligationId,
          tenantId: obligation.tenantId,
          errorCode: 'KNATIVE_UNAVAILABLE',
        });
        failed += 1;
        await onFailed(obligation);
        continue;
      }
      // Runtime deletion is label-scoped and idempotent. Only after it succeeds do we atomically
      // remove logical MCP state and complete the obligation in the engine/store transaction.
      await deleteOwnedRuntimeResources(obligation);
      await completeDeferredDeletion(obligation);
      recovered += 1;
      try { await onRecovered(obligation); } catch { /* completed cleanup remains authoritative */ }
    } catch {
      failed += 1;
      await repository.releaseForRetry({
        obligationId: obligation.obligationId,
        tenantId: obligation.tenantId,
        errorCode: 'RUNTIME_DELETE_FAILED',
      });
      try { await onFailed(obligation); } catch { /* preserve the durable retry */ }
    }
  }
  return { recovered, failed };
}
