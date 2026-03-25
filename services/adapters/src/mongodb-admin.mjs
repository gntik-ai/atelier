import {
  getAdapterPort,
  getContract
} from '../../internal-contracts/src/index.mjs';

export const mongodbAdminAdapterPort = getAdapterPort('mongodb');
export const mongoAdminRequestContract = getContract('mongo_admin_request');
export const mongoAdminResultContract = getContract('mongo_admin_result');
export const mongoInventorySnapshotContract = getContract('mongo_inventory_snapshot');

export const MONGO_ADMIN_RESOURCE_KINDS = Object.freeze([
  'database',
  'collection',
  'index',
  'view',
  'template',
  'user',
  'role_binding'
]);
export const MONGO_ADMIN_MUTATION_ACTIONS = Object.freeze([
  'create',
  'update',
  'delete',
  'assign',
  'revoke',
  'rebuild'
]);
export const MONGO_ADMIN_ISOLATION_MODES = Object.freeze(['shared_cluster', 'dedicated_cluster']);
export const MONGO_ADMIN_CLUSTER_TOPOLOGIES = Object.freeze(['replica_set', 'sharded_cluster']);
export const MONGO_ADMIN_SEGREGATION_MODELS = Object.freeze(['workspace_database', 'tenant_database']);
export const MONGO_RESERVED_DATABASES = Object.freeze(['admin', 'config', 'local']);
export const MONGO_RESERVED_COLLECTION_PREFIXES = Object.freeze(['system.']);
export const MONGO_SHARED_CLUSTER_ALLOWED_ROLE_BINDINGS = Object.freeze(['read', 'readWrite', 'dbAdmin']);
export const MONGO_DEDICATED_CLUSTER_ALLOWED_ROLE_BINDINGS = Object.freeze(['read', 'readWrite', 'dbAdmin', 'dbOwner', 'userAdmin']);
export const MONGO_SUPPORTED_COLLECTION_TYPES = Object.freeze(['standard', 'timeseries']);
export const MONGO_INDEX_REBUILD_STRATEGIES = Object.freeze(['drop_and_recreate', 'rolling_shadow']);
export const MONGO_VIEW_DISALLOWED_PIPELINE_STAGES = Object.freeze(['$out', '$merge']);
export const MONGO_COLLECTION_TEMPLATE_STATES = Object.freeze(['active', 'retired']);

export const SUPPORTED_MONGO_VERSION_RANGES = Object.freeze([
  {
    range: '6.x',
    label: 'MongoDB 6.x',
    adminApiStability: 'stable_v1',
    topologies: ['replica_set', 'sharded_cluster'],
    isolationModes: ['shared_cluster', 'dedicated_cluster'],
    segregationModels: ['workspace_database', 'tenant_database'],
    guarantees: [
      'Database list/get/create/delete flows preserve a BaaS-native contract with dbStats projections and segregation metadata.',
      'Collection CRUD supports bounded validation, TTL, time-series, clustered, and pre/post image configuration without leaking engine-specific payloads.',
      'Index, view, template, user, and role-binding operations stay normalized, tenant-bounded, and auditable.'
    ]
  },
  {
    range: '7.x',
    label: 'MongoDB 7.x',
    adminApiStability: 'stable_v1',
    topologies: ['replica_set', 'sharded_cluster'],
    isolationModes: ['shared_cluster', 'dedicated_cluster'],
    segregationModels: ['workspace_database', 'tenant_database'],
    guarantees: [
      'Database list/get/create/delete flows preserve a BaaS-native contract with dbStats projections and segregation metadata.',
      'Collection CRUD supports bounded validation, TTL, time-series, clustered, and pre/post image configuration without leaking engine-specific payloads.',
      'Index, view, template, user, and role-binding operations stay normalized, tenant-bounded, and auditable.'
    ]
  },
  {
    range: '8.x',
    label: 'MongoDB 8.x',
    adminApiStability: 'stable_v1',
    topologies: ['replica_set', 'sharded_cluster'],
    isolationModes: ['shared_cluster', 'dedicated_cluster'],
    segregationModels: ['workspace_database', 'tenant_database'],
    guarantees: [
      'Database list/get/create/delete flows preserve a BaaS-native contract with dbStats projections and segregation metadata.',
      'Collection CRUD supports bounded validation, TTL, time-series, clustered, and pre/post image configuration without leaking engine-specific payloads.',
      'Index, view, template, user, and role-binding operations stay normalized, tenant-bounded, and auditable.'
    ]
  }
]);

export const MONGO_ADMIN_CAPABILITY_MATRIX = Object.freeze({
  database: Object.freeze(['list', 'get', 'create', 'delete']),
  collection: Object.freeze(['list', 'get', 'create', 'update', 'delete']),
  index: Object.freeze(['list', 'get', 'create', 'update', 'delete', 'rebuild']),
  view: Object.freeze(['list', 'get', 'create', 'update', 'delete']),
  template: Object.freeze(['list', 'get', 'create', 'update', 'delete']),
  user: Object.freeze(['list', 'get', 'create', 'update', 'delete']),
  role_binding: Object.freeze(['assign', 'revoke'])
});

export const MONGO_ADMIN_QUOTA_GUARDRAILS_BY_PLAN = Object.freeze({
  pln_01starter: Object.freeze({
    maxDatabasesPerWorkspace: 1,
    maxDatabasesPerTenant: 1,
    maxCollectionsPerDatabase: 24,
    maxCollectionsPerTenant: 24,
    maxIndexesPerCollection: 8,
    maxViewsPerDatabase: 4,
    maxTemplatesPerWorkspace: 4,
    maxUsersPerDatabase: 4,
    maxRoleBindingsPerUser: 4,
    supportedIsolationModes: ['shared_cluster'],
    supportedClusterTopologies: ['replica_set'],
    supportedSegregationModels: ['workspace_database'],
    defaultIsolationMode: 'shared_cluster',
    defaultClusterTopology: 'replica_set',
    defaultSegregationModel: 'workspace_database',
    deploymentProfileId: 'dpf_01sharedstarter'
  }),
  pln_01growth: Object.freeze({
    maxDatabasesPerWorkspace: 3,
    maxDatabasesPerTenant: 4,
    maxCollectionsPerDatabase: 48,
    maxCollectionsPerTenant: 96,
    maxIndexesPerCollection: 16,
    maxViewsPerDatabase: 12,
    maxTemplatesPerWorkspace: 12,
    maxUsersPerDatabase: 8,
    maxRoleBindingsPerUser: 8,
    supportedIsolationModes: ['shared_cluster'],
    supportedClusterTopologies: ['replica_set'],
    supportedSegregationModels: ['workspace_database'],
    defaultIsolationMode: 'shared_cluster',
    defaultClusterTopology: 'replica_set',
    defaultSegregationModel: 'workspace_database',
    deploymentProfileId: 'dpf_01sharedgrowth'
  }),
  pln_01regulated: Object.freeze({
    maxDatabasesPerWorkspace: 5,
    maxDatabasesPerTenant: 6,
    maxCollectionsPerDatabase: 96,
    maxCollectionsPerTenant: 180,
    maxIndexesPerCollection: 24,
    maxViewsPerDatabase: 24,
    maxTemplatesPerWorkspace: 24,
    maxUsersPerDatabase: 16,
    maxRoleBindingsPerUser: 16,
    supportedIsolationModes: ['dedicated_cluster'],
    supportedClusterTopologies: ['replica_set'],
    supportedSegregationModels: ['workspace_database', 'tenant_database'],
    defaultIsolationMode: 'dedicated_cluster',
    defaultClusterTopology: 'replica_set',
    defaultSegregationModel: 'tenant_database',
    deploymentProfileId: 'dpf_01regulateddedicated'
  }),
  pln_01enterprise: Object.freeze({
    maxDatabasesPerWorkspace: 12,
    maxDatabasesPerTenant: 20,
    maxCollectionsPerDatabase: 256,
    maxCollectionsPerTenant: 2048,
    maxIndexesPerCollection: 64,
    maxViewsPerDatabase: 96,
    maxTemplatesPerWorkspace: 64,
    maxUsersPerDatabase: 32,
    maxRoleBindingsPerUser: 32,
    supportedIsolationModes: ['shared_cluster', 'dedicated_cluster'],
    supportedClusterTopologies: ['replica_set', 'sharded_cluster'],
    supportedSegregationModels: ['workspace_database', 'tenant_database'],
    defaultIsolationMode: 'dedicated_cluster',
    defaultClusterTopology: 'replica_set',
    defaultSegregationModel: 'tenant_database',
    deploymentProfileId: 'dpf_01enterprisefederated'
  })
});

