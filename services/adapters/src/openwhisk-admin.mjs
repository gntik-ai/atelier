import { getContract, resolveWorkspaceEffectiveCapabilities } from '../../internal-contracts/src/index.mjs';

const functionAdminRequestContract = getContract('function_admin_request');
const functionAdminResultContract = getContract('function_admin_result');
const functionInventorySnapshotContract = getContract('function_inventory_snapshot');

export const OPENWHISK_ADMIN_RESOURCE_KINDS = Object.freeze(['action', 'package', 'trigger', 'rule']);
export const OPENWHISK_ADMIN_CAPABILITY_MATRIX = Object.freeze({
  action: Object.freeze(['list', 'get', 'create', 'update', 'delete', 'invoke']),
  package: Object.freeze(['list', 'get', 'create', 'update', 'delete']),
  trigger: Object.freeze(['list', 'get', 'create', 'update', 'delete']),
  rule: Object.freeze(['list', 'get', 'create', 'update', 'delete'])
});
export const OPENWHISK_ACTION_SOURCE_KINDS = Object.freeze(['inline_code', 'packaged_artifact', 'stored_reference', 'runtime_image']);
export const OPENWHISK_SUPPORTED_TRIGGER_KINDS = Object.freeze(['http', 'kafka', 'storage', 'cron']);
export const OPENWHISK_SUPPORTED_ACTION_RUNTIMES = Object.freeze([
  Object.freeze({ runtime: 'nodejs:20', sourceKinds: ['inline_code', 'packaged_artifact', 'stored_reference'], webActionSupported: true }),
  Object.freeze({ runtime: 'python:3.11', sourceKinds: ['inline_code', 'packaged_artifact', 'stored_reference'], webActionSupported: true }),
  Object.freeze({ runtime: 'php:8.2', sourceKinds: ['inline_code', 'packaged_artifact', 'stored_reference'], webActionSupported: true }),
  Object.freeze({ runtime: 'go:1.22', sourceKinds: ['packaged_artifact', 'stored_reference'], webActionSupported: false }),
  Object.freeze({ runtime: 'java:21', sourceKinds: ['packaged_artifact', 'stored_reference'], webActionSupported: false }),
  Object.freeze({ runtime: 'container:image', sourceKinds: ['runtime_image'], webActionSupported: true })
]);
export const OPENWHISK_ALLOWED_TRIGGER_SOURCE_TYPES = Object.freeze(['manual', 'event_topic', 'cron', 'http']);
export const OPENWHISK_ALLOWED_PACKAGE_VISIBILITY = Object.freeze(['private', 'workspace_shared']);
export const OPENWHISK_ALLOWED_RULE_STATES = Object.freeze(['active', 'inactive']);
export const OPENWHISK_ALLOWED_HTTP_AUTH_MODES = Object.freeze(['workspace_token', 'signed_url', 'public_readonly']);
export const OPENWHISK_ALLOWED_HTTP_METHODS = Object.freeze(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
export const OPENWHISK_ALLOWED_STORAGE_EVENT_TYPES = Object.freeze(['object_created', 'object_deleted', 'object_archived', 'object_restored']);
export const OPENWHISK_ALLOWED_CRON_OVERLAP_POLICIES = Object.freeze(['allow', 'skip', 'queue_one']);
export const OPENWHISK_ALLOWED_ACTIVATION_STATUSES = Object.freeze(['running', 'succeeded', 'failed', 'timed_out', 'cancelled']);
export const OPENWHISK_FUNCTION_VERSION_STATUSES = Object.freeze(['active', 'historical', 'rollback_target', 'retired', 'invalid']);
export const OPENWHISK_FUNCTION_VERSION_ORIGINS = Object.freeze(['publish', 'rollback_restore']);
export const SUPPORTED_OPENWHISK_VERSION_RANGES = Object.freeze([
  Object.freeze({
    range: '2.0.x',
    label: 'Apache OpenWhisk 2.0 baseline',
    namespaceStrategy: 'logical_namespace_per_workspace',
    subjectProvisioning: 'internal_only',
    resourceSurface: ['action', 'package', 'trigger', 'rule', 'activation', 'http_exposure']
  }),
  Object.freeze({
    range: '2.1.x',
    label: 'Apache OpenWhisk 2.1 recommended',
    namespaceStrategy: 'logical_namespace_per_workspace',
    subjectProvisioning: 'internal_only',
    resourceSurface: ['action', 'package', 'trigger', 'rule', 'activation', 'http_exposure']
  })
]);
export const OPENWHISK_MINIMUM_ENGINE_POLICY = Object.freeze({
  logical_namespace_subject: Object.freeze({
    namespaceStrategy: 'logical_namespace_per_workspace',
    subjectProvisioning: 'internal_only',
    packageVisibility: 'private_by_default',
    packageBindingIsolation: 'workspace_prefix',
    nativeAdminCrudExposed: false,
    forbiddenUserFields: [
      'namespaceName',
      'subjectRef',
      'authKey',
      'apiHost',
      'physicalActionName',
      'physicalPackageName',
      'physicalTriggerName',
      'physicalRuleName',
      'apisixRouteRef'
    ],
    evidence: ['serverless_context', 'naming_policy', 'tenant_isolation', 'provisioning_state'],
    workspaceIsolationBoundary: 'namespace_plus_subject'
  })
});

const QUOTA_DEFAULTS = Object.freeze({
  starter: Object.freeze({
    maxActionsPerWorkspace: 0,
    maxPackagesPerWorkspace: 0,
    maxTriggersPerWorkspace: 0,
    maxRulesPerWorkspace: 0,
    maxHttpExposuresPerWorkspace: 0
  }),
  growth: Object.freeze({
    maxActionsPerWorkspace: 24,
    maxPackagesPerWorkspace: 12,
    maxTriggersPerWorkspace: 48,
    maxRulesPerWorkspace: 96,
    maxHttpExposuresPerWorkspace: 12
  }),
  enterprise: Object.freeze({
    maxActionsPerWorkspace: 240,
    maxPackagesPerWorkspace: 120,
    maxTriggersPerWorkspace: 480,
    maxRulesPerWorkspace: 960,
    maxHttpExposuresPerWorkspace: 120
  })
});

const ERROR_CODE_MAP = new Map([
  ['validation_error', { status: 400, code: 'FN_OW_VALIDATION_FAILED', retryable: false }],
  ['conflict', { status: 409, code: 'FN_OW_CONFLICT', retryable: false }],
  ['not_found', { status: 404, code: 'FN_OW_NOT_FOUND', retryable: false }],
  ['quota_exceeded', { status: 422, code: 'FN_OW_QUOTA_EXCEEDED', retryable: false }],
  ['unsupported_provider_version', { status: 400, code: 'FN_OW_UNSUPPORTED_PROVIDER_VERSION', retryable: false }],
  ['unsupported_profile', { status: 400, code: 'FN_OW_UNSUPPORTED_PROFILE', retryable: false }],
  ['rate_limited', { status: 429, code: 'FN_OW_RATE_LIMITED', retryable: true }],
  ['timeout', { status: 504, code: 'FN_OW_TIMEOUT', retryable: true }],
  ['dependency_failure', { status: 502, code: 'FN_OW_DEPENDENCY_FAILURE', retryable: true }]
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

function slugify(input, prefix = 'resource') {
  const normalized = String(input ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || prefix;
}

function trimSegment(value, maxLength = 63) {
  return String(value).slice(0, maxLength).replace(/-+$/g, '') || 'resource';
}

function normalizeLogicalName(input, prefix) {
  return trimSegment(slugify(input, prefix), 63);
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

function getQuotaMetric(resolution, metricKey) {
  return (resolution?.quotaResolution ?? resolution?.quotas ?? []).find((quota) => quota.metricKey === metricKey);
}

function getOpenWhiskQuotaGuardrails(planTier, resolution, context = {}) {
  const defaults = QUOTA_DEFAULTS[planTier] ?? QUOTA_DEFAULTS.starter;
  const actionQuota = getQuotaMetric(resolution, 'workspace.functions.actions.max');
  const packageQuota = getQuotaMetric(resolution, 'workspace.functions.packages.max');
  const triggerQuota = getQuotaMetric(resolution, 'workspace.functions.triggers.max');
  const ruleQuota = getQuotaMetric(resolution, 'workspace.functions.rules.max');
  const httpExposureQuota = getQuotaMetric(resolution, 'workspace.functions.http_exposures.max');

  const currentCounts = context.currentInventory?.counts ?? {};

  return {
    metricKeys: {
      actions: 'workspace.functions.actions.max',
      packages: 'workspace.functions.packages.max',
      triggers: 'workspace.functions.triggers.max',
      rules: 'workspace.functions.rules.max',
      httpExposures: 'workspace.functions.http_exposures.max'
    },
    maxActionsPerWorkspace: actionQuota?.limit ?? defaults.maxActionsPerWorkspace,
    maxPackagesPerWorkspace: packageQuota?.limit ?? defaults.maxPackagesPerWorkspace,
    maxTriggersPerWorkspace: triggerQuota?.limit ?? defaults.maxTriggersPerWorkspace,
    maxRulesPerWorkspace: ruleQuota?.limit ?? defaults.maxRulesPerWorkspace,
    maxHttpExposuresPerWorkspace: httpExposureQuota?.limit ?? defaults.maxHttpExposuresPerWorkspace,
    usedActions: actionQuota?.used ?? currentCounts.actions ?? context.currentActionCount ?? 0,
    usedPackages: packageQuota?.used ?? currentCounts.packages ?? context.currentPackageCount ?? 0,
    usedTriggers: triggerQuota?.used ?? currentCounts.triggers ?? context.currentTriggerCount ?? 0,
    usedRules: ruleQuota?.used ?? currentCounts.rules ?? context.currentRuleCount ?? 0,
    usedHttpExposures: httpExposureQuota?.used ?? currentCounts.httpExposures ?? context.currentHttpExposureCount ?? 0
  };
}

function buildNamingPolicy({ tenantId, workspaceId, tenantSlug, workspaceSlug, workspaceEnvironment }) {
  const tenantSegment = normalizeLogicalName(tenantSlug ?? tenantId?.replace(/^ten_/, ''), 'tenant');
  const workspaceSegment = normalizeLogicalName(workspaceSlug ?? workspaceId?.replace(/^wrk_/, ''), 'workspace');
  const environmentSegment = normalizeLogicalName(workspaceEnvironment, 'env');

  const namespaceSegments = ['ia', tenantSegment, workspaceSegment, environmentSegment].filter(Boolean);
  const namespaceName = trimSegment(namespaceSegments.join('-'), 80);
  const actionPrefix = trimSegment(`act-${workspaceSegment}-${environmentSegment}`, 48);
  const packagePrefix = trimSegment(`pkg-${workspaceSegment}-${environmentSegment}`, 48);
  const triggerPrefix = trimSegment(`trg-${workspaceSegment}-${environmentSegment}`, 48);
  const rulePrefix = trimSegment(`rul-${workspaceSegment}-${environmentSegment}`, 48);

  return {
    namespaceName,
    subjectRef: `ia:${tenantSegment}:${workspaceSegment}:${environmentSegment}`,
    actionPrefix,
    packagePrefix,
    triggerPrefix,
    rulePrefix,
    packageBindingRef: `pkgctx:${namespaceName}`,
    namespacePattern: 'ia-<tenant>-<workspace>-<environment>',
    subjectPattern: 'ia:<tenant>:<workspace>:<environment>',
    physicalNamePolicy: 'provider_generated',
    userManagedNamespacesAllowed: false,
    userManagedSubjectsAllowed: false,
    userProvidedPhysicalNamesAllowed: false
  };
}

function buildTenantIsolation(namingPolicy) {
  return {
    isolationBoundary: 'namespace_subject',
    namespaceName: namingPolicy.namespaceName,
    subjectRef: namingPolicy.subjectRef,
    crossTenantAccessPrevented: true,
    userManagedNativeAdminSupported: false,
    actionPrefixIsolation: namingPolicy.actionPrefix,
    packagePrefixIsolation: namingPolicy.packagePrefix,
    triggerPrefixIsolation: namingPolicy.triggerPrefix,
    rulePrefixIsolation: namingPolicy.rulePrefix
  };
}

export function buildOpenWhiskServerlessContext(context = {}) {
  const workspaceEnvironment = deriveEnvironment(context.workspaceEnvironment);
  const namingPolicy = buildNamingPolicy({
    tenantId: context.tenantId,
    workspaceId: context.workspaceId,
    tenantSlug: context.tenantSlug,
    workspaceSlug: context.workspaceSlug,
    workspaceEnvironment
  });

  return {
    tenantId: context.tenantId,
    workspaceId: context.workspaceId,
    provider: 'openwhisk',
    namespaceName: namingPolicy.namespaceName,
    subjectRef: namingPolicy.subjectRef,
    packageBindingRef: namingPolicy.packageBindingRef,
    actionPrefix: namingPolicy.actionPrefix,
    packagePrefix: namingPolicy.packagePrefix,
    triggerPrefix: namingPolicy.triggerPrefix,
    rulePrefix: namingPolicy.rulePrefix,
    namespaceProvisioning: {
      mode: 'internal_only',
      state: context.namespaceState ?? 'ready'
    },
    subjectProvisioning: {
      mode: 'internal_only',
      state: context.subjectState ?? 'ready'
    },
    namingPolicy: {
      namespacePattern: namingPolicy.namespacePattern,
      subjectPattern: namingPolicy.subjectPattern,
      actionPrefix: namingPolicy.actionPrefix,
      packagePrefix: namingPolicy.packagePrefix,
      triggerPrefix: namingPolicy.triggerPrefix,
      rulePrefix: namingPolicy.rulePrefix,
      physicalNamePolicy: namingPolicy.physicalNamePolicy,
      userManagedNamespacesAllowed: false,
      userManagedSubjectsAllowed: false,
      userProvidedPhysicalNamesAllowed: false
    },
    tenantIsolation: buildTenantIsolation(namingPolicy),
    status: 'ready'
  };
}

export function buildOpenWhiskActivationPolicy(input = {}) {
  return {
    logsAccess: input.logsAccess ?? 'workspace_developers',
    resultAccess: input.resultAccess ?? 'workspace_developers',
    rerunPolicy: input.rerunPolicy ?? 'manual_only',
    retentionHours: input.retentionHours ?? 168,
    redactionMode: input.redactionMode ?? 'metadata_only'
  };
}

export function buildOpenWhiskRuntimeCoverageSummary() {
  return OPENWHISK_SUPPORTED_ACTION_RUNTIMES.map((runtime) => ({
    runtime: runtime.runtime,
    sourceKinds: [...runtime.sourceKinds],
    webActionSupported: runtime.webActionSupported
  }));
}

function buildProviderCompatibility(profile) {
  return {
    provider: 'openwhisk',
    namespaceStrategy: profile.namespaceStrategy,
    subjectProvisioning: profile.subjectProvisioning,
    nativeAdminCrudExposed: false,
    supportedVersions: profile.supportedVersions.map(({ range, label }) => ({ range, label })),
    supportedRuntimes: buildOpenWhiskRuntimeCoverageSummary(),
    supportedSourceKinds: [...OPENWHISK_ACTION_SOURCE_KINDS],
    supportedTriggerKinds: [...OPENWHISK_SUPPORTED_TRIGGER_KINDS],
    lifecycleGovernance: {
      immutableVersions: true,
      rollbackSupported: true,
      rollbackPreservesHistory: true
    },
    apisixHttpExposure: {
      managedByGateway: true,
      productRouteFamily: 'functions'
    }
  };
}

export function isOpenWhiskVersionSupported(providerVersion) {
  if (!providerVersion) {
    return true;
  }

  return SUPPORTED_OPENWHISK_VERSION_RANGES.some(({ range }) => {
    const prefix = range.replace(/\.x$/, '');
    return String(providerVersion).startsWith(prefix);
  });
}

export function resolveOpenWhiskAdminProfile(context = {}) {
  const workspaceEnvironment = deriveEnvironment(context.workspaceEnvironment);
  const planTier = derivePlanTier(context.planId);
  const resolution = resolveWorkspaceEffectiveCapabilities({
    tenantId: context.tenantId ?? null,
    workspaceId: context.workspaceId,
    workspaceEnvironment,
    planId: context.planId,
    resolvedAt: context.resolvedAt ?? '2026-03-25T00:00:00Z'
  });
  const serverlessCapabilityEnabled =
    (resolution.capabilities ?? []).some((capability) => capability.capabilityKey === 'data.openwhisk.actions') ||
    planTier !== 'starter';
  const namingPolicy = buildNamingPolicy({
    tenantId: context.tenantId,
    workspaceId: context.workspaceId,
    tenantSlug: context.tenantSlug,
    workspaceSlug: context.workspaceSlug,
    workspaceEnvironment
  });
  const serverlessContext = buildOpenWhiskServerlessContext({
    ...context,
    tenantId: context.tenantId,
    workspaceId: context.workspaceId,
    workspaceEnvironment
  });

  return {
    provider: 'openwhisk',
    planId: context.planId,
    planTier,
    providerVersion: context.providerVersion,
    workspaceEnvironment,
    deploymentProfileId: context.deploymentProfileId ?? `dp_openwhisk_${planTier}`,
    namespaceStrategy: 'logical_namespace_per_workspace',
    subjectProvisioning: 'internal_only',
    logicalContextMutationsSupported: true,
    actionMutationsSupported: serverlessCapabilityEnabled,
    packageMutationsSupported: serverlessCapabilityEnabled,
    triggerMutationsSupported: serverlessCapabilityEnabled,
    ruleMutationsSupported: serverlessCapabilityEnabled,
    invocationSupported: serverlessCapabilityEnabled,
    activationReadsSupported: serverlessCapabilityEnabled,
    httpExposureSupported: serverlessCapabilityEnabled,
    storageTriggersSupported: serverlessCapabilityEnabled,
    cronTriggersSupported: serverlessCapabilityEnabled,
    serverlessCapabilityEnabled,
    namingPolicy,
    quotaGuardrails: getOpenWhiskQuotaGuardrails(planTier, resolution, context),
    minimumEnginePolicy: OPENWHISK_MINIMUM_ENGINE_POLICY.logical_namespace_subject,
    supportedVersions: SUPPORTED_OPENWHISK_VERSION_RANGES,
    supportedRuntimes: buildOpenWhiskRuntimeCoverageSummary(),
    supportedSourceKinds: OPENWHISK_ACTION_SOURCE_KINDS,
    supportedTriggerKinds: OPENWHISK_SUPPORTED_TRIGGER_KINDS,
    serverlessContext,
    auditCoverage: {
      capturesServerlessContext: true,
      capturesProvisioningState: true,
      capturesTenantIsolation: true,
      capturesNativeAdminSuppression: true,
      capturesActivationPolicy: true,
      capturesHttpExposure: true
    }
  };
}

function validateLogicalName(label, value, violations) {
  if (!value) {
    violations.push(`${label} is required for OpenWhisk administration.`);
    return;
  }

  if (!/^[a-z][a-z0-9-]{1,62}$/.test(value)) {
    violations.push(`${label} must start with a lowercase letter and use only lowercase letters, digits, or hyphen.`);
  }
}

function collectBaseViolations(resourceKind, action, payload, context, profile) {
  const violations = [];

  if (!OPENWHISK_ADMIN_RESOURCE_KINDS.includes(resourceKind)) {
    violations.push(`Unsupported OpenWhisk admin resource kind ${resourceKind}.`);
  }

  if (!(OPENWHISK_ADMIN_CAPABILITY_MATRIX[resourceKind] ?? []).includes(action)) {
    violations.push(`OpenWhisk admin action ${action} is not supported for resource kind ${resourceKind}.`);
  }

  if (!profile.serverlessCapabilityEnabled) {
    violations.push(`Plan ${profile.planId} does not advertise data.openwhisk.actions for workspace environment ${profile.workspaceEnvironment}.`);
  }

  if (context.providerVersion && !isOpenWhiskVersionSupported(context.providerVersion)) {
    violations.push(`OpenWhisk provider version ${context.providerVersion} is outside the supported compatibility matrix.`);
  }

  for (const forbiddenField of profile.minimumEnginePolicy.forbiddenUserFields) {
    if (payload[forbiddenField] !== undefined) {
      violations.push(`${forbiddenField} is internal-only and cannot be supplied through the governed functions surface.`);
    }
  }

  return violations;
}

function validateActionRequest(action, payload, context, profile) {
  const violations = [];
  const actionName = payload.actionName ?? context.actionName;
  const runtime = payload.execution?.runtime ?? payload.runtime;
  const entrypoint = payload.execution?.entrypoint ?? payload.entrypoint;
  const sourceKind = payload.source?.kind;
  const activationPolicy = payload.activationPolicy ?? {};

  if (action !== 'list') {
    validateLogicalName('actionName', actionName, violations);
  }

  if ((actionName ?? '').startsWith(`${profile.namingPolicy.actionPrefix}-`)) {
    violations.push('actionName must stay logical; the physical OpenWhisk action prefix is generated by the control plane.');
  }

  if (action === 'create' && profile.quotaGuardrails.usedActions >= profile.quotaGuardrails.maxActionsPerWorkspace) {
    violations.push(`Quota ${profile.quotaGuardrails.metricKeys.actions} would be exceeded by creating another action.`);
  }

  if (!runtime && action !== 'list') {
    violations.push('runtime is required for governed OpenWhisk actions.');
  }

  if (runtime && !OPENWHISK_SUPPORTED_ACTION_RUNTIMES.some((candidate) => candidate.runtime === runtime)) {
    violations.push(`runtime ${runtime} is unsupported for governed OpenWhisk actions.`);
  }

  if (!entrypoint && action !== 'list') {
    violations.push('entrypoint is required for governed OpenWhisk actions.');
  }

  if (sourceKind && !OPENWHISK_ACTION_SOURCE_KINDS.includes(sourceKind)) {
    violations.push(`source.kind ${sourceKind} is unsupported; allowed values: ${OPENWHISK_ACTION_SOURCE_KINDS.join(', ')}.`);
  }

  if (runtime && sourceKind) {
    const runtimeSupport = OPENWHISK_SUPPORTED_ACTION_RUNTIMES.find((candidate) => candidate.runtime === runtime);
    if (runtimeSupport && !runtimeSupport.sourceKinds.includes(sourceKind)) {
      violations.push(`runtime ${runtime} does not support source kind ${sourceKind}.`);
    }
  }

  if ((payload.execution?.webAction?.enabled ?? false) === true && runtime) {
    const runtimeSupport = OPENWHISK_SUPPORTED_ACTION_RUNTIMES.find((candidate) => candidate.runtime === runtime);
    if (runtimeSupport && !runtimeSupport.webActionSupported) {
      violations.push(`runtime ${runtime} does not support managed web actions.`);
    }
  }

  if ((payload.execution?.limits?.timeoutSeconds ?? 0) > 900) {
    violations.push('timeoutSeconds must be 900 seconds or lower for governed OpenWhisk actions.');
  }

  if ((payload.execution?.limits?.memoryMb ?? 0) > 2048) {
    violations.push('memoryMb must be 2048 MB or lower for governed OpenWhisk actions.');
  }

  if (payload.execution?.environment && typeof payload.execution.environment !== 'object') {
    violations.push('execution.environment must be an object when provided.');
  }

  if (payload.execution?.parameters && typeof payload.execution.parameters !== 'object') {
    violations.push('execution.parameters must be an object when provided.');
  }

  if (activationPolicy.logsAccess === 'disabled' && activationPolicy.resultAccess !== 'disabled') {
    violations.push('resultAccess cannot remain enabled when logsAccess is disabled for the governed activation policy.');
  }

  return violations;
}

function validatePackageRequest(action, payload, context, profile) {
  const violations = [];
  const packageName = normalizeLogicalName(payload.packageName ?? context.packageName, 'package');

  if (action !== 'list') {
    validateLogicalName('packageName', payload.packageName ?? context.packageName, violations);
  }

  if ((payload.packageName ?? '').startsWith(`${profile.namingPolicy.packagePrefix}-`)) {
    violations.push('packageName must stay logical; the physical OpenWhisk package prefix is generated by the control plane.');
  }

  if (payload.visibility && !OPENWHISK_ALLOWED_PACKAGE_VISIBILITY.includes(payload.visibility)) {
    violations.push(`visibility ${payload.visibility} is unsupported for governed OpenWhisk packages.`);
  }

  if (action === 'create' && profile.quotaGuardrails.usedPackages >= profile.quotaGuardrails.maxPackagesPerWorkspace) {
    violations.push(`Quota ${profile.quotaGuardrails.metricKeys.packages} would be exceeded by creating another package.`);
  }

  if (payload.defaultParameters && typeof payload.defaultParameters !== 'object') {
    violations.push('defaultParameters must be an object when provided.');
  }

  if (payload.annotations && typeof payload.annotations !== 'object') {
    violations.push('annotations must be an object when provided.');
  }

  if (action !== 'list' && packageName.length > 63) {
    violations.push('packageName must stay within the OpenWhisk logical naming budget of 63 characters.');
  }

  return violations;
}

function validateTriggerRequest(action, payload, context, profile) {
  const violations = [];
  const triggerName = payload.triggerName ?? context.triggerName;

  if (action !== 'list') {
    validateLogicalName('triggerName', triggerName, violations);
  }

  if ((triggerName ?? '').startsWith(`${profile.namingPolicy.triggerPrefix}-`)) {
    violations.push('triggerName must stay logical; the physical OpenWhisk trigger prefix is generated by the control plane.');
  }

  if (action === 'create' && profile.quotaGuardrails.usedTriggers >= profile.quotaGuardrails.maxTriggersPerWorkspace) {
    violations.push(`Quota ${profile.quotaGuardrails.metricKeys.triggers} would be exceeded by creating another trigger.`);
  }

  if (payload.sourceType && !OPENWHISK_ALLOWED_TRIGGER_SOURCE_TYPES.includes(payload.sourceType)) {
    violations.push(`sourceType ${payload.sourceType} is unsupported; allowed values: ${OPENWHISK_ALLOWED_TRIGGER_SOURCE_TYPES.join(', ')}.`);
  }

  if ((payload.sourceType === 'event_topic' || payload.sourceType === 'http') && !payload.sourceRef && action !== 'list') {
    violations.push(`sourceRef is required when sourceType is ${payload.sourceType}.`);
  }

  if (payload.sourceType === 'cron' && !payload.scheduleExpression) {
    violations.push('scheduleExpression is required when sourceType is cron.');
  }

  if (payload.packageName) {
    validateLogicalName('packageName', payload.packageName, violations);
  }

  return violations;
}

function validateRuleRequest(action, payload, context, profile) {
  const violations = [];
  const ruleName = payload.ruleName ?? context.ruleName;

  if (action !== 'list') {
    validateLogicalName('ruleName', ruleName, violations);
  }

  if ((ruleName ?? '').startsWith(`${profile.namingPolicy.rulePrefix}-`)) {
    violations.push('ruleName must stay logical; the physical OpenWhisk rule prefix is generated by the control plane.');
  }

  if (action === 'create' && profile.quotaGuardrails.usedRules >= profile.quotaGuardrails.maxRulesPerWorkspace) {
    violations.push(`Quota ${profile.quotaGuardrails.metricKeys.rules} would be exceeded by creating another rule.`);
  }

  if (action !== 'list') {
    validateLogicalName('triggerName', payload.triggerName ?? context.triggerName, violations);
    validateLogicalName('actionName', payload.actionName ?? context.actionName, violations);
  }

  if (payload.packageName) {
    validateLogicalName('packageName', payload.packageName, violations);
  }

  if (payload.activationState && !OPENWHISK_ALLOWED_RULE_STATES.includes(payload.activationState)) {
    violations.push(`activationState ${payload.activationState} is unsupported; allowed values: ${OPENWHISK_ALLOWED_RULE_STATES.join(', ')}.`);
  }

  return violations;
}

export function validateOpenWhiskAdminRequest({ resourceKind, action, context = {}, payload = {} }) {
  const profile = resolveOpenWhiskAdminProfile({
    ...context,
    tenantId: context.tenantId ?? payload.tenantId,
    workspaceId: context.workspaceId ?? payload.workspaceId
  });
  const violations = collectBaseViolations(resourceKind, action, payload, context, profile);

  if (resourceKind === 'action') {
    violations.push(...validateActionRequest(action, payload, context, profile));
  }

  if (resourceKind === 'package') {
    violations.push(...validatePackageRequest(action, payload, context, profile));
  }

  if (resourceKind === 'trigger') {
    violations.push(...validateTriggerRequest(action, payload, context, profile));
  }

  if (resourceKind === 'rule') {
    violations.push(...validateRuleRequest(action, payload, context, profile));
  }

  return {
    ok: violations.length === 0,
    violations,
    profile
  };
}

function buildPhysicalName(prefix, logicalName, resourcePrefix) {
  return trimSegment(`${prefix}-${normalizeLogicalName(logicalName, resourcePrefix)}`, 80);
}

function buildQuotaStatus(profile) {
  return {
    maxActionsPerWorkspace: profile.quotaGuardrails.maxActionsPerWorkspace,
    maxPackagesPerWorkspace: profile.quotaGuardrails.maxPackagesPerWorkspace,
    maxTriggersPerWorkspace: profile.quotaGuardrails.maxTriggersPerWorkspace,
    maxRulesPerWorkspace: profile.quotaGuardrails.maxRulesPerWorkspace,
    maxHttpExposuresPerWorkspace: profile.quotaGuardrails.maxHttpExposuresPerWorkspace,
    usedActions: profile.quotaGuardrails.usedActions,
    usedPackages: profile.quotaGuardrails.usedPackages,
    usedTriggers: profile.quotaGuardrails.usedTriggers,
    usedRules: profile.quotaGuardrails.usedRules,
    usedHttpExposures: profile.quotaGuardrails.usedHttpExposures,
    visibleInConsole: true
  };
}

export function buildOpenWhiskHttpExposure(payload = {}, context = {}) {
  return {
    exposureId: payload.exposureId ?? context.exposureId ?? `exp_${slugify(context.resourceId ?? payload.actionName ?? 'fnexposure').replace(/-/g, '')}`,
    status: payload.status ?? 'active',
    authMode: OPENWHISK_ALLOWED_HTTP_AUTH_MODES.includes(payload.authMode) ? payload.authMode : 'workspace_token',
    methods: (payload.methods ?? ['POST']).filter((method) => OPENWHISK_ALLOWED_HTTP_METHODS.includes(method)),
    path: payload.path ?? `/functions/${normalizeLogicalName(payload.actionName ?? context.actionName ?? 'action', 'action')}`,
    publicUrl: payload.publicUrl ?? `https://api.in-atelier.example/functions/${normalizeLogicalName(payload.actionName ?? context.actionName ?? 'action', 'action')}`,
    apisixRouteRef: payload.apisixRouteRef ?? `apisix:functions:${normalizeLogicalName(payload.actionName ?? context.actionName ?? 'action', 'action')}`,
    cors: {
      enabled: payload.cors?.enabled ?? true,
      allowOrigins: payload.cors?.allowOrigins ?? ['https://console.in-atelier.example']
    },
    rateLimitProfile: payload.rateLimitProfile ?? 'functions-http-default'
  };
}

export function buildOpenWhiskStorageTrigger(payload = {}, context = {}) {
  return {
    triggerId: payload.triggerId ?? context.triggerId ?? `trg_${slugify(context.resourceId ?? payload.bucketRef ?? 'storage').replace(/-/g, '')}`,
    bucketRef: payload.bucketRef,
    eventTypes: (payload.eventTypes ?? ['object_created']).filter((eventType) => OPENWHISK_ALLOWED_STORAGE_EVENT_TYPES.includes(eventType)),
    prefix: payload.prefix,
    suffix: payload.suffix,
    deliveryMode: payload.deliveryMode ?? 'managed_bridge',
    status: payload.status ?? 'active'
  };
}

export function buildOpenWhiskCronTrigger(payload = {}, context = {}) {
  return {
    triggerId: payload.triggerId ?? context.triggerId ?? `trg_${slugify(payload.schedule ?? context.resourceId ?? 'cron').replace(/-/g, '')}`,
    schedule: payload.schedule,
    timezone: payload.timezone ?? 'UTC',
    catchUpMode: payload.catchUpMode ?? 'none',
    overlapPolicy: OPENWHISK_ALLOWED_CRON_OVERLAP_POLICIES.includes(payload.overlapPolicy) ? payload.overlapPolicy : 'skip',
    status: payload.status ?? 'active'
  };
}

export function buildOpenWhiskInvocationRequest(payload = {}, context = {}) {
  return {
    invocationId: payload.invocationId ?? context.invocationId ?? `inv_${slugify(context.resourceId ?? context.actionName ?? 'invoke').replace(/-/g, '')}`,
    resourceId: context.resourceId,
    status: payload.status ?? 'accepted',
    acceptedAt: payload.acceptedAt ?? context.acceptedAt ?? '2026-03-25T00:00:00Z',
    activationPolicy: buildOpenWhiskActivationPolicy(payload.activationPolicy ?? context.activationPolicy)
  };
}

export function buildOpenWhiskActivationProjection(payload = {}, context = {}) {
  return {
    activationId: payload.activationId ?? context.activationId ?? `act_${slugify(context.resourceId ?? context.actionName ?? 'activation').replace(/-/g, '')}`,
    resourceId: context.resourceId,
    invocationId: payload.invocationId,
    status: OPENWHISK_ALLOWED_ACTIVATION_STATUSES.includes(payload.status) ? payload.status : 'succeeded',
    startedAt: payload.startedAt ?? '2026-03-25T00:00:00Z',
    finishedAt: payload.finishedAt,
    durationMs: payload.durationMs ?? 0,
    memoryMb: payload.memoryMb ?? 256,
    triggerKind: payload.triggerKind ?? 'direct',
    statusCode: payload.statusCode,
    policy: buildOpenWhiskActivationPolicy(payload.policy ?? context.activationPolicy)
  };
}

export function normalizeOpenWhiskAdminResource(resourceKind, payload = {}, context = {}) {
  const profile = resolveOpenWhiskAdminProfile({
    ...context,
    tenantId: context.tenantId ?? payload.tenantId,
    workspaceId: context.workspaceId ?? payload.workspaceId
  });
  const serverlessContext = profile.serverlessContext;
  const providerCompatibility = buildProviderCompatibility(profile);
  const quotaStatus = buildQuotaStatus(profile);

  if (resourceKind === 'action') {
    const actionName = normalizeLogicalName(payload.actionName ?? context.actionName, 'action');
    const activationPolicy = buildOpenWhiskActivationPolicy(payload.activationPolicy);
    return {
      resourceType: 'function_action',
      resourceId: context.resourceId,
      tenantId: context.tenantId ?? payload.tenantId,
      workspaceId: context.workspaceId ?? payload.workspaceId,
      actionName,
      physicalActionName: buildPhysicalName(serverlessContext.actionPrefix, actionName, 'action'),
      packageName: payload.packageName ? normalizeLogicalName(payload.packageName, 'package') : undefined,
      namespaceName: serverlessContext.namespaceName,
      subjectRef: serverlessContext.subjectRef,
      source: compactDefined({
        kind: payload.source?.kind,
        language: payload.source?.language,
        inlineCode: payload.source?.inlineCode,
        artifactRef: payload.source?.artifactRef,
        storedObjectRef: payload.source?.storedObjectRef,
        imageRef: payload.source?.imageRef,
        digest: payload.source?.digest,
        entryFile: payload.source?.entryFile,
        imageEntrypoint: payload.source?.imageEntrypoint
      }),
      execution: compactDefined({
        runtime: payload.execution?.runtime ?? payload.runtime,
        entrypoint: payload.execution?.entrypoint ?? payload.entrypoint,
        parameters: normalizeObjectKeys(payload.execution?.parameters ?? {}),
        environment: normalizeObjectKeys(payload.execution?.environment ?? {}),
        limits: compactDefined({
          timeoutSeconds: payload.execution?.limits?.timeoutSeconds ?? 60,
          memoryMb: payload.execution?.limits?.memoryMb ?? 256,
          concurrency: payload.execution?.limits?.concurrency,
          logLineLimit: payload.execution?.limits?.logLineLimit,
          resultByteLimit: payload.execution?.limits?.resultByteLimit
        }),
        webAction: compactDefined({
          enabled: payload.execution?.webAction?.enabled ?? false,
          requireAuthentication: payload.execution?.webAction?.requireAuthentication ?? true,
          rawHttpResponse: payload.execution?.webAction?.rawHttpResponse ?? false,
          responseMode: payload.execution?.webAction?.responseMode ?? 'json'
        })
      }),
      activationPolicy,
      quotaStatus,
      tenantIsolation: serverlessContext.tenantIsolation,
      providerCompatibility,
      httpExposure: payload.httpExposure ? buildOpenWhiskHttpExposure(payload.httpExposure, { ...context, actionName }) : undefined,
      storageTriggers: Array.isArray(payload.storageTriggers)
        ? payload.storageTriggers.map((trigger, index) => buildOpenWhiskStorageTrigger(trigger, { ...context, actionName, triggerId: trigger.triggerId ?? `trg_${index + 1}` }))
        : undefined,
      cronTriggers: Array.isArray(payload.cronTriggers)
        ? payload.cronTriggers.map((trigger, index) => buildOpenWhiskCronTrigger(trigger, { ...context, actionName, triggerId: trigger.triggerId ?? `trg_${index + 1}` }))
        : undefined,
      activeVersionId:
        payload.activeVersionId ??
        payload.versioning?.activeVersionId ??
        context.activeVersionId ??
        `fnv_${slugify(`${context.resourceId ?? actionName}-active`).replace(/-/g, '')}`,
      versionCount:
        payload.versionCount ??
        payload.versioning?.versionCount ??
        (Array.isArray(payload.versions) ? payload.versions.length : undefined) ??
        1,
      rollbackAvailable:
        payload.rollbackAvailable ??
        payload.versioning?.rollbackAvailable ??
        ((payload.versionCount ?? payload.versioning?.versionCount ?? (Array.isArray(payload.versions) ? payload.versions.length : 1)) > 1),
      latestRollbackAt: payload.latestRollbackAt ?? payload.versioning?.latestRollbackAt,
      deploymentDigest: payload.deploymentDigest,
      status: payload.status ?? 'provisioning'
    };
  }

  if (resourceKind === 'package') {
    const packageName = normalizeLogicalName(payload.packageName ?? context.packageName, 'package');
    return {
      resourceType: 'function_package',
      resourceId: context.resourceId,
      tenantId: context.tenantId ?? payload.tenantId,
      workspaceId: context.workspaceId ?? payload.workspaceId,
      packageName,
      physicalPackageName: buildPhysicalName(serverlessContext.packagePrefix, packageName, 'package'),
      namespaceName: serverlessContext.namespaceName,
      subjectRef: serverlessContext.subjectRef,
      packageBindingRef: serverlessContext.packageBindingRef,
      visibility: payload.visibility ?? 'private',
      defaultParameters: normalizeObjectKeys(payload.defaultParameters ?? {}),
      annotations: normalizeObjectKeys(payload.annotations ?? {}),
      actionCount: payload.actionCount ?? 0,
      quotaStatus,
      tenantIsolation: serverlessContext.tenantIsolation,
      providerCompatibility,
      status: payload.status ?? 'provisioning'
    };
  }

  if (resourceKind === 'trigger') {
    const triggerName = normalizeLogicalName(payload.triggerName ?? context.triggerName, 'trigger');
    return {
      resourceType: 'function_trigger',
      resourceId: context.resourceId,
      tenantId: context.tenantId ?? payload.tenantId,
      workspaceId: context.workspaceId ?? payload.workspaceId,
      triggerName,
      physicalTriggerName: buildPhysicalName(serverlessContext.triggerPrefix, triggerName, 'trigger'),
      packageName: payload.packageName ? normalizeLogicalName(payload.packageName, 'package') : undefined,
      namespaceName: serverlessContext.namespaceName,
      subjectRef: serverlessContext.subjectRef,
      sourceType: payload.sourceType ?? 'manual',
      sourceRef: payload.sourceRef,
      scheduleExpression: payload.scheduleExpression,
      parameters: normalizeObjectKeys(payload.parameters ?? {}),
      quotaStatus,
      tenantIsolation: serverlessContext.tenantIsolation,
      providerCompatibility,
      status: payload.status ?? 'provisioning'
    };
  }

  if (resourceKind === 'rule') {
    const ruleName = normalizeLogicalName(payload.ruleName ?? context.ruleName, 'rule');
    const triggerName = normalizeLogicalName(payload.triggerName ?? context.triggerName, 'trigger');
    return {
      resourceType: 'function_rule',
      resourceId: context.resourceId,
      tenantId: context.tenantId ?? payload.tenantId,
      workspaceId: context.workspaceId ?? payload.workspaceId,
      ruleName,
      physicalRuleName: buildPhysicalName(serverlessContext.rulePrefix, ruleName, 'rule'),
      triggerName,
      physicalTriggerName: buildPhysicalName(serverlessContext.triggerPrefix, triggerName, 'trigger'),
      actionName: normalizeLogicalName(payload.actionName ?? context.actionName, 'action'),
      packageName: payload.packageName ? normalizeLogicalName(payload.packageName, 'package') : undefined,
      namespaceName: serverlessContext.namespaceName,
      subjectRef: serverlessContext.subjectRef,
      activationState: payload.activationState ?? 'active',
      quotaStatus,
      tenantIsolation: serverlessContext.tenantIsolation,
      providerCompatibility,
      status: payload.status ?? 'provisioning'
    };
  }

  throw new Error(`Unsupported OpenWhisk admin resource kind ${resourceKind}.`);
}

function buildCapabilityName(resourceKind, action) {
  return `openwhisk_${resourceKind}_${action}`;
}

function deriveTargetRef(resourceKind, normalizedResource, serverlessContext) {
  if (resourceKind === 'action') {
    return `namespace:${serverlessContext.namespaceName}/action:${normalizedResource.physicalActionName}`;
  }

  if (resourceKind === 'package') {
    return `namespace:${serverlessContext.namespaceName}/package:${normalizedResource.physicalPackageName}`;
  }

  if (resourceKind === 'trigger') {
    return `namespace:${serverlessContext.namespaceName}/trigger:${normalizedResource.physicalTriggerName}`;
  }

  if (resourceKind === 'rule') {
    return `namespace:${serverlessContext.namespaceName}/rule:${normalizedResource.physicalRuleName}`;
  }

  return `namespace:${serverlessContext.namespaceName}`;
}

function buildProvisioningState(resourceKind, normalizedResource, serverlessContext) {
  return {
    namespace: serverlessContext.namespaceProvisioning.state,
    subject: serverlessContext.subjectProvisioning.state,
    resourceKind,
    resourceStatus: normalizedResource.status ?? 'provisioning',
    nativeAdminCrudExposed: false
  };
}

function buildOpenWhiskAdminAuditSummary({ resourceKind, action, profile, tenantId, workspaceId }) {
  return {
    provider: 'openwhisk',
    resourceKind,
    action,
    tenantId,
    workspaceId,
    namespaceStrategy: profile.namespaceStrategy,
    subjectProvisioning: profile.subjectProvisioning,
    capturesServerlessContext: true,
    capturesProvisioningState: true,
    capturesTenantIsolation: true,
    nativeAdminCrudExposed: false
  };
}

export function buildOpenWhiskAdminAdapterCall({
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
  const validation = validateOpenWhiskAdminRequest({ resourceKind, action, context, payload });
  if (!validation.ok) {
    return {
      ok: false,
      violations: validation.violations,
      profile: validation.profile
    };
  }

  const normalizedResource = normalizeOpenWhiskAdminResource(resourceKind, payload, {
    ...context,
    tenantId: context.tenantId ?? tenantId,
    workspaceId: context.workspaceId ?? workspaceId
  });
  const serverlessContext = validation.profile.serverlessContext;
  const resolvedTargetRef = targetRef ?? deriveTargetRef(resourceKind, normalizedResource, serverlessContext);
  const provisioningState = buildProvisioningState(resourceKind, normalizedResource, serverlessContext);
  const auditSummary = buildOpenWhiskAdminAuditSummary({
    resourceKind,
    action,
    profile: validation.profile,
    tenantId,
    workspaceId
  });

  return {
    adapter_id: 'openwhisk',
    contract_version: functionAdminRequestContract?.version ?? '2026-03-25',
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
      serverlessContext,
      namingPolicy: serverlessContext.namingPolicy,
      subjectBinding: {
        subjectRef: serverlessContext.subjectRef,
        namespaceName: serverlessContext.namespaceName,
        exposure: 'internal_only'
      },
      quotaSnapshot: buildQuotaStatus(validation.profile),
      provisioningState,
      auditSummary,
      context: compactDefined({
        scope: context.scope ?? 'workspace',
        namespaceName: serverlessContext.namespaceName,
        subjectRef: serverlessContext.subjectRef,
        providerVersion: context.providerVersion,
        workspaceEnvironment: validation.profile.workspaceEnvironment
      })
    }
  };
}

export function buildOpenWhiskAdminMetadataRecord({
  resourceKind,
  action,
  resource,
  serverlessContext,
  namingPolicy,
  provisioningState,
  auditSummary,
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
      primaryRef:
        resource?.physicalActionName ??
        resource?.physicalPackageName ??
        resource?.physicalTriggerName ??
        resource?.physicalRuleName ??
        resource?.apisixRouteRef ??
        resource?.actionName ??
        resource?.packageName ??
        resource?.triggerName ??
        resource?.ruleName,
      action,
      provider: resource?.providerCompatibility?.provider ?? 'openwhisk',
      namespaceName: serverlessContext?.namespaceName,
      subjectRef: serverlessContext?.subjectRef,
      nativeAdminCrudExposed: false
    }),
    resource,
    serverlessContext,
    namingPolicy,
    provisioningState,
    auditSummary
  };
}

export function buildOpenWhiskInventorySnapshot({
  snapshotId,
  tenantId,
  workspaceId,
  planId,
  context = {},
  actions = [],
  packages = [],
  triggers = [],
  rules = [],
  httpExposures = [],
  observedAt = '2026-03-25T00:00:00Z'
}) {
  const profile = resolveOpenWhiskAdminProfile({ ...context, tenantId, workspaceId, planId });
  const provisioningState = {
    namespace: profile.serverlessContext.namespaceProvisioning.state,
    subject: profile.serverlessContext.subjectProvisioning.state,
    actionProjection: actions.length > 0 ? 'reconciled' : 'ready',
    packageProjection: packages.length > 0 ? 'reconciled' : 'ready',
    triggerProjection: triggers.length > 0 ? 'reconciled' : 'ready',
    ruleProjection: rules.length > 0 ? 'reconciled' : 'ready',
    httpExposureProjection: httpExposures.length > 0 ? 'reconciled' : 'ready'
  };

  return {
    snapshotId,
    tenantId,
    workspaceId,
    provider: 'openwhisk',
    counts: {
      actions: actions.length,
      packages: packages.length,
      triggers: triggers.length,
      rules: rules.length,
      httpExposures: httpExposures.length
    },
    quotas: buildQuotaStatus(profile),
    namingPolicy: profile.serverlessContext.namingPolicy,
    serverlessContext: profile.serverlessContext,
    minimumEnginePolicy: profile.minimumEnginePolicy,
    observedAt,
    contractVersion: functionInventorySnapshotContract?.version ?? '2026-03-25',
    tenantIsolation: profile.serverlessContext.tenantIsolation,
    provisioningState,
    actionRefs: actions.map((entry) => entry.physicalActionName ?? entry.actionName ?? entry),
    packageRefs: packages.map((entry) => entry.physicalPackageName ?? entry.packageName ?? entry),
    triggerRefs: triggers.map((entry) => entry.physicalTriggerName ?? entry.triggerName ?? entry),
    ruleRefs: rules.map((entry) => entry.physicalRuleName ?? entry.ruleName ?? entry),
    httpExposureRefs: httpExposures.map((entry) => entry.apisixRouteRef ?? entry.publicUrl ?? entry)
  };
}

export function buildOpenWhiskFunctionVersion(payload = {}, context = {}) {
  const normalizedAction = normalizeOpenWhiskAdminResource(
    'action',
    {
      actionName: payload.actionName ?? context.actionName ?? 'action',
      packageName: payload.packageName ?? context.packageName,
      source: payload.source ?? {
        kind: 'inline_code',
        language: 'javascript',
        inlineCode: 'function main(params) { return params; }'
      },
      execution:
        payload.execution ?? {
          runtime: 'nodejs:20',
          entrypoint: 'main',
          parameters: {},
          environment: {},
          limits: { timeoutSeconds: 60, memoryMb: 256 },
          webAction: { enabled: false, requireAuthentication: true, rawHttpResponse: false }
        },
      activationPolicy: payload.activationPolicy ?? buildOpenWhiskActivationPolicy(),
      deploymentDigest: payload.deploymentDigest,
      status: payload.status === 'active' ? 'active' : 'deploying'
    },
    context
  );

  return {
    versionId:
      payload.versionId ??
      context.versionId ??
      `fnv_${slugify(`${context.resourceId ?? normalizedAction.resourceId ?? normalizedAction.actionName}-v${payload.versionNumber ?? 1}`).replace(/-/g, '')}`,
    resourceId: context.resourceId ?? normalizedAction.resourceId,
    tenantId: context.tenantId ?? normalizedAction.tenantId,
    workspaceId: context.workspaceId ?? normalizedAction.workspaceId,
    versionNumber: payload.versionNumber ?? 1,
    status: OPENWHISK_FUNCTION_VERSION_STATUSES.includes(payload.status) ? payload.status : 'historical',
    rollbackEligible: payload.rollbackEligible ?? true,
    originType: OPENWHISK_FUNCTION_VERSION_ORIGINS.includes(payload.originType) ? payload.originType : 'publish',
    originVersionId: payload.originVersionId,
    source: normalizedAction.source,
    execution: normalizedAction.execution,
    activationPolicy: normalizedAction.activationPolicy,
    deploymentDigest: payload.deploymentDigest ?? normalizedAction.deploymentDigest,
    timestamps: {
      createdAt: payload.timestamps?.createdAt ?? payload.createdAt ?? '2026-03-27T00:00:00Z',
      updatedAt: payload.timestamps?.updatedAt ?? payload.updatedAt ?? payload.timestamps?.createdAt ?? payload.createdAt ?? '2026-03-27T00:00:00Z',
      activatedAt: payload.timestamps?.activatedAt,
      deletedAt: payload.timestamps?.deletedAt,
      suspendedAt: payload.timestamps?.suspendedAt
    }
  };
}

export function buildOpenWhiskFunctionVersionCollection({ items = [], nextCursor, size } = {}) {
  return {
    items,
    page: {
      size: size ?? items.length,
      nextCursor
    }
  };
}

export function validateOpenWhiskFunctionRollback({ context = {}, payload = {} } = {}) {
  const profile = resolveOpenWhiskAdminProfile({
    ...context,
    tenantId: context.tenantId ?? payload.tenantId,
    workspaceId: context.workspaceId ?? payload.workspaceId
  });
  const violations = [];
  const versionId = payload.versionId ?? payload.targetVersionId ?? context.targetVersion?.versionId;
  const targetVersion = payload.targetVersion ?? context.targetVersion;

  if (!versionId) {
    violations.push('versionId is required to request a governed function rollback.');
  }

  if (versionId && !/^fnv_[0-9a-z]+$/.test(versionId)) {
    violations.push('versionId must use the governed function version identifier format.');
  }

  if (context.authorized === false || payload.authorized === false) {
    violations.push('caller is not authorized to roll back this governed function action.');
  }

  if ((context.availableVersions?.length ?? 0) < 2 && !targetVersion) {
    violations.push('at least one prior function version must exist before rollback is available.');
  }

  if (targetVersion) {
    if (context.resourceId && targetVersion.resourceId && targetVersion.resourceId !== context.resourceId) {
      violations.push('rollback target must belong to the same governed function action resource.');
    }

    if (context.tenantId && targetVersion.tenantId && targetVersion.tenantId !== context.tenantId) {
      violations.push('rollback target must stay within the caller tenant scope.');
    }

    if (context.workspaceId && targetVersion.workspaceId && targetVersion.workspaceId !== context.workspaceId) {
      violations.push('rollback target must stay within the caller workspace scope.');
    }

    if (targetVersion.status === 'active' || targetVersion.versionId === context.activeVersionId) {
      violations.push('rollback target is already the active function version.');
    }

    if (targetVersion.rollbackEligible === false) {
      violations.push('rollback target is not eligible for restore.');
    }
  }

  return {
    ok: violations.length === 0,
    violations,
    profile
  };
}

export function buildOpenWhiskFunctionRollbackAccepted(payload = {}, context = {}) {
  return {
    resourceId: context.resourceId ?? payload.resourceId,
    requestedVersionId: payload.versionId ?? payload.requestedVersionId ?? context.versionId ?? context.targetVersion?.versionId,
    status: ['accepted', 'queued'].includes(payload.status) ? payload.status : 'accepted',
    acceptedAt: payload.acceptedAt ?? context.acceptedAt ?? '2026-03-27T00:00:00Z',
    requestId: payload.requestId ?? context.requestId ?? `req_${slugify(context.resourceId ?? 'rollback').replace(/-/g, '')}`,
    correlationId: payload.correlationId ?? context.correlationId ?? `corr_${slugify(context.resourceId ?? 'rollback').replace(/-/g, '')}`
  };
}

export function normalizeOpenWhiskAdminError(error = {}, context = {}) {
  const classification =
    error.classification ??
    (error.status === 404 ? 'not_found' : undefined) ??
    (error.status === 409 ? 'conflict' : undefined) ??
    (error.status === 422 ? 'quota_exceeded' : undefined) ??
    (error.status === 429 ? 'rate_limited' : undefined) ??
    (error.status === 504 ? 'timeout' : undefined) ??
    'dependency_failure';
  const mapped = ERROR_CODE_MAP.get(classification) ?? ERROR_CODE_MAP.get('dependency_failure');

  return {
    status: error.status ?? mapped.status,
    code: mapped.code,
    title: error.title ?? 'OpenWhisk administrative operation failed.',
    detail: {
      resourceKind: context.resourceKind,
      action: context.action,
      targetRef: context.targetRef,
      namespaceName: context.namespaceName,
      providerError: error.providerError,
      classification
    },
    retryable: error.retryable ?? mapped.retryable === true,
    providerError: error.providerError,
    message: error.message ?? 'OpenWhisk administrative operation failed.'
  };
}

export const openWhiskAdminContracts = Object.freeze({
  request: functionAdminRequestContract,
  result: functionAdminResultContract,
  inventory: functionInventorySnapshotContract
});
