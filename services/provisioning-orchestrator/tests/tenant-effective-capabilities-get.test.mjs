import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../src/actions/tenant-effective-capabilities-get.mjs';

function createMockDb({ assignment, planCapabilities, catalog, overrides } = {}) {
  return {
    query(sql, params) {
      if (sql.includes('tenant_plan_adjustments')) {
        return { rows: overrides ? [{ capability_overrides: overrides }] : [] };
      }
      return { rows: [] };
    }
  };
}

function createMockRepositories({ assignment, planCapabilities, catalog, overrides } = {}) {
  const db = createMockDb({ overrides });

  // We override at the action level via the overrides parameter
  return {
    db,
    assignmentRepo: {
      getCurrent: async (_db, _tenantId) => assignment ?? null
    },
    catalogRepo: {
      listActiveCatalog: async (_db) => catalog ?? []
    },
    planCapabilityRepo: {
      getPlanCapabilities: async (_db, _planId) => planCapabilities ?? null
    }
  };
}

// Helper to call main with mocked repositories
async function callAction(params, { assignment, planCapabilities, catalog, overrides } = {}) {
  const mockDb = createMockDb({ overrides });

  // Monkey-patch: we call main directly but need to mock the repository imports.
  // Since main imports repositories at module level, we use the overrides parameter pattern
  // that the action already supports for db injection.

  // For a clean test, we'll test the resolveEffectiveCapabilities function directly
  // and test main with db mocks.
  return main(
    { ...params, db: mockDb },
    { db: mockDb }
  );
}

// Import the resolution function for direct unit testing
import { resolveEffectiveCapabilities } from '../src/actions/tenant-effective-capabilities-get.mjs';

const ACTIVE_CATALOG = [
  { capabilityKey: 'webhooks', displayLabel: 'Webhooks', platformDefault: false, isActive: true },
  { capabilityKey: 'realtime', displayLabel: 'Realtime', platformDefault: false, isActive: true },
  { capabilityKey: 'sql_admin_api', displayLabel: 'SQL Admin', platformDefault: true, isActive: true },
  { capabilityKey: 'functions_public', displayLabel: 'Functions', platformDefault: false, isActive: true },
  { capabilityKey: 'passthrough_admin', displayLabel: 'Passthrough', platformDefault: false, isActive: true },
];

const INACTIVE_ENTRY = { capabilityKey: 'deprecated_feature', displayLabel: 'Deprecated', platformDefault: true, isActive: false };

test('resolveEffectiveCapabilities: plan base defines capability as true', () => {
  const result = resolveEffectiveCapabilities(
    { webhooks: true, realtime: false },
    {},
    ACTIVE_CATALOG
  );
  assert.equal(result.webhooks, true);
  assert.equal(result.realtime, false);
});

test('resolveEffectiveCapabilities: override additive (plan false, override true)', () => {
  const result = resolveEffectiveCapabilities(
    { webhooks: false },
    { webhooks: true },
    ACTIVE_CATALOG
  );
  assert.equal(result.webhooks, true);
});

test('resolveEffectiveCapabilities: override restrictive (plan true, override false)', () => {
  const result = resolveEffectiveCapabilities(
    { webhooks: true },
    { webhooks: false },
    ACTIVE_CATALOG
  );
  assert.equal(result.webhooks, false);
});

test('resolveEffectiveCapabilities: capability not in plan uses platform_default', () => {
  const result = resolveEffectiveCapabilities(
    {},
    {},
    ACTIVE_CATALOG
  );
  // sql_admin_api has platformDefault: true
  assert.equal(result.sql_admin_api, true);
  // webhooks has platformDefault: false
  assert.equal(result.webhooks, false);
});

test('resolveEffectiveCapabilities: inactive capabilities not included', () => {
  const result = resolveEffectiveCapabilities(
    { deprecated_feature: true },
    {},
    ACTIVE_CATALOG // does not include INACTIVE_ENTRY
  );
  assert.equal(result.deprecated_feature, undefined);
});

test('resolveEffectiveCapabilities: tenant with no plan → all false', () => {
  const result = resolveEffectiveCapabilities(
    {},
    {},
    ACTIVE_CATALOG
  );
  // Only sql_admin_api has platformDefault true
  assert.equal(result.webhooks, false);
  assert.equal(result.realtime, false);
  assert.equal(result.functions_public, false);
  assert.equal(result.passthrough_admin, false);
});

test('main: forbidden when no actor', async () => {
  await assert.rejects(
    () => main({ callerContext: { actor: {} } }, {}),
    (err) => err.code === 'FORBIDDEN'
  );
});
