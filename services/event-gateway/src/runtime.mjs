import { Buffer } from 'node:buffer';

import { getContract, resolveWorkspaceEffectiveCapabilities } from '../../internal-contracts/src/index.mjs';

const eventGatewayPublishRequestContract = getContract('event_gateway_publish_request');
const eventGatewayPublishResultContract = getContract('event_gateway_publish_result');
const eventGatewaySubscriptionRequestContract = getContract('event_gateway_subscription_request');
const eventGatewaySubscriptionStatusContract = getContract('event_gateway_subscription_status');

export const EVENT_GATEWAY_TRANSPORTS = Object.freeze(['http_publish', 'sse', 'websocket']);
export const EVENT_GATEWAY_PAYLOAD_ENCODINGS = Object.freeze(['json', 'base64']);
export const EVENT_GATEWAY_JSON_CONTENT_TYPES = Object.freeze(['application/json', 'application/cloudevents+json']);
export const EVENT_GATEWAY_BINARY_CONTENT_TYPES = Object.freeze([
  'application/octet-stream',
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/zip'
]);
export const EVENT_GATEWAY_NOTIFICATION_QUEUE_TYPES = Object.freeze(['broadcast', 'workspace', 'user', 'session']);
export const EVENT_GATEWAY_NOTIFICATION_DELIVERY_MODES = Object.freeze(['fanout', 'competing_consumers']);
export const EVENT_GATEWAY_ACK_MODES = Object.freeze(['implicit', 'explicit']);
export const EVENT_GATEWAY_REPLAY_MODES = Object.freeze([
  'latest',
  'earliest',
  'last_event_id',
  'from_timestamp',
  'window'
]);
export const EVENT_GATEWAY_RELATIVE_ORDER_SCOPE = 'key_within_partition';
export const EVENT_GATEWAY_REQUIRED_METRICS = Object.freeze([
  'in_falcone_event_gateway_active_ws_connections',
  'in_falcone_event_gateway_active_sse_streams',
  'in_falcone_event_gateway_publish_total',
  'in_falcone_event_gateway_backpressure_rejections_total'
]);

const PLAN_DEFAULTS = Object.freeze({
  starter: Object.freeze({
    payload: Object.freeze({
      maxJsonPayloadBytes: 65536,
      maxBinaryPayloadBytes: 32768,
      maxHeaders: 8,
      maxHeaderValueBytes: 256,
      maxHeaderAggregateBytes: 2048
    }),
    stream: Object.freeze({
      maxBatchSize: 50,
      maxInFlight: 16,
      maxSessionSubscriptions: 2,
      heartbeatSeconds: 15,
      maxReplayBatchSize: 50,
      reconnectGraceSeconds: 30,
      maxReconnectAttempts: 3
    }),
    notification: Object.freeze({
      maxQueueDepth: 64,
      ackMode: 'implicit',
      deliveryMode: 'fanout'
    })
  }),
  growth: Object.freeze({
    payload: Object.freeze({
      maxJsonPayloadBytes: 131072,
      maxBinaryPayloadBytes: 98304,
      maxHeaders: 16,
      maxHeaderValueBytes: 512,
      maxHeaderAggregateBytes: 4096
    }),
    stream: Object.freeze({
      maxBatchSize: 200,
      maxInFlight: 48,
      maxSessionSubscriptions: 6,
      heartbeatSeconds: 15,
      maxReplayBatchSize: 200,
      reconnectGraceSeconds: 90,
      maxReconnectAttempts: 5
    }),
    notification: Object.freeze({
      maxQueueDepth: 256,
      ackMode: 'implicit',
      deliveryMode: 'fanout'
    })
  }),
  enterprise: Object.freeze({
    payload: Object.freeze({
      maxJsonPayloadBytes: 262144,
      maxBinaryPayloadBytes: 196608,
      maxHeaders: 24,
      maxHeaderValueBytes: 1024,
      maxHeaderAggregateBytes: 8192
    }),
    stream: Object.freeze({
      maxBatchSize: 500,
      maxInFlight: 120,
      maxSessionSubscriptions: 12,
      heartbeatSeconds: 10,
      maxReplayBatchSize: 500,
      reconnectGraceSeconds: 300,
      maxReconnectAttempts: 10
    }),
    notification: Object.freeze({
      maxQueueDepth: 1024,
      ackMode: 'explicit',
      deliveryMode: 'fanout'
    })
  })
});

