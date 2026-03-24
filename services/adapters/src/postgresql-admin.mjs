import {
  getAdapterPort,
  getCommercialPlan,
  getContract,
  getDeploymentProfileCatalogEntry
} from '../../internal-contracts/src/index.mjs';
import {
  POSTGRES_STRUCTURAL_RESOURCE_KINDS,
  buildAllowedPostgresTypeCatalog,
  buildPostgresStructuralSqlPlan,
  normalizePostgresStructuralResource,
  validatePostgresStructuralRequest
} from './postgresql-structural-admin.mjs';

export const postgresqlAdminAdapterPort = getAdapterPort('postgresql');
export const postgresAdminRequestContract = getContract('postgres_admin_request');
export const postgresAdminResultContract = getContract('postgres_admin_result');
export const postgresInventorySnapshotContract = getContract('postgres_inventory_snapshot');

export const POSTGRES_ADMIN_RESOURCE_KINDS = Object.freeze([
  'role',
  'user',
  'database',
  'schema',
  ...POSTGRES_STRUCTURAL_RESOURCE_KINDS
]);
export const POSTGRES_ADMIN_ACTIONS = Object.freeze(['list', 'get', 'create', 'update', 'delete']);

export const RESERVED_POSTGRES_ROLE_NAMES = Object.freeze([
  'postgres',
  'pg_database_owner',
  'pg_monitor',
  'pg_read_all_data',
  'pg_write_all_data',
  'pg_signal_backend',
  'platform_runtime',
  'platform_migrator',
  'platform_provisioner',
  'platform_audit_readonly',
  'platform_break_glass'
]);
export const RESERVED_POSTGRES_DATABASE_NAMES = Object.freeze(['postgres', 'template0', 'template1']);
export const RESERVED_POSTGRES_SCHEMA_NAMES = Object.freeze(['public', 'information_schema', 'pg_catalog']);
export const FORBIDDEN_ENGINE_DETAIL_FIELDS = Object.freeze([
  'password',
  'passwordHash',
  'rawSql',
  'sql',
  'superuser',
  'replication',
  'bypassRls',
  'connectionString',
  'tablespace',
  'oid',
  'templateDatabase',
  'searchPath',
  'rolconfig'
]);

export const SUPPORTED_POSTGRES_VERSION_RANGES = Object.freeze([
  {
    range: '15.x',
    label: 'PostgreSQL 15.x',
    adminApiStability: 'stable_v1',
    supportedResources: POSTGRES_ADMIN_RESOURCE_KINDS,
    placementModes: ['schema_per_tenant', 'database_per_tenant'],
    guarantees: [
      'Normalized CRUD/list coverage is available for roles, users, databases, schemas, tables, columns, and allowed type catalogs.',
      'Provider payloads remain secret-free and bounded by the BaaS contracts.',
      'Shared-schema and dedicated-database placement validation are contract-tested.'
    ]
  },
  {
    range: '16.x',
    label: 'PostgreSQL 16.x',
    adminApiStability: 'stable_v1',
    supportedResources: POSTGRES_ADMIN_RESOURCE_KINDS,
    placementModes: ['schema_per_tenant', 'database_per_tenant'],
    guarantees: [
      'Normalized CRUD/list coverage is available for roles, users, databases, schemas, tables, columns, and allowed type catalogs.',
      'Provider payloads remain secret-free and bounded by the BaaS contracts.',
      'Shared-schema and dedicated-database placement validation are contract-tested.'
    ]
  },
  {
    range: '17.x',
    label: 'PostgreSQL 17.x',
    adminApiStability: 'stable_v1',
    supportedResources: POSTGRES_ADMIN_RESOURCE_KINDS,
    placementModes: ['schema_per_tenant', 'database_per_tenant'],
    guarantees: [
      'Normalized CRUD/list coverage is available for roles, users, databases, schemas, tables, columns, and allowed type catalogs.',
      'Provider payloads remain secret-free and bounded by the BaaS contracts.',
      'Shared-schema and dedicated-database placement validation are contract-tested.'
    ]
  }
]);

export const POSTGRES_ADMIN_CAPABILITY_MATRIX = Object.freeze({
  role: Object.freeze(['list', 'get', 'create', 'update', 'delete']),
  user: Object.freeze(['list', 'get', 'create', 'update', 'delete']),
  database: Object.freeze(['list', 'get', 'create', 'update', 'delete']),
  schema: Object.freeze(['list', 'get', 'create', 'update', 'delete']),
  table: Object.freeze(['list', 'get', 'create', 'update', 'delete']),
  column: Object.freeze(['list', 'get', 'create', 'update', 'delete']),
  type: Object.freeze(['list', 'get']),
  constraint: Object.freeze(['list', 'get', 'create', 'update', 'delete']),
  index: Object.freeze(['list', 'get', 'create', 'update', 'delete']),
  view: Object.freeze(['list', 'get', 'create', 'update', 'delete']),
  materialized_view: Object.freeze(['list', 'get', 'create', 'update', 'delete']),
  function: Object.freeze(['list', 'get', 'create', 'update', 'delete']),
  procedure: Object.freeze(['list', 'get', 'create', 'update', 'delete'])
});

