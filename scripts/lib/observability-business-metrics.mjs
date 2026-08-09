import { isDeepStrictEqual } from 'node:util';

import { readJson } from './quality-gates.mjs';

export const OBSERVABILITY_BUSINESS_METRICS_PATH = 'packages/internal-contracts/src/observability-business-metrics.json';
export const OBSERVABILITY_METRICS_STACK_PATH = 'packages/internal-contracts/src/observability-metrics-stack.json';
export const OBSERVABILITY_DASHBOARDS_PATH = 'packages/internal-contracts/src/observability-dashboards.json';
export const OBSERVABILITY_HEALTH_CHECKS_PATH = 'packages/internal-contracts/src/observability-health-checks.json';
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
  'quota_posture',
  'mcp_tool_usage'
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
  'quota_utilization_ratio',
  'mcp_tool_invocations_total'
];
const REQUIRED_SCOPES = ['platform', 'tenant', 'workspace'];
const REQUIRED_BASE_LABELS = ['environment', 'subsystem', 'metric_scope', 'collection_mode'];
const REQUIRED_FORBIDDEN_LABELS = ['user_id', 'request_id', 'raw_path', 'object_key', 'email', 'api_key_id'];
const MCP_REQUIRED_LABELS = [
  'environment', 'subsystem', 'metric_scope', 'collection_mode', 'domain', 'metric_type',
  'feature_area', 'operation_family', 'tenant_id', 'server', 'tool_name', 'status_class',
];
const MCP_OPTIONAL_LABELS = ['workspace_id', 'oauth_client'];
const MCP_EXACT_LABEL_KEYS = [
  'environment', 'subsystem', 'metric_scope', 'collection_mode', 'domain', 'metric_type',
  'feature_area', 'operation_family', 'tenant_id', 'workspace_id', 'server', 'tool_name',
  'oauth_client', 'status_class',
];
const MCP_FIXED_LABELS = {
  subsystem: 'mcp',
  collection_mode: 'push',
  domain: 'mcp_tool_usage',
  metric_type: 'usage',
  feature_area: 'mcp',
  operation_family: 'execute',
};
const MCP_STATUS_CLASSES = ['success', 'error', 'denied'];
const MCP_CONDITIONAL_LABELS = {
  workspace_id: {
    required_when: { metric_scope: 'workspace' },
    forbidden_when: { metric_scope: 'tenant' },
    source: 'tenant_scoped_resolved_server_workspace',
  },
  oauth_client: {
    allowed_when: 'verified_non_secret_oauth_client_id_available',
    otherwise: 'omit',
    source: 'credential_verified_oauth_client_id',
  },
};
const MCP_CANONICAL_SOURCE_POLICY = {
  metric_scope: 'verified_tenant_or_tenant_resolved_workspace',
  tenant_id: 'credential_verified_tenant_identity',
  workspace_id: 'tenant_scoped_resolved_server_workspace',
  server: 'tenant_scoped_canonical_server_record',
  tool_name: 'active_published_manifest_canonical_tool',
  oauth_client: 'credential_verified_non_secret_oauth_client_id',
  status_class: 'internal_completed_invocation_outcome_class',
};
const MCP_FORBIDDEN_SOURCES = [
  'caller_scope_hint', 'json_rpc_params', 'tool_arguments', 'raw_path_or_query',
  'unverified_identity_claim', 'result_or_error_content',
];

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

function hasFamilyScopeLabelPolicy(family, label) {
  return (family?.required_labels ?? []).includes(label)
    || (family?.allowed_optional_labels ?? []).includes(label)
    || Object.hasOwn(family?.emission_policy?.conditional_labels ?? {}, label);
}

function sameMembers(actual = [], expected = []) {
  return actual.length === expected.length
    && expected.every((entry) => actual.includes(entry));
}

