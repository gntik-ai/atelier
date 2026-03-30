import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExecutionRecord, buildMissedExecutionRecord, resolveOutcome, finalizeExecution } from '../../services/scheduling-engine/src/execution-model.mjs';

const job = { id: 'j1', tenant_id: 't1', workspace_id: 'w1' };

test('buildExecutionRecord shape', () => {
  const record = buildExecutionRecord(job, '2026-03-30T10:00:00.000Z', 'corr');
  assert.equal(record.status, 'running');
  assert.equal(record.correlation_id, 'corr');
});

test('buildMissedExecutionRecord uses missed status', () => {
  assert.equal(buildMissedExecutionRecord(job, '2026-03-30T10:00:00.000Z').status, 'missed');
});

test('resolveOutcome maps success failure and timeout', () => {
  assert.equal(resolveOutcome(new Date(), new Date(), { ok: true }), 'succeeded');
  assert.equal(resolveOutcome(new Date(), new Date(), { ok: false, error: 'boom' }), 'failed');
  assert.equal(resolveOutcome(new Date(), new Date(), { timeout: true }), 'timed_out');
});

test('finalizeExecution sets end fields', () => {
  const finalized = finalizeExecution({ started_at: '2026-03-30T10:00:00.000Z' }, 'succeeded', null);
  assert.equal(finalized.status, 'succeeded');
  assert.ok(finalized.finished_at);
  assert.ok(finalized.duration_ms >= 0);
});
