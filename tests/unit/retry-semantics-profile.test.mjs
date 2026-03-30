import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveProfile, RetrySemanticProfile, DEFAULT_OPERATION_TYPE } from '../../services/provisioning-orchestrator/src/models/retry-semantics-profile.mjs';

const fallback = { operation_type: '__default__', max_retries: 5, backoff_strategy: 'exponential', backoff_base_seconds: 30, intervention_conditions: [], failure_categories: {}, is_default: true };

test('resolveProfile with specific profile', () => {
  const resolved = resolveProfile({ operation_type: 'create-workspace', max_retries: 3, backoff_strategy: 'fixed', backoff_base_seconds: 5 }, fallback);
  assert.equal(resolved.maxRetries, 3);
});

test('resolveProfile returns default when specific missing', () => {
  assert.equal(resolveProfile(null, fallback).operationType, '__default__');
});

test('specific values override default values', () => {
  assert.equal(resolveProfile({ operation_type: 'x', max_retries: 2 }, fallback).maxRetries, 2);
});

test('validation rejects unknown backoff strategy', () => {
  assert.throws(() => RetrySemanticProfile({ backoffStrategy: 'weird' }));
});

test('DEFAULT_OPERATION_TYPE constant matches', () => {
  assert.equal(DEFAULT_OPERATION_TYPE, '__default__');
});
