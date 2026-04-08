import { getContract } from '../../internal-contracts/src/index.mjs';
import { resolveEventGatewayProfile } from './runtime.mjs';

const eventBridgeRequestContract = getContract('event_bridge_request');
const eventBridgeStatusContract = getContract('event_bridge_status');
const kafkaFunctionTriggerRequestContract = getContract('kafka_function_trigger_request');
const kafkaFunctionTriggerResultContract = getContract('kafka_function_trigger_result');

export const EVENT_BRIDGE_SOURCE_TYPES = Object.freeze(['postgresql', 'mongodb', 'storage', 'openwhisk', 'iam']);
export const EVENT_BRIDGE_DELIVERY_MODES = Object.freeze(['at_least_once']);
export const EVENT_BRIDGE_PAYLOAD_MODES = Object.freeze(['provider_normalized_json', 'cloudevents_json']);
export const EVENT_BRIDGE_STATUS_VALUES = Object.freeze(['planned', 'active', 'degraded', 'paused']);
export const EVENT_BRIDGE_AUDIT_MODES = Object.freeze(['metadata_only', 'headers_and_denials']);
export const EVENT_BRIDGE_REQUIRED_TRACE_FIELDS = Object.freeze([
  'tenant_id',
  'workspace_id',
  'correlation_id',
  'authorization_decision_id',
  'audit_record_id',
  'source_event_id',
  'bridge_id',
  'topic_ref'
]);
export const EVENT_BRIDGE_SOURCE_EVENT_TYPES = Object.freeze({
  postgresql: Object.freeze(['row_inserted', 'row_updated', 'row_deleted']),
  mongodb: Object.freeze(['document_inserted', 'document_updated', 'document_deleted', 'change_stream']),
  storage: Object.freeze(['object_created', 'object_deleted', 'object_restored']),
  openwhisk: Object.freeze(['activation_succeeded', 'activation_failed', 'activation_timed_out']),
  iam: Object.freeze(['user_created', 'user_updated', 'membership_changed', 'credential_rotated'])
});
export const KAFKA_FUNCTION_TRIGGER_DELIVERY_MODES = Object.freeze(['per_event', 'micro_batch']);
export const KAFKA_FUNCTION_TRIGGER_FAILURE_POLICIES = Object.freeze(['retry_then_dead_letter', 'dead_letter_only']);
export const KAFKA_FUNCTION_TRIGGER_STATUS_VALUES = Object.freeze(['planned', 'active', 'degraded', 'paused']);
export const KAFKA_TOPIC_METADATA_FIELDS = Object.freeze(['partitions', 'consumer_lag', 'retention', 'compaction']);
export const EVENT_DASHBOARD_WIDGET_TYPES = Object.freeze([
  'topic_throughput',
  'consumer_lag',
  'bridge_health',
  'function_trigger_health',
  'admin_audit_volume'
]);

const EVENT_BRIDGE_PLAN_LIMITS = Object.freeze({
  starter: Object.freeze({ maxBridgeCount: 4, maxBatchSize: 25, maxSourceFilters: 4, maxTargetLagAlertMessages: 500 }),
  growth: Object.freeze({ maxBridgeCount: 20, maxBatchSize: 100, maxSourceFilters: 8, maxTargetLagAlertMessages: 2000 }),
  enterprise: Object.freeze({ maxBridgeCount: 100, maxBatchSize: 500, maxSourceFilters: 16, maxTargetLagAlertMessages: 10000 })
});

const KAFKA_TRIGGER_PLAN_LIMITS = Object.freeze({
  starter: Object.freeze({ maxTriggersPerAction: 1, maxBatchSize: 10, maxParallelInvocations: 2 }),
  growth: Object.freeze({ maxTriggersPerAction: 8, maxBatchSize: 100, maxParallelInvocations: 10 }),
  enterprise: Object.freeze({ maxTriggersPerAction: 32, maxBatchSize: 500, maxParallelInvocations: 50 })
});

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

