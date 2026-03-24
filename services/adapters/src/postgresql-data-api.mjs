import { evaluatePostgresDataApiAccess } from './postgresql-governance-admin.mjs';

const IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,62}$/;
const SLUG_PATTERN = /^[a-z][a-z0-9_-]{0,62}$/;
const ORDER_DIRECTION_SET = new Set(['asc', 'desc']);
const MUTATION_OPERATIONS = new Set(['insert', 'update', 'delete', 'bulk_insert', 'bulk_update', 'bulk_delete', 'import']);

export const POSTGRES_DATA_API_OPERATIONS = Object.freeze([
  'list',
  'get',
  'insert',
  'update',
  'delete',
  'rpc',
  'bulk_insert',
  'bulk_update',
  'bulk_delete',
  'import',
  'export',
  'saved_query_execute',
  'stable_endpoint_invoke'
]);
export const POSTGRES_DATA_API_COMMANDS = Object.freeze(['select', 'insert', 'update', 'delete', 'execute']);
export const POSTGRES_DATA_COUNT_MODES = Object.freeze(['none', 'exact', 'estimated']);
export const POSTGRES_DATA_PAGINATION_METADATA_MODES = Object.freeze(['basic', 'full']);
export const POSTGRES_DATA_FILTER_OPERATORS = Object.freeze([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'like',
  'ilike',
  'between',
  'is',
  'json_contains',
  'json_path_eq'
]);
export const POSTGRES_DATA_RELATION_TYPES = Object.freeze(['one_to_one', 'many_to_one', 'one_to_many']);
export const POSTGRES_DATA_API_CAPABILITIES = Object.freeze({
  list: 'postgres_data_select',
  get: 'postgres_data_select',
  insert: 'postgres_data_insert',
  update: 'postgres_data_update',
  delete: 'postgres_data_delete',
  rpc: 'postgres_data_rpc',
  bulk_insert: 'postgres_data_bulk_insert',
  bulk_update: 'postgres_data_bulk_update',
  bulk_delete: 'postgres_data_bulk_delete',
  import: 'postgres_data_import',
  export: 'postgres_data_export',
  saved_query_execute: 'postgres_data_saved_query_execute',
  stable_endpoint_invoke: 'postgres_data_stable_endpoint_invoke'
});

export const POSTGRES_DATA_MANAGEMENT_CAPABILITIES = Object.freeze({
  scoped_credential: 'postgres_data_scoped_credential',
  saved_query: 'postgres_data_saved_query',
  stable_endpoint: 'postgres_data_stable_endpoint'
});

export const POSTGRES_DATA_SCOPABLE_OPERATIONS = Object.freeze([
  'list',
  'get',
  'insert',
  'update',
  'delete',
  'rpc',
  'bulk_insert',
  'bulk_update',
  'bulk_delete',
  'import',
  'export',
  'saved_query_execute',
  'stable_endpoint_invoke'
]);

function unique(list = []) {
  return [...new Set(list.filter((entry) => entry !== undefined && entry !== null && entry !== ''))];
}

function compactDefined(value = {}) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function normalizeIdentifier(value, fieldName = 'identifier') {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string.`);
  }

  const normalized = value.trim();
  if (!IDENTIFIER_PATTERN.test(normalized)) {
    throw new Error(`${fieldName} must match ${IDENTIFIER_PATTERN}. Received ${value}.`);
  }

  return normalized;
}

function normalizeSlug(value, fieldName = 'slug') {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string.`);
  }

  const normalized = value.trim().toLowerCase();
  if (!SLUG_PATTERN.test(normalized)) {
    throw new Error(`${fieldName} must match ${SLUG_PATTERN}. Received ${value}.`);
  }

  return normalized;
}

