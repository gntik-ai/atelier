import test from 'node:test';
import assert from 'node:assert/strict';
import { checkDeliveryRateLimit, checkSubscriptionQuota, getQuotaConfig, incrementRateCounter } from '../../services/webhook-engine/src/webhook-quota.mjs';

test('quota helpers honour limits and defaults', async () => {
  assert.equal(checkSubscriptionQuota('w1', 0, 1).allowed, true);
  assert.equal(checkSubscriptionQuota('w1', 1, 1).allowed, false);
  const first = await incrementRateCounter(null, 'w1');
  assert.equal(checkDeliveryRateLimit('w1', first, 2).allowed, true);
  const second = await incrementRateCounter(null, 'w1');
  assert.equal(checkDeliveryRateLimit('w1', second, 2).allowed, true);
  const third = await incrementRateCounter(null, 'w1');
  assert.equal(checkDeliveryRateLimit('w1', third, 2).allowed, false);
  assert.deepEqual(getQuotaConfig({ WEBHOOK_MAX_SUBSCRIPTIONS_PER_WORKSPACE: '7', WEBHOOK_MAX_DELIVERIES_PER_MINUTE_PER_WORKSPACE: '11' }), { maxSubscriptionsPerWorkspace: 7, maxDeliveriesPerMinutePerWorkspace: 11 });
});
