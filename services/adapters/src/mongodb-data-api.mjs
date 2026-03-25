import {
  getAdapterPort,
  getContract
} from '../../internal-contracts/src/index.mjs';

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
const FIELD_SEGMENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const FIELD_PATH_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const ALLOWED_TOP_LEVEL_FILTER_OPERATORS = new Set(['$and', '$or']);
const ALLOWED_FIELD_FILTER_OPERATORS = new Set(['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin', '$exists', '$regex', '$elemMatch']);
const ALLOWED_UPDATE_OPERATORS = new Set(['$set', '$unset', '$inc', '$push', '$pull']);
const DIRECTION_MAP = new Map([
  ['asc', 1],
  ['desc', -1],
  [1, 1],
  [-1, -1]
]);
const SUPPORTED_TOPOLOGIES = Object.freeze(['replica_set', 'sharded_cluster']);
const AGGREGATION_ALLOWED_STAGES = new Set([
  '$match',
  '$project',
  '$sort',
  '$limit',
  '$skip',
  '$group',
  '$unwind',
  '$lookup',
  '$count',
  '$facet',
  '$addFields',
  '$set',
  '$unset',
  '$replaceRoot',
  '$replaceWith'
]);
const AGGREGATION_BLOCKED_STAGES = new Set(['$out', '$merge', '$geoNear']);
const CHANGE_STREAM_ALLOWED_STAGES = new Set(['$match', '$project', '$addFields', '$set', '$unset', '$replaceRoot', '$replaceWith']);
const TRANSACTION_ACTIONS = new Set(['insert', 'update', 'replace', 'delete']);

export const mongodbDataAdapterPort = getAdapterPort('mongodb');
export const mongoDataRequestContract = getContract('mongo_data_request');
export const mongoDataResultContract = getContract('mongo_data_result');

export const MONGO_DATA_API_OPERATIONS = Object.freeze([
  'list',
  'get',
  'insert',
  'update',
  'replace',
  'delete',
  'bulk_write',
  'aggregate',
  'import',
  'export',
  'transaction',
  'change_stream'
]);
export const MONGO_DATA_FILTER_OPERATORS = Object.freeze([
  '$eq',
  '$ne',
  '$gt',
  '$gte',
  '$lt',
  '$lte',
  '$in',
  '$nin',
  '$exists',
  '$regex',
  '$elemMatch',
  '$and',
  '$or'
]);
export const MONGO_DATA_UPDATE_OPERATORS = Object.freeze([...ALLOWED_UPDATE_OPERATORS]);
export const MONGO_DATA_BULK_ACTIONS = Object.freeze(['insertOne', 'updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany']);
export const MONGO_DATA_SORT_DIRECTIONS = Object.freeze(['asc', 'desc']);
export const MONGO_DATA_IMPORT_MODES = Object.freeze(['insert', 'replace', 'upsert']);
export const MONGO_DATA_EXPORT_FORMATS = Object.freeze(['json']);
export const MONGO_DATA_TRANSACTION_ACTIONS = Object.freeze([...TRANSACTION_ACTIONS]);
export const MONGO_DATA_SUPPORTED_TOPOLOGIES = SUPPORTED_TOPOLOGIES;
export const MONGO_DATA_AGGREGATION_STAGES = Object.freeze([...AGGREGATION_ALLOWED_STAGES]);
export const MONGO_DATA_CHANGE_STREAM_STAGES = Object.freeze([...CHANGE_STREAM_ALLOWED_STAGES]);
export const MONGO_DATA_DEFAULT_PAGE_SIZE = 25;
export const MONGO_DATA_MAX_PAGE_SIZE = 100;
export const MONGO_DATA_DEFAULT_BULK_LIMITS = Object.freeze({
  maxOperations: 100,
  maxPayloadBytes: 262144,
  ordered: true
});
export const MONGO_DATA_DEFAULT_AGGREGATION_LIMITS = Object.freeze({
  maxStages: 12,
  maxPayloadBytes: 65536,
  maxTimeMs: 30000,
  maxResultWindow: 1000,
  maxSkip: 10000,
  maxLookupStages: 1,
  maxFacetBranches: 4,
  maxSortKeys: 6,
  allowDiskUse: false
});
export const MONGO_DATA_DEFAULT_TRANSFER_LIMITS = Object.freeze({
  maxDocuments: 500,
  maxPayloadBytes: 524288,
  maxExportDocuments: 1000,
  exportConsistency: 'snapshot',
  ordered: true
});
export const MONGO_DATA_DEFAULT_TRANSACTION_LIMITS = Object.freeze({
  maxOperations: 25,
  maxPayloadBytes: 262144,
  maxCommitTimeMs: 10000,
  readConcern: 'snapshot',
  writeConcern: 'majority'
});
export const MONGO_DATA_DEFAULT_CHANGE_STREAM_LIMITS = Object.freeze({
  maxStages: 6,
  maxPayloadBytes: 16384,
  replayWindowSeconds: 3600,
  fullDocument: 'whenAvailable',
  transport: 'event_gateway'
});
export const MONGO_DATA_API_CAPABILITIES = Object.freeze({
  list: 'mongo_data_query',
  get: 'mongo_data_query',
  insert: 'mongo_data_insert',
  update: 'mongo_data_update',
  replace: 'mongo_data_replace',
  delete: 'mongo_data_delete',
  bulk_write: 'mongo_data_bulk_write',
  aggregate: 'mongo_data_aggregate',
  import: 'mongo_data_import',
  export: 'mongo_data_export',
  transaction: 'mongo_data_transaction',
  change_stream: 'mongo_data_change_stream'
});

export class MongoDataApiError extends Error {
  constructor({ message, code, status = 400, details = [], meta = {} }) {
    super(message);
    this.name = 'MongoDataApiError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.meta = meta;
  }
}

function compactDefined(value = {}) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeNonEmptyString(value, fieldName) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new MongoDataApiError({
      code: 'mongo_data_invalid_identifier',
      status: 400,
      message: `${fieldName} must be a non-empty string.`
    });
  }

  return value.trim();
}

function normalizeScopedName(value, fieldName) {
  const normalized = normalizeNonEmptyString(value, fieldName);
  if (!NAME_PATTERN.test(normalized)) {
    throw new MongoDataApiError({
      code: 'mongo_data_invalid_identifier',
      status: 400,
      message: `${fieldName} must match ${NAME_PATTERN}. Received ${value}.`
    });
  }

  return normalized;
}

function normalizeFieldPath(value, fieldName = 'fieldPath') {
  const normalized = normalizeNonEmptyString(value, fieldName);
  if (!FIELD_PATH_PATTERN.test(normalized)) {
    throw new MongoDataApiError({
      code: 'mongo_data_invalid_field_path',
      status: 400,
      message: `${fieldName} must use dot-separated identifier segments. Received ${value}.`
    });
  }

  return normalized;
}

function normalizePositiveInteger(value, { fieldName, minimum = 1, maximum } = {}) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < minimum || (maximum !== undefined && numeric > maximum)) {
    throw new MongoDataApiError({
      code: 'mongo_data_invalid_limit',
      status: 400,
      message: `${fieldName} must be an integer between ${minimum} and ${maximum ?? 'Infinity'}.`
    });
  }

  return numeric;
}

function normalizeNonNegativeInteger(value, { fieldName, maximum } = {}) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0 || (maximum !== undefined && numeric > maximum)) {
    throw new MongoDataApiError({
      code: 'mongo_data_invalid_limit',
      status: 400,
      message: `${fieldName} must be an integer between 0 and ${maximum ?? 'Infinity'}.`
    });
  }

  return numeric;
}

function normalizeEnumValue(value, allowedValues, fieldName) {
  const normalized = normalizeNonEmptyString(value, fieldName);
  if (!allowedValues.includes(normalized)) {
    throw new MongoDataApiError({
      code: 'mongo_data_invalid_option',
      status: 400,
      message: `${fieldName} must be one of ${allowedValues.join(', ')}.`
    });
  }

  return normalized;
}

function pathSegments(path) {
  return normalizeFieldPath(path).split('.');
}

function setPathValue(target, path, value) {
  const segments = pathSegments(path);
  let cursor = target;
  while (segments.length > 1) {
    const segment = segments.shift();
    if (!FIELD_SEGMENT_PATTERN.test(segment)) {
      throw new MongoDataApiError({
        code: 'mongo_data_invalid_field_path',
        status: 400,
        message: `Invalid field path segment ${segment}.`
      });
    }
    cursor[segment] ??= {};
    if (!isPlainObject(cursor[segment])) {
      cursor[segment] = {};
    }
    cursor = cursor[segment];
  }
  cursor[segments[0]] = value;
}

function unsetPathValue(target, path) {
  const segments = pathSegments(path);
  let cursor = target;
  while (segments.length > 1) {
    const segment = segments.shift();
    if (!isPlainObject(cursor?.[segment])) {
      return;
    }
    cursor = cursor[segment];
  }

  delete cursor?.[segments[0]];
}

function getPathValue(target, path) {
  return pathSegments(path).reduce((cursor, segment) => cursor?.[segment], target);
}

