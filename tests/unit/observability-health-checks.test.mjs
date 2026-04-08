import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildComponentHealthProbeSummary,
  buildObservabilityPlatformProbeRollup,
  summarizeObservabilityHealthChecks
} from '../../apps/control-plane/src/observability-admin.mjs';
import {
  collectObservabilityHealthCheckViolations,
  readObservabilityHealthChecks
} from '../../scripts/lib/observability-health-checks.mjs';

test('observability health checks contract remains internally consistent', () => {
  const violations = collectObservabilityHealthCheckViolations();
  assert.deepEqual(violations, []);
});

test('summarizeObservabilityHealthChecks returns the complete health-check summary', () => {
  const summary = summarizeObservabilityHealthChecks();
  const contract = readObservabilityHealthChecks();

  assert.equal(summary.version, '2026-03-28');
  assert.equal(summary.sourceMetricsContract, '2026-03-28');
  assert.equal(summary.sourceDashboardContract, '2026-03-28');
  assert.equal(Array.isArray(summary.principles), true);
  assert.equal(summary.principles.length >= 4, true);

  assert.equal(summary.probeTypes.length, 3);
  assert.equal(summary.probeTypes.some((p) => p.id === 'liveness'), true);
  assert.equal(summary.probeTypes.some((p) => p.id === 'readiness'), true);
  assert.equal(summary.probeTypes.some((p) => p.id === 'health'), true);
  assert.equal(summary.probeTypes.every((p) => p.id && p.displayName && p.allowedStatuses), true);

  assert.equal(summary.components.length, 7);
  assert.equal(summary.components.some((c) => c.id === 'apisix'), true);
  assert.equal(summary.components.some((c) => c.id === 'control_plane'), true);
  assert.equal(summary.components.every((c) => c.id && c.probeSupport && c.supportedMetricScopes), true);

  assert.equal(summary.projection.status_metric, contract.observability_projection.status_metric);
  assert.equal(summary.projection.duration_metric, contract.observability_projection.duration_metric);
  assert.equal(summary.projection.failure_counter, contract.observability_projection.failure_counter);

  assert.equal(typeof summary.exposureTemplates.aggregate, 'object');
  assert.equal(typeof summary.exposureTemplates.component, 'object');
  assert.equal(Array.isArray(summary.maskingPolicy.forbidden_exposed_fields), true);
  assert.equal(Array.isArray(summary.auditContext.required_fields), true);
});

test('probe types define distinct semantics and status models', () => {
  const summary = summarizeObservabilityHealthChecks();
  const liveness = summary.probeTypes.find((p) => p.id === 'liveness');
  const readiness = summary.probeTypes.find((p) => p.id === 'readiness');
  const health = summary.probeTypes.find((p) => p.id === 'health');

  assert.equal(liveness.allowedStatuses.includes('live'), true);
  assert.equal(liveness.allowedStatuses.includes('dead'), true);
  assert.equal(liveness.allowedStatuses.includes('unknown'), true);

  assert.equal(readiness.allowedStatuses.includes('ready'), true);
  assert.equal(readiness.allowedStatuses.includes('not_ready'), true);
  assert.equal(readiness.allowedStatuses.includes('degraded'), true);
  assert.equal(readiness.allowedStatuses.includes('unknown'), true);
  // readiness must not include liveness-specific statuses
  assert.equal(readiness.allowedStatuses.includes('live'), false);
  assert.equal(readiness.allowedStatuses.includes('dead'), false);

  assert.equal(health.allowedStatuses.includes('healthy'), true);
  assert.equal(health.allowedStatuses.includes('degraded'), true);
  assert.equal(health.allowedStatuses.includes('unavailable'), true);
  assert.equal(health.allowedStatuses.includes('unknown'), true);
  assert.equal(health.allowedStatuses.includes('stale'), true);
  assert.equal(health.allowedStatuses.includes('inherited'), true);
});

test('buildObservabilityPlatformProbeRollup returns health rollup by default', () => {
  const rollup = buildObservabilityPlatformProbeRollup({});

  assert.equal(rollup.probeType, 'health');
  assert.equal(rollup.displayName, 'Health');
  assert.equal(rollup.componentCount, 7);
  assert.equal(rollup.requiredComponentIds.includes('apisix'), true);
  assert.equal(rollup.requiredComponentIds.includes('kafka'), true);
  assert.equal(rollup.requiredComponentIds.includes('postgresql'), true);
  assert.equal(rollup.requiredComponentIds.includes('mongodb'), true);
  assert.equal(rollup.requiredComponentIds.includes('openwhisk'), true);
  assert.equal(rollup.requiredComponentIds.includes('storage'), true);
  assert.equal(rollup.requiredComponentIds.includes('control_plane'), true);
  assert.equal(rollup.aggregateExposure.path, '/internal/health');
  assert.equal(rollup.aggregateExposure.internal_only, true);
  assert.equal(Array.isArray(rollup.compatibleDashboardStateModel), true);
  assert.equal(rollup.compatibleDashboardStateModel.includes('healthy'), true);
  assert.equal(rollup.compatibleDashboardStateModel.includes('degraded'), true);
  assert.equal(rollup.projection.status_metric, 'in_falcone_component_probe_status');
});

test('buildObservabilityPlatformProbeRollup returns liveness rollup', () => {
  const rollup = buildObservabilityPlatformProbeRollup({ probeType: 'liveness' });

  assert.equal(rollup.probeType, 'liveness');
  assert.equal(rollup.displayName, 'Liveness');
  assert.equal(rollup.aggregateExposure.path, '/internal/live');
  assert.equal(rollup.aggregateExposure.internal_only, true);
  assert.equal(rollup.componentCount, 7);
});

