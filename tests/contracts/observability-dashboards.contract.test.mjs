import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  readObservabilityDashboards,
  listObservabilityDashboardScopes,
  listObservabilityDashboardDimensions,
  listObservabilityDashboardWidgets,
  readObservabilityMetricsStack,
  listObservedSubsystems,
  getObservabilityCollectionHealth
} from '../../services/internal-contracts/src/index.mjs';
import {
  collectObservabilityDashboardViolations
} from '../../scripts/lib/observability-dashboards.mjs';

test('observability dashboards contract is exposed through shared readers', () => {
  const dashboards = readObservabilityDashboards();
  const scopes = listObservabilityDashboardScopes();
  const dimensions = listObservabilityDashboardDimensions();
  const widgets = listObservabilityDashboardWidgets();

  assert.equal(dashboards.version, '2026-03-28');
  assert.equal(scopes.length, 3);
  assert.equal(dimensions.length, 5);
  assert.equal(widgets.length, 7);

  assert.equal(dashboards.scope_aliases.global.metric_scope, 'platform');
  assert.equal(dashboards.scope_aliases.tenant.metric_scope, 'tenant');
  assert.equal(dashboards.scope_aliases.workspace.metric_scope, 'workspace');
});

test('observability dashboards contract passes deterministic validation', () => {
  const violations = collectObservabilityDashboardViolations();
  assert.deepEqual(violations, []);
});

test('dashboard contract source_metrics_contract aligns with metrics-stack contract version', () => {
  const dashboards = readObservabilityDashboards();
  const metricsStack = readObservabilityMetricsStack();

  assert.equal(dashboards.source_metrics_contract, metricsStack.version);
});

test('dashboard widgets reference only subsystems defined in the metrics-stack contract', () => {
  const widgets = listObservabilityDashboardWidgets();
  const subsystems = listObservedSubsystems();
  const subsystemIds = new Set(subsystems.map((s) => s.id));

  for (const widget of widgets) {
    assert.equal(
      subsystemIds.has(widget.subsystem_id),
      true,
      `widget ${widget.id} references unknown subsystem ${widget.subsystem_id}`
    );
  }
});

test('every dashboard scope defines all five mandatory health dimensions', () => {
  const scopes = listObservabilityDashboardScopes();
  const requiredDimensions = ['availability', 'errors', 'latency', 'throughput', 'collection_freshness'];

  for (const scope of scopes) {
    for (const dim of requiredDimensions) {
      assert.equal(
        (scope.mandatory_dimensions ?? []).includes(dim),
        true,
        `scope ${scope.id} is missing mandatory dimension ${dim}`
      );
    }
  }
});

test('collection_freshness telemetry contract aligns with metrics-stack collection health', () => {
  const dashboards = readObservabilityDashboards();
  const collectionHealth = getObservabilityCollectionHealth();

  const dashboardHealthMetric = dashboards.collection_freshness?.telemetry_contract?.health_metric;
  const stackHealthMetric = collectionHealth.metric_name;

  assert.equal(dashboardHealthMetric, stackHealthMetric);
  assert.equal(dashboardHealthMetric, 'in_falcone_observability_collection_health');
});

test('dashboard scope hierarchy levels match canonical order', () => {
  const scopes = listObservabilityDashboardScopes();
  const scopeById = Object.fromEntries(scopes.map((s) => [s.id, s]));

  assert.equal(scopeById.global.scope_hierarchy_level, 0);
  assert.equal(scopeById.tenant.scope_hierarchy_level, 1);
  assert.equal(scopeById.workspace.scope_hierarchy_level, 2);
});

test('drilldown rules are defined for global→tenant and tenant→workspace only', () => {
  const dashboards = readObservabilityDashboards();
  const rules = dashboards.hierarchy?.drilldown_rules ?? [];

  assert.equal(rules.length >= 2, true);
  assert.equal(rules.some((r) => r.from === 'global' && r.to === 'tenant'), true);
  assert.equal(rules.some((r) => r.from === 'tenant' && r.to === 'workspace'), true);
});

test('forbidden transitions prevent workspace from widening scope', () => {
  const dashboards = readObservabilityDashboards();
  const forbidden = dashboards.hierarchy?.forbidden_transitions ?? [];

  assert.equal(forbidden.some((t) => t.from === 'workspace' && t.to === 'tenant'), true);
  assert.equal(forbidden.some((t) => t.from === 'workspace' && t.to === 'global'), true);
});

test('health states include all required allowed values', () => {
  const dashboards = readObservabilityDashboards();
  const allowedValues = new Set(dashboards.health_states?.allowed_values ?? []);

  for (const state of ['healthy', 'degraded', 'unknown', 'stale', 'unavailable', 'inherited']) {
    assert.equal(allowedValues.has(state), true, `health state ${state} is missing`);
  }
});

test('traceability fields are captured per scope authorization requirements', () => {
  const scopes = listObservabilityDashboardScopes();
  const scopeById = Object.fromEntries(scopes.map((s) => [s.id, s]));

  // all scopes must capture actor_id, dashboard_scope, correlation_id
  for (const scope of scopes) {
    const captured = new Set(scope.traceability?.must_capture ?? []);
    assert.equal(captured.has('actor_id'), true, `${scope.id} must capture actor_id`);
    assert.equal(captured.has('dashboard_scope'), true, `${scope.id} must capture dashboard_scope`);
    assert.equal(captured.has('correlation_id'), true, `${scope.id} must capture correlation_id`);
  }

  // tenant scope must capture tenant_id
  assert.equal(scopeById.tenant.traceability?.must_capture.includes('tenant_id'), true);

  // workspace scope must capture both tenant_id and workspace_id
  assert.equal(scopeById.workspace.traceability?.must_capture.includes('tenant_id'), true);
  assert.equal(scopeById.workspace.traceability?.must_capture.includes('workspace_id'), true);
});

test('architecture README and task summary document the observability dashboard baseline', () => {
  const architectureIndex = readFileSync('docs/reference/architecture/README.md', 'utf8');
  const taskSummary = readFileSync('docs/tasks/us-obs-01.md', 'utf8');

  assert.equal(architectureIndex.includes('observability-dashboards.json'), true);
  assert.equal(architectureIndex.includes('observability-health-dashboards.md'), true);
  assert.equal(taskSummary.includes('US-OBS-01-T02'), true);
  assert.equal(taskSummary.includes('validate:observability-dashboards'), true);
});

test('package.json wires validate:observability-dashboards into validate:repo', () => {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));

  assert.equal(typeof packageJson.scripts['validate:observability-dashboards'], 'string');
  assert.equal(
    packageJson.scripts['validate:repo'].includes('validate:observability-dashboards'),
    true
  );
});