function normalizeRegexValue(value, fieldPath) {
  if (typeof value === 'string') {
    return value;
  }

  if (isPlainObject(value) && typeof value.pattern === 'string') {
    return compactDefined({
      pattern: value.pattern,
      options: typeof value.options === 'string' ? value.options : undefined
    });
  }

  throw new MongoDataApiError({
    code: 'mongo_data_invalid_filter',
    status: 400,
    message: `Filter operator $regex on ${fieldPath} must be a string or { pattern, options } object.`
  });
}

function normalizeFieldOperatorValue(operator, value, fieldPath) {
  switch (operator) {
    case '$exists':
      if (typeof value !== 'boolean') {
        throw new MongoDataApiError({
          code: 'mongo_data_invalid_filter',
          status: 400,
          message: `Filter operator $exists on ${fieldPath} must be boolean.`
        });
      }
      return value;
    case '$in':
    case '$nin':
      if (!Array.isArray(value) || value.length === 0) {
        throw new MongoDataApiError({
          code: 'mongo_data_invalid_filter',
          status: 400,
          message: `Filter operator ${operator} on ${fieldPath} must be a non-empty array.`
        });
      }
      return value.map((entry) => normalizeFilterScalar(entry, fieldPath));
    case '$regex':
      return normalizeRegexValue(value, fieldPath);
    case '$elemMatch':
      if (!isPlainObject(value)) {
        throw new MongoDataApiError({
          code: 'mongo_data_invalid_filter',
          status: 400,
          message: `Filter operator $elemMatch on ${fieldPath} must be an object.`
        });
      }
      return normalizeFieldFilterObject(value, fieldPath);
    default:
      return normalizeFilterScalar(value, fieldPath);
  }
}

function normalizeFilterScalar(value, fieldPath = 'filter') {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeFilterScalar(entry, fieldPath));
  }

  if (isPlainObject(value)) {
    return normalizeFieldFilterObject(value, fieldPath);
  }

  throw new MongoDataApiError({
    code: 'mongo_data_invalid_filter',
    status: 400,
    message: `Filter value for ${fieldPath} must be JSON-compatible.`
  });
}

function normalizeFieldFilterObject(node, fieldPath) {
  const entries = Object.entries(node ?? {});
  if (entries.length === 0) {
    throw new MongoDataApiError({
      code: 'mongo_data_invalid_filter',
      status: 400,
      message: `Filter object for ${fieldPath} must not be empty.`
    });
  }

  const containsOperator = entries.some(([key]) => key.startsWith('$'));
  if (!containsOperator) {
    return Object.fromEntries(
      entries.map(([key, value]) => [normalizeFieldPath(key, `filter.${fieldPath}.${key}`), normalizeFilterScalar(value, `${fieldPath}.${key}`)])
    );
  }

  return Object.fromEntries(
    entries.map(([operator, value]) => {
      if (!ALLOWED_FIELD_FILTER_OPERATORS.has(operator)) {
        throw new MongoDataApiError({
          code: 'mongo_data_invalid_filter',
          status: 400,
          message: `Unsupported MongoDB filter operator ${operator} on ${fieldPath}.`
        });
      }

      return [operator, normalizeFieldOperatorValue(operator, value, fieldPath)];
    })
  );
}

export function normalizeMongoDataFilter(filter = {}) {
  if (filter === undefined || filter === null || (isPlainObject(filter) && Object.keys(filter).length === 0)) {
    return {};
  }

  if (!isPlainObject(filter)) {
    throw new MongoDataApiError({
      code: 'mongo_data_invalid_filter',
      status: 400,
      message: 'filter must be an object.'
    });
  }

  return Object.fromEntries(
    Object.entries(filter).map(([key, value]) => {
      if (key.startsWith('$')) {
        if (!ALLOWED_TOP_LEVEL_FILTER_OPERATORS.has(key)) {
          throw new MongoDataApiError({
            code: 'mongo_data_invalid_filter',
            status: 400,
            message: `Unsupported top-level MongoDB filter operator ${key}.`
          });
        }

        if (!Array.isArray(value) || value.length === 0) {
          throw new MongoDataApiError({
            code: 'mongo_data_invalid_filter',
            status: 400,
            message: `${key} must be a non-empty array of filter expressions.`
          });
        }

        return [key, value.map((entry) => normalizeMongoDataFilter(entry))];
      }

      return [normalizeFieldPath(key, `filter.${key}`), normalizeFilterScalar(value, key)];
    })
  );
}

export function normalizeMongoDataProjection(projection = undefined) {
  if (projection === undefined || projection === null) {
    return undefined;
  }

  if (!isPlainObject(projection) || Object.keys(projection).length === 0) {
    throw new MongoDataApiError({
      code: 'mongo_data_invalid_projection',
      status: 400,
      message: 'projection must be a non-empty object when provided.'
    });
  }

  return Object.fromEntries(
    Object.entries(projection).map(([fieldPath, include]) => {
      if (![0, 1, true, false].includes(include)) {
        throw new MongoDataApiError({
          code: 'mongo_data_invalid_projection',
          status: 400,
          message: `projection for ${fieldPath} must be 0/1 or true/false.`
        });
      }

      return [normalizeFieldPath(fieldPath, `projection.${fieldPath}`), include === true ? 1 : include === false ? 0 : include];
    })
  );
}

export function normalizeMongoDataSort(sort = undefined) {
  if (sort === undefined || sort === null) {
    return { _id: 1 };
  }

  if (!isPlainObject(sort) || Object.keys(sort).length === 0) {
    throw new MongoDataApiError({
      code: 'mongo_data_invalid_sort',
      status: 400,
      message: 'sort must be a non-empty object when provided.'
    });
  }

  const normalized = Object.fromEntries(
    Object.entries(sort).map(([fieldPath, direction]) => {
      if (!DIRECTION_MAP.has(direction)) {
        throw new MongoDataApiError({
          code: 'mongo_data_invalid_sort',
          status: 400,
          message: `sort direction for ${fieldPath} must be asc/desc/1/-1.`
        });
      }

      return [normalizeFieldPath(fieldPath, `sort.${fieldPath}`), DIRECTION_MAP.get(direction)];
    })
  );

  if (!('_id' in normalized)) {
    normalized._id = 1;
  }

  return normalized;
}

export function estimateMongoPayloadBytes(value) {
  return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
}

function normalizePageSize(value) {
  if (value === undefined || value === null) {
    return MONGO_DATA_DEFAULT_PAGE_SIZE;
  }

  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0 || numeric > MONGO_DATA_MAX_PAGE_SIZE) {
    throw new MongoDataApiError({
      code: 'mongo_data_invalid_page',
      status: 400,
      message: `page.size must be an integer between 1 and ${MONGO_DATA_MAX_PAGE_SIZE}.`
    });
  }

  return numeric;
}

export function encodeMongoDataCursor(cursor = {}) {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function parseMongoDataCursor(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    if (!isPlainObject(parsed) || !isPlainObject(parsed.values)) {
      throw new Error('invalid cursor payload');
    }
    return parsed;
  } catch (error) {
    throw new MongoDataApiError({
      code: 'mongo_data_invalid_page',
      status: 400,
      message: 'page.after must be a valid Mongo Data API cursor.',
      meta: { cause: error.message }
    });
  }
}

export function buildMongoCursorPredicate(sort = { _id: 1 }, cursor = undefined) {
  if (!cursor) {
    return undefined;
  }

  const sortEntries = Object.entries(sort);
  const predicates = [];

  for (let index = 0; index < sortEntries.length; index += 1) {
    const branch = {};
    for (let equalityIndex = 0; equalityIndex < index; equalityIndex += 1) {
      const [field] = sortEntries[equalityIndex];
      branch[field] = cursor.values[field];
    }

    const [field, direction] = sortEntries[index];
    branch[field] = { [direction === -1 ? '$lt' : '$gt']: cursor.values[field] };
    predicates.push(branch);
  }

  return predicates.length === 1 ? predicates[0] : { $or: predicates };
}

function mergeFilters(left = {}, right = {}) {
  if (!left || Object.keys(left).length === 0) return right;
  if (!right || Object.keys(right).length === 0) return left;
  return { $and: [left, right] };
}

function collectTenantPredicates(node, tenantFieldPath, matches = []) {
  if (!isPlainObject(node)) {
    return matches;
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === tenantFieldPath) {
      matches.push(value);
      continue;
    }

    if (key === '$and' || key === '$or') {
      for (const entry of value ?? []) {
        collectTenantPredicates(entry, tenantFieldPath, matches);
      }
      continue;
    }

    if (isPlainObject(value)) {
      collectTenantPredicates(value, tenantFieldPath, matches);
    }
  }

  return matches;
}

function validateTenantPredicate(predicate, tenantId, tenantFieldPath) {
  if (predicate === tenantId) {
    return;
  }

  if (isPlainObject(predicate) && '$eq' in predicate && predicate.$eq === tenantId) {
    return;
  }

  if (isPlainObject(predicate) && '$in' in predicate && Array.isArray(predicate.$in) && predicate.$in.includes(tenantId)) {
    return;
  }

  throw new MongoDataApiError({
    code: 'mongo_data_tenant_scope_violation',
    status: 403,
    message: `Tenant-scoped operations cannot override ${tenantFieldPath}.`
  });
}

