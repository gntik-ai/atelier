import { readJson } from './quality-gates.mjs';

export const OBSERVABILITY_HEALTH_CHECKS_PATH = 'services/internal-contracts/src/observability-health-checks.json';
export const OBSERVABILITY_METRICS_STACK_PATH = 'services/internal-contracts/src/observability-metrics-stack.json';
export const OBSERVABILITY_DASHBOARDS_PATH = 'services/internal-contracts/src/observability-dashboards.json';
export const ARCHITECTURE_HEALTH_DOC_PATH = 'docs/reference/architecture/observability-health-checks.md';
export const ARCHITECTURE_README_PATH = 'docs/reference/architecture/README.md';
export const OBS_TASK_DOC_PATH = 'docs/tasks/us-obs-01.md';
export const PACKAGE_JSON_PATH = 'package.json';

const REQUIRED_PROBE_IDS = ['liveness', 'readiness', 'health'];
const REQUIRED_COMPONENT_IDS = ['apisix', 'kafka', 'postgresql', 'mongodb', 'openwhisk', 'storage', 'control_plane'];
const REQUIRED_METRIC_FAMILY_IDS = ['component_probe_status', 'component_probe_duration_seconds', 'component_probe_failures_total'];
const REQUIRED_AUDIT_FIELDS = ['actor_id', 'probe_type', 'component_id', 'correlation_id'];

export function readObservabilityHealthChecks() {
  return readJson(OBSERVABILITY_HEALTH_CHECKS_PATH);
}

export function readObservabilityMetricsStack() {
  return readJson(OBSERVABILITY_METRICS_STACK_PATH);
}

export function readObservabilityDashboards() {
  return readJson(OBSERVABILITY_DASHBOARDS_PATH);
}

export function readPackageJson() {
  return readJson(PACKAGE_JSON_PATH);
}

function indexBy(items = [], keyField = 'id') {
  return new Map(items.map((item) => [item?.[keyField], item]));
}

