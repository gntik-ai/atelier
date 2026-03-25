import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EVENT_GATEWAY_NOTIFICATION_QUEUE_TYPES,
  EVENT_GATEWAY_PAYLOAD_ENCODINGS,
  EVENT_GATEWAY_REPLAY_MODES,
  buildEventDeliveryEnvelope,
  buildEventGatewayPublishRequest,
  buildEventGatewaySubscriptionRequest,
  buildReconnectResumePlan,
  resolveEventGatewayProfile,
  summarizeRelativeOrdering,
  validateEventPublicationRequest,
  validateEventSubscriptionRequest
} from '../../services/event-gateway/src/runtime.mjs';

test('event gateway runtime resolves plan-aware payload, replay, queue, and observability guardrails', () => {
  const growthProfile = resolveEventGatewayProfile(
    {
      tenantId: 'ten_01growthalpha',
      workspaceId: 'wrk_01alphadev',
      workspaceEnvironment: 'dev',
      planId: 'pln_01growth'
    },
    {
      resourceId: 'res_01billing',
      allowedTransports: ['http_publish', 'sse', 'websocket'],
      maxPublishesPerSecond: 600,
      maxConcurrentSubscriptions: 400,
      replayWindowHours: 24,
      partitionSelectionPolicy: 'explicit_allowed'
    }
  );
  const enterpriseProfile = resolveEventGatewayProfile(
    {
      tenantId: 'ten_01enterprisealpha',
      workspaceId: 'wrk_01alphaprod',
      workspaceEnvironment: 'prod',
      planId: 'pln_01enterprise'
    },
    {
      resourceId: 'res_01orders',
      allowedTransports: ['http_publish', 'sse', 'websocket'],
      maxPublishesPerSecond: 3000,
      maxConcurrentSubscriptions: 1200,
      replayWindowHours: 168,
      partitionSelectionPolicy: 'caller_hint'
    }
  );

  assert.deepEqual(EVENT_GATEWAY_PAYLOAD_ENCODINGS, ['json', 'base64']);
  assert.deepEqual(EVENT_GATEWAY_NOTIFICATION_QUEUE_TYPES, ['broadcast', 'workspace', 'user', 'session']);
  assert.equal(EVENT_GATEWAY_REPLAY_MODES.includes('from_timestamp'), true);
  assert.equal(growthProfile.payload.maxJsonPayloadBytes, 131072);
  assert.equal(growthProfile.payload.maxBinaryPayloadBytes, 98304);
  assert.equal(growthProfile.stream.maxReplayBatchSize, 200);
  assert.equal(growthProfile.notification.maxQueueDepth, 256);
  assert.equal(growthProfile.replay.maxWindowHours, 24);
  assert.equal(growthProfile.partitionSelectionPolicy, 'explicit_allowed');
  assert.equal(growthProfile.observability.relativeOrderScope, 'key_within_partition');

  assert.equal(enterpriseProfile.payload.maxJsonPayloadBytes, 262144);
  assert.equal(enterpriseProfile.stream.maxInFlight, 120);
  assert.equal(enterpriseProfile.stream.reconnectGraceSeconds, 300);
  assert.equal(enterpriseProfile.replay.maxWindowHours, 168);
  assert.equal(enterpriseProfile.notification.maxQueueDepth, 1024);
});