export function applyTenantScopeToFilter({ filter = {}, tenantId, tenantFieldPath = 'tenantId' }) {
  const normalizedTenantId = normalizeNonEmptyString(tenantId, 'tenantId');
  const normalizedTenantFieldPath = normalizeFieldPath(tenantFieldPath, 'tenantFieldPath');
  const normalizedFilter = normalizeMongoDataFilter(filter);
  const tenantPredicates = collectTenantPredicates(normalizedFilter, normalizedTenantFieldPath);

  for (const predicate of tenantPredicates) {
    validateTenantPredicate(predicate, normalizedTenantId, normalizedTenantFieldPath);
  }

  const tenantFilter = {};
  setPathValue(tenantFilter, normalizedTenantFieldPath, normalizedTenantId);

  return {
    tenantScope: {
      fieldPath: normalizedTenantFieldPath,
      value: normalizedTenantId,
      injected: tenantPredicates.length === 0
    },
    filter: mergeFilters(tenantFilter, normalizedFilter)
  };
}

function normalizeWriteDocument(value, fieldName) {
  if (!isPlainObject(value)) {
    throw new MongoDataApiError({
      code: 'mongo_data_invalid_document',
      status: 400,
      message: `${fieldName} must be an object.`
    });
  }

  return cloneJson(value);
}

function injectTenantIntoDocument(document, tenantScope) {
  const currentValue = getPathValue(document, tenantScope.fieldPath);
  if (currentValue !== undefined && currentValue !== tenantScope.value) {
    throw new MongoDataApiError({
      code: 'mongo_data_tenant_scope_violation',
      status: 403,
      message: `Document payload cannot override ${tenantScope.fieldPath}.`
    });
  }

  setPathValue(document, tenantScope.fieldPath, tenantScope.value);
  return document;
}

export function normalizeMongoDataUpdateDocument(update = {}) {
  if (!isPlainObject(update) || Object.keys(update).length === 0) {
    throw new MongoDataApiError({
      code: 'mongo_data_invalid_update',
      status: 400,
      message: 'update must be a non-empty object.'
    });
  }

  const operators = Object.keys(update);
  if (!operators.every((operator) => operator.startsWith('$'))) {
    throw new MongoDataApiError({
      code: 'mongo_data_invalid_update',
      status: 400,
      message: 'Partial updates must use MongoDB update operators.'
    });
  }

  return Object.fromEntries(
    Object.entries(update).map(([operator, value]) => {
      if (!ALLOWED_UPDATE_OPERATORS.has(operator)) {
        throw new MongoDataApiError({
          code: 'mongo_data_invalid_update',
          status: 400,
          message: `Unsupported update operator ${operator}.`
        });
      }

      if (!isPlainObject(value) || Object.keys(value).length === 0) {
        throw new MongoDataApiError({
          code: 'mongo_data_invalid_update',
          status: 400,
          message: `${operator} must be a non-empty object.`
        });
      }

      return [
        operator,
        Object.fromEntries(
          Object.entries(value).map(([fieldPath, operand]) => {
            const normalizedFieldPath = normalizeFieldPath(fieldPath, `${operator}.${fieldPath}`);
            return [normalizedFieldPath, cloneJson(operand)];
          })
        )
      ];
    })
  );
}

export function applyMongoDataUpdateDocument(baseDocument = {}, update = {}) {
  const target = cloneJson(baseDocument ?? {});
  const normalizedUpdate = normalizeMongoDataUpdateDocument(update);

  for (const [operator, operations] of Object.entries(normalizedUpdate)) {
    for (const [fieldPath, operand] of Object.entries(operations)) {
      switch (operator) {
        case '$set':
          setPathValue(target, fieldPath, cloneJson(operand));
          break;
        case '$unset':
          unsetPathValue(target, fieldPath);
          break;
        case '$inc': {
          const currentValue = getPathValue(target, fieldPath) ?? 0;
          if (typeof currentValue !== 'number' || typeof operand !== 'number') {
            throw new MongoDataApiError({
              code: 'mongo_data_invalid_update',
              status: 400,
              message: `$inc on ${fieldPath} requires numeric operands.`
            });
          }
          setPathValue(target, fieldPath, currentValue + operand);
          break;
        }
        case '$push': {
          const currentValue = getPathValue(target, fieldPath);
          const nextArray = Array.isArray(currentValue) ? [...currentValue] : [];
          if (isPlainObject(operand) && Array.isArray(operand.$each)) {
            nextArray.push(...cloneJson(operand.$each));
          } else {
            nextArray.push(cloneJson(operand));
          }
          setPathValue(target, fieldPath, nextArray);
          break;
        }
        case '$pull': {
          const currentValue = getPathValue(target, fieldPath);
          if (!Array.isArray(currentValue)) {
            continue;
          }
          setPathValue(
            target,
            fieldPath,
            currentValue.filter((entry) => JSON.stringify(entry) !== JSON.stringify(operand))
          );
          break;
        }
        default:
          throw new MongoDataApiError({
            code: 'mongo_data_invalid_update',
            status: 400,
            message: `Unsupported update operator ${operator}.`
          });
      }
    }
  }

  return target;
}

function inferBsonType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (value instanceof Date) return 'date';
  switch (typeof value) {
    case 'string':
      return 'string';
    case 'number':
      return Number.isInteger(value) ? 'int' : 'double';
    case 'boolean':
      return 'bool';
    case 'object':
      return 'object';
    default:
      return typeof value;
  }
}

function matchesBsonType(value, bsonType) {
  const actualType = inferBsonType(value);
  const accepted = Array.isArray(bsonType) ? bsonType : [bsonType];
  return accepted.some((entry) => {
    if (entry === 'number') {
      return actualType === 'int' || actualType === 'double';
    }
    return entry === actualType;
  });
}

function validateSchemaNode(node = {}, value, path = '$', { partial = false } = {}) {
  const violations = [];

  if (node.bsonType && !matchesBsonType(value, node.bsonType)) {
    violations.push(`${path} must match bsonType ${JSON.stringify(node.bsonType)}.`);
    return violations;
  }

  if (node.enum && !node.enum.some((entry) => JSON.stringify(entry) === JSON.stringify(value))) {
    violations.push(`${path} must match one of the declared enum values.`);
  }

  if (typeof value === 'number') {
    if (node.minimum !== undefined && value < node.minimum) {
      violations.push(`${path} must be >= ${node.minimum}.`);
    }
    if (node.maximum !== undefined && value > node.maximum) {
      violations.push(`${path} must be <= ${node.maximum}.`);
    }
  }

  if (typeof value === 'string') {
    if (node.minLength !== undefined && value.length < node.minLength) {
      violations.push(`${path} must have length >= ${node.minLength}.`);
    }
    if (node.maxLength !== undefined && value.length > node.maxLength) {
      violations.push(`${path} must have length <= ${node.maxLength}.`);
    }
  }

  if (Array.isArray(value) && node.items) {
    value.forEach((entry, index) => {
      violations.push(...validateSchemaNode(node.items, entry, `${path}[${index}]`, { partial: false }));
    });
  }

  if (isPlainObject(value)) {
    const required = partial ? [] : node.required ?? [];
    for (const requiredField of required) {
      if (value[requiredField] === undefined) {
        violations.push(`${path}.${requiredField} is required.`);
      }
    }

    for (const [propertyName, propertySchema] of Object.entries(node.properties ?? {})) {
      if (value[propertyName] !== undefined) {
        violations.push(...validateSchemaNode(propertySchema, value[propertyName], `${path}.${propertyName}`, { partial: false }));
      }
    }
  }

  return violations;
}

export function validateMongoDocumentAgainstCollectionRules(document, validationRules, options = {}) {
  const rules = validationRules?.$jsonSchema ?? validationRules;
  if (!rules) {
    return { valid: true, violations: [] };
  }

  const violations = validateSchemaNode(rules, document, '$', options);
  return {
    valid: violations.length === 0,
    violations
  };
}

function buildUniqueIndexSignature(index, document) {
  if (!isPlainObject(index?.keys) || index.unique !== true) {
    return undefined;
  }

  const values = Object.keys(index.keys).map((fieldPath) => getPathValue(document, fieldPath));
  if (values.some((value) => value === undefined)) {
    return undefined;
  }

  return `${index.name ?? 'unnamed'}:${JSON.stringify(values)}`;
}

export function detectMongoRequestUniqueIndexConflicts({ documents = [], indexes = [] }) {
  const seen = new Map();
  const conflicts = [];

  documents.forEach((document, documentIndex) => {
    indexes.forEach((index) => {
      const signature = buildUniqueIndexSignature(index, document);
      if (!signature) {
        return;
      }

      if (seen.has(signature)) {
        conflicts.push({
          indexName: index.name ?? 'unnamed',
          firstDocumentIndex: seen.get(signature),
          conflictingDocumentIndex: documentIndex,
          keys: Object.keys(index.keys)
        });
        return;
      }

      seen.set(signature, documentIndex);
    });
  });

  return conflicts;
}

