import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildObservabilityQueryScope,
  summarizeObservabilityPlane
} from '../../apps/control-plane/src/observability-admin.mjs';
import {
  collectObservabilityMetricsStackViolations,
  readObservabilityMetricsStack,
  readObservabilityStackValues
} from '../../scripts/lib/observability-metrics-stack.mjs';

test('observability metrics stack package remains internally consistent', () => {
  const violations = collectObservabilityMetricsStackViolations();
  assert.deepEqual(violations, []);
});

test('observability plane summary exposes the normalized foundation and all required subsystems', () => {
  const summary = summarizeObservabilityPlane();
  const stack = readObservabilityMetricsStack();
  const values = readObservabilityStackValues();

  assert.equal(summary.family, 'metrics');
  assert.equal(summary.version, '2026-03-28');
  assert.equal(summary.collectionModel, 'hybrid');
  assert.equal(summary.requiredLabels.includes('metric_scope'), true);
  assert.equal(summary.normalizedMetricFamilies.some((family) => family.id === 'component_up'), true);
  assert.equal(summary.subsystems.length, 7);
  assert.equal(summary.subsystems.some((subsystem) => subsystem.id === 'apisix'), true);
  assert.equal(summary.subsystems.some((subsystem) => subsystem.id === 'control_plane'), true);
  assert.equal(stack.collection_health.metric_name, 'in_falcone_observability_collection_health');
  assert.equal(values.componentTargets.apisix.metricsPath, '/apisix/prometheus/metrics');
  assert.equal(values.componentTargets.controlPlane.interval, '15s');
});

test('tenant and workspace query scopes stay explicit and exclude platform-only leakage', () => {
  const tenantScope = buildObservabilityQueryScope({
    subsystem: 'storage',
    tenantId: 'ten_123',
    workspaceId: 'wrk_456'
  });
  const platformScope = buildObservabilityQueryScope({
    subsystem: 'kafka',
    includePlatform: true
  });

  assert.deepEqual(tenantScope.labels, {
    subsystem: 'storage',
    tenant_id: 'ten_123',
    metric_scope: 'workspace',
    workspace_id: 'wrk_456'
  });
  assert.equal(tenantScope.platformExcludedFromTenantQueries, true);
  assert.equal(tenantScope.filters.includes('tenant_id=ten_123'), true);
  assert.equal(tenantScope.filters.includes('workspace_id=wrk_456'), true);
  assert.equal(platformScope.labels.metric_scope, 'platform');
  assert.equal(platformScope.filters.includes('metric_scope=platform'), true);
});