export const POSTGRES_ADMIN_QUOTA_GUARDRAILS_BY_PLAN = Object.freeze({
  pln_01starter: Object.freeze({
    roles: { limit: 16, scope: 'workspace', metricKey: 'workspace.postgres.roles.max' },
    users: { limit: 24, scope: 'workspace', metricKey: 'workspace.postgres.users.max' },
    databases: { limit: 1, scope: 'tenant', metricKey: 'tenant.postgres.databases.max' },
    schemas: { limit: 8, scope: 'workspace', metricKey: 'workspace.postgres.schemas.max' },
    tables: { limit: 64, scope: 'schema', metricKey: 'schema.postgres.tables.max' },
    columns: { limit: 256, scope: 'table', metricKey: 'table.postgres.columns.max' },
    constraints: { limit: 256, scope: 'table', metricKey: 'table.postgres.constraints.max' },
    indexes: { limit: 128, scope: 'table', metricKey: 'table.postgres.indexes.max' },
    views: { limit: 32, scope: 'schema', metricKey: 'schema.postgres.views.max' },
    materializedViews: { limit: 8, scope: 'schema', metricKey: 'schema.postgres.materialized_views.max' },
    functions: { limit: 48, scope: 'schema', metricKey: 'schema.postgres.functions.max' },
    procedures: { limit: 16, scope: 'schema', metricKey: 'schema.postgres.procedures.max' }
  }),
  pln_01growth: Object.freeze({
    roles: { limit: 32, scope: 'workspace', metricKey: 'workspace.postgres.roles.max' },
    users: { limit: 64, scope: 'workspace', metricKey: 'workspace.postgres.users.max' },
    databases: { limit: 1, scope: 'tenant', metricKey: 'tenant.postgres.databases.max' },
    schemas: { limit: 24, scope: 'workspace', metricKey: 'workspace.postgres.schemas.max' },
    tables: { limit: 160, scope: 'schema', metricKey: 'schema.postgres.tables.max' },
    columns: { limit: 512, scope: 'table', metricKey: 'table.postgres.columns.max' },
    constraints: { limit: 768, scope: 'table', metricKey: 'table.postgres.constraints.max' },
    indexes: { limit: 384, scope: 'table', metricKey: 'table.postgres.indexes.max' },
    views: { limit: 96, scope: 'schema', metricKey: 'schema.postgres.views.max' },
    materializedViews: { limit: 24, scope: 'schema', metricKey: 'schema.postgres.materialized_views.max' },
    functions: { limit: 144, scope: 'schema', metricKey: 'schema.postgres.functions.max' },
    procedures: { limit: 48, scope: 'schema', metricKey: 'schema.postgres.procedures.max' }
  }),
  pln_01regulated: Object.freeze({
    roles: { limit: 64, scope: 'tenant', metricKey: 'tenant.postgres.roles.max' },
    users: { limit: 128, scope: 'tenant', metricKey: 'tenant.postgres.users.max' },
    databases: { limit: 3, scope: 'tenant', metricKey: 'tenant.postgres.databases.max' },
    schemas: { limit: 48, scope: 'database', metricKey: 'database.postgres.schemas.max' },
    tables: { limit: 320, scope: 'schema', metricKey: 'schema.postgres.tables.max' },
    columns: { limit: 1024, scope: 'table', metricKey: 'table.postgres.columns.max' },
    constraints: { limit: 1536, scope: 'table', metricKey: 'table.postgres.constraints.max' },
    indexes: { limit: 768, scope: 'table', metricKey: 'table.postgres.indexes.max' },
    views: { limit: 192, scope: 'schema', metricKey: 'schema.postgres.views.max' },
    materializedViews: { limit: 48, scope: 'schema', metricKey: 'schema.postgres.materialized_views.max' },
    functions: { limit: 288, scope: 'schema', metricKey: 'schema.postgres.functions.max' },
    procedures: { limit: 96, scope: 'schema', metricKey: 'schema.postgres.procedures.max' }
  }),
  pln_01enterprise: Object.freeze({
    roles: { limit: 128, scope: 'tenant', metricKey: 'tenant.postgres.roles.max' },
    users: { limit: 256, scope: 'tenant', metricKey: 'tenant.postgres.users.max' },
    databases: { limit: 8, scope: 'tenant', metricKey: 'tenant.postgres.databases.max' },
    schemas: { limit: 96, scope: 'database', metricKey: 'database.postgres.schemas.max' },
    tables: { limit: 640, scope: 'schema', metricKey: 'schema.postgres.tables.max' },
    columns: { limit: 2048, scope: 'table', metricKey: 'table.postgres.columns.max' },
    constraints: { limit: 3072, scope: 'table', metricKey: 'table.postgres.constraints.max' },
    indexes: { limit: 1536, scope: 'table', metricKey: 'table.postgres.indexes.max' },
    views: { limit: 384, scope: 'schema', metricKey: 'schema.postgres.views.max' },
    materializedViews: { limit: 96, scope: 'schema', metricKey: 'schema.postgres.materialized_views.max' },
    functions: { limit: 576, scope: 'schema', metricKey: 'schema.postgres.functions.max' },
    procedures: { limit: 192, scope: 'schema', metricKey: 'schema.postgres.procedures.max' }
  })
});

