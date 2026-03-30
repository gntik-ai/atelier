import test from 'node:test';
import assert from 'node:assert/strict';
import { main as retryMain } from '../../services/provisioning-orchestrator/src/actions/async-operation-retry.mjs';
import { main as overrideMain } from '../../services/provisioning-orchestrator/src/actions/async-operation-retry-override.mjs';

test('manual intervention lifecycle blocks normal retry and allows override', async () => {
  const operation = { operation_id: 'op', tenant_id: 't', actor_id: 'actor', status: 'failed', attempt_count: 5, max_retries: 5, manual_intervention_required: true, correlation_id: 'corr' };
  const flag = { flag_id: 'flag', status: 'pending' };
  const retryBlocked = await retryMain({ operation_id: 'op', callerContext: { actor: { id: 'actor', type: 'user' }, tenantId: 't' } }, { db: {}, findByIdAnyTenant: async () => operation, findManualInterventionFlagByOperationId: async () => flag });
  assert.equal(retryBlocked.statusCode, 422);

  const db = { async query() { return { rows: [] }; } };
  const overrideOk = await overrideMain({ operation_id: 'op', tenant_id: 't', justification: 'long enough justification', callerContext: { actor: { id: 'sa', type: 'superadmin' } } }, { db, findByIdWithTenant: async () => operation, findFlagByOperationId: async () => ({ flag_id: 'flag', status: 'pending' }), createIfNotInProgress: async () => ({ created: true }), createRetryAttemptModel: () => ({ attempt_id: 'attempt', correlation_id: 'new-corr' }), createRetryAttempt: async () => {}, resolveFlag: async () => {}, publishRetryOverrideEvent: async () => {} });
  assert.equal(overrideOk.statusCode, 200);

  const overrideConflict = await overrideMain({ operation_id: 'op', tenant_id: 't', justification: 'long enough justification', callerContext: { actor: { id: 'sa', type: 'superadmin' } } }, { db, findByIdWithTenant: async () => operation, findFlagByOperationId: async () => ({ flag_id: 'flag', status: 'pending' }), createIfNotInProgress: async () => ({ created: false, existing: { override_id: 'existing' } }) });
  assert.equal(overrideConflict.statusCode, 409);
});