export const MONGO_ADMIN_MINIMUM_ENGINE_POLICY = Object.freeze({
  shared_cluster: Object.freeze({
    principle: 'tenant_bounded_database_admin',
    requiredBuiltinRoles: ['clusterMonitor', 'userAdminAnyDatabase'],
    forbiddenBuiltinRoles: ['root', 'dbOwnerAnyDatabase'],
    notes: [
      'Shared-cluster control traffic must stay limited to tenant-owned database namespaces.',
      'Role assignment is restricted to read, readWrite, and dbAdmin to avoid privilege bleed across tenants.',
      'Live engine credentials must be referenced indirectly through managed secrets, never echoed through the API.'
    ]
  }),
  dedicated_cluster: Object.freeze({
    principle: 'least_privilege_dedicated_admin',
    requiredBuiltinRoles: ['clusterMonitor', 'userAdminAnyDatabase', 'dbAdminAnyDatabase'],
    forbiddenBuiltinRoles: ['root'],
    notes: [
      'Dedicated clusters may grant dbOwner and userAdmin within the tenant-owned database boundary.',
      'Sharded topologies require inventory snapshots to persist shard-aware collection, index, and view metadata.',
      'Credential rotation must preserve secret indirection and audit linkage across every admin mutation.'
    ]
  })
});

const ERROR_CODE_MAP = new Map([
  ['invalid_payload', { status: 400, code: 'GW_MONGO_INVALID_PAYLOAD' }],
  ['validation_error', { status: 400, code: 'GW_MONGO_VALIDATION_FAILED' }],
  ['forbidden', { status: 403, code: 'GW_MONGO_FORBIDDEN' }],
  ['not_found', { status: 404, code: 'GW_MONGO_NOT_FOUND' }],
  ['conflict', { status: 409, code: 'GW_MONGO_CONFLICT' }],
  ['unsupported_profile', { status: 422, code: 'GW_MONGO_UNSUPPORTED_PROFILE' }],
  ['quota_exceeded', { status: 422, code: 'GW_MONGO_QUOTA_EXCEEDED' }],
  ['unsupported_provider_version', { status: 424, code: 'GW_MONGO_UNSUPPORTED_PROVIDER_VERSION' }],
  ['rate_limited', { status: 429, code: 'GW_MONGO_PROVIDER_RATE_LIMITED', retryable: true }],
  ['dependency_failure', { status: 502, code: 'GW_MONGO_DEPENDENCY_FAILURE', retryable: true }],
  ['timeout', { status: 504, code: 'GW_MONGO_PROVIDER_TIMEOUT', retryable: true }]
]);

function compactDefined(values) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}

function unique(values = []) {
  return [...new Set(values)];
}

function hasDuplicates(values = []) {
  return unique(values).length !== values.length;
}

function normalizeName(name) {
  return typeof name === 'string' ? name.trim() : name;
}

function normalizeObjectKeys(object = {}) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined).map(([key, value]) => [key, value])
  );
}

function parseMongoMajorVersion(version) {
  if (typeof version !== 'string' || version.length === 0) {
    return undefined;
  }

  const major = Number.parseInt(version.split('.')[0], 10);
  return Number.isInteger(major) ? major : undefined;
}

function normalizePasswordBinding(passwordBinding) {
  if (!passwordBinding || typeof passwordBinding !== 'object') {
    return undefined;
  }

  return compactDefined({
    mode: passwordBinding.mode ?? 'managed_secret_ref',
    secretRef: passwordBinding.secretRef,
    rotationPolicy: passwordBinding.rotationPolicy,
    generatedCredentialRef: passwordBinding.generatedCredentialRef
  });
}

function normalizeRoleBinding(roleBinding = {}, context = {}) {
  const databaseName = normalizeName(roleBinding.databaseName ?? context.databaseName);
  const collectionName = normalizeName(roleBinding.collectionName);
  const roleName = normalizeName(roleBinding.roleName ?? roleBinding.role);
  const scope = collectionName ? 'collection' : 'database';
  const roleBindingId =
    roleBinding.roleBindingId ??
    [databaseName, collectionName, roleName].filter(Boolean).join(':').replace(/\s+/g, '');

  return compactDefined({
    roleBindingId,
    roleName,
    scope,
    databaseName,
    collectionName
  });
}

function normalizeRoleBindings(roleBindings = [], context = {}) {
  return unique(
    roleBindings
      .map((entry) => normalizeRoleBinding(entry, context))
      .filter((entry) => entry.roleName)
      .map((entry) => JSON.stringify(entry))
  ).map((entry) => JSON.parse(entry));
}

function normalizeCollectionValidation(validation = {}) {
  if (!validation || typeof validation !== 'object') {
    return undefined;
  }

  return compactDefined({
    level: validation.level ?? 'strict',
    action: validation.action ?? 'error',
    schemaRef: validation.schemaRef,
    validator: validation.validator,
    jsonSchema: validation.jsonSchema,
    description: validation.description
  });
}

function normalizeTimeseriesConfiguration(timeseries = {}) {
  if (!timeseries || typeof timeseries !== 'object') {
    return undefined;
  }

  return compactDefined({
    timeField: normalizeName(timeseries.timeField),
    metaField: normalizeName(timeseries.metaField),
    granularity: timeseries.granularity,
    expireAfterSeconds: timeseries.expireAfterSeconds
  });
}

function normalizeClusteredCollection(clustered = {}) {
  if (clustered === true) {
    return { enabled: true };
  }

  if (!clustered || typeof clustered !== 'object') {
    return undefined;
  }

  return compactDefined({
    enabled: clustered.enabled !== false,
    key: clustered.key ?? {},
    unique: clustered.unique === true,
    name: clustered.name
  });
}

function normalizePrePostImagesConfiguration(prePostImages = {}) {
  if (prePostImages === true) {
    return { enabled: true };
  }

  if (!prePostImages || typeof prePostImages !== 'object') {
    return undefined;
  }

  return compactDefined({
    enabled: prePostImages.enabled !== false,
    captureMode: prePostImages.captureMode ?? 'when_available',
    retainForSeconds: prePostImages.retainForSeconds
  });
}

