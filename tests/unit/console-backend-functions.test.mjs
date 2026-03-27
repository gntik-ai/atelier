import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildConsoleBackendActivationAnnotation,
  validateConsoleBackendInvocationRequest
} from '../../services/adapters/src/openwhisk-admin.mjs';
import {
  CONSOLE_BACKEND_ACTOR_TYPE,
  CONSOLE_BACKEND_INITIATING_SURFACE,
  buildConsoleBackendWorkflowInvocation,
  getConsoleBackendIdentityRequirements,
  summarizeConsoleBackendFunctionsSurface,
  validateConsoleBackendScope
} from '../../apps/control-plane/src/console-backend-functions.mjs';

test('console backend identity requirements remain stable', () => {
  const identity = getConsoleBackendIdentityRequirements();

  assert.equal(CONSOLE_BACKEND_ACTOR_TYPE, 'workspace_service_account');
  assert.equal(CONSOLE_BACKEND_INITIATING_SURFACE, 'console_backend');
  assert.equal(identity.actor_type, 'workspace_service_account');
  assert.equal(identity.initiating_surface, 'console_backend');
});

test('console backend workflow invocation builds annotation and public API call metadata', () => {
  const invocation = buildConsoleBackendWorkflowInvocation({
    actor: 'svc_console_backend',
    actorType: 'workspace_service_account',
    tenantId: 'ten_01growthalpha',
    workspaceId: 'wrk_01alphadev',
    correlationId: 'corr_console_backend_01'
  }, 'functions/actions/console-backend-inventory', {});

  assert.equal(invocation.invocationRequest.tenantId, 'ten_01growthalpha');
  assert.equal(invocation.invocationRequest.workspaceId, 'wrk_01alphadev');
  assert.equal(invocation.invocationRequest.triggerContext.kind, 'direct');
  assert.equal(invocation.activationAnnotation.initiating_surface, 'console_backend');
  assert.equal(invocation.representativeOperation.operationId, 'getFunctionInventory');
  assert.equal(invocation.publicApiSurface.privateBackchannelAllowed, false);
});

test('console backend workflow invocation rejects missing tenant or workspace scope', () => {
  assert.throws(() => buildConsoleBackendWorkflowInvocation({ workspaceId: 'wrk_01alphadev', correlationId: 'corr_01' }, 'functions/actions/test'), /tenantId/);
  assert.throws(() => buildConsoleBackendWorkflowInvocation({ tenantId: 'ten_01growthalpha', correlationId: 'corr_01' }, 'functions/actions/test'), /workspaceId/);
});

test('console backend scope validation accepts matching scope and rejects mismatches', () => {
  const valid = validateConsoleBackendScope({
    actor: 'svc_console_backend',
    tenantId: 'ten_01growthalpha',
    workspaceId: 'wrk_01alphadev',
    correlationId: 'corr_01'
  });
  const invalid = validateConsoleBackendScope({
    actor: 'svc_console_backend',
    tenantId: 'ten_01growthalpha',
    workspaceId: 'wrk_01alphadev',
    requestTenantId: 'ten_01other',
    requestWorkspaceId: 'wrk_01other',
    correlationId: 'corr_01'
  });

  assert.equal(valid.ok, true);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.violations.some((entry) => entry.includes('tenant scope')), true);
  assert.equal(invalid.violations.some((entry) => entry.includes('workspace scope')), true);
});

test('console backend surface summary is non-empty and adapter helpers stamp console attribution', () => {
  const summary = summarizeConsoleBackendFunctionsSurface();
  const annotation = buildConsoleBackendActivationAnnotation({
    actor: 'svc_console_backend',
    tenantId: 'ten_01growthalpha',
    workspaceId: 'wrk_01alphadev',
    correlationId: 'corr_01'
  });
  const invalid = validateConsoleBackendInvocationRequest({ workspaceId: 'wrk_01alphadev' }, { correlationId: 'corr_01' });

  assert.equal(summary.publicApiOnly, true);
  assert.equal(summary.traceFields.includes('initiating_surface'), true);
  assert.equal(annotation.initiating_surface, 'console_backend');
  assert.equal(annotation.workspace_id, 'wrk_01alphadev');
  assert.equal(invalid.ok, false);
  assert.equal(invalid.violations.includes('tenantId is required for console backend invocation.'), true);
});
