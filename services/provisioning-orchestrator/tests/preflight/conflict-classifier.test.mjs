import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySeverity, computeGlobalRiskLevel, SEVERITY_TABLE, SEVERITY_FALLBACK } from '../../src/preflight/conflict-classifier.mjs';

test('classifySeverity: postgres_metadata table columns → high', () => {
  assert.equal(classifySeverity('postgres_metadata', 'table', ['columns']), 'high');
});

test('classifySeverity: kafka topic numPartitions → high', () => {
  assert.equal(classifySeverity('kafka', 'topic', ['numPartitions']), 'high');
});

test('classifySeverity: iam role description → low', () => {
  assert.equal(classifySeverity('iam', 'role', ['description']), 'low');
});

test('classifySeverity: iam role composites → medium', () => {
  assert.equal(classifySeverity('iam', 'role', ['composites']), 'medium');
});

test('classifySeverity: mongo_metadata index key → critical', () => {
  assert.equal(classifySeverity('mongo_metadata', 'index', ['key']), 'critical');
});

test('classifySeverity: unmapped diff key → fallback medium', () => {
  assert.equal(classifySeverity('iam', 'role', ['unknown_field']), 'medium');
});

test('classifySeverity: unmapped domain → fallback medium', () => {
  assert.equal(classifySeverity('nonexistent_domain', 'thing', ['stuff']), 'medium');
});

test('classifySeverity: multiple diffKeys returns maximum — description + composites → medium', () => {
  assert.equal(classifySeverity('iam', 'role', ['description', 'composites']), 'medium');
});

test('classifySeverity: multiple diffKeys including high level → high', () => {
  assert.equal(classifySeverity('postgres_metadata', 'table', ['indexes', 'columns']), 'high');
});

test('classifySeverity: identity_provider providerId → critical', () => {
  assert.equal(classifySeverity('iam', 'identity_provider', ['providerId']), 'critical');
});

test('classifySeverity: storage bucket cors → low', () => {
  assert.equal(classifySeverity('storage', 'bucket', ['cors']), 'low');
});

test('classifySeverity: functions action runtime → high', () => {
  assert.equal(classifySeverity('functions', 'action', ['runtime']), 'high');
});

test('computeGlobalRiskLevel: empty array → low', () => {
  assert.equal(computeGlobalRiskLevel([]), 'low');
});

test('computeGlobalRiskLevel: null → low', () => {
  assert.equal(computeGlobalRiskLevel(null), 'low');
});

test('computeGlobalRiskLevel: only low → low', () => {
  assert.equal(computeGlobalRiskLevel([{ severity: 'low' }]), 'low');
});

test('computeGlobalRiskLevel: low + medium → medium', () => {
  assert.equal(computeGlobalRiskLevel([{ severity: 'low' }, { severity: 'medium' }]), 'medium');
});

test('computeGlobalRiskLevel: low + medium + high → high', () => {
  assert.equal(computeGlobalRiskLevel([{ severity: 'low' }, { severity: 'medium' }, { severity: 'high' }]), 'high');
});

test('computeGlobalRiskLevel: all levels → critical', () => {
  assert.equal(computeGlobalRiskLevel([
    { severity: 'low' }, { severity: 'medium' }, { severity: 'high' }, { severity: 'critical' },
  ]), 'critical');
});

test('SEVERITY_TABLE is a data table, not empty', () => {
  assert.ok(Object.keys(SEVERITY_TABLE).length > 0);
  assert.equal(typeof SEVERITY_FALLBACK, 'string');
});

test('severity order: low < medium < high < critical', () => {
  const order = ['low', 'medium', 'high', 'critical'];
  for (let i = 0; i < order.length - 1; i++) {
    const a = computeGlobalRiskLevel([{ severity: order[i] }]);
    const b = computeGlobalRiskLevel([{ severity: order[i + 1] }]);
    const mixed = computeGlobalRiskLevel([{ severity: order[i] }, { severity: order[i + 1] }]);
    assert.equal(mixed, order[i + 1], `max of ${order[i]} and ${order[i + 1]} should be ${order[i + 1]}`);
  }
});
