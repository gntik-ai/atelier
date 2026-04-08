import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  OBSERVABILITY_THRESHOLD_ALERTS_VERSION,
  getAlertCorrelationStrategy,
  getAlertEventEnvelopeSchema,
  getAlertEventType,
  getAlertKafkaTopicConfig,
  getAlertSuppressionCause,
  listAlertEventTypes,
  listAlertSuppressionCauses,
  readObservabilityThresholdAlerts
} from '../../services/internal-contracts/src/index.mjs';

test('observability threshold alerts contract is exposed through shared readers', () => {
  const contract = readObservabilityThresholdAlerts();
  const warningReached = getAlertEventType('quota.threshold.warning_reached');
  const degraded = getAlertSuppressionCause('evidence_degraded');
  const envelope = getAlertEventEnvelopeSchema();
  const kafka = getAlertKafkaTopicConfig();
  const correlation = getAlertCorrelationStrategy();

  assert.equal(contract.version, '2026-03-28');
  assert.equal(OBSERVABILITY_THRESHOLD_ALERTS_VERSION, '2026-03-28');
  assert.equal(listAlertEventTypes().length >= 7, true);
  assert.equal(listAlertSuppressionCauses().length, 2);
  assert.equal(warningReached.transition_direction, 'escalation');
  assert.equal(degraded.freshness_state, 'degraded');
  assert.equal(envelope.audit_vocabulary_alignment.resource_subsystem_id, 'quota_metering');
  assert.equal(kafka.topicName, 'quota.threshold.alerts');
  assert.equal(correlation.references.includes('quota_posture_snapshot'), true);
});

test('architecture index and task summary document the threshold-alert baseline', () => {
  const architectureIndex = readFileSync('docs/reference/architecture/README.md', 'utf8');
  const taskSummary = readFileSync('docs/tasks/us-obs-03.md', 'utf8');
  const architectureGuide = readFileSync('docs/reference/architecture/observability-threshold-alerts.md', 'utf8');

  assert.equal(architectureIndex.includes('observability-threshold-alerts.json'), true);
  assert.equal(architectureIndex.includes('observability-threshold-alerts.md'), true);
  assert.equal(taskSummary.includes('US-OBS-03-T03'), true);
  assert.equal(taskSummary.includes('validate:observability-threshold-alerts'), true);
  assert.equal(architectureGuide.includes('quota.threshold.alerts'), true);
  assert.equal(architectureGuide.includes('Rollback procedure'), true);
});

test('migration defines the last-known posture table', () => {
  const migration = readFileSync(
    'charts/in-falcone/bootstrap/migrations/20260328-002-quota-threshold-alert-posture-store.sql',
    'utf8'
  );

  assert.equal(migration.includes('CREATE TABLE quota_last_known_posture'), true);
  assert.equal(migration.includes('PRIMARY KEY (tenant_id, COALESCE(workspace_id, \'\'), dimension_id)'), true);
  assert.equal(migration.includes('snapshot_timestamp'), true);
});
