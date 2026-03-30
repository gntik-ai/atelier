import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDeduplicationEvent } from '../../services/provisioning-orchestrator/src/events/async-operation-events.mjs';
import { idempotencyDedupEventSchema } from '../../services/internal-contracts/src/index.mjs';

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

    if (config.type === 'boolean') {
      assert.equal(typeof payload[field], 'boolean', `${field} should be boolean`);
    }

    if (Array.isArray(config.enum)) {
      assert.ok(config.enum.includes(payload[field]), `${field} should be in enum`);
    }
  }
}

test('buildDeduplicationEvent conforms to schema', () => {
  const event = buildDeduplicationEvent({
    operation: {
      operation_id: '11111111-1111-4111-8111-111111111111',
      tenant_id: 'tenant-a',
      correlation_id: 'op:tenant-a:abc:12345678'
    },
    actor: { id: 'user-1', type: 'workspace_admin' },
    idempotencyKey: 'idem-1',
    paramsMismatch: false,
    correlationId: 'req-correlation'
  });

  assertMatchesSchema(idempotencyDedupEventSchema, event);
});
