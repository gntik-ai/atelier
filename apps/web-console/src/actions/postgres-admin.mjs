import { filterPublicRoutes, getApiFamily, getPublicRoute } from '../../../../services/internal-contracts/src/index.mjs';

export const postgresConsoleFamily = getApiFamily('postgres');
export const postgresConsoleRoutes = filterPublicRoutes({ family: 'postgres' });

export function listConsolePostgresRoutes(filters = {}) {
  return filterPublicRoutes({ family: 'postgres', ...filters });
}

export function getConsolePostgresRoute(operationId) {
  const route = getPublicRoute(operationId);
  return route?.family === 'postgres' ? route : undefined;
}

function relationKey(entry = {}) {
  return `${entry.databaseName}.${entry.schemaName}.${entry.tableName ?? entry.viewName ?? entry.materializedViewName ?? entry.routineName ?? entry.indexName}`;
}

export function buildPostgresTableExplorer({ tables = [], columns = [] } = {}) {
  const columnCountByTable = new Map();

  for (const column of columns) {
    const key = `${column.databaseName}.${column.schemaName}.${column.tableName}`;
    columnCountByTable.set(key, (columnCountByTable.get(key) ?? 0) + 1);
  }

  return tables.map((table) => ({
    key: `${table.databaseName}.${table.schemaName}.${table.tableName}`,
    title: table.tableName,
    schemaName: table.schemaName,
    databaseName: table.databaseName,
    tableKind: table.tableKind ?? 'base_table',
    comment: table.comment,
    columnCount: table.columnCount ?? columnCountByTable.get(`${table.databaseName}.${table.schemaName}.${table.tableName}`) ?? 0,
    route: getConsolePostgresRoute('getPostgresTable')
  }));
}

export function buildPostgresTypeFilterOptions(types = []) {
  const byCategory = [...new Set(types.map((type) => type.category).filter(Boolean))].sort();
  const byKind = [...new Set(types.map((type) => type.kind).filter(Boolean))].sort();
  const bySchema = [...new Set(types.map((type) => type.schemaName).filter(Boolean))].sort();

  return {
    categories: byCategory,
    kinds: byKind,
    schemas: bySchema
  };
}

export function buildPostgresConstraintExplorer(constraints = []) {
  return constraints.map((constraint) => ({
    key: `${constraint.databaseName}.${constraint.schemaName}.${constraint.tableName}.${constraint.constraintName ?? constraint.columnName}`,
    title: constraint.constraintName ?? constraint.columnName,
    databaseName: constraint.databaseName,
    schemaName: constraint.schemaName,
    tableName: constraint.tableName,
    constraintType: constraint.constraintType,
    target: constraint.columnName ?? (constraint.columns ?? []).join(', '),
    route: getConsolePostgresRoute('getPostgresConstraint')
  }));
}

export function buildPostgresIndexExplorer(indexes = []) {
  return indexes.map((index) => ({
    key: relationKey(index),
    title: index.indexName,
    databaseName: index.databaseName,
    schemaName: index.schemaName,
    tableName: index.tableName,
    indexMethod: index.indexMethod,
    unique: index.unique === true,
    partial: Boolean(index.predicateExpression),
    compound: (index.keys?.length ?? 0) > 1,
    route: getConsolePostgresRoute('getPostgresIndex')
  }));
}

export function buildPostgresViewExplorer(views = [], operationId = 'getPostgresView') {
  return views.map((view) => ({
    key: relationKey(view),
    title: view.viewName ?? view.materializedViewName,
    databaseName: view.databaseName,
    schemaName: view.schemaName,
    dependencyCount: view.dependencySummary?.readsFrom?.length ?? 0,
    refreshPolicy: view.refreshPolicy,
    route: getConsolePostgresRoute(operationId)
  }));
}

export function buildPostgresRoutineExplorer(routines = [], operationId = 'getPostgresFunction') {
  return routines.map((routine) => ({
    key: relationKey(routine),
    title: routine.routineName,
    databaseName: routine.databaseName,
    schemaName: routine.schemaName,
    language: routine.language,
    signature: routine.signature,
    documentationSummary: routine.documentation?.summary,
    route: getConsolePostgresRoute(operationId)
  }));
}

export function buildPostgresTableSecurityExplorer(entries = []) {
  return entries.map((entry) => ({
    key: `${entry.databaseName}.${entry.schemaName}.${entry.tableName}.security`,
    title: `${entry.tableName} security`,
    databaseName: entry.databaseName,
    schemaName: entry.schemaName,
    tableName: entry.tableName,
    rlsEnabled: entry.rlsEnabled !== false,
    forceRls: entry.forceRls === true,
    policyCount: entry.policyCount ?? 0,
    route: getConsolePostgresRoute('getPostgresTableSecurity')
  }));
}

