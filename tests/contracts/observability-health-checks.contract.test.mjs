import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  getObservabilityHealthComponent,
  getObservabilityProbeType,
  getObservabilityHealthExposureTemplates,
  getObservabilityHealthProjection,
  listObservabilityHealthComponents,
  listObservabilityProbeTypes,
  listObservabilityMetricFamilies,
  listObservedSubsystems,
  readObservabilityHealthChecks,
  readObservabilityMetricsStack,
  OBSERVABILITY_HEALTH_CHECKS_VERSION
} from '../../services/internal-contracts/src/index.mjs';
import { collectObservabilityHealthCheckViolations } from '../../scripts/lib/observability-health-checks.mjs';

// ---------------------------------------------------------------------------
// Core contract exposure
// ---------------------------------------------------------------------------

test('observability health checks contract is exposed through shared readers', () => {
  const contract = readObservabilityHealthChecks();
  const probeTypes = listObservabilityProbeTypes();
  const components = listObservabilityHealthComponents();
  const exposureTemplates = getObservabilityHealthExposureTemplates();
  const projection = getObservabilityHealthProjection();

  assert.equal(contract.version, '2026-03-28');
  assert.equal(OBSERVABILITY_HEALTH_CHECKS_VERSION, '2026-03-28');
  assert.equal(probeTypes.length, 3);
  assert.equal(components.length, 7);

  assert.equal(typeof exposureTemplates.aggregate, 'object');
  assert.equal(typeof exposureTemplates.component, 'object');
  assert.equal(typeof projection.status_metric, 'string');
  assert.equal(typeof projection.duration_metric, 'string');
  assert.equal(typeof projection.failure_counter, 'string');
});

test('observability health checks contract passes deterministic validation', () => {
  const violations = collectObservabilityHealthCheckViolations();
  assert.deepEqual(violations, []);
});

// ---------------------------------------------------------------------------
// Probe types completeness
// ---------------------------------------------------------------------------

test('getObservabilityProbeType returns probe types by id', () => {
  const liveness = getObservabilityProbeType('liveness');
  const readiness = getObservabilityProbeType('readiness');
  const health = getObservabilityProbeType('health');
  const missing = getObservabilityProbeType('nonexistent');

  assert.equal(liveness.primary_audience, 'orchestration');
  assert.equal(readiness.primary_audience, 'orchestration_and_operations');
  assert.equal(health.primary_audience, 'operations');
  assert.equal(missing, undefined);
});

test('liveness probe cannot report degraded or not_ready — these are readiness/health statuses', () => {
  const liveness = getObservabilityProbeType('liveness');
  const statuses = new Set(liveness.allowed_statuses);

  assert.equal(statuses.has('live'), true);
  assert.equal(statuses.has('dead'), true);
  assert.equal(statuses.has('unknown'), true);
  assert.equal(statuses.has('degraded'), false);
  assert.equal(statuses.has('not_ready'), false);
});

test('health probe includes stale and inherited statuses absent from liveness', () => {
  const liveness = getObservabilityProbeType('liveness');
  const health = getObservabilityProbeType('health');

  assert.equal(health.allowed_statuses.includes('stale'), true);
  assert.equal(health.allowed_statuses.includes('inherited'), true);
  assert.equal(liveness.allowed_statuses.includes('stale'), false);
  assert.equal(liveness.allowed_statuses.includes('inherited'), false);
});

// ---------------------------------------------------------------------------
// Component catalog completeness
// ---------------------------------------------------------------------------

test('getObservabilityHealthComponent returns components by id', () => {
  const apisix = getObservabilityHealthComponent('apisix');
  const controlPlane = getObservabilityHealthComponent('control_plane');
  const missing = getObservabilityHealthComponent('nonexistent');

  assert.equal(apisix.display_name, 'APISIX');
  assert.equal(controlPlane.display_name, 'Control plane');
  assert.equal(missing, undefined);
});

test('every required component supports all three probe types', () => {
  const components = listObservabilityHealthComponents();
  const required = ['apisix', 'kafka', 'postgresql', 'mongodb', 'openwhisk', 'storage', 'control_plane'];

  for (const componentId of required) {
    const component = components.find((c) => c.id === componentId);
    assert.ok(component, `component ${componentId} must be present in the health-check contract`);
    assert.equal(component.probe_support.includes('liveness'), true, `${componentId} must support liveness`);
    assert.equal(component.probe_support.includes('readiness'), true, `${componentId} must support readiness`);
    assert.equal(component.probe_support.includes('health'), true, `${componentId} must support health`);
  }
});

// ---------------------------------------------------------------------------
// Alignment with the observability metrics-stack contract
// ---------------------------------------------------------------------------

test('health-check contract source_metrics_contract aligns with metrics-stack version', () => {
  const contract = readObservabilityHealthChecks();
  const metricsStack = readObservabilityMetricsStack();

  assert.equal(contract.source_metrics_contract, metricsStack.version);
});

test('health-check component ids align with metrics-stack subsystem catalog', () => {
  const components = listObservabilityHealthComponents();
  const subsystems = listObservedSubsystems();
  const subsystemIds = new Set(subsystems.map((s) => s.id));

  for (const component of components) {
    assert.equal(
      subsystemIds.has(component.id),
      true,
      `health-check component ${component.id} must exist in metrics-stack subsystems`
    );
  }
});

