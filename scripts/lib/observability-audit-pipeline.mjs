import { readJson } from './quality-gates.mjs';

export const OBSERVABILITY_AUDIT_PIPELINE_PATH = 'services/internal-contracts/src/observability-audit-pipeline.json';
export const OBSERVABILITY_METRICS_STACK_PATH = 'services/internal-contracts/src/observability-metrics-stack.json';
export const OBSERVABILITY_HEALTH_CHECKS_PATH = 'services/internal-contracts/src/observability-health-checks.json';
export const ARCHITECTURE_AUDIT_DOC_PATH = 'docs/reference/architecture/observability-audit-pipeline.md';
export const ARCHITECTURE_README_PATH = 'docs/reference/architecture/README.md';
export const OBS_TASK_DOC_PATH = 'docs/tasks/us-obs-02.md';
export const PACKAGE_JSON_PATH = 'package.json';

const REQUIRED_SUBSYSTEM_IDS = [
  'iam',
  'postgresql',
  'mongodb',
  'kafka',
  'openwhisk',
  'storage',
  'quota_metering',
  'tenant_control_plane'
];
const REQUIRED_HEALTH_SIGNAL_IDS = ['audit_emission_freshness', 'audit_transport_health', 'audit_storage_health'];
const REQUIRED_LABELS = ['environment', 'subsystem', 'metric_scope', 'collection_mode'];
const REQUIRED_STATUS_VOCABULARY = ['healthy', 'degraded', 'unavailable', 'unknown', 'stale'];
const MINIMUM_EVENT_CATEGORIES = ['resource_creation', 'resource_deletion', 'configuration_change', 'access_control_modification'];

export function readObservabilityAuditPipeline() {
  return readJson(OBSERVABILITY_AUDIT_PIPELINE_PATH);
}

export function readObservabilityMetricsStack() {
  return readJson(OBSERVABILITY_METRICS_STACK_PATH);
}

export function readObservabilityHealthChecks() {
  return readJson(OBSERVABILITY_HEALTH_CHECKS_PATH);
}

function indexBy(items = [], keyField = 'id') {
  return new Map(items.map((item) => [item?.[keyField], item]));
}

