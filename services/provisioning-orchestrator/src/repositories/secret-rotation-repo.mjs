import { ensureNoSecretMaterial } from '../models/secret-version-state.mjs';

async function queryOne(client, text, values = []) {
  const result = await client.query(text, values);
  return result.rows[0] ?? null;
}

export async function insertSecretVersion(client, record) {
  return queryOne(
    client,
    `INSERT INTO secret_version_states (
      secret_path, domain, tenant_id, secret_name, vault_version, state,
      grace_period_seconds, initiated_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    RETURNING *`,
    [record.secretPath, record.domain, record.tenantId ?? null, record.secretName, record.vaultVersion, record.state, record.gracePeriodSeconds ?? 0, record.initiatedBy]
  );
}

export async function getActiveVersion(client, secretPath) {
  return queryOne(client, `SELECT * FROM secret_version_states WHERE secret_path=$1 AND state='active' ORDER BY activated_at DESC LIMIT 1`, [secretPath]);
}

export async function getGraceVersion(client, secretPath) {
  return queryOne(client, `SELECT * FROM secret_version_states WHERE secret_path=$1 AND state='grace' ORDER BY activated_at ASC LIMIT 1`, [secretPath]);
}

export async function getVersionByVaultVersion(client, { secretPath, vaultVersion }) {
  return queryOne(client, `SELECT * FROM secret_version_states WHERE secret_path=$1 AND vault_version=$2 LIMIT 1`, [secretPath, vaultVersion]);
}

export async function transitionToGrace(client, { secretPath, gracePeriodSeconds }) {
  return queryOne(
    client,
    `UPDATE secret_version_states
     SET state='grace', grace_period_seconds=$2, grace_expires_at=NOW() + ($2 * INTERVAL '1 second')
     WHERE id = (
      SELECT id FROM secret_version_states WHERE secret_path=$1 AND state='active' ORDER BY activated_at DESC LIMIT 1
     )
     RETURNING *`,
    [secretPath, gracePeriodSeconds]
  );
}

export async function updateSecretVersionVaultVersion(client, { id, vaultVersion }) {
  return queryOne(client, `UPDATE secret_version_states SET vault_version=$2 WHERE id=$1 RETURNING *`, [id, vaultVersion]);
}

export async function revokeVersion(client, { id, justification }) {
  return queryOne(client, `UPDATE secret_version_states SET state='revoked', expired_at=NOW(), revocation_justification=$2 WHERE id=$1 RETURNING *`, [id, justification]);
}

export async function listExpiredGraceVersions(client, batchSize) {
  const result = await client.query(
    `SELECT * FROM secret_version_states WHERE state='grace' AND grace_expires_at <= NOW() ORDER BY grace_expires_at ASC LIMIT $1 FOR UPDATE SKIP LOCKED`,
    [batchSize]
  );
  return result.rows;
}

export async function expireGraceVersion(client, { id }) {
  return queryOne(client, `UPDATE secret_version_states SET state='expired', expired_at=NOW() WHERE id=$1 RETURNING *`, [id]);
}

export async function insertRotationEvent(client, record) {
  ensureNoSecretMaterial(record.detail ?? {});
  return queryOne(
    client,
    `INSERT INTO secret_rotation_events (
      secret_path, domain, tenant_id, event_type, vault_version_new, vault_version_old,
      grace_period_seconds, actor_id, actor_roles, detail
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    RETURNING *`,
    [record.secretPath, record.domain, record.tenantId ?? null, record.eventType, record.vaultVersionNew ?? null, record.vaultVersionOld ?? null, record.gracePeriodSeconds ?? null, record.actorId, record.actorRoles ?? [], JSON.stringify(record.detail ?? {})]
  );
}

export async function listRotationHistory(client, { secretPath, limit = 20, offset = 0 }) {
  const result = await client.query(
    `SELECT *, COUNT(*) OVER() AS __total FROM secret_rotation_events WHERE secret_path=$1 ORDER BY occurred_at DESC LIMIT $2 OFFSET $3`,
    [secretPath, limit, offset]
  );
  return { rows: result.rows, total: Number(result.rows[0]?.__total ?? 0) };
}

export async function upsertConsumer(client, record) {
  return queryOne(
    client,
    `INSERT INTO secret_consumer_registry (
      secret_path, consumer_id, consumer_namespace, eso_external_secret_name, reload_mechanism, registered_by
    ) VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (secret_path, consumer_id) DO UPDATE SET
      consumer_namespace=EXCLUDED.consumer_namespace,
      eso_external_secret_name=EXCLUDED.eso_external_secret_name,
      reload_mechanism=EXCLUDED.reload_mechanism,
      registered_by=EXCLUDED.registered_by
    RETURNING *`,
    [record.secretPath, record.consumerId, record.consumerNamespace, record.esoExternalSecretName ?? null, record.reloadMechanism, record.registeredBy]
  );
}

export async function listConsumers(client, secretPath) {
  const result = await client.query(`SELECT * FROM secret_consumer_registry WHERE secret_path=$1 ORDER BY consumer_id ASC`, [secretPath]);
  return result.rows;
}

export async function insertPropagationEvent(client, record) {
  return queryOne(
    client,
    `INSERT INTO secret_propagation_events (secret_path, vault_version, consumer_id, state) VALUES ($1,$2,$3,$4) RETURNING *`,
    [record.secretPath, record.vaultVersion, record.consumerId, record.state]
  );
}

export async function confirmPropagation(client, { secretPath, vaultVersion, consumerId }) {
  const updated = await queryOne(client, `UPDATE secret_propagation_events SET state='confirmed', confirmed_at=NOW() WHERE secret_path=$1 AND vault_version=$2 AND consumer_id=$3 AND state='pending' RETURNING *`, [secretPath, vaultVersion, consumerId]);
  if (updated) return updated;
  return queryOne(client, `SELECT * FROM secret_propagation_events WHERE secret_path=$1 AND vault_version=$2 AND consumer_id=$3 ORDER BY requested_at DESC LIMIT 1`, [secretPath, vaultVersion, consumerId]);
}

export async function listPendingPropagations(client, { secretPath, vaultVersion }) {
  const result = await client.query(`SELECT * FROM secret_propagation_events WHERE secret_path=$1 AND vault_version=$2 AND state='pending' ORDER BY requested_at ASC`, [secretPath, vaultVersion]);
  return result.rows;
}

export async function listTimedOutPropagations(client, { timeoutThreshold, batchSize }) {
  const result = await client.query(`SELECT * FROM secret_propagation_events WHERE state='pending' AND requested_at < $1 ORDER BY requested_at ASC LIMIT $2 FOR UPDATE SKIP LOCKED`, [timeoutThreshold, batchSize]);
  return result.rows;
}

export async function markPropagationTimeout(client, { id }) {
  return queryOne(client, `UPDATE secret_propagation_events SET state='timeout', timeout_at=NOW() WHERE id=$1 RETURNING *`, [id]);
}