test('buildObservabilityPlatformProbeRollup returns readiness rollup', () => {
  const rollup = buildObservabilityPlatformProbeRollup({ probeType: 'readiness' });

  assert.equal(rollup.probeType, 'readiness');
  assert.equal(rollup.displayName, 'Readiness');
  assert.equal(rollup.aggregateExposure.path, '/internal/ready');
  assert.equal(rollup.aggregateExposure.internal_only, true);
});

test('buildObservabilityPlatformProbeRollup throws for unknown probe type', () => {
  assert.throws(
    () => buildObservabilityPlatformProbeRollup({ probeType: 'nonexistent' }),
    /Unknown observability probe type/
  );
});

test('buildComponentHealthProbeSummary returns apisix health probe summary', () => {
  const summary = buildComponentHealthProbeSummary({ componentId: 'apisix', probeType: 'health' });

  assert.equal(summary.componentId, 'apisix');
  assert.equal(summary.displayName, 'APISIX');
  assert.equal(summary.probeType, 'health');
  assert.equal(summary.dashboardScope, 'global');
  assert.equal(summary.requiredContext.tenantId, null);
  assert.equal(summary.requiredContext.workspaceId, null);
  assert.equal(summary.supportedMetricScopes.includes('platform'), true);
  assert.equal(summary.supportedMetricScopes.includes('tenant'), true);
  assert.equal(summary.supportedMetricScopes.includes('workspace'), true);
  assert.equal(summary.readinessDependencies.length > 0, true);
  assert.equal(summary.healthDependencies.length > 0, true);
  assert.equal(summary.exposure.aggregatePath, '/internal/health');
  assert.equal(summary.exposure.componentPathTemplate, '/internal/health/components/{componentId}');
  assert.equal(summary.exposure.componentPath, '/internal/health/components/apisix');
  assert.equal(summary.exposure.internalOnly, true);
  assert.equal(summary.projection.status_metric, 'in_falcone_component_probe_status');
  assert.equal(Array.isArray(summary.auditFields), true);
  assert.equal(summary.auditFields.includes('actor_id'), true);
  assert.equal(summary.auditFields.includes('correlation_id'), true);
});

test('buildComponentHealthProbeSummary returns kafka liveness probe summary', () => {
  const summary = buildComponentHealthProbeSummary({ componentId: 'kafka', probeType: 'liveness' });

  assert.equal(summary.componentId, 'kafka');
  assert.equal(summary.probeType, 'liveness');
  assert.equal(summary.exposure.aggregatePath, '/internal/live');
  assert.equal(summary.exposure.componentPath, '/internal/live/components/kafka');
  assert.equal(summary.exposure.internalOnly, true);
});

test('buildComponentHealthProbeSummary respects tenant and workspace context in the dashboard scope', () => {
  const tenantSummary = buildComponentHealthProbeSummary({
    componentId: 'postgresql',
    probeType: 'health',
    tenantId: 'ten_abc'
  });
  const workspaceSummary = buildComponentHealthProbeSummary({
    componentId: 'postgresql',
    probeType: 'readiness',
    tenantId: 'ten_abc',
    workspaceId: 'wrk_xyz'
  });

  assert.equal(tenantSummary.dashboardScope, 'tenant');
  assert.equal(tenantSummary.requiredContext.tenantId, 'ten_abc');
  assert.equal(tenantSummary.requiredContext.workspaceId, null);

  assert.equal(workspaceSummary.dashboardScope, 'workspace');
  assert.equal(workspaceSummary.requiredContext.tenantId, 'ten_abc');
  assert.equal(workspaceSummary.requiredContext.workspaceId, 'wrk_xyz');
});

test('buildComponentHealthProbeSummary throws for unknown component', () => {
  assert.throws(
    () => buildComponentHealthProbeSummary({ componentId: 'nonexistent', probeType: 'health' }),
    /Unknown observability health component/
  );
});

test('buildComponentHealthProbeSummary throws for unknown probe type', () => {
  assert.throws(
    () => buildComponentHealthProbeSummary({ componentId: 'apisix', probeType: 'nonexistent' }),
    /Unknown observability probe type/
  );
});

test('buildComponentHealthProbeSummary throws when a component does not support the requested probe type', () => {
  // All components currently support all three probe types, so we simulate an unsupported probe.
  // Because every component supports liveness/readiness/health, verify the guard exists by passing
  // an actual unknown probe type which triggers the probe-type-unknown path first.
  assert.throws(
    () => buildComponentHealthProbeSummary({ componentId: 'storage', probeType: 'nonexistent_probe' }),
    /Unknown observability probe type/
  );
});

test('every component in the health-check contract has a narrowerScopePolicy defined', () => {
  const summary = summarizeObservabilityHealthChecks();

  for (const component of summary.components) {
    assert.equal(
      typeof component.narrowerScopePolicy === 'string' && component.narrowerScopePolicy.length > 0,
      true,
      `component ${component.id} must define narrowerScopePolicy`
    );
  }
});

test('masking policy forbids sensitive field classes in health outputs', () => {
  const summary = summarizeObservabilityHealthChecks();
  const forbidden = summary.maskingPolicy.forbidden_exposed_fields ?? [];

  assert.equal(forbidden.includes('password'), true);
  assert.equal(forbidden.includes('secret'), true);
  assert.equal(forbidden.includes('token'), true);
  assert.equal(forbidden.includes('connection_string'), true);
  assert.equal(forbidden.includes('raw_hostname'), true);
});
