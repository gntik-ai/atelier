import { validateTenantRotationPolicy } from '../models/tenant-rotation-policy.mjs';

function mapRow(row) { return row ? { ...row } : null; }

export async function getTenantRotationPolicy(client, tenantId) {
  const result = await client.query('SELECT * FROM tenant_rotation_policies WHERE tenant_id = $1', [tenantId]);
  return mapRow(result.rows[0] ?? null);
}

export async function upsertTenantRotationPolicy(client, policy) {
  const input = validateTenantRotationPolicy(policy);
  const result = await client.query(
    `INSERT INTO tenant_rotation_policies (tenant_id, max_credential_age_days, max_grace_period_seconds, warn_before_expiry_days, updated_at, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (tenant_id) DO UPDATE SET
       max_credential_age_days = EXCLUDED.max_credential_age_days,
       max_grace_period_seconds = EXCLUDED.max_grace_period_seconds,
       warn_before_expiry_days = EXCLUDED.warn_before_expiry_days,
       updated_at = EXCLUDED.updated_at,
       updated_by = EXCLUDED.updated_by
     RETURNING *`,
    [input.tenant_id, input.max_credential_age_days, input.max_grace_period_seconds, input.warn_before_expiry_days, input.updated_at, input.updated_by]
  );
  return mapRow(result.rows[0]);
}