const ERROR_CODE_MAP = new Map([
  ['validation_error', { status: 400, code: 'EVT_GATEWAY_VALIDATION_FAILED', retryable: false }],
  ['authorization_error', { status: 403, code: 'EVT_GATEWAY_FORBIDDEN', retryable: false }],
  ['plan_policy_violation', { status: 422, code: 'EVT_GATEWAY_POLICY_VIOLATION', retryable: false }],
  ['backpressure', { status: 429, code: 'EVT_GATEWAY_BACKPRESSURE', retryable: true }],
  ['dependency_failure', { status: 502, code: 'EVT_GATEWAY_DEPENDENCY_FAILURE', retryable: true }],
  ['not_found', { status: 404, code: 'EVT_GATEWAY_NOT_FOUND', retryable: false }],
  ['audit_unavailable', { status: 503, code: 'EVT_GATEWAY_AUDIT_UNAVAILABLE', retryable: true }]
]);

function compactDefined(value) {
  if (Array.isArray(value)) {
    return value
      .filter((entry) => entry !== undefined && entry !== null)
      .map((entry) => (typeof entry === 'object' ? compactDefined(entry) : entry));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined && entry !== null)
      .map(([key, entry]) => [key, typeof entry === 'object' ? compactDefined(entry) : entry])
  );
}

function derivePlanTier(planId = '') {
  const normalized = String(planId).toLowerCase();
  if (normalized.includes('enterprise')) {
    return 'enterprise';
  }
  if (normalized.includes('growth')) {
    return 'growth';
  }
  return 'starter';
}

function getQuotaMetric(resolution, metricKey) {
  return (resolution?.quotaResolution ?? resolution?.quotas ?? []).find((quota) => quota.metricKey === metricKey);
}

function isJsonPayload(value) {
  return value !== undefined;
}

function isBase64(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0) {
    return false;
  }

  return /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

function isJsonContentType(contentType = '') {
  const normalized = String(contentType).toLowerCase();
  return normalized === 'application/json' || normalized === 'application/cloudevents+json' || normalized.endsWith('+json');
}

function normalizeTransport(transport = 'websocket') {
  return EVENT_GATEWAY_TRANSPORTS.includes(transport) ? transport : 'websocket';
}

function normalizeTimestamp(value, fallback) {
  const candidate = value ?? fallback;
  if (!candidate) {
    return undefined;
  }

  const iso = new Date(candidate).toISOString();
  return iso === 'Invalid Date' ? undefined : iso;
}

function normalizePublicationInput(request = {}) {
  const key = request.key ?? request.partitionKey ?? request.orderingKey;
  const requestedPartition = request.partition ?? request.requestedPartition;

  return {
    tenantId: request.tenantId ?? request.tenant_id,
    workspaceId: request.workspaceId ?? request.workspace_id,
    channel: request.channel,
    eventType: request.eventType ?? request.event_type,
    contentType: request.contentType ?? request.content_type,
    payloadEncoding: request.payloadEncoding ?? request.payload_encoding ?? 'json',
    payload: request.payload,
    headers: request.headers ?? {},
    key,
    timestamp: request.timestamp ?? request.eventTimestamp ?? request.event_timestamp,
    requestedPartition,
    notificationQueue: request.notificationQueue ?? request.notification_queue
  };
}

function normalizeSubscriptionInput(request = {}) {
  return {
    topicName: request.topicName ?? request.topic_name,
    channel: request.channel,
    cursorStart: request.cursorStart ?? request.cursor_start ?? 'latest',
    batchSize: request.batchSize ?? request.batch_size ?? 100,
    maxInFlight: request.maxInFlight ?? request.max_in_flight,
    heartbeatSeconds: request.heartbeatSeconds ?? request.heartbeat_seconds,
    filters: request.filters ?? {},
    transport: normalizeTransport(request.transport ?? (request.mode === 'subscribe' ? 'websocket' : request.transport)),
    notificationQueue: request.notificationQueue ?? request.notification_queue,
    replay: request.replay ?? request.replay_policy,
    reconnect: request.reconnect ?? request.reconnect_policy
  };
}

function computePayloadBytes({ payloadEncoding, payload }) {
  if (payloadEncoding === 'base64') {
    if (!isBase64(payload)) {
      return Number.NaN;
    }
    return Buffer.from(payload, 'base64').length;
  }

  if (!isJsonPayload(payload)) {
    return Number.NaN;
  }

  return Buffer.byteLength(JSON.stringify(payload));
}

