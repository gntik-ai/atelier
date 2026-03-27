import test from 'node:test';
import assert from 'node:assert/strict';

import { getContextPropagationTarget, getPublicRoute } from '../../services/internal-contracts/src/index.mjs';
import {
  buildConsoleBackendActivationAnnotation,
  validateConsoleBackendInvocationRequest
} from '../../services/adapters/src/openwhisk-admin.mjs';
import { buildConsoleBackendWorkflowInvocation } from '../../apps/control-plane/src/console-backend-functions.mjs';

test('console backend invocation envelope stays aligned with the governed invocation contract shape', () => {
  const envelope = buildConsoleBackendWorkflowInvocation({
    actor: 'svc_console_backend',
    tenantId: 'ten_01growthalpha',
    workspaceId: 'wrk_01alphadev',
    correlationId: 'corr_console_backend_01'
  }, 'functions/actions/console-backend-inventory');

  assert.equal(typeof envelope.actionRef, 'string');
  assert.equal(typeof envelope.invocationRequest.responseMode, 'string');
  assert.equal(envelope.invocationRequest.triggerContext.kind, 'direct');
  assert.equal(typeof envelope.invocationRequest.body.publicApiCall.path, 'string');
});

test('console backend activation annotations satisfy the authorization propagation contract', () => {
  const target = getContextPropagationTarget('console_backend_activation');
  const annotation = buildConsoleBackendActivationAnnotation({
    actor: 'svc_console_backend',
    tenantId: 'ten_01growthalpha',
    workspaceId: 'wrk_01alphadev',
    correlationId: 'corr_console_backend_01'
  });

  assert.ok(target);
  for (const field of target.required_fields) {
    assert.notEqual(annotation[field], undefined, `missing annotation field ${field}`);
  }
  assert.equal(annotation.initiating_surface, 'console_backend');
});

test('console backend scope denials stay compatible with gateway-style error semantics', () => {
  const denial = validateConsoleBackendInvocationRequest({
    tenantId: 'ten_01other',
    workspaceId: 'wrk_01other',
    correlationId: 'corr_console_backend_01'
  }, {
    tenantId: 'ten_01growthalpha',
    workspaceId: 'wrk_01alphadev',
    correlationId: 'corr_console_backend_01'
  });
  const errorResponse = {
    code: 'GW_CONSOLE_BACKEND_SCOPE_DENIED',
    message: denial.violations[0],
    status: 403
  };

  assert.equal(denial.ok, false);
  assert.equal(typeof errorResponse.message, 'string');
  assert.match(errorResponse.code, /^GW_/);
  assert.equal(errorResponse.status, 403);
});

test('console backend representative workflow preserves public API parity metadata and trace distinguishability', () => {
  const route = getPublicRoute('getFunctionInventory');
  const envelope = buildConsoleBackendWorkflowInvocation({
    actor: 'svc_console_backend',
    tenantId: 'ten_01growthalpha',
    workspaceId: 'wrk_01alphadev',
    correlationId: 'corr_console_backend_01'
  }, 'functions/actions/console-backend-inventory');

  assert.equal(envelope.representativeOperation.operationId, route.operationId);
  assert.equal(envelope.invocationRequest.body.publicApiCall.path.includes('/v1/functions/workspaces/wrk_01alphadev/inventory'), true);
  assert.equal(envelope.activationAnnotation.initiating_surface, 'console_backend');
  assert.equal(envelope.publicApiSurface.privateBackchannelAllowed, false);
});
