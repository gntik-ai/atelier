import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRetryPolicy, computeNextDelay, hasRetriesRemaining } from '../../services/webhook-engine/src/webhook-retry-policy.mjs';

test('retry delays increase and stay under max', () => {
  const random = () => 0;
  const d1 = computeNextDelay(1, { baseMs: 100, maxMs: 1000, random });
  const d2 = computeNextDelay(2, { baseMs: 100, maxMs: 1000, random });
  const d3 = computeNextDelay(3, { baseMs: 100, maxMs: 1000, random });
  assert.ok(d1 < d2 && d2 < d3);
  assert.ok(d3 <= 1000);
  assert.equal(hasRetriesRemaining(5, 5), false);
  assert.deepEqual(buildRetryPolicy({ WEBHOOK_BASE_BACKOFF_MS: '10', WEBHOOK_MAX_BACKOFF_MS: '20', WEBHOOK_MAX_RETRY_ATTEMPTS: '2' }), { baseMs: 10, maxMs: 20, maxAttempts: 2 });
});
