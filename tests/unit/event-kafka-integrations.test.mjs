import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildEventBridgeDefinition,
  buildKafkaAdminAuditRecord,
  buildKafkaFunctionTrigger,
  buildTopicMetadataExposure,
  buildWorkspaceEventDashboard,
  EVENT_BRIDGE_SOURCE_TYPES,
  EVENT_DASHBOARD_WIDGET_TYPES,
  KAFKA_FUNCTION_TRIGGER_DELIVERY_MODES,
  KAFKA_TOPIC_METADATA_FIELDS,
  resolveEventBridgeProfile,
  validateEventBridgeDefinition,
  validateKafkaFunctionTrigger
} from '../../services/event-gateway/src/kafka-integrations.mjs';
import {
  summarizeEventBridgeSupport,
  summarizeTopicMetadataSupport,
  summarizeWorkspaceEventDashboard
} from '../../apps/control-plane/src/events-admin.mjs';

test('event-bridge profiles and builders normalize multi-source Kafka bridge definitions', () => {
  const context = {
    tenantId: 'ten_01growthalpha',
    workspaceId: 'wrk_01alphadev',
    workspaceEnvironment: 'dev',
    planId: 'pln_01growth'
  };
  const topic = {
    resourceId: 'res_01billing',
    replayWindowHours: 24,
    partitionCount: 6,
    cleanupPolicy: 'delete,compact',
    retentionHours: 72
  };
  const profile = resolveEventBridgeProfile(context, topic);
  const validation = validateEventBridgeDefinition({
    context,
    topic,
    bridge: {
      sourceType: 'postgresql',
      sourceRef: 'pg://tenant_alpha/orders',
      topicRef: 'res_01billing',
      sourceEventTypes: ['row_inserted', 'row_updated'],
      sourceFilters: [{ field: 'schema', operator: 'eq', value: 'alpha_prod_app' }],
      payloadMode: 'cloudevents_json',
      batchSize: 50,
      partitionKeyTemplate: '{tenantId}.{tableName}'
    }
  });
  const built = buildEventBridgeDefinition({
    context,
    topic,
    bridge: {
      sourceType: 'postgresql',
      sourceRef: 'pg://tenant_alpha/orders',
      topicRef: 'res_01billing',
      sourceEventTypes: ['row_inserted', 'row_updated'],
      sourceFilters: [{ field: 'schema', operator: 'eq', value: 'alpha_prod_app' }],
      payloadMode: 'cloudevents_json',
      batchSize: 50,
      partitionKeyTemplate: '{tenantId}.{tableName}'
    }
  });

  assert.deepEqual(EVENT_BRIDGE_SOURCE_TYPES, ['postgresql', 'mongodb', 'storage', 'openwhisk', 'iam']);
  assert.equal(profile.planTier, 'growth');
  assert.equal(profile.limits.maxBatchSize, 100);
  assert.deepEqual(profile.observability.supportedTopicMetadata, KAFKA_TOPIC_METADATA_FIELDS);
  assert.equal(validation.ok, true);
  assert.equal(validation.normalized.source.type, 'postgresql');
  assert.equal(validation.normalized.delivery.payloadMode, 'cloudevents_json');
  assert.equal(built.ok, true);
  assert.equal(built.bridge.source.type, 'postgresql');
  assert.equal(built.bridge.delivery.batchSize, 50);
  assert.equal(built.bridge.audit.traceFields.includes('correlation_id'), true);
});

test('event-bridge validation rejects cross-workspace sources and unsupported event types', () => {
  const validation = validateEventBridgeDefinition({
    context: {
      tenantId: 'ten_01growthalpha',
      workspaceId: 'wrk_01alphadev',
      workspaceEnvironment: 'dev',
      planId: 'pln_01growth'
    },
    topic: {
      resourceId: 'res_01billing',
      replayWindowHours: 24
    },
    bridge: {
      sourceType: 'storage',
      sourceRef: 'bucket://alpha-assets',
      sourceWorkspaceId: 'wrk_01betadev',
      topicRef: 'res_01billing',
      sourceEventTypes: ['object_created', 'row_updated']
    }
  });

  assert.equal(validation.ok, false);
  assert.equal(
    validation.violations.some((entry) => entry.includes('sourceWorkspaceId must match the owning workspace')),
    true
  );
  assert.equal(
    validation.violations.some((entry) => entry.includes('sourceEventType row_updated is not supported for storage')),
    true
  );
});

