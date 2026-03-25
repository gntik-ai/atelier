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

export const mongodbDataAdapterPort = getAdapterPort('mongodb');
export const mongoDataRequestContract = getContract('mongo_data_request');
export const mongoDataResultContract = getContract('mongo_data_result');

export const MONGO_DATA_API_OPERATIONS = Object.freeze(['list', 'get', 'insert', 'update', 'replace', 'delete', 'bulk_write']);
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
export const MONGO_DATA_DEFAULT_PAGE_SIZE = 25;
export const MONGO_DATA_MAX_PAGE_SIZE = 100;
export const MONGO_DATA_DEFAULT_BULK_LIMITS = Object.freeze({
  maxOperations: 100,
  maxPayloadBytes: 262144,
  ordered: true
});
export const MONGO_DATA_API_CAPABILITIES = Object.freeze({
  list: 'mongo_data_query',
  get: 'mongo_data_query',
  insert: 'mongo_data_insert',
  update: 'mongo_data_update',
  replace: 'mongo_data_replace',
  delete: 'mongo_data_delete',
  bulk_write: 'mongo_data_bulk_write'
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

function pathSegments(path) {
  return normalizeFieldPath(path).split('.');
}

function setPathValue(target, path, value) {
  const segments = pathSegments(path);
  let cursor = target;
  while (segments.length > 1) {
    const segment = segments.shift();
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
    return Object.fromEntries(entries.map(([key, value]) => [normalizeFieldPath(key, `filter.${fieldPath}.${key}`), normalizeFilterScalar(value, `${fieldPath}.${key}`)]));
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

export function summarizeMongoDataApiCapabilityMatrix() {
  return MONGO_DATA_API_OPERATIONS.map((operation) => ({
    operation,
    capability: MONGO_DATA_API_CAPABILITIES[operation],
    filterable: operation === 'list' || operation === 'bulk_write',
    idempotentMutation: ['insert', 'update', 'replace', 'delete', 'bulk_write'].includes(operation)
  }));
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
  effectiveRoleName,
  correlationId,
  originSurface,
  actorId,
  requestedAt,
  idempotencyKey
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
  const normalizedCollectionName = normalizeScopedName(collectionName, 'collectionName');
  const normalizedSort = normalizeMongoDataSort(sort);
  const normalizedProjection = normalizeMongoDataProjection(projection);
  const cursor = parseMongoDataCursor(page.after);
  const pageSize = normalizePageSize(page.size);
  const { tenantScope, filter: scopedFilter } = applyTenantScopeToFilter({ filter, tenantId, tenantFieldPath });
  const cursorPredicate = buildMongoCursorPredicate(normalizedSort, cursor);
  const queryFilter = cursorPredicate ? mergeFilters(scopedFilter, cursorPredicate) : scopedFilter;
  const trace = compactDefined({
    correlationId,
    originSurface,
    actorId,
    requestedAt,
    idempotencyKey,
    effectiveRoleName,
    contractVersion: mongoDataRequestContract?.version
  });

  const basePlan = {
    adapterId: mongodbDataAdapterPort?.id ?? 'mongodb',
    capability: MONGO_DATA_API_CAPABILITIES[operation],
    operation,
    target: {
      workspaceId: normalizedWorkspaceId,
      databaseName: normalizedDatabaseName,
      collectionName: normalizedCollectionName,
      documentId: documentId ? normalizeNonEmptyString(documentId, 'documentId') : undefined
    },
    tenantScope,
    trace
  };

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

  throw new MongoDataApiError({
    code: 'mongo_data_invalid_operation',
    status: 400,
    message: `Unsupported Mongo Data API operation ${operation}.`
  });
}