function slugify(input, prefix = 'item') {
  const normalized = String(input ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || prefix;
}

function normalizeTimestamp(value) {
  if (!value) {
    return undefined;
  }

  const iso = new Date(value).toISOString();
  return iso === 'Invalid Date' ? undefined : iso;
}

function normalizeSourceType(sourceType) {
  return EVENT_BRIDGE_SOURCE_TYPES.includes(sourceType) ? sourceType : undefined;
}

function normalizeTopicRef(topicRef, context = {}, topic = {}) {
  return topicRef ?? context.topicRef ?? topic.resourceId ?? topic.topicRef;
}

function uniqueStrings(values = []) {
  return Array.from(new Set(values.map((value) => String(value)).filter(Boolean)));
}

function resolvePlanLimits(collection, planTier) {
  return collection[planTier] ?? collection.starter;
}

export function resolveEventBridgeProfile(context = {}, topic = {}) {
  const runtime = resolveEventGatewayProfile(context, topic);
  const limits = resolvePlanLimits(EVENT_BRIDGE_PLAN_LIMITS, runtime.planTier);

  return {
    contractVersion: eventBridgeRequestContract?.version ?? runtime.contractVersion,
    planTier: runtime.planTier,
    tenantId: context.tenantId,
    workspaceId: context.workspaceId,
    topicRef: normalizeTopicRef(topic.resourceId, context, topic),
    sourceTypes: EVENT_BRIDGE_SOURCE_TYPES,
    deliveryModes: EVENT_BRIDGE_DELIVERY_MODES,
    payloadModes: EVENT_BRIDGE_PAYLOAD_MODES,
    auditModes: EVENT_BRIDGE_AUDIT_MODES,
    limits,
    observability: {
      metricsPath: '/v1/metrics/workspaces/{workspaceId}/kafka-topics',
      dashboardPath: '/v1/metrics/workspaces/{workspaceId}/event-dashboards',
      metadataPath: '/v1/events/topics/{resourceId}/metadata',
      supportedTopicMetadata: KAFKA_TOPIC_METADATA_FIELDS,
      widgetTypes: EVENT_DASHBOARD_WIDGET_TYPES
    },
    runtime
  };
}

export function validateEventBridgeDefinition({ context = {}, topic = {}, bridge = {} }) {
  const profile = resolveEventBridgeProfile(context, topic);
  const sourceType = normalizeSourceType(bridge.sourceType ?? bridge.source?.type);
  const sourceRef = bridge.sourceRef ?? bridge.source?.resourceRef;
  const topicRef = normalizeTopicRef(bridge.topicRef, context, topic);
  const sourceEventTypes = uniqueStrings(bridge.sourceEventTypes ?? bridge.source?.eventTypes ?? []);
  const sourceWorkspaceId = bridge.sourceWorkspaceId ?? bridge.source?.workspaceId ?? context.workspaceId;
  const sourceTenantId = bridge.sourceTenantId ?? bridge.source?.tenantId ?? context.tenantId;
  const batchSize = bridge.batchSize ?? bridge.delivery?.batchSize ?? 1;
  const payloadMode = bridge.payloadMode ?? bridge.delivery?.payloadMode ?? 'provider_normalized_json';
  const deliveryMode = bridge.deliveryMode ?? bridge.delivery?.mode ?? 'at_least_once';
  const auditMode = bridge.auditMode ?? bridge.audit?.mode ?? 'metadata_only';
  const sourceFilters = bridge.sourceFilters ?? bridge.source?.filters ?? [];
  const violations = [];

  if (!context.tenantId) {
    violations.push('tenantId is required.');
  }
  if (!context.workspaceId) {
    violations.push('workspaceId is required.');
  }
  if (!sourceType) {
    violations.push(`sourceType must be one of ${EVENT_BRIDGE_SOURCE_TYPES.join(', ')}.`);
  }
  if (!sourceRef) {
    violations.push('sourceRef is required.');
  }
  if (!topicRef) {
    violations.push('topicRef is required.');
  }
  if (sourceWorkspaceId !== context.workspaceId) {
    violations.push('sourceWorkspaceId must match the owning workspace to preserve tenant isolation.');
  }
  if (sourceTenantId !== context.tenantId) {
    violations.push('sourceTenantId must match the owning tenant to preserve tenant isolation.');
  }
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    violations.push('batchSize must be a positive integer.');
  }
  if (batchSize > profile.limits.maxBatchSize) {
    violations.push(`batchSize ${batchSize} exceeds the workspace bridge limit ${profile.limits.maxBatchSize}.`);
  }
  if (!EVENT_BRIDGE_PAYLOAD_MODES.includes(payloadMode)) {
    violations.push(`payloadMode must be one of ${EVENT_BRIDGE_PAYLOAD_MODES.join(', ')}.`);
  }
  if (!EVENT_BRIDGE_DELIVERY_MODES.includes(deliveryMode)) {
    violations.push(`deliveryMode must be one of ${EVENT_BRIDGE_DELIVERY_MODES.join(', ')}.`);
  }
  if (!EVENT_BRIDGE_AUDIT_MODES.includes(auditMode)) {
    violations.push(`auditMode must be one of ${EVENT_BRIDGE_AUDIT_MODES.join(', ')}.`);
  }
  if (!Array.isArray(sourceFilters)) {
    violations.push('sourceFilters must be an array.');
  }
  if (Array.isArray(sourceFilters) && sourceFilters.length > profile.limits.maxSourceFilters) {
    violations.push(`sourceFilters exceed the workspace bridge limit ${profile.limits.maxSourceFilters}.`);
  }

  if (sourceType) {
    const allowedEventTypes = EVENT_BRIDGE_SOURCE_EVENT_TYPES[sourceType] ?? [];
    for (const eventType of sourceEventTypes) {
      if (!allowedEventTypes.includes(eventType)) {
        violations.push(`sourceEventType ${eventType} is not supported for ${sourceType}.`);
      }
    }
  }

  if (bridge.partitionKeyTemplate && !/^([a-zA-Z0-9_./-]+|\{[a-zA-Z0-9_.-]+\})+$/.test(bridge.partitionKeyTemplate)) {
    violations.push('partitionKeyTemplate must use stable field placeholders or safe separators only.');
  }

  return {
    ok: violations.length === 0,
    violations,
    profile,
    normalized: compactDefined({
      bridgeId: bridge.bridgeId ?? bridge.id ?? `evb_${slugify(sourceType, 'bridge')}_${slugify(topicRef, 'topic')}`,
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      topicRef,
      source: {
        type: sourceType,
        tenantId: sourceTenantId,
        workspaceId: sourceWorkspaceId,
        resourceRef: sourceRef,
        eventTypes: sourceEventTypes,
        filters: sourceFilters
      },
      delivery: {
        mode: deliveryMode,
        payloadMode,
        batchSize,
        partitionKeyTemplate: bridge.partitionKeyTemplate,
        maxLagAlertMessages: Math.min(
          bridge.maxLagAlertMessages ?? profile.limits.maxTargetLagAlertMessages,
          profile.limits.maxTargetLagAlertMessages
        )
      },
      audit: {
        mode: auditMode,
        traceFields: EVENT_BRIDGE_REQUIRED_TRACE_FIELDS
      },
      status: bridge.status ?? 'planned',
      createdAt: normalizeTimestamp(bridge.createdAt),
      updatedAt: normalizeTimestamp(bridge.updatedAt)
    })
  };
}

