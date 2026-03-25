import {
  getAdapterPort,
  getContract
} from '../../internal-contracts/src/index.mjs';

export const mongodbAdminAdapterPort = getAdapterPort('mongodb');
export const mongoAdminRequestContract = getContract('mongo_admin_request');
export const mongoAdminResultContract = getContract('mongo_admin_result');
export const mongoInventorySnapshotContract = getContract('mongo_inventory_snapshot');

export const MONGO_ADMIN_RESOURCE_KINDS = Object.freeze(['database', 'collection', 'user', 'role_binding']);
export const MONGO_ADMIN_MUTATION_ACTIONS = Object.freeze(['create', 'update', 'delete', 'assign', 'revoke']);
export const MONGO_ADMIN_ISOLATION_MODES = Object.freeze(['shared_cluster', 'dedicated_cluster']);
export const MONGO_ADMIN_CLUSTER_TOPOLOGIES = Object.freeze(['replica_set', 'sharded_cluster']);
export const MONGO_RESERVED_DATABASES = Object.freeze(['admin', 'config', 'local']);
export const MONGO_RESERVED_COLLECTION_PREFIXES = Object.freeze(['system.']);
export const MONGO_SHARED_CLUSTER_ALLOWED_ROLE_BINDINGS = Object.freeze(['read', 'readWrite', 'dbAdmin']);
export const MONGO_DEDICATED_CLUSTER_ALLOWED_ROLE_BINDINGS = Object.freeze(['read', 'readWrite', 'dbAdmin', 'dbOwner', 'userAdmin']);
export const MONGO_SUPPORTED_COLLECTION_TYPES = Object.freeze(['standard', 'timeseries']);

export const SUPPORTED_MONGO_VERSION_RANGES = Object.freeze([
  {
    range: '6.x',
    label: 'MongoDB 6.x',
    adminApiStability: 'stable_v1',
    topologies: ['replica_set', 'sharded_cluster'],
    isolationModes: ['shared_cluster', 'dedicated_cluster'],
    guarantees: [
      'Database list/get/create/delete flows preserve a BaaS-native contract with dbStats projections.',
      'Collection CRUD and basic validation/capped/time-series configuration remain normalized and secret-free.',
      'User CRUD plus tenant-bounded role assignment/revocation keep provider-specific payloads behind the adapter surface.'
    ]
  },
  {
    range: '7.x',
    label: 'MongoDB 7.x',
    adminApiStability: 'stable_v1',
    topologies: ['replica_set', 'sharded_cluster'],
    isolationModes: ['shared_cluster', 'dedicated_cluster'],
    guarantees: [
      'Database list/get/create/delete flows preserve a BaaS-native contract with dbStats projections.',
      'Collection CRUD and basic validation/capped/time-series configuration remain normalized and secret-free.',
      'User CRUD plus tenant-bounded role assignment/revocation keep provider-specific payloads behind the adapter surface.'
    ]
  },
  {
    range: '8.x',
    label: 'MongoDB 8.x',
    adminApiStability: 'stable_v1',
    topologies: ['replica_set', 'sharded_cluster'],
    isolationModes: ['shared_cluster', 'dedicated_cluster'],
    guarantees: [
      'Database list/get/create/delete flows preserve a BaaS-native contract with dbStats projections.',
      'Collection CRUD and basic validation/capped/time-series configuration remain normalized and secret-free.',
      'User CRUD plus tenant-bounded role assignment/revocation keep provider-specific payloads behind the adapter surface.'
    ]
  }
]);

export const MONGO_ADMIN_CAPABILITY_MATRIX = Object.freeze({
  database: Object.freeze(['list', 'get', 'create', 'delete']),
  collection: Object.freeze(['list', 'get', 'create', 'update', 'delete']),
  user: Object.freeze(['list', 'get', 'create', 'update', 'delete']),
  role_binding: Object.freeze(['assign', 'revoke'])
});