function normalizeBulkLimits(limits = {}, defaults = MONGO_DATA_DEFAULT_BULK_LIMITS) {
  const maxOperations = Number(limits.maxOperations ?? defaults.maxOperations);
  const maxPayloadBytes = Number(limits.maxPayloadBytes ?? defaults.maxPayloadBytes);
  if (!Number.isInteger(maxOperations) || maxOperations <= 0) {
    throw new MongoDataApiError({
      code: 'mongo_data_invalid_bulk_limits',
      status: 400,
      message: 'bulk maxOperations must be a positive integer.'
    });
  }
  if (!Number.isInteger(maxPayloadBytes) || maxPayloadBytes <= 0) {
    throw new MongoDataApiError({
      code: 'mongo_data_invalid_bulk_limits',
      status: 400,
      message: 'bulk maxPayloadBytes must be a positive integer.'
    });
  }

  return {
    maxOperations,
    maxPayloadBytes,
    ordered: limits.ordered ?? defaults.ordered ?? true
  };
}

function normalizeBulkOperation({ operation, tenantScope, collectionMetadata, existingDocumentMap = new Map() }, index) {
  const kind = operation?.kind ?? operation?.operation ?? operation?.type;
  if (!MONGO_DATA_BULK_ACTIONS.includes(kind)) {
    throw new MongoDataApiError({
      code: 'mongo_data_invalid_bulk_operation',
      status: 400,
      message: `bulk.operations[${index}] uses unsupported kind ${kind}.`
    });
  }

  switch (kind) {
    case 'insertOne': {
      const document = injectTenantIntoDocument(normalizeWriteDocument(operation.document, `bulk.operations[${index}].document`), tenantScope);
      return compactDefined({ kind, document, validationContext: { candidateDocument: document, partial: false } });
    }
    case 'replaceOne': {
      const normalizedFilter = applyTenantScopeToFilter({ filter: operation.filter, tenantId: tenantScope.value, tenantFieldPath: tenantScope.fieldPath }).filter;
      const replacement = injectTenantIntoDocument(normalizeWriteDocument(operation.replacement, `bulk.operations[${index}].replacement`), tenantScope);
      return compactDefined({ kind, filter: normalizedFilter, replacement, upsert: operation.upsert === true, validationContext: { candidateDocument: replacement, partial: false } });
    }
    case 'updateOne':
    case 'updateMany': {
      const normalizedFilter = applyTenantScopeToFilter({ filter: operation.filter, tenantId: tenantScope.value, tenantFieldPath: tenantScope.fieldPath }).filter;
      const update = normalizeMongoDataUpdateDocument(operation.update);
      const existingDocument = operation.documentId ? existingDocumentMap.get(operation.documentId) : operation.existingDocument;
      const candidateDocument = existingDocument ? injectTenantIntoDocument(applyMongoDataUpdateDocument(existingDocument, update), tenantScope) : undefined;
      return compactDefined({ kind, filter: normalizedFilter, update, upsert: operation.upsert === true, validationContext: candidateDocument ? { candidateDocument, partial: false } : { partial: true } });
    }
    case 'deleteOne':
    case 'deleteMany': {
      const normalizedFilter = applyTenantScopeToFilter({ filter: operation.filter, tenantId: tenantScope.value, tenantFieldPath: tenantScope.fieldPath }).filter;
      return { kind, filter: normalizedFilter };
    }
    default:
      throw new MongoDataApiError({
        code: 'mongo_data_invalid_bulk_operation',
        status: 400,
        message: `bulk.operations[${index}] uses unsupported kind ${kind}.`
      });
  }
}

function validateCandidateDocument({ collectionMetadata = {}, validationContext = {} }) {
  const candidateDocument = validationContext.candidateDocument;
  if (!candidateDocument) {
    return { applied: false, violations: [] };
  }

  const result = validateMongoDocumentAgainstCollectionRules(
    candidateDocument,
    collectionMetadata.validationRules,
    { partial: validationContext.partial === true }
  );

  if (!result.valid) {
    throw new MongoDataApiError({
      code: 'mongo_data_validation_failed',
      status: 422,
      message: 'Document payload violates collection validation rules.',
      details: result.violations,
      meta: { collectionValidation: true }
    });
  }

  return { applied: Boolean(collectionMetadata.validationRules), violations: [] };
}

function normalizeTopologyProfile(topology = {}) {
  if (!topology || Object.keys(topology).length === 0) {
    return {};
  }

  const clusterTopology = topology.clusterTopology ?? topology.topology;
  return compactDefined({
    clusterTopology: clusterTopology ? normalizeNonEmptyString(clusterTopology, 'clusterTopology') : undefined,
    supportsTransactions:
      topology.supportsTransactions === undefined ? undefined : Boolean(topology.supportsTransactions),
    supportsChangeStreams:
      topology.supportsChangeStreams === undefined ? undefined : Boolean(topology.supportsChangeStreams)
  });
}

function normalizeBridgeProfile(bridge = {}) {
  if (!bridge || Object.keys(bridge).length === 0) {
    return {};
  }

  return compactDefined({
    provider: bridge.provider ? normalizeNonEmptyString(bridge.provider, 'bridge.provider') : 'event_gateway',
    available: bridge.available === undefined ? undefined : Boolean(bridge.available),
    transport: bridge.transport ? normalizeNonEmptyString(bridge.transport, 'bridge.transport') : undefined,
    reason: bridge.reason ? normalizeNonEmptyString(bridge.reason, 'bridge.reason') : undefined
  });
}

export function resolveMongoDataCapabilityCompatibility({ operation, topology = {}, bridge = {} } = {}) {
  const normalizedTopology = normalizeTopologyProfile(topology);
  const normalizedBridge = normalizeBridgeProfile(bridge);
  const requiresTopology = operation === 'transaction' || operation === 'change_stream';
  const requiresBridge = operation === 'change_stream';

  const compatibility = {
    feature: operation,
    capability: MONGO_DATA_API_CAPABILITIES[operation],
    supported: true,
    status: 'available',
    requiredTopologies: requiresTopology ? SUPPORTED_TOPOLOGIES : [],
    clusterTopology: normalizedTopology.clusterTopology,
    reason: undefined,
    bridge: requiresBridge
      ? {
          provider: normalizedBridge.provider ?? 'event_gateway',
          required: true,
          available: normalizedBridge.available ?? false,
          status: normalizedBridge.available === true ? 'ready' : 'unavailable',
          transport: normalizedBridge.transport ?? 'event_gateway',
          reason: normalizedBridge.reason
        }
      : undefined
  };

  if (requiresTopology) {
    if (!normalizedTopology.clusterTopology) {
      compatibility.supported = false;
      compatibility.status = 'topology_unknown';
      compatibility.reason = 'Cluster topology must be known before evaluating this MongoDB Data API capability.';
      return compatibility;
    }

    if (!SUPPORTED_TOPOLOGIES.includes(normalizedTopology.clusterTopology)) {
      compatibility.supported = false;
      compatibility.status = 'topology_unsupported';
      compatibility.reason = `This capability requires one of: ${SUPPORTED_TOPOLOGIES.join(', ')}.`;
      return compatibility;
    }
  }

  if (operation === 'transaction' && normalizedTopology.supportsTransactions === false) {
    compatibility.supported = false;
    compatibility.status = 'topology_unsupported';
    compatibility.reason = 'Transactions are disabled for the current MongoDB deployment profile.';
    return compatibility;
  }

  if (operation === 'change_stream') {
    if (normalizedTopology.supportsChangeStreams === false) {
      compatibility.supported = false;
      compatibility.status = 'topology_unsupported';
      compatibility.reason = 'Change streams are disabled for the current MongoDB deployment profile.';
      compatibility.bridge.status = 'blocked';
      return compatibility;
    }

    if (normalizedBridge.available !== true) {
      compatibility.supported = false;
      compatibility.status = 'bridge_unavailable';
      compatibility.reason = normalizedBridge.reason ?? 'Change streams require the realtime/event gateway bridge to be available.';
      compatibility.bridge.status = 'unavailable';
      return compatibility;
    }
  }

  return compatibility;
}

function assertCapabilityCompatibility(compatibility) {
  if (compatibility.supported) {
    return compatibility;
  }

  throw new MongoDataApiError({
    code: 'mongo_data_capability_unavailable',
    status: compatibility.status === 'bridge_unavailable' ? 503 : 409,
    message: compatibility.reason ?? 'MongoDB capability is not available for the current deployment.',
    meta: { compatibility }
  });
}

function normalizeAggregationLimits(limits = {}, defaults = MONGO_DATA_DEFAULT_AGGREGATION_LIMITS) {
  return {
    maxStages: normalizePositiveInteger(limits.maxStages ?? defaults.maxStages, { fieldName: 'aggregation.maxStages' }),
    maxPayloadBytes: normalizePositiveInteger(limits.maxPayloadBytes ?? defaults.maxPayloadBytes, { fieldName: 'aggregation.maxPayloadBytes' }),
    maxTimeMs: normalizePositiveInteger(limits.maxTimeMs ?? defaults.maxTimeMs, { fieldName: 'aggregation.maxTimeMs' }),
    maxResultWindow: normalizePositiveInteger(limits.maxResultWindow ?? defaults.maxResultWindow, { fieldName: 'aggregation.maxResultWindow' }),
    maxSkip: normalizeNonNegativeInteger(limits.maxSkip ?? defaults.maxSkip, { fieldName: 'aggregation.maxSkip' }),
    maxLookupStages: normalizeNonNegativeInteger(limits.maxLookupStages ?? defaults.maxLookupStages, { fieldName: 'aggregation.maxLookupStages' }),
    maxFacetBranches: normalizePositiveInteger(limits.maxFacetBranches ?? defaults.maxFacetBranches, { fieldName: 'aggregation.maxFacetBranches' }),
    maxSortKeys: normalizePositiveInteger(limits.maxSortKeys ?? defaults.maxSortKeys, { fieldName: 'aggregation.maxSortKeys' }),
    allowDiskUse: limits.allowDiskUse ?? defaults.allowDiskUse ?? false
  };
}

