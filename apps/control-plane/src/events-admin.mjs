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
      resourceKind: 'runtime_publish',
      actions: ['publish'],
      routeCount: eventsAdminRoutes.filter((route) => route.resourceType === 'event_publication').length
    },
    {
      resourceKind: 'runtime_stream',
      actions: ['stream'],
      routeCount: eventsAdminRoutes.filter((route) => route.resourceType === 'event_stream').length
    }
  ]);
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