export const MONGO_ADMIN_QUOTA_GUARDRAILS_BY_PLAN = Object.freeze({
  pln_01starter: Object.freeze({
    maxDatabasesPerWorkspace: 1,
    maxCollectionsPerDatabase: 24,
    maxUsersPerDatabase: 4,
    maxRoleBindingsPerUser: 4,
    supportedIsolationModes: ['shared_cluster'],
    supportedClusterTopologies: ['replica_set'],
    defaultIsolationMode: 'shared_cluster',
    defaultClusterTopology: 'replica_set',
    deploymentProfileId: 'dpf_01sharedstarter'
  }),
  pln_01growth: Object.freeze({
    maxDatabasesPerWorkspace: 3,
    maxCollectionsPerDatabase: 48,
    maxUsersPerDatabase: 8,
    maxRoleBindingsPerUser: 8,
    supportedIsolationModes: ['shared_cluster'],
    supportedClusterTopologies: ['replica_set'],
    defaultIsolationMode: 'shared_cluster',
    defaultClusterTopology: 'replica_set',
    deploymentProfileId: 'dpf_01sharedgrowth'
  }),
  pln_01regulated: Object.freeze({
    maxDatabasesPerWorkspace: 5,
    maxCollectionsPerDatabase: 96,
    maxUsersPerDatabase: 16,
    maxRoleBindingsPerUser: 16,
    supportedIsolationModes: ['dedicated_cluster'],
    supportedClusterTopologies: ['replica_set'],
    defaultIsolationMode: 'dedicated_cluster',
    defaultClusterTopology: 'replica_set',
    deploymentProfileId: 'dpf_01regulateddedicated'
  }),
  pln_01enterprise: Object.freeze({
    maxDatabasesPerWorkspace: 12,
    maxCollectionsPerDatabase: 256,
    maxUsersPerDatabase: 32,
    maxRoleBindingsPerUser: 32,
    supportedIsolationModes: ['shared_cluster', 'dedicated_cluster'],
    supportedClusterTopologies: ['replica_set', 'sharded_cluster'],
    defaultIsolationMode: 'dedicated_cluster',
    defaultClusterTopology: 'replica_set',
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
      'Sharded topologies require inventory snapshots to persist shard-aware collection metadata.',
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

function normalizeCollectionIndexes(indexes = []) {
  return (indexes ?? []).map((index) => ({
    name: index.name,
    key: index.key ?? {},
    unique: index.unique === true,
    sparse: index.sparse === true,
    ttlSeconds: index.ttlSeconds,
    collation: index.collation
  }));
}

function normalizeCollectionValidation(validation = {}) {
  if (!validation || typeof validation !== 'object') {
    return undefined;
  }

  return compactDefined({
    level: validation.level ?? 'strict',
    action: validation.action ?? 'error',
    schemaRef: validation.schemaRef,
    validator: validation.validator
  });
}

function normalizeDatabaseStats(stats = {}) {
  if (!stats || typeof stats !== 'object') {
    return undefined;
  }

  return compactDefined({
    collectionCount: stats.collectionCount ?? stats.collections,
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
  const workspaceKey = (context.workspaceId ?? 'wrk_workspace').replace(/^wrk_/, '');
  const tenantKey = (context.tenantId ?? 'ten_tenant').replace(/^ten_/, '');
  const allowedRoleBindings =
    isolationMode === 'shared_cluster'
      ? MONGO_SHARED_CLUSTER_ALLOWED_ROLE_BINDINGS
      : MONGO_DEDICATED_CLUSTER_ALLOWED_ROLE_BINDINGS;
  const databasePrefix = context.databasePrefix ?? `${workspaceKey}_`;
  const userPrefix = context.userPrefix ?? `${workspaceKey}_`;

  return {
    provider: 'mongodb',
    planId,
    deploymentProfileId: context.deploymentProfileId ?? planGuardrails.deploymentProfileId,
    clusterProfile:
      context.clusterProfile ?? (isolationMode === 'shared_cluster' ? `${tenantKey}-shared-mongo` : `${tenantKey}-dedicated-mongo`),
    isolationMode,
    clusterTopology,
    supportedIsolationModes: planGuardrails.supportedIsolationModes,
    supportedClusterTopologies: planGuardrails.supportedClusterTopologies,
    allowedRoleBindings,
    quotaGuardrails: {
      maxDatabasesPerWorkspace: planGuardrails.maxDatabasesPerWorkspace,
      maxCollectionsPerDatabase: planGuardrails.maxCollectionsPerDatabase,
      maxUsersPerDatabase: planGuardrails.maxUsersPerDatabase,
      maxRoleBindingsPerUser: planGuardrails.maxRoleBindingsPerUser
    },
    namingPolicy: {
      tenantPrefix: `${tenantKey}_`,
      databasePrefix,
      userPrefix,
      maxDatabaseNameLength: 48,
      maxCollectionNameLength: 64,
      maxUserNameLength: 64,
      forbiddenDatabaseNames: MONGO_RESERVED_DATABASES,
      forbiddenCollectionPrefixes: MONGO_RESERVED_COLLECTION_PREFIXES
    },
    minimumEnginePolicy: MONGO_ADMIN_MINIMUM_ENGINE_POLICY[isolationMode],
    databaseMutationsSupported: true,
    collectionMutationsSupported: true,
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

  return violations;
}

function validateCollectionRequest(action, payload = {}, context = {}, profile) {
  const violations = [];
  const databaseName = normalizeName(payload.databaseName ?? context.databaseName);
  const collectionName = normalizeName(payload.collectionName ?? context.collectionName);
  const collectionType = payload.collectionType ?? 'standard';
  const indexes = normalizeCollectionIndexes(payload.indexes ?? []);

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

  const indexNames = indexes.map((index) => index.name).filter(Boolean);
  if (hasDuplicates(indexNames)) {
    violations.push('index definitions must use unique names.');
  }

  if (action === 'create' && (context.currentCollectionCount ?? 0) >= profile.quotaGuardrails.maxCollectionsPerDatabase) {
    violations.push(
      `collection quota exceeded: plan ${profile.planId} allows at most ${profile.quotaGuardrails.maxCollectionsPerDatabase} collections per database.`
    );
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

export function normalizeMongoAdminResource(resourceKind, payload = {}, context = {}) {
  const profile = resolveMongoAdminProfile(context);
  const providerCompatibility = {
    provider: 'mongodb',
    contractVersion: mongoAdminRequestContract?.version ?? '2026-03-24',
    supportedVersions: SUPPORTED_MONGO_VERSION_RANGES.map(({ range }) => range),
    supportedTopologies: MONGO_ADMIN_CLUSTER_TOPOLOGIES,
    supportedIsolationModes: MONGO_ADMIN_ISOLATION_MODES
  };

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
        status: payload.status ?? 'active',
        timestamps: payload.timestamps,
        provisioning: payload.provisioning,
        stats: normalizeDatabaseStats(payload.stats),
        namingPolicy: profile.namingPolicy,
        tenantIsolation: {
          isolationMode: profile.isolationMode,
          ownedNamePrefix: profile.namingPolicy.databasePrefix,
          roleBindingScope: profile.allowedRoleBindings
        },
        metadata: payload.metadata ?? {},
        providerCompatibility
      });
    case 'collection':
      return compactDefined({
        resourceType: 'mongo_collection',
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        databaseName: normalizeName(payload.databaseName ?? context.databaseName),
        collectionName: normalizeName(payload.collectionName ?? context.collectionName),
        collectionType: payload.collectionType ?? 'standard',
        status: payload.status ?? 'active',
        configuration: compactDefined({
          capped: payload.capped === true,
          sizeBytes: payload.sizeBytes,
          maxDocuments: payload.maxDocuments,
          ttlSeconds: payload.ttlSeconds,
          validation: normalizeCollectionValidation(payload.validation),
          shardKey: payload.shardKey,
          timeseries: payload.timeseries
        }),
        indexDefinitions: normalizeCollectionIndexes(payload.indexes ?? []),
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

  switch (resourceKind) {
    case 'database':
      return `database:${databaseName}`;
    case 'collection':
      return `collection:${databaseName}.${collectionName}`;
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
    contract_version: mongoAdminRequestContract?.version ?? '2026-03-24',
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
        username: payload.username ?? context.username ?? context.mongoUserName,
        isolationMode: validation.profile.isolationMode,
        clusterTopology: validation.profile.clusterTopology,
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
  users = [],
  roleBindings = [],
  observedAt = '2026-03-24T00:00:00Z'
}) {
  const profile = resolveMongoAdminProfile({ planId, ...context, tenantId, workspaceId });

  return {
    snapshotId,
    tenantId,
    workspaceId,
    isolationMode: profile.isolationMode,
    clusterTopology: profile.clusterTopology,
    clusterProfile: profile.clusterProfile,
    counts: {
      databases: databases.length,
      collections: collections.length,
      users: users.length,
      roleBindings: roleBindings.length
    },
    quotas: profile.quotaGuardrails,
    namingPolicy: profile.namingPolicy,
    minimumEnginePolicy: profile.minimumEnginePolicy,
    tenantIsolation: {
      isolationMode: profile.isolationMode,
      ownedNamePrefix: profile.namingPolicy.databasePrefix,
      sharedClusterRoleCap: profile.allowedRoleBindings
    },
    supportedTopologies: profile.supportedClusterTopologies,
    databaseRefs: databases.map((database) => database.databaseName ?? database),
    collectionRefs: collections.map((collection) => ({
      databaseName: collection.databaseName,
      collectionName: collection.collectionName
    })),
    userRefs: users.map((user) => ({
      databaseName: user.databaseName,
      username: user.username
    })),
    observedAt,
    contractVersion: mongoInventorySnapshotContract?.version ?? '2026-03-24'
  };
}