function normalizeCollectionTemplateBinding(binding = {}) {
  if (!binding || typeof binding !== 'object') {
    return undefined;
  }

  return compactDefined({
    templateId: binding.templateId,
    version: binding.version,
    variables: binding.variables,
    appliedAt: binding.appliedAt
  });
}

function normalizeIndexDefinition(index = {}) {
  if (!index || typeof index !== 'object') {
    return undefined;
  }

  return compactDefined({
    name: normalizeName(index.name ?? index.indexName),
    key: index.key ?? {},
    unique: index.unique === true,
    sparse: index.sparse === true,
    hidden: index.hidden === true,
    ttlSeconds: index.ttlSeconds,
    partialFilterExpression: index.partialFilterExpression,
    collation: index.collation,
    metadata: index.metadata
  });
}

function normalizeCollectionIndexes(indexes = []) {
  return (indexes ?? [])
    .map((index) => normalizeIndexDefinition(index))
    .filter(Boolean);
}

function normalizeIndexRebuildPolicy(rebuild = {}) {
  if (!rebuild || typeof rebuild !== 'object') {
    return undefined;
  }

  return compactDefined({
    strategy: rebuild.strategy ?? 'rolling_shadow',
    allowWritesDuringBuild: rebuild.allowWritesDuringBuild !== false,
    maxParallelCollections: rebuild.maxParallelCollections ?? 1,
    approvalToken: rebuild.approvalToken,
    dryRun: rebuild.dryRun === true,
    reason: rebuild.reason
  });
}

function normalizeCollectionSizeSummary(stats = {}) {
  if (!stats || typeof stats !== 'object') {
    return undefined;
  }

  return compactDefined({
    documentCount: stats.documentCount ?? stats.documents,
    storageBytes: stats.storageBytes,
    indexBytes: stats.indexBytes,
    avgObjectSizeBytes: stats.avgObjectSizeBytes
  });
}

function normalizeCollectionMetadataSummary(metadataSummary = {}, context = {}) {
  if ((!metadataSummary || typeof metadataSummary !== 'object') && !context.configuration && !context.indexDefinitions) {
    return undefined;
  }

  const configuration = context.configuration ?? {};
  const indexDefinitions = context.indexDefinitions ?? [];
  const validation = configuration.validation;
  const size = normalizeCollectionSizeSummary(metadataSummary.size ?? metadataSummary.stats ?? metadataSummary);

  return compactDefined({
    size,
    validation: compactDefined({
      enabled: Boolean(validation),
      level: validation?.level,
      action: validation?.action,
      schemaRef: validation?.schemaRef
    }),
    indexSummary: compactDefined({
      count: metadataSummary.indexSummary?.count ?? indexDefinitions.length,
      ttlManagedCount:
        metadataSummary.indexSummary?.ttlManagedCount ?? indexDefinitions.filter((index) => index.ttlSeconds !== undefined).length,
      hiddenCount: metadataSummary.indexSummary?.hiddenCount ?? indexDefinitions.filter((index) => index.hidden === true).length
    }),
    options: compactDefined({
      timeseries: Boolean(configuration.timeseries),
      clustered: configuration.clustered?.enabled === true,
      prePostImages: configuration.prePostImages?.enabled === true
    })
  });
}

function normalizeViewPipeline(pipeline = []) {
  return (pipeline ?? []).filter((stage) => stage && typeof stage === 'object');
}

function normalizeViewMetadataSummary(metadataSummary = {}, pipeline = []) {
  if (!metadataSummary || typeof metadataSummary !== 'object') {
    return compactDefined({
      stageCount: pipeline.length
    });
  }

  return compactDefined({
    stageCount: metadataSummary.stageCount ?? pipeline.length,
    size: normalizeCollectionSizeSummary(metadataSummary.size ?? metadataSummary.stats),
    readonly: metadataSummary.readonly ?? true,
    sourceKinds: metadataSummary.sourceKinds
  });
}

function normalizeTemplateVariable(variable = {}) {
  if (!variable || typeof variable !== 'object') {
    return undefined;
  }

  return compactDefined({
    name: variable.name,
    required: variable.required === true,
    defaultValue: variable.defaultValue,
    description: variable.description
  });
}

function normalizeTemplateVariables(variables = []) {
  return (variables ?? []).map((variable) => normalizeTemplateVariable(variable)).filter(Boolean);
}

function normalizeTemplateDefaults(defaults = {}) {
  if (!defaults || typeof defaults !== 'object') {
    return undefined;
  }

  return compactDefined({
    collectionType: defaults.collectionType ?? 'standard',
    capped: defaults.capped === true,
    sizeBytes: defaults.sizeBytes,
    maxDocuments: defaults.maxDocuments,
    ttlSeconds: defaults.ttlSeconds,
    validation: normalizeCollectionValidation(defaults.validation),
    indexes: normalizeCollectionIndexes(defaults.indexes),
    shardKey: defaults.shardKey,
    timeseries: normalizeTimeseriesConfiguration(defaults.timeseries),
    clustered: normalizeClusteredCollection(defaults.clustered),
    prePostImages: normalizePrePostImagesConfiguration(defaults.prePostImages)
  });
}

function normalizeDatabaseStats(stats = {}) {
  if (!stats || typeof stats !== 'object') {
    return undefined;
  }

  return compactDefined({
    collectionCount: stats.collectionCount ?? stats.collections,
    viewCount: stats.viewCount ?? stats.views,
    indexCount: stats.indexCount ?? stats.indexes,
    userCount: stats.userCount ?? stats.users,
    documentCount: stats.documentCount ?? stats.documents,
    storageBytes: stats.storageBytes,
    indexBytes: stats.indexBytes,
    avgObjectSizeBytes: stats.avgObjectSizeBytes,
    scaleFactor: stats.scaleFactor
  });
}

export function getMongoCompatibilityMatrix() {
  return SUPPORTED_MONGO_VERSION_RANGES;
}

export function isMongoVersionSupported(version) {
  if (typeof version !== 'string' || version.length === 0) {
    return false;
  }

  return SUPPORTED_MONGO_VERSION_RANGES.some(({ range }) => {
    const [major] = range.split('.');
    return version === range || version.startsWith(`${major}.`);
  });
}

