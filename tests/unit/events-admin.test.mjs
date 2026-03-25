import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getEventsAdminRoute,
  getKafkaCompatibilitySummary,
  listEventsAdminRoutes,
  summarizeEventBridgeSupport,
  summarizeEventGatewayRuntime,
  summarizeEventsAdminSurface,
  summarizeEventsAuditCoverage,
  summarizeTopicMetadataSupport,
  summarizeWorkspaceEventDashboard
} from '../../apps/control-plane/src/events-admin.mjs';

test('events admin control-plane helper exposes Kafka topic governance, bridges, metadata, inventory, and runtime routes', () => {
  const routes = listEventsAdminRoutes();
  const inventoryRoute = getEventsAdminRoute('getEventTopicInventory');
  const aclRoute = getEventsAdminRoute('updateEventTopicAccess');
  const topicRoute = getEventsAdminRoute('createEvents');
  const bridgeRoute = getEventsAdminRoute('createEventBridge');
  const metadataRoute = getEventsAdminRoute('getEventTopicMetadata');
  const surface = summarizeEventsAdminSurface();

  assert.ok(routes.some((route) => route.operationId === 'createEvents'));
  assert.ok(routes.some((route) => route.operationId === 'getEvents'));
  assert.ok(routes.some((route) => route.operationId === 'getEventTopicAccess'));
  assert.ok(routes.some((route) => route.operationId === 'updateEventTopicAccess'));
  assert.ok(routes.some((route) => route.operationId === 'getEventTopicInventory'));
  assert.ok(routes.some((route) => route.operationId === 'createEventBridge'));
  assert.ok(routes.some((route) => route.operationId === 'getEventBridge'));
  assert.ok(routes.some((route) => route.operationId === 'getEventTopicMetadata'));
  assert.ok(routes.some((route) => route.operationId === 'publishEventToTopic'));
  assert.ok(routes.some((route) => route.operationId === 'streamTopicEvents'));
  assert.equal(topicRoute.resourceType, 'topic');
  assert.equal(aclRoute.resourceType, 'topic_acl');
  assert.equal(inventoryRoute.path, '/v1/events/workspaces/{workspaceId}/inventory');
  assert.equal(bridgeRoute.resourceType, 'event_bridge');
  assert.equal(metadataRoute.resourceType, 'topic_metadata');
  assert.equal(surface.find((entry) => entry.resourceKind === 'topic').actions.includes('create'), true);
  assert.equal(surface.find((entry) => entry.resourceKind === 'topic_acl').routeCount, 2);
  assert.equal(surface.find((entry) => entry.resourceKind === 'inventory').routeCount, 1);
  assert.equal(surface.find((entry) => entry.resourceKind === 'event_bridge').routeCount, 2);
  assert.equal(surface.find((entry) => entry.resourceKind === 'topic_metadata').routeCount, 1);
  assert.equal(surface.find((entry) => entry.resourceKind === 'runtime_publish').routeCount, 1);
});

