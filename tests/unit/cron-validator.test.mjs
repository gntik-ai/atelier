import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCronExpression, nextRunAt, assertAboveFloor, minimumIntervalSeconds } from '../../services/scheduling-engine/src/cron-validator.mjs';

test('validates 5-field cron expressions', () => {
  assert.equal(validateCronExpression('*/5 * * * *').valid, true);
});

test('rejects invalid cron expressions and six-field syntax', () => {
  assert.equal(validateCronExpression('* * *').valid, false);
  assert.match(validateCronExpression('* * * * * *').error, /5 fields/);
});

test('nextRunAt is deterministic', () => {
  assert.equal(nextRunAt('0 * * * *', new Date('2026-03-30T10:15:00.000Z')), '2026-03-30T11:00:00.000Z');
});

test('assertAboveFloor rejects too-frequent expressions', () => {
  assert.throws(() => assertAboveFloor('* * * * *', 120), /below floor/);
});

test('minimum interval seconds is computed', () => {
  assert.equal(minimumIntervalSeconds('*/5 * * * *'), 300);
  assert.equal(minimumIntervalSeconds('0 * * * *'), 3600);
  assert.equal(minimumIntervalSeconds('0 0 * * *'), 86400);
});