export const POSTGRES_ADMIN_MINIMUM_ENGINE_POLICY = Object.freeze({
  schema_per_tenant: Object.freeze({
    profile: 'schema_per_tenant',
    engineUserClass: 'platform_provisioner',
    requiresCreatedb: false,
    requiresCreaterole: true,
    allowedCapabilities: Object.freeze([
      'create_non_superuser_roles',
      'alter_non_superuser_roles',
      'drop_baas_managed_roles',
      'create_workspace_schemas',
      'alter_workspace_schemas',
      'drop_workspace_schemas',
      'create_workspace_tables',
      'alter_workspace_tables',
      'drop_workspace_tables',
      'create_workspace_columns',
      'alter_workspace_columns',
      'drop_workspace_columns',
      'create_workspace_constraints',
      'alter_workspace_constraints',
      'drop_workspace_constraints',
      'create_workspace_indexes',
      'alter_workspace_indexes',
      'drop_workspace_indexes',
      'create_workspace_views',
      'alter_workspace_views',
      'drop_workspace_views',
      'create_workspace_materialized_views',
      'alter_workspace_materialized_views',
      'drop_workspace_materialized_views',
      'create_workspace_routines',
      'alter_workspace_routines',
      'drop_workspace_routines',
      'read_allowed_type_catalog',
      'grant_usage_and_object_privileges',
      'write_control_metadata_inventory'
    ]),
    forbiddenAttributes: Object.freeze([
      'SUPERUSER',
      'REPLICATION',
      'BYPASSRLS',
      'pg_execute_server_program',
      'pg_read_server_files',
      'pg_write_server_files'
    ]),
    guidance: Object.freeze([
      'The administrative engine user must not be a PostgreSQL superuser.',
      'Shared-schema deployments create and manage schemas, not tenant databases.',
      'Runtime application users never own schemas and never receive DDL privileges.',
      'Default privileges must remain least-privilege and public schema defaults must stay revoked.'
    ])
  }),
  database_per_tenant: Object.freeze({
    profile: 'database_per_tenant',
    engineUserClass: 'platform_provisioner',
    requiresCreatedb: true,
    requiresCreaterole: true,
    allowedCapabilities: Object.freeze([
      'create_non_superuser_roles',
      'alter_non_superuser_roles',
      'drop_baas_managed_roles',
      'create_tenant_databases',
      'alter_tenant_databases',
      'drop_empty_tenant_databases',
      'create_workspace_schemas',
      'create_workspace_tables',
      'alter_workspace_tables',
      'drop_workspace_tables',
      'create_workspace_columns',
      'alter_workspace_columns',
      'drop_workspace_columns',
      'create_workspace_constraints',
      'alter_workspace_constraints',
      'drop_workspace_constraints',
      'create_workspace_indexes',
      'alter_workspace_indexes',
      'drop_workspace_indexes',
      'create_workspace_views',
      'alter_workspace_views',
      'drop_workspace_views',
      'create_workspace_materialized_views',
      'alter_workspace_materialized_views',
      'drop_workspace_materialized_views',
      'create_workspace_routines',
      'alter_workspace_routines',
      'drop_workspace_routines',
      'read_allowed_type_catalog',
      'grant_usage_and_object_privileges',
      'write_control_metadata_inventory'
    ]),
    forbiddenAttributes: Object.freeze([
      'SUPERUSER',
      'REPLICATION',
      'BYPASSRLS',
      'pg_execute_server_program',
      'pg_read_server_files',
      'pg_write_server_files'
    ]),
    guidance: Object.freeze([
      'Dedicated-database deployments may require CREATEDB, but only for BaaS-managed tenant databases.',
      'The administrative engine user must never create unmanaged databases outside the placement catalog.',
      'Break-glass access stays out of the normal product contract and must remain separately governed.',
      'Runtime and audit users stay NOINHERIT and least-privilege even when database creation is allowed.'
    ])
  })
});

const ERROR_CODE_MAP = new Map([
  ['invalid_payload', { status: 400, code: 'GW_PGADM_INVALID_PAYLOAD' }],
  ['validation_error', { status: 400, code: 'GW_PGADM_VALIDATION_FAILED' }],
  ['forbidden', { status: 403, code: 'GW_PGADM_FORBIDDEN' }],
  ['not_found', { status: 404, code: 'GW_PGADM_NOT_FOUND' }],
  ['conflict', { status: 409, code: 'GW_PGADM_CONFLICT' }],
  ['unsupported_profile', { status: 422, code: 'GW_PGADM_UNSUPPORTED_PROFILE' }],
  ['quota_exceeded', { status: 422, code: 'GW_PGADM_QUOTA_EXCEEDED' }],
  ['unsupported_provider_version', { status: 424, code: 'GW_PGADM_UNSUPPORTED_PROVIDER_VERSION' }],
  ['dependency_failure', { status: 502, code: 'GW_PGADM_DEPENDENCY_FAILURE', retryable: true }],
  ['timeout', { status: 504, code: 'GW_PGADM_PROVIDER_TIMEOUT', retryable: true }]
]);

function compactDefined(values) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}

function unique(values = []) {
  return [...new Set(values)];
}

function normalizeIdentifier(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 63);
}

function hasPrefix(value, prefix) {
  if (!prefix) return true;
  return String(value ?? '').startsWith(prefix);
}

function listUsage(values) {
  if (!Array.isArray(values)) return [];
  return unique(values.filter(Boolean).map(String));
}

function isMutation(action) {
  return action === 'create' || action === 'update' || action === 'delete';
}

function resolvePlan(planId) {
  return planId ? getCommercialPlan(planId) : undefined;
}

function resolveDeploymentProfile({ planId, deploymentProfileId } = {}) {
  if (deploymentProfileId) {
    return getDeploymentProfileCatalogEntry(deploymentProfileId);
  }

  const plan = resolvePlan(planId);
  return plan?.deploymentProfileId ? getDeploymentProfileCatalogEntry(plan.deploymentProfileId) : undefined;
}

function determinePlacementMode(profile) {
  const dataBinding = profile?.planeBindings?.data;

  if (typeof dataBinding !== 'string') {
    return 'unknown';
  }

  if (dataBinding.includes('shared-schema')) {
    return 'schema_per_tenant';
  }

  if (dataBinding.includes('dedicated')) {
    return 'database_per_tenant';
  }

  return 'unknown';
}

function profileSupportsDatabaseMutations(placementMode) {
  return placementMode === 'database_per_tenant';
}

function quotaGuardrailsForPlan(planId, placementMode) {
  const fromPlan = POSTGRES_ADMIN_QUOTA_GUARDRAILS_BY_PLAN[planId];
  if (fromPlan) {
    return fromPlan;
  }

  return placementMode === 'database_per_tenant'
    ? POSTGRES_ADMIN_QUOTA_GUARDRAILS_BY_PLAN.pln_01regulated
    : POSTGRES_ADMIN_QUOTA_GUARDRAILS_BY_PLAN.pln_01growth;
}

function enginePolicyForPlacement(placementMode) {
  return POSTGRES_ADMIN_MINIMUM_ENGINE_POLICY[placementMode] ?? POSTGRES_ADMIN_MINIMUM_ENGINE_POLICY.schema_per_tenant;
}

