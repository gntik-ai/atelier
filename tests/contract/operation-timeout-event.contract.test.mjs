import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTimedOutEvent } from '../../services/provisioning-orchestrator/src/events/async-operation-events.mjs';
import { operationTimeoutEventSchema } from '../../services/internal-contracts/src/index.mjs';

function validateAgainstRequiredSchema(event, schema) {
  for (const field of schema.required ?? []) {
    assert.notEqual(event[field], undefined, `missing ${field}`);
  }
}

test('buildTimedOutEvent conforms to contract', () => {
  const event = buildTimedOutEvent({
    operation_id: 'op-1',
    tenant_id: 'tenant-1',
    status: 'timed_out',
    previous_status: 'running',
    cancellation_reason: 'timeout exceeded',
    correlation_id: 'op:tenant-1:abc:12345678',
    updated_at: new Date().toISOString()
  });

  validateAgainstRequiredSchema(event, operationTimeoutEventSchema);
  assert.equal(event.eventType, 'async_operation.timed_out');
});