export function collectObservabilityHealthCheckViolations(
  healthChecks = readObservabilityHealthChecks(),
  metricsStack = readObservabilityMetricsStack(),
  dashboards = readObservabilityDashboards(),
  packageJson = readPackageJson()
) {
  const violations = [];

  if (typeof healthChecks?.version !== 'string' || healthChecks.version.length === 0) {
    violations.push('Observability health checks contract version must be a non-empty string.');
  }

  if (healthChecks?.source_metrics_contract !== metricsStack?.version) {
    violations.push('Observability health checks source_metrics_contract must align with observability-metrics-stack.json version.');
  }

  if (healthChecks?.source_dashboard_contract !== dashboards?.version) {
    violations.push('Observability health checks source_dashboard_contract must align with observability-dashboards.json version.');
  }

  const probeTypeMap = indexBy(healthChecks?.probe_types ?? []);
  for (const probeId of REQUIRED_PROBE_IDS) {
    const probe = probeTypeMap.get(probeId);
    if (!probe) {
      violations.push(`Observability health checks must define probe type ${probeId}.`);
      continue;
    }

    if (!Array.isArray(probe.allowed_statuses) || probe.allowed_statuses.length === 0) {
      violations.push(`Observability health checks probe type ${probeId} must declare allowed_statuses.`);
    }
  }

  const metricFamilyMap = indexBy(metricsStack?.naming?.normalized_metric_families ?? []);
  for (const metricFamilyId of REQUIRED_METRIC_FAMILY_IDS) {
    if (!metricFamilyMap.has(metricFamilyId)) {
      violations.push(`Observability metrics stack must define metric family ${metricFamilyId} for health checks.`);
    }
  }

  const healthProjection = healthChecks?.observability_projection ?? {};
  if (metricFamilyMap.get('component_probe_status')?.name !== healthProjection.status_metric) {
    violations.push('Observability health checks status_metric must align with metrics-stack component_probe_status family.');
  }
  if (metricFamilyMap.get('component_probe_duration_seconds')?.name !== healthProjection.duration_metric) {
    violations.push('Observability health checks duration_metric must align with metrics-stack component_probe_duration_seconds family.');
  }
  if (metricFamilyMap.get('component_probe_failures_total')?.name !== healthProjection.failure_counter) {
    violations.push('Observability health checks failure_counter must align with metrics-stack component_probe_failures_total family.');
  }

  const subsystemIds = new Set((metricsStack?.subsystems ?? []).map((subsystem) => subsystem.id));
  const metricsScopes = new Set([
    metricsStack?.naming?.tenant_isolation?.platform_scope_value ?? 'platform',
    metricsStack?.naming?.tenant_isolation?.tenant_scope_value ?? 'tenant',
    metricsStack?.naming?.tenant_isolation?.workspace_scope_value ?? 'workspace'
  ]);
  const componentMap = indexBy(healthChecks?.components ?? []);
  for (const componentId of REQUIRED_COMPONENT_IDS) {
    const component = componentMap.get(componentId);
    if (!component) {
      violations.push(`Observability health checks must define component ${componentId}.`);
      continue;
    }

    if (!subsystemIds.has(component.id)) {
      violations.push(`Observability health checks component ${component.id} must exist in observability-metrics-stack.json subsystems.`);
    }

    for (const probeId of REQUIRED_PROBE_IDS) {
      if (!(component.probe_support ?? []).includes(probeId)) {
        violations.push(`Observability health checks component ${component.id} must support probe ${probeId}.`);
      }
    }

    for (const scope of component.supported_metric_scopes ?? []) {
      if (!metricsScopes.has(scope)) {
        violations.push(`Observability health checks component ${component.id} references unknown metric scope ${scope}.`);
      }
    }

    if (!component.metric_projection?.status_metric || !component.metric_projection?.duration_metric || !component.metric_projection?.failure_counter) {
      violations.push(`Observability health checks component ${component.id} must define complete metric projection metadata.`);
    }
  }

  for (const field of REQUIRED_AUDIT_FIELDS) {
    if (!(healthChecks?.audit_context?.required_fields ?? []).includes(field)) {
      violations.push(`Observability health checks must capture audit field ${field}.`);
    }
  }

  const exposureTemplates = healthChecks?.exposure_templates ?? {};
  for (const exposureKind of ['aggregate', 'component']) {
    const templates = exposureTemplates[exposureKind] ?? {};
    for (const probeId of REQUIRED_PROBE_IDS) {
      const template = templates[probeId];
      if (!template) {
        violations.push(`Observability health checks ${exposureKind} exposure must define probe ${probeId}.`);
        continue;
      }

      if (template.internal_only !== true) {
        violations.push(`Observability health checks ${exposureKind} ${probeId} exposure must be internal_only=true.`);
      }

      if (typeof template.path !== 'string' || !template.path.startsWith('/internal/')) {
        violations.push(`Observability health checks ${exposureKind} ${probeId} exposure must use an /internal/ path.`);
      }

      if (exposureKind === 'component' && !template.path.includes('{componentId}')) {
        violations.push(`Observability health checks component ${probeId} exposure must include {componentId} in the path template.`);
      }
    }
  }

  const compatibleHealthStates = new Set(healthChecks?.dashboard_alignment?.compatible_health_states ?? []);
  for (const state of ['healthy', 'degraded', 'unavailable', 'unknown', 'stale', 'inherited']) {
    if (!compatibleHealthStates.has(state)) {
      violations.push(`Observability health checks dashboard alignment must include compatible health state ${state}.`);
    }
  }

  if (!packageJson?.scripts?.['validate:observability-health-checks']) {
    violations.push('package.json must define script validate:observability-health-checks.');
  }

  const validateRepoScript = packageJson?.scripts?.['validate:repo'] ?? '';
  if (!validateRepoScript.includes('validate:observability-health-checks')) {
    violations.push('package.json validate:repo must include validate:observability-health-checks.');
  }

  return violations;
}
