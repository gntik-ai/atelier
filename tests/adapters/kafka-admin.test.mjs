import test from 'node:test';
import assert from 'node:assert/strict';

import {
  KAFKA_ADMIN_ALLOWED_ACL_OPERATIONS,
  KAFKA_ADMIN_CAPABILITY_MATRIX,
  KAFKA_ADMIN_MINIMUM_ENGINE_POLICY,
  SUPPORTED_KAFKA_VERSION_RANGES,
  buildKafkaAdminAdapterCall,
  buildKafkaAdminInventorySnapshot,
  buildKafkaAdminMetadataRecord,
  isKafkaVersionSupported,
  normalizeKafkaAdminError,
  normalizeKafkaAdminResource,
  resolveKafkaAdminProfile,
  validateKafkaAdminRequest
} from '../../services/adapters/src/kafka-admin.mjs';

test('kafka admin adapter exports KRaft capability and quota governance baselines', () => {
  const growthProfile = resolveKafkaAdminProfile({
    tenantId: 'ten_01growthalpha',
    workspaceId: 'wrk_01alphadev',
    workspaceSlug: 'alpha-dev',
    workspaceEnvironment: 'dev',
    planId: 'pln_01growth'
  });
  const enterpriseProfile = resolveKafkaAdminProfile({
    tenantId: 'ten_01enterprisealpha',
    workspaceId: 'wrk_01alphaprod',
    workspaceSlug: 'alpha-prod',
    workspaceEnvironment: 'prod',
    planId: 'pln_01enterprise',
    isolationMode: 'dedicated_cluster'
  });

  assert.deepEqual(Object.keys(KAFKA_ADMIN_CAPABILITY_MATRIX), ['topic', 'topic_acl']);
  assert.deepEqual(KAFKA_ADMIN_CAPABILITY_MATRIX.topic, ['list', 'get', 'create', 'update', 'delete']);
  assert.deepEqual(KAFKA_ADMIN_CAPABILITY_MATRIX.topic_acl, ['get', 'update']);
  assert.equal(KAFKA_ADMIN_ALLOWED_ACL_OPERATIONS.includes('idempotent_write'), true);
  assert.equal(SUPPORTED_KAFKA_VERSION_RANGES.length, 3);
  assert.equal(isKafkaVersionSupported('3.7.2'), true);
  assert.equal(isKafkaVersionSupported('3.8.1'), true);
  assert.equal(isKafkaVersionSupported('3.5.4'), false);
  assert.equal(growthProfile.brokerMode, 'kraft');
  assert.equal(growthProfile.isolationMode, 'shared_cluster');
  assert.equal(growthProfile.namingPolicy.topicPrefix, 'ia.01growthalpha.alpha.dev.dev');
  assert.equal(growthProfile.namingPolicy.consumerGroupPrefix, 'cg.ia.01growthalpha.alpha.dev.dev');
  assert.equal(growthProfile.quotaGuardrails.maxTopicsPerWorkspace, 20);
  assert.equal(growthProfile.quotaGuardrails.maxPartitionsPerTopic, 12);
  assert.equal(enterpriseProfile.isolationMode, 'dedicated_cluster');
  assert.equal(KAFKA_ADMIN_MINIMUM_ENGINE_POLICY.dedicated_cluster.metadataQuorum, 'kraft_controller_quorum');
  assert.equal(KAFKA_ADMIN_MINIMUM_ENGINE_POLICY.shared_cluster.forbiddenLegacyModes.includes('zookeeper'), true);
});

