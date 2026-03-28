import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAlertContext,
  buildHealthSummaryContext,
  getAlertLifecycleStateMachine,
  getAlertSuppressionDefaults,
  summarizeConsoleAlertsContract
} from '../../apps/control-plane/src/observability-admin.mjs';

test('buildHealthSummaryContext returns the platform summary projection', () => {
  const summary = buildHealthSummaryContext('platform');

  assert.equal(summary.scope, 'platform');
  assert.equal(summary.dashboardScope, 'global');
  assert.equal(summary.requiredContext.tenantId, null);
  assert.equal(summary.requiredContext.workspaceId, null);
  assert.deepEqual(summary.requiredScopeContext, []);
  assert.equal(summary.queryScope.labels.metric_scope, 'platform');
  assert.equal(summary.freshnessThresholdSeconds, 120);
  assert.deepEqual(summary.aggregationRule.summary_status_order, ['unavailable', 'degraded', 'stale', 'unknown', 'healthy']);
  assert.equal(summary.supportingContracts.metricsStack, '2026-03-28');
});

test('buildHealthSummaryContext enforces tenant and workspace scope context', () => {
  assert.throws(() => buildHealthSummaryContext('tenant'), /tenantId is required/i);
  assert.throws(() => buildHealthSummaryContext('workspace', { tenantId: 'ten_123' }), /tenantId and workspaceId are required/i);

  const workspace = buildHealthSummaryContext('workspace', {
    tenantId: 'ten_123',
    workspaceId: 'ws_456'
  });

  assert.equal(workspace.scope, 'workspace');
  assert.equal(workspace.dashboardScope, 'workspace');
  assert.deepEqual(workspace.requiredScopeContext, ['tenant_id', 'workspace_id']);
  assert.equal(workspace.queryScope.labels.tenant_id, 'ten_123');
  assert.equal(workspace.queryScope.labels.workspace_id, 'ws_456');
  assert.equal(workspace.scopeIsolation.detail_policy, 'attributed_only');
});

test('buildAlertContext returns scope-safe routing, suppression, and lifecycle metadata', () => {
  const alert = buildAlertContext('component_availability_transition', 'tenant', {
    tenantId: 'ten_123'
  });

  assert.equal(alert.scope, 'tenant');
  assert.equal(alert.dashboardScope, 'tenant');
  assert.equal(alert.category.id, 'component_availability_transition');
  assert.equal(alert.category.defaultSeverity.id, 'critical');
  assert(alert.category.requiredFields.includes('component_id'));
  assert(alert.category.requiredFields.includes('summary_scope'));
  assert.equal(alert.suppression.defaultWindowSeconds, 300);
  assert.equal(alert.suppression.suppressedAlertsRemainQueryable, true);
  assert.equal(alert.suppression.oscillationDetection.threshold_transitions, 4);
  assert.equal(alert.routing[0].role_id, 'tenant_owner');
  assert(alert.maskingPolicy.forbidden_content_categories.includes('raw_endpoint'));
  assert.equal(alert.lifecycle.initialState, 'active');
});

test('buildAlertContext rejects unsupported or unknown inputs', () => {
  assert.throws(
    () => buildAlertContext('not-a-category', 'platform'),
    /Unknown observability alert category/
  );

  assert.throws(
    () => buildAlertContext('component_availability_transition', 'workspace', { tenantId: 'ten_123' }),
    /tenantId and workspaceId are required/
  );
});

test('lifecycle and suppression helpers summarize the state machine', () => {
  const lifecycle = getAlertLifecycleStateMachine();
  const suppression = getAlertSuppressionDefaults();

  assert.equal(lifecycle.version, '2026-03-28');
  assert.deepEqual(lifecycle.adjacency.active, ['acknowledged', 'resolved', 'suppressed']);
  assert.deepEqual(lifecycle.adjacency.resolved, []);
  assert.equal(suppression.dedupe_key_fields[0], 'summary_scope');
  assert.equal(suppression.categories.length, 4);
  assert.equal(suppression.categories.find((category) => category.id === 'freshness_staleness').defaultSuppressionWindowSeconds, 900);
});

test('summarizeConsoleAlertsContract exposes stable contract metadata', () => {
  const summary = summarizeConsoleAlertsContract();

  assert.equal(summary.version, '2026-03-28');
  assert.equal(summary.sourceContracts.healthChecks, '2026-03-28');
  assert.equal(summary.healthSummary.scopes.length, 3);
  assert.deepEqual(summary.healthSummary.aggregationOrderByScope.workspace, ['unavailable', 'degraded', 'stale', 'unknown', 'healthy']);
  assert.equal(summary.alerts.categories.length, 4);
  assert.equal(summary.alerts.severityLevels.find((severity) => severity.id === 'critical').rank, 40);
  assert.equal(summary.alerts.audienceRouting.workspace[0].role_id, 'workspace_owner');
  assert.equal(summary.downstreamConsumers.length, 3);
});
