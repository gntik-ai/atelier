import { mapAdapterQuotaDecisionToEnforcementDecision } from '../../../apps/control-plane/src/observability-admin.mjs';
import { getContract, resolveWorkspaceEffectiveCapabilities } from '../../internal-contracts/src/index.mjs';

const kafkaAdminRequestContract = getContract('kafka_admin_request');
const kafkaAdminResultContract = getContract('kafka_admin_result');
const kafkaInventorySnapshotContract = getContract('kafka_inventory_snapshot');
const kafkaAdminEventContract = getContract('kafka_admin_event');

export const KAFKA_ADMIN_RESOURCE_KINDS = Object.freeze(['topic', 'topic_acl']);
export const KAFKA_ADMIN_CAPABILITY_MATRIX = Object.freeze({
  topic: Object.freeze(['list', 'get', 'create', 'update', 'delete']),
  topic_acl: Object.freeze(['get', 'update'])
});
export const KAFKA_ADMIN_ALLOWED_ACL_OPERATIONS = Object.freeze([
  'read',
  'write',
  'describe',
  'describe_configs',
  'idempotent_write'
]);
export const KAFKA_ADMIN_ALLOWED_PATTERN_TYPES = Object.freeze(['literal', 'prefixed']);
export const KAFKA_ADMIN_ALLOWED_ISOLATION_MODES = Object.freeze(['shared_cluster', 'dedicated_cluster']);
export const KAFKA_ADMIN_ALLOWED_AUDIT_MODES = Object.freeze(['metadata_only', 'headers_and_denials']);
export const SUPPORTED_KAFKA_VERSION_RANGES = Object.freeze([
  Object.freeze({
    range: '3.6.x',
    label: 'Apache Kafka 3.6 KRaft baseline',
    brokerMode: 'kraft',
    adminApiStability: 'stable',
    isolationModes: ['shared_cluster', 'dedicated_cluster']
  }),
  Object.freeze({
    range: '3.7.x',
    label: 'Apache Kafka 3.7 KRaft recommended',
    brokerMode: 'kraft',
    adminApiStability: 'stable',
    isolationModes: ['shared_cluster', 'dedicated_cluster']
  }),
  Object.freeze({
    range: '3.8.x',
    label: 'Apache Kafka 3.8 KRaft current target',
    brokerMode: 'kraft',
    adminApiStability: 'stable',
    isolationModes: ['shared_cluster', 'dedicated_cluster']
  })
]);
export const KAFKA_ADMIN_MINIMUM_ENGINE_POLICY = Object.freeze({
  shared_cluster: Object.freeze({
    brokerMode: 'kraft',
    metadataQuorum: 'kraft_controller_quorum',
    executionIdentity: 'workspace_scoped_service_account',
    quotaEnforcement: 'workspace_hard_stop',
    aclIsolation: 'prefixed_by_workspace',
    requireTieredAuditing: true,
    forbiddenLegacyModes: ['zookeeper'],
    evidence: ['naming_policy', 'acl_bindings', 'quota_status', 'audit_summary'],
    maximumCredentialLifetimeHours: 168
  }),
  dedicated_cluster: Object.freeze({
    brokerMode: 'kraft',
    metadataQuorum: 'kraft_controller_quorum',
    executionIdentity: 'workspace_scoped_service_account',
    quotaEnforcement: 'tenant_and_workspace_hard_stop',
    aclIsolation: 'literal_topics_and_prefixed_consumer_groups',
    requireTieredAuditing: true,
    forbiddenLegacyModes: ['zookeeper'],
    evidence: ['naming_policy', 'acl_bindings', 'quota_status', 'audit_summary', 'kraft_guidance'],
    maximumCredentialLifetimeHours: 336
  })
});

const QUOTA_DEFAULTS = Object.freeze({
  starter: Object.freeze({
    maxTopicsPerWorkspace: 0,
    maxPartitionsPerTopic: 0,
    maxPublishesPerSecond: 0,
    maxConcurrentSubscriptions: 0
  }),
  growth: Object.freeze({
    maxTopicsPerWorkspace: 20,
    maxPartitionsPerTopic: 12,
    maxPublishesPerSecond: 800,
    maxConcurrentSubscriptions: 600
  }),
  enterprise: Object.freeze({
    maxTopicsPerWorkspace: 200,
    maxPartitionsPerTopic: 64,
    maxPublishesPerSecond: 5000,
    maxConcurrentSubscriptions: 4000
  })
});

