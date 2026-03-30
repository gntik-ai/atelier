import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../services/provisioning-orchestrator/src/actions/async-operation-orphan-sweep.mjs';

test('orphan sweep recovers running/pending and forces stale cancelling', async () => {
  const published = { recovered: 0, cancelled: 0 };
  const repo = {
    findOrphanCandidates: async () => [
      { operation_id: 'run-1', tenant_id: 't1', status: 'running' },
      { operation_id: 'pend-1', tenant_id: 't1', status: 'pending' }
    ],
    findStaleCancellingCandidates: async () => [
      { operation_id: 'cancel-1', tenant_id: 't1', status: 'cancelling', cancelled_by: 'actor-1' }
    ],
    atomicTransitionSystem: async (_db, payload) => {
      return { updatedOperation: { operation_id: payload.operation_id, tenant_id: 't1', status: payload.new_status, correlation_id: 'corr', updated_at: new Date().toISOString(), cancelled_by: payload.cancelled_by } };
    }
  };
  const events = {
    publishRecoveredEvent: async () => { published.recovered += 1; },
    publishCancelledEvent: async () => { published.cancelled += 1; }
  };

  const result = await main({ db: {}, producer: {}, repo, events });
  assert.equal(result.orphansRecovered, 2);
  assert.equal(result.cancellingForced, 1);
  assert.equal(published.recovered, 2);
  assert.equal(published.cancelled, 1);
});

test('invalid transitions do not abort orphan sweep', async () => {
  const repo = {
    findOrphanCandidates: async () => [{ operation_id: 'run-1', tenant_id: 't1', status: 'running' }],
    findStaleCancellingCandidates: async () => [],
    atomicTransitionSystem: async () => { throw Object.assign(new Error('race'), { code: 'INVALID_TRANSITION' }); }
  };
  const result = await main({ db: {}, producer: {}, repo, events: { publishRecoveredEvent: async () => {}, publishCancelledEvent: async () => {} } });
  assert.equal(result.orphansRecovered, 0);
  assert.equal(result.errors.length, 1);
});