test('event gateway runtime validates publish envelopes for JSON and binary payloads with partition policy', () => {
  const okJson = validateEventPublicationRequest({
    context: {
      tenantId: 'ten_01growthalpha',
      workspaceId: 'wrk_01alphadev',
      workspaceEnvironment: 'dev',
      planId: 'pln_01growth'
    },
    topic: {
      resourceId: 'res_01billing',
      allowedTransports: ['http_publish', 'sse', 'websocket'],
      partitionStrategy: 'producer_key',
      partitionCount: 6,
      replayWindowHours: 24,
      partitionSelectionPolicy: 'explicit_allowed'
    },
    request: {
      tenantId: 'ten_01growthalpha',
      workspaceId: 'wrk_01alphadev',
      channel: 'billing.invoice.created',
      eventType: 'billing.invoice.created',
      contentType: 'application/json',
      payloadEncoding: 'json',
      payload: { invoiceId: 'inv_01', total: 42 },
      key: 'inv_01',
      timestamp: '2026-03-25T10:30:00Z',
      partition: 3,
      headers: {
        'x-trace-ref': 'trace-01'
      }
    }
  });
  const badBinary = validateEventPublicationRequest({
    context: {
      tenantId: 'ten_01growthalpha',
      workspaceId: 'wrk_01alphadev',
      workspaceEnvironment: 'dev',
      planId: 'pln_01growth'
    },
    topic: {
      resourceId: 'res_01billing',
      allowedTransports: ['http_publish', 'sse', 'websocket'],
      partitionStrategy: 'producer_key',
      partitionCount: 4,
      partitionSelectionPolicy: 'provider_managed'
    },
    request: {
      tenantId: 'ten_01growthalpha',
      workspaceId: 'wrk_01alphadev',
      channel: 'billing.invoice.attachment',
      eventType: 'billing.invoice.attachment',
      contentType: 'application/json',
      payloadEncoding: 'base64',
      payload: 'not-base64',
      partition: 7,
      headers: {
        Authorization: 'forbidden'
      }
    }
  });

  assert.equal(okJson.ok, true);
  assert.equal(okJson.payloadBytes > 0, true);
  assert.deepEqual(okJson.violations, []);

  assert.equal(badBinary.ok, false);
  assert.equal(
    badBinary.violations.includes('Binary payloads must declare a non-JSON contentType.'),
    true
  );
  assert.equal(
    badBinary.violations.includes('binary payloads must be base64 encoded.'),
    true
  );
  assert.equal(
    badBinary.violations.includes('partition selection policy provider_managed does not allow caller-supplied partition hints.'),
    true
  );
  assert.equal(
    badBinary.violations.includes('header Authorization is reserved for gateway-managed context and cannot be forwarded.'),
    true
  );
});

test('event gateway runtime builds publish and subscription contracts with queue, replay, and reconnect metadata', () => {
  const publish = buildEventGatewayPublishRequest({
    requestId: 'req_evt_publish_01',
    correlationId: 'corr_evt_publish_01',
    topicRef: 'res_01billing',
    topic: {
      resourceId: 'res_01billing',
      allowedTransports: ['http_publish', 'sse', 'websocket'],
      partitionStrategy: 'producer_key',
      partitionCount: 6,
      replayWindowHours: 24,
      maxPublishesPerSecond: 600,
      partitionSelectionPolicy: 'explicit_allowed'
    },
    request: {
      tenantId: 'ten_01growthalpha',
      workspaceId: 'wrk_01alphadev',
      channel: 'billing.invoice.created',
      eventType: 'billing.invoice.created',
      contentType: 'application/json',
      payloadEncoding: 'json',
      payload: { invoiceId: 'inv_01' },
      key: 'inv_01',
      partition: 2,
      notificationQueue: {
        queueType: 'workspace',
        queueKey: 'workspace:billing-console'
      }
    },
    context: {
      tenantId: 'ten_01growthalpha',
      workspaceId: 'wrk_01alphadev',
      workspaceEnvironment: 'dev',
      planId: 'pln_01growth'
    },
    idempotencyKey: 'idem_evt_publish_01',
    scopes: ['events:publish'],
    effectiveRoles: ['workspace_developer'],
    authorizationDecisionId: 'authz_evt_publish_01',
    requestedAt: '2026-03-25T10:40:00Z'
  });
  const subscription = buildEventGatewaySubscriptionRequest({
    requestId: 'req_evt_sub_01',
    correlationId: 'corr_evt_sub_01',
    sessionId: 'wss_01billing',
    subscriptionId: 'sub_01billing',
    topicRef: 'res_01billing',
    topic: {
      resourceId: 'res_01billing',
      allowedTransports: ['http_publish', 'sse', 'websocket'],
      replayWindowHours: 24,
      maxConcurrentSubscriptions: 400
    },
    request: {
      topicName: 'billing-events',
      channel: 'billing.invoice.created',
      cursorStart: 'latest',
      batchSize: 150,
      maxInFlight: 32,
      heartbeatSeconds: 15,
      transport: 'websocket',
      notificationQueue: {
        queueType: 'workspace',
        queueKey: 'workspace:billing-console',
        deliveryMode: 'fanout'
      },
      replay: {
        mode: 'window',
        windowHours: 4,
        maxEvents: 150
      },
      reconnect: {
        graceSeconds: 90,
        maxAttempts: 5
      }
    },
    context: {
      tenantId: 'ten_01growthalpha',
      workspaceId: 'wrk_01alphadev',
      workspaceEnvironment: 'dev',
      planId: 'pln_01growth'
    },
    scopes: ['events:subscribe'],
    effectiveRoles: ['workspace_developer'],
    authorizationDecisionId: 'authz_evt_sub_01',
    requestedAt: '2026-03-25T10:41:00Z'
  });
  const envelope = buildEventDeliveryEnvelope({
    eventId: 'evt_01billing',
    eventType: 'billing.invoice.created',
    topicName: 'billing-events',
    topicResourceId: 'res_01billing',
    channel: 'billing.invoice.created',
    partition: 2,
    offset: 18,
    sequence: 19,
    publishedAt: '2026-03-25T10:42:00Z',
    contentType: 'application/json',
    payloadEncoding: 'json',
    correlationId: 'corr_evt_publish_01',
    payload: { invoiceId: 'inv_01' },
    key: 'inv_01',
    headers: { 'x-trace-ref': 'trace-01' },
    lagMs: 28,
    notificationQueue: subscription.request.queue_binding,
    replay: subscription.request.replay_policy,
    delivery: {
      transport: 'websocket',
      attempt: 1,
      resumed: false
    }
  });

  assert.equal(publish.ok, true);
  assert.equal(publish.request.payload_encoding, 'json');
  assert.equal(publish.request.requested_partition, 2);
  assert.equal(publish.request.notification_queue.queue_type, 'workspace');
  assert.equal(publish.request.publish_policy_snapshot.max_publishes_per_second, 600);

  assert.equal(subscription.ok, true);
  assert.equal(subscription.request.transport, 'websocket');
  assert.equal(subscription.request.queue_binding.queue_type, 'workspace');
  assert.equal(subscription.request.replay_policy.mode, 'window');
  assert.equal(subscription.request.reconnect_policy.grace_seconds, 90);

  assert.equal(envelope.queue.queueType, 'workspace');
  assert.equal(envelope.replay.mode, 'window');
  assert.equal(envelope.delivery.relativeOrderScope, 'key_within_partition');
});