export function resolveMongoAdminProfile(context = {}) {
  const planId = context.planId ?? 'pln_01growth';
  const planGuardrails = MONGO_ADMIN_QUOTA_GUARDRAILS_BY_PLAN[planId] ?? MONGO_ADMIN_QUOTA_GUARDRAILS_BY_PLAN.pln_01growth;
  const isolationMode = context.isolationMode ?? planGuardrails.defaultIsolationMode;
  const clusterTopology = context.clusterTopology ?? planGuardrails.defaultClusterTopology;
  const segregationModel = context.segregationModel ?? planGuardrails.defaultSegregationModel;
  const workspaceKey = (context.workspaceId ?? 'wrk_workspace').replace(/^wrk_/, '');
  const tenantKey = (context.tenantId ?? 'ten_tenant').replace(/^ten_/, '');
  const allowedRoleBindings =
    isolationMode === 'shared_cluster'
      ? MONGO_SHARED_CLUSTER_ALLOWED_ROLE_BINDINGS
      : MONGO_DEDICATED_CLUSTER_ALLOWED_ROLE_BINDINGS;
  const databasePrefix =
    context.databasePrefix ??
    (segregationModel === 'tenant_database' ? `${tenantKey}_` : `${workspaceKey}_`);
  const userPrefix = context.userPrefix ?? `${workspaceKey}_`;
  const collectionPrefix = context.collectionPrefix ?? (segregationModel === 'tenant_database' ? `${workspaceKey}_` : undefined);
  const ownedNamePrefix = segregationModel === 'tenant_database' ? `${tenantKey}_` : `${workspaceKey}_`;

  return {
    provider: 'mongodb',
    planId,
    deploymentProfileId: context.deploymentProfileId ?? planGuardrails.deploymentProfileId,
    clusterProfile:
      context.clusterProfile ?? (isolationMode === 'shared_cluster' ? `${tenantKey}-shared-mongo` : `${tenantKey}-dedicated-mongo`),
    isolationMode,
    clusterTopology,
    segregationModel,
    supportedIsolationModes: planGuardrails.supportedIsolationModes,
    supportedClusterTopologies: planGuardrails.supportedClusterTopologies,
    supportedSegregationModels: planGuardrails.supportedSegregationModels,
    allowedRoleBindings,
    quotaGuardrails: {
      maxDatabasesPerWorkspace: planGuardrails.maxDatabasesPerWorkspace,
      maxDatabasesPerTenant: planGuardrails.maxDatabasesPerTenant,
      maxCollectionsPerDatabase: planGuardrails.maxCollectionsPerDatabase,
      maxCollectionsPerTenant: planGuardrails.maxCollectionsPerTenant,
      maxIndexesPerCollection: planGuardrails.maxIndexesPerCollection,
      maxViewsPerDatabase: planGuardrails.maxViewsPerDatabase,
      maxTemplatesPerWorkspace: planGuardrails.maxTemplatesPerWorkspace,
      maxUsersPerDatabase: planGuardrails.maxUsersPerDatabase,
      maxRoleBindingsPerUser: planGuardrails.maxRoleBindingsPerUser
    },
    namingPolicy: {
      tenantPrefix: `${tenantKey}_`,
      workspacePrefix: `${workspaceKey}_`,
      databasePrefix,
      collectionPrefix,
      userPrefix,
      ownedNamePrefix,
      segregationModel,
      maxDatabaseNameLength: 48,
      maxCollectionNameLength: 64,
      maxUserNameLength: 64,
      maxTemplateIdLength: 80,
      forbiddenDatabaseNames: MONGO_RESERVED_DATABASES,
      forbiddenCollectionPrefixes: MONGO_RESERVED_COLLECTION_PREFIXES
    },
    minimumEnginePolicy: MONGO_ADMIN_MINIMUM_ENGINE_POLICY[isolationMode],
    databaseMutationsSupported: true,
    collectionMutationsSupported: true,
    indexMutationsSupported: true,
    viewMutationsSupported: true,
    templateCatalogSupported: true,
    userMutationsSupported: true,
    roleAssignmentsSupported: true,
    inventorySupported: true
  };
}

function collectBaseViolations(resourceKind, action, context = {}, profile) {
  const violations = [];
  const allowedActions = MONGO_ADMIN_CAPABILITY_MATRIX[resourceKind] ?? [];

  if (!MONGO_ADMIN_RESOURCE_KINDS.includes(resourceKind)) {
    violations.push(`Unsupported MongoDB admin resource kind ${resourceKind}.`);
  }

  if (!allowedActions.includes(action)) {
    violations.push(`MongoDB admin action ${action} is not supported for resource kind ${resourceKind}.`);
  }

  if (!profile.supportedIsolationModes.includes(profile.isolationMode)) {
    violations.push(
      `Isolation mode ${profile.isolationMode} is not available for plan ${profile.planId}; supported modes: ${profile.supportedIsolationModes.join(', ')}.`
    );
  }

  if (!profile.supportedClusterTopologies.includes(profile.clusterTopology)) {
    violations.push(
      `Cluster topology ${profile.clusterTopology} is not available for plan ${profile.planId}; supported topologies: ${profile.supportedClusterTopologies.join(', ')}.`
    );
  }

  if (!profile.supportedSegregationModels.includes(profile.segregationModel)) {
    violations.push(
      `Segregation model ${profile.segregationModel} is not available for plan ${profile.planId}; supported models: ${profile.supportedSegregationModels.join(', ')}.`
    );
  }

  if (profile.clusterTopology === 'sharded_cluster' && profile.isolationMode !== 'dedicated_cluster') {
    violations.push('Sharded cluster topology requires dedicated_cluster isolation.');
  }

  if (context.providerVersion && !isMongoVersionSupported(context.providerVersion)) {
    violations.push(`MongoDB provider version ${context.providerVersion} is outside the supported compatibility matrix.`);
  }

  return violations;
}

function validateDatabaseRequest(action, payload = {}, context = {}, profile) {
  const violations = [];
  const databaseName = normalizeName(payload.databaseName ?? context.databaseName);

  if (action !== 'list' && action !== 'get' && !databaseName) {
    violations.push('databaseName is required for database mutations.');
  }

  if ((action === 'get' || action === 'delete') && !databaseName) {
    violations.push('databaseName is required for database reads and deletes.');
  }

  if (databaseName) {
    if (!/^[a-z0-9][a-z0-9_]{2,47}$/.test(databaseName)) {
      violations.push('databaseName must start with a lowercase letter or digit, use snake_case, and stay under 48 characters.');
    }
    if (MONGO_RESERVED_DATABASES.includes(databaseName)) {
      violations.push(`databaseName ${databaseName} is reserved and cannot be managed through the tenant control surface.`);
    }
    if (context.enforceOwnedPrefix !== false && !databaseName.startsWith(profile.namingPolicy.databasePrefix)) {
      violations.push(`databaseName must start with prefix ${profile.namingPolicy.databasePrefix}.`);
    }
  }

  if (action === 'create' && (context.currentDatabaseCount ?? 0) >= profile.quotaGuardrails.maxDatabasesPerWorkspace) {
    violations.push(
      `database quota exceeded: plan ${profile.planId} allows at most ${profile.quotaGuardrails.maxDatabasesPerWorkspace} databases per workspace.`
    );
  }

  if (action === 'create' && (context.currentTenantDatabaseCount ?? 0) >= profile.quotaGuardrails.maxDatabasesPerTenant) {
    violations.push(
      `tenant database quota exceeded: plan ${profile.planId} allows at most ${profile.quotaGuardrails.maxDatabasesPerTenant} databases per tenant.`
    );
  }

  return violations;
}