function quoteIdent(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function quoteLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function qualifiedTableName(schemaName, tableName) {
  return `${quoteIdent(schemaName)}.${quoteIdent(tableName)}`;
}

function pushValue(values, value, cast) {
  values.push(value);
  return `$${values.length}${cast ? `::${cast}` : ''}`;
}

function normalizeColumnDefinition(column = {}) {
  const columnName = normalizeIdentifier(column.columnName ?? column.name, 'columnName');
  const dataType = typeof column.dataType === 'string'
    ? { displayName: column.dataType }
    : compactDefined({ displayName: column.dataType?.displayName ?? column.dataType?.name });

  return {
    columnName,
    nullable: column.nullable !== false,
    dataType,
    json: column.json === true || /json/i.test(dataType.displayName ?? ''),
    primaryKey: column.primaryKey === true
  };
}

function normalizeTableDefinition(table = {}, defaultSchemaName, defaultTableName) {
  const schemaName = normalizeIdentifier(table.schemaName ?? defaultSchemaName, 'schemaName');
  const tableName = normalizeIdentifier(table.tableName ?? defaultTableName, 'tableName');
  const columns = (table.columns ?? []).map((column) => normalizeColumnDefinition(column));
  const columnMap = new Map(columns.map((column) => [column.columnName, column]));
  const primaryKey = unique(
    (table.primaryKey ?? columns.filter((column) => column.primaryKey).map((column) => column.columnName)).map((columnName) =>
      normalizeIdentifier(columnName, 'primaryKey column')
    )
  );

  if (columns.length === 0) {
    throw new Error(`Table ${schemaName}.${tableName} must declare at least one column.`);
  }

  if (primaryKey.length === 0) {
    throw new Error(`Table ${schemaName}.${tableName} must declare a primary key.`);
  }

  for (const columnName of primaryKey) {
    if (!columnMap.has(columnName)) {
      throw new Error(`Primary key column ${columnName} is not present in ${schemaName}.${tableName}.`);
    }
  }

  return {
    schemaName,
    tableName,
    columns,
    columnMap,
    primaryKey,
    relations: (table.relations ?? []).map((relation) => normalizeRelationDefinition(relation, schemaName, tableName))
  };
}

function normalizeRoutineArgumentDefinition(argument = {}, index = 0) {
  const argumentName = normalizeIdentifier(argument.argumentName ?? argument.name ?? `arg${index + 1}`, 'routine.argumentName');
  const dataType =
    typeof argument.dataType === 'string'
      ? argument.dataType.trim()
      : argument.dataType?.displayName ?? argument.dataType?.fullName ?? argument.dataType?.name;

  return compactDefined({
    argumentName,
    dataType: dataType && dataType.length > 0 ? dataType : undefined,
    required: argument.required !== false
  });
}

function normalizeRoutineDefinition(routine = {}, defaultSchemaName, defaultRoutineName) {
  const schemaName = normalizeIdentifier(routine.schemaName ?? defaultSchemaName, 'schemaName');
  const routineName = normalizeIdentifier(routine.routineName ?? routine.name ?? defaultRoutineName, 'routineName');
  const resultColumnName = normalizeIdentifier(routine.resultColumnName ?? 'result', 'resultColumnName');

  return {
    schemaName,
    routineName,
    signature: routine.signature,
    returnsSet: routine.returnsSet === true,
    exposedAsRpc: routine.exposedAsRpc !== false,
    resultColumnName,
    arguments: (routine.arguments ?? []).map((argument, index) => normalizeRoutineArgumentDefinition(argument, index))
  };
}

function normalizeRelationDefinition(relation = {}, sourceSchemaName, sourceTableName) {
  const relationName = normalizeIdentifier(relation.relationName ?? relation.name, 'relationName');
  const relationType = relation.relationType ?? relation.type ?? 'many_to_one';
  if (!POSTGRES_DATA_RELATION_TYPES.includes(relationType)) {
    throw new Error(`Unsupported relationType ${relationType} on ${sourceSchemaName}.${sourceTableName}.${relationName}.`);
  }

  const sourceColumn = normalizeIdentifier(relation.sourceColumn, 'relation.sourceColumn');
  const targetColumn = normalizeIdentifier(relation.targetColumn, 'relation.targetColumn');
  const targetTable = normalizeTableDefinition(
    relation.target ?? {},
    relation.targetSchemaName,
    relation.targetTableName
  );

  return {
    relationName,
    relationType,
    sourceColumn,
    targetColumn,
    exposed: relation.exposed !== false,
    target: {
      ...targetTable,
      schemaGrants: relation.target?.schemaGrants ?? relation.schemaGrants ?? [],
      objectGrants: relation.target?.objectGrants ?? relation.objectGrants ?? [],
      tableSecurity: relation.target?.tableSecurity ?? relation.tableSecurity ?? {},
      policies: relation.target?.policies ?? relation.policies ?? []
    }
  };
}

function normalizeSelect(select = [], table) {
  const requested = Array.isArray(select)
    ? select
    : typeof select === 'string'
      ? select.split(',').map((entry) => entry.trim()).filter(Boolean)
      : [];

  if (requested.length === 0) {
    return table.columns.map((column) => column.columnName);
  }

  return requested.map((columnName) => ensureColumn(table, columnName).columnName);
}

function normalizePrimaryKey(primaryKey = {}, table) {
  const normalized = compactDefined(
    Object.fromEntries(
      Object.entries(primaryKey).map(([columnName, value]) => [ensureColumn(table, columnName).columnName, value])
    )
  );

  for (const primaryKeyColumn of table.primaryKey) {
    if (!(primaryKeyColumn in normalized)) {
      throw new Error(`Missing primary key value for ${primaryKeyColumn}.`);
    }
  }

  return normalized;
}

function normalizeOrder(order = [], table) {
  const requested = Array.isArray(order)
    ? order
    : typeof order === 'string'
      ? order.split(',').map((entry) => entry.trim()).filter(Boolean).map((entry) => {
          const [columnName, rawDirection = 'asc'] = entry.split(':');
          return { columnName, direction: rawDirection };
        })
      : [];

  const normalized = requested.map((entry) => {
    const columnName = ensureColumn(table, entry.columnName ?? entry.column).columnName;
    const direction = String(entry.direction ?? 'asc').trim().toLowerCase();
    if (!ORDER_DIRECTION_SET.has(direction)) {
      throw new Error(`Unsupported order direction ${entry.direction} for ${columnName}.`);
    }

    return { columnName, direction };
  });

  for (const primaryKeyColumn of table.primaryKey) {
    if (!normalized.some((entry) => entry.columnName === primaryKeyColumn)) {
      normalized.push({ columnName: primaryKeyColumn, direction: 'asc' });
    }
  }

  return normalized;
}

function normalizeFilters(filters = [], table) {
  return (filters ?? []).map((filter) => {
    const operator = String(filter.operator ?? 'eq').trim().toLowerCase();
    if (!POSTGRES_DATA_FILTER_OPERATORS.includes(operator)) {
      throw new Error(`Unsupported filter operator ${operator}.`);
    }

    const column = ensureColumn(table, filter.columnName ?? filter.column);
    if ((operator === 'json_contains' || operator === 'json_path_eq') && column.json !== true) {
      throw new Error(`Column ${column.columnName} is not JSON-capable.`);
    }

    return {
      columnName: column.columnName,
      operator,
      value: filter.value,
      path: unique((filter.path ?? []).map((entry) => String(entry).trim()).filter(Boolean))
    };
  });
}

function normalizeJoins(joins = [], table) {
  return (joins ?? []).map((join) => {
    const relationName = normalizeIdentifier(join.relationName ?? join.relation, 'join.relationName');
    const relation = table.relations.find((entry) => entry.relationName === relationName);

    if (!relation || relation.exposed !== true) {
      throw new Error(`Relation ${relationName} is not exposed on ${table.schemaName}.${table.tableName}.`);
    }

    return {
      relationName,
      relationType: relation.relationType,
      select: normalizeSelect(join.select, relation.target),
      relation
    };
  });
}

function ensureColumn(table, columnName) {
  const normalized = normalizeIdentifier(columnName, 'columnName');
  const column = table.columnMap.get(normalized);
  if (!column) {
    throw new Error(`Unknown column ${normalized} on ${table.schemaName}.${table.tableName}.`);
  }

  return column;
}

function commandForOperation(operation) {
  if (['list', 'get', 'export', 'saved_query_execute', 'stable_endpoint_invoke'].includes(operation)) return 'select';
  if (operation === 'rpc') return 'execute';
  if (operation === 'bulk_insert' || operation === 'import') return 'insert';
  if (operation === 'bulk_update') return 'update';
  if (operation === 'bulk_delete') return 'delete';
  return operation;
}

function privilegeSatisfies(command, privileges = []) {
  const normalized = new Set((privileges ?? []).map((entry) => String(entry).trim().toLowerCase()));
  if (command === 'select') return normalized.has('select');
  if (command === 'insert') return normalized.has('insert');
  if (command === 'update') return normalized.has('update');
  if (command === 'delete') return normalized.has('delete');
  return false;
}

function hasSchemaUsageGrant(schemaGrants = [], actorRoleName, schemaName) {
  return schemaGrants.some(
    (grant) =>
      grant?.granteeRoleName === actorRoleName &&
      grant?.target?.schemaName === schemaName &&
      new Set((grant?.privileges ?? ['usage']).map((entry) => String(entry).trim().toLowerCase())).has('usage')
  );
}

function hasRoutineExecuteGrant(objectGrants = [], actorRoleName, schemaName, routine = {}) {
  const candidateNames = new Set(
    [routine.routineName, routine.signature, `${routine.schemaName}.${routine.routineName}`, `${routine.routineName}()`].filter(Boolean)
  );

  return objectGrants.some(
    (grant) =>
      grant?.granteeRoleName === actorRoleName &&
      grant?.target?.schemaName === schemaName &&
      candidateNames.has(grant?.target?.objectName) &&
      new Set((grant?.privileges ?? []).map((entry) => String(entry).trim().toLowerCase())).has('execute')
  );
}

function normalizeRpcArguments(argumentPayload, routine) {
  const definitions = routine.arguments ?? [];

  if (Array.isArray(argumentPayload)) {
    if (definitions.length > 0 && argumentPayload.length < definitions.filter((argument) => argument.required !== false).length) {
      throw new Error(`Routine ${routine.schemaName}.${routine.routineName} is missing one or more required arguments.`);
    }

    return argumentPayload.map((value, index) => ({
      argumentName: definitions[index]?.argumentName ?? `arg${index + 1}`,
      dataType: definitions[index]?.dataType,
      value
    }));
  }

  if (argumentPayload === undefined || argumentPayload === null) {
    if (definitions.some((argument) => argument.required !== false)) {
      throw new Error(`Routine ${routine.schemaName}.${routine.routineName} requires arguments.`);
    }

    return [];
  }

  if (typeof argumentPayload !== 'object') {
    throw new Error('RPC arguments must be an object or array.');
  }

  const orderedDefinitions = definitions.length > 0
    ? definitions
    : Object.keys(argumentPayload)
        .sort()
        .map((argumentName) => ({ argumentName }));

  const bindings = []
  for (const definition of orderedDefinitions) {
    if (!(definition.argumentName in argumentPayload)) {
      if (definition.required === false) continue;
      throw new Error(`Routine ${routine.schemaName}.${routine.routineName} is missing required argument ${definition.argumentName}.`);
    }

    bindings.push({
      argumentName: definition.argumentName,
      dataType: definition.dataType,
      value: argumentPayload[definition.argumentName]
    });
  }

  return bindings;
}

function resolveRpcEffectiveRole({ candidateRoles, schemaGrants, objectGrants, routine }) {
  const errors = [];

  for (const actorRoleName of candidateRoles) {
    if (!hasSchemaUsageGrant(schemaGrants, actorRoleName, routine.schemaName)) {
      errors.push(`${actorRoleName}:missing_schema_grant`);
      continue;
    }

    if (!hasRoutineExecuteGrant(objectGrants, actorRoleName, routine.schemaName, routine)) {
      errors.push(`${actorRoleName}:missing_execute_grant`);
      continue;
    }

    return {
      effectiveRoleName: actorRoleName,
      accessDecision: {
        allowed: true,
        visible: true,
        reason: 'grant_allow',
        rowPredicateRequired: false
      }
    };
  }

  throw new Error(`No effective role satisfies the PostgreSQL RPC request (${errors.join(', ')}).`);
}

function policyAppliesToActor(policy = {}, actorRoleName, command) {
  const appliesToCommand = policy.appliesTo?.command ?? 'all';
  if (appliesToCommand !== 'all' && appliesToCommand !== command) {
    return false;
  }

  const roles = policy.appliesTo?.roles ?? ['public'];
  return roles.includes('public') || roles.includes(actorRoleName);
}

function collectApplicablePolicies(policies = [], actorRoleName, command) {
  return policies.filter((policy) => policyAppliesToActor(policy, actorRoleName, command));
}

function evaluatePlanningAccess({
  actorRoleName,
  command,
  schemaGrants = [],
  objectGrants = [],
  tableSecurity = {},
  policies = [],
  sessionContext = {},
  row,
  resource
}) {
  if (row !== undefined) {
    return evaluatePostgresDataApiAccess({
      actorRoleName,
      command,
      schemaGrants,
      objectGrants,
      tableSecurity,
      policies,
      sessionContext,
      row,
      resource
    });
  }

  const schemaGrant = schemaGrants.find(
    (grant) =>
      grant?.granteeRoleName === actorRoleName &&
      grant?.target?.schemaName === resource.schemaName &&
      new Set((grant?.privileges ?? ['usage']).map((entry) => String(entry).trim().toLowerCase())).has('usage')
  );
  const objectGrant = objectGrants.find(
    (grant) =>
      grant?.granteeRoleName === actorRoleName &&
      grant?.target?.schemaName === resource.schemaName &&
      grant?.target?.objectName === resource.tableName &&
      privilegeSatisfies(command, grant.privileges)
  );

  if (!schemaGrant || !objectGrant) {
    return {
      allowed: false,
      visible: false,
      reason: 'missing_grant',
      applicablePolicies: []
    };
  }

  if (tableSecurity?.rlsEnabled === false) {
    return {
      allowed: true,
      visible: true,
      reason: 'grant_only',
      applicablePolicies: []
    };
  }

  const applicablePolicies = collectApplicablePolicies(policies, actorRoleName, command);
  if (applicablePolicies.length === 0) {
    return {
      allowed: false,
      visible: false,
      reason: 'no_applicable_rls_policy',
      applicablePolicies
    };
  }

  if (applicablePolicies.some((policy) => (policy.runtimePredicate ?? policy.matcher ?? {}).kind === 'allow_all')) {
    return {
      allowed: true,
      visible: true,
      reason: 'grant_and_rls_allow',
      applicablePolicies
    };
  }

  const missingSessionValue = applicablePolicies.every((policy) => {
    const matcher = policy.runtimePredicate ?? policy.matcher ?? { kind: 'session_equals_row', sessionKey: 'tenantId' };
    if (matcher.kind !== 'session_equals_row') {
      return false;
    }

    return !sessionContext?.[matcher.sessionKey ?? 'tenantId'];
  });

  if (missingSessionValue) {
    return {
      allowed: false,
      visible: false,
      reason: 'missing_session_context',
      applicablePolicies
    };
  }

  return {
    allowed: true,
    visible: true,
    reason: 'grant_and_rls_filter',
    rowPredicateRequired: true,
    applicablePolicies
  };
}

function buildRlsClause({ alias, accessDecision, sessionContext, values }) {
  const policies = accessDecision?.applicablePolicies ?? [];
  if (policies.length === 0) {
    return undefined;
  }

  const allowAll = policies.some((policy) => (policy.runtimePredicate ?? policy.matcher ?? {}).kind === 'allow_all');
  if (allowAll) return undefined;

  const fragments = policies.map((policy) => {
    const matcher = policy.runtimePredicate ?? policy.matcher ?? { kind: 'session_equals_row', sessionKey: 'tenantId', columnName: 'tenantId' };

    if (matcher.kind === 'deny_all') {
      return 'FALSE';
    }

    if (matcher.kind === 'session_equals_row') {
      const placeholder = pushValue(values, sessionContext?.[matcher.sessionKey ?? 'tenantId']);
      return `${alias}.${quoteIdent(matcher.columnName ?? 'tenantId')} = ${placeholder}`;
    }

    throw new Error(`Unsupported runtime predicate kind ${matcher.kind}.`);
  });

  return fragments.length === 1 ? fragments[0] : `(${fragments.join(' OR ')})`;
}

function buildPrimaryKeyClause({ alias, primaryKey, values }) {
  return Object.entries(primaryKey).map(([columnName, value]) => {
    const placeholder = pushValue(values, value);
    return `${alias}.${quoteIdent(columnName)} = ${placeholder}`;
  });
}

function buildFilterClauses({ alias, filters, values }) {
  return filters.map((filter) => {
    const columnReference = `${alias}.${quoteIdent(filter.columnName)}`;

    switch (filter.operator) {
      case 'eq': {
        return `${columnReference} = ${pushValue(values, filter.value)}`;
      }
      case 'neq': {
        return `${columnReference} <> ${pushValue(values, filter.value)}`;
      }
      case 'gt': {
        return `${columnReference} > ${pushValue(values, filter.value)}`;
      }
      case 'gte': {
        return `${columnReference} >= ${pushValue(values, filter.value)}`;
      }
      case 'lt': {
        return `${columnReference} < ${pushValue(values, filter.value)}`;
      }
      case 'lte': {
        return `${columnReference} <= ${pushValue(values, filter.value)}`;
      }
      case 'like': {
        return `${columnReference} LIKE ${pushValue(values, filter.value)}`;
      }
      case 'ilike': {
        return `${columnReference} ILIKE ${pushValue(values, filter.value)}`;
      }
      case 'between': {
        if (!Array.isArray(filter.value) || filter.value.length !== 2) {
          throw new Error(`between filters for ${filter.columnName} must provide two boundary values.`);
        }
        const lower = pushValue(values, filter.value[0]);
        const upper = pushValue(values, filter.value[1]);
        return `${columnReference} BETWEEN ${lower} AND ${upper}`;
      }
      case 'in': {
        if (!Array.isArray(filter.value) || filter.value.length === 0) {
          throw new Error(`in filters for ${filter.columnName} must provide at least one value.`);
        }
        const placeholders = filter.value.map((entry) => pushValue(values, entry));
        return `${columnReference} IN (${placeholders.join(', ')})`;
      }
      case 'is': {
        if (filter.value === null || filter.value === 'null') {
          return `${columnReference} IS NULL`;
        }
        if (filter.value === 'not_null') {
          return `${columnReference} IS NOT NULL`;
        }
        throw new Error(`is filters for ${filter.columnName} must use null or not_null.`);
      }
      case 'json_contains': {
        return `${columnReference} @> ${pushValue(values, JSON.stringify(filter.value), 'jsonb')}`;
      }
      case 'json_path_eq': {
        if ((filter.path ?? []).length === 0) {
          throw new Error(`json_path_eq filters for ${filter.columnName} must provide a path.`);
        }
        const pathPlaceholders = filter.path.map((segment) => pushValue(values, segment, 'text'));
        const valuePlaceholder = pushValue(values, String(filter.value));
        return `jsonb_extract_path_text(${columnReference}, ${pathPlaceholders.join(', ')}) = ${valuePlaceholder}`;
      }
      default:
        throw new Error(`Unsupported filter operator ${filter.operator}.`);
    }
  });
}

function buildOrderClause({ alias, order }) {
  return order.map((entry) => `${alias}.${quoteIdent(entry.columnName)} ${entry.direction.toUpperCase()}`);
}

function buildCursorPayload({ order, row }) {
  return {
    order: order.map((entry) => ({ columnName: entry.columnName, direction: entry.direction, value: row?.[entry.columnName] })),
    primaryKey: Object.fromEntries(order.filter((entry) => entry.primaryKey === true).map((entry) => [entry.columnName, row?.[entry.columnName]]))
  };
}

export function serializePostgresDataApiCursor(payload = {}) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function parsePostgresDataApiCursor(cursor) {
  if (!cursor) return undefined;
  return JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
}

function buildCursorClause({ alias, order, cursor, values }) {
  if (!cursor) return undefined;
  const decoded = typeof cursor === 'string' ? parsePostgresDataApiCursor(cursor) : cursor;
  const valueByColumn = new Map((decoded?.order ?? []).map((entry) => [entry.columnName, entry.value]));

  const buildComparator = (index) => {
    const entry = order[index];
    if (!entry) return undefined;
    const value = valueByColumn.get(entry.columnName);
    const columnReference = `${alias}.${quoteIdent(entry.columnName)}`;
    const operator = entry.direction === 'desc' ? '<' : '>';
    const greaterThan = `${columnReference} ${operator} ${pushValue(values, value)}`;

    if (index === order.length - 1) {
      return greaterThan;
    }

    const equality = `${columnReference} = ${pushValue(values, value)}`;
    const tail = buildComparator(index + 1);
    return `(${greaterThan} OR (${equality} AND ${tail}))`;
  };

  return buildComparator(0);
}

function buildJsonProjection(columns, alias) {
  const fragments = columns.flatMap((columnName) => [quoteLiteral(columnName), `${alias}.${quoteIdent(columnName)}`]);
  return `jsonb_build_object(${fragments.join(', ')})`;
}

function buildJoinFragments({ joins, sessionContext, effectiveRoleName, values }) {
  const selectExpressions = [];
  const joinClauses = [];
  const relationSummaries = [];

  for (const join of joins) {
    const relation = join.relation;
    const relationAlias = `${join.relationName}_rel`;
    const lateralAlias = `${join.relationName}_json`;
    const resource = { schemaName: relation.target.schemaName, tableName: relation.target.tableName };
    const accessDecision = evaluatePlanningAccess({
      actorRoleName: effectiveRoleName,
      command: 'select',
      schemaGrants: relation.target.schemaGrants,
      objectGrants: relation.target.objectGrants,
      tableSecurity: relation.target.tableSecurity,
      policies: relation.target.policies,
      sessionContext,
      resource
    });

    if (!accessDecision.allowed) {
      throw new Error(`Relation ${join.relationName} is not available to effective role ${effectiveRoleName}: ${accessDecision.reason}.`);
    }

    const rlsClause = buildRlsClause({ alias: relationAlias, accessDecision, sessionContext, values });
    const joinCondition = relation.relationType === 'one_to_many'
      ? `${relationAlias}.${quoteIdent(relation.targetColumn)} = base.${quoteIdent(relation.sourceColumn)}`
      : `${relationAlias}.${quoteIdent(relation.targetColumn)} = base.${quoteIdent(relation.sourceColumn)}`;
    const whereClauses = [joinCondition];
    if (rlsClause) whereClauses.push(rlsClause);
    const jsonProjection = buildJsonProjection(join.select, relationAlias);

    if (relation.relationType === 'one_to_many') {
      joinClauses.push(`LEFT JOIN LATERAL (\n  SELECT COALESCE(jsonb_agg(${jsonProjection}), '[]'::jsonb) AS data\n  FROM ${qualifiedTableName(relation.target.schemaName, relation.target.tableName)} AS ${relationAlias}\n  WHERE ${whereClauses.join(' AND ')}\n) AS ${lateralAlias} ON TRUE`);
    } else {
      joinClauses.push(`LEFT JOIN LATERAL (\n  SELECT ${jsonProjection} AS data\n  FROM ${qualifiedTableName(relation.target.schemaName, relation.target.tableName)} AS ${relationAlias}\n  WHERE ${whereClauses.join(' AND ')}\n  LIMIT 1\n) AS ${lateralAlias} ON TRUE`);
    }

    selectExpressions.push(`${lateralAlias}.data AS ${quoteIdent(join.relationName)}`);
    relationSummaries.push({
      relationName: join.relationName,
      relationType: join.relationType,
      targetSchemaName: relation.target.schemaName,
      targetTableName: relation.target.tableName,
      selection: join.select,
      rlsEnforced: relation.target.tableSecurity?.rlsEnabled !== false
    });
  }

  return { selectExpressions, joinClauses, relationSummaries };
}

function resolveEffectiveRole({
  candidateRoles,
  command,
  schemaGrants,
  objectGrants,
  tableSecurity,
  policies,
  sessionContext,
  row,
  table,
  joins
}) {
  const errors = [];

  for (const actorRoleName of candidateRoles) {
    const accessDecision = evaluatePlanningAccess({
      actorRoleName,
      command,
      schemaGrants,
      objectGrants,
      tableSecurity,
      policies,
      sessionContext,
      row,
      resource: { schemaName: table.schemaName, tableName: table.tableName }
    });

    if (!accessDecision.allowed) {
      errors.push(`${actorRoleName}:${accessDecision.reason}`);
      continue;
    }

    try {
      for (const join of joins) {
        const relation = join.relation;
        const relationDecision = evaluatePlanningAccess({
          actorRoleName,
          command: 'select',
          schemaGrants: relation.target.schemaGrants,
          objectGrants: relation.target.objectGrants,
          tableSecurity: relation.target.tableSecurity,
          policies: relation.target.policies,
          sessionContext,
          resource: { schemaName: relation.target.schemaName, tableName: relation.target.tableName }
        });

        if (!relationDecision.allowed) {
          throw new Error(`${join.relationName}:${relationDecision.reason}`);
        }
      }
    } catch (error) {
      errors.push(`${actorRoleName}:${error.message}`);
      continue;
    }

    return {
      effectiveRoleName: actorRoleName,
      accessDecision
    };
  }

  throw new Error(`No effective role satisfies the PostgreSQL data API request (${errors.join(', ')}).`);
}

function normalizeValues(values = {}, table) {
  const normalized = compactDefined(
    Object.fromEntries(
      Object.entries(values ?? {}).map(([columnName, value]) => [ensureColumn(table, columnName).columnName, value])
    )
  );

  if (Object.keys(normalized).length === 0) {
    throw new Error(`Mutation payload for ${table.schemaName}.${table.tableName} cannot be empty.`);
  }

  return normalized;
}

function buildReturningClause({ table, select }) {
  const returningColumns = unique((select?.length ?? 0) > 0 ? select : table.primaryKey);
  return {
    returningColumns,
    sql: returningColumns.map((columnName) => quoteIdent(columnName)).join(', ')
  };
}

function normalizeResponseOptions(request = {}) {
  const countMode = String(request.responseOptions?.countMode ?? request.countMode ?? 'none').trim().toLowerCase();
  if (!POSTGRES_DATA_COUNT_MODES.includes(countMode)) {
    throw new Error(`Unsupported PostgreSQL data count mode ${countMode}.`);
  }

  const paginationMode = String(request.responseOptions?.paginationMode ?? request.paginationMode ?? 'basic').trim().toLowerCase();
  if (!POSTGRES_DATA_PAGINATION_METADATA_MODES.includes(paginationMode)) {
    throw new Error(`Unsupported PostgreSQL pagination metadata mode ${paginationMode}.`);
  }

  return {
    countMode,
    paginationMode
  };
}

function normalizeTraceContext(request = {}, workspaceId) {
  return compactDefined({
    actorId: request.actorId ?? request.actor_id,
    actorType: request.actorType ?? request.actor_type ?? 'workspace_principal',
    tenantId: request.tenantId ?? request.tenant_id ?? request.sessionContext?.tenantId,
    workspaceId,
    originSurface: request.originSurface ?? request.origin_surface ?? 'public_api',
    correlationId: request.correlationId ?? request.correlation_id,
    databaseName: request.databaseName,
    requestId: request.requestId ?? request.request_id
  });
}

function buildTraceSettings(trace = {}) {
  return [
    ['app.current_actor_id', trace.actorId],
    ['app.current_actor_type', trace.actorType],
    ['app.current_tenant_id', trace.tenantId],
    ['app.current_workspace_id', trace.workspaceId],
    ['app.current_origin_surface', trace.originSurface],
    ['app.current_correlation_id', trace.correlationId],
    ['app.current_request_id', trace.requestId]
  ].map(([key, value]) => (value ? { key, value } : undefined)).filter(Boolean);
}

function normalizeBatchConfig(config = {}, observedSize = 0, defaults = {}) {
  const requestedLimit = Number(config.limit ?? config.batchLimit ?? defaults.limit ?? 100);
  const hardLimit = Number(config.hardLimit ?? defaults.hardLimit ?? 500);
  const appliedLimit = Math.max(1, Math.min(hardLimit, requestedLimit));

  if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
    throw new Error('Bulk and import operations must request a positive integer batch limit.');
  }

  if (!Number.isInteger(hardLimit) || hardLimit < 1) {
    throw new Error('Bulk and import operations must use a positive integer hard limit.');
  }

  if (observedSize > appliedLimit) {
    throw new Error(`Requested batch of ${observedSize} rows exceeds the configured limit of ${appliedLimit}.`);
  }

  return {
    requestedLimit,
    hardLimit,
    appliedLimit,
    batchSize: observedSize,
    atomic: config.atomic !== false
  };
}

