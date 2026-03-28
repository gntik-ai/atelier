import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  OBSERVABILITY_CONSOLE_ALERTS_VERSION,
  getAlertAudienceRouting,
  getAlertCategory,
  getAlertMaskingPolicy,
  getAlertOscillationDetection,
  getAlertSuppressionDefaults,
  getHealthSummaryAggregationRule,
  getHealthSummaryFreshnessThreshold,
  getHealthSummaryScope,
  listAlertCategories,
  listAlertLifecycleStates,
  listAlertSeverityLevels,
  listHealthSummaryScopes,
  listHealthSummaryStatuses,
  readObservabilityBusinessMetrics,
  readObservabilityConsoleAlerts,
  readObservabilityDashboards,
  readObservabilityHealthChecks,
  readObservabilityMetricsStack
} from '../../services/internal-contracts/src/index.mjs';
import { collectObservabilityConsoleAlertViolations } from '../../scripts/lib/observability-console-alerts.mjs';

test('shared readers expose the observability console alerts contract', () => {
  const contract = readObservabilityConsoleAlerts();

  assert.equal(OBSERVABILITY_CONSOLE_ALERTS_VERSION, '2026-03-28');
  assert.equal(contract.version, '2026-03-28');
  assert.equal(contract.source_metrics_contract, readObservabilityMetricsStack().version);
  assert.equal(contract.source_dashboard_contract, readObservabilityDashboards().version);
  assert.equal(contract.source_health_contract, readObservabilityHealthChecks().version);
  assert.equal(contract.source_business_metrics_contract, readObservabilityBusinessMetrics().version);
});

test('summary scopes, statuses, and aggregation metadata are complete', () => {
  const scopes = listHealthSummaryScopes();
  const statuses = listHealthSummaryStatuses();

  assert.deepEqual(scopes.map((scope) => scope.id), ['platform', 'tenant', 'workspace']);
  assert.deepEqual(
    statuses.map((status) => status.id).sort(),
    ['degraded', 'healthy', 'stale', 'unavailable', 'unknown']
  );
  assert.equal(getHealthSummaryScope('tenant').dashboard_scope, 'tenant');
  assert.equal(getHealthSummaryFreshnessThreshold(), 120);
  assert.deepEqual(getHealthSummaryAggregationRule('platform').summary_status_order, ['unavailable', 'degraded', 'stale', 'unknown', 'healthy']);
});

test('alert categories, severity, lifecycle, routing, masking, and suppression are wired', () => {
  assert.deepEqual(
    listAlertCategories().map((category) => category.id),
    ['component_availability_transition', 'sustained_error_rate_breach', 'freshness_staleness', 'business_metric_deviation']
  );
  assert.deepEqual(
    listAlertSeverityLevels().map((severity) => severity.id),
    ['info', 'warning', 'high', 'critical']
  );
  assert.deepEqual(
    listAlertLifecycleStates().map((state) => state.id),
    ['active', 'acknowledged', 'resolved', 'suppressed']
  );
  assert.equal(getAlertCategory('business_metric_deviation').default_suppression_window_seconds, 1800);
  assert.equal(getAlertAudienceRouting('platform')[0].role_id, 'platform_operator');
  assert.equal(getAlertSuppressionDefaults().dedupe_key_fields.includes('component_id'), true);
  assert.equal(getAlertOscillationDetection().artifact_type, 'state_oscillation');
  assert.equal(getAlertMaskingPolicy().forbidden_content_categories.includes('raw_topic_name'), true);
});

test('validator reports no contract violations for the checked-in artifact set', () => {
  assert.deepEqual(collectObservabilityConsoleAlertViolations(), []);
});

test('docs and package wiring expose the new observability console-alerts baseline', () => {
  const architectureIndex = readFileSync(new URL('../../docs/reference/architecture/README.md', import.meta.url), 'utf8');
  const taskSummary = readFileSync(new URL('../../docs/tasks/us-obs-01.md', import.meta.url), 'utf8');
  const architectureDoc = readFileSync(new URL('../../docs/reference/architecture/observability-console-alerts.md', import.meta.url), 'utf8');
  const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

  assert.match(architectureIndex, /observability-console-alerts\.json/);
  assert.match(architectureIndex, /observability-console-alerts\.md/);
  assert.match(taskSummary, /US-OBS-01-T05/);
  assert.match(taskSummary, /validate:observability-console-alerts/);
  assert.match(architectureDoc, /Internal alert categories/);
  assert.equal(packageJson.scripts['validate:observability-console-alerts'], 'node ./scripts/validate-observability-console-alerts.mjs');
  assert.match(packageJson.scripts['validate:repo'], /validate:observability-console-alerts/);
});