function normalizeHeaders(headers = {}) {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [String(key), typeof value === 'string' ? value : JSON.stringify(value)])
  );
}

function buildNotificationQueueDescriptor(notificationQueue = {}, profile) {
  const queueType = EVENT_GATEWAY_NOTIFICATION_QUEUE_TYPES.includes(notificationQueue.queueType)
    ? notificationQueue.queueType
    : 'broadcast';
  const ackMode = EVENT_GATEWAY_ACK_MODES.includes(notificationQueue.ackMode)
    ? notificationQueue.ackMode
    : profile.notification.ackMode;
  const deliveryMode = EVENT_GATEWAY_NOTIFICATION_DELIVERY_MODES.includes(notificationQueue.deliveryMode)
    ? notificationQueue.deliveryMode
    : profile.notification.deliveryMode;

  return {
    queue_type: queueType,
    queue_key: notificationQueue.queueKey ?? notificationQueue.queue_key ?? `${queueType}:${profile.workspaceId}`,
    workspace_scoped: true,
    delivery_mode: deliveryMode,
    ack_mode: ackMode,
    max_depth: Math.min(notificationQueue.maxDepth ?? profile.notification.maxQueueDepth, profile.notification.maxQueueDepth)
  };
}

function buildReplayDescriptor(replay = {}, profile, topic = {}) {
  const enabled = (topic.replayWindowHours ?? 0) > 0;
  const mode = EVENT_GATEWAY_REPLAY_MODES.includes(replay.mode) ? replay.mode : 'latest';
  const maxWindowHours = Math.min(topic.replayWindowHours ?? profile.replay.maxWindowHours, profile.replay.maxWindowHours);
  const maxEvents = Math.min(replay.maxEvents ?? profile.stream.maxReplayBatchSize, profile.stream.maxReplayBatchSize);

  return {
    enabled,
    mode,
    cursor: replay.cursor,
    from_timestamp: normalizeTimestamp(replay.fromTimestamp ?? replay.from_timestamp),
    window_hours: replay.windowHours ?? replay.window_hours,
    max_events: maxEvents,
    max_window_hours: maxWindowHours,
    requires_policy_grant: enabled,
    retained: enabled
  };
}

function buildReconnectPolicy(reconnect = {}, profile) {
  return {
    resume_mode: reconnect.resumeMode ?? reconnect.resume_mode ?? 'cursor',
    grace_seconds: Math.min(reconnect.graceSeconds ?? reconnect.grace_seconds ?? profile.stream.reconnectGraceSeconds, profile.stream.reconnectGraceSeconds),
    max_attempts: Math.min(reconnect.maxAttempts ?? reconnect.max_attempts ?? profile.stream.maxReconnectAttempts, profile.stream.maxReconnectAttempts),
    relative_order_scope: EVENT_GATEWAY_RELATIVE_ORDER_SCOPE
  };
}

function headerViolations(headers, profile) {
  const violations = [];
  const normalized = normalizeHeaders(headers);
  const reservedHeaders = new Set([
    'authorization',
    'idempotency-key',
    'x-api-version',
    'x-correlation-id',
    'x-tenant-id',
    'x-workspace-id'
  ]);
  let aggregateBytes = 0;

  if (Object.keys(normalized).length > profile.payload.maxHeaders) {
    violations.push(`headers exceed the max count ${profile.payload.maxHeaders}.`);
  }

  for (const [key, value] of Object.entries(normalized)) {
    if (!/^[A-Za-z0-9-]{1,64}$/.test(key)) {
      violations.push(`header ${key} must match ^[A-Za-z0-9-]{1,64}$.`);
    }

    if (reservedHeaders.has(key.toLowerCase())) {
      violations.push(`header ${key} is reserved for gateway-managed context and cannot be forwarded.`);
    }

    const valueBytes = Buffer.byteLength(value);
    aggregateBytes += Buffer.byteLength(key) + valueBytes;

    if (valueBytes > profile.payload.maxHeaderValueBytes) {
      violations.push(`header ${key} exceeds the max size ${profile.payload.maxHeaderValueBytes} bytes.`);
    }
  }

  if (aggregateBytes > profile.payload.maxHeaderAggregateBytes) {
    violations.push(`headers exceed the aggregate limit ${profile.payload.maxHeaderAggregateBytes} bytes.`);
  }

  return violations;
}