function buildListLikeSql({ operation, table, baseSelectExpressions, joinFragments, baseWhereClauses, order, pageSize }) {
  const selectClause = [...baseSelectExpressions, ...joinFragments.selectExpressions].join(', ');
  const orderClause = buildOrderClause({ alias: 'base', order }).join(', ');

  return [
    `SELECT ${selectClause}`,
    `FROM ${qualifiedTableName(table.schemaName, table.tableName)} AS base`,
    ...joinFragments.joinClauses,
    baseWhereClauses.length > 0 ? `WHERE ${baseWhereClauses.join(' AND ')}` : undefined,
    `ORDER BY ${orderClause}`,
    operation === 'list' ? `LIMIT ${pageSize}` : 'LIMIT 1'
  ].filter(Boolean).join('\n');
}

function buildCountPlan({ table, baseWhereClauses, values, countMode }) {
  if (countMode === 'none') {
    return undefined;
  }

  if (countMode === 'exact') {
    return {
      mode: 'exact',
      sql: {
        text: [
          'SELECT COUNT(*) AS totalCount',
          `FROM ${qualifiedTableName(table.schemaName, table.tableName)} AS base`,
          baseWhereClauses.length > 0 ? `WHERE ${baseWhereClauses.join(' AND ')}` : undefined
        ].filter(Boolean).join('\n'),
        values: [...values]
      }
    };
  }

  const estimatedValues = [];
  const schemaPlaceholder = pushValue(estimatedValues, table.schemaName, 'text');
  const tablePlaceholder = pushValue(estimatedValues, table.tableName, 'text');

  return {
    mode: 'estimated',
    sql: {
      text: [
        'SELECT CAST(cls.reltuples AS bigint) AS estimatedCount',
        'FROM pg_catalog.pg_class AS cls',
        'JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = cls.relnamespace',
        `WHERE nsp.nspname = ${schemaPlaceholder}`,
        `  AND cls.relname = ${tablePlaceholder}`
      ].join('\n'),
      values: estimatedValues
    }
  };
}

