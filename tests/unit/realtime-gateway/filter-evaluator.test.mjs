import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFilter } from '../../../services/realtime-gateway/src/filters/filter-evaluator.mjs';

const event = {
  operation: 'INSERT',
  entity: 'orders',
  data: {
    status: 'open',
    tags: ['vip'],
    description: 'priority order'
  }
};

test('evaluateFilter returns true for pass-all filters', () => {
  assert.equal(evaluateFilter({ passAll: true }, event), true);
});

test('evaluateFilter matches operation, entity, and all predicates', () => {
  const result = evaluateFilter({
    passAll: false,
    operation: 'INSERT',
    entity: 'orders',
    predicates: [
      { field: 'status', op: 'eq', value: 'open' },
      { field: 'description', op: 'contains', value: 'priority' },
      { field: 'status', op: 'neq', value: 'closed' }
    ]
  }, event);

  assert.equal(result, true);
});

test('evaluateFilter fails when operation does not match', () => {
  assert.equal(evaluateFilter({ passAll: false, operation: 'DELETE', predicates: [] }, event), false);
});

test('evaluateFilter fails when entity does not match', () => {
  assert.equal(evaluateFilter({ passAll: false, entity: 'customers', predicates: [] }, event), false);
});

test('evaluateFilter fails safely for unknown predicate operators', () => {
  assert.equal(evaluateFilter({
    passAll: false,
    predicates: [{ field: 'status', op: 'gt', value: 'open' }]
  }, event), false);
});

test('evaluateFilter fails when any predicate fails', () => {
  assert.equal(evaluateFilter({
    passAll: false,
    predicates: [{ field: 'status', op: 'eq', value: 'closed' }]
  }, event), false);
});
