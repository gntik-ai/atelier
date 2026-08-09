import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import {
  getObservabilityCollectionHealth,
  getObservabilityContract,
  getObservedSubsystem,
  listObservabilityMetricFamilies,
  listObservedSubsystems,
  readObservabilityMetricsStack
} from '../../packages/internal-contracts/src/index.mjs';
import {
  collectMcpToolCallDurationDescriptorViolations,
  readBaseValues,
  readObservabilityStackValues,
} from '../../scripts/lib/observability-metrics-stack.mjs';
import { mcpToolCallTelemetry } from '../../apps/control-plane-executor/src/mcp-observability.mjs';

test('observability metrics stack contract is exposed through shared readers', () => {
  const stack = readObservabilityMetricsStack();
  const subsystems = listObservedSubsystems();
  const metricFamilies = listObservabilityMetricFamilies();
  const collectionHealth = getObservabilityCollectionHealth();
  const apisix = getObservedSubsystem('apisix');
  const controlPlane = getObservedSubsystem('control_plane');

  assert.equal(stack.version, '2026-03-28');
  assert.equal(getObservabilityContract('metric_family_descriptor').version, '2026-03-28');
  assert.equal(subsystems.length, 7);
  assert.equal(metricFamilies.length >= 4, true);
  assert.equal(collectionHealth.metric_name, 'in_falcone_observability_collection_health');
  assert.equal(apisix.target.metrics_path, '/apisix/prometheus/metrics');
  assert.equal(controlPlane.target.metrics_path, '/metrics');
  assert.equal(stack.naming.tenant_isolation.tenant_label, 'tenant_id');
  assert.equal(stack.naming.cardinality_controls.forbidden_labels.includes('raw_path'), true);
});

test('normalized duration contains one isolated MCP tool-call slice with exact buckets', () => {
  const stack = readObservabilityMetricsStack();
  const duration = stack.naming.normalized_metric_families
    .find((family) => family.id === 'component_operation_duration_seconds');
  assert.equal(Object.hasOwn(duration, 'allowed_optional_labels'), false);
  assert.equal(duration.slice_policies.length, 1);
  const [slice] = duration.slice_policies;
  assert.deepEqual(slice.match_labels, { subsystem: 'mcp', operation: 'tool_call' });
  assert.deepEqual(slice.supported_scopes, ['tenant', 'workspace']);
  assert.deepEqual(slice.allowed_status_classes, ['success', 'error', 'denied']);
  assert.deepEqual(slice.histogram_buckets_seconds, stack.naming.latency_histogram_buckets_seconds);
  assert.equal(slice.non_matching_slice_policy, 'mcp_attribution_labels_forbidden');
});

test('runtime MCP duration descriptor matches only the explicit tool-call slice', () => {
  const { latency } = mcpToolCallTelemetry({
    tenantId: 'ten-contract',
    serverId: 'srv-contract',
    toolName: 'canonical-tool',
    oauthClientId: undefined,
    latencyMs: 5,
    status: 'success',
    environment: 'test',
  });
  assert.deepEqual(collectMcpToolCallDurationDescriptorViolations(latency), []);

  const leaked = structuredClone(latency);
  leaked.labels.subsystem = 'storage';
  leaked.labels.operation = 'object_read';
  assert.deepEqual(collectMcpToolCallDurationDescriptorViolations(leaked), [
    'MCP duration descriptor label subsystem must equal mcp.',
    'MCP duration descriptor label operation must equal tool_call.',
  ]);
});

test('helm observability values mirror the internal observability contract', () => {
  const values = readBaseValues();
  const stackValues = readObservabilityStackValues();
  const stack = readObservabilityMetricsStack();

  assert.equal(Object.hasOwn(values.observability, 'enabled'), false);
  assert.equal(stackValues.version, stack.version);
  assert.equal(stackValues.model, stack.operating_targets.collection_model);
  assert.equal(stackValues.collectionHealth.metricName, stack.collection_health.metric_name);
  assert.equal(stackValues.collectionHealth.failureCounter, stack.collection_health.failure_counter);
  assert.equal(stackValues.componentTargets.apisix.metricsPath, values.gatewayPolicy.observability.gatewayMetrics.metricsPath);
  assert.equal(stackValues.componentTargets.storage.collectionMode, 'hybrid');
  assert.equal(stackValues.componentTargets.controlPlane.component, 'controlPlane');
  assert.deepEqual(stackValues.requiredLabels, ['environment', 'subsystem', 'metricScope', 'collectionMode']);
});

test('architecture index and task summary document the observability baseline', { skip: !existsSync('docs/reference/architecture/README.md') || !existsSync('docs/reference/architecture/observability-metrics-stack.md') || !existsSync('docs/tasks/us-obs-01.md') }, () => {
  const architectureIndex = readFileSync('docs/reference/architecture/README.md', 'utf8');
  const architectureGuide = readFileSync('docs/reference/architecture/observability-metrics-stack.md', 'utf8');
  const taskSummary = readFileSync('docs/tasks/us-obs-01.md', 'utf8');

  assert.equal(architectureIndex.includes('observability-metrics-stack.json'), true);
  assert.equal(architectureIndex.includes('observability-metrics-stack.md'), true);
  assert.equal(architectureGuide.includes('in_falcone_observability_collection_health'), true);
  assert.equal(architectureGuide.includes('metric_scope=platform'), true);
  assert.equal(taskSummary.includes('US-OBS-01-T01'), true);
  assert.equal(taskSummary.includes('collection-health'), true);
});
