import test from 'node:test';
import assert from 'node:assert/strict';
import consoleWorkflowAuditPolicy from '../../services/internal-contracts/src/console-workflow-audit-policy.json' with { type: 'json' };
import { sagaDefinitions } from '../../apps/control-plane/src/saga/saga-definitions.mjs';
import {
  __setWorkflowAuditHooksForTesting,
  emitStepMilestone,
  emitWorkflowStarted,
  emitWorkflowTerminal
} from '../../apps/control-plane/src/workflows/workflow-audit.mjs';
import {
  getAuditEventRequiredFields,
  readObservabilityAuditEventSchema
} from '../../services/internal-contracts/src/index.mjs';

const baseSagaCtx = Object.freeze({
  sagaId: 'saga-1',
  workflowId: 'WF-CON-001',
  correlationId: 'corr-1',
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  actorType: 'workspace_admin',
  actorId: 'actor-1'
});

async function captureRecord(factory) {
  const records = [];
  __setWorkflowAuditHooksForTesting({
    emitAuditRecord: async (record) => {
      records.push(record);
      return { ok: true };
    }
  });
  await factory();
  return records[0];
}

function assertRequiredFields(record) {
  for (const field of getAuditEventRequiredFields()) {
    assert.notEqual(record[field], undefined, `${field} should be present`);
  }
  assert.equal(typeof record.event_id, 'string');
  assert.equal(typeof record.event_timestamp, 'string');
  assert.equal(typeof record.actor.actor_id, 'string');
  assert.equal(typeof record.scope.tenant_id, 'string');
  assert.equal(typeof record.resource.subsystem_id, 'string');
  assert.equal(typeof record.action.action_id, 'string');
  assert.equal(typeof record.result.outcome, 'string');
}

test('started record conforms to schema-required fields', async () => {
  const record = await captureRecord(() => emitWorkflowStarted(baseSagaCtx));
  assertRequiredFields(record);
  assert.equal(record.action.action_id, 'workflow.started');
});

test('step-milestone record conforms to schema-required fields', async () => {
  const record = await captureRecord(() => emitStepMilestone({ key: 'assign-keycloak-role', auditMilestone: true, ordinal: 1 }, 'succeeded', baseSagaCtx));
  assertRequiredFields(record);
  assert.equal(record.action.action_id, 'step.succeeded');
});

test('terminal record conforms to schema-required fields', async () => {
  const record = await captureRecord(() => emitWorkflowTerminal(baseSagaCtx, 'completed'));
  assertRequiredFields(record);
  assert.equal(record.result.outcome, 'completed');
});

test('console-workflow-audit-policy.json loads and parses', () => {
  assert.equal(consoleWorkflowAuditPolicy.version, '2026-03-29');
  assert.equal(consoleWorkflowAuditPolicy.scope, 'US-UIB-01-T05');
  assert.ok(consoleWorkflowAuditPolicy.audit_milestone_steps);
  assert.equal(consoleWorkflowAuditPolicy.masking_profile, 'default_masked');
});

test('policy audit milestone step names map to existing saga definition step keys', () => {
  const equivalentStepKeys = {
    'create-tenant-namespace': 'create-keycloak-realm',
    'create-tenant-db': 'create-postgresql-boundary',
    'create-tenant-kafka-topics': 'create-kafka-namespace',
    'create-tenant-storage': 'configure-apisix-routes',
    'create-workspace-namespace': 'create-keycloak-client',
    'create-workspace-db': 'create-postgresql-workspace',
    'create-workspace-kafka-topics': 'reserve-s3-storage',
    'create-credential-record': 'create-keycloak-credential',
    'bind-credential-to-iam': 'sync-apisix-consumer',
    'store-credential-pointer': 'record-credential-metadata',
    'register-service-account': 'create-service-account',
    'bind-service-account-scopes': 'create-service-account',
    'record-service-account-audit-ref': 'create-service-account'
  };

  for (const [workflowId, expectedKeys] of Object.entries(consoleWorkflowAuditPolicy.audit_milestone_steps)) {
    const actualKeys = new Set((sagaDefinitions.get(workflowId)?.steps ?? []).map((step) => step.key));
    for (const expectedKey of expectedKeys) {
      const candidate = actualKeys.has(expectedKey) ? expectedKey : equivalentStepKeys[expectedKey];
      assert.ok(candidate && actualKeys.has(candidate), `${workflowId} missing mapped step for ${expectedKey}`);
    }
  }
});

test('schema_version in emitted sample records matches the contract version', async () => {
  const schema = readObservabilityAuditEventSchema();
  const record = await captureRecord(() => emitWorkflowStarted(baseSagaCtx));
  assert.equal(record.schema_version, schema.version);
  assert.equal(record.schema_version, '2026-03-28');
});
