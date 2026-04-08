import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildObservabilityBusinessMetricQuery,
  summarizeObservabilityBusinessMetrics
} from '../../apps/control-plane/src/observability-admin.mjs';
import {
  collectObservabilityBusinessMetricViolations,
  readObservabilityBusinessMetrics
} from '../../scripts/lib/observability-business-metrics.mjs';

test('observability business metrics contract remains internally consistent', () => {
  const violations = collectObservabilityBusinessMetricViolations();
  assert.deepEqual(violations, []);
});

test('summarizeObservabilityBusinessMetrics returns the complete business-metrics summary', () => {
  const summary = summarizeObservabilityBusinessMetrics();
  const contract = readObservabilityBusinessMetrics();

  assert.equal(summary.version, '2026-03-28');
  assert.equal(summary.sourceMetricsContract, '2026-03-28');
  assert.equal(summary.sourceDashboardContract, '2026-03-28');
  assert.equal(summary.sourceHealthContract, '2026-03-28');
  assert.equal(Array.isArray(summary.principles), true);
  assert.equal(summary.principles.length >= 4, true);

  assert.equal(summary.metricTypes.length, 3);
  assert.equal(summary.metricTypes.some((t) => t.id === 'adoption'), true);
  assert.equal(summary.metricTypes.some((t) => t.id === 'usage'), true);
  assert.equal(summary.metricTypes.some((t) => t.id === 'saturation'), true);

  assert.equal(summary.businessDomains.length, 9);
  assert.equal(summary.businessDomains.some((d) => d.id === 'tenant_lifecycle'), true);
  assert.equal(summary.businessDomains.some((d) => d.id === 'quota_posture'), true);

  assert.equal(summary.metricFamilies.length, 9);
  assert.equal(summary.metricFamilies.some((f) => f.id === 'api_requests_total'), true);
  assert.equal(summary.metricFamilies.some((f) => f.id === 'quota_utilization_ratio'), true);

  assert.equal(summary.requiredLabels.includes('metric_scope'), true);
  assert.equal(summary.cardinalityControls.forbidden_labels.includes('user_id'), true);
  assert.equal(summary.cardinalityControls.forbidden_labels.includes('email'), true);
  assert.equal(Array.isArray(summary.auditContext.required_fields), true);
  assert.equal(summary.freshnessAndCollection.collection_health_metric, contract.freshness_and_collection.collection_health_metric);
});

test('business-metrics summary preserves the distinction between metric types', () => {
  const summary = summarizeObservabilityBusinessMetrics();
  const adoptionFamilies = summary.metricFamilies.filter((family) => family.metricType === 'adoption');
  const usageFamilies = summary.metricFamilies.filter((family) => family.metricType === 'usage');
  const saturationFamilies = summary.metricFamilies.filter((family) => family.metricType === 'saturation');

  assert.equal(adoptionFamilies.some((family) => family.id === 'tenant_active_total'), true);
  assert.equal(usageFamilies.some((family) => family.id === 'api_requests_total'), true);
  assert.equal(saturationFamilies.some((family) => family.id === 'quota_utilization_ratio'), true);
});

test('buildObservabilityBusinessMetricQuery returns platform-scoped query by default', () => {
  const query = buildObservabilityBusinessMetricQuery({ metricFamilyId: 'tenant_active_total' });

  assert.equal(query.requestedScope, 'platform');
  assert.equal(query.dashboardScope, 'global');
  assert.equal(query.requiredContext.tenantId, null);
  assert.equal(query.requiredContext.workspaceId, null);
  assert.equal(query.metricFamily.id, 'tenant_active_total');
  assert.equal(query.metricFamily.name, 'in_falcone_tenant_active_total');
  assert.equal(query.metricFamily.supportedScopes.includes('platform'), true);
  assert.equal(query.queryScope.labels.metric_scope, 'platform');
  assert.equal(query.queryScope.filters.includes('metric_scope=platform'), true);
});