export function buildPostgresPolicyExplorer(policies = []) {
  return policies.map((policy) => ({
    key: `${policy.databaseName}.${policy.schemaName}.${policy.tableName}.${policy.policyName}`,
    title: policy.policyName,
    databaseName: policy.databaseName,
    schemaName: policy.schemaName,
    tableName: policy.tableName,
    command: policy.appliesTo?.command ?? policy.command ?? 'all',
    policyMode: policy.policyMode ?? 'permissive',
    roleCount: policy.appliesTo?.roles?.length ?? 0,
    route: getConsolePostgresRoute('getPostgresPolicy')
  }));
}

export function buildPostgresGrantExplorer(grants = []) {
  return grants.map((grant) => ({
    key: grant.grantId ?? `${grant.target?.databaseName}.${grant.target?.schemaName}.${grant.target?.objectType}.${grant.target?.objectName ?? grant.target?.schemaName}.${grant.granteeRoleName}`,
    title: grant.granteeRoleName,
    databaseName: grant.target?.databaseName ?? grant.databaseName,
    schemaName: grant.target?.schemaName ?? grant.schemaName,
    targetType: grant.target?.objectType ?? grant.objectType,
    targetName: grant.target?.objectName ?? grant.objectName ?? grant.tableName ?? grant.sequenceName ?? grant.routineName ?? grant.target?.schemaName,
    privilegeCount: grant.privileges?.length ?? 0,
    route: getConsolePostgresRoute('getPostgresGrant')
  }));
}

export function buildPostgresExtensionExplorer(extensions = []) {
  return extensions.map((extension) => ({
    key: `${extension.databaseName}.${extension.extensionName}`,
    title: extension.extensionName,
    databaseName: extension.databaseName,
    schemaName: extension.schemaName,
    authorized: extension.authorized !== false,
    version: extension.requestedVersion ?? extension.installedVersion ?? extension.version,
    route: getConsolePostgresRoute('getPostgresExtension')
  }));
}

export function buildPostgresTemplateExplorer(templates = []) {
  return templates.map((template) => ({
    key: template.templateId,
    title: template.templateId,
    templateScope: template.templateScope ?? template.scope,
    extensionCount: template.defaults?.extensions?.length ?? 0,
    documentationSummary: template.documentation?.summary,
    route: getConsolePostgresRoute('getPostgresTemplate')
  }));
}