export function collectAuditPipelineViolations(
  contract = readObservabilityAuditPipeline(),
  metricsStack = readObservabilityMetricsStack(),
  healthChecks = readObservabilityHealthChecks()
) {
  const violations = [];

  if (typeof contract?.version !== 'string' || contract.version.length === 0) {
    violations.push('Observability audit pipeline contract version must be a non-empty string.');
  }

  if (contract?.source_metrics_contract !== metricsStack?.version) {
    violations.push('Observability audit pipeline source_metrics_contract must align with observability-metrics-stack.json version.');
  }

  if (contract?.source_health_contract !== healthChecks?.version) {
    violations.push('Observability audit pipeline source_health_contract must align with observability-health-checks.json version.');
  }

  if (!Array.isArray(contract?.principles) || contract.principles.length < 3) {
    violations.push('Observability audit pipeline must define at least three governing principles.');
  }

  const subsystemMap = indexBy(contract?.subsystem_roster ?? []);
  for (const subsystemId of REQUIRED_SUBSYSTEM_IDS) {
    const subsystem = subsystemMap.get(subsystemId);
    if (!subsystem) {
      violations.push(`Observability audit pipeline must define subsystem ${subsystemId}.`);
      continue;
    }

    if (!Array.isArray(subsystem.required_event_categories) || subsystem.required_event_categories.length === 0) {
      violations.push(`Observability audit subsystem ${subsystemId} must define required_event_categories.`);
      continue;
    }

    for (const category of MINIMUM_EVENT_CATEGORIES) {
      if (
        ['iam', 'postgresql', 'mongodb', 'kafka', 'storage', 'tenant_control_plane'].includes(subsystemId) &&
        !subsystem.required_event_categories.includes(category)
      ) {
        violations.push(`Observability audit subsystem ${subsystemId} must require event category ${category}.`);
      }
    }

    if (subsystemId === 'openwhisk' && !subsystem.required_event_categories.includes('quota_adjustment')) {
      violations.push('Observability audit subsystem openwhisk must require event category quota_adjustment.');
    }

    if (subsystemId === 'quota_metering') {
      for (const category of ['quota_adjustment', 'configuration_change', 'resource_creation', 'resource_deletion']) {
        if (!subsystem.required_event_categories.includes(category)) {
          violations.push(`Observability audit subsystem quota_metering must require event category ${category}.`);
        }
      }
    }

    if (!['tenant', 'platform', 'both'].includes(subsystem.scope_attribution)) {
      violations.push(`Observability audit subsystem ${subsystemId} must use scope_attribution tenant, platform, or both.`);
    }

    if (
      typeof subsystem.emission_freshness_threshold_seconds !== 'number' ||
      subsystem.emission_freshness_threshold_seconds <= 0
    ) {
      violations.push(`Observability audit subsystem ${subsystemId} must define a positive emission_freshness_threshold_seconds.`);
    }
  }

  if (contract?.pipeline_topology?.transport_backbone !== 'kafka') {
    violations.push('Observability audit pipeline transport_backbone must be kafka.');
  }

  if (contract?.delivery_guarantees?.semantics !== 'at_least_once') {
    violations.push('Observability audit pipeline delivery semantics must be at_least_once.');
  }

  if (!(contract?.tenant_isolation?.required_fields ?? []).includes('tenant_id')) {
    violations.push('Observability audit pipeline tenant_isolation.required_fields must include tenant_id.');
  }

  if (!(contract?.tenant_isolation?.optional_fields ?? []).includes('workspace_id')) {
    violations.push('Observability audit pipeline tenant_isolation.optional_fields must include workspace_id.');
  }

  if (contract?.tenant_isolation?.platform_event_routing !== 'platform-scoped events are routed only to audit.platform') {
    violations.push('Observability audit pipeline platform_event_routing must reserve audit.platform for platform-scoped events.');
  }

  const metricFamilyNames = new Set((metricsStack?.naming?.normalized_metric_families ?? []).map((family) => family?.name));
  const metricsRequiredLabels = new Set(metricsStack?.naming?.required_labels ?? []);
  const healthStatusVocabulary = new Set(
    (healthChecks?.dashboard_alignment?.compatible_health_states ?? []).map((status) => status)
  );
  const healthSignalMap = indexBy(contract?.health_signals ?? []);

  for (const signalId of REQUIRED_HEALTH_SIGNAL_IDS) {
    const signal = healthSignalMap.get(signalId);
    if (!signal) {
      violations.push(`Observability audit pipeline must define health signal ${signalId}.`);
      continue;
    }

    if (!signal.metric_name?.startsWith('in_atelier_audit_')) {
      violations.push(`Observability audit health signal ${signalId} must use an in_atelier_audit_ metric name.`);
    }

    for (const label of REQUIRED_LABELS) {
      if (!(signal.required_labels ?? []).includes(label)) {
        violations.push(`Observability audit health signal ${signalId} must require label ${label}.`);
      }

      if (!metricsRequiredLabels.has(label)) {
        violations.push(`Observability metrics stack naming.required_labels must include ${label} for audit signal alignment.`);
      }
    }

    for (const status of signal.status_values ?? []) {
      if (!healthStatusVocabulary.has(status)) {
        violations.push(`Observability audit health signal ${signalId} references unknown status value ${status}.`);
      }
    }
  }

  if (!metricFamilyNames.has(healthChecks?.observability_projection?.status_metric)) {
    violations.push('Observability health checks status_metric must resolve from observability-metrics-stack.json for audit alignment.');
  }

  for (const status of REQUIRED_STATUS_VOCABULARY) {
    if (!(contract?.observability_projection?.required_status_vocabulary ?? []).includes(status)) {
      violations.push(`Observability audit pipeline must include status vocabulary ${status}.`);
    }
  }

  const forbiddenExposedFields = contract?.masking_policy?.forbidden_exposed_fields ?? [];
  for (const field of healthChecks?.masking_policy?.forbidden_exposed_fields ?? []) {
    if (!forbiddenExposedFields.includes(field)) {
      violations.push(`Observability audit pipeline masking_policy must include forbidden field ${field}.`);
    }
  }

  if (contract?.self_audit?.config_change_audit_requirement !== 'pipeline_configuration_changes_must_emit_audit_events_through_this_same_pipeline') {
    violations.push('Observability audit pipeline must require pipeline configuration changes to emit self-audit events.');
  }

  return violations;
}
