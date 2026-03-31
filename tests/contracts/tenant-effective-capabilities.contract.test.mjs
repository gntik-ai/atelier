import test from 'node:test';
import assert from 'node:assert/strict';

test('tenant-effective-capabilities response matches documented schema', () => {
  const response = {
    tenantId: 'ten_abc123',
    planId: 'pln_xyz789',
    resolvedAt: '2026-03-31T20:00:00Z',
    capabilities: {
      webhooks: true,
      realtime: false,
      sql_admin_api: true,
      passthrough_admin: false,
      functions_public: true
    },
    ttlHint: 120
  };

  // tenantId is string with prefix ten_
  assert.equal(typeof response.tenantId, 'string');
  assert.ok(response.tenantId.startsWith('ten_'));

  // planId is string with prefix pln_
  assert.equal(typeof response.planId, 'string');
  assert.ok(response.planId.startsWith('pln_'));

  // resolvedAt is ISO 8601
  assert.equal(typeof response.resolvedAt, 'string');
  assert.ok(!isNaN(Date.parse(response.resolvedAt)));

  // capabilities is a flat object with boolean values
  assert.equal(typeof response.capabilities, 'object');
  assert.ok(!Array.isArray(response.capabilities));
  for (const [key, value] of Object.entries(response.capabilities)) {
    assert.equal(typeof key, 'string');
    assert.ok(/^[a-z][a-z0-9_]*$/.test(key), `Key "${key}" should be snake_case`);
    assert.equal(typeof value, 'boolean');
  }

  // ttlHint is a number
  assert.equal(typeof response.ttlHint, 'number');
  assert.ok(response.ttlHint > 0);
});

test('tenant-effective-capabilities with no plan has null planId', () => {
  const response = {
    tenantId: 'ten_noplan',
    planId: null,
    resolvedAt: '2026-03-31T20:00:00Z',
    capabilities: {
      webhooks: false,
      realtime: false
    },
    ttlHint: 120
  };

  assert.equal(response.planId, null);
  for (const value of Object.values(response.capabilities)) {
    assert.equal(value, false);
  }
});