function extractUnsafeFields(value, path = '') {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => extractUnsafeFields(entry, `${path}[${index}]`));
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  return Object.entries(value).flatMap(([key, nested]) => {
    const nextPath = path ? `${path}.${key}` : key;
    const matches = FORBIDDEN_ENGINE_DETAIL_FIELDS.includes(key) ? [nextPath] : [];
    return [...matches, ...extractUnsafeFields(nested, nextPath)];
  });
}

function defaultProviderCompatibility(profile) {
  return {
    provider: 'postgresql',
    contractVersion: postgresAdminRequestContract?.version ?? '2026-03-24',
    supportedVersions: SUPPORTED_POSTGRES_VERSION_RANGES.map(({ range }) => range),
    placementMode: profile.placementMode,
    deploymentProfileId: profile.deploymentProfileId,
    databaseMutationsSupported: profile.databaseMutationsSupported,
    tableMutationsSupported: profile.tableMutationsSupported,
    columnMutationsSupported: profile.columnMutationsSupported,
    constraintMutationsSupported: profile.constraintMutationsSupported,
    indexMutationsSupported: profile.indexMutationsSupported,
    viewMutationsSupported: profile.viewMutationsSupported,
    materializedViewMutationsSupported: profile.materializedViewMutationsSupported,
    functionMutationsSupported: profile.functionMutationsSupported,
    procedureMutationsSupported: profile.procedureMutationsSupported,
    typeCatalogSupported: profile.typeCatalogSupported
  };
}

function computeQuotaStatus(limitDescriptor = {}, used = 0) {
  const limit = limitDescriptor.limit ?? 0;
  return {
    metricKey: limitDescriptor.metricKey,
    scope: limitDescriptor.scope,
    limit,
    used,
    remaining: Math.max(limit - used, 0),
    status: used > limit ? 'exceeded' : used === limit ? 'at_limit' : 'within_limit'
  };
}

function countSchemasForDatabase(currentInventory = {}, databaseName) {
  const byDatabase = currentInventory?.schemasByDatabase ?? {};
  if (typeof byDatabase[databaseName] === 'number') {
    return byDatabase[databaseName];
  }

  return Array.isArray(currentInventory?.schemas)
    ? currentInventory.schemas.filter((schema) => (schema.databaseName ?? schema.database_name) === databaseName).length
    : 0;
}

export function isPostgresVersionSupported(version) {
  if (typeof version !== 'string' || version.length === 0) {
    return false;
  }

  return SUPPORTED_POSTGRES_VERSION_RANGES.some(({ range }) => {
    const [major] = range.split('.');
    return version === range || version.startsWith(`${major}.`);
  });
}

export function resolvePostgresAdminProfile({ planId, deploymentProfileId } = {}) {
  const plan = resolvePlan(planId);
  const profile = resolveDeploymentProfile({ planId, deploymentProfileId });
  const placementMode = determinePlacementMode(profile);
  const quotaGuardrails = quotaGuardrailsForPlan(plan?.planId ?? planId, placementMode);
  const databaseMutationsSupported = profileSupportsDatabaseMutations(placementMode);

  return {
    planId: plan?.planId ?? planId,
    planSlug: plan?.slug,
    deploymentProfileId: profile?.deploymentProfileId ?? deploymentProfileId,
    profileClass: profile?.profileClass,
    placementMode,
    dataPlaneBinding: profile?.planeBindings?.data,
    supportedEnvironments: profile?.supportedEnvironments ?? [],
    supportedResourceKinds: POSTGRES_ADMIN_RESOURCE_KINDS,
    databaseMutationsSupported,
    schemaMutationsSupported: placementMode === 'schema_per_tenant' || placementMode === 'database_per_tenant',
    tableMutationsSupported: placementMode === 'schema_per_tenant' || placementMode === 'database_per_tenant',
    columnMutationsSupported: placementMode === 'schema_per_tenant' || placementMode === 'database_per_tenant',
    constraintMutationsSupported: placementMode === 'schema_per_tenant' || placementMode === 'database_per_tenant',
    indexMutationsSupported: placementMode === 'schema_per_tenant' || placementMode === 'database_per_tenant',
    viewMutationsSupported: placementMode === 'schema_per_tenant' || placementMode === 'database_per_tenant',
    materializedViewMutationsSupported: placementMode === 'schema_per_tenant' || placementMode === 'database_per_tenant',
    functionMutationsSupported: placementMode === 'schema_per_tenant' || placementMode === 'database_per_tenant',
    procedureMutationsSupported: placementMode === 'schema_per_tenant' || placementMode === 'database_per_tenant',
    typeCatalogSupported: true,
    quotaGuardrails,
    minimumEnginePolicy: enginePolicyForPlacement(placementMode),
    providerCompatibility: defaultProviderCompatibility({
      placementMode,
      deploymentProfileId: profile?.deploymentProfileId ?? deploymentProfileId,
      databaseMutationsSupported
    })
  };
}

export function getPostgresCompatibilityMatrix() {
  return SUPPORTED_POSTGRES_VERSION_RANGES;
}