function normalizeScopeOperation(operation) {
  const normalized = String(operation ?? '').trim().toLowerCase();
  if (!POSTGRES_DATA_SCOPABLE_OPERATIONS.includes(normalized)) {
    throw new Error(`Unsupported scoped PostgreSQL operation ${operation}.`);
  }

  return normalized;
}

function normalizeCredentialScopeDefinition(scope = {}, defaultDatabaseName) {
  const databaseName = normalizeIdentifier(scope.databaseName ?? defaultDatabaseName, 'databaseName');
  const schemaName = scope.schemaName ? normalizeIdentifier(scope.schemaName, 'schemaName') : undefined;
  const tableName = scope.tableName ? normalizeIdentifier(scope.tableName, 'tableName') : undefined;
  const routineName = scope.routineName ? normalizeIdentifier(scope.routineName, 'routineName') : undefined;

  if (tableName && !schemaName) {
    throw new Error('A scoped table credential must also declare schemaName.');
  }

  if (routineName && !schemaName) {
    throw new Error('A scoped routine credential must also declare schemaName.');
  }

  if (tableName && routineName) {
    throw new Error('A scoped PostgreSQL credential cannot target both a table and a routine in the same scope entry.');
  }

  const allowedOperations = unique((scope.allowedOperations ?? []).map((entry) => normalizeScopeOperation(entry)));
  if (allowedOperations.length === 0) {
    throw new Error('Each scoped PostgreSQL credential entry must declare at least one allowed operation.');
  }

  return compactDefined({
    databaseName,
    schemaName,
    tableName,
    routineName,
    allowedOperations,
    savedQueryIds: unique((scope.savedQueryIds ?? []).map((entry) => normalizeIdentifier(entry, 'savedQueryId'))),
    endpointIds: unique((scope.endpointIds ?? []).map((entry) => normalizeIdentifier(entry, 'endpointId')))
  });
}

