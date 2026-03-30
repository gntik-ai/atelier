import test from 'node:test';
import assert from 'node:assert/strict';
import { poll } from '../../../../tests/e2e/realtime/helpers/poller.mjs';

test('poll resolves immediately when assertFn succeeds on first call', async () => {
  let calls = 0;
  await poll(async () => {
    calls += 1;
  }, { maxWaitMs: 100, intervalMs: 10, backoffFactor: 2 });
  assert.equal(calls, 1);
});

test('poll retries until assertFn succeeds', async () => {
  let calls = 0;
  await poll(async () => {
    calls += 1;
    if (calls < 3) {
      throw new Error('not yet');
    }
  }, { maxWaitMs: 200, intervalMs: 10, backoffFactor: 2 });
  assert.equal(calls, 3);
});

test('poll rejects with timeout error when assertFn never succeeds', async () => {
  await assert.rejects(
    () => poll(async () => {
      throw new Error('still failing');
    }, { maxWaitMs: 50, intervalMs: 10, backoffFactor: 2 }),
    /poll timed out/
  );
});

test('poll caps interval growth at maxWaitMs / 2', async () => {
  const startedAt = Date.now();
  await assert.rejects(
    () => poll(async () => {
      throw new Error('always failing');
    }, { maxWaitMs: 80, intervalMs: 60, backoffFactor: 10 }),
    /poll timed out/
  );
  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed < 200, `elapsed too high: ${elapsed}`);
});

test('poll timeout error includes elapsed time', async () => {
  await assert.rejects(
    () => poll(async () => {
      throw new Error('boom');
    }, { maxWaitMs: 40, intervalMs: 10, backoffFactor: 2 }),
    /after \d+ms/
  );
});
