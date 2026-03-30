import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyByErrorCode, loadMappingCache, FailureCategory } from '../../services/provisioning-orchestrator/src/models/failure-classification.mjs';

const cache = loadMappingCache([
  { error_code: 'E1', operation_type: null, failure_category: 'permanent', description: 'generic', suggested_actions: ['fix'], priority: 20 },
  { error_code: 'E1', operation_type: 'opA', failure_category: 'transient', description: 'specific', suggested_actions: ['retry'], priority: 10 },
  { error_code: 'E2', operation_type: null, failure_category: 'requires_intervention', description: 'infra', suggested_actions: ['escalate'], priority: 5 }
]);

test('exact match wins over generic', () => {
  assert.equal(classifyByErrorCode('E1', 'opA', cache).category, FailureCategory.TRANSIENT);
});

test('generic fallback used when specific missing', () => {
  assert.equal(classifyByErrorCode('E1', 'opB', cache).category, FailureCategory.PERMANENT);
});

test('unknown returned when not mapped', () => {
  assert.equal(classifyByErrorCode('NOPE', 'opA', cache).category, FailureCategory.UNKNOWN);
});

test('priority ordering preserved', () => {
  const ordered = loadMappingCache([{ error_code: 'E3', failure_category: 'permanent', description: 'late', priority: 50 }, { error_code: 'E3', failure_category: 'transient', description: 'early', priority: 1 }]);
  assert.equal(classifyByErrorCode('E3', null, ordered).category, FailureCategory.TRANSIENT);
});

test('null or empty errorCode maps to unknown', () => {
  assert.equal(classifyByErrorCode(null, 'op', cache).category, FailureCategory.UNKNOWN);
  assert.equal(classifyByErrorCode('  ', 'op', cache).category, FailureCategory.UNKNOWN);
});

test('loadMappingCache normalizes rows', () => {
  assert.equal(cache[0].priority, 5);
  assert.equal(cache.length, 3);
});