function resolveTemplateValue(value, parameters = {}) {
  if (Array.isArray(value)) {
    return value.map((entry) => resolveTemplateValue(entry, parameters));
  }

  if (value && typeof value === 'object') {
    if (value.parameter) {
      if (!(value.parameter in parameters)) {
        throw new Error(`Missing saved-query parameter ${value.parameter}.`);
      }

      return parameters[value.parameter];
    }

    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, resolveTemplateValue(entry, parameters)]));
  }

  return value;
}

function normalizeSavedQueryParameters(definition = {}, overrides = {}) {
  const merged = {};

  for (const parameter of definition.parameters ?? []) {
    const parameterName = normalizeIdentifier(parameter.parameterName ?? parameter.name, 'savedQuery.parameterName');
    if (parameterName in overrides) {
      merged[parameterName] = overrides[parameterName];
      continue;
    }

    if ('defaultValue' in parameter) {
      merged[parameterName] = parameter.defaultValue;
      continue;
    }

    if (parameter.required === false) {
      continue;
    }

    throw new Error(`Missing saved-query parameter ${parameterName}.`);
  }

  for (const [parameterName, value] of Object.entries(overrides ?? {})) {
    merged[normalizeIdentifier(parameterName, 'savedQuery.parameterName')] = value;
  }

  return merged;
}

function resolveEffectiveRoleForBatch({
  candidateRoles,
  command,
  schemaGrants,
  objectGrants,
  tableSecurity,
  policies,
  sessionContext,
  rows,
  resource
}) {
  const errors = [];

  for (const actorRoleName of candidateRoles) {
    const decisions = [];
    let blocked = false;

    for (const row of rows) {
      const decision = evaluatePlanningAccess({
        actorRoleName,
        command,
        schemaGrants,
        objectGrants,
        tableSecurity,
        policies,
        sessionContext,
        row,
        resource
      });

      if (!decision.allowed) {
        errors.push(`${actorRoleName}:${decision.reason}`);
        blocked = true;
        break;
      }

      decisions.push(decision);
    }

    if (!blocked) {
      return {
        effectiveRoleName: actorRoleName,
        accessDecision: decisions.find((entry) => entry.rowPredicateRequired === true) ?? decisions[0] ?? {
          allowed: true,
          visible: true,
          reason: 'grant_only',
          rowPredicateRequired: false
        }
      };
    }
  }

  throw new Error(`No effective role satisfies the PostgreSQL data API batch request (${errors.join(', ')}).`);
}

function buildPostgresDataRpcPlan(request = {}, { workspaceId, databaseName, candidateRoles, trace } = {}) {
  const routine = normalizeRoutineDefinition(request.routine ?? {}, request.schemaName, request.routineName);
  if (!routine.exposedAsRpc) {
    throw new Error(`Routine ${routine.schemaName}.${routine.routineName} is not exposed as an RPC endpoint.`);
  }

  const argumentBindings = normalizeRpcArguments(request.arguments, routine);
  const { effectiveRoleName, accessDecision } = resolveRpcEffectiveRole({
    candidateRoles,
    schemaGrants: request.schemaGrants,
    objectGrants: request.objectGrants,
    routine
  });
  const values = [];
  const placeholders = argumentBindings.map((binding) => pushValue(values, binding.value, binding.dataType));
  const functionCall = `${quoteIdent(routine.schemaName)}.${quoteIdent(routine.routineName)}(${placeholders.join(', ')})`;
  const sql = routine.returnsSet
    ? ['SELECT *', `FROM ${functionCall}`].join('\n')
    : `SELECT ${functionCall} AS ${quoteIdent(routine.resultColumnName)}`;

  return {
    operation: 'rpc',
    command: 'execute',
    capability: POSTGRES_DATA_API_CAPABILITIES.rpc,
    effectiveRoleName,
    resource: {
      workspaceId,
      databaseName,
      schemaName: routine.schemaName,
      routineName: routine.routineName
    },
    routine: {
      schemaName: routine.schemaName,
      routineName: routine.routineName,
      returnsSet: routine.returnsSet,
      argumentCount: argumentBindings.length,
      signature: routine.signature
    },
    arguments: argumentBindings.map((binding) => ({
      argumentName: binding.argumentName,
      dataType: binding.dataType
    })),
    access: {
      reason: accessDecision.reason,
      rlsEnforced: false,
      rowPredicateRequired: false
    },
    sql: {
      text: sql,
      values
    },
    trace: {
      ...trace,
      sessionSettings: buildTraceSettings(trace)
    }
  };
}

function buildPostgresDataBulkInsertPlan(request = {}, context = {}) {
  const { workspaceId, databaseName, candidateRoles, trace } = context;
  const table = normalizeTableDefinition(request.table ?? {}, request.schemaName, request.tableName);
  const select = normalizeSelect(request.select, table);
  const rows = (request.rows ?? request.items ?? []).map((row) => normalizeValues(row, table));
  if (rows.length === 0) {
    throw new Error(`Bulk insert for ${table.schemaName}.${table.tableName} must provide at least one row.`);
  }

  const batch = normalizeBatchConfig(request.bulk ?? request, rows.length);
  const { effectiveRoleName, accessDecision } = resolveEffectiveRoleForBatch({
    candidateRoles,
    command: 'insert',
    schemaGrants: request.schemaGrants,
    objectGrants: request.objectGrants,
    tableSecurity: request.tableSecurity,
    policies: request.policies,
    sessionContext: request.sessionContext,
    rows,
    resource: { schemaName: table.schemaName, tableName: table.tableName }
  });
  const values = [];
  const columns = unique(rows.flatMap((row) => Object.keys(row)));
  const rowSql = rows.map((row) => `(${columns.map((columnName) => pushValue(values, row[columnName] ?? null)).join(', ')})`);
  const returning = buildReturningClause({ table, select });
  const sql = [
    `INSERT INTO ${qualifiedTableName(table.schemaName, table.tableName)} (${columns.map((columnName) => quoteIdent(columnName)).join(', ')})`,
    `VALUES ${rowSql.join(',\n       ')}`,
    `RETURNING ${returning.sql}`
  ].join('\n');

  return {
    operation: 'bulk_insert',
    command: 'insert',
    capability: POSTGRES_DATA_API_CAPABILITIES.bulk_insert,
    effectiveRoleName,
    resource: {
      workspaceId,
      databaseName,
      schemaName: table.schemaName,
      tableName: table.tableName
    },
    selection: select,
    access: {
      reason: accessDecision.reason,
      rlsEnforced: request.tableSecurity?.rlsEnabled !== false,
      rowPredicateRequired: accessDecision.rowPredicateRequired === true
    },
    bulk: batch,
    sql: {
      text: sql,
      values
    },
    mutation: {
      rows,
      returningColumns: returning.returningColumns
    },
    trace: {
      ...trace,
      sessionSettings: buildTraceSettings(trace)
    }
  };
}

