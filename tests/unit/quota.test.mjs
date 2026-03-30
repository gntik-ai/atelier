import test from 'node:test';
import assert from 'node:assert/strict';
import { checkJobCreationQuota, checkResumeQuota, assertCronFloor, readDefaultLimits } from '../../services/scheduling-engine/src/quota.mjs';

test('quota checks enforce limits', () => {
  assert.equal(checkJobCreationQuota(10, 10).allowed, false);
  assert.equal(checkJobCreationQuota(9, 10).allowed, true);
  assert.equal(checkResumeQuota(10, 10).allowed, false);
});

test('assertCronFloor delegates to validator', () => {
  assert.throws(() => assertCronFloor('* * * * *', 120));
});

test('reads env defaults', () => {
  const defaults = readDefaultLimits({ SCHEDULING_DEFAULT_MAX_ACTIVE_JOBS: '11', SCHEDULING_DEFAULT_MIN_INTERVAL_SECONDS: '90', SCHEDULING_DEFAULT_MAX_CONSECUTIVE_FAILURES: '6' });
  assert.deepEqual(defaults, { maxActiveJobs: 11, minIntervalSeconds: 90, maxConsecutiveFailures: 6 });
});