export function resolveEventGatewayProfile(context = {}, topic = {}) {
  const planTier = derivePlanTier(context.planId);
  const defaults = PLAN_DEFAULTS[planTier] ?? PLAN_DEFAULTS.starter;
  const resolution = resolveWorkspaceEffectiveCapabilities({
    tenantId: context.tenantId ?? null,
    workspaceId: context.workspaceId,
    workspaceEnvironment: context.workspaceEnvironment,
    planId: context.planId,
    resolvedAt: context.resolvedAt ?? '2026-03-25T00:00:00Z'
  });
  const publishQuota = getQuotaMetric(resolution, 'workspace.kafka_topics.max');

  return {
    contractVersion: eventGatewayPublishRequestContract?.version ?? '2026-03-24',
    planTier,
    tenantId: context.tenantId,
    workspaceId: context.workspaceId,
    topicRef: context.topicRef ?? topic.resourceId ?? topic.topicRef,
    allowedTransports: topic.allowedTransports ?? EVENT_GATEWAY_TRANSPORTS,
    partitionSelectionPolicy: topic.partitionSelectionPolicy ?? 'provider_managed',
    quotas: {
      maxPublishesPerSecond: topic.maxPublishesPerSecond ?? publishQuota?.maxPublishesPerSecond ?? 0,
      maxConcurrentSubscriptions: topic.maxConcurrentSubscriptions ?? publishQuota?.maxConcurrentSubscriptions ?? 0
    },
    payload: {
      ...defaults.payload,
      supportedEncodings: EVENT_GATEWAY_PAYLOAD_ENCODINGS,
      allowedBinaryContentTypes: EVENT_GATEWAY_BINARY_CONTENT_TYPES,
      allowedJsonContentTypes: EVENT_GATEWAY_JSON_CONTENT_TYPES
    },
    stream: {
      ...defaults.stream,
      maxSessionSubscriptions: Math.min(defaults.stream.maxSessionSubscriptions, topic.maxConcurrentSubscriptions ?? defaults.stream.maxSessionSubscriptions)
    },
    replay: {
      enabled: (topic.replayWindowHours ?? 0) > 0,
      allowedModes: EVENT_GATEWAY_REPLAY_MODES,
      maxWindowHours: topic.replayWindowHours ?? 0,
      requiresPolicyGrant: true
    },
    notification: {
      ...defaults.notification,
      supportedQueueTypes: EVENT_GATEWAY_NOTIFICATION_QUEUE_TYPES,
      supportedDeliveryModes: EVENT_GATEWAY_NOTIFICATION_DELIVERY_MODES,
      supportedAckModes: EVENT_GATEWAY_ACK_MODES
    },
    observability: {
      metricsPath: '/apisix/prometheus/metrics',
      seriesPrefix: 'in_falcone_event_gateway_',
      requiredMetrics: EVENT_GATEWAY_REQUIRED_METRICS,
      relativeOrderScope: EVENT_GATEWAY_RELATIVE_ORDER_SCOPE
    }
  };
}

