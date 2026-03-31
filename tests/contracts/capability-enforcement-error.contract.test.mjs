import test from 'node:test';
import assert from 'node:assert/strict';

test('capability enforcement 403 error payload matches ErrorResponse schema', () => {
  const error403 = {
    status: 403,
    code: 'GW_CAPABILITY_NOT_ENTITLED',
    message: 'Your current plan does not include this capability.',
    detail: {
      capability: 'webhooks',
      reason: 'plan_restriction',
      upgradePath: '/plans/upgrade',
      currentPlanId: 'pln_abc123'
    },
    requestId: 'req_xyz789',
    correlationId: 'corr_abc456',
    timestamp: '2026-03-31T20:00:00Z',
    resource: '/v1/workspaces/wrk_def456/webhooks',
    retryable: false
  };

  assert.equal(error403.status, 403);
  assert.equal(error403.code, 'GW_CAPABILITY_NOT_ENTITLED');
  assert.equal(typeof error403.message, 'string');
  assert.equal(typeof error403.detail.capability, 'string');
  assert.ok(['plan_restriction', 'override_restriction'].includes(error403.detail.reason));
  assert.equal(typeof error403.detail.upgradePath, 'string');
  assert.equal(error403.retryable, false);
  assert.equal(typeof error403.requestId, 'string');
  assert.equal(typeof error403.correlationId, 'string');
  assert.equal(typeof error403.timestamp, 'string');
  assert.equal(typeof error403.resource, 'string');
});

test('capability enforcement 503 degraded error payload matches ErrorResponse schema', () => {
  const error503 = {
    status: 503,
    code: 'GW_CAPABILITY_RESOLUTION_DEGRADED',
    message: 'Capability resolution is temporarily unavailable. Please retry.',
    requestId: 'req_xyz789',
    correlationId: 'corr_abc456',
    timestamp: '2026-03-31T20:00:01Z',
    resource: '/v1/workspaces/wrk_def456/webhooks',
    retryable: true
  };

  assert.equal(error503.status, 503);
  assert.equal(error503.code, 'GW_CAPABILITY_RESOLUTION_DEGRADED');
  assert.equal(typeof error503.message, 'string');
  assert.equal(error503.retryable, true);
  assert.equal(typeof error503.requestId, 'string');
  assert.equal(typeof error503.correlationId, 'string');
  assert.equal(typeof error503.timestamp, 'string');
});
