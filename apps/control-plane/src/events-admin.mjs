import {
  filterPublicRoutes,
  getApiFamily,
  getContract,
  getPublicRoute
} from '../../../services/internal-contracts/src/index.mjs';
import {
  KAFKA_ADMIN_CAPABILITY_MATRIX,
  KAFKA_ADMIN_RESOURCE_KINDS,
  SUPPORTED_KAFKA_VERSION_RANGES,
  isKafkaVersionSupported,
  resolveKafkaAdminProfile
} from '../../../services/adapters/src/kafka-admin.mjs';
import {
  buildTopicMetadataExposure,
  buildWorkspaceEventDashboard,
  EVENT_BRIDGE_SOURCE_TYPES,
  EVENT_DASHBOARD_WIDGET_TYPES,
  KAFKA_FUNCTION_TRIGGER_DELIVERY_MODES,
  KAFKA_TOPIC_METADATA_FIELDS,
  resolveEventBridgeProfile
} from '../../../services/event-gateway/src/kafka-integrations.mjs';
import {
  EVENT_GATEWAY_NOTIFICATION_QUEUE_TYPES,
  EVENT_GATEWAY_PAYLOAD_ENCODINGS,
  EVENT_GATEWAY_RELATIVE_ORDER_SCOPE,
  EVENT_GATEWAY_REPLAY_MODES,
  EVENT_GATEWAY_REQUIRED_METRICS,
  EVENT_GATEWAY_TRANSPORTS,
  resolveEventGatewayProfile
} from '../../../services/event-gateway/src/runtime.mjs';

export const eventsApiFamily = getApiFamily('events');
export const kafkaAdminRequestContract = getContract('kafka_admin_request');
export const kafkaAdminResultContract = getContract('kafka_admin_result');
export const kafkaInventorySnapshotContract = getContract('kafka_inventory_snapshot');
export const kafkaAdminEventContract = getContract('kafka_admin_event');
export const eventsAdminRoutes = filterPublicRoutes({ family: 'events' });

export const KAFKA_ADMIN_AUDIT_CONTEXT_FIELDS = Object.freeze([
  'actor_id',
  'actor_type',
  'origin_surface',
  'correlation_id',
  'authorization_decision_id',
  'target_tenant_id',
  'target_workspace_id'
]);

export function listEventsAdminRoutes(filters = {}) {
  return filterPublicRoutes({ family: 'events', ...filters });
}

export function getEventsAdminRoute(operationId) {
  const route = getPublicRoute(operationId);
  return route?.family === 'events' ? route : undefined;
}

export function summarizeEventsAdminSurface() {
  return KAFKA_ADMIN_RESOURCE_KINDS.map((resourceKind) => ({
    resourceKind,
    actions: KAFKA_ADMIN_CAPABILITY_MATRIX[resourceKind] ?? [],
    routeCount: eventsAdminRoutes.filter((route) => route.resourceType === (resourceKind === 'topic_acl' ? 'topic_acl' : 'topic')).length
  })).concat([
    {
      resourceKind: 'inventory',
      actions: ['get'],
      routeCount: eventsAdminRoutes.filter((route) => route.resourceType === 'event_inventory').length
    },
    {
      resourceKind: 'event_bridge',
      actions: ['create', 'get'],
      routeCount: eventsAdminRoutes.filter((route) => route.resourceType === 'event_bridge').length
    },
    {
      resourceKind: 'topic_metadata',
      actions: ['get'],
      routeCount: eventsAdminRoutes.filter((route) => route.resourceType === 'topic_metadata').length
    },
    {
      resourceKind: 'runtime_publish',
      actions: ['publish'],
      routeCount: eventsAdminRoutes.filter((route) => route.resourceType === 'event_publication').length
    },
    {
      resourceKind: 'runtime_stream',
      actions: ['stream'],
      routeCount: eventsAdminRoutes.filter((route) => route.resourceType === 'event_stream').length
    },
    {
      resourceKind: 'function_kafka_trigger',
      actions: ['create', 'get'],
      routeCount: filterPublicRoutes({ family: 'functions' }).filter((route) => route.resourceType === 'function_kafka_trigger').length
    },
    {
      resourceKind: 'workspace_event_dashboard',
      actions: ['get'],
      routeCount: filterPublicRoutes({ family: 'metrics' }).filter((route) => route.resourceType === 'event_dashboard').length
    },
    {
      resourceKind: 'runtime_websocket',
      actions: ['subscribe'],
      routeCount: filterPublicRoutes({ family: 'websockets' }).filter((route) => route.resourceType === 'websocket_session').length
    }
  ]);
}

