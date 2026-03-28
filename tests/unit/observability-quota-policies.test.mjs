import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildQuotaDimensionPolicy,
  buildTenantQuotaPosture,
  buildWorkspaceQuotaPosture,
  evaluateQuotaDimensionPosture,
  queryTenantQuotaPosture,
  queryWorkspaceQuotaPosture,
  summarizeObservabilityQuotaPolicies
} from '../../apps/control-plane/src/observability-admin.mjs';
import {
  collectObservabilityQuotaPolicyViolations,
  readObservabilityQuotaPolicies
} from '../../scripts/lib/observability-quota-policies.mjs';

test('observability quota policies contract remains internally consistent', () => {
  const violations = collectObservabilityQuotaPolicyViolations();
  assert.deepEqual(violations, []);
});

test('summarizeObservabilityQuotaPolicies exposes the bounded posture catalog', () => {
  const summary = summarizeObservabilityQuotaPolicies();

  assert.equal(summary.version, '2026-03-28');
  assert.equal(summary.scopes.length, 2);
  assert.equal(summary.thresholdTypes.length, 3);
  assert.equal(summary.postureStates.some((state) => state.id === 'hard_limit_reached'), true);
  assert.equal(summary.supportedDimensions.includes('api_requests'), true);
  assert.equal(summary.evaluationDefaults.hard_limit_status, 'hard_limit_reached');
});

test('buildQuotaDimensionPolicy enforces threshold ordering and supports unbounded dimensions', () => {
  const policy = buildQuotaDimensionPolicy({
    dimensionId: 'api_requests',
    scopeId: 'tenant',
    warningThreshold: 50,
    softLimit: 80,
    hardLimit: 100
  });

  assert.equal(policy.policyMode, 'enforced');
  assert.equal(policy.warningThreshold, 50);
  assert.equal(policy.softLimit, 80);
  assert.equal(policy.hardLimit, 100);

  const unbounded = buildQuotaDimensionPolicy({
    dimensionId: 'topics',
    scopeId: 'workspace',
    policyMode: 'unbounded'
  });

  assert.equal(unbounded.policyMode, 'unbounded');
  assert.equal(unbounded.hardLimit, null);

  assert.throws(
    () => buildQuotaDimensionPolicy({
      dimensionId: 'storage_volume_bytes',
      scopeId: 'tenant',
      warningThreshold: 90,
      softLimit: 80,
      hardLimit: 100
    }),
    /warningThreshold <= softLimit/
  );
});

test('evaluateQuotaDimensionPosture applies inclusive equality semantics and preserves freshness', () => {
  const warning = evaluateQuotaDimensionPosture({
    usageDimension: {
      dimensionId: 'api_requests',
      displayName: 'API requests',
      scope: 'tenant',
      value: 50,
      unit: 'request',
      freshnessStatus: 'fresh',
      observedAt: '2026-03-28T14:00:00.000Z',
      sourceMode: 'business_metric_family',
      sourceRef: 'api_requests_total'
    },
    policy: buildQuotaDimensionPolicy({
      dimensionId: 'api_requests',
      scopeId: 'tenant',
      warningThreshold: 50,
      softLimit: 80,
      hardLimit: 100
    }),
    usageSnapshotTimestamp: '2026-03-28T14:00:00.000Z'
  });

  assert.equal(warning.status, 'warning_threshold_reached');
  assert.equal(warning.remainingToWarning, 0);
  assert.equal(warning.remainingToHardLimit, 50);

  const degraded = evaluateQuotaDimensionPosture({
    usageDimension: {
      dimensionId: 'topics',
      displayName: 'Topics',
      scope: 'tenant',
      value: 2,
      unit: 'topic',
      freshnessStatus: 'degraded',
      observedAt: '2026-03-28T14:00:00.000Z',
      sourceMode: 'control_plane_inventory',
      sourceRef: 'kafka_topic_inventory'
    },
    policy: buildQuotaDimensionPolicy({
      dimensionId: 'topics',
      scopeId: 'tenant',
      warningThreshold: 10,
      hardLimit: 100
    }),
    usageSnapshotTimestamp: '2026-03-28T14:00:00.000Z'
  });

  assert.equal(degraded.status, 'evidence_degraded');

  const unavailable = evaluateQuotaDimensionPosture({
    usageDimension: {
      dimensionId: 'error_count',
      displayName: 'Errors',
      scope: 'tenant',
      value: 1,
      unit: 'error',
      freshnessStatus: 'unavailable',
      observedAt: '2026-03-28T14:00:00.000Z',
      sourceMode: 'business_metric_family',
      sourceRef: 'identity_events_total'
    },
    policy: buildQuotaDimensionPolicy({
      dimensionId: 'error_count',
      scopeId: 'tenant',
      warningThreshold: 10,
      hardLimit: 20
    }),
    usageSnapshotTimestamp: '2026-03-28T14:00:00.000Z'
  });

  assert.equal(unavailable.status, 'evidence_unavailable');
});

