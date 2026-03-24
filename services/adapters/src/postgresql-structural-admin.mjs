const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;
const RESERVED_PREFIX_PATTERN = /^(pg_|sql_)/;
const SAFE_LITERAL_PATTERN = /^(?:null|true|false|-?\d+(?:\.\d+)?|'(?:[^']|'')*')$/i;
const SAFE_DEFAULT_FUNCTIONS = new Set(['now()', 'current_timestamp', 'current_date', 'current_time', 'gen_random_uuid()', 'uuid_generate_v4()']);
const SAFE_GENERATED_EXPRESSION_PATTERN = /^[a-z0-9_"()\s,+\-*/%|:&<>=.!?\[\]]+$/i;
const SAFE_CHECK_EXPRESSION_PATTERN = /^[a-z0-9_"()\s,+\-*/%|:&<>=.!?'\[\]]+$/i;
const SAFE_INDEX_EXPRESSION_PATTERN = /^[a-z0-9_"()\s,+\-*/%|:&<>=.!?'\[\]]+$/i;
const SAFE_QUERY_PATTERN = /^[\s\S]{1,12000}$/;
const SAFE_ROUTINE_BODY_PATTERN = /^[\s\S]{1,16000}$/;
const FORBIDDEN_QUERY_TOKENS = [
  /;/,
  /--/,
  /\/\*/,
  /\b(insert|update|delete|truncate|copy|alter|drop|grant|revoke|comment|do|call|create\s+role|create\s+database|create\s+schema|create\s+table|security\s+definer|execute\s+format|alter\s+system)\b/i
];
const FORBIDDEN_ROUTINE_TOKENS = [
  /\bsecurity\s+definer\b/i,
  /\balter\s+system\b/i,
  /\bcopy\b/i,
  /\bcreate\s+role\b/i,
  /\bdrop\s+role\b/i,
  /\bset\s+role\b/i,
  /\bset\s+session\s+authorization\b/i,
  /\bpg_read_file\b/i,
  /\bpg_write_file\b/i,
  /\bdblink\b/i,
  /\blo_import\b/i,
  /\blo_export\b/i,
  /\bexecute\s+format\b/i,
  /\bcreate\s+extension\b/i,
  /\balter\s+extension\b/i,
  /\bdrop\s+extension\b/i
];

export const POSTGRES_INDEX_METHODS = Object.freeze(['btree', 'hash', 'gin', 'gist', 'brin']);
export const POSTGRES_CONSTRAINT_TYPES = Object.freeze(['primary_key', 'foreign_key', 'unique', 'check', 'not_null']);
export const POSTGRES_ROUTINE_LANGUAGES = Object.freeze(['sql', 'plpgsql']);
export const POSTGRES_ROUTINE_VOLATILITIES = Object.freeze(['immutable', 'stable', 'volatile']);
export const POSTGRES_STRUCTURAL_RESOURCE_KINDS = Object.freeze([
  'table',
  'column',
  'type',
  'constraint',
  'index',
  'view',
  'materialized_view',
  'function',
  'procedure'
]);

const BUILTIN_TYPE_CATALOG = Object.freeze([
  {
    schemaName: 'pg_catalog',
    typeName: 'smallint',
    aliases: ['int2'],
    category: 'built_in',
    kind: 'numeric',
    advanced: false,
    arraySupported: true,
    typeClass: 'base'
  },
  {
    schemaName: 'pg_catalog',
    typeName: 'integer',
    aliases: ['int', 'int4'],
    category: 'built_in',
    kind: 'numeric',
    advanced: false,
    arraySupported: true,
    typeClass: 'base'
  },
  {
    schemaName: 'pg_catalog',
    typeName: 'bigint',
    aliases: ['int8'],
    category: 'built_in',
    kind: 'numeric',
    advanced: false,
    arraySupported: true,
    typeClass: 'base'
  },
  {
    schemaName: 'pg_catalog',
    typeName: 'numeric',
    aliases: ['decimal'],
    category: 'built_in',
    kind: 'numeric',
    advanced: false,
    arraySupported: true,
    typeClass: 'base'
  },
  {
    schemaName: 'pg_catalog',
    typeName: 'boolean',
    aliases: ['bool'],
    category: 'built_in',
    kind: 'boolean',
    advanced: false,
    arraySupported: true,
    typeClass: 'base'
  },
  {
    schemaName: 'pg_catalog',
    typeName: 'text',
    aliases: [],
    category: 'built_in',
    kind: 'text',
    advanced: false,
    arraySupported: true,
    typeClass: 'base'
  },
  {
    schemaName: 'pg_catalog',
    typeName: 'varchar',
    aliases: ['character varying'],
    category: 'built_in',
    kind: 'text',
    advanced: false,
    arraySupported: true,
    typeClass: 'base'
  },
  {
    schemaName: 'pg_catalog',
    typeName: 'uuid',
    aliases: [],
    category: 'built_in',
    kind: 'uuid',
    advanced: false,
    arraySupported: true,
    typeClass: 'base'
  },
  {
    schemaName: 'pg_catalog',
    typeName: 'json',
    aliases: [],
    category: 'built_in',
    kind: 'json',
    advanced: false,
    arraySupported: true,
    typeClass: 'base'
  },
  {
    schemaName: 'pg_catalog',
    typeName: 'jsonb',
    aliases: [],
    category: 'built_in',
    kind: 'json',
    advanced: false,
    arraySupported: true,
    typeClass: 'base'
  },
  {
    schemaName: 'pg_catalog',
    typeName: 'date',
    aliases: [],
    category: 'built_in',
    kind: 'temporal',
    advanced: false,
    arraySupported: true,
    typeClass: 'base'
  },
  {
    schemaName: 'pg_catalog',
    typeName: 'timestamp',
    aliases: ['timestamp without time zone'],
    category: 'built_in',
    kind: 'temporal',
    advanced: false,
    arraySupported: true,
    typeClass: 'base'
  },
  {
    schemaName: 'pg_catalog',
    typeName: 'timestamptz',
    aliases: ['timestamp with time zone'],
    category: 'built_in',
    kind: 'temporal',
    advanced: false,
    arraySupported: true,
    typeClass: 'base'
  },
  {
    schemaName: 'pg_catalog',
    typeName: 'bytea',
    aliases: [],
    category: 'built_in',
    kind: 'binary',
    advanced: false,
    arraySupported: false,
    typeClass: 'base'
  },
  {
    schemaName: 'pg_catalog',
    typeName: 'inet',
    aliases: [],
    category: 'built_in',
    kind: 'network',
    advanced: true,
    featureFlag: 'network',
    arraySupported: true,
    typeClass: 'base'
  },
  {
    schemaName: 'pg_catalog',
    typeName: 'cidr',
    aliases: [],
    category: 'built_in',
    kind: 'network',
    advanced: true,
    featureFlag: 'network',
    arraySupported: true,
    typeClass: 'base'
  },
  {
    schemaName: 'pg_catalog',
    typeName: 'macaddr',
    aliases: [],
    category: 'built_in',
    kind: 'network',
    advanced: true,
    featureFlag: 'network',
    arraySupported: true,
    typeClass: 'base'
  },
  {
    schemaName: 'pg_catalog',
    typeName: 'daterange',
    aliases: [],
    category: 'built_in',
    kind: 'range',
    advanced: true,
    featureFlag: 'range',
    arraySupported: true,
    typeClass: 'range'
  },
  {
    schemaName: 'pg_catalog',
    typeName: 'tstzrange',
    aliases: [],
    category: 'built_in',
    kind: 'range',
    advanced: true,
    featureFlag: 'range',
    arraySupported: true,
    typeClass: 'range'
  },
  {
    schemaName: 'pg_catalog',
    typeName: 'tsvector',
    aliases: [],
    category: 'built_in',
    kind: 'text_search',
    advanced: true,
    featureFlag: 'text_search',
    arraySupported: true,
    typeClass: 'base'
  },
  {
    schemaName: 'pg_catalog',
    typeName: 'tsquery',
    aliases: [],
    category: 'built_in',
    kind: 'text_search',
    advanced: true,
    featureFlag: 'text_search',
    arraySupported: true,
    typeClass: 'base'
  }
]);

function compactDefined(values) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}

function unique(values = []) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null).map((value) => String(value)))];
}

function normalizeIdentifier(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 63);
}

function safeIdentifier(value) {
  const normalized = normalizeIdentifier(value);
  return normalized || undefined;
}

function normalizeIdentifierList(values = []) {
  return unique(values).map((value) => normalizeIdentifier(value)).filter(Boolean);
}

function quoteIdent(identifier) {
  const normalized = String(identifier ?? '').trim();
  if (!normalized) {
    throw new Error('SQL identifier is required.');
  }

  return `"${normalized.replace(/"/g, '""')}"`;
}

