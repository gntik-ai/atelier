import test from 'node:test';
import assert from 'node:assert/strict';
import { SubscriptionLifecyclePublisher } from '../../../services/provisioning-orchestrator/src/events/realtime/SubscriptionLifecyclePublisher.mjs';

test('cloud event envelope matches lifecycle contract', () => {
  const publisher = new SubscriptionLifecyclePublisher();
  const event = publisher.buildEvent({ action: 'created', tenantId: 'tenant-1', workspaceId: 'ws-1', actorIdentity: 'user-1', subscription: { id: 'sub-1', channel_type: 'postgresql-changes', owner_identity: 'user-1' }, beforeState: null, afterState: { id: 'sub-1' } });
  for (const key of ['specversion', 'type', 'source', 'id', 'time', 'tenantid', 'workspaceid', 'data']) assert.ok(event[key]);
  assert.equal(event.specversion, '1.0');
  assert.equal(event.type, 'console.realtime.subscription.created');
  assert.equal(event.data.action, 'created');
  assert.equal(event.data.before_state, null);
  assert.deepEqual(event.data.after_state, { id: 'sub-1' });
});
