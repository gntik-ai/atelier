import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv from 'ajv';
import { asyncOperationStateChangedSchema } from '../../services/internal-contracts/src/index.mjs';
import { buildStateChangedEvent } from '../../services/provisioning-orchestrator/src/events/async-operation-events.mjs';

const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
const validate = ajv.compile(asyncOperationStateChangedSchema);

function baseOperation(overrides = {}) {
  return {
    operation_id: '2d7ceba0-56ee-42d4-9a57-bd7373530e93',
    tenant_id: 'tenant-a',
    actor_id: 'actor-1',
    actor_type: 'workspace_admin',
    workspace_id: 'ws-1',
    operation_type: 'WF-CON-001',
    status: 'running',
    error_summary: null,
    correlation_id: 'op:tenant-a:abc123:deadbeef',
    created_at: '2026-03-30T00:00:00.000Z',
    updated_at: '2026-03-30T00:00:01.000Z',
    ...overrides
  };
}

test('contract validates pending→running event payload', () => {
  const event = buildStateChangedEvent(baseOperation({ status: 'running' }), 'pending');
  const valid = validate(event);
  assert.equal(valid, true, JSON.stringify(validate.errors));
});

test('contract validates running→completed event payload', () => {
  const event = buildStateChangedEvent(baseOperation({ status: 'completed' }), 'running');
  const valid = validate(event);
  assert.equal(valid, true, JSON.stringify(validate.errors));
});

test('contract validates running→failed event payload', () => {
  const event = buildStateChangedEvent(
    baseOperation({
      status: 'failed',
      error_summary: { code: 'STEP_FAILED', message: 'Provisioning step failed cleanly.', failedStep: 'bind-resource' }
    }),
    'running'
  );
  const valid = validate(event);
  assert.equal(valid, true, JSON.stringify(validate.errors));
});
