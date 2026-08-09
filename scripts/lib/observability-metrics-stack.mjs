import { isDeepStrictEqual } from 'node:util';

import { readJson, readYaml } from './quality-gates.mjs';

export const OBSERVABILITY_METRICS_STACK_PATH = 'packages/internal-contracts/src/observability-metrics-stack.json';
export const BASE_VALUES_PATH = '../falcone-charts/charts/in-falcone/values.yaml';

const REQUIRED_SUBSYSTEM_IDS = [
  'apisix',
  'kafka',
  'postgresql',
  'mongodb',
  'openwhisk',
  'storage',
  'control_plane'
];
const REQUIRED_CONTRACT_IDS = [
  'metric_family_descriptor',
  'subsystem_collection_descriptor',
  'collection_health_descriptor'
];
const REQUIRED_LABELS = ['environment', 'subsystem', 'metric_scope', 'collection_mode'];
const REQUIRED_METRIC_CATEGORIES = ['availability', 'throughput', 'errors', 'latency'];
const REQUIRED_METRIC_FAMILY_IDS = [
  'component_up',
  'component_operations_total',
  'component_operation_errors_total',
  'component_operation_duration_seconds'
];
const MCP_HISTOGRAM_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const MCP_HISTOGRAM_REQUIRED_LABELS = [
  'environment', 'subsystem', 'metric_scope', 'collection_mode', 'operation', 'tenant_id',
  'server', 'tool_name', 'status_class',
];
const MCP_HISTOGRAM_CONDITIONAL_LABELS = ['workspace_id', 'oauth_client'];
const MCP_HISTOGRAM_EXACT_LABEL_KEYS = [
  'environment', 'subsystem', 'metric_scope', 'collection_mode', 'operation', 'tenant_id',
  'workspace_id', 'server', 'tool_name', 'oauth_client', 'status_class',
];
const MCP_HISTOGRAM_FIXED_LABELS = {
  subsystem: 'mcp',
  collection_mode: 'push',
  operation: 'tool_call',
};
const MCP_STATUS_CLASSES = ['success', 'error', 'denied'];
const MCP_CONDITIONAL_LABEL_POLICY = {
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

export function readObservabilityMetricsStack() {
  return readJson(OBSERVABILITY_METRICS_STACK_PATH);
}

export function readBaseValues() {
  return readYaml(BASE_VALUES_PATH);
}

export function readObservabilityStackValues() {
  return readBaseValues()?.observability?.config?.inline?.metricsStack ?? {};
}

function toChartTargetKey(subsystemId) {
  return subsystemId === 'control_plane' ? 'controlPlane' : subsystemId;
}

function sameMembers(actual = [], expected = []) {
  return actual.length === expected.length
    && expected.every((entry) => actual.includes(entry));
}

export function collectMcpToolCallDurationDescriptorViolations(
  descriptor,
  stack = readObservabilityMetricsStack()
) {
  const violations = [];
  const family = (stack?.naming?.normalized_metric_families ?? [])
    .find((entry) => entry.id === 'component_operation_duration_seconds');
  const policy = (family?.slice_policies ?? []).find((entry) => entry.id === 'mcp_tool_call');
  const labels = descriptor?.labels;

  if (descriptor?.name !== family?.name) {
    violations.push('MCP duration descriptor name must match the normalized histogram family.');
  }
  if (descriptor?.kind !== family?.type) {
    violations.push('MCP duration descriptor kind must be histogram.');
  }
  if (typeof descriptor?.observedSeconds !== 'number'
    || !Number.isFinite(descriptor.observedSeconds)
    || descriptor.observedSeconds < 0) {
    violations.push('MCP duration descriptor observedSeconds must be finite and non-negative.');
  }
  if (!labels || typeof labels !== 'object' || Array.isArray(labels)) {
    violations.push('MCP duration descriptor labels must be an object.');
    return violations;
  }

  const scope = labels.metric_scope;
  const expectedKeys = [...MCP_HISTOGRAM_REQUIRED_LABELS];
  if (scope === 'workspace') expectedKeys.push('workspace_id');
  if (Object.hasOwn(labels, 'oauth_client')) expectedKeys.push('oauth_client');
  if (!sameMembers(Object.keys(labels), expectedKeys)) {
    violations.push('MCP duration descriptor must use the exact slice label keys.');
  }
  if (!(policy?.supported_scopes ?? []).includes(scope)) {
    violations.push('MCP duration descriptor metric_scope must be tenant or workspace.');
  }
  for (const [key, value] of Object.entries(MCP_HISTOGRAM_FIXED_LABELS)) {
    if (labels[key] !== value) violations.push(`MCP duration descriptor label ${key} must equal ${value}.`);
  }
  if (!MCP_STATUS_CLASSES.includes(labels.status_class)) {
    violations.push('MCP duration descriptor status_class must be success, error, or denied.');
  }
  for (const key of ['tenant_id', 'server', 'tool_name']) {
    if (typeof labels[key] !== 'string' || labels[key].length === 0) {
      violations.push(`MCP duration descriptor label ${key} must be a non-empty string.`);
    }
  }
  if (scope === 'workspace'
    && (typeof labels.workspace_id !== 'string' || labels.workspace_id.length === 0)) {
    violations.push('MCP workspace duration descriptor must include a non-empty workspace_id.');
  }
  if (scope === 'tenant' && Object.hasOwn(labels, 'workspace_id')) {
    violations.push('MCP tenant duration descriptor must omit workspace_id.');
  }
  if (Object.hasOwn(labels, 'oauth_client')
    && (typeof labels.oauth_client !== 'string' || labels.oauth_client.length === 0)) {
    violations.push('MCP duration descriptor oauth_client must be non-empty when present.');
  }

  return violations;
}

export function collectObservabilityMetricsStackViolations(
  stack = readObservabilityMetricsStack(),
  values = readBaseValues()
) {
  const violations = [];

  if (typeof stack?.version !== 'string' || stack.version.length === 0) {
    violations.push('Observability metrics stack version must be a non-empty string.');
  }

  if (!Array.isArray(stack?.principles) || stack.principles.length < 3) {
    violations.push('Observability metrics stack must define at least three governing principles.');
  }

  for (const contractId of REQUIRED_CONTRACT_IDS) {
    const contract = stack?.contracts?.[contractId];
    if (!contract) {
      violations.push(`Observability metrics stack must define contract ${contractId}.`);
      continue;
    }

    if (contract.version !== stack.version) {
      violations.push(`Observability contract ${contractId} version must align with stack version ${stack.version}.`);
    }

    if (!Array.isArray(contract.required_fields) || contract.required_fields.length === 0) {
      violations.push(`Observability contract ${contractId} must define required_fields.`);
    }

    if (!Array.isArray(contract.error_classes) || contract.error_classes.length === 0) {
      violations.push(`Observability contract ${contractId} must define error_classes.`);
    }
  }

  if (stack?.naming?.prefix !== 'in_falcone') {
    violations.push('Observability naming prefix must be in_falcone.');
  }

  if (stack?.naming?.metric_scope_label !== 'metric_scope') {
    violations.push('Observability naming metric_scope_label must be metric_scope.');
  }

  for (const label of REQUIRED_LABELS) {
    if (!(stack?.naming?.required_labels ?? []).includes(label)) {
      violations.push(`Observability naming required_labels must include ${label}.`);
    }
  }

  if (stack?.naming?.tenant_isolation?.tenant_label !== 'tenant_id') {
    violations.push('Observability tenant isolation tenant_label must be tenant_id.');
  }

  if (stack?.naming?.tenant_isolation?.workspace_label !== 'workspace_id') {
    violations.push('Observability tenant isolation workspace_label must be workspace_id.');
  }

  for (const forbiddenLabel of ['user_id', 'request_id', 'raw_path', 'object_key']) {
    if (!(stack?.naming?.cardinality_controls?.forbidden_labels ?? []).includes(forbiddenLabel)) {
      violations.push(`Observability cardinality controls must forbid label ${forbiddenLabel}.`);
    }
  }

  if (!Array.isArray(stack?.naming?.latency_histogram_buckets_seconds) || stack.naming.latency_histogram_buckets_seconds.length < 6) {
    violations.push('Observability latency histogram buckets must be explicitly documented.');
  }

  const metricFamilies = stack?.naming?.normalized_metric_families ?? [];
  for (const metricFamilyId of REQUIRED_METRIC_FAMILY_IDS) {
    const family = metricFamilies.find((entry) => entry.id === metricFamilyId);
    if (!family) {
      violations.push(`Observability normalized metric family ${metricFamilyId} must be defined.`);
      continue;
    }

    if (!family.name?.startsWith('in_falcone_')) {
      violations.push(`Observability metric family ${metricFamilyId} must use the in_falcone_ prefix.`);
    }

    for (const label of REQUIRED_LABELS) {
      if (!(family.required_labels ?? []).includes(label)) {
        violations.push(`Observability metric family ${metricFamilyId} must require label ${label}.`);
      }
    }
  }

  const durationFamily = metricFamilies
    .find((entry) => entry.id === 'component_operation_duration_seconds');
  const mcpSlicePolicies = (durationFamily?.slice_policies ?? [])
    .filter((entry) => entry.id === 'mcp_tool_call');
  const mcpSlice = mcpSlicePolicies[0] ?? {};
  if (mcpSlicePolicies.length !== 1) {
    violations.push('Normalized duration family must define exactly one mcp_tool_call slice policy.');
  }
  if (Object.hasOwn(durationFamily ?? {}, 'allowed_optional_labels')) {
    violations.push('Normalized duration family must not grant generic optional labels for the MCP slice.');
  }
  if (!isDeepStrictEqual(mcpSlice.match_labels, { subsystem: 'mcp', operation: 'tool_call' })) {
    violations.push('MCP duration slice match must be exactly subsystem=mcp and operation=tool_call.');
  }
  if (!isDeepStrictEqual(mcpSlice.supported_scopes, ['tenant', 'workspace'])) {
    violations.push('MCP duration slice scopes must be exactly tenant and workspace.');
  }
  if (!isDeepStrictEqual(mcpSlice.required_labels, MCP_HISTOGRAM_REQUIRED_LABELS)) {
    violations.push('MCP duration slice required_labels must match the exact histogram contract.');
  }
  if (!isDeepStrictEqual(
    mcpSlice.allowed_conditional_labels,
    MCP_HISTOGRAM_CONDITIONAL_LABELS
  )) {
    violations.push('MCP duration slice conditional labels must be exactly workspace_id and oauth_client.');
  }
  if (!isDeepStrictEqual(mcpSlice.exact_label_keys, MCP_HISTOGRAM_EXACT_LABEL_KEYS)) {
    violations.push('MCP duration slice must declare the exact label-key allowlist.');
  }
  if (!isDeepStrictEqual(mcpSlice.fixed_labels, MCP_HISTOGRAM_FIXED_LABELS)) {
    violations.push('MCP duration slice must declare the exact fixed labels.');
  }
  if (!isDeepStrictEqual(mcpSlice.allowed_status_classes, MCP_STATUS_CLASSES)) {
    violations.push('MCP duration slice status classes must be exactly success, error, and denied.');
  }
  if (!isDeepStrictEqual(mcpSlice.conditional_labels, MCP_CONDITIONAL_LABEL_POLICY)) {
    violations.push('MCP duration slice conditional workspace/OAuth policy must remain exact.');
  }
  if (!isDeepStrictEqual(mcpSlice.canonical_source_policy, MCP_CANONICAL_SOURCE_POLICY)) {
    violations.push('MCP duration slice canonical label-source policy must remain exact.');
  }
  if (!isDeepStrictEqual(mcpSlice.histogram_buckets_seconds, MCP_HISTOGRAM_BUCKETS)
    || !isDeepStrictEqual(
      mcpSlice.histogram_buckets_seconds,
      stack?.naming?.latency_histogram_buckets_seconds
    )) {
    violations.push('MCP duration slice buckets must exactly reuse the normalized latency buckets.');
  }
  if (mcpSlice.non_matching_slice_policy !== 'mcp_attribution_labels_forbidden') {
    violations.push('MCP duration slice must forbid its attribution labels on non-matching slices.');
  }

  if (stack?.operating_targets?.collection_model !== 'hybrid') {
    violations.push('Observability operating_targets.collection_model must be hybrid.');
  }

  if (stack?.operating_targets?.retention?.hot_days !== 15) {
    violations.push('Observability retention hot_days must be 15.');
  }

  if (stack?.operating_targets?.resolution?.default !== '30s') {
    violations.push('Observability default resolution must be 30s.');
  }

  if (stack?.collection_health?.metric_name !== 'in_falcone_observability_collection_health') {
    violations.push('Observability collection health metric_name must be in_falcone_observability_collection_health.');
  }

  if (stack?.collection_health?.failure_counter !== 'in_falcone_observability_collection_failures_total') {
    violations.push('Observability collection health failure_counter must be in_falcone_observability_collection_failures_total.');
  }

  const subsystems = stack?.subsystems ?? [];
  for (const subsystemId of REQUIRED_SUBSYSTEM_IDS) {
    const subsystem = subsystems.find((entry) => entry.id === subsystemId);
    if (!subsystem) {
      violations.push(`Observability stack must define subsystem ${subsystemId}.`);
      continue;
    }

    if (!['scrape', 'hybrid', 'push'].includes(subsystem.collection_mode)) {
      violations.push(`Observability subsystem ${subsystemId} must use a supported collection_mode.`);
    }

    if (!Array.isArray(subsystem.supported_scopes) || subsystem.supported_scopes.length === 0) {
      violations.push(`Observability subsystem ${subsystemId} must define supported_scopes.`);
    }

    for (const category of REQUIRED_METRIC_CATEGORIES) {
      if (!Array.isArray(subsystem.metric_categories?.[category]) || subsystem.metric_categories[category].length === 0) {
        violations.push(`Observability subsystem ${subsystemId} must define metric category ${category}.`);
      }
    }

    if (typeof subsystem.target?.interval_seconds !== 'number' || subsystem.target.interval_seconds <= 0) {
      violations.push(`Observability subsystem ${subsystemId} must define a positive target.interval_seconds.`);
    }

    if (
      typeof subsystem.target?.max_staleness_seconds !== 'number' ||
      subsystem.target.max_staleness_seconds <= subsystem.target.interval_seconds
    ) {
      violations.push(`Observability subsystem ${subsystemId} max_staleness_seconds must exceed interval_seconds.`);
    }
  }

  if (Object.prototype.hasOwnProperty.call(values?.observability ?? {}, 'enabled')) {
    violations.push('Helm values must not expose observability.enabled; observability is core.');
  }

  const stackValues = values?.observability?.config?.inline?.metricsStack ?? {};
  if (stackValues.version !== stack.version) {
    violations.push('Helm observability metricsStack.version must align with the internal contract version.');
  }

  if (stackValues.model !== stack.operating_targets?.collection_model) {
    violations.push('Helm observability metricsStack.model must align with the contract collection model.');
  }

  if (stackValues.collectionHealth?.metricName !== stack.collection_health?.metric_name) {
    violations.push('Helm observability collectionHealth.metricName must align with the contract metric_name.');
  }

  for (const label of ['environment', 'subsystem', 'metricScope', 'collectionMode']) {
    if (!(stackValues.requiredLabels ?? []).includes(label)) {
      violations.push(`Helm observability requiredLabels must include ${label}.`);
    }
  }

  for (const subsystemId of REQUIRED_SUBSYSTEM_IDS) {
    const chartKey = toChartTargetKey(subsystemId);
    const chartTarget = stackValues.componentTargets?.[chartKey];
    const subsystem = subsystems.find((entry) => entry.id === subsystemId);

    if (!chartTarget) {
      violations.push(`Helm observability componentTargets must define ${chartKey}.`);
      continue;
    }

    if (chartTarget.collectionMode !== subsystem?.collection_mode) {
      violations.push(`Helm observability target ${chartKey} must align collectionMode with the internal contract.`);
    }

    if (chartTarget.metricsPath !== subsystem?.target?.metrics_path) {
      violations.push(`Helm observability target ${chartKey} must align metricsPath with the internal contract.`);
    }
  }

  return violations;
}
