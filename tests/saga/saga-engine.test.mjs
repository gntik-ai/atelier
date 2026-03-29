import test from 'node:test';
import assert from 'node:assert/strict';
import { executeSaga, recoverInFlightSagas } from '../../apps/control-plane/src/saga/saga-engine.mjs';
import { __setWorkflowAuditHooksForTesting } from '../../apps/control-plane/src/workflows/workflow-audit.mjs';

function captureAuditAndEvents({ throwOnEmit = false, eventSink } = {}) {
  const auditCalls = [];
  const warnings = [];
  globalThis.__ATELIER_EVENTS_ADMIN_EMIT__ = async (payload) => {
    eventSink?.push(payload);
    return payload;
  };
  __setWorkflowAuditHooksForTesting({
    emitAuditRecord: async (record) => {
      auditCalls.push(record);
      if (throwOnEmit) {
        throw new Error('audit transport offline');
      }
      return { ok: true };
    },
    onWarn: (warning) => warnings.push(warning)
  });
  return { auditCalls, warnings };
}

test('executeSaga completes WF-CON-001 happy path', async () => {
  captureAuditAndEvents();
  const result = await executeSaga('WF-CON-001', { idempotencyKey: 'k-new' }, {
    tenantId: 't1',
    workspaceId: 'w1',
    actorType: 'svc',
    actorId: 'a1',
    correlationId: 'parent'
  });

  assert.equal(result.status, 'completed');
  assert.ok(result.sagaId);
  assert.equal(result.output.step, 'update-membership-record');
});

test('executeSaga returns provisional status for WF-CON-005', async () => {
  captureAuditAndEvents();
  const result = await executeSaga('WF-CON-005', {}, { tenantId: 't1' });
  assert.deepEqual(result, { status: 'not-implemented', workflowId: 'WF-CON-005' });
});

test('executeSaga rejects unknown workflows', async () => {
  captureAuditAndEvents();
  await assert.rejects(() => executeSaga('WF-CON-999', {}, { tenantId: 't1' }), /not found/);
});

test('recoverInFlightSagas returns summary', async () => {
  captureAuditAndEvents();
  const result = await recoverInFlightSagas(60_000);
  assert.equal(typeof result.recovered, 'number');
  assert.ok(Array.isArray(result.failedToRecover));
});

test('emitWorkflowStarted and emitWorkflowTerminal are each emitted once per successful executeSaga', async () => {
  const { auditCalls } = captureAuditAndEvents();
  await executeSaga('WF-CON-001', { idempotencyKey: 'k-audit-1' }, {
    tenantId: 't1',
    workspaceId: 'w1',
    actorType: 'svc',
    actorId: 'a1',
    correlationId: 'corr-audit-1'
  });

  assert.equal(auditCalls.filter((call) => call.action.action_id === 'workflow.started').length, 1);
  assert.equal(auditCalls.filter((call) => call.action.action_id === 'workflow.terminal').length, 1);
  assert.equal(auditCalls.find((call) => call.action.action_id === 'workflow.terminal')?.result.outcome, 'completed');
});

test('correlationId is identical in start and terminal audit records', async () => {
  const { auditCalls } = captureAuditAndEvents();
  await executeSaga('WF-CON-001', { idempotencyKey: 'k-audit-2' }, {
    tenantId: 't1',
    workspaceId: 'w1',
    actorType: 'svc',
    actorId: 'a1',
    correlationId: 'corr-audit-2'
  });

  const started = auditCalls.find((call) => call.action.action_id === 'workflow.started');
  const terminal = auditCalls.find((call) => call.action.action_id === 'workflow.terminal');
  assert.ok(started?.correlation_id);
  assert.equal(started?.correlation_id, terminal?.correlation_id);
});

test('emitStepMilestone fires for auditMilestone true steps in WF-CON-001', async () => {
  const { auditCalls } = captureAuditAndEvents();
  await executeSaga('WF-CON-001', { idempotencyKey: 'k-audit-3' }, {
    tenantId: 't1',
    workspaceId: 'w1',
    actorType: 'svc',
    actorId: 'a1',
    correlationId: 'corr-audit-3'
  });

  const stepCalls = auditCalls.filter((call) => call.action.action_id === 'step.succeeded');
  assert.equal(stepCalls.length, 2);
  assert.deepEqual(stepCalls.map((call) => call.detail.stepKey), ['assign-keycloak-role', 'update-membership-record']);
});

test('audit transport errors are non-fatal during executeSaga', async () => {
  const { warnings } = captureAuditAndEvents({ throwOnEmit: true });
  const result = await executeSaga('WF-CON-001', { idempotencyKey: 'k-audit-4' }, {
    tenantId: 't1',
    workspaceId: 'w1',
    actorType: 'svc',
    actorId: 'a1',
    correlationId: 'corr-audit-4'
  });

  assert.equal(result.status, 'completed');
  assert.ok(warnings.length >= 1);
});
