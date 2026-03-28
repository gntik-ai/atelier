import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTenantUsageSnapshot,
  buildUsageCalculationCycleAuditRecord,
  buildWorkspaceUsageSnapshot,
  queryTenantUsageSnapshot,
  queryWorkspaceUsageSnapshot,
  summarizeObservabilityUsageConsumption
} from '../../apps/control-plane/src/observability-admin.mjs';
import {
  collectObservabilityUsageConsumptionViolations,
  readObservabilityUsageConsumption
} from '../../scripts/lib/observability-usage-consumption.mjs';

test('observability usage consumption contract remains internally consistent', () => {
  const violations = collectObservabilityUsageConsumptionViolations();
  assert.deepEqual(violations, []);
});

test('summarizeObservabilityUsageConsumption exposes the full bounded catalog', () => {
  const summary = summarizeObservabilityUsageConsumption();

  assert.equal(summary.version, '2026-03-28');
  assert.equal(summary.scopes.length, 2);
  assert.equal(summary.scopes.some((scope) => scope.id === 'tenant'), true);
  assert.equal(summary.scopes.some((scope) => scope.id === 'workspace'), true);
  assert.equal(summary.freshnessStates.some((state) => state.id === 'fresh'), true);
  assert.equal(summary.freshnessStates.some((state) => state.id === 'degraded'), true);
  assert.equal(summary.freshnessStates.some((state) => state.id === 'unavailable'), true);
  assert.equal(summary.meteredDimensions.length, 9);
  assert.equal(summary.meteredDimensions.some((dimension) => dimension.id === 'api_requests'), true);
  assert.equal(summary.meteredDimensions.some((dimension) => dimension.id === 'logical_databases'), true);
  assert.equal(summary.refreshPolicy.default_cadence_seconds, 300);
});

test('buildTenantUsageSnapshot emits every tenant dimension and propagates degraded state', () => {
  const snapshot = buildTenantUsageSnapshot({
    tenantId: 'ten_abc',
    snapshotTimestamp: '2026-03-28T13:59:00.000Z',
    observationWindow: {
      startedAt: '2026-03-28T13:54:00.000Z',
      endedAt: '2026-03-28T13:59:00.000Z'
    },
    values: {
      api_requests: 120,
      function_invocations: 8,
      logical_databases: 3,
      topics: 5
    },
    dimensionFreshness: {
      topics: 'degraded',
      error_count: 'unavailable'
    }
  });

  assert.equal(snapshot.queryScope, 'tenant');
  assert.equal(snapshot.tenantId, 'ten_abc');
  assert.equal(snapshot.workspaceId, null);
  assert.equal(snapshot.dimensions.length, 9);
  assert.equal(snapshot.dimensions.find((dimension) => dimension.dimensionId === 'api_requests').value, 120);
  assert.equal(snapshot.dimensions.find((dimension) => dimension.dimensionId === 'logical_databases').value, 3);
  assert.equal(snapshot.dimensions.find((dimension) => dimension.dimensionId === 'collections_tables').value, 0);
  assert.equal(snapshot.degradedDimensions.includes('topics'), true);
  assert.equal(snapshot.degradedDimensions.includes('error_count'), true);
});

test('buildWorkspaceUsageSnapshot enforces tenant/workspace binding', () => {
  const snapshot = buildWorkspaceUsageSnapshot({
    tenantId: 'ten_abc',
    workspaceId: 'wrk_xyz',
    snapshotTimestamp: '2026-03-28T13:59:00.000Z',
    observationWindow: {
      startedAt: '2026-03-28T13:54:00.000Z',
      endedAt: '2026-03-28T13:59:00.000Z'
    }
  });

  assert.equal(snapshot.queryScope, 'workspace');
  assert.equal(snapshot.tenantId, 'ten_abc');
  assert.equal(snapshot.workspaceId, 'wrk_xyz');

  assert.throws(
    () => buildWorkspaceUsageSnapshot({
      workspaceId: 'wrk_xyz',
      snapshotTimestamp: '2026-03-28T13:59:00.000Z',
      observationWindow: {
        startedAt: '2026-03-28T13:54:00.000Z',
        endedAt: '2026-03-28T13:59:00.000Z'
      }
    }),
    /tenantId is required/
  );

  assert.throws(
    () => buildTenantUsageSnapshot({
      tenantId: 'ten_abc',
      workspaceId: 'wrk_xyz',
      snapshotTimestamp: '2026-03-28T13:59:00.000Z',
      observationWindow: {
        startedAt: '2026-03-28T13:54:00.000Z',
        endedAt: '2026-03-28T13:59:00.000Z'
      }
    }),
    /does not allow workspace scope widening/
  );
});

test('query usage snapshot helpers keep caller scope bounded', () => {
  const tenantSnapshot = queryTenantUsageSnapshot(
    { tenantId: 'ten_abc' },
    {
      tenantId: 'ten_abc',
      snapshotTimestamp: '2026-03-28T13:59:00.000Z',
      observationWindow: {
        startedAt: '2026-03-28T13:54:00.000Z',
        endedAt: '2026-03-28T13:59:00.000Z'
      },
      values: {
        api_requests: 44
      }
    }
  );

  assert.equal(tenantSnapshot.tenantId, 'ten_abc');
  assert.equal(tenantSnapshot.dimensions.find((dimension) => dimension.dimensionId === 'api_requests').value, 44);

  assert.throws(
    () => queryTenantUsageSnapshot(
      { tenantId: 'ten_abc' },
      {
        tenantId: 'ten_other',
        snapshotTimestamp: '2026-03-28T13:59:00.000Z',
        observationWindow: {
          startedAt: '2026-03-28T13:54:00.000Z',
          endedAt: '2026-03-28T13:59:00.000Z'
        }
      }
    ),
    /must stay within the caller tenant scope/
  );

  assert.throws(
    () => queryWorkspaceUsageSnapshot(
      { tenantId: 'ten_abc', workspaceId: 'wrk_xyz' },
      {
        tenantId: 'ten_abc',
        workspaceId: 'wrk_other',
        snapshotTimestamp: '2026-03-28T13:59:00.000Z',
        observationWindow: {
          startedAt: '2026-03-28T13:54:00.000Z',
          endedAt: '2026-03-28T13:59:00.000Z'
        }
      }
    ),
    /must stay within the caller workspace scope/
  );
});

test('buildUsageCalculationCycleAuditRecord uses the shared audit-compatible defaults', () => {
  const contract = readObservabilityUsageConsumption();
  const auditRecord = buildUsageCalculationCycleAuditRecord({
    snapshotTimestamp: '2026-03-28T13:59:00.000Z',
    processedScopes: ['tenant'],
    degradedDimensions: ['topics']
  });

  assert.equal(auditRecord.subsystemId, contract.calculation_audit.subsystem_id);
  assert.equal(auditRecord.actionCategory, contract.calculation_audit.action_category);
  assert.equal(auditRecord.originSurface, contract.calculation_audit.origin_surface);
  assert.equal(auditRecord.resultOutcome, 'succeeded');
  assert.deepEqual(auditRecord.detail.processedScopes, ['tenant']);
  assert.deepEqual(auditRecord.detail.degradedDimensions, ['topics']);
});