const ERROR_CODE_MAP = new Map([
  ['validation_error', { status: 400, code: 'EVT_KAFKA_VALIDATION_FAILED', retryable: false }],
  ['conflict', { status: 409, code: 'EVT_KAFKA_CONFLICT', retryable: false }],
  ['not_found', { status: 404, code: 'EVT_KAFKA_NOT_FOUND', retryable: false }],
  ['quota_exceeded', { status: 429, code: 'EVT_KAFKA_QUOTA_EXCEEDED', retryable: false }],
  ['unsupported_provider_version', { status: 400, code: 'EVT_KAFKA_UNSUPPORTED_PROVIDER_VERSION', retryable: false }],
  ['unsupported_profile', { status: 400, code: 'EVT_KAFKA_UNSUPPORTED_PROFILE', retryable: false }],
  ['rate_limited', { status: 429, code: 'EVT_KAFKA_RATE_LIMITED', retryable: true }],
  ['timeout', { status: 504, code: 'EVT_KAFKA_TIMEOUT', retryable: true }],
  ['dependency_failure', { status: 502, code: 'EVT_KAFKA_DEPENDENCY_FAILURE', retryable: true }]
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

function normalizeObjectKeys(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeObjectKeys(entry));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, normalizeObjectKeys(entry)]));
}