test('Kafka function-trigger builders normalize OpenWhisk execution policy and dead-letter routing', () => {
  const context = {
    tenantId: 'ten_01enterprisealpha',
    workspaceId: 'wrk_01alphaprod',
    workspaceEnvironment: 'prod',
    planId: 'pln_01enterprise'
  };
  const action = { resourceId: 'res_01action' };
  const topic = { resourceId: 'res_01billing', replayWindowHours: 72 };
  const validation = validateKafkaFunctionTrigger({
    context,
    topic,
    action,
    trigger: {
      topicRef: 'res_01billing',
      deliveryMode: 'micro_batch',
      batchSize: 200,
      maxParallelInvocations: 20,
      failurePolicy: 'retry_then_dead_letter',
      deadLetterTopicRef: 'res_01billingdlq',
      filterExpression: 'payload.eventType == "invoice.created"'
    }
  });
  const built = buildKafkaFunctionTrigger({
    context,
    topic,
    action,
    trigger: {
      topicRef: 'res_01billing',
      deliveryMode: 'micro_batch',
      batchSize: 200,
      maxParallelInvocations: 20,
      failurePolicy: 'retry_then_dead_letter',
      deadLetterTopicRef: 'res_01billingdlq',
      filterExpression: 'payload.eventType == "invoice.created"'
    }
  });

  assert.deepEqual(KAFKA_FUNCTION_TRIGGER_DELIVERY_MODES, ['per_event', 'micro_batch']);
  assert.equal(validation.ok, true);
  assert.equal(validation.normalized.deliveryMode, 'micro_batch');
  assert.equal(built.ok, true);
  assert.equal(built.trigger.failure_policy, 'retry_then_dead_letter');
  assert.equal(built.trigger.max_parallel_invocations, 20);
  assert.equal(built.trigger.dead_letter_topic_ref, 'res_01billingdlq');
});

test('topic metadata and workspace dashboards expose lag retention compaction and dashboard widgets', () => {
  const metadata = buildTopicMetadataExposure({
    topic: {
      resourceId: 'res_01billing',
      topicName: 'billing-events',
      physicalTopicName: 'ia.alpha.billing.events.v1',
      partitionCount: 12,
      cleanupPolicy: 'delete,compact',
      retentionHours: 168,
      replayWindowHours: 72
    },
    lag: {
      maxMessagesBehind: 37,
      p95Ms: 420,
      observedAt: '2026-03-26T09:00:00Z'
    }
  });
  const summarized = summarizeTopicMetadataSupport(
    {
      resourceId: 'res_01billing',
      topicName: 'billing-events',
      physicalTopicName: 'ia.alpha.billing.events.v1',
      partitionCount: 12,
      cleanupPolicy: 'delete,compact',
      retentionHours: 168,
      replayWindowHours: 72
    },
    {
      maxMessagesBehind: 37,
      p95Ms: 420,
      observedAt: '2026-03-26T09:00:00Z'
    }
  );
  const dashboard = buildWorkspaceEventDashboard({
    workspaceId: 'wrk_01alphaprod',
    topicMetrics: [{ topicRef: 'res_01billing' }],
    bridgeStatuses: [{ bridgeId: 'evb_postgresql_res_01billing' }],
    triggerStatuses: [{ triggerId: 'ktr_res_01action_res_01billing' }],
    auditSeries: [{ operation: 'create_topic' }]
  });
  const summarizedDashboard = summarizeWorkspaceEventDashboard({
    workspaceId: 'wrk_01alphaprod',
    topicMetrics: [{ topicRef: 'res_01billing' }],
    bridgeStatuses: [{ bridgeId: 'evb_postgresql_res_01billing' }],
    triggerStatuses: [{ triggerId: 'ktr_res_01action_res_01billing' }],
    auditSeries: [{ operation: 'create_topic' }]
  });

  assert.equal(metadata.partitionMetadata.available, true);
  assert.equal(metadata.lag.maxMessagesBehind, 37);
  assert.equal(metadata.retention.retentionMs, 604800000);
  assert.equal(metadata.compaction.enabled, true);
  assert.equal(summarized.compaction.cleanupPolicy, 'delete,compact');
  assert.deepEqual(EVENT_DASHBOARD_WIDGET_TYPES, [
    'topic_throughput',
    'consumer_lag',
    'bridge_health',
    'function_trigger_health',
    'admin_audit_volume'
  ]);
  assert.equal(dashboard.widgets.length, EVENT_DASHBOARD_WIDGET_TYPES.length);
  assert.equal(dashboard.widgets.some((widget) => widget.type === 'bridge_health'), true);
  assert.equal(
    dashboard.widgets.some((widget) => widget.query.includes('in_atelier_openwhisk_kafka_trigger_invocations_total')),
    true
  );
  assert.deepEqual(summarizedDashboard.coverage, dashboard.coverage);
});

