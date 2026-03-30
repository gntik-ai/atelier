import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFilter, FilterValidationError } from '../../../services/realtime-gateway/src/filters/filter-parser.mjs';
import { checkComplexity } from '../../../services/realtime-gateway/src/filters/complexity-checker.mjs';

test('parseFilter accepts a valid filter payload', () => {
  const parsed = parseFilter({
    operation: 'INSERT',
    entity: 'orders',
    predicates: [{ field: 'status', op: 'eq', value: 'open' }]
  });

  assert.equal(parsed.passAll, false);
  assert.equal(parsed.operation, 'INSERT');
  assert.equal(parsed.entity, 'orders');
  assert.equal(parsed.predicates.length, 1);
});

test('parseFilter rejects invalid operation values', () => {
  assert.throws(() => parseFilter({ operation: 'UPSERT' }), FilterValidationError);
});

test('parseFilter treats null and empty filters as pass-all', () => {
  assert.deepEqual(parseFilter(null), { passAll: true, predicates: [] });
  assert.deepEqual(parseFilter({}), { passAll: true, predicates: [] });
});

test('parseFilter permits optional operation and entity fields', () => {
  const parsed = parseFilter({
    predicates: [{ field: 'status', op: 'eq', value: 'open' }]
  });

  assert.equal(parsed.passAll, false);
  assert.equal(parsed.operation, undefined);
  assert.equal(parsed.entity, undefined);
});

test('checkComplexity rejects filters that exceed max predicates', () => {
  const parsed = parseFilter({
    predicates: [
      { field: 'a', op: 'eq', value: 1 },
      { field: 'b', op: 'eq', value: 2 }
    ]
  });

  assert.throws(() => checkComplexity(parsed, 1), (error) => {
    assert.ok(error instanceof FilterValidationError);
    assert.match(error.validationErrors[0], /maximum predicate count/);
    return true;
  });
});
