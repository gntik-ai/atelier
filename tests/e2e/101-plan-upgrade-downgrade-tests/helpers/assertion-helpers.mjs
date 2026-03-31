import assert from 'node:assert/strict';
import test from 'node:test';

const VOLATILE_FIELDS = new Set(['updatedAt', 'requestId']);

function findDimension(response, expectedKey) {
  const dimensions = response?.quotaDimensions ?? response?.dimensions ?? [];
  const entry = dimensions.find((item) => item?.dimensionKey === expectedKey);
  assert.ok(entry, `Expected dimension ${expectedKey} to exist`);
  return entry;
}

function findCapability(response, capabilityKey) {
  const capabilities = response?.capabilities ?? [];
  const entry = capabilities.find((item) => item?.capabilityKey === capabilityKey);
  assert.ok(entry, `Expected capability ${capabilityKey} to exist`);
  return entry;
}

function stripVolatile(value) {
  if (Array.isArray(value)) return value.map(stripVolatile);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !VOLATILE_FIELDS.has(key))
      .map(([key, entry]) => [key, stripVolatile(entry)])
  );
}

export function assertDimensionStatus(actual, expectedKey, expectedStatus) {
  const entry = findDimension(actual, expectedKey);
  assert.equal(entry.usageStatus ?? entry.status, expectedStatus, `Expected ${expectedKey} to have status ${expectedStatus}`);
  return entry;
}

export function assertAllDimensionsAccessible(entitlementsResponse) {
  for (const item of entitlementsResponse?.quotaDimensions ?? []) {
    assert.notEqual(item.usageStatus ?? item.status, 'over_limit', `Did not expect ${item.dimensionKey} to be over_limit`);
    assert.notEqual(item.usageStatus ?? item.status, 'usage_unavailable', `Did not expect ${item.dimensionKey} to be usage_unavailable`);
    assert.notEqual(item.usageStatus ?? item.status, 'unknown', `Did not expect ${item.dimensionKey} to be unknown`);
  }
  return true;
}

export function assertOverLimitDimension(entitlementsResponse, dimensionKey, expectedUsage, expectedLimit) {
  const entry = assertDimensionStatus(entitlementsResponse, dimensionKey, 'over_limit');
  assert.equal(entry.observedUsage, expectedUsage, `Expected ${dimensionKey} observedUsage=${expectedUsage}`);
  assert.equal(entry.effectiveValue, expectedLimit, `Expected ${dimensionKey} effectiveValue=${expectedLimit}`);
  return entry;
}

export function assertCapabilityState(entitlementsResponse, capabilityKey, expectedEnabled) {
  const entry = findCapability(entitlementsResponse, capabilityKey);
  assert.equal(Boolean(entry.enabled), Boolean(expectedEnabled), `Expected capability ${capabilityKey} enabled=${expectedEnabled}`);
  return entry;
}

export function assertResourceResponseUnchanged(snapshotBefore, snapshotAfter) {
  assert.deepEqual(stripVolatile(snapshotAfter), stripVolatile(snapshotBefore));
  return true;
}

export function assertVerificationResultShape(result) {
  assert.ok(result?.runId, 'runId is required');
  assert.ok(result?.timestamp, 'timestamp is required');
  assert.ok(Array.isArray(result?.scenarios), 'scenarios[] is required');
  assert.equal(typeof result?.summary?.total, 'number', 'summary.total is required');
  assert.equal(typeof result?.summary?.passed, 'number', 'summary.passed is required');
  assert.equal(typeof result?.summary?.failed, 'number', 'summary.failed is required');
  return true;
}

test('assertion helpers: assertDimensionStatus detects within_limit entry', () => {
  const payload = { quotaDimensions: [{ dimensionKey: 'max_workspaces', usageStatus: 'within_limit' }] };
  assert.equal(assertDimensionStatus(payload, 'max_workspaces', 'within_limit').dimensionKey, 'max_workspaces');
});

test('assertion helpers: assertAllDimensionsAccessible rejects unknown/over_limit states', () => {
  const payload = { quotaDimensions: [{ dimensionKey: 'max_workspaces', usageStatus: 'within_limit' }, { dimensionKey: 'max_api_keys', usageStatus: 'at_limit' }] };
  assert.equal(assertAllDimensionsAccessible(payload), true);
});

test('assertion helpers: assertOverLimitDimension validates usage and effective limit', () => {
  const payload = { quotaDimensions: [{ dimensionKey: 'max_workspaces', usageStatus: 'over_limit', observedUsage: 10, effectiveValue: 3 }] };
  assert.equal(assertOverLimitDimension(payload, 'max_workspaces', 10, 3).dimensionKey, 'max_workspaces');
});

test('assertion helpers: assertCapabilityState validates enabled boolean', () => {
  const payload = { capabilities: [{ capabilityKey: 'realtime_enabled', enabled: true }] };
  assert.equal(assertCapabilityState(payload, 'realtime_enabled', true).capabilityKey, 'realtime_enabled');
});

test('assertion helpers: assertResourceResponseUnchanged ignores volatile fields', () => {
  const before = [{ id: 'a', updatedAt: '1', requestId: 'x', nested: { updatedAt: '2', value: 3 } }];
  const after = [{ id: 'a', updatedAt: '9', requestId: 'y', nested: { updatedAt: '8', value: 3 } }];
  assert.equal(assertResourceResponseUnchanged(before, after), true);
});

test('assertion helpers: assertVerificationResultShape validates summary object', () => {
  const payload = { runId: 'run-1', timestamp: new Date().toISOString(), scenarios: [], summary: { total: 0, passed: 0, failed: 0 } };
  assert.equal(assertVerificationResultShape(payload), true);
});