test('DB→Kafka→Function and Storage/IAM→Kafka flows stay covered through managed bridge and trigger contracts', () => {
  const dbBridge = buildEventBridgeDefinition({
    context: {
      tenantId: 'ten_01enterprisealpha',
      workspaceId: 'wrk_01alphaprod',
      workspaceEnvironment: 'prod',
      planId: 'pln_01enterprise'
    },
    topic: {
      resourceId: 'res_01billing',
      replayWindowHours: 72,
      partitionCount: 12,
      cleanupPolicy: 'delete,compact',
      retentionHours: 168
    },
    bridge: {
      sourceType: 'postgresql',
      sourceRef: 'pg://tenant_alpha/public.invoices',
      topicRef: 'res_01billing',
      sourceEventTypes: ['row_inserted', 'row_updated'],
      batchSize: 100
    }
  });
  const storageBridge = buildEventBridgeDefinition({
    context: {
      tenantId: 'ten_01enterprisealpha',
      workspaceId: 'wrk_01alphaprod',
      workspaceEnvironment: 'prod',
      planId: 'pln_01enterprise'
    },
    topic: {
      resourceId: 'res_01assets',
      replayWindowHours: 72,
      partitionCount: 12,
      cleanupPolicy: 'delete',
      retentionHours: 168
    },
    bridge: {
      sourceType: 'storage',
      sourceRef: 'bucket://alpha-assets',
      topicRef: 'res_01assets',
      sourceEventTypes: ['object_created', 'object_deleted']
    }
  });
  const iamBridge = buildEventBridgeDefinition({
    context: {
      tenantId: 'ten_01enterprisealpha',
      workspaceId: 'wrk_01alphaprod',
      workspaceEnvironment: 'prod',
      planId: 'pln_01enterprise'
    },
    topic: {
      resourceId: 'res_01identity',
      replayWindowHours: 72,
      partitionCount: 12,
      cleanupPolicy: 'compact',
      retentionHours: 168
    },
    bridge: {
      sourceType: 'iam',
      sourceRef: 'iam://tenant/realms/alpha',
      topicRef: 'res_01identity',
      sourceEventTypes: ['user_created', 'membership_changed']
    }
  });
  const trigger = buildKafkaFunctionTrigger({
    context: {
      tenantId: 'ten_01enterprisealpha',
      workspaceId: 'wrk_01alphaprod',
      workspaceEnvironment: 'prod',
      planId: 'pln_01enterprise'
    },
    topic: { resourceId: 'res_01billing', replayWindowHours: 72 },
    action: { resourceId: 'res_01invoice_worker' },
    trigger: {
      topicRef: 'res_01billing',
      deliveryMode: 'micro_batch',
      batchSize: 50,
      maxParallelInvocations: 8,
      failurePolicy: 'retry_then_dead_letter',
      deadLetterTopicRef: 'res_01billingdlq'
    }
  });

  assert.equal(dbBridge.ok, true);
  assert.equal(storageBridge.ok, true);
  assert.equal(iamBridge.ok, true);
  assert.equal(trigger.ok, true);
  assert.equal(dbBridge.bridge.topic_ref, trigger.trigger.topic_ref);
  assert.equal(storageBridge.bridge.source.type, 'storage');
  assert.equal(iamBridge.bridge.source.type, 'iam');
});

test('event-bridge support summary and Kafka admin audit records preserve traceability metadata', () => {
  const support = summarizeEventBridgeSupport({
    tenantId: 'ten_01growthalpha',
    workspaceId: 'wrk_01alphadev',
    workspaceEnvironment: 'dev',
    planId: 'pln_01growth'
  });
  const auditRecord = buildKafkaAdminAuditRecord({
    actorId: 'usr_01alpha',
    operation: 'create_event_bridge',
    targetRef: 'bridge:evb_postgresql_res_01billing',
    tenantId: 'ten_01growthalpha',
    workspaceId: 'wrk_01alphadev',
    correlationId: 'corr_evt_01',
    authorizationDecisionId: 'authz_evt_01',
    auditRecordId: 'aud_evt_01',
    bridgeId: 'evb_postgresql_res_01billing'
  });

  assert.equal(support.sourceTypes.includes('iam'), true);
  assert.equal(support.triggerDeliveryModes.includes('micro_batch'), true);
  assert.equal(support.supportedDashboardWidgets.includes('admin_audit_volume'), true);
  assert.equal(auditRecord.resource_family, 'events');
  assert.equal(auditRecord.write_mode, 'append_only');
  assert.equal(auditRecord.evidence_pointer.includes('create-event-bridge'), true);
});