export function summarizeEventGatewayRuntime(context = {}, topic = {}) {
  const profile = resolveEventGatewayProfile(context, topic);

  return {
    contractVersion: profile.contractVersion,
    transports: EVENT_GATEWAY_TRANSPORTS,
    payloadEncodings: EVENT_GATEWAY_PAYLOAD_ENCODINGS,
    replayModes: EVENT_GATEWAY_REPLAY_MODES,
    queueTypes: EVENT_GATEWAY_NOTIFICATION_QUEUE_TYPES,
    payloadLimits: profile.payload,
    streamLimits: profile.stream,
    replay: profile.replay,
    notification: profile.notification,
    observability: {
      ...profile.observability,
      requiredMetrics: EVENT_GATEWAY_REQUIRED_METRICS,
      relativeOrderScope: EVENT_GATEWAY_RELATIVE_ORDER_SCOPE
    }
  };
}

export function summarizeEventBridgeSupport(context = {}, topic = {}) {
  const profile = resolveEventBridgeProfile(context, topic);

  return {
    contractVersion: profile.contractVersion,
    sourceTypes: EVENT_BRIDGE_SOURCE_TYPES,
    deliveryModes: profile.deliveryModes,
    payloadModes: profile.payloadModes,
    supportedTopicMetadata: KAFKA_TOPIC_METADATA_FIELDS,
    supportedDashboardWidgets: EVENT_DASHBOARD_WIDGET_TYPES,
    triggerDeliveryModes: KAFKA_FUNCTION_TRIGGER_DELIVERY_MODES,
    limits: profile.limits,
    observability: profile.observability
  };
}

export function summarizeTopicMetadataSupport(topic = {}, lag = {}, visibility = {}) {
  return buildTopicMetadataExposure({ topic, lag, visibility });
}

export function summarizeWorkspaceEventDashboard(input = {}) {
  return buildWorkspaceEventDashboard(input);
}

export function summarizeEventsAuditCoverage() {
  const requestFields = new Set(kafkaAdminRequestContract?.required_fields ?? []);
  const resultFields = new Set(kafkaAdminResultContract?.required_fields ?? []);
  const inventoryFields = new Set(kafkaInventorySnapshotContract?.required_fields ?? []);
  const eventFields = new Set(kafkaAdminEventContract?.required_fields ?? []);

  return {
    family: eventsApiFamily?.id ?? 'events',
    adminContextFields: KAFKA_ADMIN_AUDIT_CONTEXT_FIELDS.map((field) => ({
      field,
      requestContract: requestFields.has(field),
      resultOrEventContract: resultFields.has(field) || eventFields.has(field)
    })),
    capturesAclBindings:
      requestFields.has('acl_bindings') && resultFields.has('acl_state') && inventoryFields.has('tenant_isolation'),
    capturesQuotaVisibility:
      requestFields.has('quota_snapshot') && resultFields.has('quota_status') && inventoryFields.has('limit_visibility'),
    capturesKRaftGuidance:
      requestFields.has('broker_mode') && resultFields.has('kraft_guidance') && eventFields.has('broker_mode'),
    capturesCorrelationRichEvents: eventFields.has('correlation_context') && eventFields.has('audit_record_id')
  };
}

export function getKafkaCompatibilitySummary(context = {}) {
  const profile = resolveKafkaAdminProfile(context);

  return {
    provider: 'kafka',
    contractVersion: kafkaAdminRequestContract?.version ?? '2026-03-25',
    brokerMode: profile.brokerMode,
    isolationMode: profile.isolationMode,
    deploymentProfileId: profile.deploymentProfileId,
    namingPolicy: profile.namingPolicy,
    quotaGuardrails: profile.quotaGuardrails,
    minimumEnginePolicy: profile.minimumEnginePolicy,
    auditCoverage: summarizeEventsAuditCoverage(),
    eventGatewayRuntime: summarizeEventGatewayRuntime(context),
    eventBridgeSupport: summarizeEventBridgeSupport(context),
    topicMutationsSupported: profile.topicMutationsSupported,
    aclMutationsSupported: profile.aclMutationsSupported,
    inventorySupported: profile.inventorySupported,
    supportedVersions: SUPPORTED_KAFKA_VERSION_RANGES.map(({ range, label, brokerMode, adminApiStability, isolationModes }) => ({
      range,
      label,
      brokerMode,
      adminApiStability,
      isolationModes
    }))
  };
}

export { isKafkaVersionSupported };
