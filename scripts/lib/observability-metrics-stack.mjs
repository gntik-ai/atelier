import { readJson, readYaml } from './quality-gates.mjs';

export const OBSERVABILITY_METRICS_STACK_PATH = 'services/internal-contracts/src/observability-metrics-stack.json';
export const BASE_VALUES_PATH = 'charts/in-falcone/values.yaml';

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

  if (values?.observability?.enabled !== true) {
    violations.push('Helm values must keep observability.enabled=true.');
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