function buildPostgresDataBulkUpdatePlan(request = {}, context = {}) {
  const { workspaceId, databaseName, candidateRoles, trace } = context;
  const table = normalizeTableDefinition(request.table ?? {}, request.schemaName, request.tableName);
  const select = normalizeSelect(request.select, table);
  const operations = (request.operations ?? request.rows ?? []).map((entry) => ({
    primaryKey: normalizePrimaryKey(entry.primaryKey, table),
    changes: normalizeValues(entry.changes, table)
  }));
  if (operations.length === 0) {
    throw new Error(`Bulk update for ${table.schemaName}.${table.tableName} must provide at least one row selector.`);
  }

  const batch = normalizeBatchConfig(request.bulk ?? request, operations.length);
  const { effectiveRoleName, accessDecision } = resolveEffectiveRole({
    candidateRoles,
    command: 'update',
    schemaGrants: request.schemaGrants,
    objectGrants: request.objectGrants,
    tableSecurity: request.tableSecurity,
    policies: request.policies,
    sessionContext: request.sessionContext,
    table,
    joins: []
  });
  const values = [];
  const changeColumns = unique(operations.flatMap((entry) => Object.keys(entry.changes)));
  const payloadColumns = [...table.primaryKey, ...changeColumns];
  const valueRows = operations.map((entry) => `(${payloadColumns.map((columnName) => {
    if (columnName in entry.primaryKey) return pushValue(values, entry.primaryKey[columnName]);
    return pushValue(values, entry.changes[columnName] ?? null);
  }).join(', ')})`);
  const returning = buildReturningClause({ table, select });
  const rlsClause = buildRlsClause({ alias: 'base', accessDecision, sessionContext: request.sessionContext, values });
  const sql = [
    `WITH bulk_input (${payloadColumns.map((columnName) => quoteIdent(columnName)).join(', ')}) AS (`,
    `  VALUES ${valueRows.join(',\n         ')}`,
    ')',
    `UPDATE ${qualifiedTableName(table.schemaName, table.tableName)} AS base`,
    `SET ${changeColumns.map((columnName) => `${quoteIdent(columnName)} = COALESCE(bulk_input.${quoteIdent(columnName)}, base.${quoteIdent(columnName)})`).join(', ')}`,
    'FROM bulk_input',
    `WHERE ${[
      ...table.primaryKey.map((columnName) => `base.${quoteIdent(columnName)} = bulk_input.${quoteIdent(columnName)}`),
      rlsClause
    ].filter(Boolean).join(' AND ')}`,
    `RETURNING ${returning.sql}`
  ].join('\n');

  return {
    operation: 'bulk_update',
    command: 'update',
    capability: POSTGRES_DATA_API_CAPABILITIES.bulk_update,
    effectiveRoleName,
    resource: {
      workspaceId,
      databaseName,
      schemaName: table.schemaName,
      tableName: table.tableName
    },
    selection: select,
    access: {
      reason: accessDecision.reason,
      rlsEnforced: request.tableSecurity?.rlsEnabled !== false,
      rowPredicateRequired: accessDecision.rowPredicateRequired === true
    },
    bulk: batch,
    sql: {
      text: sql,
      values
    },
    mutation: {
      operations,
      returningColumns: returning.returningColumns
    },
    trace: {
      ...trace,
      sessionSettings: buildTraceSettings(trace)
    }
  };
}

function buildPostgresDataBulkDeletePlan(request = {}, context = {}) {
  const { workspaceId, databaseName, candidateRoles, trace } = context;
  const table = normalizeTableDefinition(request.table ?? {}, request.schemaName, request.tableName);
  const selectors = (request.primaryKeys ?? request.rows ?? []).map((entry) => normalizePrimaryKey(entry, table));
  if (selectors.length === 0) {
    throw new Error(`Bulk delete for ${table.schemaName}.${table.tableName} must provide at least one primary-key selector.`);
  }

  const batch = normalizeBatchConfig(request.bulk ?? request, selectors.length);
  const { effectiveRoleName, accessDecision } = resolveEffectiveRole({
    candidateRoles,
    command: 'delete',
    schemaGrants: request.schemaGrants,
    objectGrants: request.objectGrants,
    tableSecurity: request.tableSecurity,
    policies: request.policies,
    sessionContext: request.sessionContext,
    table,
    joins: []
  });
  const values = [];
  const valueRows = selectors.map((entry) => `(${table.primaryKey.map((columnName) => pushValue(values, entry[columnName])).join(', ')})`);
  const returning = buildReturningClause({ table, select: request.select ? normalizeSelect(request.select, table) : table.primaryKey });
  const rlsClause = buildRlsClause({ alias: 'base', accessDecision, sessionContext: request.sessionContext, values });
  const sql = [
    `WITH delete_keys (${table.primaryKey.map((columnName) => quoteIdent(columnName)).join(', ')}) AS (`,
    `  VALUES ${valueRows.join(',\n         ')}`,
    ')',
    `DELETE FROM ${qualifiedTableName(table.schemaName, table.tableName)} AS base`,
    'USING delete_keys',
    `WHERE ${[
      ...table.primaryKey.map((columnName) => `base.${quoteIdent(columnName)} = delete_keys.${quoteIdent(columnName)}`),
      rlsClause
    ].filter(Boolean).join(' AND ')}`,
    `RETURNING ${returning.sql}`
  ].join('\n');

  return {
    operation: 'bulk_delete',
    command: 'delete',
    capability: POSTGRES_DATA_API_CAPABILITIES.bulk_delete,
    effectiveRoleName,
    resource: {
      workspaceId,
      databaseName,
      schemaName: table.schemaName,
      tableName: table.tableName
    },
    access: {
      reason: accessDecision.reason,
      rlsEnforced: request.tableSecurity?.rlsEnabled !== false,
      rowPredicateRequired: accessDecision.rowPredicateRequired === true
    },
    bulk: batch,
    sql: {
      text: sql,
      values
    },
    mutation: {
      primaryKeys: selectors,
      returningColumns: returning.returningColumns
    },
    trace: {
      ...trace,
      sessionSettings: buildTraceSettings(trace)
    }
  };
}

function buildPostgresDataImportPlan(request = {}, context = {}) {
  const format = String(request.format ?? 'json').trim().toLowerCase();
  if (!['json', 'csv'].includes(format)) {
    throw new Error(`Unsupported PostgreSQL import format ${format}.`);
  }

  if (format === 'json') {
    const bulkPlan = buildPostgresDataBulkInsertPlan({
      ...request,
      rows: request.rows ?? request.items
    }, context);

    return {
      ...bulkPlan,
      operation: 'import',
      capability: POSTGRES_DATA_API_CAPABILITIES.import,
      import: {
        format,
        mode: String(request.mode ?? 'insert').trim().toLowerCase(),
        validation: {
          requested: request.validateAfterImport !== false,
          strategy: request.validationMode ?? 'row_count_and_schema'
        },
        restore: {
          compatibility: ['json', 'csv'],
          expectedOrder: 'schema_then_data',
          requiresSecretFreeManifest: true
        }
      }
    };
  }

  const { workspaceId, databaseName, candidateRoles, trace } = context;
  const table = normalizeTableDefinition(request.table ?? {}, request.schemaName, request.tableName);
  const columns = normalizeSelect(request.columns ?? request.select, table);
  const { effectiveRoleName, accessDecision } = resolveEffectiveRole({
    candidateRoles,
    command: 'insert',
    schemaGrants: request.schemaGrants,
    objectGrants: request.objectGrants,
    tableSecurity: request.tableSecurity,
    policies: request.policies,
    sessionContext: request.sessionContext,
    table,
    joins: []
  });

  return {
    operation: 'import',
    command: 'insert',
    capability: POSTGRES_DATA_API_CAPABILITIES.import,
    effectiveRoleName,
    resource: {
      workspaceId,
      databaseName,
      schemaName: table.schemaName,
      tableName: table.tableName
    },
    selection: columns,
    access: {
      reason: accessDecision.reason,
      rlsEnforced: request.tableSecurity?.rlsEnabled !== false,
      rowPredicateRequired: accessDecision.rowPredicateRequired === true
    },
    sql: {
      text: `COPY ${qualifiedTableName(table.schemaName, table.tableName)} (${columns.map((columnName) => quoteIdent(columnName)).join(', ')}) FROM STDIN WITH (FORMAT csv, HEADER ${request.headerRow !== false}, DELIMITER ${quoteLiteral(request.delimiter ?? ',')})`,
      values: [request.csvText ?? '']
    },
    import: {
      format,
      mode: String(request.mode ?? 'insert').trim().toLowerCase(),
      validation: {
        requested: request.validateAfterImport !== false,
        strategy: request.validationMode ?? 'row_count_and_checksum'
      },
      restore: {
        compatibility: ['json', 'csv'],
        expectedOrder: 'schema_then_data',
        requiresSecretFreeManifest: true
      }
    },
    trace: {
      ...trace,
      sessionSettings: buildTraceSettings(trace)
    }
  };
}

