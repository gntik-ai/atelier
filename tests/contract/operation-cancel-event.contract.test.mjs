import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCancelledEvent } from '../../services/provisioning-orchestrator/src/events/async-operation-events.mjs';
import { operationCancelEventSchema } from '../../services/internal-contracts/src/index.mjs';

function validateAgainstRequiredSchema(event, schema) {
  for (const field of schema.required ?? []) {
    assert.notEqual(event[field], undefined, `missing ${field}`);
  }
}

test('buildCancelledEvent conforms to contract', () => {
  const event = buildCancelledEvent({
    operation_id: 'op-1',
    tenant_id: 'tenant-1',
    actor_id: 'actor-1',
    status: 'cancelled',
    previous_status: 'pending',
    cancellation_reason: 'manual cancel',
    correlation_id: 'op:tenant-1:abc:12345678',
    updated_at: new Date().toISOString()
  }, 'actor-1');

  validateAgainstRequiredSchema(event, operationCancelEventSchema);
  assert.equal(event.eventType, 'async_operation.cancelled');
});