export function validateEventPublicationRequest({ context = {}, topic = {}, request = {} }) {
  const normalized = normalizePublicationInput(request);
  const profile = resolveEventGatewayProfile(context, topic);
  const violations = [];

  if (!normalized.tenantId) {
    violations.push('tenantId is required.');
  }
  if (!normalized.workspaceId) {
    violations.push('workspaceId is required.');
  }
  if (!normalized.channel) {
    violations.push('channel is required.');
  }
  if (!normalized.eventType) {
    violations.push('eventType is required.');
  }
  if (!profile.allowedTransports.includes('http_publish')) {
    violations.push('topic policy does not allow HTTP publish on this topic.');
  }
  if (!EVENT_GATEWAY_PAYLOAD_ENCODINGS.includes(normalized.payloadEncoding)) {
    violations.push(`payloadEncoding must be one of ${EVENT_GATEWAY_PAYLOAD_ENCODINGS.join(', ')}.`);
  }
  if (!normalized.contentType) {
    violations.push('contentType is required.');
  }

  if (normalized.payloadEncoding === 'json' && !isJsonContentType(normalized.contentType)) {
    violations.push('JSON payloads require a JSON-compatible contentType.');
  }
  if (normalized.payloadEncoding === 'base64' && isJsonContentType(normalized.contentType)) {
    violations.push('Binary payloads must declare a non-JSON contentType.');
  }
  if (normalized.payloadEncoding === 'base64' && !EVENT_GATEWAY_BINARY_CONTENT_TYPES.includes(normalized.contentType)) {
    violations.push(`binary contentType ${normalized.contentType} is not allowed by the gateway policy.`);
  }
  if (normalized.payloadEncoding === 'json' && normalized.payload === undefined) {
    violations.push('payload is required.');
  }
  if (normalized.payloadEncoding === 'base64' && !isBase64(normalized.payload)) {
    violations.push('binary payloads must be base64 encoded.');
  }

  const payloadBytes = computePayloadBytes({ payloadEncoding: normalized.payloadEncoding, payload: normalized.payload });
  if (Number.isNaN(payloadBytes)) {
    violations.push('payload could not be measured against gateway limits.');
  } else {
    const maxBytes = normalized.payloadEncoding === 'base64' ? profile.payload.maxBinaryPayloadBytes : profile.payload.maxJsonPayloadBytes;
    if (payloadBytes > maxBytes) {
      violations.push(`payload exceeds the configured limit ${maxBytes} bytes for ${normalized.payloadEncoding} payloads.`);
    }
  }

  if ((topic.partitionStrategy ?? '').includes('key') && !normalized.key) {
    violations.push(`topic partitionStrategy ${topic.partitionStrategy} requires key.`);
  }

  if (normalized.requestedPartition !== undefined && normalized.requestedPartition !== null) {
    if (!['caller_hint', 'explicit_allowed'].includes(profile.partitionSelectionPolicy)) {
      violations.push(`partition selection policy ${profile.partitionSelectionPolicy} does not allow caller-supplied partition hints.`);
    }
    if (!Number.isInteger(normalized.requestedPartition) || normalized.requestedPartition < 0) {
      violations.push('partition must be a non-negative integer when provided.');
    }
    if (topic.partitionCount && normalized.requestedPartition >= topic.partitionCount) {
      violations.push(`partition ${normalized.requestedPartition} exceeds topic partitionCount ${topic.partitionCount}.`);
    }
  }

  const eventTimestamp = normalizeTimestamp(normalized.timestamp);
  if (normalized.timestamp && !eventTimestamp) {
    violations.push('timestamp must be a valid RFC3339 date-time.');
  }

  violations.push(...headerViolations(normalized.headers, profile));

  return {
    ok: violations.length === 0,
    violations,
    profile,
    payloadBytes: Number.isNaN(payloadBytes) ? undefined : payloadBytes,
    normalized: compactDefined({ ...normalized, eventTimestamp })
  };
}

export function buildEventGatewayPublishRequest({
  requestId,
  correlationId,
  topicRef,
  topic = {},
  request = {},
  context = {},
  idempotencyKey,
  scopes = [],
  effectiveRoles = [],
  authorizationDecisionId,
  requestedAt = '2026-03-25T00:00:00Z',
  eventId = `evt_${String(requestId ?? 'publish').replace(/[^0-9a-z]/gi, '').toLowerCase() || 'publish'}`
}) {
  const validation = validateEventPublicationRequest({ context, topic, request });
  if (!validation.ok) {
    return { ok: false, violations: validation.violations, profile: validation.profile };
  }

  const normalized = validation.normalized;
  const queueDescriptor = normalized.notificationQueue
    ? buildNotificationQueueDescriptor(normalized.notificationQueue, validation.profile)
    : undefined;

  return {
    ok: true,
    request: compactDefined({
      request_id: requestId,
      correlation_id: correlationId,
      tenant_id: normalized.tenantId,
      workspace_id: normalized.workspaceId,
      topic_ref: topicRef ?? context.topicRef ?? topic.resourceId,
      channel: normalized.channel,
      event_id: eventId,
      event_type: normalized.eventType,
      payload: normalized.payload,
      payload_encoding: normalized.payloadEncoding,
      payload_size_bytes: validation.payloadBytes,
      content_type: normalized.contentType,
      headers: normalizeHeaders(normalized.headers),
      key: normalized.key,
      partition_key: normalized.key,
      event_timestamp: normalized.eventTimestamp ?? normalizeTimestamp(requestedAt),
      requested_partition: normalized.requestedPartition,
      partition_selection_policy: validation.profile.partitionSelectionPolicy,
      idempotency_key: idempotencyKey,
      plan_id: context.planId,
      scopes,
      effective_roles: effectiveRoles,
      authorization_decision_id: authorizationDecisionId,
      notification_queue: queueDescriptor,
      publish_policy_snapshot: {
        max_json_payload_bytes: validation.profile.payload.maxJsonPayloadBytes,
        max_binary_payload_bytes: validation.profile.payload.maxBinaryPayloadBytes,
        max_headers: validation.profile.payload.maxHeaders,
        max_publishes_per_second: validation.profile.quotas.maxPublishesPerSecond
      },
      requested_at: normalizeTimestamp(requestedAt)
    }),
    contractVersion: eventGatewayPublishRequestContract?.version ?? '2026-03-24',
    profile: validation.profile
  };
}

