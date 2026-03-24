import {
  filterPublicRoutes,
  getApiFamily,
  getContract,
  getPublicRoute
} from '../../../services/internal-contracts/src/index.mjs';
import {
  POSTGRES_DATA_API_CAPABILITIES,
  POSTGRES_DATA_API_OPERATIONS,
  POSTGRES_DATA_COUNT_MODES,
  POSTGRES_DATA_FILTER_OPERATORS,
  POSTGRES_DATA_MANAGEMENT_CAPABILITIES,
  POSTGRES_DATA_PAGINATION_METADATA_MODES,
  POSTGRES_DATA_RELATION_TYPES,
  summarizePostgresDataApiCapabilityMatrix
} from '../../../services/adapters/src/postgresql-data-api.mjs';

const POSTGRES_DATA_RESOURCE_TYPES = [
  'postgres_data_rows',
  'postgres_data_row',
  'postgres_data_rpc',
  'postgres_data_bulk',
  'postgres_data_transfer',
  'postgres_data_credential',
  'postgres_data_saved_query',
  'postgres_data_endpoint'
];

export const postgresDataApiFamily = getApiFamily('postgres');
export const postgresDataRequestContract = getContract('postgres_data_request');
export const postgresDataResultContract = getContract('postgres_data_result');
export const postgresDataApiRoutes = filterPublicRoutes({ family: 'postgres' }).filter((route) =>
  POSTGRES_DATA_RESOURCE_TYPES.includes(route.resourceType)
);

export function listPostgresDataApiRoutes(filters = {}) {
  return postgresDataApiRoutes.filter((route) =>
    Object.entries(filters).every(([field, value]) => {
      if (value === undefined || value === null || value === '') return true;
      const routeValue = route[field];
      if (Array.isArray(routeValue)) return routeValue.includes(value);
      return routeValue === value;
    })
  );
}

export function getPostgresDataApiRoute(operationId) {
  const route = getPublicRoute(operationId);
  return route && POSTGRES_DATA_RESOURCE_TYPES.includes(route.resourceType) ? route : undefined;
}

const ROUTE_MATCHERS_BY_OPERATION = {
  list: (route) => route.operationId === 'listPostgresDataRows',
  get: (route) => route.operationId === 'getPostgresDataRowByPrimaryKey',
  insert: (route) => route.operationId === 'createPostgresDataRow',
  update: (route) => route.operationId === 'updatePostgresDataRowByPrimaryKey',
  delete: (route) => route.operationId === 'deletePostgresDataRowByPrimaryKey',
  rpc: (route) => route.operationId === 'executePostgresDataRpc',
  bulk_insert: (route) => route.operationId === 'bulkInsertPostgresDataRows',
  bulk_update: (route) => route.operationId === 'bulkUpdatePostgresDataRows',
  bulk_delete: (route) => route.operationId === 'bulkDeletePostgresDataRows',
  import: (route) => route.operationId === 'importPostgresDataRows',
  export: (route) => route.operationId === 'exportPostgresDataRows',
  saved_query_execute: (route) => route.operationId === 'executePostgresSavedQuery',
  stable_endpoint_invoke: (route) => route.operationId === 'invokePostgresDataEndpoint',
  scoped_credential: (route) => route.resourceType === 'postgres_data_credential',
  saved_query: (route) => route.resourceType === 'postgres_data_saved_query',
  stable_endpoint: (route) => route.resourceType === 'postgres_data_endpoint'
};

export function summarizePostgresDataApiSurface() {
  return {
    familyId: postgresDataApiFamily?.id,
    routeCount: postgresDataApiRoutes.length,
    operations: summarizePostgresDataApiCapabilityMatrix().map((entry) => ({
      ...entry,
      routeCount: postgresDataApiRoutes.filter((route) => ROUTE_MATCHERS_BY_OPERATION[entry.operation]?.(route)).length
    })),
    filterOperators: POSTGRES_DATA_FILTER_OPERATORS,
    relationTypes: POSTGRES_DATA_RELATION_TYPES,
    countModes: POSTGRES_DATA_COUNT_MODES,
    paginationMetadataModes: POSTGRES_DATA_PAGINATION_METADATA_MODES
  };
}

export {
  POSTGRES_DATA_API_CAPABILITIES,
  POSTGRES_DATA_API_OPERATIONS,
  POSTGRES_DATA_COUNT_MODES,
  POSTGRES_DATA_FILTER_OPERATORS,
  POSTGRES_DATA_MANAGEMENT_CAPABILITIES,
  POSTGRES_DATA_PAGINATION_METADATA_MODES,
  POSTGRES_DATA_RELATION_TYPES
};
