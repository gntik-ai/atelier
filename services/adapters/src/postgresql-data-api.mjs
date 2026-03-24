import { evaluatePostgresDataApiAccess } from './postgresql-governance-admin.mjs';

const IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,62}$/;
const ORDER_DIRECTION_SET = new Set(['asc', 'desc']);
const MUTATION_OPERATIONS = new Set(['insert', 'update', 'delete']);

export const POSTGRES_DATA_API_OPERATIONS = Object.freeze(['list', 'get', 'insert', 'update', 'delete', 'rpc']);
export const POSTGRES_DATA_API_COMMANDS = Object.freeze(['select', 'insert', 'update', 'delete', 'execute']);
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
  rpc: 'postgres_data_rpc'
});

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
  if (operation === 'list' || operation === 'get') return 'select';
  if (operation === 'rpc') return 'execute';
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

function buildPostgresDataRpcPlan(request = {}, { workspaceId, databaseName, candidateRoles } = {}) {
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
    ? [`SELECT *`, `FROM ${functionCall}`].join('\n')
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
    }
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

  if (operation === 'rpc') {
    return buildPostgresDataRpcPlan(request, { workspaceId, databaseName, candidateRoles });
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
    const selectClause = [...baseSelectExpressions, ...joinFragments.selectExpressions].join(', ');
    const orderClause = buildOrderClause({ alias: 'base', order }).join(', ');
    sql = [
      `SELECT ${selectClause}`,
      `FROM ${qualifiedTableName(table.schemaName, table.tableName)} AS base`,
      ...joinFragments.joinClauses,
      baseWhereClauses.length > 0 ? `WHERE ${baseWhereClauses.join(' AND ')}` : undefined,
      `ORDER BY ${orderClause}`,
      operation === 'list' ? `LIMIT ${pageSize}` : 'LIMIT 1'
    ].filter(Boolean).join('\n');
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
          })
        }
      : undefined,
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
      : undefined
  };
}

export function summarizePostgresDataApiCapabilityMatrix() {
  return POSTGRES_DATA_API_OPERATIONS.map((operation) => ({
    operation,
    command: commandForOperation(operation),
    capability: POSTGRES_DATA_API_CAPABILITIES[operation]
  }));
}