function buildPostgresDataExportPlan(request = {}, context = {}) {
  const { workspaceId, databaseName, candidateRoles, trace } = context;
  const table = normalizeTableDefinition(request.table ?? {}, request.schemaName, request.tableName);
  const select = normalizeSelect(request.select, table);
  const filters = normalizeFilters(request.filters, table);
  const joins = normalizeJoins(request.joins, table);
  const order = normalizeOrder(request.order, table).map((entry) => ({
    ...entry,
    primaryKey: table.primaryKey.includes(entry.columnName)
  }));
  const values = [];
  const responseOptions = normalizeResponseOptions(request);
  const { effectiveRoleName, accessDecision } = resolveEffectiveRole({
    candidateRoles,
    command: 'select',
    schemaGrants: request.schemaGrants,
    objectGrants: request.objectGrants,
    tableSecurity: request.tableSecurity,
    policies: request.policies,
    sessionContext: request.sessionContext,
    table,
    joins
  });

  const baseSelectExpressions = select.map((columnName) => `base.${quoteIdent(columnName)} AS ${quoteIdent(columnName)}`);
  const baseWhereClauses = [];
  const filterClauses = buildFilterClauses({ alias: 'base', filters, values });
  const rlsClause = buildRlsClause({ alias: 'base', accessDecision, sessionContext: request.sessionContext, values });
  if (rlsClause) baseWhereClauses.push(rlsClause);
  baseWhereClauses.push(...filterClauses);
  const joinFragments = buildJoinFragments({ joins, sessionContext: request.sessionContext, effectiveRoleName, values });
  const querySql = [
    `SELECT ${[...baseSelectExpressions, ...joinFragments.selectExpressions].join(', ')}`,
    `FROM ${qualifiedTableName(table.schemaName, table.tableName)} AS base`,
    ...joinFragments.joinClauses,
    baseWhereClauses.length > 0 ? `WHERE ${baseWhereClauses.join(' AND ')}` : undefined,
    `ORDER BY ${buildOrderClause({ alias: 'base', order }).join(', ')}`
  ].filter(Boolean).join('\n');
  const format = String(request.format ?? 'json').trim().toLowerCase();
  if (!['json', 'csv'].includes(format)) {
    throw new Error(`Unsupported PostgreSQL export format ${format}.`);
  }

  const sql = format === 'csv'
    ? `COPY (
${querySql}
) TO STDOUT WITH (FORMAT csv, HEADER true)`
    : querySql;
  const count = buildCountPlan({ table, baseWhereClauses, values, countMode: responseOptions.countMode });

  return {
    operation: 'export',
    command: 'select',
    capability: POSTGRES_DATA_API_CAPABILITIES.export,
    effectiveRoleName,
    resource: {
      workspaceId,
      databaseName,
      schemaName: table.schemaName,
      tableName: table.tableName
    },
    selection: select,
    joins: joinFragments.relationSummaries,
    filters,
    order,
    access: {
      reason: accessDecision.reason,
      rlsEnforced: request.tableSecurity?.rlsEnabled !== false,
      rowPredicateRequired: accessDecision.rowPredicateRequired === true
    },
    export: {
      format,
      consistency: request.consistency ?? 'transaction_snapshot',
      includeRestoreManifest: request.includeRestoreManifest !== false,
      validationMode: request.validationMode ?? 'checksum'
    },
    response: {
      countMode: responseOptions.countMode,
      paginationMode: responseOptions.paginationMode,
      count
    },
    sql: {
      text: sql,
      values
    },
    trace: {
      ...trace,
      sessionSettings: buildTraceSettings(trace)
    }
  };
}

export function buildPostgresDataScopedCredential(request = {}) {
  const workspaceId = String(request.workspaceId ?? '').trim();
  const databaseName = normalizeIdentifier(request.databaseName, 'databaseName');
  const credentialId = normalizeIdentifier(request.credentialId ?? request.id ?? 'credential', 'credentialId');
  const credentialType = String(request.credentialType ?? 'api_key').trim().toLowerCase();
  if (!['api_key', 'token'].includes(credentialType)) {
    throw new Error(`Unsupported PostgreSQL scoped credential type ${credentialType}.`);
  }

  const scopes = (request.scopes ?? []).map((scope) => normalizeCredentialScopeDefinition(scope, databaseName));
  if (scopes.length === 0) {
    throw new Error('Scoped PostgreSQL credentials must define at least one scope entry.');
  }

  return {
    capability: POSTGRES_DATA_MANAGEMENT_CAPABILITIES.scoped_credential,
    credentialId,
    credentialType,
    databaseName,
    workspaceId,
    displayName: request.displayName ?? credentialId,
    ttlSeconds: Math.max(60, Number(request.ttlSeconds ?? 3600)),
    scopes,
    trace: {
      ...normalizeTraceContext(request, workspaceId),
      sessionSettings: buildTraceSettings(normalizeTraceContext(request, workspaceId))
    }
  };
}

export function buildPostgresSavedQueryDefinition(request = {}) {
  const workspaceId = String(request.workspaceId ?? '').trim();
  const databaseName = normalizeIdentifier(request.databaseName, 'databaseName');
  const savedQueryId = normalizeIdentifier(request.savedQueryId ?? request.id ?? 'saved_query', 'savedQueryId');
  const sourceType = String(request.sourceType ?? (request.routine ? 'routine' : request.view ? 'view' : 'table')).trim().toLowerCase();
  if (!['table', 'view', 'routine'].includes(sourceType)) {
    throw new Error(`Unsupported PostgreSQL saved-query source type ${sourceType}.`);
  }

  const responseOptions = normalizeResponseOptions(request);

  return {
    capability: POSTGRES_DATA_MANAGEMENT_CAPABILITIES.saved_query,
    savedQueryId,
    workspaceId,
    databaseName,
    sourceType,
    schemaName: request.schemaName ? normalizeIdentifier(request.schemaName, 'schemaName') : undefined,
    tableName: request.tableName ? normalizeIdentifier(request.tableName, 'tableName') : undefined,
    viewName: request.viewName ? normalizeIdentifier(request.viewName, 'viewName') : undefined,
    routineName: request.routineName ? normalizeIdentifier(request.routineName, 'routineName') : undefined,
    select: request.select ?? [],
    filters: request.filters ?? [],
    joins: request.joins ?? [],
    order: request.order ?? [],
    page: compactDefined({
      size: request.page?.size,
      after: request.page?.after
    }),
    arguments: request.arguments ?? {},
    parameters: (request.parameters ?? []).map((parameter) => ({
      parameterName: normalizeIdentifier(parameter.parameterName ?? parameter.name, 'savedQuery.parameterName'),
      required: parameter.required !== false,
      defaultValue: parameter.defaultValue
    })),
    responseOptions,
    trace: normalizeTraceContext(request, workspaceId)
  };
}

export function buildPostgresSavedQueryExecutionPlan(request = {}) {
  const definition = buildPostgresSavedQueryDefinition(request.savedQuery ?? request);
  const parameters = normalizeSavedQueryParameters(definition, request.parameters ?? {});

  if (definition.sourceType === 'routine') {
    const plan = buildPostgresDataApiPlan({
      ...request,
      operation: 'rpc',
      workspaceId: definition.workspaceId,
      databaseName: definition.databaseName,
      schemaName: definition.schemaName,
      routineName: definition.routineName,
      arguments: resolveTemplateValue(definition.arguments, parameters),
      responseOptions: definition.responseOptions
    });

    return {
      ...plan,
      operation: 'saved_query_execute',
      capability: POSTGRES_DATA_API_CAPABILITIES.saved_query_execute,
      savedQuery: {
        savedQueryId: definition.savedQueryId,
        sourceType: definition.sourceType,
        parameters: Object.keys(parameters)
      }
    };
  }

  const plan = buildPostgresDataApiPlan({
    ...request,
    operation: 'list',
    workspaceId: definition.workspaceId,
    databaseName: definition.databaseName,
    schemaName: definition.schemaName,
    tableName: definition.tableName ?? definition.viewName,
    select: definition.select,
    filters: resolveTemplateValue(definition.filters, parameters),
    joins: definition.joins,
    order: definition.order,
    page: Object.keys(request.page ?? {}).length > 0 ? request.page : definition.page,
    responseOptions: definition.responseOptions
  });

  return {
    ...plan,
    operation: 'saved_query_execute',
    capability: POSTGRES_DATA_API_CAPABILITIES.saved_query_execute,
    savedQuery: {
      savedQueryId: definition.savedQueryId,
      sourceType: definition.sourceType,
      parameters: Object.keys(parameters)
    }
  };
}

export function buildPostgresDataStableEndpointDefinition(request = {}) {
  const endpointId = normalizeIdentifier(request.endpointId ?? request.id ?? 'endpoint', 'endpointId');
  const workspaceId = String(request.workspaceId ?? '').trim();
  const databaseName = normalizeIdentifier(request.databaseName, 'databaseName');
  const slug = normalizeSlug(request.slug ?? endpointId, 'endpoint.slug');
  const sourceType = String(request.sourceType ?? (request.savedQuery ? 'saved_query' : request.routine ? 'routine' : 'view')).trim().toLowerCase();
  if (!['saved_query', 'view', 'routine'].includes(sourceType)) {
    throw new Error(`Unsupported PostgreSQL stable endpoint source type ${sourceType}.`);
  }

  return {
    capability: POSTGRES_DATA_MANAGEMENT_CAPABILITIES.stable_endpoint,
    endpointId,
    workspaceId,
    databaseName,
    slug,
    stablePath: `/v1/postgres/workspaces/${workspaceId}/data/${databaseName}/published/${slug}`,
    sourceType,
    httpMethod: request.httpMethod ?? (sourceType === 'routine' ? 'POST' : 'GET'),
    authModes: unique((request.authModes ?? ['workspace_bearer']).map((entry) => String(entry).trim().toLowerCase())),
    responseOptions: normalizeResponseOptions(request),
    trace: normalizeTraceContext(request, workspaceId)
  };
}

