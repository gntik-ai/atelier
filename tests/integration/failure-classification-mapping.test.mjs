import test from 'node:test';
import assert from 'node:assert/strict';
import { loadMappingCache, classifyByErrorCode } from '../../services/provisioning-orchestrator/src/models/failure-classification.mjs';

test('classification mapping covers specific, generic, unknown and priority', () => {
  const cache = loadMappingCache([
    { error_code: 'TIMEOUT', operation_type: null, failure_category: 'transient', description: 'generic timeout', priority: 50 },
    { error_code: 'TIMEOUT', operation_type: 'create-workspace', failure_category: 'requires_intervention', description: 'specific timeout', priority: 10 }
  ]);
  assert.equal(classifyByErrorCode('TIMEOUT', 'create-workspace', cache).category, 'requires_intervention');
  assert.equal(classifyByErrorCode('TIMEOUT', 'other', cache).category, 'transient');
  assert.equal(classifyByErrorCode('UNKNOWN', 'other', cache).category, 'unknown');
});
