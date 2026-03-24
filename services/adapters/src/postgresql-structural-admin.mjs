const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;
const RESERVED_PREFIX_PATTERN = /^(pg_|sql_)/;
const SAFE_LITERAL_PATTERN = /^(?:null|true|false|-?\d+(?:\.\d+)?|'(?:[^']|'')*')$/i;
const SAFE_DEFAULT_FUNCTIONS = new Set(['now()', 'current_timestamp', 'current_date', 'current_time', 'gen_random_uuid()', 'uuid_generate_v4()']);
const SAFE_GENERATED_EXPRESSION_PATTERN = /^[a-z0-9_"()\s,+\-*/%|:&<>=.!?\[\]]+$/i;
const SAFE_CHECK_EXPRESSION_PATTERN = /^[a-z0-9_"()\s,+\-*/%|:&<>=.!?'\[\]]+$/i;

export const POSTGRES_STRUCTURAL_RESOURCE_KINDS = Object.freeze(['table', 'column', 'type']);

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
  return [...new Set(values.filter(Boolean).map(String))];
}

function normalizeIdentifier(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 63);
}

function quoteIdent(identifier) {
  const normalized = String(identifier ?? '').trim();
  if (!normalized) {
    throw new Error('SQL identifier is required.');
  }

  return `"${normalized.replace(/"/g, '""')}"`;
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
    const schemaName = normalizeTypeName(value.schemaName ?? splitQualifiedTypeName(normalizedTypeName).schemaName ?? 'pg_catalog');
    const precision = value.precision ?? value.length;

    return compactDefined({
      schemaName,
      typeName: splitQualifiedTypeName(normalizedTypeName).typeName,
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

function quoteLiteral(value) {
  if (value === null) return 'NULL';
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return `'${String(value).replace(/'/g, "''")}'`;
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

function renderQualifiedName(schemaName, tableName) {
  return `${quoteIdent(schemaName)}.${quoteIdent(tableName)}`;
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
  return Number(
    context.currentTable?.columnCount ??
      context.currentInventory?.counts?.columns ??
      context.currentInventory?.columns?.length ??
      0
  );
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

  if (onTableCreate && !normalized.columnName) {
    violations.push('Table column definitions require columnName.');
  }

  return {
    normalized,
    violations
  };
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
    const tableName = normalizeIdentifier(payload.tableName ?? payload.name);
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

    const normalizedColumns = columns.map((column) => validateColumnRules(column, context, { onTableCreate: true, action: 'create' }));
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

    const columnValidation = validateColumnRules(payload, context, { action });
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
  const safeGuards = ['All identifiers are double-quoted.', 'Only safe literal/function defaults and bounded expressions are accepted.', 'Mutations are planned as one transactional DDL unit.'];

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
        statements.push(
          `ALTER TABLE ${qualifiedTableName} ALTER COLUMN ${quoteIdent(normalized.columnName)} ${normalized.nullable === false ? 'SET' : 'DROP'} NOT NULL`
        );
      }

      if ((currentColumn.defaultExpression ?? null) !== (normalized.defaultExpression ?? null) && !normalized.generated && !normalized.identity) {
        statements.push(
          `ALTER TABLE ${qualifiedTableName} ALTER COLUMN ${quoteIdent(normalized.columnName)} ${normalized.defaultExpression ? `SET DEFAULT ${normalized.defaultExpression}` : 'DROP DEFAULT'}`
        );
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