function validateCollectionRequest(action, payload = {}, context = {}, profile) {
  const violations = [];
  const databaseName = normalizeName(payload.databaseName ?? context.databaseName);
  const collectionName = normalizeName(payload.collectionName ?? context.collectionName);
  const collectionType = payload.collectionType ?? 'standard';
  const indexes = normalizeCollectionIndexes(payload.indexes ?? []);
  const validation = normalizeCollectionValidation(payload.validation);
  const timeseries = normalizeTimeseriesConfiguration(payload.timeseries);
  const clustered = normalizeClusteredCollection(payload.clustered);
  const prePostImages = normalizePrePostImagesConfiguration(payload.prePostImages);

  if (!databaseName) {
    violations.push('databaseName is required for collection operations.');
  }

  if (action !== 'list' && !collectionName) {
    violations.push('collectionName is required for collection mutations and get operations.');
  }

  if (collectionName) {
    if (!/^[a-z0-9][a-z0-9_]{2,63}$/.test(collectionName)) {
      violations.push('collectionName must start with a lowercase letter or digit, use snake_case, and stay under 64 characters.');
    }
    if (MONGO_RESERVED_COLLECTION_PREFIXES.some((prefix) => collectionName.startsWith(prefix))) {
      violations.push('system.* collections are reserved and cannot be managed through the tenant control surface.');
    }
  }

  if (!MONGO_SUPPORTED_COLLECTION_TYPES.includes(collectionType)) {
    violations.push(`collectionType ${collectionType} is unsupported; allowed values: ${MONGO_SUPPORTED_COLLECTION_TYPES.join(', ')}.`);
  }

  if (payload.capped === true && payload.maxDocuments === undefined && payload.sizeBytes === undefined) {
    violations.push('capped collections must declare maxDocuments or sizeBytes.');
  }

  if (payload.capped === true && collectionType === 'timeseries') {
    violations.push('timeseries collections cannot also be configured as capped collections.');
  }

  if (payload.ttlSeconds !== undefined && (!Number.isInteger(payload.ttlSeconds) || payload.ttlSeconds < 1)) {
    violations.push('ttlSeconds must be a positive integer when provided.');
  }

  if (validation) {
    if (!['off', 'moderate', 'strict'].includes(validation.level)) {
      violations.push('validation.level must be one of off, moderate, or strict.');
    }
    if (!['warn', 'error'].includes(validation.action)) {
      violations.push('validation.action must be one of warn or error.');
    }
    if (!validation.schemaRef && !validation.validator && !validation.jsonSchema) {
      violations.push('validation must declare schemaRef, validator, or jsonSchema when provided.');
    }
  }

  if (timeseries) {
    if (!timeseries.timeField) {
      violations.push('timeseries.timeField is required for time-series collections.');
    }
    if (timeseries.expireAfterSeconds !== undefined && (!Number.isInteger(timeseries.expireAfterSeconds) || timeseries.expireAfterSeconds < 1)) {
      violations.push('timeseries.expireAfterSeconds must be a positive integer when provided.');
    }
    if (collectionType !== 'timeseries') {
      violations.push('timeseries configuration requires collectionType=timeseries.');
    }
  }

  if (clustered?.enabled === true && collectionType === 'timeseries') {
    violations.push('timeseries collections cannot declare clustered collection options explicitly.');
  }

  if (prePostImages?.enabled === true && collectionType === 'timeseries') {
    violations.push('pre/post images are not supported for time-series collections.');
  }

  if (payload.prePostImages && parseMongoMajorVersion(context.providerVersion ?? '6.0') < 6) {
    violations.push('pre/post images require MongoDB 6.x or later.');
  }

  const indexNames = indexes.map((index) => index.name).filter(Boolean);
  if (hasDuplicates(indexNames)) {
    violations.push('index definitions must use unique names.');
  }

  if (indexes.length > profile.quotaGuardrails.maxIndexesPerCollection) {
    violations.push(
      `index quota exceeded: plan ${profile.planId} allows at most ${profile.quotaGuardrails.maxIndexesPerCollection} indexes per collection.`
    );
  }

  for (const index of indexes) {
    if (index.ttlSeconds !== undefined && (!Number.isInteger(index.ttlSeconds) || index.ttlSeconds < 1)) {
      violations.push(`index ${index.name} ttlSeconds must be a positive integer.`);
    }
  }

  if (action === 'create' && (context.currentCollectionCount ?? 0) >= profile.quotaGuardrails.maxCollectionsPerDatabase) {
    violations.push(
      `collection quota exceeded: plan ${profile.planId} allows at most ${profile.quotaGuardrails.maxCollectionsPerDatabase} collections per database.`
    );
  }

  if (action === 'create' && (context.currentTenantCollectionCount ?? 0) >= profile.quotaGuardrails.maxCollectionsPerTenant) {
    violations.push(
      `tenant collection quota exceeded: plan ${profile.planId} allows at most ${profile.quotaGuardrails.maxCollectionsPerTenant} collections per tenant.`
    );
  }

  if (payload.templateBinding?.templateId && Array.isArray(context.availableTemplateIds) && !context.availableTemplateIds.includes(payload.templateBinding.templateId)) {
    violations.push(`collection template ${payload.templateBinding.templateId} is not available in the workspace template catalog.`);
  }

  return violations;
}

function validateIndexRequest(action, payload = {}, context = {}, profile) {
  const violations = [];
  const databaseName = normalizeName(payload.databaseName ?? context.databaseName);
  const collectionName = normalizeName(payload.collectionName ?? context.collectionName);
  const indexName = normalizeName(payload.indexName ?? payload.name ?? context.indexName);
  const definition = normalizeIndexDefinition(payload);
  const rebuild = normalizeIndexRebuildPolicy(payload.rebuild ?? payload.rebuildPolicy);

  if (!databaseName) {
    violations.push('databaseName is required for index operations.');
  }
  if (!collectionName) {
    violations.push('collectionName is required for index operations.');
  }
  if (action !== 'list' && !indexName) {
    violations.push('indexName is required for index mutations and get operations.');
  }
  if (['create', 'update'].includes(action) && (!definition || !definition.key || Object.keys(definition.key).length === 0)) {
    violations.push('index key definition is required for index create/update operations.');
  }
  if (definition?.ttlSeconds !== undefined && (!Number.isInteger(definition.ttlSeconds) || definition.ttlSeconds < 1)) {
    violations.push('index ttlSeconds must be a positive integer when provided.');
  }
  if (action === 'create' && (context.currentIndexCount ?? 0) >= profile.quotaGuardrails.maxIndexesPerCollection) {
    violations.push(
      `index quota exceeded: plan ${profile.planId} allows at most ${profile.quotaGuardrails.maxIndexesPerCollection} indexes per collection.`
    );
  }
  if (action === 'rebuild') {
    if (!rebuild) {
      violations.push('rebuild policy is required for controlled index rebuild operations.');
    } else {
      if (!MONGO_INDEX_REBUILD_STRATEGIES.includes(rebuild.strategy)) {
        violations.push(`rebuild strategy ${rebuild.strategy} is unsupported; allowed values: ${MONGO_INDEX_REBUILD_STRATEGIES.join(', ')}.`);
      }
      if (!Number.isInteger(rebuild.maxParallelCollections) || rebuild.maxParallelCollections !== 1) {
        violations.push('controlled index rebuilds must serialize one collection at a time (maxParallelCollections=1).');
      }
      if (!rebuild.approvalToken) {
        violations.push('controlled index rebuilds require approvalToken evidence.');
      }
    }
  }

  return violations;
}

