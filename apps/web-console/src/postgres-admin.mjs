import { filterPublicRoutes, getApiFamily, getPublicRoute } from '../../../services/internal-contracts/src/index.mjs';

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

export function buildWorkspacePostgresExplorer({
  workspaceId,
  inventory,
  tables = [],
  columns = [],
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
