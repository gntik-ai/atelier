import { readJson } from './quality-gates.mjs';

export const OBSERVABILITY_CONSOLE_ALERTS_PATH = 'services/internal-contracts/src/observability-console-alerts.json';
export const OBSERVABILITY_METRICS_STACK_PATH = 'services/internal-contracts/src/observability-metrics-stack.json';
export const OBSERVABILITY_DASHBOARDS_PATH = 'services/internal-contracts/src/observability-dashboards.json';
export const OBSERVABILITY_HEALTH_CHECKS_PATH = 'services/internal-contracts/src/observability-health-checks.json';
export const OBSERVABILITY_BUSINESS_METRICS_PATH = 'services/internal-contracts/src/observability-business-metrics.json';
export const AUTHORIZATION_MODEL_PATH = 'services/internal-contracts/src/authorization-model.json';
export const PACKAGE_JSON_PATH = 'package.json';

const REQUIRED_SCOPE_IDS = ['platform', 'tenant', 'workspace'];
const REQUIRED_STATUS_IDS = ['healthy', 'degraded', 'unavailable', 'stale', 'unknown'];
const REQUIRED_CATEGORY_IDS = [
  'component_availability_transition',
  'sustained_error_rate_breach',
  'freshness_staleness',
  'business_metric_deviation'
];
const REQUIRED_SEVERITY_IDS = ['info', 'warning', 'high', 'critical'];
const REQUIRED_LIFECYCLE_STATE_IDS = ['active', 'acknowledged', 'resolved', 'suppressed'];
const REQUIRED_MASKED_CONTENT = ['password', 'secret', 'token', 'connection_string', 'raw_hostname', 'raw_endpoint', 'user_id', 'email', 'object_key', 'raw_topic_name'];

