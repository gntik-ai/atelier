import test from 'node:test';
import assert from 'node:assert/strict';

import {
  __setPersistenceAdapterForTest,
  _resetForTest,
  checkIdempotency,
  markFailed,
  markPending,
  markSucceeded
} from '../../apps/control-plane/src/workflows/idempotency-store.mjs';

test.afterEach(() => {
  _resetForTest();
});

test('checkIdempotency returns new for unknown keys', async () => {
  const state = await checkIdempotency('key-1');
  assert.deepEqual(state, { state: 'new' });
});

test('markPending transitions a key to pending', async () => {
  await markPending('key-2', 'WF-CON-001', 'tenant-1', 'workspace-1', null);
  const state = await checkIdempotency('key-2');
  assert.equal(state.state, 'pending');
});

test('markSucceeded stores cached result', async () => {
  await markPending('key-3', 'WF-CON-001', 'tenant-1', 'workspace-1', null);
  await markSucceeded('key-3', { workflowId: 'WF-CON-001', output: { ok: true } });
  const state = await checkIdempotency('key-3');
  assert.equal(state.state, 'succeeded');
  assert.deepEqual(state.cachedResult.output, { ok: true });
});

test('markFailed stores error summary', async () => {
  await markPending('key-4', 'WF-CON-001', 'tenant-1', 'workspace-1', null);
  await markFailed('key-4', { code: 'FAILED', message: 'boom', failedStep: 'step-a' });
  const state = await checkIdempotency('key-4');
  assert.equal(state.state, 'failed');
});

test('concurrent markPending on the same key returns written:false on second call', async () => {
  const first = await markPending('key-5', 'WF-CON-001', 'tenant-1', 'workspace-1', null);
  const second = await markPending('key-5', 'WF-CON-001', 'tenant-1', 'workspace-1', null);
  assert.equal(first.written, true);
  assert.equal(second.written, false);
});

test('markSucceeded strips secret material before storing cached result', async () => {
  await markPending('key-6', 'WF-CON-004', 'tenant-1', 'workspace-1', null);
  await markSucceeded('key-6', {
    workflowId: 'WF-CON-004',
    output: {
      credentialId: 'cred-1',
      credential: 'super-secret'
    }
  });
  const state = await checkIdempotency('key-6');
  assert.equal(state.cachedResult.output.credential, null);
  assert.equal(state.cachedResult.output.credentialId, 'cred-1');
});

test('state API unavailable falls back to memory-backed persistence', async () => {
  __setPersistenceAdapterForTest({
    allowMemoryFallback: true,
    async getRecord() {
      const error = new Error('state api unavailable');
      error.status = 503;
      throw error;
    },
    async putPending() {
      const error = new Error('state api unavailable');
      error.status = 503;
      throw error;
    },
    async putSucceeded() {
      const error = new Error('state api unavailable');
      error.status = 503;
      throw error;
    }
  });

  const result = await markPending('key-7', 'WF-CON-003', 'tenant-1', 'workspace-1', 'wf_job_demo');
  assert.equal(result.written, true);
  const state = await checkIdempotency('key-7');
  assert.equal(state.state, 'pending');
});
