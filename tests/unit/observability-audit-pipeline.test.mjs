import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectAuditPipelineViolations,
  readObservabilityAuditPipeline,
  readObservabilityHealthChecks,
  readObservabilityMetricsStack
} from '../../scripts/lib/observability-audit-pipeline.mjs';

test('observability audit pipeline contract remains internally consistent', () => {
  const violations = collectAuditPipelineViolations();
  assert.deepEqual(violations, []);
});

test('collectAuditPipelineViolations reports a missing required subsystem by name', () => {
  const contract = structuredClone(readObservabilityAuditPipeline());
  contract.subsystem_roster = contract.subsystem_roster.filter((subsystem) => subsystem.id !== 'iam');

  const violations = collectAuditPipelineViolations(
    contract,
    readObservabilityMetricsStack(),
    readObservabilityHealthChecks()
  );

  assert.equal(
    violations.includes('Observability audit pipeline must define subsystem iam.'),
    true
  );
});

test('collectAuditPipelineViolations reports empty required_event_categories', () => {
  const contract = structuredClone(readObservabilityAuditPipeline());
  const iam = contract.subsystem_roster.find((subsystem) => subsystem.id === 'iam');
  iam.required_event_categories = [];

  const violations = collectAuditPipelineViolations(
    contract,
    readObservabilityMetricsStack(),
    readObservabilityHealthChecks()
  );

  assert.equal(
    violations.includes('Observability audit subsystem iam must define required_event_categories.'),
    true
  );
});

test('collectAuditPipelineViolations reports a missing transport_backbone', () => {
  const contract = structuredClone(readObservabilityAuditPipeline());
  delete contract.pipeline_topology.transport_backbone;

  const violations = collectAuditPipelineViolations(
    contract,
    readObservabilityMetricsStack(),
    readObservabilityHealthChecks()
  );

  assert.equal(
    violations.includes('Observability audit pipeline transport_backbone must be kafka.'),
    true
  );
});

test('collectAuditPipelineViolations reports source_metrics_contract mismatches', () => {
  const contract = structuredClone(readObservabilityAuditPipeline());
  contract.source_metrics_contract = '1900-01-01';

  const violations = collectAuditPipelineViolations(
    contract,
    readObservabilityMetricsStack(),
    readObservabilityHealthChecks()
  );

  assert.equal(
    violations.includes(
      'Observability audit pipeline source_metrics_contract must align with observability-metrics-stack.json version.'
    ),
    true
  );
});