export function buildEventGatewayPublishResult({
  requestId,
  correlationId,
  publicationId,
  topicRef,
  channel,
  acceptedAt = '2026-03-25T00:00:00Z',
  deliverySemantics = 'at_least_once',
  auditRecordId,
  status = 'accepted',
  acceptedPartition,
  payloadSizeBytes,
  notificationQueue,
  key
}) {
  return {
    request_id: requestId,
    correlation_id: correlationId,
    publication_id: publicationId,
    topic_ref: topicRef,
    channel,
    accepted_at: normalizeTimestamp(acceptedAt),
    delivery_semantics: deliverySemantics,
    audit_record_id: auditRecordId,
    status,
    accepted_partition: acceptedPartition,
    payload_size_bytes: payloadSizeBytes,
    notification_queue: notificationQueue,
    key,
    contract_version: eventGatewayPublishResultContract?.version ?? '2026-03-24'
  };
}

export function validateEventSubscriptionRequest({ context = {}, topic = {}, request = {} }) {
  const normalized = normalizeSubscriptionInput(request);
  const profile = resolveEventGatewayProfile(context, topic);
  const violations = [];

  if (!normalized.topicName && !context.topicRef && !topic.resourceId) {
    violations.push('topicName or topicRef is required.');
  }
  if (!normalized.channel) {
    violations.push('channel is required.');
  }
  if (!EVENT_GATEWAY_REPLAY_MODES.includes(normalized.cursorStart)) {
    violations.push(`cursorStart must be one of ${EVENT_GATEWAY_REPLAY_MODES.join(', ')}.`);
  }
  if (!Number.isInteger(normalized.batchSize) || normalized.batchSize < 1) {
    violations.push('batchSize must be a positive integer.');
  }
  if (normalized.batchSize > profile.stream.maxBatchSize) {
    violations.push(`batchSize ${normalized.batchSize} exceeds the workspace limit ${profile.stream.maxBatchSize}.`);
  }
  if (!profile.allowedTransports.includes(normalized.transport)) {
    violations.push(`transport ${normalized.transport} is not enabled for this topic.`);
  }

  const maxInFlight = normalized.maxInFlight ?? profile.stream.maxInFlight;
  if (!Number.isInteger(maxInFlight) || maxInFlight < 1 || maxInFlight > profile.stream.maxInFlight) {
    violations.push(`maxInFlight must be between 1 and ${profile.stream.maxInFlight}.`);
  }

  const heartbeatSeconds = normalized.heartbeatSeconds ?? profile.stream.heartbeatSeconds;
  if (!Number.isInteger(heartbeatSeconds) || heartbeatSeconds < 5 || heartbeatSeconds > 60) {
    violations.push('heartbeatSeconds must be between 5 and 60.');
  }

  const queueDescriptor = normalized.notificationQueue
    ? buildNotificationQueueDescriptor(normalized.notificationQueue, profile)
    : undefined;

  if (queueDescriptor && !profile.notification.supportedQueueTypes.includes(queueDescriptor.queue_type)) {
    violations.push(`queueType ${queueDescriptor.queue_type} is not supported.`);
  }

  const replayDescriptor = buildReplayDescriptor(normalized.replay, profile, topic);
  if (normalized.replay?.mode && !profile.replay.enabled && normalized.replay.mode !== 'latest') {
    violations.push('topic replay policy does not allow replay for this topic.');
  }
  if (normalized.replay?.windowHours && normalized.replay.windowHours > replayDescriptor.max_window_hours) {
    violations.push(`replay window ${normalized.replay.windowHours}h exceeds the topic allowance ${replayDescriptor.max_window_hours}h.`);
  }
  if (normalized.replay?.maxEvents && normalized.replay.maxEvents > profile.stream.maxReplayBatchSize) {
    violations.push(`replay maxEvents ${normalized.replay.maxEvents} exceeds the limit ${profile.stream.maxReplayBatchSize}.`);
  }
  if (normalized.replay?.fromTimestamp && !normalizeTimestamp(normalized.replay.fromTimestamp)) {
    violations.push('replay.fromTimestamp must be a valid RFC3339 date-time.');
  }

  return {
    ok: violations.length === 0,
    violations,
    profile,
    normalized: compactDefined({
      ...normalized,
      maxInFlight,
      heartbeatSeconds,
      notificationQueue: queueDescriptor,
      replay: replayDescriptor,
      reconnect: buildReconnectPolicy(normalized.reconnect, profile)
    })
  };
}

