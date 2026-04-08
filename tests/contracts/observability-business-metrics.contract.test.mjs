import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  OBSERVABILITY_BUSINESS_METRICS_VERSION,
  getObservabilityBusinessDomain,
  getObservabilityBusinessMetricControls,
  getObservabilityBusinessMetricFamily,
  getObservabilityBusinessMetricType,
  listObservabilityBusinessDomains,
  listObservabilityBusinessMetricFamilies,
  listObservabilityBusinessMetricTypes,
  readObservabilityBusinessMetrics,
  readObservabilityDashboards,
  readObservabilityHealthChecks,
  readObservabilityMetricsStack
} from '../../services/internal-contracts/src/index.mjs';
import { collectObservabilityBusinessMetricViolations } from '../../scripts/lib/observability-business-metrics.mjs';

test('observability business metrics contract is exposed through shared readers', () => {
  const contract = readObservabilityBusinessMetrics();
  const domains = listObservabilityBusinessDomains();
  const metricTypes = listObservabilityBusinessMetricTypes();
  const families = listObservabilityBusinessMetricFamilies();
  const controls = getObservabilityBusinessMetricControls();

  assert.equal(contract.version, '2026-03-28');
  assert.equal(OBSERVABILITY_BUSINESS_METRICS_VERSION, '2026-03-28');
  assert.equal(domains.length, 9);
  assert.equal(metricTypes.length, 3);
  assert.equal(families.length, 9);

  assert.equal(Array.isArray(controls.requiredLabels), true);
  assert.equal(Array.isArray(controls.boundedDimensionCatalog), true);
  assert.equal(Array.isArray(controls.cardinalityControls.forbidden_labels), true);
  assert.equal(Array.isArray(controls.auditContext.required_fields), true);
});

test('observability business metrics contract passes deterministic validation', () => {
  const violations = collectObservabilityBusinessMetricViolations();
  assert.deepEqual(violations, []);
});

test('source contract versions align with metrics, dashboards, and health baselines', () => {
  const businessMetrics = readObservabilityBusinessMetrics();
  const metricsStack = readObservabilityMetricsStack();
  const dashboards = readObservabilityDashboards();
  const healthChecks = readObservabilityHealthChecks();

  assert.equal(businessMetrics.source_metrics_contract, metricsStack.version);
  assert.equal(businessMetrics.source_dashboard_contract, dashboards.version);
  assert.equal(businessMetrics.source_health_contract, healthChecks.version);
});

test('shared readers return business domains, metric types, and metric families by id', () => {
  const domain = getObservabilityBusinessDomain('api_usage');
  const metricType = getObservabilityBusinessMetricType('usage');
  const family = getObservabilityBusinessMetricFamily('api_requests_total');

  assert.equal(domain.display_name, 'API usage');
  assert.equal(metricType.description.length > 0, true);
  assert.equal(family.name, 'in_falcone_api_requests_total');
  assert.equal(getObservabilityBusinessDomain('nonexistent'), undefined);
  assert.equal(getObservabilityBusinessMetricType('nonexistent'), undefined);
  assert.equal(getObservabilityBusinessMetricFamily('nonexistent'), undefined);
});

test('all required base labels align with the metrics-stack baseline', () => {
  const businessMetrics = readObservabilityBusinessMetrics();
  const metricsStack = readObservabilityMetricsStack();
  const metricsRequiredLabels = new Set(metricsStack.naming?.required_labels ?? []);

  for (const label of businessMetrics.required_labels ?? []) {
    assert.equal(metricsRequiredLabels.has(label), true, `metrics-stack must include required business label ${label}`);
  }
});

test('every business metric family uses the in_falcone prefix and a known domain/type', () => {
  const domains = new Set(listObservabilityBusinessDomains().map((domain) => domain.id));
  const metricTypes = new Set(listObservabilityBusinessMetricTypes().map((metricType) => metricType.id));

  for (const family of listObservabilityBusinessMetricFamilies()) {
    assert.equal(family.name.startsWith('in_falcone_'), true, `${family.id} must use the in_falcone_ prefix`);
    assert.equal(domains.has(family.domain), true, `${family.id} must reference a known domain`);
    assert.equal(metricTypes.has(family.metric_type), true, `${family.id} must reference a known metric_type`);
  }
});

test('tenant and workspace scoped business metric families allow the required scope labels', () => {
  for (const family of listObservabilityBusinessMetricFamilies()) {
    if ((family.supported_scopes ?? []).includes('tenant')) {
      assert.equal((family.allowed_optional_labels ?? []).includes('tenant_id'), true, `${family.id} must allow tenant_id`);
    }

    if ((family.supported_scopes ?? []).includes('workspace')) {
      assert.equal((family.allowed_optional_labels ?? []).includes('workspace_id'), true, `${family.id} must allow workspace_id`);
    }
  }
});

test('quota utilization ratio remains tenant/workspace scoped and requires quota_metric_key', () => {
  const family = getObservabilityBusinessMetricFamily('quota_utilization_ratio');

  assert.deepEqual(family.supported_scopes, ['tenant', 'workspace']);
  assert.equal(family.required_labels.includes('quota_metric_key'), true);
});

test('scope aliases stay aligned with the dashboard scope vocabulary', () => {
  const aliases = readObservabilityBusinessMetrics().scope_aliases;

  assert.equal(aliases.platform.dashboard_scope, 'global');
  assert.equal(aliases.tenant.dashboard_scope, 'tenant');
  assert.equal(aliases.workspace.dashboard_scope, 'workspace');
});

test('forbidden labels continue to block sensitive and high-cardinality dimensions', () => {
  const forbidden = new Set(getObservabilityBusinessMetricControls().cardinalityControls.forbidden_labels ?? []);

  for (const label of ['user_id', 'request_id', 'raw_path', 'object_key', 'email', 'api_key_id']) {
    assert.equal(forbidden.has(label), true, `forbidden_labels must include ${label}`);
  }
});

test('audit context captures actor, metric family, and correlation fields', () => {
  const auditFields = new Set(getObservabilityBusinessMetricControls().auditContext.required_fields ?? []);

  for (const field of ['actor_id', 'metric_family_id', 'correlation_id']) {
    assert.equal(auditFields.has(field), true, `auditContext must capture ${field}`);
  }
});

test('architecture README and task summary document the observability business-metrics baseline', () => {
  const architectureIndex = readFileSync('docs/reference/architecture/README.md', 'utf8');
  const taskSummary = readFileSync('docs/tasks/us-obs-01.md', 'utf8');

  assert.equal(architectureIndex.includes('observability-business-metrics.json'), true);
  assert.equal(architectureIndex.includes('observability-business-metrics.md'), true);
  assert.equal(taskSummary.includes('US-OBS-01-T04'), true);
  assert.equal(taskSummary.includes('validate:observability-business-metrics'), true);
});

test('package.json wires validate:observability-business-metrics into validate:repo', () => {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));

  assert.equal(typeof packageJson.scripts['validate:observability-business-metrics'], 'string');
  assert.equal(packageJson.scripts['validate:repo'].includes('validate:observability-business-metrics'), true);
});
