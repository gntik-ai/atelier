export async function setup(pgClient, tenantId = 'tenant-test-1') {
  await pgClient.query('CREATE TABLE IF NOT EXISTS tenants (id VARCHAR(255) PRIMARY KEY, tenant_id VARCHAR(255) UNIQUE)');
  await pgClient.query('INSERT INTO tenants (id, tenant_id) VALUES ($1, $1) ON CONFLICT (id) DO NOTHING', [tenantId]);
  return { tenantId };
}

export async function teardown(pgClient, tenantId = 'tenant-test-1') {
  await pgClient.query('DELETE FROM tenant_plan_assignments WHERE tenant_id = $1', [tenantId]);
  await pgClient.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
}
