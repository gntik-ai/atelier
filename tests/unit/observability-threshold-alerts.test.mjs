import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAlertSuppressionEvent,
  buildQuotaDimensionPolicy,
  buildThresholdAlertEvent,
  detectPostureTransitions,
  evaluateQuotaDimensionPosture,
  evaluateTenantAlerts,
  recordAlertEvaluationMetrics,
  summarizeObservabilityThresholdAlerts
} from '../../apps/control-plane/src/observability-admin.mjs';
import {
  collectObservabilityThresholdAlertViolations,
  readObservabilityThresholdAlerts
} from '../../scripts/lib/observability-threshold-alerts.mjs';

test('observability threshold alerts contract remains internally consistent', () => {
  const violations = collectObservabilityThresholdAlertViolations();
  assert.deepEqual(violations, []);
});

test('summarizeObservabilityThresholdAlerts exposes the bounded alert catalog', () => {
  const summary = summarizeObservabilityThresholdAlerts();

  assert.equal(summary.version, '2026-03-28');
  assert.equal(summary.kafka.topicName, 'quota.threshold.alerts');
  assert.equal(summary.eventTypes.some((eventType) => eventType.id === 'quota.threshold.hard_limit_reached'), true);
  assert.equal(summary.suppressionCauses.some((cause) => cause.id === 'evidence_unavailable'), true);
});

test('detectPostureTransitions emits ordered intermediate escalations and recoveries', () => {
  const posture = evaluateQuotaDimensionPosture({
    usageDimension: {
      dimensionId: 'api_requests',
      displayName: 'API requests',
      scope: 'tenant',
      value: 120,
      unit: 'request',
      freshnessStatus: 'fresh',
      observedAt: '2026-03-28T15:00:00.000Z',
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
    usageSnapshotTimestamp: '2026-03-28T15:00:00.000Z'
  });

  const escalation = detectPostureTransitions(posture, { posture: 'within_limit' });
  assert.deepEqual(escalation.map((item) => item.eventType), [
    'quota.threshold.warning_reached',
    'quota.threshold.soft_limit_exceeded',
    'quota.threshold.hard_limit_reached'
  ]);

  const recoveryPosture = { ...posture, measuredValue: 10, status: 'within_limit' };
  const recovery = detectPostureTransitions(recoveryPosture, { posture: 'hard_limit_reached' });
  assert.deepEqual(recovery.map((item) => item.eventType), [
    'quota.threshold.hard_limit_recovered',
    'quota.threshold.soft_limit_recovered',
    'quota.threshold.warning_recovered'
  ]);
});

test('evaluateTenantAlerts suppresses degraded evidence and emits metrics', () => {
  const metrics = { records: [] };
  const result = evaluateTenantAlerts({ metrics }, {
    tenantId: 'ten_alpha',
    posture: {
      tenantId: 'ten_alpha',
      workspaceId: null,
      dimensionId: 'api_requests',
      displayName: 'API requests',
      scope: 'tenant',
      measuredValue: 90,
      warningThreshold: 50,
      softLimit: 80,
      hardLimit: 100,
      remainingToWarning: 0,
      remainingToSoftLimit: 0,
      remainingToHardLimit: 10,
      freshnessStatus: 'degraded',
      status: 'evidence_degraded',
      usageSnapshotTimestamp: '2026-03-28T15:10:00.000Z'
    }
  });

  assert.equal(result.emittedEvents.length, 0);
  assert.equal(result.suppressedEvents.length, 1);
  assert.equal(result.suppressedEvents[0].eventType, 'quota.threshold.alert_suppressed');
  assert.equal(metrics.records.some((record) => record.name === 'quota_threshold_alerts_suppressed_total'), true);
});

test('buildThresholdAlertEvent and buildAlertSuppressionEvent produce deterministic audit-aligned envelopes', () => {
  const currentPosture = {
    tenantId: 'ten_alpha',
    workspaceId: 'wrk_alpha',
    dimensionId: 'topics',
    displayName: 'Topics',
    scope: 'workspace',
    measuredValue: 8,
    warningThreshold: 5,
    softLimit: 7,
    hardLimit: 9,
    remainingToWarning: 0,
    remainingToSoftLimit: 0,
    remainingToHardLimit: 1,
    freshnessStatus: 'fresh',
    usageSnapshotTimestamp: '2026-03-28T15:20:00.000Z'
  };

  const transitionEvent = buildThresholdAlertEvent({
    eventType: 'quota.threshold.soft_limit_exceeded',
    thresholdLevel: 'soft_limit',
    previousPosture: 'warning_threshold_reached',
    newPosture: 'soft_limit_exceeded',
    thresholdValue: 7,
    dimensionId: 'topics'
  }, { currentPosture });

  assert.equal(transitionEvent.resource.subsystem_id, 'quota_metering');
  assert.equal(transitionEvent.action.category, 'configuration_change');
  assert.match(transitionEvent.correlationId, /^quota-alert:ten_alpha:wrk_alpha:topics:/);

  const suppressionEvent = buildAlertSuppressionEvent({ currentPosture }, { cause: 'evidence_unavailable' });
  assert.equal(suppressionEvent.suppressionCause, 'evidence_unavailable');
  assert.equal(suppressionEvent.eventType, 'quota.threshold.alert_suppressed');
});

test('recordAlertEvaluationMetrics appends evaluator metrics', () => {
  const metrics = { records: [] };
  const contract = readObservabilityThresholdAlerts();

  const records = recordAlertEvaluationMetrics({
    metrics,
    emittedEvents: [{ eventType: contract.event_types[0].id, tenantId: 'ten_alpha' }],
    suppressedEvents: [{ suppressionCause: 'evidence_degraded', tenantId: 'ten_alpha' }],
    durationSeconds: 0.25,
    producerLagSeconds: 0.05
  });

  assert.equal(records.some((record) => record.name === 'quota_threshold_alerts_emitted_total'), true);
  assert.equal(records.some((record) => record.name === 'quota_threshold_alerts_producer_lag_seconds'), true);
});