test('health-check metric projection aligns with metrics-stack probe family names', () => {
  const projection = getObservabilityHealthProjection();
  const metricFamilies = listObservabilityMetricFamilies();
  const familyByName = new Map(metricFamilies.map((f) => [f.name, f]));

  assert.ok(familyByName.has(projection.status_metric), `status_metric ${projection.status_metric} must exist in metrics-stack`);
  assert.ok(familyByName.has(projection.duration_metric), `duration_metric ${projection.duration_metric} must exist in metrics-stack`);
  assert.ok(familyByName.has(projection.failure_counter), `failure_counter ${projection.failure_counter} must exist in metrics-stack`);
  assert.equal(familyByName.get(projection.status_metric).type, 'gauge');
  assert.equal(familyByName.get(projection.duration_metric).type, 'histogram');
  assert.equal(familyByName.get(projection.failure_counter).type, 'counter');
});

test('probe metric families carry probe_type and exposure_kind labels', () => {
  const metricFamilies = listObservabilityMetricFamilies();
  const probeIds = ['component_probe_status', 'component_probe_duration_seconds', 'component_probe_failures_total'];

  for (const probeId of probeIds) {
    const family = metricFamilies.find((f) => f.id === probeId);
    assert.ok(family, `metrics-stack must define family ${probeId}`);
    assert.equal(family.required_labels.includes('probe_type'), true, `${probeId} must require probe_type label`);
    assert.equal(family.required_labels.includes('exposure_kind'), true, `${probeId} must require exposure_kind label`);
  }
});

// ---------------------------------------------------------------------------
// Exposure templates — internal-only invariant
// ---------------------------------------------------------------------------

test('all aggregate exposure templates are marked internal_only and use /internal/ paths', () => {
  const templates = getObservabilityHealthExposureTemplates();

  for (const probeId of ['liveness', 'readiness', 'health']) {
    const template = templates.aggregate?.[probeId];
    assert.ok(template, `aggregate exposure must define probe ${probeId}`);
    assert.equal(template.internal_only, true, `aggregate ${probeId} exposure must be internal_only`);
    assert.equal(template.path.startsWith('/internal/'), true, `aggregate ${probeId} path must start with /internal/`);
  }
});

test('all component exposure templates are marked internal_only and include {componentId}', () => {
  const templates = getObservabilityHealthExposureTemplates();

  for (const probeId of ['liveness', 'readiness', 'health']) {
    const template = templates.component?.[probeId];
    assert.ok(template, `component exposure must define probe ${probeId}`);
    assert.equal(template.internal_only, true, `component ${probeId} exposure must be internal_only`);
    assert.equal(template.path.includes('{componentId}'), true, `component ${probeId} path must include {componentId}`);
  }
});

test('aggregate exposure paths map to the canonical internal routes', () => {
  const templates = getObservabilityHealthExposureTemplates();

  assert.equal(templates.aggregate.liveness.path, '/internal/live');
  assert.equal(templates.aggregate.readiness.path, '/internal/ready');
  assert.equal(templates.aggregate.health.path, '/internal/health');
});

// ---------------------------------------------------------------------------
// Dashboard alignment
// ---------------------------------------------------------------------------

test('dashboard_alignment includes all required health states', () => {
  const contract = readObservabilityHealthChecks();
  const compatibleStates = new Set(contract.dashboard_alignment?.compatible_health_states ?? []);

  for (const state of ['healthy', 'degraded', 'unavailable', 'unknown', 'stale', 'inherited']) {
    assert.equal(compatibleStates.has(state), true, `dashboard alignment must include health state ${state}`);
  }
});

// ---------------------------------------------------------------------------
// Masking and audit fields
// ---------------------------------------------------------------------------

test('masking policy defines forbidden fields covering credentials and topology', () => {
  const contract = readObservabilityHealthChecks();
  const forbidden = new Set(contract.masking_policy?.forbidden_exposed_fields ?? []);

  for (const field of ['password', 'secret', 'token', 'connection_string', 'raw_hostname', 'raw_endpoint']) {
    assert.equal(forbidden.has(field), true, `masking_policy must forbid field ${field}`);
  }
});

test('audit context captures actor, correlation, component, and probe_type fields', () => {
  const contract = readObservabilityHealthChecks();
  const captured = new Set(contract.audit_context?.required_fields ?? []);

  for (const field of ['actor_id', 'probe_type', 'component_id', 'correlation_id']) {
    assert.equal(captured.has(field), true, `audit_context must capture field ${field}`);
  }
});

// ---------------------------------------------------------------------------
// Documentation and package.json discoverability
// ---------------------------------------------------------------------------

test('architecture README documents the observability health-check baseline', () => {
  const architectureIndex = readFileSync('docs/reference/architecture/README.md', 'utf8');

  assert.equal(architectureIndex.includes('observability-health-checks.json'), true);
  assert.equal(architectureIndex.includes('observability-health-checks.md'), true);
  assert.equal(architectureIndex.includes('US-OBS-01-T03'), true);
});

test('architecture guide exists and references liveness, readiness, and health concepts', () => {
  const guide = readFileSync('docs/reference/architecture/observability-health-checks.md', 'utf8');

  assert.equal(guide.includes('liveness'), true);
  assert.equal(guide.includes('readiness'), true);
  assert.equal(guide.includes('health'), true);
  assert.equal(guide.includes('/internal/'), true);
});

test('task summary documents the US-OBS-01-T03 slice and validate:observability-health-checks command', () => {
  const taskSummary = readFileSync('docs/tasks/us-obs-01.md', 'utf8');

  assert.equal(taskSummary.includes('US-OBS-01-T03'), true);
  assert.equal(taskSummary.includes('validate:observability-health-checks'), true);
  assert.equal(taskSummary.includes('observability-health-checks.json'), true);
});

test('package.json exposes validate:observability-health-checks and wires it into validate:repo', () => {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));

  assert.equal(typeof packageJson.scripts['validate:observability-health-checks'], 'string');
  assert.equal(
    packageJson.scripts['validate:repo'].includes('validate:observability-health-checks'),
    true
  );
});
