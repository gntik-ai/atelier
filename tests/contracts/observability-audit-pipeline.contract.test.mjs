import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  OBSERVABILITY_AUDIT_PIPELINE_VERSION,
  getAuditPipelineHealthSignals,
  getAuditPipelineTenantIsolation,
  getAuditPipelineTopology,
  listAuditPipelineSubsystems,
  readObservabilityAuditPipeline,
  readObservabilityHealthChecks,
  readObservabilityMetricsStack
} from '../../services/internal-contracts/src/index.mjs';
import { collectAuditPipelineViolations } from '../../scripts/lib/observability-audit-pipeline.mjs';

test('observability audit pipeline contract is exposed through shared readers', () => {
  const contract = readObservabilityAuditPipeline();
  const subsystems = listAuditPipelineSubsystems();
  const topology = getAuditPipelineTopology();
  const healthSignals = getAuditPipelineHealthSignals();
  const tenantIsolation = getAuditPipelineTenantIsolation();

  assert.equal(contract.version, '2026-03-28');
  assert.equal(OBSERVABILITY_AUDIT_PIPELINE_VERSION, '2026-03-28');
  assert.equal(subsystems.length, 8);
  assert.equal(topology.transport_backbone, 'kafka');
  assert.equal(healthSignals.length, 3);
  assert.equal(Array.isArray(tenantIsolation.required_fields), true);
});

test('observability audit pipeline contract passes deterministic validation', () => {
  const violations = collectAuditPipelineViolations();
  assert.deepEqual(violations, []);
});

test('source contract versions align with metrics and health baselines', () => {
  const auditPipeline = readObservabilityAuditPipeline();
  const metricsStack = readObservabilityMetricsStack();
  const healthChecks = readObservabilityHealthChecks();

  assert.equal(auditPipeline.source_metrics_contract, metricsStack.version);
  assert.equal(auditPipeline.source_health_contract, healthChecks.version);
});

test('shared readers return the expected subsystem, topology, health-signal, and isolation structures', () => {
  const subsystemIds = listAuditPipelineSubsystems().map((subsystem) => subsystem.id);
  const topology = getAuditPipelineTopology();
  const signalIds = getAuditPipelineHealthSignals().map((signal) => signal.id);
  const isolation = getAuditPipelineTenantIsolation();

  assert.deepEqual(subsystemIds, [
    'iam',
    'postgresql',
    'mongodb',
    'kafka',
    'openwhisk',
    'storage',
    'quota_metering',
    'tenant_control_plane'
  ]);
  assert.deepEqual(topology.topology_path, ['subsystem_emitter', 'kafka_audit_transport', 'durable_audit_store']);
  assert.deepEqual(signalIds, ['audit_emission_freshness', 'audit_transport_health', 'audit_storage_health']);
  assert.equal(isolation.required_fields.includes('tenant_id'), true);
  assert.equal(isolation.optional_fields.includes('workspace_id'), true);
});

test('all audit health signals align with the metrics-stack required labels and health vocabulary', () => {
  const metricsLabels = new Set(readObservabilityMetricsStack().naming?.required_labels ?? []);
  const healthVocabulary = new Set(readObservabilityHealthChecks().dashboard_alignment?.compatible_health_states ?? []);

  for (const signal of getAuditPipelineHealthSignals()) {
    assert.equal(signal.metric_name.startsWith('in_atelier_audit_'), true, `${signal.id} must use in_atelier_audit_`);

    for (const label of signal.required_labels ?? []) {
      assert.equal(metricsLabels.has(label), true, `metrics-stack must include required label ${label}`);
    }

    for (const status of signal.status_values ?? []) {
      assert.equal(healthVocabulary.has(status), true, `health vocabulary must include ${status}`);
    }
  }
});

test('architecture README and task summary document the observability audit pipeline baseline', () => {
  const architectureIndex = readFileSync('docs/reference/architecture/README.md', 'utf8');
  const taskSummary = readFileSync('docs/tasks/us-obs-02.md', 'utf8');

  assert.equal(architectureIndex.includes('observability-audit-pipeline.md'), true);
  assert.equal(architectureIndex.includes('US-OBS-02-T01'), true);
  assert.equal(taskSummary.includes('US-OBS-02-T01'), true);
  assert.equal(taskSummary.includes('validate:observability-audit-pipeline'), true);
});

test('package.json wires validate:observability-audit-pipeline into validate:repo', () => {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));

  assert.equal(typeof packageJson.scripts['validate:observability-audit-pipeline'], 'string');
  assert.equal(packageJson.scripts['validate:repo'].includes('validate:observability-audit-pipeline'), true);
});
