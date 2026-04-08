import { readJson } from './quality-gates.mjs';

export const OBSERVABILITY_BUSINESS_METRICS_PATH = 'services/internal-contracts/src/observability-business-metrics.json';
export const OBSERVABILITY_METRICS_STACK_PATH = 'services/internal-contracts/src/observability-metrics-stack.json';
export const OBSERVABILITY_DASHBOARDS_PATH = 'services/internal-contracts/src/observability-dashboards.json';
export const OBSERVABILITY_HEALTH_CHECKS_PATH = 'services/internal-contracts/src/observability-health-checks.json';
export const ARCHITECTURE_BUSINESS_DOC_PATH = 'docs/reference/architecture/observability-business-metrics.md';
export const ARCHITECTURE_README_PATH = 'docs/reference/architecture/README.md';
export const OBS_TASK_DOC_PATH = 'docs/tasks/us-obs-01.md';
export const PACKAGE_JSON_PATH = 'package.json';

const REQUIRED_DOMAIN_IDS = [
  'tenant_lifecycle',
  'workspace_lifecycle',
  'api_usage',
  'identity_activity',
  'function_usage',
  'data_service_usage',
  'storage_usage',
  'realtime_event_activity',
  'quota_posture'
];
const REQUIRED_METRIC_TYPE_IDS = ['adoption', 'usage', 'saturation'];
const REQUIRED_METRIC_FAMILY_IDS = [
  'tenant_active_total',
  'workspace_active_total',
  'api_requests_total',
  'identity_events_total',
  'function_invocations_total',
  'data_service_operations_total',
  'storage_logical_volume_bytes',
  'realtime_connections_active',
  'quota_utilization_ratio'
];
const REQUIRED_SCOPES = ['platform', 'tenant', 'workspace'];
const REQUIRED_BASE_LABELS = ['environment', 'subsystem', 'metric_scope', 'collection_mode'];
const REQUIRED_FORBIDDEN_LABELS = ['user_id', 'request_id', 'raw_path', 'object_key', 'email', 'api_key_id'];

export function readObservabilityBusinessMetrics() {
  return readJson(OBSERVABILITY_BUSINESS_METRICS_PATH);
}

export function readObservabilityMetricsStack() {
  return readJson(OBSERVABILITY_METRICS_STACK_PATH);
}

export function readObservabilityDashboards() {
  return readJson(OBSERVABILITY_DASHBOARDS_PATH);
}

export function readObservabilityHealthChecks() {
  return readJson(OBSERVABILITY_HEALTH_CHECKS_PATH);
}

export function readPackageJson() {
  return readJson(PACKAGE_JSON_PATH);
}

function indexBy(items = [], keyField = 'id') {
  return new Map(items.map((item) => [item?.[keyField], item]));
}