function buildTenantMatchFilter(tenantScope) {
  const tenantMatch = {};
  setPathValue(tenantMatch, tenantScope.fieldPath, tenantScope.value);
  return tenantMatch;
}

function buildChangeStreamTenantMatch(tenantScope) {
  return {
    $or: [
      { [`fullDocument.${tenantScope.fieldPath}`]: tenantScope.value },
      { [`fullDocumentBeforeChange.${tenantScope.fieldPath}`]: tenantScope.value },
      { [`updateDescription.updatedFields.${tenantScope.fieldPath}`]: tenantScope.value }
    ]
  };
}

function normalizePipelineStage(stage, { kind, stagePath, limits, state, tenantScope } = {}) {
  if (!isPlainObject(stage) || Object.keys(stage).length !== 1) {
    throw new MongoDataApiError({
      code: 'mongo_data_invalid_pipeline',
      status: 400,
      message: `${stagePath} must contain exactly one aggregation stage.`
    });
  }

  const [stageName, stageValue] = Object.entries(stage)[0];
  const allowedStages = kind === 'change_stream' ? CHANGE_STREAM_ALLOWED_STAGES : AGGREGATION_ALLOWED_STAGES;
  if (AGGREGATION_BLOCKED_STAGES.has(stageName)) {
    throw new MongoDataApiError({
      code: 'mongo_data_pipeline_stage_blocked',
      status: 400,
      message: `${stageName} is blocked for the MongoDB Data API ${kind} surface.`
    });
  }

  if (!allowedStages.has(stageName)) {
    throw new MongoDataApiError({
      code: 'mongo_data_invalid_pipeline',
      status: 400,
      message: `${stageName} is not supported for ${kind} pipelines.`
    });
  }

  state.stageNames.push(stageName);

  switch (stageName) {
    case '$match':
      return { $match: normalizeMongoDataFilter(stageValue) };
    case '$project':
      return { $project: normalizeMongoDataProjection(stageValue) };
    case '$sort': {
      const normalizedSort = normalizeMongoDataSort(stageValue);
      if (Object.keys(normalizedSort).length > limits.maxSortKeys + 1) {
        throw new MongoDataApiError({
          code: 'mongo_data_pipeline_too_costly',
          status: 400,
          message: `${stagePath} exceeds the configured maximum number of sort keys.`
        });
      }
      return { $sort: normalizedSort };
    }
    case '$limit': {
      const limit = normalizePositiveInteger(stageValue, {
        fieldName: `${stagePath}.$limit`,
        maximum: limits.maxResultWindow
      });
      return { $limit: limit };
    }
    case '$skip': {
      const skip = normalizeNonNegativeInteger(stageValue, {
        fieldName: `${stagePath}.$skip`,
        maximum: limits.maxSkip
      });
      return { $skip: skip };
    }
    case '$lookup': {
      state.lookupStages += 1;
      if (state.lookupStages > limits.maxLookupStages) {
        throw new MongoDataApiError({
          code: 'mongo_data_pipeline_too_costly',
          status: 400,
          message: `The aggregation pipeline exceeds the configured maximum of ${limits.maxLookupStages} $lookup stages.`
        });
      }
      if (!isPlainObject(stageValue)) {
        throw new MongoDataApiError({
          code: 'mongo_data_invalid_pipeline',
          status: 400,
          message: `${stagePath}.$lookup must be an object.`
        });
      }
      return { $lookup: cloneJson(stageValue) };
    }
    case '$facet': {
      if (!isPlainObject(stageValue) || Object.keys(stageValue).length === 0) {
        throw new MongoDataApiError({
          code: 'mongo_data_invalid_pipeline',
          status: 400,
          message: `${stagePath}.$facet must be a non-empty object.`
        });
      }
      if (Object.keys(stageValue).length > limits.maxFacetBranches) {
        throw new MongoDataApiError({
          code: 'mongo_data_pipeline_too_costly',
          status: 400,
          message: `${stagePath} exceeds the configured maximum number of facet branches.`
        });
      }
      return {
        $facet: Object.fromEntries(
          Object.entries(stageValue).map(([facetName, facetPipeline]) => {
            if (!Array.isArray(facetPipeline)) {
              throw new MongoDataApiError({
                code: 'mongo_data_invalid_pipeline',
                status: 400,
                message: `${stagePath}.${facetName} must be an array of pipeline stages.`
              });
            }
            return [
              facetName,
              normalizeMongoDataPipeline(facetPipeline, {
                kind,
                tenantScope,
                limits,
                injectTenantScope: false,
                nested: true
              }).pipeline
            ];
          })
        )
      };
    }
    default:
      if (!isPlainObject(stageValue) && !Array.isArray(stageValue) && typeof stageValue !== 'number' && typeof stageValue !== 'string') {
        throw new MongoDataApiError({
          code: 'mongo_data_invalid_pipeline',
          status: 400,
          message: `${stagePath}.${stageName} must be JSON-compatible.`
        });
      }
      return { [stageName]: cloneJson(stageValue) };
  }
}

export function normalizeMongoDataPipeline(
  pipeline = [],
  {
    kind = 'aggregation',
    tenantScope,
    limits = MONGO_DATA_DEFAULT_AGGREGATION_LIMITS,
    injectTenantScope = true,
    nested = false
  } = {}
) {
  if (!Array.isArray(pipeline) || pipeline.length === 0) {
    throw new MongoDataApiError({
      code: 'mongo_data_invalid_pipeline',
      status: 400,
      message: `${kind}.pipeline must be a non-empty array.`
    });
  }

  if (pipeline.length > limits.maxStages) {
    throw new MongoDataApiError({
      code: 'mongo_data_pipeline_too_costly',
      status: 400,
      message: `${kind}.pipeline exceeds the configured maximum of ${limits.maxStages} stages.`
    });
  }

  const payloadBytes = estimateMongoPayloadBytes(pipeline);
  if (payloadBytes > limits.maxPayloadBytes) {
    throw new MongoDataApiError({
      code: 'mongo_data_pipeline_too_costly',
      status: 413,
      message: `${kind}.pipeline exceeds the configured maximum size of ${limits.maxPayloadBytes} bytes.`
    });
  }

  const state = {
    lookupStages: 0,
    stageNames: []
  };
  const normalizedPipeline = pipeline.map((stage, index) =>
    normalizePipelineStage(stage, {
      kind,
      stagePath: `${kind}.pipeline[${index}]`,
      limits,
      state,
      tenantScope
    })
  );

  let tenantMatchInjected = false;
  if (injectTenantScope && tenantScope) {
    const tenantFilter = kind === 'change_stream' ? buildChangeStreamTenantMatch(tenantScope) : buildTenantMatchFilter(tenantScope);
    if (normalizedPipeline[0]?.$match) {
      normalizedPipeline[0] = {
        $match: mergeFilters(tenantFilter, normalizedPipeline[0].$match)
      };
    } else {
      normalizedPipeline.unshift({ $match: tenantFilter });
    }
    tenantMatchInjected = true;
  }

  return {
    pipeline: normalizedPipeline,
    payloadBytes,
    summary: {
      stageCount: normalizedPipeline.length,
      stageNames: tenantMatchInjected && !nested ? ['$match', ...state.stageNames] : [...state.stageNames],
      tenantMatchInjected,
      lookupStages: state.lookupStages
    }
  };
}

function normalizeTransferLimits(limits = {}, defaults = MONGO_DATA_DEFAULT_TRANSFER_LIMITS) {
  return {
    maxDocuments: normalizePositiveInteger(limits.maxDocuments ?? defaults.maxDocuments, { fieldName: 'transfer.maxDocuments' }),
    maxPayloadBytes: normalizePositiveInteger(limits.maxPayloadBytes ?? defaults.maxPayloadBytes, { fieldName: 'transfer.maxPayloadBytes' }),
    maxExportDocuments: normalizePositiveInteger(limits.maxExportDocuments ?? defaults.maxExportDocuments, { fieldName: 'transfer.maxExportDocuments' }),
    exportConsistency: normalizeEnumValue(limits.exportConsistency ?? defaults.exportConsistency, ['snapshot', 'majority', 'best_effort'], 'transfer.exportConsistency'),
    ordered: limits.ordered ?? defaults.ordered ?? true
  };
}