export function buildEventBridgeDefinition({ context = {}, topic = {}, bridge = {} }) {
  const validation = validateEventBridgeDefinition({ context, topic, bridge });
  if (!validation.ok) {
    return { ok: false, violations: validation.violations, profile: validation.profile };
  }

  return {
    ok: true,
    bridge: {
      bridge_id: validation.normalized.bridgeId,
      tenant_id: validation.normalized.tenantId,
      workspace_id: validation.normalized.workspaceId,
      topic_ref: validation.normalized.topicRef,
      source: validation.normalized.source,
      delivery: validation.normalized.delivery,
      audit: validation.normalized.audit,
      status: validation.normalized.status,
      contract_version: eventBridgeStatusContract?.version ?? validation.profile.contractVersion,
      observed_at: validation.normalized.updatedAt ?? validation.normalized.createdAt ?? '2026-03-26T00:00:00Z'
    },
    contractVersion: eventBridgeStatusContract?.version ?? validation.profile.contractVersion,
    profile: validation.profile
  };
}

export function resolveKafkaFunctionTriggerProfile(context = {}, topic = {}) {
  const runtime = resolveEventGatewayProfile(context, topic);
  const limits = resolvePlanLimits(KAFKA_TRIGGER_PLAN_LIMITS, runtime.planTier);

  return {
    contractVersion: kafkaFunctionTriggerRequestContract?.version ?? runtime.contractVersion,
    planTier: runtime.planTier,
    deliveryModes: KAFKA_FUNCTION_TRIGGER_DELIVERY_MODES,
    failurePolicies: KAFKA_FUNCTION_TRIGGER_FAILURE_POLICIES,
    statusValues: KAFKA_FUNCTION_TRIGGER_STATUS_VALUES,
    limits,
    runtime
  };
}

