import {
  filterPublicRoutes,
  getApiFamily,
  getContract,
  getPublicRoute
} from '../../../services/internal-contracts/src/index.mjs';
import {
  MONGO_DATA_AGGREGATION_STAGES,
  MONGO_DATA_API_CAPABILITIES,
  MONGO_DATA_API_OPERATIONS,
  MONGO_DATA_BULK_ACTIONS,
  MONGO_DATA_CHANGE_STREAM_STAGES,
  MONGO_DATA_EXPORT_FORMATS,
  MONGO_DATA_FILTER_OPERATORS,
  MONGO_DATA_IMPORT_MODES,
  MONGO_DATA_SORT_DIRECTIONS,
  MONGO_DATA_SUPPORTED_TOPOLOGIES,
  MONGO_DATA_TRANSACTION_ACTIONS,
  MONGO_DATA_UPDATE_OPERATORS,
  summarizeMongoDataApiCapabilityMatrix
} from '../../../services/adapters/src/mongodb-data-api.mjs';

const MONGO_DATA_RESOURCE_TYPES = [
  'mongo_data_documents',
  'mongo_data_document',
  'mongo_data_bulk',
  'mongo_data_aggregation',
  'mongo_data_import',
  'mongo_data_export',
  'mongo_data_transaction',
  'mongo_data_change_stream'
];

export const mongoDataApiFamily = getApiFamily('mongo');
export const mongoDataRequestContract = getContract('mongo_data_request');
export const mongoDataResultContract = getContract('mongo_data_result');
export const mongoDataApiRoutes = filterPublicRoutes({ family: 'mongo' }).filter((route) =>
  MONGO_DATA_RESOURCE_TYPES.includes(route.resourceType)
);

export function listMongoDataApiRoutes(filters = {}) {
  return mongoDataApiRoutes.filter((route) =>
    Object.entries(filters).every(([field, value]) => {
      if (value === undefined || value === null || value === '') return true;
      const routeValue = route[field];
      if (Array.isArray(routeValue)) return routeValue.includes(value);
      return routeValue === value;
    })
  );
}

export function getMongoDataApiRoute(operationId) {
  const route = getPublicRoute(operationId);
  return route && MONGO_DATA_RESOURCE_TYPES.includes(route.resourceType) ? route : undefined;
}

const ROUTE_MATCHERS_BY_OPERATION = {
  list: (route) => route.operationId === 'listMongoDataDocuments',
  get: (route) => route.operationId === 'getMongoDataDocument',
  insert: (route) => route.operationId === 'createMongoDataDocument',
  update: (route) => route.operationId === 'updateMongoDataDocument',
  replace: (route) => route.operationId === 'replaceMongoDataDocument',
  delete: (route) => route.operationId === 'deleteMongoDataDocument',
  bulk_write: (route) => route.operationId === 'bulkWriteMongoDataDocuments',
  aggregate: (route) => route.operationId === 'aggregateMongoDataDocuments',
  import: (route) => route.operationId === 'importMongoDataDocuments',
  export: (route) => route.operationId === 'exportMongoDataDocuments',
  transaction: (route) => route.operationId === 'executeMongoDataTransaction',
  change_stream: (route) => route.operationId === 'createMongoDataChangeStream'
};

export function summarizeMongoDataApiSurface(options = {}) {
  return {
    familyId: mongoDataApiFamily?.id,
    routeCount: mongoDataApiRoutes.length,
    operations: summarizeMongoDataApiCapabilityMatrix(options).map((entry) => ({
      ...entry,
      routeCount: mongoDataApiRoutes.filter((route) => ROUTE_MATCHERS_BY_OPERATION[entry.operation]?.(route)).length
    })),
    filterOperators: MONGO_DATA_FILTER_OPERATORS,
    updateOperators: MONGO_DATA_UPDATE_OPERATORS,
    bulkActions: MONGO_DATA_BULK_ACTIONS,
    sortDirections: MONGO_DATA_SORT_DIRECTIONS,
    aggregationStages: MONGO_DATA_AGGREGATION_STAGES,
    changeStreamStages: MONGO_DATA_CHANGE_STREAM_STAGES,
    importModes: MONGO_DATA_IMPORT_MODES,
    exportFormats: MONGO_DATA_EXPORT_FORMATS,
    transactionActions: MONGO_DATA_TRANSACTION_ACTIONS,
    supportedTopologies: MONGO_DATA_SUPPORTED_TOPOLOGIES
  };
}

export {
  MONGO_DATA_API_CAPABILITIES,
  MONGO_DATA_API_OPERATIONS,
  MONGO_DATA_BULK_ACTIONS,
  MONGO_DATA_FILTER_OPERATORS,
  MONGO_DATA_SORT_DIRECTIONS,
  MONGO_DATA_UPDATE_OPERATORS,
  MONGO_DATA_AGGREGATION_STAGES,
  MONGO_DATA_CHANGE_STREAM_STAGES,
  MONGO_DATA_IMPORT_MODES,
  MONGO_DATA_EXPORT_FORMATS,
  MONGO_DATA_TRANSACTION_ACTIONS,
  MONGO_DATA_SUPPORTED_TOPOLOGIES
};
