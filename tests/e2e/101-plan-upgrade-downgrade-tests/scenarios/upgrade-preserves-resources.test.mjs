import { requireE2E, provisionTenant, runSuffix, token, fixtures, assignPlan, seedResourcesForPlan, snapshotAllResources, getEffectiveEntitlements, assertAllDimensionsAccessible, assertCapabilityState, assertResourcesUnchanged, countPerDimension, teardownTenant, assert } from './_shared.mjs';

requireE2E('S1 upgrade preserves existing resources and unlocks higher limits', async () => {
  const tenantId = await provisionTenant(`test-tenant-upgrade-${runSuffix()}`);
  try {
    const assigned = await assignPlan(tenantId, fixtures.starter.slug, token);
    assert.ok([200, 202].includes(assigned.status), `Unexpected assign status ${assigned.status}`);
    await seedResourcesForPlan(tenantId, fixtures.starter.slug, token);
    const before = await snapshotAllResources(tenantId, token);
    const response = await assignPlan(tenantId, fixtures.professional.slug, token);
    assert.ok([200, 202].includes(response.status), `Unexpected upgrade status ${response.status}`);
    const entitlements = await getEffectiveEntitlements(tenantId, token);
    assert.equal(entitlements.status, 200);
    assertAllDimensionsAccessible(entitlements.body);
    for (const [dimensionKey, limit] of Object.entries(fixtures.professional.quota_dimensions)) {
      const entry = (entitlements.body.quotaDimensions ?? []).find((item) => item.dimensionKey === dimensionKey);
      if (!entry) continue;
      if (limit !== null && Number.isFinite(limit)) assert.ok((entry.effectiveValue ?? 0) >= limit, `${dimensionKey} expected >= ${limit}`);
    }
    assertCapabilityState(entitlements.body, 'realtime_enabled', true);
    assertCapabilityState(entitlements.body, 'custom_domains_enabled', true);
    assertCapabilityState(entitlements.body, 'audit_log_export_enabled', true);
    const after = await snapshotAllResources(tenantId, token);
    assertResourcesUnchanged(before, after);
    assert.deepEqual(Object.fromEntries(countPerDimension(after)), Object.fromEntries(countPerDimension(before)));
  } finally {
    await teardownTenant(tenantId, token);
  }
});
