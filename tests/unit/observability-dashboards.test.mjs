import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildObservabilityDashboardScope,
  summarizeObservabilityDashboards
} from '../../apps/control-plane/src/observability-admin.mjs';
import {
  listObservabilityDashboardScopes,
  listObservabilityDashboardDimensions,
  listObservabilityDashboardWidgets,
  getObservabilityDashboardScope,
  getObservabilityDashboardDimension,
  getObservabilityDashboardWidget,
  readObservabilityDashboards
} from '../../services/internal-contracts/src/index.mjs';

test('shared readers expose dashboard scopes, dimensions, and widgets', () => {
  const scopes = listObservabilityDashboardScopes();
  const dimensions = listObservabilityDashboardDimensions();
  const widgets = listObservabilityDashboardWidgets();

  assert.equal(scopes.length, 3);
  assert.equal(scopes.some((s) => s.id === 'global'), true);
  assert.equal(scopes.some((s) => s.id === 'tenant'), true);
  assert.equal(scopes.some((s) => s.id === 'workspace'), true);

  assert.equal(dimensions.length, 5);
  assert.equal(dimensions.some((d) => d.id === 'availability'), true);
  assert.equal(dimensions.some((d) => d.id === 'errors'), true);
  assert.equal(dimensions.some((d) => d.id === 'latency'), true);
  assert.equal(dimensions.some((d) => d.id === 'throughput'), true);
  assert.equal(dimensions.some((d) => d.id === 'collection_freshness'), true);

  assert.equal(widgets.length, 7);
  assert.equal(widgets.some((w) => w.id === 'apisix-health'), true);
  assert.equal(widgets.some((w) => w.id === 'control-plane-health'), true);
});

test('getObservabilityDashboardScope returns the correct scope by id', () => {
  const global = getObservabilityDashboardScope('global');
  const tenant = getObservabilityDashboardScope('tenant');
  const workspace = getObservabilityDashboardScope('workspace');
  const missing = getObservabilityDashboardScope('nonexistent');

  assert.equal(global.scope_hierarchy_level, 0);
  assert.equal(tenant.scope_hierarchy_level, 1);
  assert.equal(workspace.scope_hierarchy_level, 2);
  assert.equal(missing, undefined);
});

test('getObservabilityDashboardDimension returns dimensions by id', () => {
  const availability = getObservabilityDashboardDimension('availability');
  const freshness = getObservabilityDashboardDimension('collection_freshness');

  assert.equal(availability.metric_category, 'availability');
  assert.equal(freshness.metric_category, 'collection_health');
  assert.equal(getObservabilityDashboardDimension('nonexistent'), undefined);
});

test('getObservabilityDashboardWidget returns widgets by id', () => {
  const apisix = getObservabilityDashboardWidget('apisix-health');
  const controlPlane = getObservabilityDashboardWidget('control-plane-health');

  assert.equal(apisix.subsystem_id, 'apisix');
  assert.equal(controlPlane.subsystem_id, 'control_plane');
  assert.equal(getObservabilityDashboardWidget('nonexistent'), undefined);
});

test('summarizeObservabilityDashboards returns the full dashboard summary', () => {
  const summary = summarizeObservabilityDashboards();

  assert.equal(summary.version, '2026-03-28');
  assert.equal(summary.sourceMetricsContract, '2026-03-28');

  assert.equal(summary.mandatoryDimensions.length, 5);
  assert.equal(summary.mandatoryDimensions.every((d) => d.id && d.metricCategory), true);

  assert.equal(summary.scopes.length, 3);
  const globalScope = summary.scopes.find((s) => s.id === 'global');
  assert.equal(globalScope.level, 0);
  assert.equal(globalScope.underlyingMetricScope, 'platform');

  assert.equal(summary.widgetCatalog.length, 7);
  assert.equal(summary.widgetCatalog.every((w) => w.id && w.subsystemId), true);

  assert.equal(typeof summary.hierarchy, 'object');
  assert.equal(Array.isArray(summary.hierarchy.canonical_order), true);

  assert.equal(typeof summary.authorizationAndTraceability, 'object');
  assert.equal(typeof summary.collectionFreshness, 'object');
});

test('summarizeObservabilityDashboards exposes scope aliases with metric_scope mapping', () => {
  const summary = summarizeObservabilityDashboards();
  const aliases = summary.dashboardScopeAliases;

  assert.equal(aliases.global.metric_scope, 'platform');
  assert.equal(aliases.tenant.metric_scope, 'tenant');
  assert.equal(aliases.workspace.metric_scope, 'workspace');
});