export function buildWorkspacePostgresExplorer({
  workspaceId,
  inventory,
  tables = [],
  columns = [],
  tableSecurity = [],
  policies = [],
  grants = [],
  extensions = [],
  templates = [],
  constraints = [],
  indexes = [],
  views = [],
  materializedViews = [],
  functions = [],
  procedures = [],
  types = []
} = {}) {
  return {
    workspaceId,
    family: postgresConsoleFamily,
    inventory,
    sections: [
      {
        id: 'tables',
        title: 'Tables',
        count: tables.length,
        route: getConsolePostgresRoute('listPostgresTables'),
        items: buildPostgresTableExplorer({ tables, columns })
      },
      {
        id: 'columns',
        title: 'Columns',
        count: columns.length,
        route: getConsolePostgresRoute('listPostgresColumns'),
        items: columns.map((column) => ({
          key: `${column.databaseName}.${column.schemaName}.${column.tableName}.${column.columnName}`,
          title: column.columnName,
          tableName: column.tableName,
          schemaName: column.schemaName,
          databaseName: column.databaseName,
          dataType: column.dataType?.displayName ?? column.dataType?.fullName ?? column.dataType?.typeName,
          nullable: column.nullable !== false,
          route: getConsolePostgresRoute('getPostgresColumn')
        }))
      },
      {
        id: 'table_security',
        title: 'Table security',
        count: tableSecurity.length,
        route: getConsolePostgresRoute('getPostgresTableSecurity'),
        items: buildPostgresTableSecurityExplorer(tableSecurity)
      },
      {
        id: 'policies',
        title: 'Policies',
        count: policies.length,
        route: getConsolePostgresRoute('listPostgresPolicies'),
        items: buildPostgresPolicyExplorer(policies)
      },
      {
        id: 'grants',
        title: 'Grants',
        count: grants.length,
        route: getConsolePostgresRoute('listPostgresGrants'),
        items: buildPostgresGrantExplorer(grants)
      },
      {
        id: 'extensions',
        title: 'Extensions',
        count: extensions.length,
        route: getConsolePostgresRoute('listPostgresExtensions'),
        items: buildPostgresExtensionExplorer(extensions)
      },
      {
        id: 'templates',
        title: 'Templates',
        count: templates.length,
        route: getConsolePostgresRoute('listPostgresTemplates'),
        items: buildPostgresTemplateExplorer(templates)
      },
      {
        id: 'constraints',
        title: 'Constraints',
        count: constraints.length,
        route: getConsolePostgresRoute('listPostgresConstraints'),
        items: buildPostgresConstraintExplorer(constraints)
      },
      {
        id: 'indexes',
        title: 'Indexes',
        count: indexes.length,
        route: getConsolePostgresRoute('listPostgresIndexes'),
        items: buildPostgresIndexExplorer(indexes)
      },
      {
        id: 'views',
        title: 'Views',
        count: views.length,
        route: getConsolePostgresRoute('listPostgresViews'),
        items: buildPostgresViewExplorer(views, 'getPostgresView')
      },
      {
        id: 'materialized_views',
        title: 'Materialized views',
        count: materializedViews.length,
        route: getConsolePostgresRoute('listPostgresMaterializedViews'),
        items: buildPostgresViewExplorer(materializedViews, 'getPostgresMaterializedView')
      },
      {
        id: 'functions',
        title: 'Functions',
        count: functions.length,
        route: getConsolePostgresRoute('listPostgresFunctions'),
        items: buildPostgresRoutineExplorer(functions, 'getPostgresFunction')
      },
      {
        id: 'procedures',
        title: 'Procedures',
        count: procedures.length,
        route: getConsolePostgresRoute('listPostgresProcedures'),
        items: buildPostgresRoutineExplorer(procedures, 'getPostgresProcedure')
      },
      {
        id: 'types',
        title: 'Allowed types',
        count: types.length,
        route: getConsolePostgresRoute('listPostgresTypes'),
        filters: buildPostgresTypeFilterOptions(types),
        items: types.map((type) => ({
          key: type.fullName ?? `${type.schemaName}.${type.typeName}`,
          title: type.displayName ?? type.fullName ?? type.typeName,
          schemaName: type.schemaName,
          category: type.category,
          kind: type.kind,
          extensionName: type.extensionName
        }))
      }
    ]
  };
}

export function buildPostgresAdminQueryHistory(entries = []) {
  return entries.map((entry, index) => ({
    key: entry.historyId ?? entry.requestId ?? entry.statementFingerprint ?? `admin-sql-${index + 1}`,
    title: entry.queryLabel ?? entry.summary ?? `Admin SQL ${index + 1}`,
    executionMode: entry.executionMode ?? 'preview',
    databaseName: entry.databaseName,
    schemaName: entry.schemaName,
    statementFingerprint: entry.statementFingerprint,
    statementType: entry.statementType ?? entry.queryPreview?.statementType,
    warningCount: entry.warningCount ?? entry.preExecutionWarnings?.length ?? 0,
    confirmed: entry.confirmation?.confirmed === true,
    route: getConsolePostgresRoute('executePostgresAdminSql')
  }));
}

export function buildPostgresAdminQueryConsole({
  workspaceId,
  databaseName,
  draft = {},
  history = [],
  queryPreview,
  preExecutionWarnings = [],
  riskProfile,
  route = getConsolePostgresRoute('executePostgresAdminSql')
} = {}) {
  const preview = queryPreview
    ? {
        statementFingerprint: queryPreview.statementFingerprint,
        statementType: queryPreview.statementType,
        parameterMode: queryPreview.parameterMode,
        parameterCount: queryPreview.parameterCount,
        transactionMode: queryPreview.transactionMode,
        planFlags: queryPreview.planFlags ?? [],
        safeGuards: queryPreview.safeGuards ?? [],
        sqlText: queryPreview.sqlText
      }
    : undefined;

  return {
    workspaceId,
    databaseName,
    route,
    editor: {
      language: 'sql',
      sqlText: draft.sqlText ?? '',
      parameters: draft.parameters ?? {},
      executionMode: draft.executionMode ?? 'preview',
      queryLabel: draft.queryLabel,
      reason: draft.reason,
      schemaName: draft.schemaName
    },
    preview,
    history: buildPostgresAdminQueryHistory(history),
    warnings: preExecutionWarnings,
    riskProfile,
    confirmation: {
      required: draft.executionMode === 'execute' || riskProfile?.acknowledgementRequired === true,
      statementFingerprint: preview?.statementFingerprint,
      intentPhrase: preview?.statementFingerprint ? `EXECUTE ${preview.statementFingerprint}` : undefined,
      explicitConfirmation: true
    }
  };
}