export function validateKafkaFunctionTrigger({ context = {}, topic = {}, action = {}, trigger = {} }) {
  const profile = resolveKafkaFunctionTriggerProfile(context, topic);
  const topicRef = normalizeTopicRef(trigger.topicRef, context, topic);
  const deliveryMode = trigger.deliveryMode ?? 'per_event';
  const batchSize = trigger.batchSize ?? (deliveryMode === 'micro_batch' ? 10 : 1);
  const maxParallelInvocations = trigger.maxParallelInvocations ?? 1;
  const failurePolicy = trigger.failurePolicy ?? 'retry_then_dead_letter';
  const violations = [];

  if (!action.resourceId && !action.actionId) {
    violations.push('action.resourceId is required.');
  }
  if (!topicRef) {
    violations.push('topicRef is required.');
  }
  if (!KAFKA_FUNCTION_TRIGGER_DELIVERY_MODES.includes(deliveryMode)) {
    violations.push(`deliveryMode must be one of ${KAFKA_FUNCTION_TRIGGER_DELIVERY_MODES.join(', ')}.`);
  }
  if (!KAFKA_FUNCTION_TRIGGER_FAILURE_POLICIES.includes(failurePolicy)) {
    violations.push(`failurePolicy must be one of ${KAFKA_FUNCTION_TRIGGER_FAILURE_POLICIES.join(', ')}.`);
  }
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    violations.push('batchSize must be a positive integer.');
  }
  if (batchSize > profile.limits.maxBatchSize) {
    violations.push(`batchSize ${batchSize} exceeds the function-trigger limit ${profile.limits.maxBatchSize}.`);
  }
  if (!Number.isInteger(maxParallelInvocations) || maxParallelInvocations < 1) {
    violations.push('maxParallelInvocations must be a positive integer.');
  }
  if (maxParallelInvocations > profile.limits.maxParallelInvocations) {
    violations.push(
      `maxParallelInvocations ${maxParallelInvocations} exceeds the function-trigger limit ${profile.limits.maxParallelInvocations}.`
    );
  }
  if (trigger.deadLetterTopicRef && trigger.deadLetterTopicRef === topicRef && failurePolicy !== 'dead_letter_only') {
    violations.push('deadLetterTopicRef must differ from topicRef when retries are enabled.');
  }

  return {
    ok: violations.length === 0,
    violations,
    profile,
    normalized: compactDefined({
      triggerId: trigger.triggerId ?? trigger.id ?? `ktr_${slugify(action.resourceId ?? action.actionId, 'action')}_${slugify(topicRef, 'topic')}`,
      actionRef: action.resourceId ?? action.actionId,
      topicRef,
      deliveryMode,
      batchSize,
      maxParallelInvocations,
      failurePolicy,
      deadLetterTopicRef: trigger.deadLetterTopicRef,
      filterExpression: trigger.filterExpression,
      status: trigger.status ?? 'planned',
      createdAt: normalizeTimestamp(trigger.createdAt),
      updatedAt: normalizeTimestamp(trigger.updatedAt),
      audit: {
        mode: trigger.auditMode ?? 'metadata_only',
        traceFields: EVENT_BRIDGE_REQUIRED_TRACE_FIELDS
      }
    })
  };
}

export function buildKafkaFunctionTrigger({ context = {}, topic = {}, action = {}, trigger = {} }) {
  const validation = validateKafkaFunctionTrigger({ context, topic, action, trigger });
  if (!validation.ok) {
    return { ok: false, violations: validation.violations, profile: validation.profile };
  }

  return {
    ok: true,
    trigger: {
      trigger_id: validation.normalized.triggerId,
      action_ref: validation.normalized.actionRef,
      topic_ref: validation.normalized.topicRef,
      delivery_mode: validation.normalized.deliveryMode,
      batch_size: validation.normalized.batchSize,
      max_parallel_invocations: validation.normalized.maxParallelInvocations,
      failure_policy: validation.normalized.failurePolicy,
      dead_letter_topic_ref: validation.normalized.deadLetterTopicRef,
      filter_expression: validation.normalized.filterExpression,
      audit: validation.normalized.audit,
      status: validation.normalized.status,
      contract_version: kafkaFunctionTriggerResultContract?.version ?? validation.profile.contractVersion,
      observed_at: validation.normalized.updatedAt ?? validation.normalized.createdAt ?? '2026-03-26T00:00:00Z'
    },
    contractVersion: kafkaFunctionTriggerResultContract?.version ?? validation.profile.contractVersion,
    profile: validation.profile
  };
}

