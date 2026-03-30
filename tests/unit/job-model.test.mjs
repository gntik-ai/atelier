import test from 'node:test';
import assert from 'node:assert/strict';
import { buildJobRecord, applyTransition, incrementFailureCount, resetFailureCount, applyNextRunAt } from '../../services/scheduling-engine/src/job-model.mjs';

const base = buildJobRecord({ name: 'job', cronExpression: '0 * * * *', targetAction: 'ws/cleanup' }, { tenantId: 't1', workspaceId: 'w1', actorId: 'u1', now: '2026-03-30T10:00:00.000Z' });

test('builds job record', () => {
  assert.equal(base.status, 'active');
  assert.equal(base.name, 'job');
});

test('supports valid transitions and rejects invalid ones', () => {
  assert.equal(applyTransition(base, 'paused').status, 'paused');
  assert.equal(applyTransition({ ...base, status: 'paused' }, 'active').status, 'active');
  assert.equal(applyTransition(base, 'errored').status, 'errored');
  assert.equal(applyTransition(base, 'deleted').status, 'deleted');
  assert.throws(() => applyTransition({ ...base, status: 'deleted' }, 'active'));
});

test('increments and resets failure count', () => {
  const incremented = incrementFailureCount({ ...base, max_consecutive_failures: 2, consecutive_failure_count: 1 });
  assert.equal(incremented.consecutive_failure_count, 2);
  assert.equal(incremented.status, 'errored');
  assert.equal(resetFailureCount(incremented).consecutive_failure_count, 0);
});

test('recalculates next run', () => {
  const updated = applyNextRunAt(base, '*/5 * * * *', new Date('2026-03-30T10:01:00.000Z'));
  assert.equal(updated.next_run_at, '2026-03-30T10:05:00.000Z');
});
