import test from 'node:test';
import assert from 'node:assert/strict';

import { readAuthorizationModel } from '../../scripts/lib/authorization-model.mjs';
import { validateConsoleBackendInvocationRequest } from '../../services/adapters/src/openwhisk-admin.mjs';
import { buildConsoleBackendWorkflowInvocation } from '../../apps/control-plane/src/console-backend-functions.mjs';

test('console backend resilience coverage includes the new negative scenarios', () => {
  const model = readAuthorizationModel();
  const ids = new Set(model.negative_scenarios.map((scenario) => scenario.id));

  assert.equal(ids.has('AUTHZ-FN-CON-001'), true);
  assert.equal(ids.has('AUTHZ-FN-CON-002'), true);
});

test('AUTHZ-FN-CON-001 denies cross-tenant or cross-workspace console backend invocation attempts', () => {
  const denial = validateConsoleBackendInvocationRequest({
    tenantId: 'ten_01other',
    workspaceId: 'wrk_01other',
    correlationId: 'corr_console_backend_01'
  }, {
    tenantId: 'ten_01growthalpha',
    workspaceId: 'wrk_01alphadev',
    correlationId: 'corr_console_backend_01'
  });

  assert.equal(denial.ok, false);
  assert.equal(denial.violations.some((entry) => entry.includes('tenant scope')), true);
  assert.equal(denial.violations.some((entry) => entry.includes('workspace scope')), true);
});

test('AUTHZ-FN-CON-002 rejects missing tenant or workspace annotations before dispatch', () => {
  const missing = validateConsoleBackendInvocationRequest({ correlationId: 'corr_console_backend_01' }, { correlationId: 'corr_console_backend_01' });

  assert.equal(missing.ok, false);
  assert.equal(missing.violations.includes('tenantId is required for console backend invocation.'), true);
  assert.equal(missing.violations.includes('workspaceId is required for console backend invocation.'), true);
});

test('console backend retries preserve authorization outcome and correlation requirement', () => {
  const first = validateConsoleBackendInvocationRequest({
    tenantId: 'ten_01other',
    workspaceId: 'wrk_01other',
    correlationId: 'corr_console_backend_01',
    idempotencyKey: 'idem:console:retry'
  }, {
    tenantId: 'ten_01growthalpha',
    workspaceId: 'wrk_01alphadev',
    correlationId: 'corr_console_backend_01'
  });
  const second = validateConsoleBackendInvocationRequest({
    tenantId: 'ten_01other',
    workspaceId: 'wrk_01other',
    correlationId: 'corr_console_backend_01',
    idempotencyKey: 'idem:console:retry'
  }, {
    tenantId: 'ten_01growthalpha',
    workspaceId: 'wrk_01alphadev',
    correlationId: 'corr_console_backend_01'
  });
  const missingCorrelation = validateConsoleBackendInvocationRequest({
    tenantId: 'ten_01growthalpha',
    workspaceId: 'wrk_01alphadev'
  }, {});

  assert.deepEqual(first.violations, second.violations);
  assert.equal(missingCorrelation.ok, false);
  assert.equal(missingCorrelation.violations.includes('correlationId is required for console backend invocation.'), true);
});

test('console backend allowed path preserves public API denial parity metadata and trace attribution', () => {
  const envelope = buildConsoleBackendWorkflowInvocation({
    actor: 'svc_console_backend',
    tenantId: 'ten_01growthalpha',
    workspaceId: 'wrk_01alphadev',
    correlationId: 'corr_console_backend_01'
  }, 'functions/actions/console-backend-inventory');

  assert.equal(envelope.invocationRequest.body.publicApiCall.headers['X-Correlation-Id'], 'corr_console_backend_01');
  assert.equal(envelope.invocationRequest.body.publicApiCall.headers['Idempotency-Key'].startsWith('idem:'), true);
  assert.equal(envelope.activationAnnotation.initiating_surface, 'console_backend');
});