function normalizeMongoImportPayload({ payload = {}, tenantScope, collectionMetadata = {} }) {
  const limits = normalizeTransferLimits(payload.limits, collectionMetadata.transferLimits);
  const format = normalizeEnumValue(payload.format ?? 'json', MONGO_DATA_EXPORT_FORMATS, 'payload.format');
  const mode = normalizeEnumValue(payload.mode ?? 'insert', MONGO_DATA_IMPORT_MODES, 'payload.mode');
  const documents = payload.documents;

  if (!Array.isArray(documents) || documents.length === 0) {
    throw new MongoDataApiError({
      code: 'mongo_data_invalid_import',
      status: 400,
      message: 'payload.documents must contain at least one document for import.'
    });
  }

  if (documents.length > limits.maxDocuments) {
    throw new MongoDataApiError({
      code: 'mongo_data_transfer_limit_exceeded',
      status: 413,
      message: `payload.documents exceeds the configured limit of ${limits.maxDocuments}.`
    });
  }

  const normalizedDocuments = documents.map((document, index) => {
    const scopedDocument = injectTenantIntoDocument(normalizeWriteDocument(document, `payload.documents[${index}]`), tenantScope);
    validateCandidateDocument({
      collectionMetadata,
      validationContext: { candidateDocument: scopedDocument, partial: false }
    });
    return scopedDocument;
  });

  if (mode !== 'insert' && normalizedDocuments.some((document) => document._id === undefined || document._id === null || document._id === '')) {
    throw new MongoDataApiError({
      code: 'mongo_data_invalid_import',
      status: 400,
      message: 'Replace and upsert imports require every document to carry a stable _id.'
    });
  }

  const payloadBytes = estimateMongoPayloadBytes(normalizedDocuments);
  if (payloadBytes > limits.maxPayloadBytes) {
    throw new MongoDataApiError({
      code: 'mongo_data_transfer_limit_exceeded',
      status: 413,
      message: `Import payload exceeds the configured limit of ${limits.maxPayloadBytes} bytes.`
    });
  }

  const operationPreview = normalizedDocuments.map((document) => {
    if (mode === 'insert') {
      return { kind: 'insertOne', document };
    }
    return {
      kind: 'replaceOne',
      filter: mergeFilters(buildTenantMatchFilter(tenantScope), { _id: document._id }),
      replacement: document,
      upsert: mode === 'upsert'
    };
  });

  const uniqueIndexConflicts = detectMongoRequestUniqueIndexConflicts({
    documents: normalizedDocuments,
    indexes: collectionMetadata.indexes ?? []
  });
  if (uniqueIndexConflicts.length > 0) {
    throw new MongoDataApiError({
      code: 'mongo_data_conflict',
      status: 409,
      message: 'import payload conflicts with declared unique indexes.',
      details: uniqueIndexConflicts.map((conflict) => `${conflict.indexName} duplicated between documents ${conflict.firstDocumentIndex} and ${conflict.conflictingDocumentIndex}.`),
      meta: { uniqueIndexConflicts }
    });
  }

  return {
    format,
    mode,
    ordered: payload.ordered ?? limits.ordered,
    documents: normalizedDocuments,
    documentCount: normalizedDocuments.length,
    payloadBytes,
    limits,
    restoreManifest: cloneJson(payload.restoreManifest),
    operationPreview
  };
}

function normalizeMongoExportPayload({ payload = {}, filter, projection, sort, page = {}, tenantScope, collectionMetadata = {} }) {
  const limits = normalizeTransferLimits(payload.limits, collectionMetadata.transferLimits);
  const format = normalizeEnumValue(payload.format ?? 'json', MONGO_DATA_EXPORT_FORMATS, 'payload.format');
  const requestedLimit = payload.limit ?? page.size ?? limits.maxExportDocuments;
  const limit = normalizePositiveInteger(requestedLimit, {
    fieldName: 'payload.limit',
    maximum: limits.maxExportDocuments
  });
  const normalizedSort = normalizeMongoDataSort(sort);
  const normalizedProjection = normalizeMongoDataProjection(projection);
  const { filter: scopedFilter } = applyTenantScopeToFilter({
    filter,
    tenantId: tenantScope.value,
    tenantFieldPath: tenantScope.fieldPath
  });

  return {
    format,
    includeRestoreManifest: payload.includeRestoreManifest !== false,
    consistency: normalizeEnumValue(payload.consistency ?? limits.exportConsistency, ['snapshot', 'majority', 'best_effort'], 'payload.consistency'),
    limit,
    query: {
      filter: scopedFilter,
      projection: normalizedProjection,
      sort: normalizedSort,
      limit
    },
    manifest: payload.includeRestoreManifest === false
      ? undefined
      : compactDefined({
          format,
          collectionName: payload.collectionName,
          exportConsistency: payload.consistency ?? limits.exportConsistency,
          restoreMode: 'mongo_json_documents'
        })
  };
}

function normalizeTransactionLimits(limits = {}, defaults = MONGO_DATA_DEFAULT_TRANSACTION_LIMITS) {
  return {
    maxOperations: normalizePositiveInteger(limits.maxOperations ?? defaults.maxOperations, { fieldName: 'transaction.maxOperations' }),
    maxPayloadBytes: normalizePositiveInteger(limits.maxPayloadBytes ?? defaults.maxPayloadBytes, { fieldName: 'transaction.maxPayloadBytes' }),
    maxCommitTimeMs: normalizePositiveInteger(limits.maxCommitTimeMs ?? defaults.maxCommitTimeMs, { fieldName: 'transaction.maxCommitTimeMs' }),
    readConcern: normalizeEnumValue(limits.readConcern ?? defaults.readConcern, ['local', 'majority', 'snapshot'], 'transaction.readConcern'),
    writeConcern: normalizeEnumValue(limits.writeConcern ?? defaults.writeConcern, ['majority', 'journaled', 'w1'], 'transaction.writeConcern')
  };
}

function resolveCollectionMetadataForTransaction(collectionName, collectionMetadataByName = {}, operation = {}) {
  if (operation.collectionMetadata) {
    return operation.collectionMetadata;
  }

  if (collectionMetadataByName instanceof Map) {
    return collectionMetadataByName.get(collectionName) ?? {};
  }

  return collectionMetadataByName?.[collectionName] ?? {};
}

function normalizeTransactionOperation({ operation, tenantScope, collectionMetadataByName, transactionIndex }) {
  const kind = normalizeEnumValue(operation.kind ?? operation.action, MONGO_DATA_TRANSACTION_ACTIONS, `payload.operations[${transactionIndex}].kind`);
  const collectionName = normalizeScopedName(operation.collectionName, `payload.operations[${transactionIndex}].collectionName`);
  const collectionMetadata = resolveCollectionMetadataForTransaction(collectionName, collectionMetadataByName, operation);
  const target = {
    collectionName,
    documentId: operation.documentId ? normalizeNonEmptyString(operation.documentId, `payload.operations[${transactionIndex}].documentId`) : undefined
  };

  switch (kind) {
    case 'insert': {
      const document = injectTenantIntoDocument(normalizeWriteDocument(operation.document, `payload.operations[${transactionIndex}].document`), tenantScope);
      validateCandidateDocument({ collectionMetadata, validationContext: { candidateDocument: document, partial: false } });
      return { kind, target, document, collectionMetadata };
    }
    case 'replace': {
      const replacement = injectTenantIntoDocument(normalizeWriteDocument(operation.replacement, `payload.operations[${transactionIndex}].replacement`), tenantScope);
      validateCandidateDocument({ collectionMetadata, validationContext: { candidateDocument: replacement, partial: false } });
      return {
        kind,
        target,
        filter: mergeFilters(
          applyTenantScopeToFilter({ filter: operation.filter, tenantId: tenantScope.value, tenantFieldPath: tenantScope.fieldPath }).filter,
          operation.documentId ? { _id: target.documentId } : {}
        ),
        replacement,
        upsert: operation.upsert === true,
        collectionMetadata
      };
    }
    case 'update': {
      const filter = mergeFilters(
        applyTenantScopeToFilter({ filter: operation.filter, tenantId: tenantScope.value, tenantFieldPath: tenantScope.fieldPath }).filter,
        operation.documentId ? { _id: target.documentId } : {}
      );
      const update = normalizeMongoDataUpdateDocument(operation.update);
      const existingDocument = operation.existingDocument ? normalizeWriteDocument(operation.existingDocument, `payload.operations[${transactionIndex}].existingDocument`) : undefined;
      const candidateDocument = existingDocument ? injectTenantIntoDocument(applyMongoDataUpdateDocument(existingDocument, update), tenantScope) : undefined;
      validateCandidateDocument({
        collectionMetadata,
        validationContext: candidateDocument ? { candidateDocument, partial: false } : { partial: true }
      });
      return {
        kind,
        target,
        filter,
        update,
        upsert: operation.upsert === true,
        collectionMetadata
      };
    }
    case 'delete': {
      return {
        kind,
        target,
        filter: mergeFilters(
          applyTenantScopeToFilter({ filter: operation.filter, tenantId: tenantScope.value, tenantFieldPath: tenantScope.fieldPath }).filter,
          operation.documentId ? { _id: target.documentId } : {}
        ),
        collectionMetadata
      };
    }
    default:
      throw new MongoDataApiError({
        code: 'mongo_data_invalid_transaction',
        status: 400,
        message: `Unsupported transaction operation ${kind}.`
      });
  }
}