export function buildPostgresDataStableEndpointInvocationPlan(request = {}) {
  const endpoint = buildPostgresDataStableEndpointDefinition(request.endpoint ?? request);

  if (endpoint.sourceType === 'saved_query') {
    const plan = buildPostgresSavedQueryExecutionPlan({
      ...request,
      savedQuery: request.endpoint?.savedQuery ?? request.savedQuery
    });

    return {
      ...plan,
      operation: 'stable_endpoint_invoke',
      capability: POSTGRES_DATA_API_CAPABILITIES.stable_endpoint_invoke,
      endpoint
    };
  }

  if (endpoint.sourceType === 'routine') {
    const plan = buildPostgresDataApiPlan({
      ...request,
      operation: 'rpc',
      responseOptions: endpoint.responseOptions
    });

    return {
      ...plan,
      operation: 'stable_endpoint_invoke',
      capability: POSTGRES_DATA_API_CAPABILITIES.stable_endpoint_invoke,
      endpoint
    };
  }

  const plan = buildPostgresDataApiPlan({
    ...request,
    operation: 'list',
    responseOptions: endpoint.responseOptions
  });

  return {
    ...plan,
    operation: 'stable_endpoint_invoke',
    capability: POSTGRES_DATA_API_CAPABILITIES.stable_endpoint_invoke,
    endpoint
  };
}

export function buildPostgresDataApiPlan(request = {}) {
  const operation = String(request.operation ?? 'list').trim().toLowerCase();
  if (!POSTGRES_DATA_API_OPERATIONS.includes(operation)) {
    throw new Error(`Unsupported PostgreSQL data API operation ${operation}.`);
  }

  const workspaceId = String(request.workspaceId ?? '').trim();
  const databaseName = normalizeIdentifier(request.databaseName, 'databaseName');
  const command = commandForOperation(operation);
  const candidateRoles = unique([...(request.effectiveRoles ?? []), request.actorRoleName].filter(Boolean));
  if (candidateRoles.length === 0) {
    throw new Error('At least one actor or effective role must be provided.');
  }

  const trace = normalizeTraceContext({ ...request, databaseName }, workspaceId);
  const responseOptions = normalizeResponseOptions(request);

  if (operation === 'rpc') {
    return buildPostgresDataRpcPlan(request, { workspaceId, databaseName, candidateRoles, trace });
  }

  if (operation === 'bulk_insert') {
    return buildPostgresDataBulkInsertPlan(request, { workspaceId, databaseName, candidateRoles, trace });
  }

  if (operation === 'bulk_update') {
    return buildPostgresDataBulkUpdatePlan(request, { workspaceId, databaseName, candidateRoles, trace });
  }

  if (operation === 'bulk_delete') {
    return buildPostgresDataBulkDeletePlan(request, { workspaceId, databaseName, candidateRoles, trace });
  }

  if (operation === 'import') {
    return buildPostgresDataImportPlan(request, { workspaceId, databaseName, candidateRoles, trace });
  }

  if (operation === 'export') {
    return buildPostgresDataExportPlan(request, { workspaceId, databaseName, candidateRoles, trace });
  }

  if (operation === 'saved_query_execute') {
    return buildPostgresSavedQueryExecutionPlan(request);
  }

  if (operation === 'stable_endpoint_invoke') {
    return buildPostgresDataStableEndpointInvocationPlan(request);
  }

  const table = normalizeTableDefinition(request.table ?? {}, request.schemaName, request.tableName);
  const select = normalizeSelect(request.select, table);
  const filters = normalizeFilters(request.filters, table);
  const joins = normalizeJoins(request.joins, table);
  const order = normalizeOrder(request.order, table).map((entry) => ({
    ...entry,
    primaryKey: table.primaryKey.includes(entry.columnName)
  }));
  const pageSize = Math.max(1, Math.min(200, Number(request.page?.size ?? 25)));
  const pageAfter = request.page?.after;
  const primaryKey = operation === 'get' || operation === 'update' || operation === 'delete'
    ? normalizePrimaryKey(request.primaryKey, table)
    : undefined;
  const values = [];
  const mutationValues = operation === 'insert'
    ? normalizeValues(request.values, table)
    : operation === 'update'
      ? normalizeValues(request.changes, table)
      : undefined;

  const { effectiveRoleName, accessDecision } = resolveEffectiveRole({
    candidateRoles,
    command,
    schemaGrants: request.schemaGrants,
    objectGrants: request.objectGrants,
    tableSecurity: request.tableSecurity,
    policies: request.policies,
    sessionContext: request.sessionContext,
    row: operation === 'insert' ? mutationValues : request.row,
    table,
    joins
  });

  const baseSelectExpressions = select.map((columnName) => `base.${quoteIdent(columnName)} AS ${quoteIdent(columnName)}`);
  const baseWhereClauses = [];
  const filterClauses = buildFilterClauses({ alias: 'base', filters, values });
  const rlsClause = buildRlsClause({ alias: 'base', accessDecision, sessionContext: request.sessionContext, values });
  if (rlsClause) baseWhereClauses.push(rlsClause);
  baseWhereClauses.push(...filterClauses);
  if (primaryKey) baseWhereClauses.push(...buildPrimaryKeyClause({ alias: 'base', primaryKey, values }));
  const cursorClause = operation === 'list'
    ? buildCursorClause({ alias: 'base', order, cursor: pageAfter, values })
    : undefined;
  if (cursorClause) baseWhereClauses.push(cursorClause);
  const joinFragments = operation === 'list' || operation === 'get'
    ? buildJoinFragments({ joins, sessionContext: request.sessionContext, effectiveRoleName, values })
    : { selectExpressions: [], joinClauses: [], relationSummaries: [] };

  let sql;
  let returning;

  if (operation === 'list' || operation === 'get') {
    sql = buildListLikeSql({
      operation,
      table,
      baseSelectExpressions,
      joinFragments,
      baseWhereClauses,
      order,
      pageSize
    });
  } else if (operation === 'insert') {
    const columns = Object.keys(mutationValues);
    const placeholders = columns.map((columnName) => pushValue(values, mutationValues[columnName]));
    returning = buildReturningClause({ table, select });
    sql = [
      `INSERT INTO ${qualifiedTableName(table.schemaName, table.tableName)} (${columns.map((columnName) => quoteIdent(columnName)).join(', ')})`,
      `VALUES (${placeholders.join(', ')})`,
      `RETURNING ${returning.sql}`
    ].join('\n');
  } else if (operation === 'update') {
    const assignments = Object.keys(mutationValues).map((columnName) => `${quoteIdent(columnName)} = ${pushValue(values, mutationValues[columnName])}`);
    returning = buildReturningClause({ table, select });
    sql = [
      `UPDATE ${qualifiedTableName(table.schemaName, table.tableName)} AS base`,
      `SET ${assignments.join(', ')}`,
      baseWhereClauses.length > 0 ? `WHERE ${baseWhereClauses.join(' AND ')}` : undefined,
      `RETURNING ${returning.sql}`
    ].filter(Boolean).join('\n');
  } else if (operation === 'delete') {
    returning = buildReturningClause({ table, select: table.primaryKey });
    sql = [
      `DELETE FROM ${qualifiedTableName(table.schemaName, table.tableName)} AS base`,
      baseWhereClauses.length > 0 ? `WHERE ${baseWhereClauses.join(' AND ')}` : undefined,
      `RETURNING ${returning.sql}`
    ].filter(Boolean).join('\n');
  }

  const count = operation === 'list'
    ? buildCountPlan({ table, baseWhereClauses, values, countMode: responseOptions.countMode })
    : undefined;

  return {
    operation,
    command,
    capability: POSTGRES_DATA_API_CAPABILITIES[operation],
    effectiveRoleName,
    resource: {
      workspaceId,
      databaseName,
      schemaName: table.schemaName,
      tableName: table.tableName
    },
    selection: select,
    joins: joinFragments.relationSummaries,
    filters,
    order,
    page: operation === 'list'
      ? {
          size: pageSize,
          after: pageAfter,
          nextCursorExample: serializePostgresDataApiCursor({
            order: order.map((entry) => ({ columnName: entry.columnName, direction: entry.direction, value: `<${entry.columnName}>` }))
          }),
          metadataMode: responseOptions.paginationMode
        }
      : undefined,
    response: {
      countMode: responseOptions.countMode,
      paginationMode: responseOptions.paginationMode,
      count
    },
    access: {
      reason: accessDecision.reason,
      rlsEnforced: request.tableSecurity?.rlsEnabled !== false,
      rowPredicateRequired: accessDecision.rowPredicateRequired === true
    },
    sql: {
      text: sql,
      values
    },
    mutation: mutationValues
      ? {
          values: mutationValues,
          returningColumns: returning?.returningColumns ?? []
        }
      : undefined,
    trace: {
      ...trace,
      sessionSettings: buildTraceSettings(trace)
    }
  };
}

export function summarizePostgresDataApiCapabilityMatrix() {
  return POSTGRES_DATA_API_OPERATIONS.map((operation) => ({
    operation,
    command: commandForOperation(operation),
    capability: POSTGRES_DATA_API_CAPABILITIES[operation]
  })).concat([
    { operation: 'scoped_credential', command: 'govern', capability: POSTGRES_DATA_MANAGEMENT_CAPABILITIES.scoped_credential },
    { operation: 'saved_query', command: 'govern', capability: POSTGRES_DATA_MANAGEMENT_CAPABILITIES.saved_query },
    { operation: 'stable_endpoint', command: 'govern', capability: POSTGRES_DATA_MANAGEMENT_CAPABILITIES.stable_endpoint }
  ]);
}
