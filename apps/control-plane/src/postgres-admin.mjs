import {
  filterPublicRoutes,
  getApiFamily,
  getContract,
  getPublicRoute
} from '../../../services/internal-contracts/src/index.mjs';
import {
  POSTGRES_ADMIN_CAPABILITY_MATRIX,
  POSTGRES_ADMIN_MINIMUM_ENGINE_POLICY,
  POSTGRES_ADMIN_RESOURCE_KINDS,
  POSTGRES_ADMIN_SQL_ALLOWED_ORIGIN_SURFACES,
  POSTGRES_ADMIN_SQL_ALLOWED_EFFECTIVE_ROLES,
  POSTGRES_ADMIN_SQL_PLAN_FLAGS_BY_PLAN,
  SUPPORTED_POSTGRES_VERSION_RANGES,
  isPostgresVersionSupported,
  resolvePostgresAdminProfile,
  resolvePostgresAdminSqlPolicy
} from '../../../services/adapters/src/postgresql-admin.mjs';

export const postgresApiFamily = getApiFamily('postgres');
export const postgresAdminRequestContract = getContract('postgres_admin_request');
export const postgresAdminResultContract = getContract('postgres_admin_result');
export const postgresAdminSqlRequestContract = getContract('postgres_admin_sql_request');
export const postgresAdminSqlResultContract = getContract('postgres_admin_sql_result');
export const postgresInventorySnapshotContract = getContract('postgres_inventory_snapshot');
export const postgresAdminRoutes = filterPublicRoutes({ family: 'postgres' });
export const postgresAdminSqlRoutes = postgresAdminRoutes.filter((route) => route.resourceType === 'postgres_admin_sql');

export function listPostgresAdminRoutes(filters = {}) {
  return filterPublicRoutes({ family: 'postgres', ...filters });
}

export function listPostgresAdminSqlRoutes(filters = {}) {
  return postgresAdminSqlRoutes.filter((route) =>
    Object.entries(filters).every(([field, value]) => {
      if (value === undefined || value === null || value === '') return true;
      const routeValue = route[field];
      if (Array.isArray(routeValue)) return routeValue.includes(value);
      return routeValue === value;
    })
  );
}

export function getPostgresAdminRoute(operationId) {
  const route = getPublicRoute(operationId);
  return route?.family === 'postgres' ? route : undefined;
}

export function getPostgresAdminSqlRoute(operationId = 'executePostgresAdminSql') {
  const route = getPublicRoute(operationId);
  return route?.resourceType === 'postgres_admin_sql' ? route : undefined;
}

export function summarizePostgresAdminSurface() {
  return POSTGRES_ADMIN_RESOURCE_KINDS.map((resourceKind) => ({
    resourceKind,
    actions: POSTGRES_ADMIN_CAPABILITY_MATRIX[resourceKind] ?? [],
    routeCount: postgresAdminRoutes.filter((route) => route.resourceType === `postgres_${resourceKind}`).length
  })).concat([
    {
      resourceKind: 'inventory',
      actions: ['get'],
      routeCount: postgresAdminRoutes.filter((route) => route.resourceType === 'postgres_inventory').length
    },
    {
      resourceKind: 'admin_sql',
      actions: ['execute'],
      routeCount: postgresAdminSqlRoutes.length
    }
  ]);
}

export function getPostgresCompatibilitySummary(context = {}) {
  const profile = resolvePostgresAdminProfile(context);
  const adminSqlPolicy = resolvePostgresAdminSqlPolicy({ planId: profile.planId ?? context.planId });

  return {
    provider: 'postgresql',
    contractVersion: postgresAdminRequestContract?.version ?? '2026-03-24',
    placementMode: profile.placementMode,
    databaseMutationsSupported: profile.databaseMutationsSupported,
    tableSecurityMutationsSupported: profile.tableSecurityMutationsSupported,
    policyMutationsSupported: profile.policyMutationsSupported,
    grantMutationsSupported: profile.grantMutationsSupported,
    extensionMutationsSupported: profile.extensionMutationsSupported,
    templateCatalogSupported: profile.templateCatalogSupported,
    authorizedExtensions: profile.authorizedExtensions,
    quotaGuardrails: profile.quotaGuardrails,
    adminSqlEnabled: adminSqlPolicy.enabled,
    adminSqlPlanFlags: adminSqlPolicy.planFlags,
    adminSqlAllowedOriginSurfaces: POSTGRES_ADMIN_SQL_ALLOWED_ORIGIN_SURFACES,
    adminSqlAllowedEffectiveRoles: POSTGRES_ADMIN_SQL_ALLOWED_EFFECTIVE_ROLES,
    minimumEnginePolicy: POSTGRES_ADMIN_MINIMUM_ENGINE_POLICY[profile.placementMode] ?? profile.minimumEnginePolicy,
    supportedVersions: SUPPORTED_POSTGRES_VERSION_RANGES.map(({ range, label, adminApiStability, placementModes }) => ({
      range,
      label,
      adminApiStability,
      placementModes,
      adminSqlPlanFlags: POSTGRES_ADMIN_SQL_PLAN_FLAGS_BY_PLAN[profile.planId ?? context.planId ?? 'pln_01starter'] ?? []
    }))
  };
}

export { isPostgresVersionSupported };
