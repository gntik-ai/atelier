import assert from 'node:assert/strict';
import { getPlanChangeHistory } from './plan-api-client.mjs';

function timeoutMs(input) {
  return Number(input ?? process.env.PLAN_CHANGE_AUDIT_POLL_TIMEOUT_MS ?? 30000);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function pollForHistoryEntry(tenantId, expectedSourcePlan, expectedTargetPlan, token, customTimeoutMs) {
  const deadline = Date.now() + timeoutMs(customTimeoutMs);
  let lastResponse = null;
  while (Date.now() < deadline) {
    lastResponse = await getPlanChangeHistory(tenantId, token, { page: 1, pageSize: 20 });
    const items = lastResponse.body?.items ?? [];
    const match = items.find((entry) => {
      const source = entry.sourcePlanSlug ?? entry.previousPlanSlug ?? entry.previousPlanId ?? null;
      const target = entry.targetPlanSlug ?? entry.newPlanSlug ?? entry.newPlanId ?? null;
      return String(source ?? '').includes(expectedSourcePlan) && String(target ?? '').includes(expectedTargetPlan);
    });
    if (match) return match;
    await sleep(2000);
  }
  throw new Error(`Timed out waiting for history entry ${expectedSourcePlan} -> ${expectedTargetPlan}; lastResponse=${JSON.stringify(lastResponse?.body ?? null)}`);
}

export function assertHistoryEntry(entry, expectations = {}) {
  assert.ok(entry?.historyEntryId, 'historyEntryId is required');
  if (expectations.changeDirection) assert.equal(entry.changeDirection, expectations.changeDirection);
  if (expectations.overLimitDimensionCount !== undefined) assert.equal(entry.overLimitDimensionCount, expectations.overLimitDimensionCount);
  for (const expected of expectations.overLimitDimensions ?? []) {
    const impact = (entry.quotaImpacts ?? []).find((item) => item.dimensionKey === expected.dimensionKey);
    assert.ok(impact, `Expected impact for ${expected.dimensionKey}`);
    assert.equal(impact.usageStatus, 'over_limit');
    assert.equal(impact.observedUsage, expected.observedUsage);
    assert.equal(impact.newEffectiveValue, expected.newEffectiveValue);
  }
  return true;
}

export async function assertHistoryEntryCount(tenantId, expectedCount, token) {
  const response = await getPlanChangeHistory(tenantId, token, { page: 1, pageSize: 100 });
  assert.equal(response.body?.total ?? response.body?.items?.length ?? 0, expectedCount);
  return true;
}
