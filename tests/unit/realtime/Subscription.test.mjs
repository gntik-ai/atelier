import test from 'node:test';
import assert from 'node:assert/strict';
import { Subscription } from '../../../services/provisioning-orchestrator/src/models/realtime/Subscription.mjs';

const base = { id: 'sub-1', tenant_id: 'tenant-1', workspace_id: 'ws-1', channel_id: 'ch-1', channel_type: 'postgresql-changes', owner_identity: 'user-1' };

test('valid transitions succeed', () => {
  const active = new Subscription(base);
  const suspended = active.transition('suspend');
  const reactivated = suspended.transition('reactivate');
  const deleted = reactivated.transition('delete');
  assert.equal(suspended.status, 'suspended');
  assert.equal(reactivated.status, 'active');
  assert.equal(deleted.status, 'deleted');
});

test('invalid transitions throw and deleted is terminal', () => {
  const active = new Subscription(base);
  assert.throws(() => active.transition('reactivate'), /INVALID_STATUS_TRANSITION/);
  const deleted = active.transition('delete');
  assert.throws(() => deleted.transition('suspend'), /INVALID_STATUS_TRANSITION/);
});
