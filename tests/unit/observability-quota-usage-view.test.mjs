import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildQuotaUsageDimensionView,
  buildQuotaUsageOverviewAccessAuditRecord,
  buildTenantProvisioningStateView,
  buildTenantQuotaUsageOverview,
  queryTenantQuotaUsageOverview,
  queryWorkspaceQuotaUsageOverview,
  summarizeObservabilityQuotaUsageView
} from '../../apps/control-plane/src/observability-admin.mjs';
import {
  buildQuotaUsageTableRows,
  buildTenantProvisioningBanner,
  buildTenantQuotaUsageCards,
  buildWorkspaceQuotaUsageRows
} from '../../apps/web-console/src/actions/observability-quota-usage.mjs';
import {
  collectObservabilityQuotaUsageViewViolations,
  readObservabilityQuotaUsageView
} from '../../scripts/lib/observability-quota-usage-view.mjs';

test('observability quota usage view contract remains internally consistent', () => {
  const contract = readObservabilityQuotaUsageView();
  const violations = collectObservabilityQuotaUsageViewViolations(contract);
  assert.deepEqual(violations, []);
});

test('summarizeObservabilityQuotaUsageView exposes the bounded overview catalog', () => {
  const summary = summarizeObservabilityQuotaUsageView();

  assert.equal(summary.version, '2026-03-28');
  assert.equal(summary.scopes.length, 2);
  assert.equal(summary.scopes.some((scope) => scope.id === 'tenant_overview'), true);
  assert.equal(summary.scopes.some((scope) => scope.id === 'workspace_overview'), true);
  assert.equal(summary.visualStates.some((state) => state.id === 'critical'), true);
  assert.equal(summary.provisioningStates.some((state) => state.id === 'degraded'), true);
  assert.equal(summary.provisioningComponents.some((component) => component.id === 'functions'), true);
});

test('buildQuotaUsageDimensionView calculates percentages and blocking context deterministically', () => {
  const view = buildQuotaUsageDimensionView({
    quotaDimension: {
      dimensionId: 'storage_volume_bytes',
      displayName: 'Storage logical volume',
      scope: 'tenant',
      measuredValue: 220,
      unit: 'byte',
      freshnessStatus: 'fresh',
      status: 'hard_limit_reached',
      warningThreshold: 80,
      softLimit: 120,
      hardLimit: 200,
      usageSnapshotTimestamp: '2026-03-28T18:00:00.000Z'
    },
    usageDimension: {
      dimensionId: 'storage_volume_bytes',
      displayName: 'Storage logical volume',
      scope: 'tenant',
      value: 220,
      unit: 'byte',
      freshnessStatus: 'fresh',
      observedAt: '2026-03-28T18:00:00.000Z'
    },
    blockingDecision: {
      allowed: false,
      dimensionId: 'storage_buckets',
      tenantId: 'ten_growth',
      currentUsage: 220,
      hardLimit: 200,
      reasonCode: 'QUOTA_HARD_LIMIT_REACHED',
      sourceDimensionIds: ['storage_volume_bytes'],
      evaluatedAt: '2026-03-28T18:00:00.000Z'
    }
  });

  assert.equal(view.dimensionId, 'storage_volume_bytes');
  assert.equal(view.visualState, 'critical');
  assert.equal(view.usagePercentage, 110);
  assert.equal(view.blockingState, 'denied');
  assert.equal(view.blockingReasonCode, 'QUOTA_HARD_LIMIT_REACHED');
});