function quoteLiteral(value) {
  if (value === null) return 'NULL';
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function normalizeTypeName(typeName) {
  return String(typeName ?? '')
    .trim()
    .replace(/^"|"$/g, '')
    .toLowerCase();
}

function splitQualifiedTypeName(typeName) {
  const normalized = normalizeTypeName(typeName);
  const parts = normalized.split('.').filter(Boolean);

  if (parts.length >= 2) {
    return {
      schemaName: parts.slice(0, -1).join('.'),
      typeName: parts.at(-1)
    };
  }

  return {
    schemaName: undefined,
    typeName: normalized
  };
}

function typeCatalogKey(schemaName, typeName) {
  return `${schemaName ?? 'pg_catalog'}.${typeName}`;
}

function normalizeTypeEntry(entry = {}, defaults = {}) {
  const sourceTypeName = entry.typeName ?? entry.name ?? defaults.typeName;
  const { schemaName: splitSchemaName, typeName } = splitQualifiedTypeName(sourceTypeName);
  const schemaName = normalizeTypeName(entry.schemaName ?? defaults.schemaName ?? splitSchemaName ?? 'pg_catalog');
  const normalizedTypeName = normalizeTypeName(typeName);
  const aliases = unique(entry.aliases ?? []).map((alias) => normalizeTypeName(alias));
  const category = entry.category ?? defaults.category ?? 'built_in';
  const kind = entry.kind ?? defaults.kind ?? 'scalar';
  const featureFlag = entry.featureFlag ?? defaults.featureFlag;
  const arraySupported = entry.arraySupported !== false;
  const typeClass = entry.typeClass ?? defaults.typeClass ?? 'base';

  return compactDefined({
    schemaName,
    typeName: normalizedTypeName,
    fullName: schemaName === 'pg_catalog' ? normalizedTypeName : `${schemaName}.${normalizedTypeName}`,
    displayName: entry.displayName ?? (schemaName === 'pg_catalog' ? normalizedTypeName : `${schemaName}.${normalizedTypeName}`),
    category,
    kind,
    featureFlag,
    aliases,
    arraySupported,
    typeClass,
    extensionName: entry.extensionName,
    enumLabels: entry.enumLabels,
    baseType: entry.baseType,
    comment: entry.comment,
    advanced: entry.advanced === true,
    available: entry.available !== false,
    arrayDimensions: Number(entry.arrayDimensions ?? 0)
  });
}

function shouldIncludeBuiltinType(entry, options) {
  if (!entry.advanced) return true;

  switch (entry.featureFlag) {
    case 'network':
      return options.enableNetworkTypes !== false;
    case 'range':
      return options.enableRangeTypes !== false;
    case 'text_search':
      return options.enableTextSearchTypes !== false;
    default:
      return options.includeAdvancedTypes !== false;
  }
}

function maybeBuildArrayVariant(entry) {
  if (!entry.arraySupported) return null;

  return {
    ...entry,
    typeName: `${entry.typeName}[]`,
    fullName: entry.schemaName === 'pg_catalog' ? `${entry.typeName}[]` : `${entry.schemaName}.${entry.typeName}[]`,
    displayName: `${entry.displayName}[]`,
    kind: 'array',
    arrayDimensions: 1,
    elementType: entry.typeName,
    elementSchemaName: entry.schemaName,
    catalogKey: typeCatalogKey(entry.schemaName, `${entry.typeName}[]`)
  };
}

function catalogSort(left, right) {
  return `${left.category}:${left.schemaName}:${left.typeName}`.localeCompare(`${right.category}:${right.schemaName}:${right.typeName}`);
}

export function buildAllowedPostgresTypeCatalog(options = {}) {
  const catalog = [];
  const enabledExtensions = new Set(unique(options.enabledExtensions ?? []).map((entry) => normalizeTypeName(entry)));

  for (const builtinEntry of BUILTIN_TYPE_CATALOG) {
    if (!shouldIncludeBuiltinType(builtinEntry, options)) continue;
    const entry = normalizeTypeEntry(builtinEntry);
    catalog.push({ ...entry, catalogKey: typeCatalogKey(entry.schemaName, entry.typeName) });

    const arrayVariant = maybeBuildArrayVariant(entry);
    if (arrayVariant) {
      catalog.push(arrayVariant);
    }
  }

  for (const userDefinedType of options.userDefinedTypes ?? []) {
    const entry = normalizeTypeEntry(userDefinedType, { category: 'user_defined', typeClass: userDefinedType.typeClass ?? 'base' });
    if (!entry.typeName) continue;
    catalog.push({ ...entry, catalogKey: typeCatalogKey(entry.schemaName, entry.typeName) });
  }

  for (const extensionType of options.extensionTypes ?? []) {
    const extensionName = normalizeTypeName(extensionType.extensionName);
    if (extensionName && !enabledExtensions.has(extensionName)) continue;
    const entry = normalizeTypeEntry(extensionType, { category: 'extension', extensionName });
    if (!entry.typeName) continue;
    catalog.push({ ...entry, catalogKey: typeCatalogKey(entry.schemaName, entry.typeName) });
  }

  return unique(catalog.map((entry) => JSON.stringify(entry)))
    .map((entry) => JSON.parse(entry))
    .sort(catalogSort);
}

function buildTypeCatalogIndex(catalog = []) {
  const index = new Map();

  for (const entry of catalog) {
    index.set(typeCatalogKey(entry.schemaName, entry.typeName), entry);
    index.set(entry.typeName, entry);

    for (const alias of entry.aliases ?? []) {
      index.set(alias, entry);
      index.set(typeCatalogKey(entry.schemaName, alias), entry);
    }
  }

  return index;
}

function parseTypeDescriptor(value) {
  if (typeof value === 'string') {
    const normalized = value.trim();
    const arrayDimensions = (normalized.match(/\[\]/g) ?? []).length;
    const withoutArrays = normalized.replace(/\[\]/g, '');
    const lengthMatch = withoutArrays.match(/^([^()]+)\(([^)]+)\)$/);
    const baseName = lengthMatch ? lengthMatch[1] : withoutArrays;
    const precision = lengthMatch ? lengthMatch[2] : undefined;
    const { schemaName, typeName } = splitQualifiedTypeName(baseName);

    return compactDefined({
      schemaName,
      typeName,
      fullName: normalized.toLowerCase(),
      arrayDimensions,
      precision
    });
  }

  if (value && typeof value === 'object') {
    const normalizedTypeName = normalizeTypeName(value.typeName ?? value.name ?? value.fullName);
    const splitType = splitQualifiedTypeName(normalizedTypeName);
    const schemaName = normalizeTypeName(value.schemaName ?? splitType.schemaName ?? 'pg_catalog');
    const precision = value.precision ?? value.length;

    return compactDefined({
      schemaName,
      typeName: splitType.typeName,
      fullName: value.fullName ? normalizeTypeName(value.fullName) : undefined,
      arrayDimensions: Number(value.arrayDimensions ?? 0),
      precision: precision !== undefined ? String(precision) : undefined,
      category: value.category,
      kind: value.kind,
      typeClass: value.typeClass
    });
  }

  return {};
}

function resolveCatalogEntry(typeDescriptor, catalog = []) {
  const descriptor = parseTypeDescriptor(typeDescriptor);
  const typeCatalog = catalog.length > 0 ? catalog : buildAllowedPostgresTypeCatalog();
  const index = buildTypeCatalogIndex(typeCatalog);
  const key = typeCatalogKey(descriptor.schemaName, `${descriptor.typeName}${descriptor.arrayDimensions > 0 ? '[]'.repeat(descriptor.arrayDimensions) : ''}`);

  return index.get(key) ?? index.get(descriptor.fullName) ?? index.get(descriptor.typeName);
}

function normalizeDataType(typeDescriptor, catalog = []) {
  const descriptor = parseTypeDescriptor(typeDescriptor);
  const typeCatalog = catalog.length > 0 ? catalog : buildAllowedPostgresTypeCatalog();
  const catalogEntry = resolveCatalogEntry(descriptor, typeCatalog);
  const schemaName = descriptor.schemaName ?? catalogEntry?.schemaName ?? 'pg_catalog';
  const typeName = descriptor.typeName ?? catalogEntry?.typeName;
  const arrayDimensions = descriptor.arrayDimensions ?? catalogEntry?.arrayDimensions ?? 0;
  const precision = descriptor.precision;
  const baseDisplayName = schemaName === 'pg_catalog' ? typeName : `${schemaName}.${typeName}`;
  const renderedBaseType = precision ? `${baseDisplayName}(${precision})` : baseDisplayName;
  const renderedType = `${renderedBaseType}${'[]'.repeat(arrayDimensions)}`;

  return compactDefined({
    schemaName,
    typeName,
    fullName: renderedType,
    displayName: renderedType,
    arrayDimensions,
    precision,
    category: catalogEntry?.category,
    kind: arrayDimensions > 0 ? 'array' : catalogEntry?.kind ?? 'scalar',
    typeClass: catalogEntry?.typeClass ?? 'base',
    extensionName: catalogEntry?.extensionName,
    enumLabels: catalogEntry?.enumLabels,
    available: catalogEntry?.available !== false
  });
}

function isSafeDefaultExpression(expression = '') {
  const normalized = String(expression).trim();

  if (!normalized) return false;
  if (SAFE_LITERAL_PATTERN.test(normalized)) return true;
  if (SAFE_DEFAULT_FUNCTIONS.has(normalized.toLowerCase())) return true;
  if (/^'.*'::[a-z0-9_.\[\]]+(?:\([^)]*\))?$/i.test(normalized)) return true;
  return false;
}

function isSafeGeneratedExpression(expression = '') {
  const normalized = String(expression).trim();
  if (!normalized) return false;
  if (normalized.includes(';') || normalized.includes('--') || normalized.includes('/*')) return false;
  return SAFE_GENERATED_EXPRESSION_PATTERN.test(normalized);
}

function isSafeCheckExpression(expression = '') {
  const normalized = String(expression).trim();
  if (!normalized) return false;
  if (normalized.includes(';') || normalized.includes('--') || normalized.includes('/*')) return false;
  return SAFE_CHECK_EXPRESSION_PATTERN.test(normalized);
}

function isSafeIndexExpression(expression = '') {
  const normalized = String(expression).trim();
  if (!normalized) return false;
  if (normalized.includes(';') || normalized.includes('--') || normalized.includes('/*')) return false;
  return SAFE_INDEX_EXPRESSION_PATTERN.test(normalized);
}

function isSafeReadOnlyQuery(query = '') {
  const normalized = String(query ?? '').trim();

  if (!normalized || !SAFE_QUERY_PATTERN.test(normalized)) {
    return false;
  }

  if (!/^(select|with)\b/i.test(normalized)) {
    return false;
  }

  return !FORBIDDEN_QUERY_TOKENS.some((pattern) => pattern.test(normalized));
}

function isSafeRoutineBody(body = '', routineKind = 'function', language = 'sql') {
  const normalized = String(body ?? '').trim();

  if (!normalized || !SAFE_ROUTINE_BODY_PATTERN.test(normalized)) {
    return false;
  }

  if (FORBIDDEN_ROUTINE_TOKENS.some((pattern) => pattern.test(normalized))) {
    return false;
  }

  if (language === 'sql' && routineKind === 'function' && !/^(select|with)\b/i.test(normalized)) {
    return false;
  }

  return true;
}

function renderQualifiedName(schemaName, objectName) {
  return `${quoteIdent(schemaName)}.${quoteIdent(objectName)}`;
}

function renderDataType(typeDescriptor, catalog = []) {
  const normalized = normalizeDataType(typeDescriptor, catalog);
  const schemaPrefix = normalized.schemaName && normalized.schemaName !== 'pg_catalog' ? `${quoteIdent(normalized.schemaName)}.` : '';
  const baseType = normalized.precision
    ? `${schemaPrefix}${normalizeIdentifier(normalized.typeName)}(${normalized.precision})`
    : `${schemaPrefix}${normalizeIdentifier(normalized.typeName)}`;

  return `${baseType}${'[]'.repeat(normalized.arrayDimensions ?? 0)}`;
}