function validateViewRequest(action, payload = {}, context = {}, profile) {
  const violations = [];
  const databaseName = normalizeName(payload.databaseName ?? context.databaseName);
  const viewName = normalizeName(payload.viewName ?? context.viewName);
  const sourceCollectionName = normalizeName(payload.sourceCollectionName ?? payload.sourceCollection ?? context.sourceCollectionName);
  const pipeline = normalizeViewPipeline(payload.pipeline);

  if (!databaseName) {
    violations.push('databaseName is required for view operations.');
  }
  if (action !== 'list' && !viewName) {
    violations.push('viewName is required for view mutations and get operations.');
  }
  if (['create', 'update'].includes(action) && !sourceCollectionName) {
    violations.push('sourceCollectionName is required for MongoDB view create/update operations.');
  }
  if (['create', 'update'].includes(action) && pipeline.length === 0) {
    violations.push('pipeline must contain at least one aggregation stage for MongoDB views.');
  }
  if (action === 'create' && (context.currentViewCount ?? 0) >= profile.quotaGuardrails.maxViewsPerDatabase) {
    violations.push(
      `view quota exceeded: plan ${profile.planId} allows at most ${profile.quotaGuardrails.maxViewsPerDatabase} views per database.`
    );
  }

  for (const stage of pipeline) {
    const stageKeys = Object.keys(stage);
    if (stageKeys.length !== 1) {
      violations.push('each view pipeline stage must declare exactly one top-level aggregation operator.');
      continue;
    }
    if (MONGO_VIEW_DISALLOWED_PIPELINE_STAGES.includes(stageKeys[0])) {
      violations.push(`view pipeline stage ${stageKeys[0]} is not allowed through the tenant control surface.`);
    }
  }

  return violations;
}

function validateTemplateRequest(action, payload = {}, context = {}, profile) {
  const violations = [];
  const templateId = normalizeName(payload.templateId ?? context.templateId);
  const defaults = normalizeTemplateDefaults(payload.defaults);
  const variables = normalizeTemplateVariables(payload.variables);

  if (action !== 'list' && !templateId) {
    violations.push('templateId is required for template get and mutation operations.');
  }
  if (templateId && !/^[A-Za-z][A-Za-z0-9_-]{2,80}$/.test(templateId)) {
    violations.push('templateId must start with a letter and use only letters, digits, hyphen, or underscore.');
  }
  if (payload.state && !MONGO_COLLECTION_TEMPLATE_STATES.includes(payload.state)) {
    violations.push(`template state ${payload.state} is unsupported; allowed values: ${MONGO_COLLECTION_TEMPLATE_STATES.join(', ')}.`);
  }
  if (action === 'create' && (context.currentTemplateCount ?? 0) >= profile.quotaGuardrails.maxTemplatesPerWorkspace) {
    violations.push(
      `template quota exceeded: plan ${profile.planId} allows at most ${profile.quotaGuardrails.maxTemplatesPerWorkspace} collection templates per workspace.`
    );
  }
  if (hasDuplicates(variables.map((entry) => entry.name))) {
    violations.push('template variables must use unique names.');
  }
  if (defaults?.collectionType === 'timeseries' && defaults.clustered?.enabled === true) {
    violations.push('template defaults cannot combine time-series collections with explicit clustered options.');
  }

  return violations;
}

function validateUserRequest(action, payload = {}, context = {}, profile) {
  const violations = [];
  const username = normalizeName(payload.username ?? context.username ?? context.mongoUserName);
  const databaseName = normalizeName(payload.databaseName ?? context.databaseName);
  const passwordBinding = normalizePasswordBinding(payload.passwordBinding);
  const roleBindings = normalizeRoleBindings(payload.roleBindings ?? payload.roles ?? [], { databaseName });

  if (!databaseName) {
    violations.push('databaseName is required for user operations.');
  }

  if (action !== 'list' && !username) {
    violations.push('username is required for user mutations and get operations.');
  }

  if (username) {
    if (!/^[a-z0-9][a-z0-9_.-]{2,63}$/.test(username)) {
      violations.push('username must start with a lowercase letter or digit and use lowercase letters, digits, dot, underscore, or hyphen.');
    }
    if (context.enforceOwnedPrefix !== false && !username.startsWith(profile.namingPolicy.userPrefix)) {
      violations.push(`username must start with prefix ${profile.namingPolicy.userPrefix}.`);
    }
  }

  if ((action === 'create' || action === 'update') && !passwordBinding && payload.rotatePassword !== true) {
    violations.push('passwordBinding or rotatePassword=true is required for MongoDB user create/update operations.');
  }

  if (passwordBinding && passwordBinding.mode === 'managed_secret_ref' && !passwordBinding.secretRef) {
    violations.push('passwordBinding.secretRef is required when passwordBinding.mode=managed_secret_ref.');
  }

  if (hasDuplicates(roleBindings.map((binding) => binding.roleBindingId))) {
    violations.push('roleBindings must be unique by role/database/collection combination.');
  }

  if (roleBindings.length > profile.quotaGuardrails.maxRoleBindingsPerUser) {
    violations.push(
      `role binding quota exceeded: plan ${profile.planId} allows at most ${profile.quotaGuardrails.maxRoleBindingsPerUser} role bindings per user.`
    );
  }

  for (const roleBinding of roleBindings) {
    if (!profile.allowedRoleBindings.includes(roleBinding.roleName)) {
      violations.push(
        `role ${roleBinding.roleName} is not allowed for ${profile.isolationMode}; allowed roles: ${profile.allowedRoleBindings.join(', ')}.`
      );
    }
    if (roleBinding.collectionName && !['read', 'readWrite'].includes(roleBinding.roleName)) {
      violations.push('Collection-scoped role bindings are limited to read and readWrite.');
    }
  }

  if (action === 'create' && (context.currentUserCount ?? 0) >= profile.quotaGuardrails.maxUsersPerDatabase) {
    violations.push(
      `user quota exceeded: plan ${profile.planId} allows at most ${profile.quotaGuardrails.maxUsersPerDatabase} users per database.`
    );
  }

  return violations;
}

function validateRoleBindingRequest(action, payload = {}, context = {}, profile) {
  const violations = [];
  const username = normalizeName(payload.username ?? context.username ?? context.mongoUserName);
  const databaseName = normalizeName(payload.databaseName ?? context.databaseName);
  const collectionName = normalizeName(payload.collectionName ?? context.collectionName);
  const roleName = normalizeName(payload.roleName ?? payload.role ?? context.roleName);

  if (!username) {
    violations.push('username is required for role assignment and revocation.');
  }
  if (!databaseName) {
    violations.push('databaseName is required for role assignment and revocation.');
  }
  if (!roleName) {
    violations.push('roleName is required for role assignment and revocation.');
  }
  if (roleName && !profile.allowedRoleBindings.includes(roleName)) {
    violations.push(`role ${roleName} is not allowed for ${profile.isolationMode}.`);
  }
  if (collectionName && !['read', 'readWrite'].includes(roleName)) {
    violations.push('Collection-scoped role bindings are limited to read and readWrite.');
  }
  if (action === 'assign' && (context.currentRoleBindingCount ?? 0) >= profile.quotaGuardrails.maxRoleBindingsPerUser) {
    violations.push(
      `role binding quota exceeded: plan ${profile.planId} allows at most ${profile.quotaGuardrails.maxRoleBindingsPerUser} role bindings per user.`
    );
  }

  return violations;
}