test('tenant quota usage overview aggregates provisioning detail and console helpers', () => {
  const overview = buildTenantQuotaUsageOverview({
    tenantId: 'ten_growth',
    generatedAt: '2026-03-28T18:10:00.000Z',
    usageSnapshot: {
      snapshotId: 'usage-tenant-ten_growth',
      queryScope: 'tenant',
      tenantId: 'ten_growth',
      workspaceId: null,
      snapshotTimestamp: '2026-03-28T18:05:00.000Z',
      observationWindow: {
        startedAt: '2026-03-28T18:00:00.000Z',
        endedAt: '2026-03-28T18:05:00.000Z'
      },
      degradedDimensions: [],
      calculationCycle: {
        cycleId: 'usage-cycle-1',
        cadenceSeconds: 300,
        processedScopes: ['tenant'],
        degradedDimensions: [],
        snapshotTimestamp: '2026-03-28T18:05:00.000Z'
      },
      dimensions: [
        {
          dimensionId: 'api_requests',
          displayName: 'API requests',
          value: 75,
          unit: 'request',
          scope: 'tenant',
          freshnessStatus: 'fresh',
          sourceMode: 'business_metric_family',
          sourceRef: 'api_requests_total',
          observedAt: '2026-03-28T18:05:00.000Z'
        },
        {
          dimensionId: 'storage_volume_bytes',
          displayName: 'Storage logical volume',
          value: 220,
          unit: 'byte',
          scope: 'tenant',
          freshnessStatus: 'fresh',
          sourceMode: 'business_metric_family',
          sourceRef: 'storage_logical_volume_bytes',
          observedAt: '2026-03-28T18:05:00.000Z'
        }
      ]
    },
    quotaPosture: {
      postureId: 'quota-tenant-ten_growth',
      queryScope: 'tenant',
      tenantId: 'ten_growth',
      workspaceId: null,
      evaluatedAt: '2026-03-28T18:06:00.000Z',
      usageSnapshotTimestamp: '2026-03-28T18:05:00.000Z',
      observationWindow: {
        startedAt: '2026-03-28T18:00:00.000Z',
        endedAt: '2026-03-28T18:05:00.000Z'
      },
      overallStatus: 'hard_limit_reached',
      degradedDimensions: [],
      hardLimitBreaches: ['storage_volume_bytes'],
      softLimitBreaches: [],
      warningDimensions: ['api_requests'],
      evaluationAudit: {
        subsystemId: 'quota_metering',
        actionCategory: 'configuration_change',
        originSurface: 'scheduled_operation',
        resultOutcome: 'succeeded',
        detail: {
          evaluationId: 'quota-eval-1',
          queryScope: 'tenant',
          overallStatus: 'hard_limit_reached',
          hardLimitBreaches: ['storage_volume_bytes'],
          softLimitBreaches: [],
          warningDimensions: ['api_requests'],
          evaluatedAt: '2026-03-28T18:06:00.000Z'
        }
      },
      dimensions: [
        {
          dimensionId: 'api_requests',
          displayName: 'API requests',
          scope: 'tenant',
          measuredValue: 75,
          unit: 'request',
          freshnessStatus: 'fresh',
          policyMode: 'enforced',
          status: 'warning_threshold_reached',
          warningThreshold: 75,
          softLimit: 120,
          hardLimit: 150,
          remainingToWarning: 0,
          remainingToSoftLimit: 45,
          remainingToHardLimit: 75,
          usageSnapshotTimestamp: '2026-03-28T18:05:00.000Z'
        },
        {
          dimensionId: 'storage_volume_bytes',
          displayName: 'Storage logical volume',
          scope: 'tenant',
          measuredValue: 220,
          unit: 'byte',
          freshnessStatus: 'fresh',
          policyMode: 'enforced',
          status: 'hard_limit_reached',
          warningThreshold: 80,
          softLimit: 120,
          hardLimit: 200,
          remainingToWarning: 0,
          remainingToSoftLimit: 0,
          remainingToHardLimit: 0,
          usageSnapshotTimestamp: '2026-03-28T18:05:00.000Z'
        }
      ]
    },
    blockingDecisions: [
      {
        allowed: false,
        dimensionId: 'storage_buckets',
        tenantId: 'ten_growth',
        currentUsage: 220,
        hardLimit: 200,
        reasonCode: 'QUOTA_HARD_LIMIT_REACHED',
        sourceDimensionIds: ['storage_volume_bytes'],
        evaluatedAt: '2026-03-28T18:06:00.000Z'
      }
    ],
    provisioningComponents: [
      {
        componentName: 'storage',
        status: 'ready',
        lastCheckedAt: '2026-03-28T18:08:00.000Z'
      },
      {
        componentName: 'functions',
        status: 'degraded',
        reason: 'namespace sync lagging',
        lastCheckedAt: '2026-03-28T18:09:00.000Z'
      }
    ],
    requestedBy: 'usr_tenant_owner'
  });

  const provisioningView = buildTenantProvisioningStateView({
    generatedAt: '2026-03-28T18:10:00.000Z',
    components: overview.provisioningState.components
  });
  const auditRecord = buildQuotaUsageOverviewAccessAuditRecord({
    queryScope: 'tenant',
    tenantId: 'ten_growth',
    requestedBy: 'usr_tenant_owner',
    generatedAt: '2026-03-28T18:10:00.000Z'
  });
  const cards = buildTenantQuotaUsageCards(overview);
  const banner = buildTenantProvisioningBanner(overview);
  const rows = buildQuotaUsageTableRows(overview);

  assert.equal(overview.overallPosture, 'hard_limit_reached');
  assert.equal(overview.policiesConfigured, true);
  assert.equal(overview.provisioningState.state, 'degraded');
  assert.equal(provisioningView.degradedComponents.includes('functions'), true);
  assert.equal(auditRecord.permissionId, 'tenant.overview.read');
  assert.equal(cards[0].emphasis, 'critical');
  assert.equal(banner.emphasis, 'degraded');
  assert.equal(rows.find((row) => row.dimensionId === 'storage_volume_bytes').blockingState, 'denied');
});

test('query overview helpers keep caller scope bounded', () => {
  assert.throws(
    () => queryTenantQuotaUsageOverview(
      { tenantId: 'ten_growth' },
      {
        tenantId: 'ten_growth',
        workspaceId: 'wrk_123',
        generatedAt: '2026-03-28T18:10:00.000Z'
      }
    ),
    /does not allow workspace scope widening/
  );

  const workspaceOverview = queryWorkspaceQuotaUsageOverview(
    { tenantId: 'ten_growth', workspaceId: 'wrk_123' },
    {
      tenantId: 'ten_growth',
      workspaceId: 'wrk_123',
      generatedAt: '2026-03-28T18:10:00.000Z',
      snapshotTimestamp: '2026-03-28T18:10:00.000Z',
      observationWindow: {
        startedAt: '2026-03-28T18:05:00.000Z',
        endedAt: '2026-03-28T18:10:00.000Z'
      }
    }
  );

  const rows = buildWorkspaceQuotaUsageRows(workspaceOverview);
  assert.equal(workspaceOverview.queryScope, 'workspace');
  assert.equal(rows.every((row) => row.workspaceId === 'wrk_123'), true);
});