export function collectMcpBusinessMetricDescriptorViolations(
  descriptor,
  businessMetrics = readObservabilityBusinessMetrics()
) {
  const violations = [];
  const family = (businessMetrics?.metric_families ?? [])
    .find((entry) => entry.id === 'mcp_tool_invocations_total');
  const labels = descriptor?.labels;

  if (descriptor?.name !== family?.name) {
    violations.push('MCP counter descriptor name must match the business-metrics family name.');
  }
  if (descriptor?.kind !== family?.kind) {
    violations.push('MCP counter descriptor kind must be counter.');
  }
  if (descriptor?.value !== 1) {
    violations.push('MCP counter descriptor value must equal 1.');
  }
  if (!labels || typeof labels !== 'object' || Array.isArray(labels)) {
    violations.push('MCP counter descriptor labels must be an object.');
    return violations;
  }

  const scope = labels.metric_scope;
  const expectedKeys = [...MCP_REQUIRED_LABELS];
  if (scope === 'workspace') expectedKeys.push('workspace_id');
  if (Object.hasOwn(labels, 'oauth_client')) expectedKeys.push('oauth_client');
  if (!sameMembers(Object.keys(labels), expectedKeys)) {
    violations.push('MCP counter descriptor must use the exact required and conditional label keys.');
  }
  if (!(family?.supported_scopes ?? []).includes(scope)) {
    violations.push('MCP counter descriptor metric_scope must be tenant or workspace.');
  }
  for (const [key, value] of Object.entries(MCP_FIXED_LABELS)) {
    if (labels[key] !== value) violations.push(`MCP counter descriptor label ${key} must equal ${value}.`);
  }
  if (!MCP_STATUS_CLASSES.includes(labels.status_class)) {
    violations.push('MCP counter descriptor status_class must be success, error, or denied.');
  }
  for (const key of ['tenant_id', 'server', 'tool_name']) {
    if (typeof labels[key] !== 'string' || labels[key].length === 0) {
      violations.push(`MCP counter descriptor label ${key} must be a non-empty string.`);
    }
  }
  if (scope === 'workspace'
    && (typeof labels.workspace_id !== 'string' || labels.workspace_id.length === 0)) {
    violations.push('MCP workspace counter descriptor must include a non-empty workspace_id.');
  }
  if (scope === 'tenant' && Object.hasOwn(labels, 'workspace_id')) {
    violations.push('MCP tenant counter descriptor must omit workspace_id.');
  }
  if (Object.hasOwn(labels, 'oauth_client')
    && (typeof labels.oauth_client !== 'string' || labels.oauth_client.length === 0)) {
    violations.push('MCP counter descriptor oauth_client must be non-empty when present.');
  }

  return violations;
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

    if ((family.supported_scopes ?? []).includes('tenant') && !hasFamilyScopeLabelPolicy(family, 'tenant_id')) {
      violations.push(`Observability business metric family ${familyId} must allow tenant_id when tenant scope is supported.`);
    }

    if ((family.supported_scopes ?? []).includes('workspace') && !hasFamilyScopeLabelPolicy(family, 'workspace_id')) {
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

  const mcpFamily = familyMap.get('mcp_tool_invocations_total');
  if (mcpFamily) {
    const policy = mcpFamily.emission_policy ?? {};
    if (!isDeepStrictEqual(mcpFamily.supported_scopes, ['tenant', 'workspace'])) {
      violations.push('MCP business metric supported_scopes must be exactly tenant and workspace.');
    }
    if (!isDeepStrictEqual(mcpFamily.required_labels, MCP_REQUIRED_LABELS)) {
      violations.push('MCP business metric required_labels must match the exact counter contract.');
    }
    if (!isDeepStrictEqual(mcpFamily.allowed_optional_labels, MCP_OPTIONAL_LABELS)) {
      violations.push('MCP business metric optional labels must be exactly workspace_id and oauth_client.');
    }
    if (!isDeepStrictEqual(policy.exact_label_keys, MCP_EXACT_LABEL_KEYS)) {
      violations.push('MCP business metric emission policy must declare the exact label-key allowlist.');
    }
    if (!isDeepStrictEqual(policy.fixed_labels, MCP_FIXED_LABELS)) {
      violations.push('MCP business metric emission policy must declare the exact fixed labels.');
    }
    if (!isDeepStrictEqual(policy.allowed_status_classes, MCP_STATUS_CLASSES)) {
      violations.push('MCP business metric status classes must be exactly success, error, and denied.');
    }
    if (!isDeepStrictEqual(policy.conditional_labels, MCP_CONDITIONAL_LABELS)) {
      violations.push('MCP business metric conditional workspace/OAuth label policy must remain exact.');
    }
    if (!isDeepStrictEqual(policy.canonical_source_policy, MCP_CANONICAL_SOURCE_POLICY)) {
      violations.push('MCP business metric canonical label-source policy must remain exact.');
    }
    if (!isDeepStrictEqual(policy.forbidden_sources, MCP_FORBIDDEN_SOURCES)) {
      violations.push('MCP business metric forbidden source policy must remain exact.');
    }
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
