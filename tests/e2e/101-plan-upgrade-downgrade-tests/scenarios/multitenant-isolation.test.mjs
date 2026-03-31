import { requireE2E, provisionTenant, runSuffix, token, fixtures, assignPlan, seedResourcesToFraction, getEffectiveEntitlements, snapshotAllResources, assertResourceResponseUnchanged, assertResourcesUnchanged, assertHistoryEntryCount, teardownTenant, assert } from './_shared.mjs';

requireE2E('S4 multi-tenant isolation is preserved across plan changes', async () => {
  const alpha = await provisionTenant(`test-tenant-alpha-${runSuffix()}`);
  const beta = await provisionTenant(`test-tenant-beta-${runSuffix()}`);
  try {
    assert.ok([200, 202].includes((await assignPlan(alpha, fixtures.professional.slug, token)).status));
    assert.ok([200, 202].includes((await assignPlan(beta, fixtures.starter.slug, token)).status));
    await seedResourcesToFraction(alpha, fixtures.professional.slug, 0.5, token);
    await seedResourcesToFraction(beta, fixtures.starter.slug, 0.5, token);
    const betaEntitlementsBefore = await getEffectiveEntitlements(beta, token);
    const betaResourcesBefore = await snapshotAllResources(beta, token);
    await assertHistoryEntryCount(beta, 1, token);

    const response = await assignPlan(alpha, fixtures.starter.slug, token);
    assert.ok([200, 202].includes(response.status));

    const betaEntitlementsAfter = await getEffectiveEntitlements(beta, token);
    assertResourceResponseUnchanged(betaEntitlementsBefore.body, betaEntitlementsAfter.body);
    const betaResourcesAfter = await snapshotAllResources(beta, token);
    assertResourcesUnchanged(betaResourcesBefore, betaResourcesAfter);
    await assertHistoryEntryCount(beta, 1, token);
  } finally {
    await teardownTenant(alpha, token);
    await teardownTenant(beta, token);
  }
});