function normalizeMongoTransactionPayload({ payload = {}, tenantScope, collectionMetadataByName = {} }) {
  const limits = normalizeTransactionLimits(payload.options, payload.limits);
  const operations = payload.operations;
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new MongoDataApiError({
      code: 'mongo_data_invalid_transaction',
      status: 400,
      message: 'payload.operations must contain at least one transactional operation.'
    });
  }

  if (operations.length > limits.maxOperations) {
    throw new MongoDataApiError({
      code: 'mongo_data_transfer_limit_exceeded',
      status: 413,
      message: `payload.operations exceeds the configured transaction limit of ${limits.maxOperations}.`
    });
  }

  const normalizedOperations = operations.map((operation, transactionIndex) =>
    normalizeTransactionOperation({
      operation,
      tenantScope,
      collectionMetadataByName,
      transactionIndex
    })
  );

  const payloadBytes = estimateMongoPayloadBytes(normalizedOperations);
  if (payloadBytes > limits.maxPayloadBytes) {
    throw new MongoDataApiError({
      code: 'mongo_data_transfer_limit_exceeded',
      status: 413,
      message: `Transaction payload exceeds the configured limit of ${limits.maxPayloadBytes} bytes.`
    });
  }

  const documentsByCollection = new Map();
  normalizedOperations.forEach((operation) => {
    const previewDocument = operation.document ?? operation.replacement;
    if (!previewDocument) {
      return;
    }
    const current = documentsByCollection.get(operation.target.collectionName) ?? [];
    current.push(previewDocument);
    documentsByCollection.set(operation.target.collectionName, current);
  });

  for (const [collectionName, documents] of documentsByCollection.entries()) {
    const collectionMetadata = resolveCollectionMetadataForTransaction(collectionName, collectionMetadataByName);
    const uniqueIndexConflicts = detectMongoRequestUniqueIndexConflicts({
      documents,
      indexes: collectionMetadata.indexes ?? []
    });
    if (uniqueIndexConflicts.length > 0) {
      throw new MongoDataApiError({
        code: 'mongo_data_conflict',
        status: 409,
        message: `Transaction payload conflicts with declared unique indexes for ${collectionName}.`,
        details: uniqueIndexConflicts.map((conflict) => `${collectionName}.${conflict.indexName} duplicated between operations ${conflict.firstDocumentIndex} and ${conflict.conflictingDocumentIndex}.`),
        meta: { collectionName, uniqueIndexConflicts }
      });
    }
  }

  return {
    options: limits,
    operations: normalizedOperations,
    operationCount: normalizedOperations.length,
    payloadBytes,
    collections: [...new Set(normalizedOperations.map((operation) => operation.target.collectionName))]
  };
}

function normalizeMongoChangeStreamPayload({
  payload = {},
  tenantScope,
  workspaceId,
  databaseName,
  collectionName,
  bridge = {}
}) {
  const limits = {
    ...MONGO_DATA_DEFAULT_CHANGE_STREAM_LIMITS,
    ...cloneJson(payload.limits ?? {})
  };
  const pipelineNormalization = normalizeMongoDataPipeline(payload.pipeline ?? [{ $project: { fullDocument: 1, operationType: 1 } }], {
    kind: 'change_stream',
    tenantScope,
    limits: {
      ...MONGO_DATA_DEFAULT_CHANGE_STREAM_LIMITS,
      maxStages: normalizePositiveInteger(limits.maxStages ?? MONGO_DATA_DEFAULT_CHANGE_STREAM_LIMITS.maxStages, { fieldName: 'change_stream.maxStages' }),
      maxPayloadBytes: normalizePositiveInteger(limits.maxPayloadBytes ?? MONGO_DATA_DEFAULT_CHANGE_STREAM_LIMITS.maxPayloadBytes, { fieldName: 'change_stream.maxPayloadBytes' }),
      maxLookupStages: 0,
      maxFacetBranches: 1,
      maxResultWindow: 100,
      maxSkip: 0,
      maxSortKeys: 4
    }
  });
  const transport = normalizeEnumValue(payload.transport ?? bridge.transport ?? MONGO_DATA_DEFAULT_CHANGE_STREAM_LIMITS.transport, ['event_gateway'], 'payload.transport');
  const replayWindowSeconds = normalizePositiveInteger(
    payload.replayWindowSeconds ?? MONGO_DATA_DEFAULT_CHANGE_STREAM_LIMITS.replayWindowSeconds,
    { fieldName: 'payload.replayWindowSeconds', maximum: 86400 }
  );
  const fullDocument = normalizeEnumValue(
    payload.fullDocument ?? MONGO_DATA_DEFAULT_CHANGE_STREAM_LIMITS.fullDocument,
    ['default', 'whenAvailable', 'required', 'updateLookup'],
    'payload.fullDocument'
  );
  const fullDocumentBeforeChange = payload.fullDocumentBeforeChange
    ? normalizeEnumValue(payload.fullDocumentBeforeChange, ['off', 'whenAvailable', 'required'], 'payload.fullDocumentBeforeChange')
    : undefined;

  const topicRef = `mongo.change-stream.${workspaceId}.${databaseName}.${collectionName}.${tenantScope.value}`;
  return {
    transport,
    replayWindowSeconds,
    fullDocument,
    fullDocumentBeforeChange,
    resumeAfter: cloneJson(payload.resumeAfter),
    startAtOperationTime: payload.startAtOperationTime,
    pipeline: pipelineNormalization.pipeline,
    summary: {
      ...pipelineNormalization.summary,
      replayWindowSeconds,
      fullDocument
    },
    bridge: {
      provider: bridge.provider ?? 'event_gateway',
      available: bridge.available ?? false,
      status: bridge.available === true ? 'ready' : 'unavailable',
      transport,
      topicRef,
      channel: topicRef
    }
  };
}

function buildBasePlan({
  operation,
  workspaceId,
  databaseName,
  collectionName,
  documentId,
  tenantScope,
  trace,
  compatibility
}) {
  return {
    adapterId: mongodbDataAdapterPort?.id ?? 'mongodb',
    capability: MONGO_DATA_API_CAPABILITIES[operation],
    operation,
    target: {
      workspaceId,
      databaseName,
      collectionName,
      documentId
    },
    tenantScope,
    trace,
    compatibility
  };
}

export function summarizeMongoDataApiCapabilityMatrix({ topology = {}, bridge = {} } = {}) {
  return MONGO_DATA_API_OPERATIONS.map((operation) => {
    const compatibility = resolveMongoDataCapabilityCompatibility({ operation, topology, bridge });
    return {
      operation,
      capability: MONGO_DATA_API_CAPABILITIES[operation],
      filterable: ['list', 'bulk_write', 'aggregate', 'export', 'transaction'].includes(operation),
      idempotentMutation: ['insert', 'update', 'replace', 'delete', 'bulk_write', 'import', 'transaction', 'change_stream'].includes(operation),
      topologyDependent: ['transaction', 'change_stream'].includes(operation),
      bridgeDependent: operation === 'change_stream',
      compatibility
    };
  });
}

export function normalizeMongoDataError(error, context = {}) {
  if (error instanceof MongoDataApiError) {
    return error;
  }

  if (error?.code === 11000 || /duplicate key/i.test(error?.message ?? '')) {
    return new MongoDataApiError({
      code: 'mongo_data_conflict',
      status: 409,
      message: 'MongoDB unique index conflict.',
      details: [error.message],
      meta: context
    });
  }

  if (error?.code === 121 || /DocumentValidationFailure/i.test(error?.codeName ?? '')) {
    return new MongoDataApiError({
      code: 'mongo_data_validation_failed',
      status: 422,
      message: 'MongoDB collection validation rejected the document payload.',
      details: [error.message],
      meta: context
    });
  }

  if (/Transaction numbers are only allowed|replica set member or mongos|cannot run a transaction/i.test(error?.message ?? '')) {
    return new MongoDataApiError({
      code: 'mongo_data_capability_unavailable',
      status: 409,
      message: 'MongoDB transactions are not available for the current deployment topology.',
      details: [error.message],
      meta: context
    });
  }

  if (/change streams are not supported|The \$changeStream stage is only supported/i.test(error?.message ?? '')) {
    return new MongoDataApiError({
      code: 'mongo_data_capability_unavailable',
      status: 409,
      message: 'MongoDB change streams are not available for the current deployment topology.',
      details: [error.message],
      meta: context
    });
  }

  if (/BSONObj size|payload too large|object to insert too large/i.test(error?.message ?? '')) {
    return new MongoDataApiError({
      code: 'mongo_data_payload_too_large',
      status: 413,
      message: 'MongoDB payload exceeds the configured size limit.',
      details: [error.message],
      meta: context
    });
  }

  return new MongoDataApiError({
    code: 'mongo_data_adapter_failure',
    status: 502,
    message: error?.message ?? 'MongoDB adapter request failed.',
    details: error?.details ?? [],
    meta: context
  });
}

