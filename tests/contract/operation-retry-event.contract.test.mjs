import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRetryEvent } from '../../services/provisioning-orchestrator/src/events/async-operation-events.mjs';
import { operationRetryEventSchema } from '../../services/internal-contracts/src/index.mjs';

function assertMatchesSchema(schema, payload) {
  for (const field of schema.required ?? []) {
    assert.notEqual(payload[field], undefined, `missing required field ${field}`);
  }

  for (const [field, config] of Object.entries(schema.properties ?? {})) {
    if (payload[field] === undefined || payload[field] === null) {
      continue;
    }

    if (config.type === 'string') {
      assert.equal(typeof payload[field], 'string', `${field} should be string`);
    }

    if (config.type === 'integer') {
      assert.equal(Number.isInteger(payload[field]), true, `${field} should be integer`);
    }

    if (Array.isArray(config.enum)) {
      assert.ok(config.enum.includes(payload[field]), `${field} should be in enum`);
    }
  }
}

test('buildRetryEvent conforms to schema', () => {
  const event = buildRetryEvent({
    operation: {
      operation_id: '11111111-1111-4111-8111-111111111111',
      tenant_id: 'tenant-a',
      correlation_id: 'op:tenant-a:prev:12345678'
    },
    attempt: {
      attempt_id: '22222222-2222-4222-8222-222222222222',
      attempt_number: 1,
      correlation_id: 'op:tenant-a:new:abcdef12',
      created_at: '2026-03-30T00:00:00.000Z'
    },
    actor: { id: 'user-1', type: 'workspace_admin' },
    previousCorrelationId: 'op:tenant-a:prev:12345678'
  });

  assertMatchesSchema(operationRetryEventSchema, event);
});