export function buildEventGatewaySubscriptionRequest({
  requestId,
  correlationId,
  sessionId,
  subscriptionId,
  topicRef,
  topic = {},
  request = {},
  context = {},
  scopes = [],
  effectiveRoles = [],
  authorizationDecisionId,
  requestedAt = '2026-03-25T00:00:00Z'
}) {
  const validation = validateEventSubscriptionRequest({ context, topic, request });
  if (!validation.ok) {
    return { ok: false, violations: validation.violations, profile: validation.profile };
  }

  return {
    ok: true,
    request: compactDefined({
      request_id: requestId,
      correlation_id: correlationId,
      session_id: sessionId,
      subscription_id: subscriptionId,
      tenant_id: context.tenantId,
      workspace_id: context.workspaceId,
      topic_ref: topicRef ?? context.topicRef ?? topic.resourceId,
      channel: validation.normalized.channel,
      transport: validation.normalized.transport,
      cursor: validation.normalized.cursorStart,
      batch_size: validation.normalized.batchSize,
      max_in_flight: validation.normalized.maxInFlight,
      heartbeat_seconds: validation.normalized.heartbeatSeconds,
      filters: validation.normalized.filters,
      queue_binding: validation.normalized.notificationQueue,
      replay_policy: validation.normalized.replay,
      reconnect_policy: validation.normalized.reconnect,
      plan_id: context.planId,
      scopes,
      effective_roles: effectiveRoles,
      authorization_decision_id: authorizationDecisionId,
      requested_at: normalizeTimestamp(requestedAt)
    }),
    contractVersion: eventGatewaySubscriptionRequestContract?.version ?? '2026-03-24',
    profile: validation.profile
  };
}

export function buildEventGatewaySubscriptionStatus({
  requestId,
  correlationId,
  subscriptionId,
  sessionId,
  topicRef,
  transport,
  status = 'active',
  lagSnapshot,
  expiresAt,
  queueStatus,
  replayStatus,
  reconnectToken,
  relativeOrderScope = EVENT_GATEWAY_RELATIVE_ORDER_SCOPE
}) {
  return compactDefined({
    request_id: requestId,
    correlation_id: correlationId,
    subscription_id: subscriptionId,
    session_id: sessionId,
    topic_ref: topicRef,
    transport,
    status,
    lag_snapshot: lagSnapshot,
    expires_at: normalizeTimestamp(expiresAt),
    queue_status: queueStatus,
    replay_status: replayStatus,
    reconnect_token: reconnectToken,
    relative_order_scope: relativeOrderScope,
    contract_version: eventGatewaySubscriptionStatusContract?.version ?? '2026-03-24'
  });
}