export function collectObservabilityBusinessMetricViolations(
  businessMetrics = readObservabilityBusinessMetrics(),
  metricsStack = readObservabilityMetricsStack(),
  dashboards = readObservabilityDashboards(),
  healthChecks = readObservabilityHealthChecks(),
  packageJson = readPackageJson()
) {
  const violations = [];

  if (typeof businessMetrics?.version !== 'string' || businessMetrics.version.length === 0) {
    violations.push('Observability business metrics contract version must be a non-empty string.');
  }

  if (businessMetrics?.source_metrics_contract !== metricsStack?.version) {
    violations.push('Observability business metrics source_metrics_contract must align with observability-metrics-stack.json version.');
  }

  if (businessMetrics?.source_dashboard_contract !== dashboards?.version) {
    violations.push('Observability business metrics source_dashboard_contract must align with observability-dashboards.json version.');
  }

  if (businessMetrics?.source_health_contract !== healthChecks?.version) {
    violations.push('Observability business metrics source_health_contract must align with observability-health-checks.json version.');
  }

  if (!Array.isArray(businessMetrics?.principles) || businessMetrics.principles.length < 3) {
    violations.push('Observability business metrics must define at least three governing principles.');
  }

  const domainMap = indexBy(businessMetrics?.business_domains ?? []);
  for (const domainId of REQUIRED_DOMAIN_IDS) {
    if (!domainMap.has(domainId)) {
      violations.push(`Observability business metrics must define business domain ${domainId}.`);
    }
  }

  const metricTypeMap = indexBy(businessMetrics?.metric_types ?? []);
  for (const metricTypeId of REQUIRED_METRIC_TYPE_IDS) {
    if (!metricTypeMap.has(metricTypeId)) {
      violations.push(`Observability business metrics must define metric type ${metricTypeId}.`);
    }
  }

  for (const label of REQUIRED_BASE_LABELS) {
    if (!(businessMetrics?.required_labels ?? []).includes(label)) {
      violations.push(`Observability business metrics required_labels must include ${label}.`);
    }
  }

  for (const label of REQUIRED_FORBIDDEN_LABELS) {
    if (!(businessMetrics?.cardinality_controls?.forbidden_labels ?? []).includes(label)) {
      violations.push(`Observability business metrics cardinality_controls must forbid label ${label}.`);
    }
  }

  const boundedDimensions = new Set((businessMetrics?.bounded_dimension_catalog ?? []).map((dimension) => dimension.label));
  for (const label of ['domain', 'metric_type', 'feature_area', 'operation_family']) {
    if (!boundedDimensions.has(label)) {
      violations.push(`Observability business metrics must define bounded dimension catalog entry ${label}.`);
    }
  }

  const metricsRequiredLabels = new Set(metricsStack?.naming?.required_labels ?? []);
  for (const label of REQUIRED_BASE_LABELS) {
    if (!metricsRequiredLabels.has(label)) {
      violations.push(`Observability metrics stack must continue exposing required label ${label} for business metrics alignment.`);
    }
  }

  if (metricsStack?.naming?.prefix !== 'in_falcone') {
    violations.push('Observability metrics stack naming prefix must remain in_falcone for business metrics alignment.');
  }

  const familyMap = indexBy(businessMetrics?.metric_families ?? []);
  for (const familyId of REQUIRED_METRIC_FAMILY_IDS) {
    const family = familyMap.get(familyId);

    if (!family) {
      violations.push(`Observability business metrics must define metric family ${familyId}.`);
      continue;
    }

    if (!family.name?.startsWith('in_falcone_')) {
      violations.push(`Observability business metric family ${familyId} must use the in_falcone_ prefix.`);
    }

    if (!domainMap.has(family.domain)) {
      violations.push(`Observability business metric family ${familyId} references unknown domain ${family.domain}.`);
    }

    if (!metricTypeMap.has(family.metric_type)) {
      violations.push(`Observability business metric family ${familyId} references unknown metric_type ${family.metric_type}.`);
    }

    for (const label of REQUIRED_BASE_LABELS) {
      if (!(family.required_labels ?? []).includes(label)) {
        violations.push(`Observability business metric family ${familyId} must require label ${label}.`);
      }
    }

    for (const scope of family.supported_scopes ?? []) {
      if (!REQUIRED_SCOPES.includes(scope)) {
        violations.push(`Observability business metric family ${familyId} references unknown supported scope ${scope}.`);
      }
    }

    if ((family.supported_scopes ?? []).includes('tenant') && !(family.allowed_optional_labels ?? []).includes('tenant_id')) {
      violations.push(`Observability business metric family ${familyId} must allow tenant_id when tenant scope is supported.`);
    }

    if ((family.supported_scopes ?? []).includes('workspace') && !(family.allowed_optional_labels ?? []).includes('workspace_id')) {
      violations.push(`Observability business metric family ${familyId} must allow workspace_id when workspace scope is supported.`);
    }

    if (typeof family.safe_attribution_policy !== 'string' || family.safe_attribution_policy.length === 0) {
      violations.push(`Observability business metric family ${familyId} must define safe_attribution_policy.`);
    }
  }

  const quotaFamily = familyMap.get('quota_utilization_ratio');
  if (quotaFamily && !(quotaFamily.required_labels ?? []).includes('quota_metric_key')) {
    violations.push('Observability business metric family quota_utilization_ratio must require quota_metric_key.');
  }

  for (const field of ['actor_id', 'metric_family_id', 'correlation_id']) {
    if (!(businessMetrics?.audit_context?.required_fields ?? []).includes(field)) {
      violations.push(`Observability business metrics must capture audit field ${field}.`);
    }
  }

  const scopeAliases = businessMetrics?.scope_aliases ?? {};
  if (scopeAliases.platform?.dashboard_scope !== 'global') {
    violations.push('Observability business metrics platform scope alias must map to dashboard scope global.');
  }
  if (scopeAliases.tenant?.dashboard_scope !== 'tenant') {
    violations.push('Observability business metrics tenant scope alias must map to dashboard scope tenant.');
  }
  if (scopeAliases.workspace?.dashboard_scope !== 'workspace') {
    violations.push('Observability business metrics workspace scope alias must map to dashboard scope workspace.');
  }

  if (businessMetrics?.freshness_and_collection?.collection_health_metric !== metricsStack?.collection_health?.metric_name) {
    violations.push('Observability business metrics collection_health_metric must align with the observability metrics-stack collection health metric.');
  }

  if (businessMetrics?.freshness_and_collection?.lag_metric !== 'in_falcone_observability_collection_lag_seconds') {
    violations.push('Observability business metrics lag_metric must be in_falcone_observability_collection_lag_seconds.');
  }

  if (!packageJson?.scripts?.['validate:observability-business-metrics']) {
    violations.push('package.json must define script validate:observability-business-metrics.');
  }

  const validateRepoScript = packageJson?.scripts?.['validate:repo'] ?? '';
  if (!validateRepoScript.includes('validate:observability-business-metrics')) {
    violations.push('package.json validate:repo must include validate:observability-business-metrics.');
  }

  return violations;
}