export function buildTopicMetadataExposure({ topic = {}, lag = {}, visibility = {} }) {
  const metadataVisibility = {
    partitions: visibility.partitions !== false,
    consumerLag: visibility.consumerLag !== false,
    retention: visibility.retention !== false,
    compaction: visibility.compaction !== false
  };

  return compactDefined({
    topicRef: topic.resourceId ?? topic.topicRef,
    topicName: topic.topicName,
    physicalTopicName: topic.physicalTopicName,
    partitionCount: topic.partitionCount,
    cleanupPolicy: topic.cleanupPolicy,
    partitionMetadata: metadataVisibility.partitions
      ? {
          available: true,
          partitionCount: topic.partitionCount,
          partitionKeysExposed: true
        }
      : {
          available: false,
          reason: 'provider_or_policy_unavailable'
        },
    lag: metadataVisibility.consumerLag
      ? {
          available: true,
          maxMessagesBehind: lag.maxMessagesBehind ?? 0,
          p95Ms: lag.p95Ms ?? 0,
          observedAt: normalizeTimestamp(lag.observedAt) ?? '2026-03-26T00:00:00Z'
        }
      : {
          available: false,
          reason: 'consumer_group_visibility_restricted'
        },
    retention: metadataVisibility.retention
      ? {
          available: true,
          hours: topic.retentionHours,
          replayWindowHours: topic.replayWindowHours,
          retentionMs: topic.retentionHours ? topic.retentionHours * 60 * 60 * 1000 : undefined
        }
      : {
          available: false,
          reason: 'provider_config_visibility_restricted'
        },
    compaction: metadataVisibility.compaction
      ? {
          available: true,
          enabled: String(topic.cleanupPolicy ?? '').includes('compact'),
          cleanupPolicy: topic.cleanupPolicy
        }
      : {
          available: false,
          reason: 'provider_config_visibility_restricted'
        }
  });
}

export function buildWorkspaceEventDashboard({ workspaceId, topicMetrics = [], bridgeStatuses = [], triggerStatuses = [], auditSeries = [] }) {
  return {
    workspaceId,
    widgetTypes: EVENT_DASHBOARD_WIDGET_TYPES,
    widgets: [
      {
        type: 'topic_throughput',
        title: 'Kafka topic throughput',
        query: `sum(rate(in_falcone_event_gateway_publish_total{workspace_id="${workspaceId}"}[5m])) by (topic_ref)`,
        seriesCount: topicMetrics.length
      },
      {
        type: 'consumer_lag',
        title: 'Consumer lag',
        query: `max(in_falcone_kafka_consumer_lag_messages{workspace_id="${workspaceId}"}) by (topic_ref, consumer_group)`,
        seriesCount: topicMetrics.length
      },
      {
        type: 'bridge_health',
        title: 'Bridge health',
        query: `max(in_falcone_event_bridge_delivery_lag_messages{workspace_id="${workspaceId}"}) by (bridge_id, source_type)`,
        seriesCount: bridgeStatuses.length
      },
      {
        type: 'function_trigger_health',
        title: 'Kafka-triggered functions',
        query: `sum(rate(in_falcone_openwhisk_kafka_trigger_invocations_total{workspace_id="${workspaceId}"}[5m])) by (action_ref, trigger_id)`,
        seriesCount: triggerStatuses.length
      },
      {
        type: 'admin_audit_volume',
        title: 'Kafka admin audit volume',
        query: `sum(rate(in_falcone_audit_records_total{workspace_id="${workspaceId}", resource_family="events"}[5m])) by (operation)`,
        seriesCount: auditSeries.length
      }
    ],
    coverage: {
      topicMetrics: topicMetrics.length,
      bridges: bridgeStatuses.length,
      functionTriggers: triggerStatuses.length,
      auditSeries: auditSeries.length
    }
  };
}

export function buildKafkaAdminAuditRecord({
  actorId,
  actorType = 'user',
  operation,
  targetRef,
  tenantId,
  workspaceId,
  correlationId,
  authorizationDecisionId,
  auditRecordId,
  bridgeId,
  triggerId,
  observedAt = '2026-03-26T00:00:00Z'
}) {
  return compactDefined({
    audit_record_id: auditRecordId,
    actor_id: actorId,
    actor_type: actorType,
    operation,
    resource_family: 'events',
    target_ref: targetRef,
    tenant_id: tenantId,
    workspace_id: workspaceId,
    correlation_id: correlationId,
    authorization_decision_id: authorizationDecisionId,
    bridge_id: bridgeId,
    trigger_id: triggerId,
    evidence_pointer: `audit://events/${workspaceId}/${slugify(operation, 'operation')}/${slugify(targetRef, 'target')}`,
    observed_at: normalizeTimestamp(observedAt),
    write_mode: 'append_only'
  });
}