export function normalizePostgresAdminResource(resourceKind, payload = {}, context = {}) {
  const profile = resolvePostgresAdminProfile(context);
  const providerCompatibility = defaultProviderCompatibility(profile);
  const ownership = compactDefined({
    tenantId: context.tenantId,
    workspaceId: context.workspaceId,
    managedBy: 'baas_control_api'
  });

  switch (resourceKind) {
    case 'role':
      return compactDefined({
        resourceType: 'postgres_role',
        roleName: payload.roleName ?? payload.name ?? context.roleName,
        principalType: 'role',
        state: payload.state ?? 'active',
        memberOf: listUsage(payload.memberOf),
        ownership,
        providerCompatibility,
        metadata: payload.metadata ?? {}
      });
    case 'user':
      return compactDefined({
        resourceType: 'postgres_user',
        userName: payload.userName ?? payload.username ?? context.userName,
        principalType: 'user',
        state: payload.loginEnabled === false ? 'disabled' : payload.state ?? 'active',
        loginEnabled: payload.loginEnabled !== false,
        memberOf: listUsage(payload.memberOf),
        credentialBinding: compactDefined({
          secretRef: payload.credentialBinding?.secretRef ?? payload.secretRef,
          rotationPolicy: payload.credentialBinding?.rotationPolicy,
          lastRotatedAt: payload.credentialBinding?.lastRotatedAt
        }),
        ownership,
        providerCompatibility,
        metadata: payload.metadata ?? {}
      });
    case 'database':
      return compactDefined({
        resourceType: 'postgres_database',
        databaseName: payload.databaseName ?? payload.name ?? context.databaseName,
        ownerRoleName: payload.ownerRoleName,
        state: payload.state ?? 'active',
        placementMode: profile.placementMode,
        tenantBinding: compactDefined({
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          isolationBoundary: profile.placementMode === 'database_per_tenant' ? 'tenant' : 'workspace'
        }),
        locale: compactDefined({
          encoding: payload.locale?.encoding,
          lcCollate: payload.locale?.lcCollate,
          lcCtype: payload.locale?.lcCtype
        }),
        providerCompatibility,
        metadata: payload.metadata ?? {}
      });
    case 'schema':
      return compactDefined({
        resourceType: 'postgres_schema',
        databaseName: payload.databaseName ?? context.databaseName,
        schemaName: payload.schemaName ?? payload.name ?? context.schemaName,
        ownerRoleName: payload.ownerRoleName,
        state: payload.state ?? 'active',
        placementMode: profile.placementMode,
        workspaceBindings: listUsage(payload.workspaceBindings ?? [context.workspaceId].filter(Boolean)),
        accessPolicy: compactDefined({
          isolationBoundary: 'workspace',
          rlsRequiredOnSharedRows: profile.placementMode === 'schema_per_tenant',
          defaultPrivileges: 'least_privilege'
        }),
        objectCounts: compactDefined({
          tables: payload.objectCounts?.tables,
          views: payload.objectCounts?.views,
          materializedViews: payload.objectCounts?.materializedViews,
          indexes: payload.objectCounts?.indexes,
          constraints: payload.objectCounts?.constraints,
          functions: payload.objectCounts?.functions,
          procedures: payload.objectCounts?.procedures
        }),
        providerCompatibility,
        metadata: payload.metadata ?? {}
      });
    default:
      return normalizePostgresStructuralResource(resourceKind, payload, {
        ...context,
        contractVersion: postgresAdminRequestContract?.version ?? '2026-03-24',
        supportedVersions: SUPPORTED_POSTGRES_VERSION_RANGES.map(({ range }) => range),
        deploymentProfileId: profile.deploymentProfileId,
        placementMode: profile.placementMode,
        databaseMutationsSupported: profile.databaseMutationsSupported
      }, profile);
  }
}

