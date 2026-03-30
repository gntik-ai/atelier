import { validateRotationState } from '../models/credential-rotation-state.mjs';
import { validateRotationHistoryRecord } from '../models/credential-rotation-history.mjs';

function mapRow(row) { return row ? { ...row } : null; }

export async function createRotationState(client, record) {
  const input = validateRotationState(record);
  const result = await client.query(
    `INSERT INTO service_account_rotation_states (
      id, tenant_id, workspace_id, service_account_id, new_credential_id, old_credential_id,
      rotation_type, grace_period_seconds, deprecated_expires_at, initiated_at, initiated_by,
      state, completed_at, completed_by, rotation_lock_version
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [input.id, input.tenant_id, input.workspace_id, input.service_account_id, input.new_credential_id, input.old_credential_id, input.rotation_type, input.grace_period_seconds, input.deprecated_expires_at, input.initiated_at, input.initiated_by, input.state, input.completed_at, input.completed_by, input.rotation_lock_version]
  );
  return mapRow(result.rows[0]);
}

export async function writeRotationHistory(client, record) {
  const input = validateRotationHistoryRecord(record);
  const result = await client.query(
    `INSERT INTO service_account_rotation_history (
      id, tenant_id, workspace_id, service_account_id, rotation_state_id, rotation_type,
      grace_period_seconds, old_credential_id, new_credential_id, initiated_by,
      initiated_at, completed_at, completed_by, completion_reason
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [input.id, input.tenant_id, input.workspace_id, input.service_account_id, input.rotation_state_id, input.rotation_type, input.grace_period_seconds, input.old_credential_id, input.new_credential_id, input.initiated_by, input.initiated_at, input.completed_at, input.completed_by, input.completion_reason]
  );
  return mapRow(result.rows[0]);
}

export async function getInProgressRotation(client, serviceAccountId) {
  const result = await client.query(
    `SELECT * FROM service_account_rotation_states WHERE service_account_id = $1 AND state = 'in_progress' ORDER BY initiated_at DESC LIMIT 1`,
    [serviceAccountId]
  );
  return mapRow(result.rows[0] ?? null);
}

export async function listExpiredRotations(client, batchSize = 100) {
  const result = await client.query(
    `SELECT * FROM service_account_rotation_states WHERE state = 'in_progress' AND deprecated_expires_at IS NOT NULL AND deprecated_expires_at <= NOW() ORDER BY deprecated_expires_at ASC LIMIT $1`,
    [batchSize]
  );
  return result.rows.map(mapRow);
}

export async function completeRotation(client, { id, completedBy, completionReason }) {
  const state = completionReason === 'force_completed' ? 'force_completed' : completionReason === 'expired' ? 'expired' : 'completed';
  const result = await client.query(
    `UPDATE service_account_rotation_states SET state = $2, completed_at = NOW(), completed_by = $3 WHERE id = $1 RETURNING *`,
    [id, state, completedBy]
  );
  return mapRow(result.rows[0] ?? null);
}

export async function listRotationHistory(client, { serviceAccountId, limit = 20, offset = 0 }) {
  const result = await client.query(
    `SELECT * FROM service_account_rotation_history WHERE service_account_id = $1 ORDER BY initiated_at DESC LIMIT $2 OFFSET $3`,
    [serviceAccountId, limit, offset]
  );
  return result.rows.map(mapRow);
}

export async function countActiveCredentials(client, serviceAccountId) {
  const result = await client.query(
    `SELECT COUNT(*)::int AS total FROM service_account_rotation_states WHERE service_account_id = $1 AND state IN ('in_progress','completed')`,
    [serviceAccountId]
  );
  return result.rows[0]?.total ?? 0;
}
