import { seedTenantWithPlanAndResources } from './seed-tenant-with-plan-and-resources.mjs';

export function seedWorkspaceWithSubQuotas() {
  const db = seedTenantWithPlanAndResources();
  db._workspaceSubQuotas.push(
    { id: 'sq-1', tenantId: 'pro-corp', workspaceId: 'ws-prod', dimensionKey: 'max_pg_databases', allocatedValue: 6, createdBy: 'seed', updatedBy: 'seed', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 'sq-2', tenantId: 'pro-corp', workspaceId: 'ws-dev', dimensionKey: 'max_pg_databases', allocatedValue: 5, createdBy: 'seed', updatedBy: 'seed', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
  );
  return db;
}
