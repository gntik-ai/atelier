import test from 'node:test';
import assert from 'node:assert/strict';
import { createTenant, assignPlan, getEffectiveEntitlements } from '../helpers/plan-api-client.mjs';
import { snapshotAllResources, assertResourcesUnchanged, countPerDimension } from '../helpers/resource-api-client.mjs';
import { assertAllDimensionsAccessible, assertCapabilityState, assertDimensionStatus, assertOverLimitDimension, assertResourceResponseUnchanged } from '../helpers/assertion-helpers.mjs';
import { seedResourcesForPlan, seedResourcesToCount, seedResourcesToFraction } from '../fixtures/seed-tenant-resources.mjs';
import { teardownTenant } from '../fixtures/teardown.mjs';
import { getFixturePlanPayloads } from '../helpers/plan-api-client.mjs';
import { pollForHistoryEntry, assertHistoryEntry, assertHistoryEntryCount } from '../helpers/audit-query-client.mjs';
import { buildUnavailableDimensionResponse, injectUnavailableDimension } from '../fixtures/mock-usage-unavailable.mjs';

export const fixtures = getFixturePlanPayloads();
export const token = process.env.TEST_SUPERADMIN_TOKEN;

export function runSuffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function requireE2E(testName, fn) {
  const missing = ['TEST_API_BASE_URL', 'TEST_SUPERADMIN_TOKEN'].filter((key) => !process.env[key]);
  if (missing.length) {
    test.skip(`${testName} (missing env: ${missing.join(', ')})`, () => {});
    return;
  }
  test(testName, fn);
}

export async function provisionTenant(name) {
  const created = await createTenant({ name, slug: name }, token);
  if (created.status >= 400) throw new Error(`Failed to create tenant ${name}: ${JSON.stringify(created.body)}`);
  return created.body?.tenantId ?? created.body?.id ?? created.body?.tenant?.id ?? name;
}

export {
  test,
  assert,
  createTenant,
  assignPlan,
  getEffectiveEntitlements,
  snapshotAllResources,
  assertResourcesUnchanged,
  countPerDimension,
  assertAllDimensionsAccessible,
  assertCapabilityState,
  assertDimensionStatus,
  assertOverLimitDimension,
  assertResourceResponseUnchanged,
  seedResourcesForPlan,
  seedResourcesToCount,
  seedResourcesToFraction,
  teardownTenant,
  pollForHistoryEntry,
  assertHistoryEntry,
  assertHistoryEntryCount,
  buildUnavailableDimensionResponse,
  injectUnavailableDimension
};
