import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeliveryAttemptRecord, buildDeliveryRecord, buildPayloadEnvelope, enforcePayloadSizeLimit, isTerminal, shouldAutoDisable } from '../../services/webhook-engine/src/webhook-delivery.mjs';

test('delivery helpers cover payloads and terminal state', () => {
  const subscription = { id: 's1', tenant_id: 't1', workspace_id: 'w1' };
  const event = { eventType: 'document.created', eventId: 'e1', data: { hello: 'world' } };
  const delivery = buildDeliveryRecord(subscription, event);
  const attempt = buildDeliveryAttemptRecord(delivery.id, 1, 'succeeded');
  const payload = buildPayloadEnvelope(delivery, event);
  assert.equal(payload.eventType, 'document.created');
  assert.equal(attempt.attempt_num, 1);
  assert.equal(isTerminal({ status: 'succeeded' }), true);
  assert.equal(shouldAutoDisable({ consecutive_failures: 5 }, 5), true);
  const limited = enforcePayloadSizeLimit({ ...payload, data: { blob: 'x'.repeat(1000) } }, 100);
  assert.equal(limited.truncated, true);
  assert.ok(limited.payload_ref);
});
