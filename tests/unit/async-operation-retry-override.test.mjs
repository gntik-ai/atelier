import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../services/provisioning-orchestrator/src/actions/async-operation-retry-override.mjs';

const baseOverrides = { db: { query: async () => ({ rows: [] }) }, findByIdWithTenant: async () => ({ operation_id: 'op', tenant_id: 't', attempt_count: 1, manual_intervention_required: true }), findFlagByOperationId: async () => ({ flag_id: 'flag', status: 'pending' }), createIfNotInProgress: async () => ({ created: true }), createRetryAttemptModel: () => ({ attempt_id: 'attempt', correlation_id: 'corr' }), createRetryAttempt: async () => {}, resolveFlag: async () => {}, publishRetryOverrideEvent: async () => {} };

test('happy path returns 200', async () => {
  const result = await main({ operation_id: 'op', tenant_id: 't', justification: 'long enough justification', callerContext: { actor: { id: 'sa', type: 'superadmin' } } }, baseOverrides);
  assert.equal(result.statusCode, 200);
});

test('non-superadmin returns 403', async () => {
  const result = await main({ callerContext: { actor: { id: 'u', type: 'user' } } }, baseOverrides);
  assert.equal(result.statusCode, 403);
});

test('operation without intervention flag returns 404', async () => {
  const result = await main({ operation_id: 'op', tenant_id: 't', justification: 'long enough justification', callerContext: { actor: { id: 'sa', type: 'superadmin' } } }, { ...baseOverrides, findByIdWithTenant: async () => ({ manual_intervention_required: false }) });
  assert.equal(result.statusCode, 404);
});

test('override in progress returns 409', async () => {
  const result = await main({ operation_id: 'op', tenant_id: 't', justification: 'long enough justification', callerContext: { actor: { id: 'sa', type: 'superadmin' } } }, { ...baseOverrides, createIfNotInProgress: async () => ({ created: false, existing: { override_id: 'existing' } }) });
  assert.equal(result.statusCode, 409);
});

test('resolved flag returns error', async () => {
  const result = await main({ operation_id: 'op', tenant_id: 't', justification: 'long enough justification', callerContext: { actor: { id: 'sa', type: 'superadmin' } } }, { ...baseOverrides, findFlagByOperationId: async () => ({ flag_id: 'flag', status: 'resolved' }) });
  assert.equal(result.statusCode, 409);
});
