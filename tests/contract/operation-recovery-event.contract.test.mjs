import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRecoveredEvent } from '../../services/provisioning-orchestrator/src/events/async-operation-events.mjs';
import { operationRecoveryEventSchema } from '../../services/internal-contracts/src/index.mjs';

function validateAgainstRequiredSchema(event, schema) {
  for (const field of schema.required ?? []) {
    assert.notEqual(event[field], undefined, `missing ${field}`);
  }
}

test('buildRecoveredEvent conforms to contract', () => {
  const event = buildRecoveredEvent({
    operation_id: 'op-1',
    tenant_id: 'tenant-1',
    status: 'running',
    previous_status: 'running',
    correlation_id: 'op:tenant-1:abc:12345678',
    updated_at: new Date().toISOString()
  }, 'orphaned — no progress detected');

  validateAgainstRequiredSchema(event, operationRecoveryEventSchema);
  assert.equal(event.eventType, 'async_operation.recovered');
});