test('kafka admin adapter normalizes managed topics and ACLs into audit-safe shapes', () => {
  const topic = normalizeKafkaAdminResource(
    'topic',
    {
      topicName: 'billing-events',
      channelPrefix: 'billing',
      deliverySemantics: 'at_least_once',
      partitionStrategy: 'tenant_workspace_key',
      partitionCount: 6,
      replicationFactor: 3,
      retentionHours: 168,
      replayWindowHours: 24,
      cleanupPolicy: 'delete',
      allowedTransports: ['http_publish', 'sse', 'websocket'],
      maxPublishesPerSecond: 600,
      maxConcurrentSubscriptions: 400,
      aclBindings: [
        {
          principal: 'User:svc_alpha_dev_publisher',
          serviceAccountId: 'svc_01alphapub',
          operations: ['write', 'describe'],
          patternType: 'literal'
        },
        {
          principal: 'User:svc_alpha_dev_consumer',
          serviceAccountId: 'svc_01alphaconsume',
          operations: ['read', 'describe'],
          patternType: 'literal'
        }
      ]
    },
    {
      resourceId: 'res_01evtbilling',
      tenantId: 'ten_01growthalpha',
      workspaceId: 'wrk_01alphadev',
      workspaceSlug: 'alpha-dev',
      workspaceEnvironment: 'dev',
      planId: 'pln_01growth'
    }
  );
  const topicAcl = normalizeKafkaAdminResource(
    'topic_acl',
    {
      topicName: 'billing-events',
      aclBindings: [
        {
          principal: 'User:svc_alpha_dev_publisher',
          serviceAccountId: 'svc_01alphapub',
          operations: ['write', 'describe'],
          patternType: 'literal'
        }
      ]
    },
    {
      resourceId: 'res_01evtbilling',
      tenantId: 'ten_01growthalpha',
      workspaceId: 'wrk_01alphadev',
      workspaceSlug: 'alpha-dev',
      workspaceEnvironment: 'dev',
      planId: 'pln_01growth'
    }
  );

  assert.equal(topic.resourceType, 'event_topic');
  assert.equal(topic.physicalTopicName, 'ia.01growthalpha.alpha.dev.dev.billing.events.v1');
  assert.equal(topic.namingPolicy.topicNameGovernance, 'provider_generated');
  assert.equal(topic.tenantIsolation.crossTenantAccessPrevented, true);
  assert.equal(topic.aclBindings.length, 2);
  assert.equal(topic.providerCompatibility.brokerMode, 'kraft');
  assert.equal(topic.quotaStatus.visibleInConsole, true);

  assert.equal(topicAcl.resourceType, 'event_topic_acl');
  assert.equal(topicAcl.aclBindings[0].resourceName, 'ia.01growthalpha.alpha.dev.dev.billing.events.v1');
  assert.equal(topicAcl.tenantIsolation.aclPatternType, 'prefixed');
});

test('kafka admin adapter validates KRaft, naming, quota, and workspace ACL isolation', () => {
  const okValidation = validateKafkaAdminRequest({
    resourceKind: 'topic',
    action: 'create',
    context: {
      tenantId: 'ten_01growthalpha',
      workspaceId: 'wrk_01alphadev',
      workspaceSlug: 'alpha-dev',
      workspaceEnvironment: 'dev',
      planId: 'pln_01growth',
      currentTopicCount: 2
    },
    payload: {
      topicName: 'billing-events',
      partitionCount: 6,
      maxPublishesPerSecond: 600,
      maxConcurrentSubscriptions: 400,
      aclBindings: [
        {
          principal: 'User:svc_alpha_dev_publisher',
          serviceAccountId: 'svc_01alphapub',
          operations: ['write', 'describe'],
          patternType: 'literal'
        }
      ]
    }
  });
  const badValidation = validateKafkaAdminRequest({
    resourceKind: 'topic',
    action: 'create',
    context: {
      tenantId: 'ten_01growthalpha',
      workspaceId: 'wrk_01alphadev',
      workspaceSlug: 'alpha-dev',
      workspaceEnvironment: 'dev',
      planId: 'pln_01growth',
      brokerMode: 'zookeeper',
      currentTopicCount: 20
    },
    payload: {
      topicName: 'ia.01growthalpha.alpha.dev.dev.billing-events',
      partitionCount: 20,
      aclBindings: [
        {
          principal: 'User:svc_other_workspace',
          operations: ['alter'],
          patternType: 'literal'
        }
      ]
    }
  });

  assert.equal(okValidation.ok, true);
  assert.deepEqual(okValidation.violations, []);

  assert.equal(badValidation.ok, false);
  assert.equal(
    badValidation.violations.includes('Kafka admin operations require KRaft mode; ZooKeeper-backed governance is not supported.'),
    true
  );
  assert.equal(
    badValidation.violations.includes('topicName must be a logical name only; physical Kafka prefixes are generated by the control plane.'),
    true
  );
  assert.equal(
    badValidation.violations.includes('partitionCount 20 exceeds the workspace guardrail 12.'),
    true
  );
  assert.equal(
    badValidation.violations.includes('Quota workspace.kafka_topics.max would be exceeded by creating another topic.'),
    true
  );
  assert.equal(
    badValidation.violations.includes('ACL principal User:svc_other_workspace must stay inside workspace prefix User:svc_alpha_dev_.'),
    true
  );
});