export function validateMongoAdminRequest({ resourceKind, action, context = {}, payload = {} }) {
  const profile = resolveMongoAdminProfile(context);
  const violations = collectBaseViolations(resourceKind, action, context, profile);

  switch (resourceKind) {
    case 'database':
      violations.push(...validateDatabaseRequest(action, payload, context, profile));
      break;
    case 'collection':
      violations.push(...validateCollectionRequest(action, payload, context, profile));
      break;
    case 'index':
      violations.push(...validateIndexRequest(action, payload, context, profile));
      break;
    case 'view':
      violations.push(...validateViewRequest(action, payload, context, profile));
      break;
    case 'template':
      violations.push(...validateTemplateRequest(action, payload, context, profile));
      break;
    case 'user':
      violations.push(...validateUserRequest(action, payload, context, profile));
      break;
    case 'role_binding':
      violations.push(...validateRoleBindingRequest(action, payload, context, profile));
      break;
    default:
      break;
  }

  return {
    ok: violations.length === 0,
    violations,
    profile
  };
}

function buildProviderCompatibility(profile) {
  return {
    provider: 'mongodb',
    contractVersion: mongoAdminRequestContract?.version ?? '2026-03-25',
    supportedVersions: SUPPORTED_MONGO_VERSION_RANGES.map(({ range }) => range),
    supportedTopologies: MONGO_ADMIN_CLUSTER_TOPOLOGIES,
    supportedIsolationModes: MONGO_ADMIN_ISOLATION_MODES,
    supportedSegregationModels: MONGO_ADMIN_SEGREGATION_MODELS,
    activeSegregationModel: profile.segregationModel
  };
}

function buildTenantIsolation(profile) {
  return {
    isolationMode: profile.isolationMode,
    segregationModel: profile.segregationModel,
    ownedNamePrefix: profile.namingPolicy.ownedNamePrefix,
    databasePrefix: profile.namingPolicy.databasePrefix,
    collectionPrefix: profile.namingPolicy.collectionPrefix,
    roleBindingScope: profile.allowedRoleBindings,
    sharedClusterRoleCap: profile.allowedRoleBindings
  };
}

export function normalizeMongoAdminResource(resourceKind, payload = {}, context = {}) {
  const profile = resolveMongoAdminProfile(context);
  const providerCompatibility = buildProviderCompatibility(profile);

  switch (resourceKind) {
    case 'database':
      return compactDefined({
        resourceType: 'mongo_database',
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        databaseName: normalizeName(payload.databaseName ?? context.databaseName),
        engine: 'mongodb',
        clusterProfile: profile.clusterProfile,
        isolationMode: profile.isolationMode,
        clusterTopology: profile.clusterTopology,
        segregationModel: profile.segregationModel,
        status: payload.status ?? 'active',
        timestamps: payload.timestamps,
        provisioning: payload.provisioning,
        stats: normalizeDatabaseStats(payload.stats),
        namingPolicy: profile.namingPolicy,
        quotaGuardrails: profile.quotaGuardrails,
        tenantIsolation: buildTenantIsolation(profile),
        metadata: payload.metadata ?? {},
        providerCompatibility
      });
    case 'collection': {
      const configuration = compactDefined({
        capped: payload.capped === true,
        sizeBytes: payload.sizeBytes,
        maxDocuments: payload.maxDocuments,
        ttlSeconds: payload.ttlSeconds,
        validation: normalizeCollectionValidation(payload.validation),
        shardKey: payload.shardKey,
        timeseries: normalizeTimeseriesConfiguration(payload.timeseries),
        clustered: normalizeClusteredCollection(payload.clustered),
        prePostImages: normalizePrePostImagesConfiguration(payload.prePostImages),
        templateBinding: normalizeCollectionTemplateBinding(payload.templateBinding)
      });
      const indexDefinitions = normalizeCollectionIndexes(payload.indexes ?? payload.indexDefinitions ?? []);

      return compactDefined({
        resourceType: 'mongo_collection',
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        databaseName: normalizeName(payload.databaseName ?? context.databaseName),
        collectionName: normalizeName(payload.collectionName ?? context.collectionName),
        collectionType: payload.collectionType ?? 'standard',
        isolationMode: profile.isolationMode,
        clusterTopology: profile.clusterTopology,
        segregationModel: profile.segregationModel,
        status: payload.status ?? 'active',
        configuration,
        indexDefinitions,
        metadataSummary: normalizeCollectionMetadataSummary(payload.metadataSummary, { configuration, indexDefinitions }),
        metadata: payload.metadata ?? {},
        tenantIsolation: buildTenantIsolation(profile),
        providerCompatibility
      });
    }
    case 'index': {
      const definition = normalizeIndexDefinition(payload);
      return compactDefined({
        resourceType: 'mongo_index',
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        databaseName: normalizeName(payload.databaseName ?? context.databaseName),
        collectionName: normalizeName(payload.collectionName ?? context.collectionName),
        indexName: normalizeName(payload.indexName ?? payload.name ?? context.indexName),
        status: payload.status ?? 'active',
        definition,
        rebuildPolicy: normalizeIndexRebuildPolicy(payload.rebuild ?? payload.rebuildPolicy),
        metadataSummary: compactDefined({
          size: normalizeCollectionSizeSummary(payload.metadataSummary?.size ?? payload.size),
          usageSince: payload.metadataSummary?.usageSince,
          lastRebuildAt: payload.metadataSummary?.lastRebuildAt,
          lastRebuildOutcome: payload.metadataSummary?.lastRebuildOutcome
        }),
        metadata: payload.metadata ?? {},
        providerCompatibility
      });
    }
    case 'view': {
      const pipeline = normalizeViewPipeline(payload.pipeline);
      return compactDefined({
        resourceType: 'mongo_view',
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        databaseName: normalizeName(payload.databaseName ?? context.databaseName),
        viewName: normalizeName(payload.viewName ?? context.viewName),
        sourceCollectionName: normalizeName(payload.sourceCollectionName ?? payload.sourceCollection ?? context.sourceCollectionName),
        pipeline,
        collation: payload.collation,
        readonly: payload.readonly ?? true,
        status: payload.status ?? 'active',
        metadataSummary: normalizeViewMetadataSummary(payload.metadataSummary, pipeline),
        metadata: payload.metadata ?? {},
        providerCompatibility
      });
    }
    case 'template':
      return compactDefined({
        resourceType: 'mongo_collection_template',
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        templateId: normalizeName(payload.templateId ?? context.templateId),
        templateScope: 'collection',
        segregationModel: profile.segregationModel,
        description: payload.description,
        defaults: normalizeTemplateDefaults(payload.defaults),
        variables: normalizeTemplateVariables(payload.variables),
        state: payload.state ?? 'active',
        metadata: payload.metadata ?? {},
        providerCompatibility
      });
    case 'user':
      return compactDefined({
        resourceType: 'mongo_user',
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        databaseName: normalizeName(payload.databaseName ?? context.databaseName),
        username: normalizeName(payload.username ?? context.username ?? context.mongoUserName),
        status: payload.status ?? 'active',
        authenticationDatabase: payload.authenticationDatabase ?? payload.databaseName ?? context.databaseName,
        passwordBinding: normalizePasswordBinding(payload.passwordBinding),
        roleBindings: normalizeRoleBindings(payload.roleBindings ?? payload.roles ?? [], {
          databaseName: payload.databaseName ?? context.databaseName
        }),
        authenticationRestrictions: payload.authenticationRestrictions ?? [],
        metadata: payload.metadata ?? {},
        providerCompatibility
      });
    case 'role_binding':
      return compactDefined({
        resourceType: 'mongo_role_binding',
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        username: normalizeName(payload.username ?? context.username ?? context.mongoUserName),
        ...normalizeRoleBinding(payload, { databaseName: payload.databaseName ?? context.databaseName }),
        providerCompatibility
      });
    default:
      throw new Error(`Unsupported MongoDB admin resource kind ${resourceKind}.`);
  }
}

