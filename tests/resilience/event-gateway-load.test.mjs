import test from 'node:test';
import assert from 'node:assert/strict';

import { readGatewayPolicyValues } from '../../scripts/lib/gateway-policy.mjs';
import { OPENAPI_PATH, readJson } from '../../scripts/lib/quality-gates.mjs';
import { readReferenceDataset } from '../../scripts/lib/testing-strategy.mjs';

function tokenBucket({ ratePerSecond, burst, seconds, attemptsPerSecond }) {
  const capacity = ratePerSecond + burst;
  let tokens = capacity;
  let accepted = 0;
  let rejected = 0;

  for (let second = 0; second < seconds; second += 1) {
    tokens = Math.min(capacity, tokens + ratePerSecond);
    for (let attempt = 0; attempt < attemptsPerSecond; attempt += 1) {
      if (tokens >= 1) {
        tokens -= 1;
        accepted += 1;
      } else {
        rejected += 1;
      }
    }
  }

  return { accepted, rejected };
}

test('event gateway load fixture keeps websocket session admission bounded by documented subscription limits', () => {
  const values = readGatewayPolicyValues();
  const dataset = readReferenceDataset();
  const loadFixture = dataset.resilience_cases.find((entry) => entry.id === 'resilience-event-gateway-load');

  assert.ok(loadFixture, 'missing resilience-event-gateway-load fixture');
  assert.equal(values.gatewayPolicy.qos.profiles.realtime.requestsPerMinute, 180);
  assert.equal(values.gatewayPolicy.qos.profiles.realtime.burst, 80);

  const admittedSessions = Math.min(loadFixture.concurrent_sessions, loadFixture.topic_max_concurrent_subscriptions);
  const rejectedSessions = Math.max(loadFixture.concurrent_sessions - loadFixture.topic_max_concurrent_subscriptions, 0);

  assert.equal(admittedSessions, 200);
  assert.equal(rejectedSessions, 40);
});

test('event gateway publish load fixture rejects excess sustained traffic instead of buffering without bound', () => {
  const values = readGatewayPolicyValues();
  const dataset = readReferenceDataset();
  const document = readJson(OPENAPI_PATH);
  const loadFixture = dataset.resilience_cases.find((entry) => entry.id === 'resilience-event-gateway-load');
  const publishProfile = values.gatewayPolicy.qos.profiles.event_gateway;
  const backpressurePolicy = document.components.schemas.EventBackpressurePolicy;

  assert.ok(loadFixture, 'missing resilience-event-gateway-load fixture');
  assert.equal(publishProfile.requestsPerMinute, 180);
  assert.equal(publishProfile.burst, 60);
  assert.ok((backpressurePolicy.required ?? []).includes('maxInFlight'));
  assert.ok((backpressurePolicy.required ?? []).includes('overflowAction'));

  const result = tokenBucket({
    ratePerSecond: loadFixture.topic_max_publishes_per_second,
    burst: loadFixture.max_in_flight,
    seconds: loadFixture.publish_duration_seconds,
    attemptsPerSecond: loadFixture.publish_attempts_per_second
  });

  assert.equal(result.accepted, 1248);
  assert.equal(result.rejected, 552);
  assert.ok(result.rejected > 0, 'excess publishes should be rejected under bounded load');
});
