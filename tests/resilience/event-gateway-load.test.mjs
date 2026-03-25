import test from 'node:test';
import assert from 'node:assert/strict';

import { readGatewayPolicyValues } from '../../scripts/lib/gateway-policy.mjs';
import { OPENAPI_PATH, readJson } from '../../scripts/lib/quality-gates.mjs';
import { readReferenceDataset } from '../../scripts/lib/testing-strategy.mjs';
import {
  buildReconnectResumePlan,
  resolveEventGatewayProfile,
  summarizeRelativeOrdering
} from '../../services/event-gateway/src/runtime.mjs';

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

test('event gateway replay and reconnect fixtures keep resume windows bounded and surface relative-order violations', () => {
  const dataset = readReferenceDataset();
  const replayFixture = dataset.resilience_cases.find((entry) => entry.id === 'resilience-event-replay');
  const reconnectFixture = dataset.resilience_cases.find((entry) => entry.id === 'resilience-event-reconnect-order');
  const profile = resolveEventGatewayProfile(
    {
      tenantId: 'ten_01growthalpha',
      workspaceId: 'wrk_01alphadev',
      workspaceEnvironment: 'dev',
      planId: 'pln_01growth'
    },
    {
      resourceId: 'res_01billing',
      replayWindowHours: replayFixture.topic_replay_window_hours,
      maxConcurrentSubscriptions: 400
    }
  );
  const resumePlan = buildReconnectResumePlan({
    disconnectedAt: '2026-03-25T10:00:00Z',
    reconnectAt: `2026-03-25T10:01:${String(reconnectFixture.disconnect_gap_seconds - 60).padStart(2, '0')}Z`,
    profile,
    lastEventId: reconnectFixture.last_event_id,
    lastSequence: reconnectFixture.last_sequence,
    retainedEvents: reconnectFixture.retained_events,
    replay: {
      mode: 'window',
      windowHours: replayFixture.requested_window_hours,
      maxEvents: replayFixture.requested_max_events
    }
  });
  const ordering = summarizeRelativeOrdering(reconnectFixture.deliveries);

  assert.ok(replayFixture, 'missing resilience-event-replay fixture');
  assert.ok(reconnectFixture, 'missing resilience-event-reconnect-order fixture');
  assert.equal(replayFixture.requested_window_hours <= replayFixture.topic_replay_window_hours, true);
  assert.equal(resumePlan.canResume, true);
  assert.equal(resumePlan.gapSeconds, reconnectFixture.disconnect_gap_seconds);
  assert.equal(resumePlan.graceSeconds, reconnectFixture.reconnect_grace_seconds);
  assert.equal(resumePlan.relativeOrderScope, replayFixture.relative_order_scope);
  assert.equal(ordering.ok, false);
  assert.equal(ordering.violations.length, 1);
  assert.equal(ordering.violations[0].eventId, 'evt_03');
});