export function validatePostgresAdminRequest(request = {}) {
  const violations = [];
  const { resourceKind, action, payload = {}, context = {} } = request;
  const profile = resolvePostgresAdminProfile(context);
  const currentInventory = context.currentInventory ?? {};

  if (!POSTGRES_ADMIN_RESOURCE_KINDS.includes(resourceKind)) {
    violations.push(`Unsupported PostgreSQL resource kind ${String(resourceKind)}.`);
  }

  if (!POSTGRES_ADMIN_ACTIONS.includes(action)) {
    violations.push(`Unsupported PostgreSQL action ${String(action)}.`);
  }

  if (context.providerVersion && !isPostgresVersionSupported(context.providerVersion)) {
    violations.push(`PostgreSQL version ${context.providerVersion} is outside the supported compatibility matrix.`);
  }

  if ((context.planId || context.deploymentProfileId) && profile.placementMode === 'unknown') {
    violations.push('The deployment profile does not advertise a supported PostgreSQL placement mode.');
  }

  for (const unsafeField of extractUnsafeFields(payload)) {
    violations.push(`Unsafe engine field ${unsafeField} is not exposed through the BaaS PostgreSQL admin contract.`);
  }

  if (payload.tenantId && context.tenantId && payload.tenantId !== context.tenantId) {
    violations.push(`Payload tenantId ${payload.tenantId} does not match request tenant scope ${context.tenantId}.`);
  }

  if (payload.workspaceId && context.workspaceId && payload.workspaceId !== context.workspaceId) {
    violations.push(`Payload workspaceId ${payload.workspaceId} does not match request workspace scope ${context.workspaceId}.`);
  }

  if (resourceKind === 'database' && isMutation(action) && !profile.databaseMutationsSupported) {
    violations.push(`Database mutations are not supported for placement mode ${profile.placementMode}.`);
  }

  switch (resourceKind) {
    case 'role': {
      const roleName = payload.roleName ?? payload.name;
      const memberOf = listUsage(payload.memberOf);
      const quota = profile.quotaGuardrails.roles;
      const used = Number(currentInventory?.counts?.roles ?? currentInventory?.roles?.length ?? 0);

      if (!roleName && action !== 'list') {
        violations.push('Roles must declare roleName.');
      }

      if (roleName && (RESERVED_POSTGRES_ROLE_NAMES.includes(roleName) || roleName.startsWith('pg_'))) {
        violations.push(`Role ${roleName} is reserved and cannot be managed through the product surface.`);
      }

      if (roleName && context.workspaceNamePrefix && !hasPrefix(roleName, context.workspaceNamePrefix)) {
        violations.push(`Workspace-scoped role names must start with ${context.workspaceNamePrefix}.`);
      }

      if (memberOf.length !== (payload.memberOf ?? []).length) {
        violations.push('Role memberships must be unique.');
      }

      if (memberOf.some((entry) => RESERVED_POSTGRES_ROLE_NAMES.includes(entry))) {
        violations.push('Role memberships cannot target reserved platform or engine roles.');
      }

      if (action === 'create' && used >= quota.limit) {
        violations.push(`Quota ${quota.metricKey} would be exceeded by creating another role.`);
      }
      break;
    }
    case 'user': {
      const userName = payload.userName ?? payload.username;
      const memberOf = listUsage(payload.memberOf);
      const quota = profile.quotaGuardrails.users;
      const used = Number(currentInventory?.counts?.users ?? currentInventory?.users?.length ?? 0);

      if (!userName && action !== 'list') {
        violations.push('Users must declare userName.');
      }

      if (userName && (RESERVED_POSTGRES_ROLE_NAMES.includes(userName) || userName.startsWith('pg_'))) {
        violations.push(`User ${userName} is reserved and cannot be managed through the product surface.`);
      }

      if (userName && context.workspaceNamePrefix && !hasPrefix(userName, context.workspaceNamePrefix)) {
        violations.push(`Workspace-scoped user names must start with ${context.workspaceNamePrefix}.`);
      }

      if ((action === 'create' || action === 'update') && !(payload.credentialBinding?.secretRef ?? payload.secretRef)) {
        violations.push('Users must reference credentials through credentialBinding.secretRef; raw passwords are not allowed.');
      }

      if (memberOf.length !== (payload.memberOf ?? []).length) {
        violations.push('User memberships must be unique.');
      }

      if (memberOf.some((entry) => RESERVED_POSTGRES_ROLE_NAMES.includes(entry))) {
        violations.push('User memberships cannot target reserved platform or engine roles.');
      }

      if (action === 'create' && used >= quota.limit) {
        violations.push(`Quota ${quota.metricKey} would be exceeded by creating another user.`);
      }
      break;
    }
    case 'database': {
      const databaseName = payload.databaseName ?? payload.name;
      const quota = profile.quotaGuardrails.databases;
      const used = Number(currentInventory?.counts?.databases ?? currentInventory?.databases?.length ?? 0);

      if (!databaseName && action !== 'list') {
        violations.push('Databases must declare databaseName.');
      }

      if (databaseName && (RESERVED_POSTGRES_DATABASE_NAMES.includes(databaseName) || databaseName.startsWith('pg_'))) {
        violations.push(`Database ${databaseName} is reserved and cannot be managed through the product surface.`);
      }

      if (databaseName && context.tenantNamePrefix && !hasPrefix(databaseName, context.tenantNamePrefix)) {
        violations.push(`Tenant-scoped database names must start with ${context.tenantNamePrefix}.`);
      }

      if ((action === 'create' || action === 'update') && !payload.ownerRoleName) {
        violations.push('Databases must declare ownerRoleName.');
      }

      if (action === 'create' && used >= quota.limit) {
        violations.push(`Quota ${quota.metricKey} would be exceeded by creating another database.`);
      }
      break;
    }
    case 'schema': {
      const schemaName = payload.schemaName ?? payload.name;
      const databaseName = payload.databaseName ?? context.databaseName;
      const workspaceBindings = listUsage(payload.workspaceBindings ?? [context.workspaceId].filter(Boolean));
      const quota = profile.quotaGuardrails.schemas;
      const used = databaseName
        ? countSchemasForDatabase(currentInventory, databaseName)
        : Number(currentInventory?.counts?.schemas ?? currentInventory?.schemas?.length ?? 0);

      if (!databaseName && action !== 'list') {
        violations.push('Schemas must declare databaseName.');
      }

      if (!schemaName && action !== 'list') {
        violations.push('Schemas must declare schemaName.');
      }

      if (schemaName && (RESERVED_POSTGRES_SCHEMA_NAMES.includes(schemaName) || schemaName.startsWith('pg_'))) {
        violations.push(`Schema ${schemaName} is reserved and cannot be managed through the product surface.`);
      }

      if (schemaName && context.workspaceNamePrefix && !hasPrefix(schemaName, context.workspaceNamePrefix)) {
        violations.push(`Workspace-scoped schema names must start with ${context.workspaceNamePrefix}.`);
      }

      if ((action === 'create' || action === 'update') && !payload.ownerRoleName) {
        violations.push('Schemas must declare ownerRoleName.');
      }

      if (workspaceBindings.length === 0) {
        violations.push('Schemas must remain bound to at least one workspace context.');
      }

      if (workspaceBindings.length !== (payload.workspaceBindings ?? [context.workspaceId].filter(Boolean)).length) {
        violations.push('Schema workspaceBindings must be unique.');
      }

      if (context.workspaceId && workspaceBindings.some((entry) => entry !== context.workspaceId)) {
        violations.push('Schema workspaceBindings cannot escape the current workspace scope.');
      }

      if (profile.placementMode === 'schema_per_tenant' && context.tenantDatabaseName && databaseName && databaseName !== context.tenantDatabaseName) {
        violations.push(`Shared-schema placement only allows schemas inside tenant database ${context.tenantDatabaseName}.`);
      }

      if (action === 'create' && used >= quota.limit) {
        violations.push(`Quota ${quota.metricKey} would be exceeded by creating another schema.`);
      }
      break;
    }
    default: {
      const structuralValidation = validatePostgresStructuralRequest({
        resourceKind,
        action,
        payload,
        context: {
          ...context,
          allowedTypeCatalog: context.allowedTypeCatalog ?? buildAllowedPostgresTypeCatalog(context.clusterFeatures)
        },
        profile
      });
      violations.push(...structuralValidation.violations);
      break;
    }
  }

  return {
    ok: violations.length === 0,
    violations,
    profile
  };
}

export function normalizePostgresAdminError(error = {}, context = {}) {
  const classification =
    error.classification ??
    (error.status === 404 ? 'not_found' : undefined) ??
    (error.status === 409 ? 'conflict' : undefined) ??
    (error.status === 504 ? 'timeout' : undefined) ??
    'dependency_failure';
  const mapped = ERROR_CODE_MAP.get(classification) ?? ERROR_CODE_MAP.get('dependency_failure');

  return {
    status: mapped.status,
    code: mapped.code,
    message: error.message ?? 'The PostgreSQL administrative request could not be completed.',
    detail: {
      reason: classification,
      violations: error.violations ?? [],
      providerStatus: error.status,
      providerError: error.providerError,
      resourceKind: context.resourceKind,
      action: context.action,
      resourceId: context.resourceId,
      placementMode: context.placementMode
    },
    retryable: mapped.retryable === true
  };
}

