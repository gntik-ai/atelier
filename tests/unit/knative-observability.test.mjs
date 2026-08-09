import test from 'node:test';
import assert from 'node:assert/strict';

import { auditEventForRoute } from '../../apps/control-plane/audit-writer.mjs';
import { recordKnativeDependencyEvent, renderMetrics } from '../../apps/control-plane/metrics-registry.mjs';

test('knative-observability-01: Function unavailable audit is scoped, correlated upstream, and secret-safe', () => {
  const event = auditEventForRoute(
    { method: 'POST', path: '/v1/functions/actions', localHandler: 'fnDeploy' },
    {
      params: {},
      body: { source: { inlineCode: 'SECRET_SOURCE' }, credential: 'SECRET_TOKEN' },
      identity: { sub: 'dev-a', tenantId: 'tenant-a' },
    },
    {
      statusCode: 503,
      body: { code: 'KNATIVE_UNAVAILABLE', correlationId: 'corr-a' },
      auditScope: { tenantId: 'tenant-a', workspaceId: 'ws-a', resourceId: 'fn-a' },
      knativeEvidence: {
        capability: 'function', operation: 'deploy', mode: 'managed', state: 'degraded',
        reason: 'CONTROL_PLANE_NOT_READY', result: 'unavailable',
      },
    },
  );
  assert.equal(event.actionType, 'workspace.function.deploy');
  assert.equal(event.tenantId, 'tenant-a');
  assert.equal(event.workspaceId, 'ws-a');
  assert.equal(event.outcome, 'error');
  assert.deepEqual(event.newState.knative, {
    capability: 'function', operation: 'deploy', mode: 'managed', state: 'degraded',
    reason: 'CONTROL_PLANE_NOT_READY', result: 'unavailable',
  });
  const serialized = JSON.stringify(event);
  assert.ok(!serialized.includes('SECRET_SOURCE'));
  assert.ok(!serialized.includes('SECRET_TOKEN'));
  assert.ok(!serialized.includes('fn-a'));
});

test('knative-observability-02: metric dimensions are bounded and omit tenant/workload identity', () => {
  recordKnativeDependencyEvent({
    capability: 'function', operation: 'deploy', mode: 'managed', state: 'degraded',
    reason: 'CONTROL_PLANE_NOT_READY', result: 'unavailable',
    tenantId: 'tenant-unbounded', workspaceId: 'workspace-unbounded', resourceId: 'secret-ksvc',
  });
  const metrics = renderMetrics();
  assert.match(metrics, /falcone_knative_dependency_events_total\{capability="function",operation="deploy",mode="managed",state="degraded",reason="CONTROL_PLANE_NOT_READY",result="unavailable"\} 1/);
  assert.ok(!metrics.includes('tenant-unbounded'));
  assert.ok(!metrics.includes('workspace-unbounded'));
  assert.ok(!metrics.includes('secret-ksvc'));
});
