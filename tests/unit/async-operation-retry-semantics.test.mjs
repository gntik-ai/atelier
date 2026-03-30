import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../services/provisioning-orchestrator/src/actions/async-operation-retry-semantics.mjs';

test('known operationType returns specific profile', async () => {
  const result = await main({ operationType: 'create-workspace' }, { findByOperationType: async () => ({ operation_type: 'create-workspace', max_retries: 2, backoff_strategy: 'fixed', backoff_base_seconds: 3 }), findDefault: async () => ({ operation_type: '__default__', max_retries: 5, backoff_strategy: 'exponential', backoff_base_seconds: 30 }) });
  assert.equal(result.body.maxRetries, 2);
});

test('unknown operationType returns default profile', async () => {
  const result = await main({ operationType: 'unknown' }, { findByOperationType: async () => null, findDefault: async () => ({ operation_type: '__default__', max_retries: 5, backoff_strategy: 'exponential', backoff_base_seconds: 30 }) });
  assert.equal(result.body.operationType, '__default__');
});

test('omitted operationType returns default profile', async () => {
  const result = await main({}, { findDefault: async () => ({ operation_type: '__default__', max_retries: 5, backoff_strategy: 'exponential', backoff_base_seconds: 30 }) });
  assert.equal(result.statusCode, 200);
});

test('missing default profile returns 500', async () => {
  const result = await main({}, { findDefault: async () => null });
  assert.equal(result.statusCode, 500);
});