export function normalizeMongoAdminError(error = {}, context = {}) {
  const classification =
    error.classification ??
    (error.status === 404 ? 'not_found' : undefined) ??
    (error.status === 409 ? 'conflict' : undefined) ??
    (error.status === 429 ? 'rate_limited' : undefined) ??
    (error.status === 504 ? 'timeout' : undefined) ??
    'dependency_failure';

  const mapped = ERROR_CODE_MAP.get(classification) ?? ERROR_CODE_MAP.get('dependency_failure');

  return {
    status: error.status ?? mapped.status,
    code: mapped.code,
    title: error.title ?? 'MongoDB administrative operation failed.',
    detail: {
      resourceKind: context.resourceKind,
      action: context.action,
      targetRef: context.targetRef,
      databaseName: context.databaseName,
      collectionName: context.collectionName,
      indexName: context.indexName,
      viewName: context.viewName,
      templateId: context.templateId,
      username: context.username ?? context.mongoUserName,
      providerError: error.providerError,
      classification
    },
    retryable: error.retryable ?? mapped.retryable === true,
    providerError: error.providerError,
    message: error.message ?? 'MongoDB administrative operation failed.'
  };
}

function buildCapabilityName(resourceKind, action) {
  return `mongo_${resourceKind}_${action}`;
}

function deriveTargetRef(resourceKind, payload = {}, context = {}) {
  const databaseName = normalizeName(payload.databaseName ?? context.databaseName);
  const collectionName = normalizeName(payload.collectionName ?? context.collectionName);
  const username = normalizeName(payload.username ?? context.username ?? context.mongoUserName);
  const roleName = normalizeName(payload.roleName ?? payload.role ?? context.roleName);
  const indexName = normalizeName(payload.indexName ?? payload.name ?? context.indexName);
  const viewName = normalizeName(payload.viewName ?? context.viewName);
  const templateId = normalizeName(payload.templateId ?? context.templateId);

  switch (resourceKind) {
    case 'database':
      return `database:${databaseName}`;
    case 'collection':
      return `collection:${databaseName}.${collectionName}`;
    case 'index':
      return `index:${databaseName}.${collectionName}.${indexName}`;
    case 'view':
      return `view:${databaseName}.${viewName}`;
    case 'template':
      return `template:${templateId}`;
    case 'user':
      return `user:${databaseName}.${username}`;
    case 'role_binding':
      return `role_binding:${username}:${databaseName}:${collectionName ?? '*'}:${roleName}`;
    default:
      return `mongo:${resourceKind}`;
  }
}

export function buildMongoAdminAdapterCall({
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
  originSurface
}) {
  const validation = validateMongoAdminRequest({ resourceKind, action, context, payload });
  if (!validation.ok) {
    return {
      ok: false,
      violations: validation.violations,
      profile: validation.profile
    };
  }

  const normalizedResource = normalizeMongoAdminResource(resourceKind, payload, context);

  return {
    adapter_id: 'mongodb',
    contract_version: mongoAdminRequestContract?.version ?? '2026-03-25',
    call_id: callId,
    capability: buildCapabilityName(resourceKind, action),
    tenant_id: tenantId,
    workspace_id: workspaceId,
    plan_id: planId ?? validation.profile.planId,
    deployment_profile_id: validation.profile.deploymentProfileId,
    correlation_id: correlationId,
    authorization_decision_id: authorizationDecisionId,
    idempotency_key: idempotencyKey,
    target_ref: targetRef ?? deriveTargetRef(resourceKind, payload, context),
    actor_id: actorId,
    actor_type: actorType,
    origin_surface: originSurface,
    scopes,
    effective_roles: effectiveRoles,
    provider_version: context.providerVersion,
    payload: {
      resourceKind,
      action,
      requestedResource: normalizeObjectKeys(payload),
      normalizedResource,
      context: compactDefined({
        scope: context.scope ?? 'workspace',
        databaseName: payload.databaseName ?? context.databaseName,
        collectionName: payload.collectionName ?? context.collectionName,
        indexName: payload.indexName ?? payload.name ?? context.indexName,
        viewName: payload.viewName ?? context.viewName,
        templateId: payload.templateId ?? context.templateId,
        username: payload.username ?? context.username ?? context.mongoUserName,
        isolationMode: validation.profile.isolationMode,
        clusterTopology: validation.profile.clusterTopology,
        segregationModel: validation.profile.segregationModel,
        clusterProfile: validation.profile.clusterProfile,
        providerVersion: context.providerVersion
      })
    }
  };
}

export function buildMongoInventorySnapshot({
  snapshotId,
  tenantId,
  workspaceId,
  planId,
  context = {},
  databases = [],
  collections = [],
  indexes = [],
  views = [],
  templates = [],
  users = [],
  roleBindings = [],
  observedAt = '2026-03-25T00:00:00Z'
}) {
  const profile = resolveMongoAdminProfile({ planId, ...context, tenantId, workspaceId });

  return {
    snapshotId,
    tenantId,
    workspaceId,
    isolationMode: profile.isolationMode,
    clusterTopology: profile.clusterTopology,
    segregationModel: profile.segregationModel,
    clusterProfile: profile.clusterProfile,
    counts: {
      databases: databases.length,
      collections: collections.length,
      indexes: indexes.length,
      views: views.length,
      templates: templates.length,
      users: users.length,
      roleBindings: roleBindings.length
    },
    quotas: profile.quotaGuardrails,
    namingPolicy: profile.namingPolicy,
    minimumEnginePolicy: profile.minimumEnginePolicy,
    tenantIsolation: buildTenantIsolation(profile),
    supportedTopologies: profile.supportedClusterTopologies,
    supportedSegregationModels: profile.supportedSegregationModels,
    databaseRefs: databases.map((database) => database.databaseName ?? database),
    collectionRefs: collections.map((collection) => ({
      databaseName: collection.databaseName,
      collectionName: collection.collectionName,
      collectionType: collection.collectionType,
      size: normalizeCollectionSizeSummary(collection.metadataSummary?.size ?? collection.size ?? collection.stats),
      validationEnabled: Boolean(collection.configuration?.validation),
      timeseries: collection.collectionType === 'timeseries'
    })),
    indexRefs: indexes.map((index) => ({
      databaseName: index.databaseName,
      collectionName: index.collectionName,
      indexName: index.indexName ?? index.name,
      ttlSeconds: index.definition?.ttlSeconds ?? index.ttlSeconds
    })),
    viewRefs: views.map((view) => ({
      databaseName: view.databaseName,
      viewName: view.viewName,
      sourceCollectionName: view.sourceCollectionName
    })),
    templateRefs: templates.map((template) => ({
      templateId: template.templateId,
      state: template.state ?? 'active'
    })),
    userRefs: users.map((user) => ({
      databaseName: user.databaseName,
      username: user.username
    })),
    observedAt,
    contractVersion: mongoInventorySnapshotContract?.version ?? '2026-03-25'
  };
}