test('buildObservabilityDashboardScope returns global scope without context', () => {
  const result = buildObservabilityDashboardScope({});

  assert.equal(result.dashboardScope, 'global');
  assert.equal(result.hierarchyLevel, 0);
  assert.equal(result.underlyingMetricScope, 'platform');
  assert.equal(result.queryScope.includePlatform, true);
  assert.equal(result.requiredContext.tenantId, null);
  assert.equal(result.requiredContext.workspaceId, null);
  assert.equal(result.widgetCatalog.length, 7);
  assert.equal(result.drilldownTargets.includes('tenant'), true);
});

test('buildObservabilityDashboardScope returns tenant scope with tenantId', () => {
  const result = buildObservabilityDashboardScope({ tenantId: 'ten_abc' });

  assert.equal(result.dashboardScope, 'tenant');
  assert.equal(result.hierarchyLevel, 1);
  assert.equal(result.requiredContext.tenantId, 'ten_abc');
  assert.equal(result.requiredContext.workspaceId, null);
  assert.equal(result.widgetCatalog.length > 0, true);
  assert.equal(result.drilldownTargets.includes('workspace'), true);
});

test('buildObservabilityDashboardScope returns workspace scope with tenantId and workspaceId', () => {
  const result = buildObservabilityDashboardScope({
    tenantId: 'ten_abc',
    workspaceId: 'wrk_xyz'
  });

  assert.equal(result.dashboardScope, 'workspace');
  assert.equal(result.hierarchyLevel, 2);
  assert.equal(result.underlyingMetricScope, 'workspace');
  assert.equal(result.requiredContext.tenantId, 'ten_abc');
  assert.equal(result.requiredContext.workspaceId, 'wrk_xyz');
  assert.equal(result.drilldownTargets.length, 0);
});

test('buildObservabilityDashboardScope explicit dashboardScope override is respected', () => {
  const result = buildObservabilityDashboardScope({
    dashboardScope: 'global',
    tenantId: 'ten_abc'
  });

  assert.equal(result.dashboardScope, 'global');
});

test('buildObservabilityDashboardScope throws for tenant scope without tenantId', () => {
  assert.throws(
    () => buildObservabilityDashboardScope({ dashboardScope: 'tenant' }),
    /tenantId is required/
  );
});

test('buildObservabilityDashboardScope throws for workspace scope without tenantId', () => {
  assert.throws(
    () => buildObservabilityDashboardScope({ dashboardScope: 'workspace', workspaceId: 'wrk_xyz' }),
    /tenantId and workspaceId are required/
  );
});

test('buildObservabilityDashboardScope throws for workspace scope without workspaceId', () => {
  assert.throws(
    () => buildObservabilityDashboardScope({ dashboardScope: 'workspace', tenantId: 'ten_abc' }),
    /tenantId and workspaceId are required/
  );
});

test('buildObservabilityDashboardScope throws for unknown scope', () => {
  assert.throws(
    () => buildObservabilityDashboardScope({ dashboardScope: 'nonexistent' }),
    /Unknown observability dashboard scope/
  );
});

test('buildObservabilityDashboardScope workspace widgets annotate inherited fallback correctly', () => {
  const result = buildObservabilityDashboardScope({
    tenantId: 'ten_abc',
    workspaceId: 'wrk_xyz'
  });

  const nativeWidget = result.widgetCatalog.find((w) => w.subsystemId === 'control_plane');
  const inheritedWidget = result.widgetCatalog.find((w) => w.subsystemId === 'apisix');

  assert.equal(nativeWidget.inheritedWhenNarrowerScope, false);
  assert.equal(inheritedWidget.inheritedWhenNarrowerScope, true);
});

test('buildObservabilityDashboardScope returns collection freshness metric on every scope', () => {
  const global = buildObservabilityDashboardScope({});
  const tenant = buildObservabilityDashboardScope({ tenantId: 'ten_abc' });
  const workspace = buildObservabilityDashboardScope({ tenantId: 'ten_abc', workspaceId: 'wrk_xyz' });

  assert.equal(global.collectionFreshnessMetric, 'in_falcone_observability_collection_health');
  assert.equal(tenant.collectionFreshnessMetric, 'in_falcone_observability_collection_health');
  assert.equal(workspace.collectionFreshnessMetric, 'in_falcone_observability_collection_health');
});

test('readObservabilityDashboards is consistent with listObservabilityDashboardScopes', () => {
  const raw = readObservabilityDashboards();
  const scopes = listObservabilityDashboardScopes();

  assert.equal(raw.dashboard_scopes.length, scopes.length);
  assert.deepEqual(
    raw.dashboard_scopes.map((s) => s.id),
    scopes.map((s) => s.id)
  );
});
