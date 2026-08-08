import test from 'node:test';
import assert from 'node:assert/strict';

import { recordMcpDependency, renderMetrics } from '../../apps/control-plane-executor/src/runtime/metrics-registry.mjs';

test('mcp-knative-metrics-01: dependency metric labels are bounded and contain no tenant, server, correlation, or tool data', () => {
  recordMcpDependency({
    operation: 'publish', outcome: 'unavailable', mode: 'managed', state: 'degraded',
    reason: 'CONTROL_PLANE_NOT_READY', tenantId: 'tenant-secret', serverId: 'server-secret',
    correlationId: 'corr-secret', toolName: 'tool-secret',
  });
  const metrics = renderMetrics();
  const line = metrics.split('\n').find((entry) => entry.startsWith('falcone_mcp_knative_dependency_events_total{'));
  assert.equal(line, 'falcone_mcp_knative_dependency_events_total{operation="publish",outcome="unavailable",mode="managed",state="degraded",reason="CONTROL_PLANE_NOT_READY"} 1');
  assert.ok(!line.includes('tenant-secret'));
  assert.ok(!line.includes('server-secret'));
  assert.ok(!line.includes('corr-secret'));
  assert.ok(!line.includes('tool-secret'));
});

test('mcp-knative-metrics-02: invalid dynamic dimensions collapse to bounded fallbacks', () => {
  recordMcpDependency({ operation: 'attacker-operation', outcome: 'attacker-outcome', mode: 'attacker-mode', state: 'attacker-state', reason: 'attacker reason' });
  const metrics = renderMetrics();
  assert.match(metrics, /operation="invoke",outcome="failed",mode="disabled",state="unavailable",reason="STATUS_UNAVAILABLE"/);
  assert.ok(!metrics.includes('attacker-operation'));
});