export function readObservabilityConsoleAlerts() {
  return readJson(OBSERVABILITY_CONSOLE_ALERTS_PATH);
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

export function readObservabilityBusinessMetrics() {
  return readJson(OBSERVABILITY_BUSINESS_METRICS_PATH);
}

export function readAuthorizationModel() {
  return readJson(AUTHORIZATION_MODEL_PATH);
}

export function readPackageJson() {
  return readJson(PACKAGE_JSON_PATH);
}

function indexBy(items = [], keyField = 'id') {
  return new Map(items.map((item) => [item?.[keyField], item]));
}

function listKnownRoleIds(authorizationModel = readAuthorizationModel()) {
  return new Set(
    Object.values(authorizationModel?.role_catalog ?? {})
      .flat()
      .map((role) => role.id)
  );
}

export function collectObservabilityConsoleAlertViolations(
  consoleAlerts = readObservabilityConsoleAlerts(),
  metricsStack = readObservabilityMetricsStack(),
  dashboards = readObservabilityDashboards(),
  healthChecks = readObservabilityHealthChecks(),
  businessMetrics = readObservabilityBusinessMetrics(),
  authorizationModel = readAuthorizationModel(),
  packageJson = readPackageJson()
) {
  const violations = [];

  if (typeof consoleAlerts?.version !== 'string' || consoleAlerts.version.length === 0) {
    violations.push('Observability console alerts contract version must be a non-empty string.');
  }

  if (consoleAlerts?.source_metrics_contract !== metricsStack?.version) {
    violations.push('Observability console alerts source_metrics_contract must align with observability-metrics-stack.json version.');
  }

  if (consoleAlerts?.source_dashboard_contract !== dashboards?.version) {
    violations.push('Observability console alerts source_dashboard_contract must align with observability-dashboards.json version.');
  }

  if (consoleAlerts?.source_health_contract !== healthChecks?.version) {
    violations.push('Observability console alerts source_health_contract must align with observability-health-checks.json version.');
  }

  if (consoleAlerts?.source_business_metrics_contract !== businessMetrics?.version) {
    violations.push('Observability console alerts source_business_metrics_contract must align with observability-business-metrics.json version.');
  }

  if (!Array.isArray(consoleAlerts?.principles) || consoleAlerts.principles.length < 4) {
    violations.push('Observability console alerts must define at least four governing principles.');
  }

  const summaryModel = consoleAlerts?.health_summary ?? consoleAlerts?.health_summary_model ?? {};
  const scopes = summaryModel?.supported_scopes ?? summaryModel?.scopes ?? [];
  const scopeMap = indexBy(scopes);
  for (const scopeId of REQUIRED_SCOPE_IDS) {
    const scope = scopeMap.get(scopeId);

    if (!scope) {
      violations.push(`Observability console alerts must define summary scope ${scopeId}.`);
      continue;
    }

    if (typeof scope.dashboard_scope !== 'string' || scope.dashboard_scope.length === 0) {
      violations.push(`Summary scope ${scopeId} must define dashboard_scope.`);
    }

    if (!Array.isArray(scope.required_context)) {
      violations.push(`Summary scope ${scopeId} must define required_context.`);
    }
  }

  const statusMap = indexBy(summaryModel?.status_vocabulary ?? []);
  for (const statusId of REQUIRED_STATUS_IDS) {
    const status = statusMap.get(statusId);

    if (!status) {
      violations.push(`Observability console alerts must define summary status ${statusId}.`);
      continue;
    }

    if (typeof status.operational_meaning !== 'string' || status.operational_meaning.length === 0) {
      violations.push(`Summary status ${statusId} must define operational_meaning.`);
    }

    if (typeof status.aggregation_priority !== 'number') {
      violations.push(`Summary status ${statusId} must define numeric aggregation_priority.`);
    }
  }

  for (const field of ['summary_scope', 'status', 'observed_at', 'summary', 'correlation_id']) {
    if (!(summaryModel?.required_fields ?? []).includes(field)) {
      violations.push(`Observability console alerts summary required_fields must include ${field}.`);
    }
  }

  if (summaryModel?.freshness_threshold_seconds !== healthChecks?.status_model?.stale_probe_window_seconds) {
    violations.push('Observability console alerts freshness_threshold_seconds must align with the health-check stale_probe_window_seconds baseline.');
  }

  const scopeAliases = consoleAlerts?.scope_aliases ?? {};
  if (scopeAliases.platform?.dashboard_scope !== 'global') {
    violations.push('Observability console alerts platform scope alias must map to dashboard scope global.');
  }
  if (scopeAliases.tenant?.dashboard_scope !== 'tenant') {
    violations.push('Observability console alerts tenant scope alias must map to dashboard scope tenant.');
  }
  if (scopeAliases.workspace?.dashboard_scope !== 'workspace') {
    violations.push('Observability console alerts workspace scope alias must map to dashboard scope workspace.');
  }

  const alertContract = consoleAlerts?.alert_contract ?? {};
  const categoryMap = indexBy(alertContract?.categories ?? []);
  for (const categoryId of REQUIRED_CATEGORY_IDS) {
    const category = categoryMap.get(categoryId);

    if (!category) {
      violations.push(`Observability console alerts must define alert category ${categoryId}.`);
      continue;
    }

    if (!REQUIRED_SEVERITY_IDS.includes(category.default_severity)) {
      violations.push(`Alert category ${categoryId} must use a known default_severity.`);
    }

    if (!Array.isArray(category.required_fields) || category.required_fields.length === 0) {
      violations.push(`Alert category ${categoryId} must define required_fields.`);
    }

    if (!Array.isArray(category.scope_rules) || category.scope_rules.length === 0) {
      violations.push(`Alert category ${categoryId} must define scope_rules.`);
    }

    if (typeof category.default_suppression_window_seconds !== 'number' || category.default_suppression_window_seconds <= 0) {
      violations.push(`Alert category ${categoryId} must define a positive default_suppression_window_seconds.`);
    }
  }

  const severityMap = indexBy(alertContract?.severity_levels ?? []);
  for (const severityId of REQUIRED_SEVERITY_IDS) {
    if (!severityMap.has(severityId)) {
      violations.push(`Observability console alerts must define severity level ${severityId}.`);
    }
  }

  const lifecycleStateMap = indexBy(alertContract?.lifecycle_states ?? []);
  for (const lifecycleStateId of REQUIRED_LIFECYCLE_STATE_IDS) {
    if (!lifecycleStateMap.has(lifecycleStateId)) {
      violations.push(`Observability console alerts must define lifecycle state ${lifecycleStateId}.`);
    }
  }

  const routing = alertContract?.audience_routing ?? {};
  const knownRoleIds = listKnownRoleIds(authorizationModel);
  for (const scopeId of REQUIRED_SCOPE_IDS) {
    const entries = routing?.[scopeId] ?? [];

    if (!Array.isArray(entries) || entries.length === 0) {
      violations.push(`Observability console alerts audience_routing must define at least one route for ${scopeId}.`);
      continue;
    }

    for (const entry of entries) {
      if (!knownRoleIds.has(entry.role_id)) {
        violations.push(`Observability console alerts audience_routing for ${scopeId} references unknown role ${entry.role_id}.`);
      }
    }
  }

  const maskingPolicy = alertContract?.masking_policy ?? {};
  const forbiddenContent = new Set(maskingPolicy?.forbidden_content_categories ?? []);
  for (const contentClass of REQUIRED_MASKED_CONTENT) {
    if (!forbiddenContent.has(contentClass)) {
      violations.push(`Observability console alerts masking_policy must forbid ${contentClass}.`);
    }
  }

  const suppressionDefaults = alertContract?.suppression_defaults ?? {};
  if (!Array.isArray(suppressionDefaults?.dedupe_key_fields) || suppressionDefaults.dedupe_key_fields.length < 3) {
    violations.push('Observability console alerts suppression_defaults must define dedupe_key_fields.');
  }

  if (suppressionDefaults?.suppressed_alerts_remain_queryable !== true) {
    violations.push('Observability console alerts suppression_defaults must keep suppressed_alerts_remain_queryable true.');
  }

  if (typeof alertContract?.oscillation_detection?.threshold_transitions !== 'number') {
    violations.push('Observability console alerts must define numeric oscillation_detection.threshold_transitions.');
  }

  if (typeof alertContract?.oscillation_detection?.within_seconds !== 'number') {
    violations.push('Observability console alerts must define numeric oscillation_detection.within_seconds.');
  }

  const downstreamConsumers = consoleAlerts?.downstream_consumers ?? [];
  if (!Array.isArray(downstreamConsumers) || downstreamConsumers.length < 3) {
    violations.push('Observability console alerts must declare downstream_consumers for console, alerts, and smoke verification.');
  }

  for (const field of ['actor_id', 'summary_scope', 'alert_category', 'correlation_id']) {
    if (!(consoleAlerts?.audit_context?.required_fields ?? []).includes(field)) {
      violations.push(`Observability console alerts audit_context.required_fields must include ${field}.`);
    }
  }

  if (!packageJson?.scripts?.['validate:observability-console-alerts']) {
    violations.push('package.json must define script validate:observability-console-alerts.');
  }

  const validateRepoScript = packageJson?.scripts?.['validate:repo'] ?? '';
  if (!validateRepoScript.includes('validate:observability-console-alerts')) {
    violations.push('package.json validate:repo must include validate:observability-console-alerts.');
  }

  return violations;
}
