import { deletePlan, deleteTenant } from '../helpers/plan-api-client.mjs';
import { listResources, deleteResource } from '../helpers/resource-api-client.mjs';
import { getFixturePlanSlugs } from './seed-plans.mjs';

const DIMENSIONS = ['max_workspaces', 'max_postgres_databases', 'max_mongo_databases', 'max_kafka_topics', 'max_functions', 'max_storage_bytes', 'max_api_keys', 'max_members'];

export async function teardownTenant(tenantId, token) {
  for (const dimensionKey of DIMENSIONS) {
    try {
      const listed = await listResources(dimensionKey, tenantId, token);
      for (const item of listed.items ?? []) {
        const removed = await deleteResource(dimensionKey, tenantId, token, item);
        if (![200, 202, 204, 404].includes(removed.status)) console.warn(`warning: failed to delete ${dimensionKey} resource for ${tenantId}`, removed.body);
      }
    } catch (error) {
      console.warn(`warning: unable to list/delete ${dimensionKey} resources for ${tenantId}`, error.message);
    }
  }
  const deleted = await deleteTenant(tenantId, token);
  if (![200, 202, 204, 404, 501].includes(deleted.status)) console.warn(`warning: failed to delete tenant ${tenantId}`, deleted.body);
  return deleted;
}

export async function teardownFixturePlans(token) {
  const { starter, professional } = getFixturePlanSlugs();
  for (const slug of [starter, professional]) {
    const removed = await deletePlan(slug, token);
    if (![200, 202, 204, 404].includes(removed.status)) console.warn(`warning: failed to delete fixture plan ${slug}`, removed.body);
  }
}

export async function teardownAll(tenantIds = [], token) {
  for (const tenantId of tenantIds) await teardownTenant(tenantId, token);
  await teardownFixturePlans(token);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const token = process.env.TEST_SUPERADMIN_TOKEN;
  const tenantIds = process.argv.slice(2);
  await teardownAll(tenantIds, token);
}