function normalizeIdentity(identity = {}) {
  if (!identity || typeof identity !== 'object') return undefined;

  const normalized = compactDefined({
    generation: identity.generation === 'always' ? 'always' : identity.generation === 'by_default' ? 'by_default' : undefined,
    startWith: identity.startWith,
    incrementBy: identity.incrementBy
  });

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeConstraints(constraints = {}) {
  if (!constraints || typeof constraints !== 'object') return {};

  const normalized = compactDefined({
    primaryKey: constraints.primaryKey === true,
    unique: constraints.unique === true,
    checkExpression: constraints.checkExpression ? String(constraints.checkExpression).trim() : undefined
  });

  return Object.keys(normalized).length > 0 ? normalized : {};
}

function normalizeColumnSpec(column = {}, catalog = []) {
  const dataType = normalizeDataType(column.dataType ?? column.type ?? column.typeName, catalog);
  const constraints = normalizeConstraints(column.constraints);
  const identity = normalizeIdentity(column.identity);
  const generated = column.generatedExpression || column.generated?.expression
    ? {
        kind: 'stored',
        expression: String(column.generatedExpression ?? column.generated?.expression).trim()
      }
    : undefined;

  return compactDefined({
    columnName: normalizeIdentifier(column.columnName ?? column.name),
    dataType,
    nullable: column.nullable !== false,
    defaultExpression: column.defaultExpression ? String(column.defaultExpression).trim() : undefined,
    identity,
    generated,
    comment: column.comment ? String(column.comment) : undefined,
    constraints
  });
}

function normalizeDependencyRef(entry = {}, defaults = {}) {
  if (typeof entry === 'string') {
    return { reference: entry };
  }

  if (!entry || typeof entry !== 'object') return undefined;

  return compactDefined({
    resourceKind: entry.resourceKind ?? entry.kind ?? defaults.resourceKind,
    databaseName: safeIdentifier(entry.databaseName ?? defaults.databaseName),
    schemaName: safeIdentifier(entry.schemaName ?? defaults.schemaName),
    tableName: safeIdentifier(entry.tableName ?? defaults.tableName),
    columnName: safeIdentifier(entry.columnName ?? defaults.columnName),
    viewName: safeIdentifier(entry.viewName ?? defaults.viewName),
    materializedViewName: safeIdentifier(entry.materializedViewName ?? defaults.materializedViewName),
    indexName: safeIdentifier(entry.indexName ?? defaults.indexName),
    routineName: safeIdentifier(entry.routineName ?? defaults.routineName),
    constraintName: safeIdentifier(entry.constraintName ?? defaults.constraintName),
    relationName: safeIdentifier(entry.relationName ?? defaults.relationName),
    direction: entry.direction,
    reason: entry.reason,
    reference: entry.reference
  });
}

function normalizeDependencySets(value = {}) {
  if (!value || typeof value !== 'object') return undefined;

  const normalized = compactDefined({
    readsFrom: (value.readsFrom ?? []).map((entry) => normalizeDependencyRef(entry)).filter(Boolean),
    writesTo: (value.writesTo ?? []).map((entry) => normalizeDependencyRef(entry)).filter(Boolean),
    dependsOn: (value.dependsOn ?? []).map((entry) => normalizeDependencyRef(entry)).filter(Boolean)
  });

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function relationRef(databaseName, schemaName, relationName, resourceKind = 'table') {
  return normalizeDependencyRef({ resourceKind, databaseName, schemaName, relationName });
}

function parseQueryDependencies(query = '', defaults = {}) {
  const refs = [];
  const normalized = String(query ?? '');
  const regex = /(?:from|join)\s+((?:"?[a-z0-9_]+"?\.)?(?:"?[a-z0-9_]+"?))/gi;
  let match;

  while ((match = regex.exec(normalized)) !== null) {
    const relation = match[1]
      .replace(/"/g, '')
      .trim()
      .toLowerCase();
    const parts = relation.split('.').filter(Boolean);
    const schemaName = parts.length >= 2 ? normalizeIdentifier(parts.at(-2)) : safeIdentifier(defaults.schemaName);
    const relationName = normalizeIdentifier(parts.at(-1));
    refs.push(relationRef(safeIdentifier(defaults.databaseName), schemaName, relationName, 'relation'));
  }

  return refs;
}

function assessTypeChangeCompatibility(currentType, nextType) {
  const current = parseTypeDescriptor(currentType?.fullName ?? currentType);
  const next = parseTypeDescriptor(nextType?.fullName ?? nextType);

  const currentKey = `${current.schemaName ?? 'pg_catalog'}.${current.typeName}${'[]'.repeat(current.arrayDimensions ?? 0)}`;
  const nextKey = `${next.schemaName ?? 'pg_catalog'}.${next.typeName}${'[]'.repeat(next.arrayDimensions ?? 0)}`;

  if (currentKey === nextKey) {
    if (!current.precision || !next.precision) {
      return { compatible: true };
    }

    const currentPrecisionValues = current.precision.split(',').map((entry) => Number(entry.trim()));
    const nextPrecisionValues = next.precision.split(',').map((entry) => Number(entry.trim()));
    if (nextPrecisionValues.every((value, index) => value >= (currentPrecisionValues[index] ?? 0))) {
      return { compatible: true };
    }

    return {
      compatible: false,
      reason: `Changing ${current.fullName ?? current.typeName} to a narrower precision ${next.fullName ?? next.typeName} can rewrite or truncate existing data.`
    };
  }

  const safePairs = new Set(['pg_catalog.integer->pg_catalog.bigint', 'pg_catalog.smallint->pg_catalog.integer', 'pg_catalog.smallint->pg_catalog.bigint']);
  const pair = `${current.schemaName ?? 'pg_catalog'}.${current.typeName}->${next.schemaName ?? 'pg_catalog'}.${next.typeName}`;

  if (safePairs.has(pair) && (current.arrayDimensions ?? 0) === (next.arrayDimensions ?? 0)) {
    return { compatible: true };
  }

  return {
    compatible: false,
    reason: `Changing column type from ${current.fullName ?? current.typeName} to ${next.fullName ?? next.typeName} is not considered safely compatible.`
  };
}

function tableQuotaUsage(context = {}) {
  return Number(context.currentInventory?.counts?.tables ?? context.currentInventory?.tables?.length ?? context.currentSchema?.tableCount ?? 0);
}

function columnQuotaUsage(context = {}) {
  return Number(context.currentTable?.columnCount ?? context.currentInventory?.counts?.columns ?? context.currentInventory?.columns?.length ?? 0);
}

function constraintQuotaUsage(context = {}) {
  return Number(context.currentTable?.constraintCount ?? context.currentInventory?.counts?.constraints ?? context.currentInventory?.constraints?.length ?? 0);
}

function indexQuotaUsage(context = {}) {
  return Number(context.currentTable?.indexCount ?? context.currentInventory?.counts?.indexes ?? context.currentInventory?.indexes?.length ?? 0);
}

function viewQuotaUsage(context = {}) {
  return Number(context.currentSchema?.viewCount ?? context.currentInventory?.counts?.views ?? context.currentInventory?.views?.length ?? 0);
}

function materializedViewQuotaUsage(context = {}) {
  return Number(
    context.currentSchema?.materializedViewCount ??
      context.currentInventory?.counts?.materializedViews ??
      context.currentInventory?.materializedViews?.length ??
      0
  );
}

function routineQuotaUsage(context = {}, kind = 'functions') {
  return Number(context.currentSchema?.[`${kind}Count`] ?? context.currentInventory?.counts?.[kind] ?? context.currentInventory?.[kind]?.length ?? 0);
}

function toRelationKey(databaseName, schemaName, relationName) {
  return [databaseName, schemaName, relationName].filter(Boolean).map((value) => normalizeIdentifier(value)).join('.');
}

function toColumnKey(databaseName, schemaName, tableName, columnName) {
  return [databaseName, schemaName, tableName, columnName].filter(Boolean).map((value) => normalizeIdentifier(value)).join('.');
}

function listDependencyRecords(values = []) {
  return (values ?? []).map((entry) => normalizeDependencyRef(entry)).filter(Boolean);
}

function lookupDependencyBucket(source = {}, key) {
  if (!source || typeof source !== 'object' || !key) return [];
  const value = source[key];
  if (!Array.isArray(value)) return [];
  return listDependencyRecords(value);
}

function getTableDependencies(context = {}, databaseName, schemaName, tableName) {
  const key = toRelationKey(databaseName, schemaName, tableName);
  return [
    ...listDependencyRecords(context.currentTable?.dependentViews),
    ...listDependencyRecords(context.currentTable?.dependentMaterializedViews),
    ...listDependencyRecords(context.currentTable?.dependentIndexes),
    ...listDependencyRecords(context.currentTable?.dependentConstraints),
    ...lookupDependencyBucket(context.dependencyGraph?.tables, key)
  ];
}

function getColumnDependencies(context = {}, databaseName, schemaName, tableName, columnName) {
  const key = toColumnKey(databaseName, schemaName, tableName, columnName);
  return [
    ...listDependencyRecords(context.currentColumn?.dependentViews),
    ...listDependencyRecords(context.currentColumn?.dependentMaterializedViews),
    ...listDependencyRecords(context.currentColumn?.dependentIndexes),
    ...listDependencyRecords(context.currentColumn?.dependentConstraints),
    ...lookupDependencyBucket(context.dependencyGraph?.columns, key)
  ];
}

function getViewDependencies(context = {}, databaseName, schemaName, viewName) {
  const key = toRelationKey(databaseName, schemaName, viewName);
  return [
    ...listDependencyRecords(context.currentView?.dependentViews),
    ...listDependencyRecords(context.currentView?.dependentMaterializedViews),
    ...lookupDependencyBucket(context.dependencyGraph?.views, key)
  ];
}

function getIndexDependencies(context = {}, databaseName, schemaName, indexName) {
  const key = toRelationKey(databaseName, schemaName, indexName);
  return [
    ...listDependencyRecords(context.currentIndex?.dependentConstraints),
    ...lookupDependencyBucket(context.dependencyGraph?.indexes, key)
  ];
}

function formatDependency(entry = {}) {
  return (
    entry.reference ||
    [entry.databaseName, entry.schemaName, entry.tableName ?? entry.viewName ?? entry.materializedViewName ?? entry.indexName ?? entry.relationName ?? entry.routineName]
      .filter(Boolean)
      .join('.') ||
    'unknown_dependency'
  );
}

function collectDependencyViolations(resourceLabel, action, dependencies = [], options = {}) {
  const normalized = dependencies.filter(Boolean);
  if (normalized.length === 0) return [];
  if (options.allowDependentChange === true) return [];

  return [
    `${resourceLabel} cannot ${action === 'delete' ? 'be deleted' : 'change'} while dependent objects still reference it: ${normalized
      .map((entry) => formatDependency(entry))
      .join(', ')}.`
  ];
}

function validateColumnRules(column, context = {}, { onTableCreate = false, action = 'create' } = {}) {
  const violations = [];
  const catalog = context.allowedTypeCatalog?.length ? context.allowedTypeCatalog : buildAllowedPostgresTypeCatalog(context.clusterFeatures);
  const normalized = normalizeColumnSpec(column, catalog);
  const currentColumn = context.currentColumn ?? context.currentResource;

  if (!normalized.columnName && action !== 'list') {
    violations.push('Columns must declare columnName.');
  }

  if (normalized.columnName && (!IDENTIFIER_PATTERN.test(normalized.columnName) || RESERVED_PREFIX_PATTERN.test(normalized.columnName))) {
    violations.push(`Column ${normalized.columnName} must use a safe, non-system identifier.`);
  }

  if (!normalized.dataType?.typeName && action !== 'list' && action !== 'delete') {
    violations.push('Columns must declare a supported dataType.');
  }

  if (normalized.dataType?.typeName && !resolveCatalogEntry(normalized.dataType, catalog)) {
    violations.push(`Column type ${normalized.dataType.fullName ?? normalized.dataType.typeName} is not present in the allowed type catalog for this cluster.`);
  }

  if (normalized.identity && normalized.generated) {
    violations.push('Columns cannot combine identity and generated expressions.');
  }

  if (normalized.identity && normalized.defaultExpression) {
    violations.push('Columns cannot define both identity and defaultExpression.');
  }

  if (normalized.generated && !isSafeGeneratedExpression(normalized.generated.expression)) {
    violations.push('Generated column expressions must stay within the safe expression subset.');
  }

  if (normalized.defaultExpression && !isSafeDefaultExpression(normalized.defaultExpression)) {
    violations.push('defaultExpression must be a safe literal, casted literal, or approved built-in function call.');
  }

  if (normalized.constraints?.checkExpression && !isSafeCheckExpression(normalized.constraints.checkExpression)) {
    violations.push('Column check expressions must stay within the safe expression subset.');
  }

  if ((normalized.constraints?.primaryKey || currentColumn?.constraints?.primaryKey) && normalized.nullable !== false && action !== 'delete') {
    violations.push('Primary key columns cannot be nullable.');
  }

  if (action === 'update' && currentColumn) {
    const compatibility = assessTypeChangeCompatibility(currentColumn.dataType, normalized.dataType);
    if (!compatibility.compatible) {
      violations.push(compatibility.reason);
    }

    if (currentColumn.generated && normalized.generated && currentColumn.generated.expression !== normalized.generated.expression) {
      violations.push('Changing an existing generated column expression is treated as incompatible and requires an explicit rebuild.');
    }

    if (currentColumn.identity && normalized.identity && currentColumn.identity.generation !== normalized.identity.generation) {
      violations.push('Changing identity generation mode is not allowed through the safe bounded contract.');
    }

    if (currentColumn.nullable === true && normalized.nullable === false && Number(context.currentTable?.nullValueCountByColumn?.[normalized.columnName] ?? 0) > 0) {
      violations.push(`Column ${normalized.columnName} cannot be made NOT NULL while null values still exist.`);
    }
  }

  if (action === 'delete' && (currentColumn?.constraints?.primaryKey || currentColumn?.constraints?.unique === true) && context.allowConstraintDrops !== true) {
    violations.push(`Column ${currentColumn.columnName ?? normalized.columnName} participates in key constraints and cannot be dropped without explicit override.`);
  }

  const databaseName = normalizeIdentifier(column.databaseName ?? context.databaseName);
  const schemaName = normalizeIdentifier(column.schemaName ?? context.schemaName);
  const tableName = normalizeIdentifier(column.tableName ?? context.tableName);
  if ((action === 'update' || action === 'delete') && normalized.columnName) {
    violations.push(
      ...collectDependencyViolations(
        `Column ${normalized.columnName}`,
        action,
        getColumnDependencies(context, databaseName, schemaName, tableName, normalized.columnName),
        context
      )
    );
  }

  if (onTableCreate && !normalized.columnName) {
    violations.push('Table column definitions require columnName.');
  }

  return {
    normalized,
    violations
  };
}

function normalizeConstraintSpec(payload = {}) {
  const constraintType = payload.constraintType ?? payload.type;
  const columns = normalizeIdentifierList(payload.columns ?? payload.columnNames ?? []);
  const referencedColumns = normalizeIdentifierList(payload.referencedColumns ?? []);
  const columnName = normalizeIdentifier(payload.columnName);

  return compactDefined({
    databaseName: safeIdentifier(payload.databaseName),
    schemaName: safeIdentifier(payload.schemaName),
    tableName: safeIdentifier(payload.tableName),
    constraintName:
      safeIdentifier(payload.constraintName ?? payload.name) ??
      (constraintType === 'not_null' && columnName ? normalizeIdentifier(`${payload.tableName ?? 'table'}_${columnName}_not_null`) : undefined),
    constraintType,
    columnName,
    columns: columns.length > 0 ? columns : undefined,
    referencedDatabaseName: safeIdentifier(payload.referencedDatabaseName ?? payload.databaseName),
    referencedSchemaName: safeIdentifier(payload.referencedSchemaName ?? payload.schemaName),
    referencedTableName: safeIdentifier(payload.referencedTableName),
    referencedColumns: referencedColumns.length > 0 ? referencedColumns : undefined,
    matchType: payload.matchType,
    onUpdate: payload.onUpdate,
    onDelete: payload.onDelete,
    deferrable: payload.deferrable === true,
    initiallyDeferred: payload.initiallyDeferred === true,
    notValid: payload.notValid === true,
    checkExpression: payload.checkExpression ? String(payload.checkExpression).trim() : undefined,
    comment: payload.comment ? String(payload.comment) : undefined,
    documentation: payload.documentation,
    metadata: payload.metadata,
    state: payload.state ?? 'active'
  });
}

function normalizeIndexKey(entry) {
  if (typeof entry === 'string') {
    return { columnName: normalizeIdentifier(entry), order: 'asc' };
  }

  if (!entry || typeof entry !== 'object') return undefined;

  return compactDefined({
    columnName: entry.columnName ? normalizeIdentifier(entry.columnName) : undefined,
    expression: entry.expression ? String(entry.expression).trim() : undefined,
    order: entry.order === 'desc' ? 'desc' : 'asc',
    nulls: entry.nulls === 'first' ? 'first' : entry.nulls === 'last' ? 'last' : undefined,
    operatorClass: entry.operatorClass ? normalizeIdentifier(entry.operatorClass) : undefined
  });
}

function normalizeIndexSpec(payload = {}) {
  const keys = (payload.keys ?? payload.columns ?? payload.expressions ?? []).map((entry) => normalizeIndexKey(entry)).filter(Boolean);
  const includeColumns = normalizeIdentifierList(payload.includeColumns ?? []);

  return compactDefined({
    databaseName: safeIdentifier(payload.databaseName),
    schemaName: safeIdentifier(payload.schemaName),
    tableName: safeIdentifier(payload.tableName),
    indexName: safeIdentifier(payload.indexName ?? payload.name),
    indexMethod: normalizeTypeName(payload.indexMethod ?? payload.method ?? 'btree'),
    unique: payload.unique === true,
    keys,
    includeColumns: includeColumns.length > 0 ? includeColumns : undefined,
    predicateExpression: payload.predicateExpression ?? payload.where ? String(payload.predicateExpression ?? payload.where).trim() : undefined,
    comment: payload.comment ? String(payload.comment) : undefined,
    concurrently: payload.concurrently === true,
    documentation: payload.documentation,
    metadata: payload.metadata,
    state: payload.state ?? 'active',
    dependencySummary: normalizeDependencySets(payload.dependencies)
  });
}

function normalizeViewSpec(payload = {}, kind = 'view') {
  const viewName = normalizeIdentifier(payload.viewName ?? payload.name);
  const dependencies = normalizeDependencySets(payload.dependencies) ?? {
    readsFrom: parseQueryDependencies(payload.query ?? payload.definition ?? '', {
      databaseName: payload.databaseName,
      schemaName: payload.schemaName
    })
  };

  return compactDefined({
    databaseName: safeIdentifier(payload.databaseName),
    schemaName: safeIdentifier(payload.schemaName),
    viewName,
    materializedViewName: kind === 'materialized_view' ? viewName : undefined,
    query: payload.query ?? payload.definition ? String(payload.query ?? payload.definition).trim() : undefined,
    columns: normalizeIdentifierList(payload.columns ?? []),
    comment: payload.comment ? String(payload.comment) : undefined,
    checkOption: payload.checkOption,
    securityBarrier: payload.securityBarrier === true,
    withData: kind === 'materialized_view' ? payload.withData !== false : undefined,
    refreshPolicy: kind === 'materialized_view' ? payload.refreshPolicy : undefined,
    indexes:
      kind === 'materialized_view'
        ? (payload.indexes ?? [])
            .map((entry) =>
              normalizeIndexSpec({
                ...entry,
                databaseName: payload.databaseName,
                schemaName: payload.schemaName,
                tableName: viewName
              })
            )
            .filter(Boolean)
        : undefined,
    documentation: payload.documentation,
    metadata: payload.metadata,
    dependencySummary: dependencies,
    state: payload.state ?? 'active'
  });
}

function normalizeRoutineArgument(argument = {}, catalog = []) {
  const dataType = normalizeDataType(argument.dataType ?? argument.type ?? argument.typeName, catalog);
  return compactDefined({
    name: normalizeIdentifier(argument.name),
    mode: argument.mode === 'out' ? 'out' : argument.mode === 'inout' ? 'inout' : 'in',
    dataType,
    defaultExpression: argument.defaultExpression ? String(argument.defaultExpression).trim() : undefined,
    description: argument.description ? String(argument.description) : undefined
  });
}

function normalizeRoutineSpec(payload = {}, catalog = []) {
  const routineName = normalizeIdentifier(payload.routineName ?? payload.name);
  const routineKind = payload.routineKind ?? payload.kind;
  const argumentsList = (payload.arguments ?? []).map((entry) => normalizeRoutineArgument(entry, catalog));
  const dependencies = normalizeDependencySets(payload.dependencies) ?? {
    readsFrom: parseQueryDependencies(payload.body ?? payload.definition ?? '', {
      databaseName: payload.databaseName,
      schemaName: payload.schemaName
    })
  };

  return compactDefined({
    databaseName: safeIdentifier(payload.databaseName),
    schemaName: safeIdentifier(payload.schemaName),
    routineName,
    routineKind,
    language: normalizeTypeName(payload.language ?? 'sql'),
    volatility: normalizeTypeName(payload.volatility ?? 'volatile'),
    securityMode: payload.securityMode === 'definer' ? 'definer' : 'invoker',
    arguments: argumentsList,
    returnsType: routineKind === 'function' ? normalizeDataType(payload.returnsType ?? payload.returnType, catalog) : undefined,
    body: payload.body ?? payload.definition ? String(payload.body ?? payload.definition).trim() : undefined,
    comment: payload.comment ? String(payload.comment) : undefined,
    documentation: payload.documentation,
    metadata: payload.metadata,
    exposedToTenantRuntime: payload.exposedToTenantRuntime !== false,
    dependencySummary: dependencies,
    state: payload.state ?? 'active'
  });
}

function validateRoutineArgument(argument, catalog, violations) {
  if (!argument.name) {
    violations.push('Routine arguments must declare name.');
  }

  if (argument.name && (!IDENTIFIER_PATTERN.test(argument.name) || RESERVED_PREFIX_PATTERN.test(argument.name))) {
    violations.push(`Routine argument ${argument.name} must use a safe, non-system identifier.`);
  }

  if (!argument.dataType?.typeName || !resolveCatalogEntry(argument.dataType, catalog)) {
    violations.push(`Routine argument ${argument.name ?? 'unnamed'} must use a supported allowed type.`);
  }

  if (argument.defaultExpression && !isSafeDefaultExpression(argument.defaultExpression)) {
    violations.push(`Routine argument ${argument.name ?? 'unnamed'} must use a safe default expression.`);
  }
}

function validateConstraintRequest(payload, context = {}, profile = {}) {
  const violations = [];
  const normalized = normalizeConstraintSpec({
    ...payload,
    databaseName: payload.databaseName ?? context.databaseName,
    schemaName: payload.schemaName ?? context.schemaName,
    tableName: payload.tableName ?? context.tableName
  });
  const currentConstraint = context.currentConstraint ?? {};

  if (!normalized.databaseName) violations.push('Constraints must declare databaseName.');
  if (!normalized.schemaName) violations.push('Constraints must declare schemaName.');
  if (!normalized.tableName) violations.push('Constraints must declare tableName.');
  if (!POSTGRES_CONSTRAINT_TYPES.includes(normalized.constraintType)) {
    violations.push(`Unsupported PostgreSQL constraint type ${String(normalized.constraintType)}.`);
  }

  if (normalized.constraintName && (!IDENTIFIER_PATTERN.test(normalized.constraintName) || RESERVED_PREFIX_PATTERN.test(normalized.constraintName))) {
    violations.push(`Constraint ${normalized.constraintName} must use a safe, non-system identifier.`);
  }

  if (normalized.constraintType === 'primary_key' || normalized.constraintType === 'unique') {
    if ((normalized.columns ?? []).length === 0) {
      violations.push(`${normalized.constraintType} constraints must declare one or more columns.`);
    }
  }

  if (normalized.constraintType === 'foreign_key') {
    if ((normalized.columns ?? []).length === 0) {
      violations.push('Foreign keys must declare local columns.');
    }
    if (!normalized.referencedTableName) {
      violations.push('Foreign keys must declare referencedTableName.');
    }
    if ((normalized.referencedColumns ?? []).length === 0) {
      violations.push('Foreign keys must declare referencedColumns.');
    }
    if ((normalized.columns ?? []).length !== (normalized.referencedColumns ?? []).length) {
      violations.push('Foreign key local and referenced column counts must match.');
    }
    if (
      normalized.referencedDatabaseName &&
      normalized.databaseName &&
      normalized.referencedDatabaseName !== normalized.databaseName &&
      context.allowCrossDatabaseReferences !== true
    ) {
      violations.push('Foreign keys must remain inside the managed tenant database boundary.');
    }
  }

  if (normalized.constraintType === 'check') {
    if (!normalized.checkExpression) {
      violations.push('Check constraints must declare checkExpression.');
    } else if (!isSafeCheckExpression(normalized.checkExpression)) {
      violations.push('Check constraint expressions must stay within the safe expression subset.');
    }
  }

  if (normalized.constraintType === 'not_null') {
    if (!normalized.columnName) {
      violations.push('NOT NULL constraints must target one columnName.');
    }
    if (Number(context.currentTable?.nullValueCountByColumn?.[normalized.columnName] ?? 0) > 0) {
      violations.push(`Column ${normalized.columnName} cannot be made NOT NULL while null values still exist.`);
    }
  }

  const knownColumns = new Set((context.currentTable?.columns ?? []).map((column) => normalizeIdentifier(column.columnName ?? column.name)).filter(Boolean));
  for (const columnName of normalized.columns ?? []) {
    if (knownColumns.size > 0 && !knownColumns.has(columnName)) {
      violations.push(`Constraint column ${columnName} is not present in the current table definition.`);
    }
  }
  if (normalized.columnName && knownColumns.size > 0 && !knownColumns.has(normalized.columnName)) {
    violations.push(`Constraint column ${normalized.columnName} is not present in the current table definition.`);
  }

  const constraintQuota = profile.quotaGuardrails?.constraints;
  if (context.action === 'create' && constraintQuota && constraintQuotaUsage(context) >= constraintQuota.limit) {
    violations.push(`Quota ${constraintQuota.metricKey} would be exceeded by creating another constraint.`);
  }

  if ((context.action === 'update' || context.action === 'delete') && currentConstraint.backingIndexName && context.allowConstraintDrops !== true) {
    violations.push(`Constraint ${currentConstraint.constraintName ?? normalized.constraintName} is backed by index ${currentConstraint.backingIndexName} and cannot be changed without explicit override.`);
  }

  return { normalized, violations };
}

function validateIndexRequest(payload, context = {}, profile = {}) {
  const violations = [];
  const normalized = normalizeIndexSpec({
    ...payload,
    databaseName: payload.databaseName ?? context.databaseName,
    schemaName: payload.schemaName ?? context.schemaName,
    tableName: payload.tableName ?? context.tableName
  });
  const currentIndex = context.currentIndex ?? {};
  const currentColumns = new Set((context.currentTable?.columns ?? []).map((column) => normalizeIdentifier(column.columnName ?? column.name)).filter(Boolean));

  if (!normalized.databaseName) violations.push('Indexes must declare databaseName.');
  if (!normalized.schemaName) violations.push('Indexes must declare schemaName.');
  if (!normalized.tableName) violations.push('Indexes must declare tableName.');
  if (!normalized.indexName && context.action !== 'list') violations.push('Indexes must declare indexName.');
  if (!POSTGRES_INDEX_METHODS.includes(normalized.indexMethod)) {
    violations.push(`Unsupported PostgreSQL index method ${String(normalized.indexMethod)}.`);
  }
  if ((normalized.keys ?? []).length === 0 && context.action !== 'list' && context.action !== 'delete') {
    violations.push('Indexes must declare at least one key column or safe expression.');
  }
  if (normalized.concurrently) {
    violations.push('CREATE INDEX CONCURRENTLY is not exposed through the transactional bounded admin surface.');
  }
  if (normalized.unique && normalized.indexMethod !== 'btree') {
    violations.push('Unique indexes are only exposed for the safe btree method through this bounded surface.');
  }
  if (normalized.indexName && (!IDENTIFIER_PATTERN.test(normalized.indexName) || RESERVED_PREFIX_PATTERN.test(normalized.indexName))) {
    violations.push(`Index ${normalized.indexName} must use a safe, non-system identifier.`);
  }

  for (const key of normalized.keys ?? []) {
    if (!key.columnName && !key.expression) {
      violations.push('Index keys must declare columnName or expression.');
    }
    if (key.columnName && currentColumns.size > 0 && !currentColumns.has(key.columnName)) {
      violations.push(`Index column ${key.columnName} is not present in the current table definition.`);
    }
    if (key.expression && !isSafeIndexExpression(key.expression)) {
      violations.push('Index expressions must stay within the safe bounded expression subset.');
    }
  }

  if ((normalized.includeColumns ?? []).some((columnName) => currentColumns.size > 0 && !currentColumns.has(columnName))) {
    violations.push('Included index columns must exist on the managed relation.');
  }

  if (normalized.predicateExpression && !isSafeCheckExpression(normalized.predicateExpression)) {
    violations.push('Partial index predicates must stay within the safe bounded expression subset.');
  }

  const indexQuota = profile.quotaGuardrails?.indexes;
  if (context.action === 'create' && indexQuota && indexQuotaUsage(context) >= indexQuota.limit) {
    violations.push(`Quota ${indexQuota.metricKey} would be exceeded by creating another index.`);
  }

  if ((context.action === 'update' || context.action === 'delete') && (currentIndex.backingConstraintName || currentIndex.isBackingConstraint === true)) {
    violations.push(
      `Index ${currentIndex.indexName ?? normalized.indexName} is managed by constraint ${currentIndex.backingConstraintName ?? 'system'} and cannot be changed through the standalone index surface.`
    );
  }

  if (normalized.indexName) {
    violations.push(
      ...collectDependencyViolations(
        `Index ${normalized.indexName}`,
        context.action,
        getIndexDependencies(context, normalized.databaseName, normalized.schemaName, normalized.indexName),
        context
      )
    );
  }

  return { normalized, violations };
}

function validateViewRequest(payload, context = {}, profile = {}, kind = 'view') {
  const violations = [];
  const normalized = normalizeViewSpec(
    {
      ...payload,
      databaseName: payload.databaseName ?? context.databaseName,
      schemaName: payload.schemaName ?? context.schemaName,
      viewName: payload.viewName ?? context.viewName ?? payload.materializedViewName ?? context.materializedViewName
    },
    kind
  );
  const viewName = normalized.viewName ?? normalized.materializedViewName;
  const currentView = kind === 'materialized_view' ? context.currentMaterializedView ?? context.currentView ?? {} : context.currentView ?? {};

  if (!normalized.databaseName) violations.push(`${kind === 'materialized_view' ? 'Materialized views' : 'Views'} must declare databaseName.`);
  if (!normalized.schemaName) violations.push(`${kind === 'materialized_view' ? 'Materialized views' : 'Views'} must declare schemaName.`);
  if (!viewName && context.action !== 'list') violations.push(`${kind === 'materialized_view' ? 'Materialized views' : 'Views'} must declare viewName.`);
  if (viewName && (!IDENTIFIER_PATTERN.test(viewName) || RESERVED_PREFIX_PATTERN.test(viewName))) {
    violations.push(`${kind === 'materialized_view' ? 'Materialized view' : 'View'} ${viewName} must use a safe, non-system identifier.`);
  }

  if ((context.action === 'create' || context.action === 'update') && !normalized.query) {
    violations.push(`${kind === 'materialized_view' ? 'Materialized views' : 'Views'} must declare a read-only query.`);
  }

  if (normalized.query && !isSafeReadOnlyQuery(normalized.query)) {
    violations.push(`${kind === 'materialized_view' ? 'Materialized view' : 'View'} queries must be read-only SELECT/WITH statements without unsafe tokens.`);
  }

  const availableRelations = new Set((context.availableRelations ?? []).map((entry) => toRelationKey(entry.databaseName, entry.schemaName, entry.relationName ?? entry.tableName ?? entry.viewName)));
  for (const dependency of [
    ...(normalized.dependencySummary?.readsFrom ?? []),
    ...(normalized.dependencySummary?.dependsOn ?? [])
  ]) {
    const relationName = dependency.relationName ?? dependency.tableName ?? dependency.viewName ?? dependency.materializedViewName;
    if (!relationName) continue;
    const key = toRelationKey(dependency.databaseName ?? normalized.databaseName, dependency.schemaName ?? normalized.schemaName, relationName);
    if (availableRelations.size > 0 && !availableRelations.has(key)) {
      violations.push(`${kind === 'materialized_view' ? 'Materialized view' : 'View'} dependency ${key} is not present in the available managed relation catalog.`);
    }
  }

  if (kind === 'materialized_view') {
    const quota = profile.quotaGuardrails?.materializedViews;
    if (context.action === 'create' && quota && materializedViewQuotaUsage(context) >= quota.limit) {
      violations.push(`Quota ${quota.metricKey} would be exceeded by creating another materialized view.`);
    }

    for (const index of normalized.indexes ?? []) {
      const indexValidation = validateIndexRequest(
        {
          ...index,
          databaseName: normalized.databaseName,
          schemaName: normalized.schemaName,
          tableName: viewName
        },
        {
          ...context,
          action: 'create',
          currentTable: context.currentMaterializedView ?? context.currentView ?? {}
        },
        profile
      );
      violations.push(...indexValidation.violations);
    }
  } else {
    const quota = profile.quotaGuardrails?.views;
    if (context.action === 'create' && quota && viewQuotaUsage(context) >= quota.limit) {
      violations.push(`Quota ${quota.metricKey} would be exceeded by creating another view.`);
    }
  }

  if ((context.action === 'update' || context.action === 'delete') && viewName) {
    violations.push(
      ...collectDependencyViolations(
        `${kind === 'materialized_view' ? 'Materialized view' : 'View'} ${viewName}`,
        context.action,
        getViewDependencies(context, normalized.databaseName, normalized.schemaName, viewName),
        context
      )
    );
  }

  if (currentView.refreshLagSeconds !== undefined && kind === 'materialized_view') {
    const limit = Number(context.materializedViewRefreshLagLimitSeconds ?? 3600);
    if (Number(currentView.refreshLagSeconds) > limit) {
      violations.push(`Materialized view ${viewName} exceeds the allowed refresh lag budget of ${limit} seconds.`);
    }
  }

  return { normalized, violations };
}

function validateRoutineRequest(payload, context = {}, profile = {}, routineKind = 'function') {
  const violations = [];
  const catalog = context.allowedTypeCatalog?.length ? context.allowedTypeCatalog : buildAllowedPostgresTypeCatalog(context.clusterFeatures);
  const normalized = normalizeRoutineSpec(
    {
      ...payload,
      databaseName: payload.databaseName ?? context.databaseName,
      schemaName: payload.schemaName ?? context.schemaName,
      routineName: payload.routineName ?? context.routineName,
      routineKind
    },
    catalog
  );

  if (!normalized.databaseName) violations.push(`${routineKind === 'function' ? 'Functions' : 'Procedures'} must declare databaseName.`);
  if (!normalized.schemaName) violations.push(`${routineKind === 'function' ? 'Functions' : 'Procedures'} must declare schemaName.`);
  if (!normalized.routineName && context.action !== 'list') violations.push(`${routineKind === 'function' ? 'Functions' : 'Procedures'} must declare routineName.`);
  if (normalized.routineName && (!IDENTIFIER_PATTERN.test(normalized.routineName) || RESERVED_PREFIX_PATTERN.test(normalized.routineName))) {
    violations.push(`${routineKind === 'function' ? 'Function' : 'Procedure'} ${normalized.routineName} must use a safe, non-system identifier.`);
  }
  if (!POSTGRES_ROUTINE_LANGUAGES.includes(normalized.language)) {
    violations.push(`Unsupported routine language ${String(normalized.language)}.`);
  }
  if (routineKind === 'function' && !POSTGRES_ROUTINE_VOLATILITIES.includes(normalized.volatility)) {
    violations.push(`Unsupported function volatility ${String(normalized.volatility)}.`);
  }
  if (normalized.securityMode !== 'invoker') {
    violations.push('Tenant-exposed routines must use SECURITY INVOKER.');
  }
  if ((context.action === 'create' || context.action === 'update') && !normalized.documentation?.summary) {
    violations.push('Tenant-exposed routines must include documentation.summary for auditability and discoverability.');
  }
  if ((context.action === 'create' || context.action === 'update') && !normalized.body) {
    violations.push(`${routineKind === 'function' ? 'Functions' : 'Procedures'} must declare a routine body.`);
  }
  if (normalized.body && !isSafeRoutineBody(normalized.body, routineKind, normalized.language)) {
    violations.push(`${routineKind === 'function' ? 'Function' : 'Procedure'} bodies must remain within the safe tenant-exposed routine subset.`);
  }
  if (routineKind === 'function' && !normalized.returnsType?.typeName) {
    violations.push('Functions must declare returnsType.');
  }
  if (routineKind === 'function' && normalized.returnsType?.typeName && !resolveCatalogEntry(normalized.returnsType, catalog)) {
    violations.push(`Function return type ${normalized.returnsType.fullName ?? normalized.returnsType.typeName} is not present in the allowed type catalog.`);
  }

  for (const argument of normalized.arguments ?? []) {
    validateRoutineArgument(argument, catalog, violations);
  }

  const availableRelations = new Set((context.availableRelations ?? []).map((entry) => toRelationKey(entry.databaseName, entry.schemaName, entry.relationName ?? entry.tableName ?? entry.viewName)));
  for (const dependency of [
    ...(normalized.dependencySummary?.readsFrom ?? []),
    ...(normalized.dependencySummary?.writesTo ?? []),
    ...(normalized.dependencySummary?.dependsOn ?? [])
  ]) {
    const relationName = dependency.relationName ?? dependency.tableName ?? dependency.viewName ?? dependency.materializedViewName;
    if (!relationName) continue;
    const key = toRelationKey(dependency.databaseName ?? normalized.databaseName, dependency.schemaName ?? normalized.schemaName, relationName);
    if (availableRelations.size > 0 && !availableRelations.has(key)) {
      violations.push(`${routineKind === 'function' ? 'Function' : 'Procedure'} dependency ${key} is not present in the available managed relation catalog.`);
    }
  }

  const quotaKey = routineKind === 'function' ? 'functions' : 'procedures';
  const quota = profile.quotaGuardrails?.[quotaKey];
  if (context.action === 'create' && quota && routineQuotaUsage(context, quotaKey) >= quota.limit) {
    violations.push(`Quota ${quota.metricKey} would be exceeded by creating another ${routineKind}.`);
  }

  return { normalized, violations, typeCatalog: catalog };
}

export function normalizePostgresStructuralResource(resourceKind, payload = {}, context = {}, profile = {}) {
  const tenantId = context.tenantId;
  const workspaceId = context.workspaceId;
  const providerCompatibility = compactDefined({
    provider: 'postgresql',
    contractVersion: context.contractVersion ?? '2026-03-24',
    supportedVersions: context.supportedVersions,
    placementMode: profile.placementMode ?? context.placementMode,
    deploymentProfileId: profile.deploymentProfileId ?? context.deploymentProfileId,
    databaseMutationsSupported: profile.databaseMutationsSupported ?? context.databaseMutationsSupported
  });
  const catalog = context.allowedTypeCatalog?.length ? context.allowedTypeCatalog : buildAllowedPostgresTypeCatalog(context.clusterFeatures);

  switch (resourceKind) {
    case 'table': {
      const columns = (payload.columns ?? []).map((column) => normalizeColumnSpec(column, catalog));
      return compactDefined({
        resourceType: 'postgres_table',
        tenantId,
        workspaceId,
        databaseName: payload.databaseName ?? context.databaseName,
        schemaName: payload.schemaName ?? context.schemaName,
        tableName: payload.tableName ?? payload.name ?? context.tableName,
        tableKind: payload.tableKind ?? 'base_table',
        ownerRoleName: payload.ownerRoleName,
        state: payload.state ?? 'active',
        comment: payload.comment,
        columnCount: payload.columnCount ?? columns.length,
        columns: columns.length > 0 ? columns : undefined,
        providerCompatibility
      });
    }
    case 'column': {
      const column = normalizeColumnSpec(payload, catalog);
      return compactDefined({
        resourceType: 'postgres_column',
        tenantId,
        workspaceId,
        databaseName: payload.databaseName ?? context.databaseName,
        schemaName: payload.schemaName ?? context.schemaName,
        tableName: payload.tableName ?? context.tableName,
        ordinalPosition: payload.ordinalPosition,
        ...column,
        state: payload.state ?? 'active',
        providerCompatibility
      });
    }
    case 'type': {
      const type = normalizeDataType(payload, catalog);
      const catalogEntry = resolveCatalogEntry(type, catalog) ?? type;

      return compactDefined({
        resourceType: 'postgres_type',
        tenantId,
        workspaceId,
        schemaName: catalogEntry.schemaName,
        typeName: catalogEntry.typeName,
        fullName: catalogEntry.fullName,
        displayName: catalogEntry.displayName,
        category: catalogEntry.category,
        kind: catalogEntry.kind,
        typeClass: catalogEntry.typeClass,
        extensionName: catalogEntry.extensionName,
        enumLabels: catalogEntry.enumLabels,
        arrayDimensions: catalogEntry.arrayDimensions,
        available: catalogEntry.available !== false,
        providerCompatibility
      });
    }
    case 'constraint': {
      const constraint = normalizeConstraintSpec({
        ...payload,
        databaseName: payload.databaseName ?? context.databaseName,
        schemaName: payload.schemaName ?? context.schemaName,
        tableName: payload.tableName ?? context.tableName
      });
      return compactDefined({
        resourceType: 'postgres_constraint',
        tenantId,
        workspaceId,
        ...constraint,
        providerCompatibility
      });
    }
    case 'index': {
      const index = normalizeIndexSpec({
        ...payload,
        databaseName: payload.databaseName ?? context.databaseName,
        schemaName: payload.schemaName ?? context.schemaName,
        tableName: payload.tableName ?? context.tableName
      });
      return compactDefined({
        resourceType: 'postgres_index',
        tenantId,
        workspaceId,
        ...index,
        performanceProfile: {
          supportsCompound: (index.keys ?? []).length > 1,
          supportsPartial: Boolean(index.predicateExpression),
          indexMethod: index.indexMethod
        },
        providerCompatibility
      });
    }
    case 'view': {
      const view = normalizeViewSpec(
        {
          ...payload,
          databaseName: payload.databaseName ?? context.databaseName,
          schemaName: payload.schemaName ?? context.schemaName,
          viewName: payload.viewName ?? context.viewName
        },
        'view'
      );
      return compactDefined({
        resourceType: 'postgres_view',
        tenantId,
        workspaceId,
        ...view,
        providerCompatibility
      });
    }
    case 'materialized_view': {
      const view = normalizeViewSpec(
        {
          ...payload,
          databaseName: payload.databaseName ?? context.databaseName,
          schemaName: payload.schemaName ?? context.schemaName,
          viewName: payload.viewName ?? payload.materializedViewName ?? context.materializedViewName
        },
        'materialized_view'
      );
      return compactDefined({
        resourceType: 'postgres_materialized_view',
        tenantId,
        workspaceId,
        ...view,
        integrityProfile: {
          withData: view.withData !== false,
          indexCount: view.indexes?.length ?? 0,
          refreshPolicy: view.refreshPolicy
        },
        providerCompatibility
      });
    }
    case 'function':
    case 'procedure': {
      const routine = normalizeRoutineSpec(
        {
          ...payload,
          databaseName: payload.databaseName ?? context.databaseName,
          schemaName: payload.schemaName ?? context.schemaName,
          routineName: payload.routineName ?? context.routineName,
          routineKind: resourceKind
        },
        catalog
      );
      return compactDefined({
        resourceType: resourceKind === 'function' ? 'postgres_function' : 'postgres_procedure',
        tenantId,
        workspaceId,
        ...routine,
        signature: `${routine.routineName}(${(routine.arguments ?? []).map((entry) => entry.dataType?.fullName ?? entry.dataType?.typeName).filter(Boolean).join(', ')})`,
        providerCompatibility
      });
    }
    default:
      throw new Error(`Unsupported PostgreSQL structural resource kind ${resourceKind}.`);
  }
}

export function validatePostgresStructuralRequest({ resourceKind, action, payload = {}, context = {}, profile = {} } = {}) {
  const violations = [];
  const catalog = context.allowedTypeCatalog?.length ? context.allowedTypeCatalog : buildAllowedPostgresTypeCatalog(context.clusterFeatures);
  const quotaGuardrails = profile.quotaGuardrails ?? {};

  if (resourceKind === 'type') {
    if (!['list', 'get'].includes(action)) {
      violations.push('Allowed PostgreSQL types are read-only and only support list/get actions.');
    }

    return {
      ok: violations.length === 0,
      violations,
      normalized: normalizePostgresStructuralResource(resourceKind, payload, context, profile),
      typeCatalog: catalog
    };
  }

  if (resourceKind === 'table') {
    const tableName = normalizeIdentifier(payload.tableName ?? payload.name ?? context.tableName);
    const schemaName = normalizeIdentifier(payload.schemaName ?? context.schemaName);
    const databaseName = normalizeIdentifier(payload.databaseName ?? context.databaseName);
    const columns = payload.columns ?? [];

    if (!databaseName && action !== 'list') {
      violations.push('Tables must declare databaseName.');
    }

    if (!schemaName && action !== 'list') {
      violations.push('Tables must declare schemaName.');
    }

    if (!tableName && action !== 'list') {
      violations.push('Tables must declare tableName.');
    }

    if (tableName && (!IDENTIFIER_PATTERN.test(tableName) || RESERVED_PREFIX_PATTERN.test(tableName))) {
      violations.push(`Table ${tableName} must use a safe, non-system identifier.`);
    }

    if (action === 'create' && columns.length === 0) {
      violations.push('Creating a table requires at least one column definition so the structural model is complete.');
    }

    const normalizedColumns = columns.map((column) => validateColumnRules(column, { ...context, databaseName, schemaName, tableName }, { onTableCreate: true, action: 'create' }));
    violations.push(...normalizedColumns.flatMap((entry) => entry.violations));

    const columnNames = normalizedColumns.map((entry) => entry.normalized.columnName).filter(Boolean);
    if (unique(columnNames).length !== columnNames.length) {
      violations.push('Table column definitions must use unique column names.');
    }

    const tableQuota = quotaGuardrails.tables;
    if (action === 'create' && tableQuota && tableQuotaUsage(context) >= tableQuota.limit) {
      violations.push(`Quota ${tableQuota.metricKey} would be exceeded by creating another table.`);
    }

    const columnQuota = quotaGuardrails.columns;
    if (action === 'create' && columnQuota && columns.length > columnQuota.limit) {
      violations.push(`Quota ${columnQuota.metricKey} would be exceeded by creating a table with ${columns.length} columns.`);
    }

    if ((action === 'update' || action === 'delete') && tableName) {
      violations.push(...collectDependencyViolations(`Table ${tableName}`, action, getTableDependencies(context, databaseName, schemaName, tableName), context));
    }

    return {
      ok: violations.length === 0,
      violations,
      normalized: normalizePostgresStructuralResource(resourceKind, payload, { ...context, allowedTypeCatalog: catalog }, profile),
      typeCatalog: catalog
    };
  }

  if (resourceKind === 'column') {
    const databaseName = normalizeIdentifier(payload.databaseName ?? context.databaseName);
    const schemaName = normalizeIdentifier(payload.schemaName ?? context.schemaName);
    const tableName = normalizeIdentifier(payload.tableName ?? context.tableName);
    const columnQuota = quotaGuardrails.columns;

    if (!databaseName && action !== 'list') {
      violations.push('Columns must declare databaseName.');
    }

    if (!schemaName && action !== 'list') {
      violations.push('Columns must declare schemaName.');
    }

    if (!tableName && action !== 'list') {
      violations.push('Columns must declare tableName.');
    }

    const columnValidation = validateColumnRules({ ...payload, databaseName, schemaName, tableName }, { ...context, databaseName, schemaName, tableName }, { action });
    violations.push(...columnValidation.violations);

    if (action === 'create' && columnQuota && columnQuotaUsage(context) >= columnQuota.limit) {
      violations.push(`Quota ${columnQuota.metricKey} would be exceeded by creating another column.`);
    }

    return {
      ok: violations.length === 0,
      violations,
      normalized: normalizePostgresStructuralResource(resourceKind, payload, { ...context, allowedTypeCatalog: catalog }, profile),
      typeCatalog: catalog
    };
  }

  if (resourceKind === 'constraint') {
    const result = validateConstraintRequest(payload, { ...context, action }, { quotaGuardrails });
    return {
      ok: result.violations.length === 0,
      violations: result.violations,
      normalized: normalizePostgresStructuralResource(resourceKind, payload, { ...context, allowedTypeCatalog: catalog }, profile),
      typeCatalog: catalog
    };
  }

  if (resourceKind === 'index') {
    const result = validateIndexRequest(payload, { ...context, action }, { quotaGuardrails });
    return {
      ok: result.violations.length === 0,
      violations: result.violations,
      normalized: normalizePostgresStructuralResource(resourceKind, payload, { ...context, allowedTypeCatalog: catalog }, profile),
      typeCatalog: catalog
    };
  }

  if (resourceKind === 'view' || resourceKind === 'materialized_view') {
    const result = validateViewRequest(payload, { ...context, action }, { quotaGuardrails }, resourceKind);
    return {
      ok: result.violations.length === 0,
      violations: result.violations,
      normalized: normalizePostgresStructuralResource(resourceKind, payload, { ...context, allowedTypeCatalog: catalog }, profile),
      typeCatalog: catalog
    };
  }

  if (resourceKind === 'function' || resourceKind === 'procedure') {
    const result = validateRoutineRequest(payload, { ...context, action }, { quotaGuardrails }, resourceKind);
    return {
      ok: result.violations.length === 0,
      violations: result.violations,
      normalized: normalizePostgresStructuralResource(resourceKind, payload, { ...context, allowedTypeCatalog: catalog }, profile),
      typeCatalog: catalog
    };
  }

  return {
    ok: false,
    violations: [`Unsupported structural resource kind ${resourceKind}.`],
    normalized: undefined,
    typeCatalog: catalog
  };
}

function renderColumnConstraintSql(normalizedColumn) {
  const fragments = [];

  if (normalizedColumn.constraints?.primaryKey) {
    fragments.push('PRIMARY KEY');
  }

  if (normalizedColumn.constraints?.unique) {
    fragments.push('UNIQUE');
  }

  if (normalizedColumn.constraints?.checkExpression) {
    fragments.push(`CHECK (${normalizedColumn.constraints.checkExpression})`);
  }

  return fragments.join(' ');
}

function renderColumnDefinition(column, catalog = []) {
  const normalized = normalizeColumnSpec(column, catalog);
  const fragments = [quoteIdent(normalized.columnName), renderDataType(normalized.dataType, catalog)];

  if (normalized.identity) {
    const generation = normalized.identity.generation === 'always' ? 'ALWAYS' : 'BY DEFAULT';
    const sequenceOptions = compactDefined({
      startWith: normalized.identity.startWith,
      incrementBy: normalized.identity.incrementBy
    });
    const options = Object.entries(sequenceOptions)
      .map(([key, value]) => `${key === 'startWith' ? 'START WITH' : 'INCREMENT BY'} ${value}`)
      .join(' ');
    fragments.push(`GENERATED ${generation} AS IDENTITY${options ? ` (${options})` : ''}`);
  } else if (normalized.generated) {
    fragments.push(`GENERATED ALWAYS AS (${normalized.generated.expression}) STORED`);
  } else if (normalized.defaultExpression) {
    fragments.push(`DEFAULT ${normalized.defaultExpression}`);
  }

  if (normalized.nullable === false) {
    fragments.push('NOT NULL');
  }

  const constraintSql = renderColumnConstraintSql(normalized);
  if (constraintSql) {
    fragments.push(constraintSql);
  }

  return {
    sql: fragments.join(' '),
    normalized
  };
}

function renderConstraintDefinition(constraint, catalog = []) {
  switch (constraint.constraintType) {
    case 'primary_key':
      return `CONSTRAINT ${quoteIdent(constraint.constraintName)} PRIMARY KEY (${(constraint.columns ?? []).map((column) => quoteIdent(column)).join(', ')})`;
    case 'unique':
      return `CONSTRAINT ${quoteIdent(constraint.constraintName)} UNIQUE (${(constraint.columns ?? []).map((column) => quoteIdent(column)).join(', ')})`;
    case 'check':
      return `CONSTRAINT ${quoteIdent(constraint.constraintName)} CHECK (${constraint.checkExpression})`;
    case 'foreign_key': {
      const localColumns = (constraint.columns ?? []).map((column) => quoteIdent(column)).join(', ');
      const referencedColumns = (constraint.referencedColumns ?? []).map((column) => quoteIdent(column)).join(', ');
      const referencedTable = renderQualifiedName(constraint.referencedSchemaName, constraint.referencedTableName);
      const actions = [
        constraint.matchType ? `MATCH ${String(constraint.matchType).toUpperCase()}` : undefined,
        constraint.onDelete ? `ON DELETE ${String(constraint.onDelete).toUpperCase().replace(/_/g, ' ')}` : undefined,
        constraint.onUpdate ? `ON UPDATE ${String(constraint.onUpdate).toUpperCase().replace(/_/g, ' ')}` : undefined,
        constraint.deferrable ? 'DEFERRABLE' : undefined,
        constraint.initiallyDeferred ? 'INITIALLY DEFERRED' : undefined,
        constraint.notValid ? 'NOT VALID' : undefined
      ]
        .filter(Boolean)
        .join(' ');
      return `CONSTRAINT ${quoteIdent(constraint.constraintName)} FOREIGN KEY (${localColumns}) REFERENCES ${referencedTable} (${referencedColumns})${actions ? ` ${actions}` : ''}`;
    }
    default:
      throw new Error(`Unsupported SQL rendering for PostgreSQL constraint type ${constraint.constraintType}.`);
  }
}

function renderIndexKey(key) {
  const base = key.expression ? `(${key.expression})` : quoteIdent(key.columnName);
  const fragments = [base, key.order === 'desc' ? 'DESC' : undefined, key.nulls ? `NULLS ${String(key.nulls).toUpperCase()}` : undefined].filter(Boolean);
  return fragments.join(' ');
}

function renderIndexCreateStatement(index) {
  const qualifiedIndexName = renderQualifiedName(index.schemaName, index.indexName);
  const qualifiedRelation = renderQualifiedName(index.schemaName, index.tableName);
  const includeClause = (index.includeColumns ?? []).length > 0 ? ` INCLUDE (${index.includeColumns.map((column) => quoteIdent(column)).join(', ')})` : '';
  const predicateClause = index.predicateExpression ? ` WHERE ${index.predicateExpression}` : '';

  return `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${qualifiedIndexName} ON ${qualifiedRelation} USING ${index.indexMethod.toUpperCase()} (${(index.keys ?? [])
    .map((key) => renderIndexKey(key))
    .join(', ')})${includeClause}${predicateClause}`;
}

function renderRoutineArgumentDefinition(argument, catalog = []) {
  const fragments = [];
  if (argument.mode && argument.mode !== 'in') {
    fragments.push(argument.mode.toUpperCase());
  }
  fragments.push(quoteIdent(argument.name));
  fragments.push(renderDataType(argument.dataType, catalog));
  if (argument.defaultExpression) {
    fragments.push(`DEFAULT ${argument.defaultExpression}`);
  }
  return fragments.join(' ');
}

function renderRoutineIdentity(normalized) {
  return `${renderQualifiedName(normalized.schemaName, normalized.routineName)}(${(normalized.arguments ?? [])
    .map((argument) => renderDataType(argument.dataType))
    .join(', ')})`;
}

function renderRoutineCommentStatement(normalized) {
  if (!normalized.documentation?.summary && !normalized.comment) {
    return undefined;
  }
  const comment = [normalized.documentation?.summary, normalized.documentation?.description, normalized.comment].filter(Boolean).join('\n\n');
  const kind = normalized.routineKind === 'function' ? 'FUNCTION' : 'PROCEDURE';
  return `COMMENT ON ${kind} ${renderRoutineIdentity(normalized)} IS ${quoteLiteral(comment)}`;
}

export function buildPostgresStructuralSqlPlan({ resourceKind, action, payload = {}, context = {} } = {}) {
  const validation = validatePostgresStructuralRequest({
    resourceKind,
    action,
    payload,
    context,
    profile: context.profile ?? {}
  });

  if (!validation.ok) {
    const error = new Error('PostgreSQL structural request failed validation.');
    error.validation = validation;
    throw error;
  }

  const catalog = validation.typeCatalog;
  const databaseName = payload.databaseName ?? context.databaseName;
  const schemaName = payload.schemaName ?? context.schemaName;
  const tableName = payload.tableName ?? context.tableName;
  const qualifiedTableName = schemaName && tableName ? renderQualifiedName(schemaName, tableName) : undefined;
  const statements = [];
  const lockTargets = [];
  const safeGuards = [
    'All identifiers are double-quoted.',
    'Only safe literal/function defaults, bounded expressions, and read-only relation queries are accepted.',
    'Mutations are planned as one transactional DDL unit unless the bounded contract forbids the operation.',
    'Dependency validation blocks destructive changes when managed objects still reference the target relation.'
  ];

  if (resourceKind === 'table') {
    if (action === 'create') {
      const definitions = (payload.columns ?? []).map((column) => renderColumnDefinition(column, catalog));
      statements.push(`CREATE TABLE ${qualifiedTableName} (\n  ${definitions.map((entry) => entry.sql).join(',\n  ')}\n)`);

      for (const definition of definitions) {
        if (definition.normalized.comment) {
          statements.push(`COMMENT ON COLUMN ${qualifiedTableName}.${quoteIdent(definition.normalized.columnName)} IS ${quoteLiteral(definition.normalized.comment)}`);
        }
      }

      if (payload.comment) {
        statements.push(`COMMENT ON TABLE ${qualifiedTableName} IS ${quoteLiteral(payload.comment)}`);
      }
    }

    if (action === 'update') {
      if (payload.renameTo) {
        statements.push(`ALTER TABLE ${qualifiedTableName} RENAME TO ${quoteIdent(payload.renameTo)}`);
      }

      if (Object.prototype.hasOwnProperty.call(payload, 'comment')) {
        statements.push(`COMMENT ON TABLE ${qualifiedTableName} IS ${payload.comment ? quoteLiteral(payload.comment) : 'NULL'}`);
      }
    }

    if (action === 'delete') {
      statements.push(`DROP TABLE ${qualifiedTableName}`);
    }

    lockTargets.push(`${databaseName}.${schemaName}.${tableName}`);
  }

  if (resourceKind === 'column') {
    const normalized = normalizeColumnSpec(payload, catalog);
    const qualifiedColumnName = `${qualifiedTableName}.${quoteIdent(normalized.columnName)}`;

    if (action === 'create') {
      const definition = renderColumnDefinition(payload, catalog);
      statements.push(`ALTER TABLE ${qualifiedTableName} ADD COLUMN ${definition.sql}`);
      if (normalized.comment) {
        statements.push(`COMMENT ON COLUMN ${qualifiedColumnName} IS ${quoteLiteral(normalized.comment)}`);
      }
    }

    if (action === 'update') {
      const currentColumn = context.currentColumn ?? context.currentResource ?? {};
      if (currentColumn.dataType && normalized.dataType && (currentColumn.dataType.fullName ?? currentColumn.dataType.typeName) !== normalized.dataType.fullName) {
        statements.push(`ALTER TABLE ${qualifiedTableName} ALTER COLUMN ${quoteIdent(normalized.columnName)} TYPE ${renderDataType(normalized.dataType, catalog)}`);
      }

      if (currentColumn.nullable !== normalized.nullable) {
        statements.push(`ALTER TABLE ${qualifiedTableName} ALTER COLUMN ${quoteIdent(normalized.columnName)} ${normalized.nullable === false ? 'SET' : 'DROP'} NOT NULL`);
      }

      if ((currentColumn.defaultExpression ?? null) !== (normalized.defaultExpression ?? null) && !normalized.generated && !normalized.identity) {
        statements.push(`ALTER TABLE ${qualifiedTableName} ALTER COLUMN ${quoteIdent(normalized.columnName)} ${normalized.defaultExpression ? `SET DEFAULT ${normalized.defaultExpression}` : 'DROP DEFAULT'}`);
      }

      if (Object.prototype.hasOwnProperty.call(payload, 'comment')) {
        statements.push(`COMMENT ON COLUMN ${qualifiedColumnName} IS ${normalized.comment ? quoteLiteral(normalized.comment) : 'NULL'}`);
      }
    }

    if (action === 'delete') {
      statements.push(`ALTER TABLE ${qualifiedTableName} DROP COLUMN ${quoteIdent(normalized.columnName)}`);
    }

    lockTargets.push(`${databaseName}.${schemaName}.${tableName}.${normalized.columnName}`);
  }

  if (resourceKind === 'constraint') {
    const normalized = normalizeConstraintSpec({
      ...payload,
      databaseName: payload.databaseName ?? context.databaseName,
      schemaName: payload.schemaName ?? context.schemaName,
      tableName: payload.tableName ?? context.tableName
    });

    if (action === 'create') {
      if (normalized.constraintType === 'not_null') {
        statements.push(`ALTER TABLE ${qualifiedTableName} ALTER COLUMN ${quoteIdent(normalized.columnName)} SET NOT NULL`);
      } else {
        statements.push(`ALTER TABLE ${qualifiedTableName} ADD ${renderConstraintDefinition(normalized, catalog)}`);
      }
    }

    if (action === 'update') {
      const currentConstraint = context.currentConstraint ?? {};
      if (payload.renameTo && normalized.constraintType !== 'not_null') {
        statements.push(`ALTER TABLE ${qualifiedTableName} RENAME CONSTRAINT ${quoteIdent(currentConstraint.constraintName ?? normalized.constraintName)} TO ${quoteIdent(payload.renameTo)}`);
      } else if (normalized.constraintType === 'not_null') {
        statements.push(`ALTER TABLE ${qualifiedTableName} ALTER COLUMN ${quoteIdent(normalized.columnName)} SET NOT NULL`);
      } else {
        if (currentConstraint.constraintName ?? normalized.constraintName) {
          statements.push(`ALTER TABLE ${qualifiedTableName} DROP CONSTRAINT ${quoteIdent(currentConstraint.constraintName ?? normalized.constraintName)}`);
        }
        statements.push(`ALTER TABLE ${qualifiedTableName} ADD ${renderConstraintDefinition(normalized, catalog)}`);
      }
    }

    if (action === 'delete') {
      if (normalized.constraintType === 'not_null') {
        statements.push(`ALTER TABLE ${qualifiedTableName} ALTER COLUMN ${quoteIdent(normalized.columnName)} DROP NOT NULL`);
      } else {
        statements.push(`ALTER TABLE ${qualifiedTableName} DROP CONSTRAINT ${quoteIdent(normalized.constraintName)}`);
      }
    }

    lockTargets.push(`${databaseName}.${schemaName}.${tableName}.constraint.${normalized.constraintName ?? normalized.columnName}`);
  }

  if (resourceKind === 'index') {
    const normalized = normalizeIndexSpec({
      ...payload,
      databaseName: payload.databaseName ?? context.databaseName,
      schemaName: payload.schemaName ?? context.schemaName,
      tableName: payload.tableName ?? context.tableName
    });
    const qualifiedIndexName = renderQualifiedName(normalized.schemaName, normalized.indexName);

    if (action === 'create') {
      statements.push(renderIndexCreateStatement(normalized));
      if (normalized.comment) {
        statements.push(`COMMENT ON INDEX ${qualifiedIndexName} IS ${quoteLiteral(normalized.comment)}`);
      }
    }

    if (action === 'update') {
      const currentIndex = context.currentIndex ?? {};
      if (payload.renameTo && !payload.keys && !payload.columns && !payload.expressions && !payload.predicateExpression && !payload.where) {
        statements.push(`ALTER INDEX ${renderQualifiedName(normalized.schemaName, currentIndex.indexName ?? normalized.indexName)} RENAME TO ${quoteIdent(payload.renameTo)}`);
      } else {
        if (currentIndex.indexName ?? normalized.indexName) {
          statements.push(`DROP INDEX ${renderQualifiedName(normalized.schemaName, currentIndex.indexName ?? normalized.indexName)}`);
        }
        statements.push(renderIndexCreateStatement(normalized));
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'comment')) {
        statements.push(`COMMENT ON INDEX ${qualifiedIndexName} IS ${normalized.comment ? quoteLiteral(normalized.comment) : 'NULL'}`);
      }
    }

    if (action === 'delete') {
      statements.push(`DROP INDEX ${qualifiedIndexName}`);
    }

    lockTargets.push(`${databaseName}.${schemaName}.${tableName}.index.${normalized.indexName}`);
  }

  if (resourceKind === 'view' || resourceKind === 'materialized_view') {
    const normalized = normalizeViewSpec(
      {
        ...payload,
        databaseName: payload.databaseName ?? context.databaseName,
        schemaName: payload.schemaName ?? context.schemaName,
        viewName: payload.viewName ?? payload.materializedViewName ?? context.viewName ?? context.materializedViewName
      },
      resourceKind
    );
    const relationName = normalized.viewName ?? normalized.materializedViewName;
    const qualifiedViewName = renderQualifiedName(normalized.schemaName, relationName);
    const commentKeyword = resourceKind === 'materialized_view' ? 'MATERIALIZED VIEW' : 'VIEW';

    if (action === 'create') {
      if (resourceKind === 'view') {
        statements.push(`CREATE VIEW ${qualifiedViewName} AS ${normalized.query}`);
      } else {
        statements.push(`CREATE MATERIALIZED VIEW ${qualifiedViewName} AS ${normalized.query} ${normalized.withData === false ? 'WITH NO DATA' : 'WITH DATA'}`);
        for (const index of normalized.indexes ?? []) {
          statements.push(renderIndexCreateStatement({ ...index, schemaName: normalized.schemaName, tableName: relationName }));
        }
      }
      if (normalized.comment) {
        statements.push(`COMMENT ON ${commentKeyword} ${qualifiedViewName} IS ${quoteLiteral(normalized.comment)}`);
      }
    }

    if (action === 'update') {
      if (payload.renameTo && !payload.query && !payload.definition) {
        statements.push(`ALTER ${commentKeyword} ${qualifiedViewName} RENAME TO ${quoteIdent(payload.renameTo)}`);
      } else if (resourceKind === 'view') {
        statements.push(`CREATE OR REPLACE VIEW ${qualifiedViewName} AS ${normalized.query}`);
      } else {
        statements.push(`DROP MATERIALIZED VIEW ${qualifiedViewName}`);
        statements.push(`CREATE MATERIALIZED VIEW ${qualifiedViewName} AS ${normalized.query} ${normalized.withData === false ? 'WITH NO DATA' : 'WITH DATA'}`);
        for (const index of normalized.indexes ?? []) {
          statements.push(renderIndexCreateStatement({ ...index, schemaName: normalized.schemaName, tableName: relationName }));
        }
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'comment')) {
        statements.push(`COMMENT ON ${commentKeyword} ${qualifiedViewName} IS ${normalized.comment ? quoteLiteral(normalized.comment) : 'NULL'}`);
      }
    }

    if (action === 'delete') {
      statements.push(`DROP ${commentKeyword} ${qualifiedViewName}`);
    }

    lockTargets.push(`${databaseName}.${schemaName}.${relationName}`);
  }

  if (resourceKind === 'function' || resourceKind === 'procedure') {
    const normalized = normalizeRoutineSpec(
      {
        ...payload,
        databaseName: payload.databaseName ?? context.databaseName,
        schemaName: payload.schemaName ?? context.schemaName,
        routineName: payload.routineName ?? context.routineName,
        routineKind: resourceKind
      },
      catalog
    );
    const routineKindSql = resourceKind === 'function' ? 'FUNCTION' : 'PROCEDURE';
    const argumentSql = (normalized.arguments ?? []).map((argument) => renderRoutineArgumentDefinition(argument, catalog)).join(', ');
    const routineIdentity = renderRoutineIdentity(normalized);

    if (action === 'create' || action === 'update') {
      const fragments = [
        `CREATE OR REPLACE ${routineKindSql} ${renderQualifiedName(normalized.schemaName, normalized.routineName)}(${argumentSql})`,
        resourceKind === 'function' ? `RETURNS ${renderDataType(normalized.returnsType, catalog)}` : undefined,
        `LANGUAGE ${normalized.language.toUpperCase()}`,
        resourceKind === 'function' ? normalized.volatility.toUpperCase() : undefined,
        'SECURITY INVOKER',
        `AS ${quoteLiteral(normalized.body)}`
      ].filter(Boolean);
      statements.push(fragments.join(' '));
      const commentStatement = renderRoutineCommentStatement(normalized);
      if (commentStatement) {
        statements.push(commentStatement);
      }
    }

    if (action === 'delete') {
      statements.push(`DROP ${routineKindSql} ${routineIdentity}`);
    }

    lockTargets.push(`${databaseName}.${schemaName}.${normalized.routineName}`);
  }

  return {
    resourceKind,
    action,
    databaseName,
    schemaName,
    tableName,
    statements,
    lockTargets,
    transactionMode: 'transactional_ddl',
    safeGuards
  };
}