export function buildEventDeliveryEnvelope({
  eventId,
  eventType,
  topicName,
  topicResourceId,
  channel,
  partition,
  offset,
  sequence,
  publishedAt,
  contentType,
  payloadEncoding = 'json',
  correlationId,
  payload,
  key,
  headers = {},
  lagMs,
  notificationQueue,
  replay,
  delivery
}) {
  return compactDefined({
    eventId,
    eventType,
    topicName,
    topicResourceId,
    channel,
    key,
    partition,
    offset,
    sequence,
    publishedAt: normalizeTimestamp(publishedAt),
    contentType,
    payloadEncoding,
    headers: normalizeHeaders(headers),
    correlationId,
    lagMs,
    payload,
    queue: notificationQueue
      ? {
          queueType: notificationQueue.queue_type,
          queueKey: notificationQueue.queue_key,
          workspaceScoped: notificationQueue.workspace_scoped,
          deliveryMode: notificationQueue.delivery_mode,
          ackMode: notificationQueue.ack_mode,
          maxDepth: notificationQueue.max_depth
        }
      : undefined,
    replay: replay
      ? {
          mode: replay.mode,
          cursor: replay.cursor,
          fromTimestamp: replay.from_timestamp,
          windowHours: replay.window_hours,
          retained: replay.retained
        }
      : undefined,
    delivery: delivery
      ? {
          transport: delivery.transport,
          attempt: delivery.attempt,
          relativeOrderScope: delivery.relativeOrderScope ?? EVENT_GATEWAY_RELATIVE_ORDER_SCOPE,
          resumed: delivery.resumed === true
        }
      : undefined
  });
}

export function buildReconnectResumePlan({
  disconnectedAt,
  reconnectAt,
  profile,
  lastEventId,
  lastSequence,
  replay = {},
  retainedEvents = 0
}) {
  const normalizedProfile = profile ?? resolveEventGatewayProfile();
  const graceSeconds = normalizedProfile.stream.reconnectGraceSeconds;
  const disconnectedMs = new Date(disconnectedAt).getTime();
  const reconnectMs = new Date(reconnectAt).getTime();
  const gapSeconds = Number.isFinite(disconnectedMs) && Number.isFinite(reconnectMs)
    ? Math.max(Math.round((reconnectMs - disconnectedMs) / 1000), 0)
    : undefined;
  const canResume = typeof gapSeconds === 'number' ? gapSeconds <= graceSeconds : false;
  const replayDescriptor = buildReplayDescriptor(replay, normalizedProfile, { replayWindowHours: normalizedProfile.replay.maxWindowHours });

  return {
    canResume,
    gapSeconds,
    graceSeconds,
    resumeMode: canResume ? 'cursor' : replayDescriptor.mode,
    replayMode: canResume ? 'latest' : replayDescriptor.mode,
    lastEventId,
    lastSequence,
    retainedEvents,
    relativeOrderScope: normalizedProfile.observability.relativeOrderScope,
    reconnectTokenRequired: canResume
  };
}

export function summarizeRelativeOrdering(deliveries = []) {
  const groups = new Map();
  const violations = [];

  for (const delivery of deliveries) {
    const partition = delivery.partition ?? 'unknown';
    const key = delivery.key ?? delivery.partitionKey ?? delivery.relativeOrderKey ?? 'unkeyed';
    const groupKey = `${partition}:${key}`;
    const sequence = delivery.sequence;

    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    groups.get(groupKey).push({ eventId: delivery.eventId, sequence });
  }

  for (const [groupKey, groupDeliveries] of groups.entries()) {
    const sorted = [...groupDeliveries].sort((left, right) => left.sequence - right.sequence);
    for (let index = 1; index < groupDeliveries.length; index += 1) {
      const previous = groupDeliveries[index - 1];
      const current = groupDeliveries[index];
      if (current.sequence <= previous.sequence) {
        violations.push({ groupKey, expectedGreaterThan: previous.sequence, actual: current.sequence, eventId: current.eventId });
      }
    }
    const sequenceSpan = sorted.length > 0 ? { min: sorted[0].sequence, max: sorted[sorted.length - 1].sequence } : null;
    groups.set(groupKey, { deliveries: groupDeliveries, sequenceSpan });
  }

  return {
    scope: EVENT_GATEWAY_RELATIVE_ORDER_SCOPE,
    checkedGroups: groups.size,
    violations,
    ok: violations.length === 0
  };
}

export function normalizeEventGatewayError(error = {}, context = {}) {
  const normalizedClass = error.errorClass ?? error.error_class ?? 'dependency_failure';
  const mapped = ERROR_CODE_MAP.get(normalizedClass) ?? ERROR_CODE_MAP.get('dependency_failure');

  return {
    status: error.status ?? mapped.status,
    code: mapped.code,
    retryable: mapped.retryable,
    message: error.message ?? 'Event gateway request failed.',
    targetRef: context.targetRef,
    requestId: context.requestId,
    correlationId: context.correlationId,
    contractVersion:
      eventGatewayPublishRequestContract?.version ?? eventGatewaySubscriptionRequestContract?.version ?? '2026-03-24'
  };
}