function slugify(input, prefix = 'topic') {
  const normalized = String(input ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || prefix;
}

function normalizeTopicSegment(input, prefix = 'topic') {
  return slugify(input, prefix).replace(/-/g, '.');
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

function deriveEnvironment(workspaceEnvironment) {
  return ['dev', 'sandbox', 'staging', 'prod'].includes(workspaceEnvironment) ? workspaceEnvironment : 'dev';
}

function buildTopicPrefix({ tenantId, workspaceId, tenantSlug, workspaceSlug, workspaceEnvironment }) {
  const tenantSegment = normalizeTopicSegment(tenantSlug ?? tenantId?.replace(/^ten_/, ''), 'tenant');
  const workspaceSegment = normalizeTopicSegment(workspaceSlug ?? workspaceId?.replace(/^wrk_/, ''), 'workspace');
  const environmentSegment = normalizeTopicSegment(workspaceEnvironment, 'env');

  return `ia.${tenantSegment}.${workspaceSegment}.${environmentSegment}`;
}

function buildConsumerGroupPrefix(topicPrefix) {
  return `cg.${topicPrefix}`;
}

function buildServiceAccountPrincipalPrefix({ workspaceId, workspaceSlug }) {
  const workspaceSegment = slugify(workspaceSlug ?? workspaceId?.replace(/^wrk_/, ''), 'workspace').replace(/-/g, '_');
  return `User:svc_${workspaceSegment}_`;
}

function buildPhysicalTopicName(topicName, namingPolicy) {
  return `${namingPolicy.topicPrefix}.${normalizeTopicSegment(topicName, 'topic')}.v1`;
}

function buildTopicResourceName(resourceId, payload, namingPolicy) {
  return payload.physicalTopicName ?? buildPhysicalTopicName(payload.topicName ?? resourceId, namingPolicy);
}

function getQuotaMetric(resolution, metricKey) {
  return (resolution?.quotaResolution ?? resolution?.quotas ?? []).find((quota) => quota.metricKey === metricKey);
}

function getQuotaGuardrails(planTier, resolution, payload = {}) {
  const defaults = QUOTA_DEFAULTS[planTier] ?? QUOTA_DEFAULTS.starter;
  const topicQuota = getQuotaMetric(resolution, 'workspace.kafka_topics.max');

  return {
    metricKey: 'workspace.kafka_topics.max',
    maxTopicsPerWorkspace: topicQuota?.limit ?? defaults.maxTopicsPerWorkspace,
    usedTopics: topicQuota?.used ?? payload.currentTopicCount ?? 0,
    remainingTopics:
      typeof (topicQuota?.limit ?? defaults.maxTopicsPerWorkspace) === 'number'
        ? Math.max((topicQuota?.limit ?? defaults.maxTopicsPerWorkspace) - (topicQuota?.used ?? payload.currentTopicCount ?? 0), 0)
        : 0,
    maxPartitionsPerTopic: payload.maxPartitionsPerTopic ?? defaults.maxPartitionsPerTopic,
    maxPublishesPerSecond: payload.maxPublishesPerSecond ?? defaults.maxPublishesPerSecond,
    maxConcurrentSubscriptions: payload.maxConcurrentSubscriptions ?? defaults.maxConcurrentSubscriptions
  };
}

function buildTenantIsolation(profile, aclBindings = []) {
  const workspacePrincipals = aclBindings.filter((binding) => String(binding.principal ?? '').startsWith(profile.namingPolicy.serviceAccountPrincipalPrefix));

  return {
    mode: profile.isolationMode,
    aclPatternType: profile.isolationMode === 'dedicated_cluster' ? 'literal' : 'prefixed',
    topicPrefix: profile.namingPolicy.topicPrefix,
    consumerGroupPrefix: profile.namingPolicy.consumerGroupPrefix,
    workspacePrincipalPrefix: profile.namingPolicy.serviceAccountPrincipalPrefix,
    crossTenantAccessPrevented: true,
    workspacePrincipalCount: workspacePrincipals.length
  };
}

function normalizeAclBinding(binding = {}, profile, topicResourceName) {
  const operations = Array.from(
    new Set(
      (binding.operations ?? []).map((operation) => String(operation).toLowerCase()).filter(Boolean)
    )
  );
  const principal = String(binding.principal ?? '').trim();
  const serviceAccountId = binding.serviceAccountId ? String(binding.serviceAccountId) : undefined;
  const patternType = binding.patternType ?? (profile.isolationMode === 'shared_cluster' ? 'prefixed' : 'literal');

  return compactDefined({
    principal,
    serviceAccountId,
    operations,
    resourceType: 'topic',
    resourceName: binding.resourceName ?? topicResourceName,
    patternType,
    permission: binding.permission ?? 'allow',
    consumerGroupPrefix: binding.consumerGroupPrefix ?? profile.namingPolicy.consumerGroupPrefix,
    workspaceScoped: principal.startsWith(profile.namingPolicy.serviceAccountPrincipalPrefix)
  });
}

function buildAclSummary(aclBindings = []) {
  return {
    bindingCount: aclBindings.length,
    principalCount: new Set(aclBindings.map((binding) => binding.principal)).size,
    serviceAccountCount: new Set(aclBindings.map((binding) => binding.serviceAccountId).filter(Boolean)).size,
    patternTypes: Array.from(new Set(aclBindings.map((binding) => binding.patternType))).sort()
  };
}

export function isKafkaVersionSupported(providerVersion) {
  if (!providerVersion) {
    return true;
  }

  return SUPPORTED_KAFKA_VERSION_RANGES.some(({ range }) => {
    const prefix = range.replace(/\.x$/, '');
    return String(providerVersion).startsWith(prefix);
  });
}

export function resolveKafkaAdminProfile(context = {}) {
  const workspaceEnvironment = deriveEnvironment(context.workspaceEnvironment);
  const planTier = derivePlanTier(context.planId);
  const resolution = resolveWorkspaceEffectiveCapabilities({
    tenantId: context.tenantId ?? null,
    workspaceId: context.workspaceId,
    workspaceEnvironment,
    planId: context.planId,
    resolvedAt: context.resolvedAt ?? '2026-03-25T00:00:00Z'
  });
  const resolvedTopicCapability = (resolution.capabilities ?? []).some(
    (capability) => capability.capabilityKey === 'data.kafka.topics'
  );
  const resolvedTopicQuota = getQuotaMetric(resolution, 'workspace.kafka_topics.max');
  const topicCapabilityEnabled = resolvedTopicCapability || (resolvedTopicQuota?.limit ?? 0) > 0;
  const isolationMode = KAFKA_ADMIN_ALLOWED_ISOLATION_MODES.includes(context.isolationMode)
    ? context.isolationMode
    : planTier === 'enterprise'
      ? 'dedicated_cluster'
      : 'shared_cluster';
  const namingPolicy = {
    topicPrefix: buildTopicPrefix({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      tenantSlug: context.tenantSlug,
      workspaceSlug: context.workspaceSlug,
      workspaceEnvironment
    }),
    consumerGroupPrefix: '',
    serviceAccountPrincipalPrefix: buildServiceAccountPrincipalPrefix({
      workspaceId: context.workspaceId,
      workspaceSlug: context.workspaceSlug
    }),
    physicalTopicPattern: 'ia.<tenant>.<workspace>.<environment>.<topic>.v1',
    maxTopicNameLength: 249,
    topicNameGovernance: 'provider_generated',
    userProvidedPhysicalNamesAllowed: false
  };
  namingPolicy.consumerGroupPrefix = buildConsumerGroupPrefix(namingPolicy.topicPrefix);
  const quotaGuardrails = getQuotaGuardrails(planTier, resolution, context);
  const minimumEnginePolicy = KAFKA_ADMIN_MINIMUM_ENGINE_POLICY[isolationMode];

  return {
    provider: 'kafka',
    planId: context.planId,
    planTier,
    workspaceEnvironment,
    brokerMode: context.brokerMode ?? 'kraft',
    providerVersion: context.providerVersion,
    deploymentProfileId: context.deploymentProfileId ?? `dp_kafka_${isolationMode}`,
    isolationMode,
    topicCapabilityEnabled,
    namingPolicy,
    quotaGuardrails,
    minimumEnginePolicy,
    topicMutationsSupported: topicCapabilityEnabled,
    aclMutationsSupported: topicCapabilityEnabled,
    inventorySupported: topicCapabilityEnabled,
    supportedVersions: SUPPORTED_KAFKA_VERSION_RANGES,
    auditCoverage: {
      capturesActorContext: true,
      capturesAclBindings: true,
      capturesQuotaVisibility: true,
      capturesKRaftGuidance: true,
      capturesServiceAccountBindings: true
    }
  };
}

function collectBaseViolations(resourceKind, action, context, profile) {
  const violations = [];

  if (!KAFKA_ADMIN_RESOURCE_KINDS.includes(resourceKind)) {
    violations.push(`Unsupported Kafka admin resource kind ${resourceKind}.`);
  }

  if (!(KAFKA_ADMIN_CAPABILITY_MATRIX[resourceKind] ?? []).includes(action)) {
    violations.push(`Kafka admin action ${action} is not supported for resource kind ${resourceKind}.`);
  }

  if (!profile.topicCapabilityEnabled) {
    violations.push(`Plan ${profile.planId} does not advertise data.kafka.topics for workspace environment ${profile.workspaceEnvironment}.`);
  }

  if (profile.brokerMode !== 'kraft') {
    violations.push('Kafka admin operations require KRaft mode; ZooKeeper-backed governance is not supported.');
  }

  if (context.providerVersion && !isKafkaVersionSupported(context.providerVersion)) {
    violations.push(`Kafka provider version ${context.providerVersion} is outside the supported KRaft compatibility matrix.`);
  }

  return violations;
}

function validateTopicRequest(action, payload, context, profile) {
  const violations = [];
  const topicName = String(payload.topicName ?? '').trim();
  const partitionCount = payload.partitionCount ?? payload.partitions ?? 3;
  const topicResourceName = buildTopicResourceName(context.resourceId ?? topicName, payload, profile.namingPolicy);
  const quota = profile.quotaGuardrails;
  const aclBindings = (payload.aclBindings ?? []).map((binding) => normalizeAclBinding(binding, profile, topicResourceName));

  if (!topicName && action !== 'list') {
    violations.push('topicName is required for Kafka topic administration.');
  }

  if (topicName && !/^[a-z0-9][a-z0-9._-]{2,119}$/.test(topicName)) {
    violations.push('topicName must start with a lowercase letter or digit and use lowercase letters, digits, dot, underscore, or hyphen.');
  }

  if (topicName && topicName.startsWith(`${profile.namingPolicy.topicPrefix}.`)) {
    violations.push('topicName must be a logical name only; physical Kafka prefixes are generated by the control plane.');
  }

  if (payload.physicalTopicName && payload.physicalTopicName !== topicResourceName) {
    violations.push(`physicalTopicName must match the managed naming policy (${topicResourceName}).`);
  }

  if (!Number.isInteger(partitionCount) || partitionCount < 1) {
    violations.push('partitionCount must be a positive integer.');
  }

  if (partitionCount > quota.maxPartitionsPerTopic) {
    violations.push(`partitionCount ${partitionCount} exceeds the workspace guardrail ${quota.maxPartitionsPerTopic}.`);
  }

  if (action === 'create' && quota.usedTopics >= quota.maxTopicsPerWorkspace) {
    violations.push(`Quota ${quota.metricKey} would be exceeded by creating another topic.`);
  }

  if (payload.auditMode && !KAFKA_ADMIN_ALLOWED_AUDIT_MODES.includes(payload.auditMode)) {
    violations.push(`auditMode ${payload.auditMode} is unsupported; allowed values: ${KAFKA_ADMIN_ALLOWED_AUDIT_MODES.join(', ')}.`);
  }

  if (payload.maxPublishesPerSecond && payload.maxPublishesPerSecond > quota.maxPublishesPerSecond) {
    violations.push(`maxPublishesPerSecond ${payload.maxPublishesPerSecond} exceeds workspace guardrail ${quota.maxPublishesPerSecond}.`);
  }

  if (payload.maxConcurrentSubscriptions && payload.maxConcurrentSubscriptions > quota.maxConcurrentSubscriptions) {
    violations.push(
      `maxConcurrentSubscriptions ${payload.maxConcurrentSubscriptions} exceeds workspace guardrail ${quota.maxConcurrentSubscriptions}.`
    );
  }

  const uniquePrincipals = new Set();
  for (const binding of aclBindings) {
    if (!binding.principal) {
      violations.push('aclBindings must declare principal for each entry.');
      continue;
    }

    if (!binding.principal.startsWith(profile.namingPolicy.serviceAccountPrincipalPrefix)) {
      violations.push(`ACL principal ${binding.principal} must stay inside workspace prefix ${profile.namingPolicy.serviceAccountPrincipalPrefix}.`);
    }

    const unsupportedOperations = binding.operations.filter(
      (operation) => !KAFKA_ADMIN_ALLOWED_ACL_OPERATIONS.includes(operation)
    );
    if (unsupportedOperations.length > 0) {
      violations.push(`ACL principal ${binding.principal} requested unsupported operations: ${unsupportedOperations.join(', ')}.`);
    }

    if (!KAFKA_ADMIN_ALLOWED_PATTERN_TYPES.includes(binding.patternType)) {
      violations.push(`ACL principal ${binding.principal} uses unsupported patternType ${binding.patternType}.`);
    }

    if (binding.patternType === 'literal' && binding.resourceName !== topicResourceName) {
      violations.push(`Literal ACL bindings must target managed topic ${topicResourceName}.`);
    }

    if (binding.patternType === 'prefixed' && !String(binding.resourceName ?? '').startsWith(profile.namingPolicy.topicPrefix)) {
      violations.push(`Prefixed ACL bindings must stay under topic prefix ${profile.namingPolicy.topicPrefix}.`);
    }

    const uniquenessKey = `${binding.principal}:${binding.resourceName}:${binding.operations.slice().sort().join('|')}`;
    if (uniquePrincipals.has(uniquenessKey)) {
      violations.push(`ACL binding ${uniquenessKey} is duplicated.`);
    }
    uniquePrincipals.add(uniquenessKey);
  }

  return violations;
}

function validateTopicAclRequest(action, payload, context, profile) {
  const violations = [];
  const topicName = String(payload.topicName ?? context.topicName ?? '').trim();
  const topicResourceName = buildTopicResourceName(context.resourceId ?? topicName, { ...payload, topicName }, profile.namingPolicy);

  if (!topicName) {
    violations.push('topicName is required for Kafka ACL administration.');
  }

  if (action === 'update' && !(payload.aclBindings ?? []).length) {
    violations.push('Kafka ACL updates must include at least one aclBindings entry.');
  }

  violations.push(
    ...validateTopicRequest('update', { ...payload, topicName, physicalTopicName: topicResourceName }, context, profile).filter(
      (entry) => entry.includes('ACL') || entry.includes('auditMode') || entry.includes('must stay inside workspace prefix')
    )
  );

  return violations;
}

export function validateKafkaAdminRequest({ resourceKind, action, context = {}, payload = {} }) {
  const resolvedContext = { ...context, tenantId: context.tenantId ?? payload.tenantId, workspaceId: context.workspaceId ?? payload.workspaceId };
  const profile = resolveKafkaAdminProfile(resolvedContext);
  const violations = collectBaseViolations(resourceKind, action, context, profile);

  if (resourceKind === 'topic') {
    violations.push(...validateTopicRequest(action, payload, context, profile));
  }

  if (resourceKind === 'topic_acl') {
    violations.push(...validateTopicAclRequest(action, payload, context, profile));
  }

  const quotaDecision = resourceKind === 'topic' && action === 'create' && Number(profile.quotaGuardrails.usedTopics) >= Number(profile.quotaGuardrails.maxTopicsPerWorkspace)
    ? mapAdapterQuotaDecisionToEnforcementDecision({
        allowed: false,
        dimensionId: 'kafka_topics',
        scopeType: 'workspace',
        scopeId: resolvedContext.workspaceId ?? resolvedContext.tenantId ?? 'unknown-scope',
        tenantId: resolvedContext.tenantId ?? null,
        workspaceId: resolvedContext.workspaceId ?? null,
        currentUsage: Number(profile.quotaGuardrails.usedTopics),
        hardLimit: Number(profile.quotaGuardrails.maxTopicsPerWorkspace),
        blockingAction: 'create_topic',
        metricKey: profile.quotaGuardrails.metricKey,
        reasonCode: 'workspace_topic_quota_exceeded',
        resourceKind: 'topic',
        surfaceId: 'events.topic.create'
      })
    : null;

  return {
    ok: violations.length === 0,
    violations,
    ...(quotaDecision ? { quotaDecision } : {}),
    profile
  };
}

export function normalizeKafkaAdminResource(resourceKind, payload = {}, context = {}) {
  const profile = resolveKafkaAdminProfile({ ...context, tenantId: context.tenantId ?? payload.tenantId, workspaceId: context.workspaceId ?? payload.workspaceId });
  const topicName = payload.topicName ?? context.topicName ?? 'topic';
  const physicalTopicName = buildTopicResourceName(context.resourceId ?? topicName, { ...payload, topicName }, profile.namingPolicy);
  const aclBindings = (payload.aclBindings ?? []).map((binding) => normalizeAclBinding(binding, profile, physicalTopicName));
  const quotaStatus = {
    metricKey: profile.quotaGuardrails.metricKey,
    limit: profile.quotaGuardrails.maxTopicsPerWorkspace,
    used: profile.quotaGuardrails.usedTopics,
    remaining: profile.quotaGuardrails.remainingTopics,
    enforcementMode: 'hard_stop',
    maxPartitionsPerTopic: profile.quotaGuardrails.maxPartitionsPerTopic,
    maxPublishesPerSecond: profile.quotaGuardrails.maxPublishesPerSecond,
    maxConcurrentSubscriptions: profile.quotaGuardrails.maxConcurrentSubscriptions,
    visibleInConsole: true
  };
  const providerCompatibility = {
    provider: 'kafka',
    brokerMode: profile.brokerMode,
    metadataQuorum: profile.minimumEnginePolicy.metadataQuorum,
    supportedVersions: profile.supportedVersions.map(({ range, label }) => ({ range, label })),
    minimumEnginePolicy: profile.minimumEnginePolicy
  };

  if (resourceKind === 'topic') {
    return {
      resourceType: 'event_topic',
      resourceId: context.resourceId,
      tenantId: context.tenantId ?? payload.tenantId,
      workspaceId: context.workspaceId ?? payload.workspaceId,
      topicName,
      physicalTopicName,
      channelPrefix: payload.channelPrefix ?? profile.namingPolicy.topicPrefix,
      deliverySemantics: payload.deliverySemantics ?? 'at_least_once',
      partitionStrategy: payload.partitionStrategy ?? 'tenant_workspace_key',
      partitionCount: payload.partitionCount ?? payload.partitions ?? 3,
      replicationFactor: payload.replicationFactor ?? 3,
      retentionHours: payload.retentionHours ?? 168,
      replayWindowHours: payload.replayWindowHours ?? 24,
      cleanupPolicy: payload.cleanupPolicy ?? 'delete',
      allowedTransports: payload.allowedTransports ?? ['http_publish', 'sse', 'websocket'],
      maxPublishesPerSecond: payload.maxPublishesPerSecond ?? profile.quotaGuardrails.maxPublishesPerSecond,
      maxConcurrentSubscriptions:
        payload.maxConcurrentSubscriptions ?? profile.quotaGuardrails.maxConcurrentSubscriptions,
      auditMode: payload.auditMode ?? 'headers_and_denials',
      namingPolicy: profile.namingPolicy,
      tenantIsolation: buildTenantIsolation(profile, aclBindings),
      aclBindings,
      quotaStatus,
      providerCompatibility,
      status: payload.status ?? 'provisioning'
    };
  }

  if (resourceKind === 'topic_acl') {
    return {
      resourceType: 'event_topic_acl',
      resourceId: context.resourceId,
      tenantId: context.tenantId ?? payload.tenantId,
      workspaceId: context.workspaceId ?? payload.workspaceId,
      topicName,
      physicalTopicName,
      aclBindings,
      tenantIsolation: buildTenantIsolation(profile, aclBindings),
      quotaStatus,
      providerCompatibility,
      auditMode: payload.auditMode ?? 'headers_and_denials'
    };
  }

  throw new Error(`Unsupported Kafka admin resource kind ${resourceKind}.`);
}

function buildCapabilityName(resourceKind, action) {
  return `kafka_${resourceKind}_${action}`;
}

function deriveTargetRef(resourceKind, payload = {}, context = {}, profile) {
  const topicName = payload.topicName ?? context.topicName ?? context.resourceId ?? 'topic';
  const physicalTopicName = buildTopicResourceName(context.resourceId ?? topicName, { ...payload, topicName }, profile.namingPolicy);

  if (resourceKind === 'topic') {
    return `topic:${physicalTopicName}`;
  }

  if (resourceKind === 'topic_acl') {
    return `topic_acl:${physicalTopicName}`;
  }

  return `kafka:${resourceKind}`;
}

function buildKafkaAdminCorrelationContext({ callId, correlationId, authorizationDecisionId, idempotencyKey }) {
  return compactDefined({
    callId,
    correlationId,
    authorizationDecisionId,
    idempotencyKey
  });
}

function buildKafkaAdminAuditSummary({ resourceKind, action, profile, aclBindings, tenantId, workspaceId }) {
  return {
    provider: 'kafka',
    resourceKind,
    action,
    tenantId,
    workspaceId,
    brokerMode: profile.brokerMode,
    capturesActorContext: true,
    capturesQuotaVisibility: true,
    capturesAclBindings: aclBindings.length > 0,
    capturesKRaftGuidance: true,
    isolationMode: profile.isolationMode
  };
}

function buildKafkaAdminEvent({
  resourceKind,
  action,
  targetRef,
  tenantId,
  workspaceId,
  callId,
  correlationId,
  authorizationDecisionId,
  idempotencyKey,
  requestedAt,
  actorId,
  actorType,
  originSurface,
  aclBindings,
  profile
}) {
  return {
    eventId: callId,
    eventType: 'kafka.admin.reconciled',
    action,
    resourceKind,
    tenantId,
    workspaceId,
    targetRef,
    auditRecordId: `aud_${String(callId ?? '').replace(/[^0-9a-z]/gi, '').toLowerCase().slice(-16) || 'evt01'}`,
    correlationId,
    correlationContext: buildKafkaAdminCorrelationContext({ callId, correlationId, authorizationDecisionId, idempotencyKey }),
    partitionKey: `${tenantId}:${workspaceId}`,
    contractVersion: kafkaAdminEventContract?.version ?? '2026-03-25',
    occurredAt: requestedAt,
    actorId,
    actorType,
    originSurface,
    aclSummary: buildAclSummary(aclBindings),
    brokerMode: profile.brokerMode,
    namingPolicy: profile.namingPolicy,
    quotaStatus: {
      limit: profile.quotaGuardrails.maxTopicsPerWorkspace,
      used: profile.quotaGuardrails.usedTopics,
      remaining: profile.quotaGuardrails.remainingTopics
    }
  };
}

export function buildKafkaAdminAdapterCall({
  resourceKind,
  action,
  callId,
  tenantId,
  workspaceId,
  planId,
  correlationId,
  authorizationDecisionId,
  idempotencyKey,
  targetRef,
  context = {},
  payload = {},
  scopes = [],
  effectiveRoles = [],
  actorId,
  actorType,
  originSurface,
  requestedAt = '2026-03-25T00:00:00Z'
}) {
  const validation = validateKafkaAdminRequest({ resourceKind, action, context, payload });
  if (!validation.ok) {
    return {
      ok: false,
      violations: validation.violations,
      profile: validation.profile
    };
  }

  const normalizedResource = normalizeKafkaAdminResource(resourceKind, payload, {
    ...context,
    resourceId: context.resourceId,
    tenantId: context.tenantId ?? tenantId,
    workspaceId: context.workspaceId ?? workspaceId
  });
  const aclBindings = normalizedResource.aclBindings ?? [];
  const auditSummary = buildKafkaAdminAuditSummary({
    resourceKind,
    action,
    profile: validation.profile,
    aclBindings,
    tenantId,
    workspaceId
  });
  const correlationContext = buildKafkaAdminCorrelationContext({
    callId,
    correlationId,
    authorizationDecisionId,
    idempotencyKey
  });
  const resolvedTargetRef = targetRef ?? deriveTargetRef(resourceKind, payload, context, validation.profile);
  const adminEvent = buildKafkaAdminEvent({
    resourceKind,
    action,
    targetRef: resolvedTargetRef,
    tenantId,
    workspaceId,
    callId,
    correlationId,
    authorizationDecisionId,
    idempotencyKey,
    requestedAt,
    actorId,
    actorType,
    originSurface,
    aclBindings,
    profile: validation.profile
  });

  return {
    adapter_id: 'kafka',
    contract_version: kafkaAdminRequestContract?.version ?? '2026-03-25',
    call_id: callId,
    capability: buildCapabilityName(resourceKind, action),
    tenant_id: tenantId,
    workspace_id: workspaceId,
    plan_id: planId ?? validation.profile.planId,
    deployment_profile_id: validation.profile.deploymentProfileId,
    correlation_id: correlationId,
    authorization_decision_id: authorizationDecisionId,
    idempotency_key: idempotencyKey,
    requested_at: requestedAt,
    target_ref: resolvedTargetRef,
    actor_id: actorId,
    actor_type: actorType,
    origin_surface: originSurface,
    target_tenant_id: context.targetTenantId ?? tenantId,
    target_workspace_id: context.targetWorkspaceId ?? workspaceId,
    scopes,
    effective_roles: effectiveRoles,
    provider_version: context.providerVersion,
    payload: {
      resourceKind,
      action,
      requestedResource: normalizeObjectKeys(payload),
      normalizedResource,
      auditSummary,
      correlationContext,
      adminEvent,
      quotaStatus: normalizedResource.quotaStatus,
      tenantIsolation: normalizedResource.tenantIsolation,
      context: compactDefined({
        scope: context.scope ?? 'workspace',
        topicName: payload.topicName ?? context.topicName,
        physicalTopicName: normalizedResource.physicalTopicName,
        brokerMode: validation.profile.brokerMode,
        isolationMode: validation.profile.isolationMode,
        providerVersion: context.providerVersion
      })
    }
  };
}

export function buildKafkaAdminMetadataRecord({
  resourceKind,
  action,
  resource,
  auditSummary,
  correlationContext,
  adminEvent,
  tenantId,
  workspaceId,
  observedAt = '2026-03-25T00:00:00Z'
} = {}) {
  return {
    resourceKind,
    tenantId,
    workspaceId,
    observedAt,
    metadata: compactDefined({
      primaryRef: resource?.physicalTopicName ?? resource?.topicName,
      action,
      provider: resource?.providerCompatibility?.provider ?? 'kafka',
      isolationMode: resource?.tenantIsolation?.mode,
      aclBindingCount: resource?.aclBindings?.length ?? 0,
      brokerMode: resource?.providerCompatibility?.brokerMode ?? 'kraft'
    }),
    resource,
    auditSummary,
    correlationContext,
    adminEvent
  };
}

export function buildKafkaAdminInventorySnapshot({
  snapshotId,
  tenantId,
  workspaceId,
  planId,
  context = {},
  topics = [],
  aclBindings = [],
  serviceAccounts = [],
  observedAt = '2026-03-25T00:00:00Z'
}) {
  const profile = resolveKafkaAdminProfile({ ...context, tenantId, workspaceId, planId });

  return {
    snapshotId,
    tenantId,
    workspaceId,
    isolationMode: profile.isolationMode,
    brokerMode: profile.brokerMode,
    counts: {
      topics: topics.length,
      aclBindings: aclBindings.length,
      serviceAccounts: serviceAccounts.length
    },
    quotas: profile.quotaGuardrails,
    namingPolicy: profile.namingPolicy,
    minimumEnginePolicy: profile.minimumEnginePolicy,
    observedAt,
    contractVersion: kafkaInventorySnapshotContract?.version ?? '2026-03-25',
    tenantIsolation: buildTenantIsolation(profile, aclBindings),
    limitVisibility: {
      visibleInConsole: true,
      metricKey: profile.quotaGuardrails.metricKey,
      maxTopicsPerWorkspace: profile.quotaGuardrails.maxTopicsPerWorkspace,
      remainingTopics: profile.quotaGuardrails.remainingTopics,
      maxPartitionsPerTopic: profile.quotaGuardrails.maxPartitionsPerTopic
    },
    auditCoverage: profile.auditCoverage,
    topicRefs: topics.map((topic) => topic.physicalTopicName ?? topic.topicName ?? topic),
    aclRefs: aclBindings.map((binding) => ({
      principal: binding.principal,
      resourceName: binding.resourceName,
      operations: binding.operations
    })),
    serviceAccountRefs: serviceAccounts.map((account) => account.serviceAccountId ?? account)
  };
}

export function normalizeKafkaAdminError(error = {}, context = {}) {
  const classification =
    error.classification ??
    (error.status === 404 ? 'not_found' : undefined) ??
    (error.status === 409 ? 'conflict' : undefined) ??
    (error.status === 429 ? 'quota_exceeded' : undefined) ??
    (error.status === 504 ? 'timeout' : undefined) ??
    'dependency_failure';

  const mapped = ERROR_CODE_MAP.get(classification) ?? ERROR_CODE_MAP.get('dependency_failure');

  return {
    status: error.status ?? mapped.status,
    code: mapped.code,
    title: error.title ?? 'Kafka administrative operation failed.',
    detail: {
      resourceKind: context.resourceKind,
      action: context.action,
      targetRef: context.targetRef,
      topicName: context.topicName,
      providerError: error.providerError,
      classification
    },
    retryable: error.retryable ?? mapped.retryable === true,
    providerError: error.providerError,
    message: error.message ?? 'Kafka administrative operation failed.'
  };
}

export const kafkaAdminContracts = Object.freeze({
  request: kafkaAdminRequestContract,
  result: kafkaAdminResultContract,
  inventory: kafkaInventorySnapshotContract,
  event: kafkaAdminEventContract
});

// ── T02 provisional workflow helpers (guarded stubs) ─────────────────────────

export async function createTopicNamespace() {
  const error = new Error('NOT_YET_IMPLEMENTED: createTopicNamespace');
  error.code = 'NOT_YET_IMPLEMENTED';
  throw error;
}