test('buildObservabilityBusinessMetricQuery returns tenant-scoped query with tenantId', () => {
  const query = buildObservabilityBusinessMetricQuery({
    metricFamilyId: 'api_requests_total',
    tenantId: 'ten_abc'
  });

  assert.equal(query.requestedScope, 'tenant');
  assert.equal(query.dashboardScope, 'tenant');
  assert.equal(query.requiredContext.tenantId, 'ten_abc');
  assert.equal(query.requiredContext.workspaceId, null);
  assert.equal(query.queryScope.labels.tenant_id, 'ten_abc');
  assert.equal(query.queryScope.labels.metric_scope, 'tenant');
  assert.equal(query.queryScope.labels.domain, 'api_usage');
  assert.equal(query.queryScope.labels.metric_type, 'usage');
  assert.equal(query.metricFamily.safeAttributionPolicy.length > 0, true);
});

test('buildObservabilityBusinessMetricQuery returns workspace-scoped query with workspaceId', () => {
  const query = buildObservabilityBusinessMetricQuery({
    metricFamilyId: 'workspace_active_total',
    tenantId: 'ten_abc',
    workspaceId: 'wrk_xyz'
  });

  assert.equal(query.requestedScope, 'workspace');
  assert.equal(query.dashboardScope, 'workspace');
  assert.equal(query.requiredContext.tenantId, 'ten_abc');
  assert.equal(query.requiredContext.workspaceId, 'wrk_xyz');
  assert.equal(query.queryScope.labels.tenant_id, 'ten_abc');
  assert.equal(query.queryScope.labels.workspace_id, 'wrk_xyz');
  assert.equal(query.queryScope.labels.metric_scope, 'workspace');
});

test('buildObservabilityBusinessMetricQuery allows domain/type-only queries without a metric family', () => {
  const query = buildObservabilityBusinessMetricQuery({
    domainId: 'quota_posture',
    metricTypeId: 'saturation',
    tenantId: 'ten_abc'
  });

  assert.equal(query.metricFamily, null);
  assert.equal(query.queryScope.labels.domain, 'quota_posture');
  assert.equal(query.queryScope.labels.metric_type, 'saturation');
  assert.equal(query.queryScope.filters.includes('domain=quota_posture'), true);
  assert.equal(query.queryScope.filters.includes('metric_type=saturation'), true);
});

test('buildObservabilityBusinessMetricQuery throws for unsupported scope on a metric family', () => {
  assert.throws(
    () => buildObservabilityBusinessMetricQuery({
      metricFamilyId: 'tenant_active_total',
      tenantId: 'ten_abc'
    }),
    /does not support scope tenant/
  );
});

test('buildObservabilityBusinessMetricQuery throws for missing tenantId on tenant scope', () => {
  assert.throws(
    () => buildObservabilityBusinessMetricQuery({
      metricFamilyId: 'api_requests_total',
      scope: 'tenant'
    }),
    /tenantId is required/
  );
});

test('buildObservabilityBusinessMetricQuery throws for missing workspace context on workspace scope', () => {
  assert.throws(
    () => buildObservabilityBusinessMetricQuery({
      metricFamilyId: 'workspace_active_total',
      scope: 'workspace',
      tenantId: 'ten_abc'
    }),
    /tenantId and workspaceId are required/
  );
});

test('buildObservabilityBusinessMetricQuery throws for unknown business metric scope', () => {
  assert.throws(
    () => buildObservabilityBusinessMetricQuery({
      metricFamilyId: 'api_requests_total',
      scope: 'planet'
    }),
    /Unknown business metric scope/
  );
});

test('forbidden labels cover high-cardinality and sensitive identity dimensions', () => {
  const summary = summarizeObservabilityBusinessMetrics();
  const forbidden = summary.cardinalityControls.forbidden_labels ?? [];

  assert.equal(forbidden.includes('user_id'), true);
  assert.equal(forbidden.includes('request_id'), true);
  assert.equal(forbidden.includes('raw_path'), true);
  assert.equal(forbidden.includes('object_key'), true);
  assert.equal(forbidden.includes('email'), true);
  assert.equal(forbidden.includes('api_key_id'), true);
});