export function buildMongoDataApiPlan({
  operation,
  workspaceId,
  databaseName,
  collectionName,
  documentId,
  tenantId,
  tenantFieldPath = 'tenantId',
  filter,
  projection,
  sort,
  page = {},
  payload = {},
  collectionMetadata = {},
  collectionMetadataByName = {},
  effectiveRoleName,
  correlationId,
  originSurface,
  actorId,
  requestedAt,
  idempotencyKey,
  topology = {},
  bridge = {}
}) {
  if (!MONGO_DATA_API_OPERATIONS.includes(operation)) {
    throw new MongoDataApiError({
      code: 'mongo_data_invalid_operation',
      status: 400,
      message: `Unsupported Mongo Data API operation ${operation}.`
    });
  }

  const normalizedWorkspaceId = normalizeNonEmptyString(workspaceId, 'workspaceId');
  const normalizedDatabaseName = normalizeScopedName(databaseName, 'databaseName');
  const normalizedCollectionName = collectionName ? normalizeScopedName(collectionName, 'collectionName') : undefined;
  const normalizedSort = normalizeMongoDataSort(sort);
  const normalizedProjection = normalizeMongoDataProjection(projection);
  const cursor = parseMongoDataCursor(page.after);
  const pageSize = normalizePageSize(page.size);
  const { tenantScope, filter: scopedFilter } = applyTenantScopeToFilter({ filter, tenantId, tenantFieldPath });
  const cursorPredicate = buildMongoCursorPredicate(normalizedSort, cursor);
  const queryFilter = cursorPredicate ? mergeFilters(scopedFilter, cursorPredicate) : scopedFilter;
  const compatibility = resolveMongoDataCapabilityCompatibility({ operation, topology, bridge });
  const trace = compactDefined({
    correlationId,
    originSurface,
    actorId,
    requestedAt,
    idempotencyKey,
    effectiveRoleName,
    contractVersion: mongoDataRequestContract?.version
  });

  const basePlan = buildBasePlan({
    operation,
    workspaceId: normalizedWorkspaceId,
    databaseName: normalizedDatabaseName,
    collectionName: normalizedCollectionName,
    documentId: documentId ? normalizeNonEmptyString(documentId, 'documentId') : undefined,
    tenantScope,
    trace,
    compatibility
  });

  if (operation === 'list') {
    return {
      ...basePlan,
      query: compactDefined({
        filter: queryFilter,
        projection: normalizedProjection,
        sort: normalizedSort,
        limit: pageSize,
        after: cursor,
        cursorPredicate
      })
    };
  }

  if (operation === 'get' || operation === 'delete') {
    const documentFilter = mergeFilters(queryFilter, { _id: normalizeNonEmptyString(documentId, 'documentId') });
    return {
      ...basePlan,
      query: compactDefined({
        filter: documentFilter,
        projection: operation === 'get' ? normalizedProjection : undefined,
        sort: normalizedSort,
        limit: 1
      })
    };
  }

  if (operation === 'insert') {
    const document = injectTenantIntoDocument(normalizeWriteDocument(payload.document, 'payload.document'), tenantScope);
    const validation = validateCandidateDocument({
      collectionMetadata,
      validationContext: { candidateDocument: document, partial: false }
    });

    return {
      ...basePlan,
      write: {
        document,
        validation
      }
    };
  }

  if (operation === 'replace') {
    const replacement = injectTenantIntoDocument(normalizeWriteDocument(payload.document ?? payload.replacement, 'payload.replacement'), tenantScope);
    const validation = validateCandidateDocument({
      collectionMetadata,
      validationContext: { candidateDocument: replacement, partial: false }
    });

    return {
      ...basePlan,
      query: {
        filter: mergeFilters(queryFilter, { _id: normalizeNonEmptyString(documentId, 'documentId') }),
        limit: 1
      },
      write: {
        replacement,
        validation,
        upsert: payload.upsert === true
      }
    };
  }

  if (operation === 'update') {
    const update = normalizeMongoDataUpdateDocument(payload.update);
    const existingDocument = payload.existingDocument ? normalizeWriteDocument(payload.existingDocument, 'payload.existingDocument') : undefined;
    const candidateDocument = existingDocument ? injectTenantIntoDocument(applyMongoDataUpdateDocument(existingDocument, update), tenantScope) : undefined;
    const validation = validateCandidateDocument({
      collectionMetadata,
      validationContext: candidateDocument ? { candidateDocument, partial: false } : { partial: true }
    });

    return {
      ...basePlan,
      query: {
        filter: mergeFilters(queryFilter, { _id: normalizeNonEmptyString(documentId, 'documentId') }),
        limit: 1
      },
      write: {
        update,
        validation,
        upsert: payload.upsert === true
      }
    };
  }

  if (operation === 'bulk_write') {
    const limits = normalizeBulkLimits(payload.limits, collectionMetadata.bulkLimits);
    const operations = (payload.operations ?? []).map((entry, index) => normalizeBulkOperation({
      operation: entry,
      tenantScope,
      collectionMetadata,
      existingDocumentMap: payload.existingDocumentMap instanceof Map ? payload.existingDocumentMap : new Map()
    }, index));

    if (operations.length === 0) {
      throw new MongoDataApiError({
        code: 'mongo_data_invalid_bulk_operation',
        status: 400,
        message: 'bulk.operations must contain at least one operation.'
      });
    }

    if (operations.length > limits.maxOperations) {
      throw new MongoDataApiError({
        code: 'mongo_data_bulk_limit_exceeded',
        status: 413,
        message: `bulk.operations exceeds the configured limit of ${limits.maxOperations}.`,
        meta: { operationCount: operations.length, maxOperations: limits.maxOperations }
      });
    }

    const payloadBytes = estimateMongoPayloadBytes({ operations, ordered: limits.ordered });
    if (payloadBytes > limits.maxPayloadBytes) {
      throw new MongoDataApiError({
        code: 'mongo_data_bulk_payload_too_large',
        status: 413,
        message: `bulk payload exceeds the configured limit of ${limits.maxPayloadBytes} bytes.`,
        meta: { payloadBytes, maxPayloadBytes: limits.maxPayloadBytes }
      });
    }

    operations.forEach((entry) => validateCandidateDocument({ collectionMetadata, validationContext: entry.validationContext }));

    const requestDocuments = operations.flatMap((entry) => [entry.document, entry.replacement].filter(Boolean));
    const uniqueIndexConflicts = detectMongoRequestUniqueIndexConflicts({
      documents: requestDocuments,
      indexes: collectionMetadata.indexes ?? []
    });
    if (uniqueIndexConflicts.length > 0) {
      throw new MongoDataApiError({
        code: 'mongo_data_conflict',
        status: 409,
        message: 'bulk payload conflicts with declared unique indexes.',
        details: uniqueIndexConflicts.map((conflict) => `${conflict.indexName} duplicated between operations ${conflict.firstDocumentIndex} and ${conflict.conflictingDocumentIndex}.`),
        meta: { uniqueIndexConflicts }
      });
    }

    return {
      ...basePlan,
      bulk: {
        ordered: limits.ordered,
        limits,
        operationCount: operations.length,
        payloadBytes,
        operations
      }
    };
  }

  if (operation === 'aggregate') {
    const limits = normalizeAggregationLimits(payload.limits, collectionMetadata.aggregationLimits);
    const pipelineNormalization = normalizeMongoDataPipeline(payload.pipeline, {
      kind: 'aggregation',
      tenantScope,
      limits,
      injectTenantScope: true
    });

    return {
      ...basePlan,
      aggregation: {
        pipeline: pipelineNormalization.pipeline,
        summary: {
          ...pipelineNormalization.summary,
          maxTimeMs: normalizePositiveInteger(payload.maxTimeMs ?? limits.maxTimeMs, {
            fieldName: 'payload.maxTimeMs',
            maximum: limits.maxTimeMs
          }),
          allowDiskUse: payload.allowDiskUse ?? limits.allowDiskUse
        },
        query: {
          projection: normalizedProjection,
          sort: normalizedSort,
          page: compactDefined({ size: pageSize, after: cursor })
        }
      }
    };
  }

  if (operation === 'import') {
    const transfer = normalizeMongoImportPayload({ payload, tenantScope, collectionMetadata });
    return {
      ...basePlan,
      transfer: {
        direction: 'import',
        ...transfer
      }
    };
  }

  if (operation === 'export') {
    const transfer = normalizeMongoExportPayload({
      payload,
      filter,
      projection,
      sort,
      page,
      tenantScope,
      collectionMetadata
    });
    return {
      ...basePlan,
      transfer: {
        direction: 'export',
        ...transfer
      }
    };
  }

  if (operation === 'transaction') {
    assertCapabilityCompatibility(compatibility);
    const transaction = normalizeMongoTransactionPayload({
      payload,
      tenantScope,
      collectionMetadataByName
    });
    return {
      ...basePlan,
      transaction
    };
  }

  if (operation === 'change_stream') {
    assertCapabilityCompatibility(compatibility);
    if (!normalizedCollectionName) {
      throw new MongoDataApiError({
        code: 'mongo_data_invalid_identifier',
        status: 400,
        message: 'collectionName is required for change_stream operations.'
      });
    }
    const normalizedBridge = normalizeBridgeProfile(bridge);
    return {
      ...basePlan,
      changeStream: normalizeMongoChangeStreamPayload({
        payload,
        tenantScope,
        workspaceId: normalizedWorkspaceId,
        databaseName: normalizedDatabaseName,
        collectionName: normalizedCollectionName,
        bridge: normalizedBridge
      })
    };
  }

  throw new MongoDataApiError({
    code: 'mongo_data_invalid_operation',
    status: 400,
    message: `Unsupported Mongo Data API operation ${operation}.`
  });
}
