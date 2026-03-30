import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../services/provisioning-orchestrator/src/actions/async-operation-timeout-sweep.mjs';

test('timeout sweep processes candidates and continues on invalid transition', async () => {
  const calls = { published: 0, nowIso: null };
  const repo = {
    findTimedOutCandidates: async (_db, { nowIso }) => {
      calls.nowIso = nowIso;
      return [
        { operation_id: 'op-1', tenant_id: 't1', status: 'running' },
        { operation_id: 'op-2', tenant_id: 't1', status: 'running' },
        { operation_id: 'op-3', tenant_id: 't1', status: 'running' }
      ];
    },
    atomicTransitionSystem: async (_db, payload) => {
      if (payload.operation_id === 'op-2') {
        throw Object.assign(new Error('race'), { code: 'INVALID_TRANSITION' });
      }
      return { updatedOperation: { operation_id: payload.operation_id, tenant_id: 't1', status: 'timed_out', correlation_id: 'corr', updated_at: new Date().toISOString(), cancellation_reason: 'timeout exceeded' } };
    }
  };
  const events = {
    publishTimedOutEvent: async () => {
      calls.published += 1;
    }
  };

  const result = await main({ db: {}, producer: {}, repo, events });
  assert.ok(calls.nowIso);
  assert.equal(result.swept, 2);
  assert.equal(result.errors.length, 1);
  assert.equal(calls.published, 2);
});
