import { requireE2E, provisionTenant, runSuffix, token, fixtures, assignPlan, seedResourcesForPlan, teardownTenant, pollForHistoryEntry, assertHistoryEntry, assertHistoryEntryCount, assert } from './_shared.mjs';

requireE2E('S3 audit trail captures full transition context', async () => {
  const tenantId = await provisionTenant(`test-tenant-audit-${runSuffix()}`);
  try {
    let response = await assignPlan(tenantId, fixtures.starter.slug, token);
    assert.ok([200, 202].includes(response.status));
    await seedResourcesForPlan(tenantId, fixtures.starter.slug, token);

    response = await assignPlan(tenantId, fixtures.professional.slug, token);
    assert.ok([200, 202].includes(response.status));
    const upgradeEntry = await pollForHistoryEntry(tenantId, 'test-starter', 'test-professional', token);
    assertHistoryEntry(upgradeEntry, { changeDirection: 'upgrade', overLimitDimensionCount: 0 });

    response = await assignPlan(tenantId, fixtures.starter.slug, token);
    assert.ok([200, 202].includes(response.status));
    const downgradeExpectations = Object.entries(fixtures.professional.quota_dimensions)
      .filter(([dimensionKey, professional]) => dimensionKey !== 'max_storage_bytes' && professional > fixtures.starter.quota_dimensions[dimensionKey])
      .map(([dimensionKey, professional]) => ({ dimensionKey, observedUsage: professional, newEffectiveValue: fixtures.starter.quota_dimensions[dimensionKey] }));
    const downgradeEntry = await pollForHistoryEntry(tenantId, 'test-professional', 'test-starter', token);
    assertHistoryEntry(downgradeEntry, {
      changeDirection: 'downgrade',
      overLimitDimensionCount: downgradeExpectations.length,
      overLimitDimensions: downgradeExpectations
    });
    await assertHistoryEntryCount(tenantId, 2, token);
    assert.equal(upgradeEntry.historyEntryId, (await pollForHistoryEntry(tenantId, 'test-starter', 'test-professional', token)).historyEntryId);
  } finally {
    await teardownTenant(tenantId, token);
  }
});
