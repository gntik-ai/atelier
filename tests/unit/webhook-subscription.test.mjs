import test from 'node:test';
import assert from 'node:assert/strict';
import { applyStatusTransition, buildSubscriptionRecord, canTransition, softDelete, validateSubscriptionInput } from '../../services/webhook-engine/src/webhook-subscription.mjs';
import { checkSubscriptionQuota } from '../../services/webhook-engine/src/webhook-quota.mjs';

test('valid subscription construction', () => {
  const record = buildSubscriptionRecord({ targetUrl: 'https://example.com/hook', eventTypes: ['document.created'] }, { tenantId: 't1', workspaceId: 'w1', actorId: 'u1' });
  assert.equal(record.status, 'active');
});

test('reject non-https, private ips, and unknown event types', () => {
  assert.throws(() => validateSubscriptionInput({ targetUrl: 'http://example.com', eventTypes: ['document.created'] }), { code: 'INVALID_URL' });
  assert.throws(() => validateSubscriptionInput({ targetUrl: 'https://127.0.0.1/hook', eventTypes: ['document.created'] }), { code: 'INVALID_URL' });
  assert.throws(() => validateSubscriptionInput({ targetUrl: 'https://example.com', eventTypes: ['wat'] }), { code: 'INVALID_EVENT_TYPES' });
});

test('quota and status transitions', () => {
  assert.equal(checkSubscriptionQuota('w1', 2, 3).allowed, true);
  assert.equal(checkSubscriptionQuota('w1', 3, 3).allowed, false);
  assert.equal(canTransition('active', 'paused'), true);
  const paused = applyStatusTransition({ status: 'active' }, 'paused');
  assert.equal(paused.status, 'paused');
  assert.throws(() => applyStatusTransition({ status: 'paused' }, 'disabled'));
  const deleted = softDelete({ status: 'active' });
  assert.equal(deleted.status, 'deleted');
  assert.ok(deleted.deleted_at);
});
