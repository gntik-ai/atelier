import { requireE2E, provisionTenant, runSuffix, token, fixtures, assignPlan, seedResourcesForPlan, seedResourcesToCount, snapshotAllResources, getEffectiveEntitlements, assertResourcesUnchanged, assertOverLimitDimension, assertHistoryEntryCount, pollForHistoryEntry, teardownTenant, assert } from './_shared.mjs';

requireE2E('S5 round-trip transition preserves resources and emits two history entries', async () => {
  const tenantId = await provisionTenant(`test-tenant-roundtrip-${runSuffix()}`);
  try {
    assert.ok([200, 202].includes((await assignPlan(tenantId, fixtures.starter.slug, token)).status));
    await seedResourcesForPlan(tenantId, fixtures.starter.slug, token);
    const phase1Snapshot = await snapshotAllResources(tenantId, token);

    assert.ok([200, 202].includes((await assignPlan(tenantId, fixtures.professional.slug, token)).status));
    for (const [dimensionKey, professionalLimit] of Object.entries(fixtures.professional.quota_dimensions)) {
      if (dimensionKey === 'max_storage_bytes') continue;
      await seedResourcesToCount(tenantId, dimensionKey, professionalLimit, token);
    }
    const phase2Snapshot = await snapshotAllResources(tenantId, token);

    assert.ok([200, 202].includes((await assignPlan(tenantId, fixtures.starter.slug, token)).status));
    const phase3Snapshot = await snapshotAllResources(tenantId, token);
    assertResourcesUnchanged(phase2Snapshot, phase3Snapshot);

    const entitlements = await getEffectiveEntitlements(tenantId, token);
    for (const [dimensionKey, starterLimit] of Object.entries(fixtures.starter.quota_dimensions)) {
      const entry = (entitlements.body.quotaDimensions ?? []).find((item) => item.dimensionKey === dimensionKey);
      if (!entry || dimensionKey === 'max_storage_bytes') continue;
      assert.equal(entry.effectiveValue, starterLimit);
    }
    for (const [dimensionKey, professionalLimit] of Object.entries(fixtures.professional.quota_dimensions)) {
      if (dimensionKey === 'max_storage_bytes') continue;
      if (professionalLimit > fixtures.starter.quota_dimensions[dimensionKey]) {
        assertOverLimitDimension(entitlements.body, dimensionKey, professionalLimit, fixtures.starter.quota_dimensions[dimensionKey]);
      }
    }
    for (const [dimensionKey, items] of phase1Snapshot.entries()) {
      const ids = new Set((phase3Snapshot.get(dimensionKey) ?? []).map((item) => item.id ?? item.resourceId ?? item.key ?? item.name));
      for (const item of items) assert.ok(ids.has(item.id ?? item.resourceId ?? item.key ?? item.name));
    }
    await assertHistoryEntryCount(tenantId, 2, token);
    await pollForHistoryEntry(tenantId, 'test-starter', 'test-professional', token);
    await pollForHistoryEntry(tenantId, 'test-professional', 'test-starter', token);
  } finally {
    await teardownTenant(tenantId, token);
  }
});
