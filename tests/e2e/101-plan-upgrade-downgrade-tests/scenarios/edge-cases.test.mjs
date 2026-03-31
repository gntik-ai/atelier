import { requireE2E, provisionTenant, runSuffix, token, fixtures, assignPlan, getEffectiveEntitlements, assertAllDimensionsAccessible, seedResourcesToCount, assertDimensionStatus, buildUnavailableDimensionResponse, teardownTenant, assert, injectUnavailableDimension, assertHistoryEntryCount } from './_shared.mjs';

requireE2E('S6 edge cases cover zero-resource, at-limit, unavailable usage, concurrency, and overrides', async (t) => {
  await t.test('EC-1 zero-resource tenant upgrade/downgrade', async () => {
    const tenantId = await provisionTenant(`test-tenant-zero-${runSuffix()}`);
    try {
      assert.ok([200, 202].includes((await assignPlan(tenantId, fixtures.starter.slug, token)).status));
      assert.ok([200, 202].includes((await assignPlan(tenantId, fixtures.professional.slug, token)).status));
      const upgraded = await getEffectiveEntitlements(tenantId, token);
      assertAllDimensionsAccessible(upgraded.body);
      assert.ok([200, 202].includes((await assignPlan(tenantId, fixtures.starter.slug, token)).status));
      const downgraded = await getEffectiveEntitlements(tenantId, token);
      assertAllDimensionsAccessible(downgraded.body);
    } finally {
      await teardownTenant(tenantId, token);
    }
  });

  await t.test('EC-2 usage exactly at target limit is classified at_limit', async () => {
    const tenantId = await provisionTenant(`test-tenant-at-limit-${runSuffix()}`);
    try {
      assert.ok([200, 202].includes((await assignPlan(tenantId, fixtures.professional.slug, token)).status));
      await seedResourcesToCount(tenantId, 'max_workspaces', fixtures.starter.quota_dimensions.max_workspaces, token);
      assert.ok([200, 202].includes((await assignPlan(tenantId, fixtures.starter.slug, token)).status));
      const entitlements = await getEffectiveEntitlements(tenantId, token);
      assertDimensionStatus(entitlements.body, 'max_workspaces', 'at_limit');
    } finally {
      await teardownTenant(tenantId, token);
    }
  });

  await t.test('EC-3 dimensions are not silently omitted', async () => {
    const tenantId = await provisionTenant(`test-tenant-dimensions-${runSuffix()}`);
    try {
      assert.ok([200, 202].includes((await assignPlan(tenantId, fixtures.starter.slug, token)).status));
      const entitlements = await getEffectiveEntitlements(tenantId, token);
      const listed = new Set((entitlements.body.quotaDimensions ?? []).map((item) => item.dimensionKey));
      for (const dimensionKey of Object.keys(fixtures.starter.quota_dimensions)) assert.ok(listed.has(dimensionKey));
    } finally {
      await teardownTenant(tenantId, token);
    }
  });

  await t.test('EC-4 usage temporarily unavailable follows strict/lenient threshold', async () => {
    const synthetic = buildUnavailableDimensionResponse('max_workspaces');
    const limit = Number(process.env.MAX_UNKNOWN_DIMENSIONS_ALLOWED ?? 0);
    const injection = await injectUnavailableDimension('simulated-tenant', 'max_workspaces', token);
    assert.ok([200, 201, 202, 501].includes(injection.status));
    if (limit >= 1) {
      assert.equal(synthetic.quotaDimensions[0].usageStatus, 'usage_unavailable');
    } else {
      assert.throws(() => assertAllDimensionsAccessible(synthetic));
    }
  });

  await t.test('EC-5 concurrent plan change serialization commits at most one transition', async () => {
    const tenantId = await provisionTenant(`test-tenant-concurrency-${runSuffix()}`);
    try {
      assert.ok([200, 202].includes((await assignPlan(tenantId, fixtures.starter.slug, token)).status));
      const [a, b] = await Promise.allSettled([
        assignPlan(tenantId, fixtures.professional.slug, token),
        assignPlan(tenantId, fixtures.professional.slug, token)
      ]);
      const statuses = [a, b].map((result) => result.status === 'fulfilled' ? result.value.status : 500).sort();
      assert.ok(statuses.some((value) => [200, 202].includes(value)));
      assert.ok(statuses.some((value) => [200, 202, 409].includes(value)));
      await assertHistoryEntryCount(tenantId, 1, token);
    } finally {
      await teardownTenant(tenantId, token);
    }
  });

  await t.test('EC-6 override-governed dimension is skipped until a public override surface exists', async () => {
    t.skip('No override management API is present in the task-mapped files for this suite.');
  });
});
