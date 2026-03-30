import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlag, shouldDebounceNotification, ManualInterventionFlag } from '../../services/provisioning-orchestrator/src/models/manual-intervention-flag.mjs';

test('createFlag builds valid flag', () => {
  const flag = createFlag({ operationId: 'op', tenantId: 't', actorId: 'a', reason: 'needs help', attemptCountAtFlag: 5 });
  assert.equal(flag.status, 'pending');
});

test('shouldDebounceNotification returns true inside window', () => {
  assert.equal(shouldDebounceNotification({ lastNotificationAt: new Date().toISOString() }, 15), true);
});

test('shouldDebounceNotification returns false outside window', () => {
  assert.equal(shouldDebounceNotification({ lastNotificationAt: new Date(Date.now() - 16 * 60_000).toISOString() }, 15), false);
});

test('shouldDebounceNotification returns false when null timestamp', () => {
  assert.equal(shouldDebounceNotification({ lastNotificationAt: null }, 15), false);
});

test('status can transition to resolved in value object representation', () => {
  const flag = ManualInterventionFlag({ operationId: 'op', tenantId: 't', actorId: 'a', reason: 'needs help', attemptCountAtFlag: 5, status: 'resolved' });
  assert.equal(flag.status, 'resolved');
});
