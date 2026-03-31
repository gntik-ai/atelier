import { getFixturePlanPayloads } from '../helpers/plan-api-client.mjs';
import { createResource, listResources } from '../helpers/resource-api-client.mjs';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function payloadFor(dimensionKey, tenantId, index) {
  return {
    name: `${dimensionKey}-${tenantId}-${index + 1}`,
    key: `${dimensionKey}-${tenantId}-${index + 1}`,
    tenantId,
    sizeBytes: 1024,
    description: 'E2E fixture resource'
  };
}

async function retry(operation, attempts = 3, delayMs = 500) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(delayMs * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

export async function seedResourcesToCount(tenantId, dimensionKey, count, token) {
  const existing = await listResources(dimensionKey, tenantId, token);
  const items = existing.items ?? [];
  const createdIds = [];
  for (let index = items.length; index < count; index += 1) {
    const result = await retry(() => createResource(dimensionKey, tenantId, token, payloadFor(dimensionKey, tenantId, index)));
    if (result.status >= 400) throw new Error(`Failed to create ${dimensionKey} fixture ${index + 1}: ${JSON.stringify(result.body)}`);
    createdIds.push(result.body?.id ?? result.body?.resourceId ?? result.body?.key ?? result.body?.name ?? `${dimensionKey}-${index + 1}`);
  }
  return createdIds;
}

export async function seedResourcesForPlan(tenantId, planSlug, token) {
  const fixtures = getFixturePlanPayloads();
  const plan = planSlug === 'test-professional' ? fixtures.professional : fixtures.starter;
  const seeded = new Map();
  for (const [dimensionKey, limit] of Object.entries(plan.quota_dimensions)) {
    if (dimensionKey === 'max_storage_bytes') continue;
    seeded.set(dimensionKey, await seedResourcesToCount(tenantId, dimensionKey, limit, token));
  }
  return seeded;
}

export async function seedResourcesToFraction(tenantId, planSlug, fraction, token) {
  const fixtures = getFixturePlanPayloads();
  const plan = planSlug === 'test-professional' ? fixtures.professional : fixtures.starter;
  const seeded = new Map();
  for (const [dimensionKey, limit] of Object.entries(plan.quota_dimensions)) {
    if (dimensionKey === 'max_storage_bytes') continue;
    seeded.set(dimensionKey, await seedResourcesToCount(tenantId, dimensionKey, Math.floor(limit * fraction), token));
  }
  return seeded;
}