test('events admin helper summarizes KRaft compatibility, bridges, metadata, dashboards, quotas, and runtime gateway policy', () => {
  const auditCoverage = summarizeEventsAuditCoverage();
  const runtimeSummary = summarizeEventGatewayRuntime(
    {
      tenantId: 'ten_01growthalpha',
      workspaceId: 'wrk_01alphadev',
      workspaceEnvironment: 'dev',
      planId: 'pln_01growth'
    },
    {
      resourceId: 'res_01billing',
      replayWindowHours: 24,
      allowedTransports: ['http_publish', 'sse', 'websocket']
    }
  );
  const bridgeSupport = summarizeEventBridgeSupport(
    {
      tenantId: 'ten_01growthalpha',
      workspaceId: 'wrk_01alphadev',
      workspaceEnvironment: 'dev',
      planId: 'pln_01growth'
    },
    {
      resourceId: 'res_01billing',
      replayWindowHours: 24,
      allowedTransports: ['http_publish', 'sse', 'websocket']
    }
  );
  const metadataSummary = summarizeTopicMetadataSupport(
    {
      resourceId: 'res_01billing',
      topicName: 'billing-events',
      physicalTopicName: 'ia.01growthalpha.alpha.dev.dev.billing.events.v1',
      partitionCount: 6,
      cleanupPolicy: 'delete,compact',
      retentionHours: 72,
      replayWindowHours: 24
    },
    {
      maxMessagesBehind: 12,
      p95Ms: 240,
      observedAt: '2026-03-26T08:00:00Z'
    }
  );
  const dashboardSummary = summarizeWorkspaceEventDashboard({
    workspaceId: 'wrk_01alphadev',
    topicMetrics: [{ topicRef: 'res_01billing' }],
    bridgeStatuses: [{ bridgeId: 'evb_postgresql_res_01billing' }],
    triggerStatuses: [{ triggerId: 'ktr_res_01action_res_01billing' }],
    auditSeries: [{ operation: 'create_event_bridge' }]
  });
  const growthSummary = getKafkaCompatibilitySummary({
    tenantId: 'ten_01growthalpha',
    workspaceId: 'wrk_01alphadev',
    workspaceSlug: 'alpha-dev',
    workspaceEnvironment: 'dev',
    planId: 'pln_01growth'
  });
  const enterpriseSummary = getKafkaCompatibilitySummary({
    tenantId: 'ten_01enterprisealpha',
    workspaceId: 'wrk_01alphaprod',
    workspaceSlug: 'alpha-prod',
    workspaceEnvironment: 'prod',
    planId: 'pln_01enterprise',
    isolationMode: 'dedicated_cluster',
    providerVersion: '3.8.1'
  });

  assert.equal(runtimeSummary.transports.includes('sse'), true);
  assert.equal(runtimeSummary.payloadEncodings.includes('base64'), true);
  assert.equal(runtimeSummary.queueTypes.includes('workspace'), true);
  assert.equal(runtimeSummary.replay.maxWindowHours, 24);
  assert.equal(runtimeSummary.observability.relativeOrderScope, 'key_within_partition');
  assert.equal(bridgeSupport.sourceTypes.includes('storage'), true);
  assert.equal(bridgeSupport.supportedTopicMetadata.includes('consumer_lag'), true);
  assert.equal(bridgeSupport.triggerDeliveryModes.includes('micro_batch'), true);
  assert.equal(metadataSummary.compaction.enabled, true);
  assert.equal(metadataSummary.lag.maxMessagesBehind, 12);
  assert.equal(dashboardSummary.widgets.some((widget) => widget.type === 'bridge_health'), true);

  assert.equal(growthSummary.brokerMode, 'kraft');
  assert.equal(growthSummary.isolationMode, 'shared_cluster');
  assert.equal(growthSummary.namingPolicy.topicPrefix, 'ia.01growthalpha.alpha.dev.dev');
  assert.equal(growthSummary.namingPolicy.serviceAccountPrincipalPrefix, 'User:svc_alpha_dev_');
  assert.equal(growthSummary.quotaGuardrails.maxTopicsPerWorkspace, 20);
  assert.equal(growthSummary.quotaGuardrails.maxPartitionsPerTopic, 12);
  assert.equal(growthSummary.auditCoverage.capturesQuotaVisibility, true);
  assert.equal(growthSummary.eventGatewayRuntime.queueTypes.includes('session'), true);
  assert.equal(growthSummary.eventBridgeSupport.supportedDashboardWidgets.includes('function_trigger_health'), true);
  assert.equal(auditCoverage.adminContextFields.some((entry) => entry.field === 'origin_surface' && entry.requestContract), true);

  assert.equal(enterpriseSummary.isolationMode, 'dedicated_cluster');
  assert.equal(enterpriseSummary.minimumEnginePolicy.metadataQuorum, 'kraft_controller_quorum');
  assert.equal(enterpriseSummary.minimumEnginePolicy.forbiddenLegacyModes.includes('zookeeper'), true);
  assert.equal(enterpriseSummary.supportedVersions.some((entry) => entry.range === '3.8.x' && entry.brokerMode === 'kraft'), true);
  assert.equal(enterpriseSummary.aclMutationsSupported, true);
});