test('buildTenantQuotaPosture derives overall status and keeps all dimensions visible', () => {
  const posture = buildTenantQuotaPosture({
    tenantId: 'ten_abc',
    snapshotTimestamp: '2026-03-28T14:00:00.000Z',
    evaluatedAt: '2026-03-28T14:00:00.000Z',
    observationWindow: {
      startedAt: '2026-03-28T13:55:00.000Z',
      endedAt: '2026-03-28T14:00:00.000Z'
    },
    values: {
      api_requests: 120,
      storage_volume_bytes: 85,
      topics: 60,
      error_count: 3
    },
    dimensionFreshness: {
      topics: 'degraded',
      error_count: 'unavailable'
    },
    policies: {
      api_requests: { warningThreshold: 50, softLimit: 90, hardLimit: 120 },
      storage_volume_bytes: { warningThreshold: 40, softLimit: 80, hardLimit: 200 },
      topics: { warningThreshold: 50, hardLimit: 100 },
      error_count: { warningThreshold: 5, hardLimit: 10 }
    }
  });

  assert.equal(posture.queryScope, 'tenant');
  assert.equal(posture.dimensions.length, 9);
  assert.equal(posture.overallStatus, 'hard_limit_reached');
  assert.deepEqual(posture.hardLimitBreaches, ['api_requests']);
  assert.deepEqual(posture.softLimitBreaches, ['storage_volume_bytes']);
  assert.equal(posture.warningDimensions.includes('topics'), true);
  assert.equal(posture.degradedDimensions.includes('topics'), true);
  assert.equal(posture.degradedDimensions.includes('error_count'), true);
  assert.equal(posture.evaluationAudit.detail.overallStatus, 'hard_limit_reached');
});

test('workspace quota posture and query helpers enforce scope guards', () => {
  const posture = buildWorkspaceQuotaPosture({
    tenantId: 'ten_abc',
    workspaceId: 'wrk_xyz',
    snapshotTimestamp: '2026-03-28T14:00:00.000Z',
    evaluatedAt: '2026-03-28T14:00:00.000Z',
    observationWindow: {
      startedAt: '2026-03-28T13:55:00.000Z',
      endedAt: '2026-03-28T14:00:00.000Z'
    },
    policies: {
      api_requests: { warningThreshold: 5, hardLimit: 10 }
    }
  });

  assert.equal(posture.queryScope, 'workspace');
  assert.equal(posture.workspaceId, 'wrk_xyz');

  const tenantScoped = queryTenantQuotaPosture(
    { tenantId: 'ten_abc' },
    {
      tenantId: 'ten_abc',
      snapshotTimestamp: '2026-03-28T14:00:00.000Z',
      evaluatedAt: '2026-03-28T14:00:00.000Z',
      observationWindow: {
        startedAt: '2026-03-28T13:55:00.000Z',
        endedAt: '2026-03-28T14:00:00.000Z'
      },
      policies: {
        api_requests: { warningThreshold: 10, hardLimit: 20 }
      }
    }
  );

  assert.equal(tenantScoped.tenantId, 'ten_abc');

  assert.throws(
    () => queryTenantQuotaPosture(
      { tenantId: 'ten_abc' },
      {
        tenantId: 'ten_other',
        snapshotTimestamp: '2026-03-28T14:00:00.000Z',
        evaluatedAt: '2026-03-28T14:00:00.000Z',
        observationWindow: {
          startedAt: '2026-03-28T13:55:00.000Z',
          endedAt: '2026-03-28T14:00:00.000Z'
        }
      }
    ),
    /must stay within the caller tenant scope/
  );

  assert.throws(
    () => queryWorkspaceQuotaPosture(
      { tenantId: 'ten_abc', workspaceId: 'wrk_xyz' },
      {
        tenantId: 'ten_abc',
        workspaceId: 'wrk_other',
        snapshotTimestamp: '2026-03-28T14:00:00.000Z',
        evaluatedAt: '2026-03-28T14:00:00.000Z',
        observationWindow: {
          startedAt: '2026-03-28T13:55:00.000Z',
          endedAt: '2026-03-28T14:00:00.000Z'
        }
      }
    ),
    /must stay within the caller workspace scope/
  );
});

test('quota policy contract audit defaults stay aligned', () => {
  const contract = readObservabilityQuotaPolicies();
  assert.equal(contract.evaluation_audit.subsystem_id, 'quota_metering');
  assert.equal(contract.evaluation_audit.action_category, 'configuration_change');
  assert.equal(contract.evaluation_audit.origin_surface, 'scheduled_operation');
});