export function buildPostgresAdminAdapterCall({
  resourceKind,
  action,
  payload = {},
  targetRef,
  callId,
  tenantId,
  workspaceId,
  planId,
  scopes = [],
  effectiveRoles = [],
  correlationId,
  authorizationDecisionId,
  idempotencyKey,
  requestedAt = '2026-03-24T00:00:00Z',
  identityBlueprintRef = 'identity-blueprint-platform-v1',
  context = {}
} = {}) {
  const validation = validatePostgresAdminRequest({
    resourceKind,
    action,
    payload,
    context: {
      ...context,
      tenantId: context.tenantId ?? tenantId,
      workspaceId: context.workspaceId ?? workspaceId,
      planId: context.planId ?? planId
    }
  });

  if (!validation.ok) {
    const error = new Error('PostgreSQL admin request failed validation.');
    error.validation = validation;
    throw error;
  }

  const normalizedContext = {
    ...context,
    tenantId: context.tenantId ?? tenantId,
    workspaceId: context.workspaceId ?? workspaceId,
    planId: context.planId ?? planId,
    profile: validation.profile,
    allowedTypeCatalog: context.allowedTypeCatalog ?? buildAllowedPostgresTypeCatalog(context.clusterFeatures)
  };
  const ddlPlan =
    POSTGRES_STRUCTURAL_RESOURCE_KINDS.includes(resourceKind) && resourceKind !== 'type' && isMutation(action)
      ? buildPostgresStructuralSqlPlan({
          resourceKind,
          action,
          payload,
          context: normalizedContext
        })
      : undefined;

  return {
    call_id: callId,
    tenant_id: tenantId,
    adapter_id: 'postgresql',
    capability: `postgres_${resourceKind}_${action}`,
    target_ref: targetRef,
    payload: {
      resourceKind,
      action,
      placementProfile: validation.profile,
      normalizedResource: normalizePostgresAdminResource(resourceKind, payload, normalizedContext),
      ddlPlan,
      providerPayload: payload
    },
    idempotency_key: idempotencyKey,
    correlation_id: correlationId,
    contract_version: postgresAdminRequestContract?.version ?? '2026-03-24',
    requested_at: requestedAt,
    workspace_id: workspaceId,
    plan_id: planId,
    scopes,
    effective_roles: effectiveRoles,
    authorization_decision_id: authorizationDecisionId,
    identity_blueprint_ref: identityBlueprintRef
  };
}