test('kafka admin adapter builds contract-rich adapter calls, metadata, inventory snapshots, and normalized errors', () => {
  const adapterCall = buildKafkaAdminAdapterCall({
    resourceKind: 'topic',
    action: 'create',
    callId: 'cmd_01evtkafkaadmin',
    tenantId: 'ten_01growthalpha',
    workspaceId: 'wrk_01alphadev',
    planId: 'pln_01growth',
    correlationId: 'corr_01evtkafkaadmin',
    authorizationDecisionId: 'authz_01evtkafkaadmin',
    idempotencyKey: 'idem_evt_kafka_admin_01',
    context: {
      resourceId: 'res_01evtbilling',
      tenantId: 'ten_01growthalpha',
      workspaceId: 'wrk_01alphadev',
      workspaceSlug: 'alpha-dev',
      workspaceEnvironment: 'dev',
      planId: 'pln_01growth',
      currentTopicCount: 2,
      providerVersion: '3.8.1'
    },
    payload: {
      topicName: 'billing-events',
      partitionCount: 6,
      aclBindings: [
        {
          principal: 'User:svc_alpha_dev_publisher',
          serviceAccountId: 'svc_01alphapub',
          operations: ['write', 'describe'],
          patternType: 'literal'
        }
      ]
    },
    scopes: ['topics:admin'],
    effectiveRoles: ['workspace_admin'],
    actorId: 'usr_01alice',
    actorType: 'user',
    originSurface: 'control_api',
    requestedAt: '2026-03-25T10:15:00Z'
  });

  assert.equal(adapterCall.adapter_id, 'kafka');
  assert.equal(adapterCall.contract_version, '2026-03-25');
  assert.equal(adapterCall.capability, 'kafka_topic_create');
  assert.equal(adapterCall.target_ref, 'topic:ia.01growthalpha.alpha.dev.dev.billing.events.v1');
  assert.equal(adapterCall.payload.normalizedResource.providerCompatibility.provider, 'kafka');
  assert.equal(adapterCall.payload.adminEvent.eventType, 'kafka.admin.reconciled');
  assert.equal(adapterCall.payload.adminEvent.brokerMode, 'kraft');
  assert.equal(adapterCall.payload.tenantIsolation.workspacePrincipalCount, 1);

  const metadata = buildKafkaAdminMetadataRecord({
    resourceKind: 'topic',
    action: 'create',
    resource: adapterCall.payload.normalizedResource,
    auditSummary: adapterCall.payload.auditSummary,
    correlationContext: adapterCall.payload.correlationContext,
    adminEvent: adapterCall.payload.adminEvent,
    tenantId: 'ten_01growthalpha',
    workspaceId: 'wrk_01alphadev',
    observedAt: '2026-03-25T10:15:01Z'
  });
  const inventory = buildKafkaAdminInventorySnapshot({
    snapshotId: 'snap_01evtkafkaadmin',
    tenantId: 'ten_01growthalpha',
    workspaceId: 'wrk_01alphadev',
    planId: 'pln_01growth',
    context: {
      workspaceSlug: 'alpha-dev',
      workspaceEnvironment: 'dev',
      currentTopicCount: 2
    },
    topics: [adapterCall.payload.normalizedResource],
    aclBindings: adapterCall.payload.normalizedResource.aclBindings,
    serviceAccounts: [{ serviceAccountId: 'svc_01alphapub' }],
    observedAt: '2026-03-25T10:15:01Z'
  });
  const error = normalizeKafkaAdminError(
    {
      status: 429,
      message: 'Kafka topic quota exceeded.',
      providerError: 'TOPIC_AUTHORIZATION_FAILED'
    },
    {
      resourceKind: 'topic',
      action: 'create',
      targetRef: 'topic:ia.01growthalpha.alpha.dev.dev.billing.events.v1',
      topicName: 'billing-events'
    }
  );

  assert.equal(metadata.metadata.primaryRef, 'ia.01growthalpha.alpha.dev.dev.billing.events.v1');
  assert.equal(metadata.metadata.aclBindingCount, 1);
  assert.equal(inventory.contractVersion, '2026-03-25');
  assert.equal(inventory.limitVisibility.visibleInConsole, true);
  assert.equal(inventory.topicRefs[0], 'ia.01growthalpha.alpha.dev.dev.billing.events.v1');
  assert.equal(error.code, 'EVT_KAFKA_QUOTA_EXCEEDED');
  assert.equal(error.retryable, false);
});

test('kafka create validation exposes structured quotaDecision metadata at hard limits', () => {
  const result = validateKafkaAdminRequest({
    resourceKind: 'topic',
    action: 'create',
    context: {
      tenantId: 'ten_01growthalpha',
      workspaceId: 'wrk_01alphadev',
      workspaceSlug: 'alpha-dev',
      workspaceEnvironment: 'dev',
      planId: 'pln_01growth',
      currentTopicCount: 20
    },
    payload: {
      topicName: 'billing-events'
    }
  });

  assert.equal(result.quotaDecision.errorCode, 'QUOTA_HARD_LIMIT_REACHED');
  assert.equal(result.quotaDecision.dimensionId, 'kafka_topics');
  assert.equal(result.quotaDecision.scopeType, 'workspace');
});