test('event gateway runtime validates replay windows and computes reconnect and relative-order summaries', () => {
  const subscriptionValidation = validateEventSubscriptionRequest({
    context: {
      tenantId: 'ten_01growthalpha',
      workspaceId: 'wrk_01alphadev',
      workspaceEnvironment: 'dev',
      planId: 'pln_01growth'
    },
    topic: {
      resourceId: 'res_01billing',
      allowedTransports: ['http_publish', 'sse', 'websocket'],
      replayWindowHours: 24,
      maxConcurrentSubscriptions: 400
    },
    request: {
      topicName: 'billing-events',
      channel: 'billing.invoice.created',
      cursorStart: 'latest',
      batchSize: 200,
      transport: 'sse',
      replay: {
        mode: 'window',
        windowHours: 48,
        maxEvents: 350
      }
    }
  });
  const resumePlan = buildReconnectResumePlan({
    disconnectedAt: '2026-03-25T10:00:00Z',
    reconnectAt: '2026-03-25T10:01:15Z',
    profile: resolveEventGatewayProfile(
      {
        tenantId: 'ten_01growthalpha',
        workspaceId: 'wrk_01alphadev',
        workspaceEnvironment: 'dev',
        planId: 'pln_01growth'
      },
      {
        resourceId: 'res_01billing',
        replayWindowHours: 24
      }
    ),
    lastEventId: 'evt_01billing',
    lastSequence: 18,
    retainedEvents: 4
  });
  const ordering = summarizeRelativeOrdering([
    { eventId: 'evt_01', partition: 2, key: 'inv_01', sequence: 1 },
    { eventId: 'evt_02', partition: 2, key: 'inv_01', sequence: 2 },
    { eventId: 'evt_03', partition: 2, key: 'inv_01', sequence: 2 },
    { eventId: 'evt_04', partition: 3, key: 'inv_02', sequence: 1 }
  ]);

  assert.equal(subscriptionValidation.ok, false);
  assert.equal(
    subscriptionValidation.violations.includes('replay window 48h exceeds the topic allowance 24h.'),
    true
  );
  assert.equal(
    subscriptionValidation.violations.includes('replay maxEvents 350 exceeds the limit 200.'),
    true
  );

  assert.equal(resumePlan.canResume, true);
  assert.equal(resumePlan.gapSeconds, 75);
  assert.equal(resumePlan.resumeMode, 'cursor');
  assert.equal(resumePlan.relativeOrderScope, 'key_within_partition');

  assert.equal(ordering.ok, false);
  assert.equal(ordering.scope, 'key_within_partition');
  assert.equal(ordering.violations.length, 1);
  assert.equal(ordering.violations[0].eventId, 'evt_03');
});
