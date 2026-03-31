import { requireE2E, provisionTenant, runSuffix, token, fixtures, assignPlan, seedResourcesForPlan, snapshotAllResources, getEffectiveEntitlements, assertResourcesUnchanged, countPerDimension, assertOverLimitDimension, assertCapabilityState, teardownTenant, assert } from './_shared.mjs';

requireE2E('S2 downgrade surfaces over-limit conditions without data loss', async () => {
  const tenantId = await provisionTenant(`test-tenant-downgrade-${runSuffix()}`);
  try {
    const assigned = await assignPlan(tenantId, fixtures.professional.slug, token);
    assert.ok([200, 202].includes(assigned.status), `Unexpected assign status ${assigned.status}`);
    await seedResourcesForPlan(tenantId, fixtures.professional.slug, token);
    const before = await snapshotAllResources(tenantId, token);
    const response = await assignPlan(tenantId, fixtures.starter.slug, token);
    assert.ok([200, 202].includes(response.status), `Unexpected downgrade status ${response.status}`);
    const after = await snapshotAllResources(tenantId, token);
    assertResourcesUnchanged(before, after);
    assert.deepEqual(Object.fromEntries(countPerDimension(after)), Object.fromEntries(countPerDimension(before)));
    const entitlements = await getEffectiveEntitlements(tenantId, token);
    assert.equal(entitlements.status, 200);
    for (const [dimensionKey, proLimit] of Object.entries(fixtures.professional.quota_dimensions)) {
      const starterLimit = fixtures.starter.quota_dimensions[dimensionKey];
      if (dimensionKey === 'max_storage_bytes') continue;
      if (proLimit > starterLimit) assertOverLimitDimension(entitlements.body, dimensionKey, proLimit, starterLimit);
    }
    assertCapabilityState(entitlements.body, 'realtime_enabled', false);
    assertCapabilityState(entitlements.body, 'custom_domains_enabled', false);
    assertCapabilityState(entitlements.body, 'audit_log_export_enabled', false);
  } finally {
    await teardownTenant(tenantId, token);
  }
});
