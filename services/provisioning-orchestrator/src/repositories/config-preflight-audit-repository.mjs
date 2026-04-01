/**
 * Data access for `config_preflight_audit_log` table.
 * @module repositories/config-preflight-audit-repository
 */

const ALLOWED_ACTOR_TYPES = new Set(['superadmin', 'sre', 'service_account']);

/**
 * Inserts a row into `config_preflight_audit_log`.
 *
 * @param {import('pg').PoolClient | import('pg').Pool} pgClient
 * @param {Object} record
 * @returns {Promise<{id: string}>}
 */
export async function insertPreflightAuditLog(pgClient, record) {
  if (!record.tenant_id) throw new Error('tenant_id is required');
  if (!record.source_tenant_id) throw new Error('source_tenant_id is required');
  if (!record.actor_id) throw new Error('actor_id is required');
  if (!record.actor_type || !ALLOWED_ACTOR_TYPES.has(record.actor_type)) {
    throw new Error(`actor_type must be one of: ${[...ALLOWED_ACTOR_TYPES].join(', ')}`);
  }
  if (!record.correlation_id) throw new Error('correlation_id is required');
  if (!record.format_version) throw new Error('format_version is required');
  if (!record.risk_level) throw new Error('risk_level is required');

  const sql = `
    INSERT INTO config_preflight_audit_log (
      tenant_id, source_tenant_id, actor_id, actor_type,
      domains_requested, domains_analyzed, domains_skipped,
      risk_level,
      conflict_count_low, conflict_count_medium, conflict_count_high, conflict_count_critical,
      compatible_count, compatible_with_redacted_count, total_resources_analyzed,
      incomplete_analysis, identifier_map_provided, identifier_map_hash,
      artifact_checksum, format_version, correlation_id, executed_at
    ) VALUES (
      $1, $2, $3, $4,
      $5, $6, $7,
      $8,
      $9, $10, $11, $12,
      $13, $14, $15,
      $16, $17, $18,
      $19, $20, $21, $22
    )
    RETURNING id
  `;

  const values = [
    record.tenant_id,
    record.source_tenant_id,
    record.actor_id,
    record.actor_type,
    record.domains_requested ?? [],
    record.domains_analyzed ?? [],
    record.domains_skipped ?? [],
    record.risk_level,
    record.conflict_count_low ?? 0,
    record.conflict_count_medium ?? 0,
    record.conflict_count_high ?? 0,
    record.conflict_count_critical ?? 0,
    record.compatible_count ?? 0,
    record.compatible_with_redacted_count ?? 0,
    record.total_resources_analyzed ?? 0,
    record.incomplete_analysis ?? false,
    record.identifier_map_provided ?? false,
    record.identifier_map_hash ?? null,
    record.artifact_checksum ?? null,
    record.format_version,
    record.correlation_id,
    record.executed_at ?? new Date().toISOString(),
  ];

  const result = await pgClient.query(sql, values);
  return { id: result.rows[0].id };
}

/**
 * Retrieve a preflight audit record by correlation_id.
 *
 * @param {import('pg').PoolClient | import('pg').Pool} pgClient
 * @param {string} correlationId
 * @returns {Promise<Object | null>}
 */
export async function getPreflightAuditByCorrelationId(pgClient, correlationId) {
  const result = await pgClient.query(
    'SELECT * FROM config_preflight_audit_log WHERE correlation_id = $1',
    [correlationId],
  );
  return result.rows[0] ?? null;
}
