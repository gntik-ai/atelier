import test from 'node:test';
import assert from 'node:assert/strict';
import { SubscriptionQuota, checkAllowed } from '../../../services/provisioning-orchestrator/src/models/realtime/SubscriptionQuota.mjs';

test('under-limit allows and at-limit blocks', () => {
  assert.equal(checkAllowed(1, 2), true);
  assert.equal(checkAllowed(2, 2), false);
});

test('workspace overrides tenant and tenant overrides platform default', () => {
  assert.equal(new SubscriptionQuota({ workspaceQuota: 2, tenantQuota: 5, platformDefault: 10 }).maxSubscriptions, 2);
  assert.equal(new SubscriptionQuota({ tenantQuota: 5, platformDefault: 10 }).maxSubscriptions, 5);
  assert.equal(new SubscriptionQuota({ platformDefault: 10 }).maxSubscriptions, 10);
});
