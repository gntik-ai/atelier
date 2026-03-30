function hasRequiredRole(auth = {}, domain, tenantId) {
  const roles = auth.roles ?? [];
  if (roles.includes('superadmin') || roles.includes('platform-operator')) {
    return true;
  }
  if (domain === 'tenant' && roles.includes('tenant-operator')) {
    return !auth.tenantId || !tenantId || auth.tenantId === tenantId;
  }
  return false;
}

function ensureNoSecretMaterial(record) {
  const forbidden = ['value', 'data'];
  for (const key of Object.keys(record)) {
    if (forbidden.includes(key)) {
      throw new Error('Secret material exposure is forbidden');
    }
  }
}

export async function secretInventory(params = {}, { query = async () => ({ rows: [] }) } = {}) {
  const { auth = {}, domain, tenantId = null, offset = 0, limit = 50 } = params;
  if (!domain) {
    return { statusCode: 400, body: { error: 'domain is required' } };
  }
  if (!hasRequiredRole(auth, domain, tenantId)) {
    return { statusCode: 403, body: { error: 'forbidden' } };
  }

  const result = await query(
    `SELECT secret_name AS name, domain, secret_path AS path, created_at AS "createdAt", updated_at AS "updatedAt", status, secret_type AS "secretType"
       FROM secret_metadata
      WHERE domain = $1
        AND ($2::uuid IS NULL OR tenant_id = $2::uuid)
      ORDER BY updated_at DESC
      OFFSET $3 LIMIT $4`,
    [domain, tenantId, offset, limit]
  );

  const secrets = result.rows.map((row) => {
    ensureNoSecretMaterial(row);
    return row;
  });

  return { statusCode: 200, body: { secrets, offset, limit } };
}

export default secretInventory;