export function buildPostgresAdminInventorySnapshot({
  tenantId,
  workspaceId,
  planId,
  deploymentProfileId,
  roles = [],
  users = [],
  databases = [],
  schemas = [],
  tables = [],
  columns = [],
  constraints = [],
  indexes = [],
  views = [],
  materializedViews = [],
  functions = [],
  procedures = [],
  observedAt = '2026-03-24T00:00:00Z'
} = {}) {
  const profile = resolvePostgresAdminProfile({ planId, deploymentProfileId });
  const roleNames = roles.map((role) => role.roleName ?? role.name).filter(Boolean);
  const userNames = users.map((user) => user.userName ?? user.username).filter(Boolean);
  const databaseNames = databases.map((database) => database.databaseName ?? database.name).filter(Boolean);
  const schemaRefs = schemas
    .map((schema) => ({
      databaseName: schema.databaseName,
      schemaName: schema.schemaName ?? schema.name,
      workspaceBindings: listUsage(schema.workspaceBindings)
    }))
    .filter((schema) => schema.databaseName && schema.schemaName);
  const tableRefs = tables
    .map((table) => ({
      databaseName: table.databaseName,
      schemaName: table.schemaName,
      tableName: table.tableName ?? table.name,
      columnCount: Number(table.columnCount ?? 0)
    }))
    .filter((table) => table.databaseName && table.schemaName && table.tableName);
  const totalColumns = columns.length > 0 ? columns.length : tableRefs.reduce((count, table) => count + table.columnCount, 0);
  const constraintRefs = constraints
    .map((constraint) => ({
      databaseName: constraint.databaseName,
      schemaName: constraint.schemaName,
      tableName: constraint.tableName,
      constraintName: constraint.constraintName ?? constraint.name,
      constraintType: constraint.constraintType ?? constraint.type
    }))
    .filter((constraint) => constraint.databaseName && constraint.schemaName && constraint.tableName && constraint.constraintName);
  const indexRefs = indexes
    .map((index) => ({
      databaseName: index.databaseName,
      schemaName: index.schemaName,
      tableName: index.tableName,
      indexName: index.indexName ?? index.name,
      indexMethod: index.indexMethod ?? index.method
    }))
    .filter((index) => index.databaseName && index.schemaName && index.tableName && index.indexName);
  const viewRefs = views
    .map((view) => ({
      databaseName: view.databaseName,
      schemaName: view.schemaName,
      viewName: view.viewName ?? view.name,
      dependencyCount: Number(view.dependencySummary?.readsFrom?.length ?? 0)
    }))
    .filter((view) => view.databaseName && view.schemaName && view.viewName);
  const materializedViewRefs = materializedViews
    .map((view) => ({
      databaseName: view.databaseName,
      schemaName: view.schemaName,
      viewName: view.viewName ?? view.materializedViewName ?? view.name,
      refreshPolicy: view.refreshPolicy,
      indexCount: Number(view.indexes?.length ?? 0)
    }))
    .filter((view) => view.databaseName && view.schemaName && view.viewName);
  const functionRefs = functions
    .map((routine) => ({
      databaseName: routine.databaseName,
      schemaName: routine.schemaName,
      routineName: routine.routineName ?? routine.name,
      signature: routine.signature
    }))
    .filter((routine) => routine.databaseName && routine.schemaName && routine.routineName);
  const procedureRefs = procedures
    .map((routine) => ({
      databaseName: routine.databaseName,
      schemaName: routine.schemaName,
      routineName: routine.routineName ?? routine.name,
      signature: routine.signature
    }))
    .filter((routine) => routine.databaseName && routine.schemaName && routine.routineName);

  return {
    snapshotId: `pginv_${normalizeIdentifier(tenantId ?? 'tenant')}_${normalizeIdentifier(workspaceId ?? 'workspace')}`,
    tenantId,
    workspaceId,
    planId,
    deploymentProfileId: profile.deploymentProfileId,
    placementMode: profile.placementMode,
    contractVersion: postgresInventorySnapshotContract?.version ?? '2026-03-24',
    observedAt,
    counts: {
      roles: roleNames.length,
      users: userNames.length,
      databases: databaseNames.length,
      schemas: schemaRefs.length,
      tables: tableRefs.length,
      columns: totalColumns,
      constraints: constraintRefs.length,
      indexes: indexRefs.length,
      views: viewRefs.length,
      materializedViews: materializedViewRefs.length,
      functions: functionRefs.length,
      procedures: procedureRefs.length
    },
    quotas: {
      roles: computeQuotaStatus(profile.quotaGuardrails.roles, roleNames.length),
      users: computeQuotaStatus(profile.quotaGuardrails.users, userNames.length),
      databases: computeQuotaStatus(profile.quotaGuardrails.databases, databaseNames.length),
      schemas: computeQuotaStatus(profile.quotaGuardrails.schemas, schemaRefs.length),
      tables: computeQuotaStatus(profile.quotaGuardrails.tables, tableRefs.length),
      columns: computeQuotaStatus(profile.quotaGuardrails.columns, totalColumns),
      constraints: computeQuotaStatus(profile.quotaGuardrails.constraints, constraintRefs.length),
      indexes: computeQuotaStatus(profile.quotaGuardrails.indexes, indexRefs.length),
      views: computeQuotaStatus(profile.quotaGuardrails.views, viewRefs.length),
      materializedViews: computeQuotaStatus(profile.quotaGuardrails.materializedViews, materializedViewRefs.length),
      functions: computeQuotaStatus(profile.quotaGuardrails.functions, functionRefs.length),
      procedures: computeQuotaStatus(profile.quotaGuardrails.procedures, procedureRefs.length)
    },
    roleNames,
    userNames,
    databaseNames,
    schemaRefs,
    tableRefs,
    constraintRefs,
    indexRefs,
    viewRefs,
    materializedViewRefs,
    functionRefs,
    procedureRefs,
    byDatabase: Object.fromEntries(
      databaseNames.map((databaseName) => [
        databaseName,
        {
          schemaCount: schemaRefs.filter((schema) => schema.databaseName === databaseName).length,
          workspaceBindings: unique(
            schemaRefs
              .filter((schema) => schema.databaseName === databaseName)
              .flatMap((schema) => schema.workspaceBindings ?? [])
          ),
          viewCount: viewRefs.filter((view) => view.databaseName === databaseName).length,
          materializedViewCount: materializedViewRefs.filter((view) => view.databaseName === databaseName).length,
          functionCount: functionRefs.filter((routine) => routine.databaseName === databaseName).length,
          procedureCount: procedureRefs.filter((routine) => routine.databaseName === databaseName).length
        }
      ])
    ),
    minimumEnginePolicy: profile.minimumEnginePolicy,
    providerCompatibility: profile.providerCompatibility
  };
}

export function buildPostgresAdminMetadataRecord({
  resourceKind,
  resource,
  tenantId,
  workspaceId,
  observedAt = '2026-03-24T00:00:00Z'
} = {}) {
  return {
    resourceKind,
    tenantId,
    workspaceId,
    observedAt,
    metadata: compactDefined({
      primaryRef:
        resource?.roleName ??
        resource?.userName ??
        (resource?.databaseName && resource?.schemaName && resource?.tableName && resource?.columnName
          ? `${resource.databaseName}.${resource.schemaName}.${resource.tableName}.${resource.columnName}`
          : resource?.databaseName && resource?.schemaName && resource?.tableName
            ? `${resource.databaseName}.${resource.schemaName}.${resource.tableName}`
            : resource?.databaseName && resource?.schemaName && resource?.viewName
              ? `${resource.databaseName}.${resource.schemaName}.${resource.viewName}`
              : resource?.databaseName && resource?.schemaName && resource?.materializedViewName
                ? `${resource.databaseName}.${resource.schemaName}.${resource.materializedViewName}`
                : resource?.databaseName && resource?.schemaName && resource?.routineName
                  ? `${resource.databaseName}.${resource.schemaName}.${resource.routineName}`
                  : resource?.databaseName && resource?.schemaName && resource?.constraintName
                    ? `${resource.databaseName}.${resource.schemaName}.${resource.tableName}.${resource.constraintName}`
                    : resource?.databaseName && resource?.schemaName && resource?.indexName
                      ? `${resource.databaseName}.${resource.schemaName}.${resource.indexName}`
                      : resource?.databaseName && resource?.schemaName
                        ? `${resource.databaseName}.${resource.schemaName}`
                        : resource?.databaseName) ??
        resource?.tableName ??
        resource?.columnName ??
        resource?.viewName ??
        resource?.materializedViewName ??
        resource?.constraintName ??
        resource?.indexName ??
        resource?.routineName ??
        resource?.fullName,
      placementMode: resource?.placementMode,
      ownerRoleName: resource?.ownerRoleName,
      provider: resource?.providerCompatibility?.provider ?? 'postgresql'
    }),
    resource
  };
}

export { buildAllowedPostgresTypeCatalog, buildPostgresStructuralSqlPlan };
