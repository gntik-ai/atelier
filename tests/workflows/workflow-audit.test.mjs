import test from 'node:test';
import assert from 'node:assert/strict';
import {
  __setWorkflowAuditHooksForTesting,
  emitStepMilestone,
  emitWorkflowStarted,
  emitWorkflowTerminal,
  maskAuditDetail,
  validateAuditRecord
} from '../../apps/control-plane/src/workflows/workflow-audit.mjs';

const baseSagaCtx = Object.freeze({
  sagaId: 'saga-1',
  workflowId: 'WF-CON-001',
  correlationId: 'corr-1',
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  actorType: 'workspace_admin',
  actorId: 'actor-1'
});

function withHooks(hooks) {
  const emitted = [];
  const warnings = [];
  __setWorkflowAuditHooksForTesting({
    emitAuditRecord: async (record) => {
      emitted.push(record);
      if (hooks?.throwOnEmit) {
        throw new Error('transport offline');
      }
      return { ok: true };
    },
    onWarn: (warning) => warnings.push(warning),
    onRecordPrepared: hooks?.onRecordPrepared
  });
  return { emitted, warnings };
}

test('emitWorkflowStarted with valid sagaCtx returns eventId and emits once', async () => {
  const { emitted } = withHooks();
  const result = await emitWorkflowStarted(baseSagaCtx);

  assert.match(result.eventId, /^[0-9a-f-]{36}$/i);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].action.action_id, 'workflow.started');
  assert.equal(emitted[0].correlation_id, 'corr-1');
});

test('emitWorkflowStarted with missing correlationId throws AUDIT_MISSING_CORRELATION_ID', async () => {
  withHooks();
  await assert.rejects(() => emitWorkflowStarted({ ...baseSagaCtx, correlationId: undefined }), (error) => error?.code === 'AUDIT_MISSING_CORRELATION_ID');
});

test('emitWorkflowStarted with missing tenantId throws AUDIT_MISSING_TENANT_ID', async () => {
  withHooks();
  await assert.rejects(() => emitWorkflowStarted({ ...baseSagaCtx, tenantId: undefined }), (error) => error?.code === 'AUDIT_MISSING_TENANT_ID');
});

test('emitWorkflowTerminal with completed sets completed outcome', async () => {
  const { emitted } = withHooks();
  await emitWorkflowTerminal(baseSagaCtx, 'completed');

  assert.equal(emitted[0].result.outcome, 'completed');
});

test('emitWorkflowTerminal with compensation-failed sets compensation-failed outcome', async () => {
  const { emitted } = withHooks();
  await emitWorkflowTerminal(baseSagaCtx, 'compensation-failed');

  assert.equal(emitted[0].result.outcome, 'compensation-failed');
});

test('emitStepMilestone with succeeded emits step.succeeded', async () => {
  const { emitted } = withHooks();
  await emitStepMilestone({ key: 'assign-keycloak-role', auditMilestone: true, ordinal: 1 }, 'succeeded', baseSagaCtx);

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].action.action_id, 'step.succeeded');
});

test('emitStepMilestone with failed emits step.failed', async () => {
  const { emitted } = withHooks();
  await emitStepMilestone({ key: 'assign-keycloak-role', auditMilestone: true, ordinal: 1 }, 'failed', baseSagaCtx);

  assert.equal(emitted[0].action.action_id, 'step.failed');
});

test('maskAuditDetail redacts sensitive fields and preserves non-sensitive fields', () => {
  const result = maskAuditDetail({ token: 'abc123', workflowId: 'WF-CON-001' });

  assert.equal(result.masked.token, '[REDACTED]');
  assert.deepEqual(result.maskedFieldRefs, ['token']);
  assert.equal(result.masked.workflowId, 'WF-CON-001');
});

test('maskAuditDetail with no sensitive fields reports no masking', () => {
  const result = maskAuditDetail({ workflowId: 'WF-CON-001' });

  assert.deepEqual(result.maskedFieldRefs, []);
  assert.equal(result.maskingApplied, false);
});

test('maskAuditDetail strips stepOutput from detail', () => {
  const result = maskAuditDetail({ stepOutput: { token: 'abc' }, workflowId: 'WF-CON-001' });

  assert.equal(result.masked.stepOutput, undefined);
});

test('validateAuditRecord with all required fields present returns ok', () => {
  const result = validateAuditRecord({
    event_id: '1',
    event_timestamp: new Date().toISOString(),
    schema_version: '2026-03-28',
    actor: { actor_id: 'actor-1', actor_type: 'workspace_admin' },
    scope: { tenant_id: 'tenant-1' },
    resource: { subsystem_id: 'openwhisk' },
    action: { action_id: 'workflow.started' },
    result: { outcome: 'started' },
    correlation_id: 'corr-1',
    origin: { surface: 'console_backend' }
  });

  assert.deepEqual(result, { ok: true, violations: [] });
});

test('validateAuditRecord missing correlation_id reports violation', () => {
  const result = validateAuditRecord({
    event_id: '1',
    event_timestamp: new Date().toISOString(),
    schema_version: '2026-03-28',
    actor: { actor_id: 'actor-1', actor_type: 'workspace_admin' },
    scope: { tenant_id: 'tenant-1' },
    resource: { subsystem_id: 'openwhisk' },
    action: { action_id: 'workflow.started' },
    result: { outcome: 'started' },
    origin: { surface: 'console_backend' }
  });

  assert.equal(result.ok, false);
  assert.match(result.violations.join(' | '), /correlation_id/);
});

test('validateAuditRecord missing actor.actor_id reports violation', () => {
  const result = validateAuditRecord({
    event_id: '1',
    event_timestamp: new Date().toISOString(),
    schema_version: '2026-03-28',
    actor: { actor_type: 'workspace_admin' },
    scope: { tenant_id: 'tenant-1' },
    resource: { subsystem_id: 'openwhisk' },
    action: { action_id: 'workflow.started' },
    result: { outcome: 'started' },
    correlation_id: 'corr-1',
    origin: { surface: 'console_backend' }
  });

  assert.equal(result.ok, false);
  assert.match(result.violations.join(' | '), /actor\.actor_id/);
});

test('emit transport error is non-fatal', async () => {
  const { emitted, warnings } = withHooks({ throwOnEmit: true });
  const result = await emitWorkflowStarted(baseSagaCtx);

  assert.match(result.eventId, /^[0-9a-f-]{36}$/i);
  assert.equal(emitted.length, 1);
  assert.equal(warnings.length, 1);
});
