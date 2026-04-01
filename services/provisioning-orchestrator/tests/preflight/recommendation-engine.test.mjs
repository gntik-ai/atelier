import test from 'node:test';
import assert from 'node:assert/strict';
import { getRecommendation, RECOMMENDATIONS, GENERIC_RECOMMENDATION } from '../../src/preflight/recommendation-engine.mjs';

test('getRecommendation: postgres_metadata table high includes resource name and mentions structure', () => {
  const rec = getRecommendation('postgres_metadata', 'table', 'high', 'events');
  assert.ok(rec.includes('events'));
  assert.ok(rec.includes('columnas') || rec.includes('constraints') || rec.includes('estructura'));
});

test('getRecommendation: kafka topic high includes resource name and mentions particiones', () => {
  const rec = getRecommendation('kafka', 'topic', 'high', 'my-topic');
  assert.ok(rec.includes('my-topic'));
  assert.ok(rec.includes('particiones'));
});

test('getRecommendation: iam role medium includes resource name and mentions permisos', () => {
  const rec = getRecommendation('iam', 'role', 'medium', 'editor');
  assert.ok(rec.includes('editor'));
  assert.ok(rec.includes('permisos') || rec.includes('composites'));
});

test('getRecommendation: iam role low includes resource name and is not alarming', () => {
  const rec = getRecommendation('iam', 'role', 'low', 'viewer');
  assert.ok(rec.includes('viewer'));
  assert.ok(rec.includes('no afecta'));
});

test('getRecommendation: unmapped combination returns generic recommendation', () => {
  const rec = getRecommendation('nonexistent_domain', 'thing', 'medium', 'my-resource');
  assert.ok(rec.includes('my-resource'));
  assert.equal(rec, GENERIC_RECOMMENDATION.replace(/\{resource_name\}/g, 'my-resource'));
});

test('getRecommendation: interpolation of resource_name with special chars', () => {
  const rec = getRecommendation('iam', 'role', 'low', 'my-bucket/sub');
  assert.ok(rec.includes('my-bucket/sub'));
});

test('getRecommendation: all mapped domains have entries for all severity levels', () => {
  for (const [domain, resources] of Object.entries(RECOMMENDATIONS)) {
    for (const [resourceType, severities] of Object.entries(resources)) {
      for (const sev of ['low', 'medium', 'high', 'critical']) {
        const rec = getRecommendation(domain, resourceType, sev, 'test-resource');
        assert.ok(rec.includes('test-resource'), `${domain}.${resourceType}.${sev} should contain resource name`);
        assert.ok(rec.length > 10, `${domain}.${resourceType}.${sev} should be meaningful`);
      }
    }
  }
});

test('RECOMMENDATIONS map covers all 6 domains', () => {
  const expected = ['iam', 'postgres_metadata', 'mongo_metadata', 'kafka', 'functions', 'storage'];
  for (const d of expected) {
    assert.ok(RECOMMENDATIONS[d], `RECOMMENDATIONS should contain domain ${d}`);
  }
});
