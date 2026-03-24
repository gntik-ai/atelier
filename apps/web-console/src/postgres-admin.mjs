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

export function buildWorkspacePostgresExplorer({ workspaceId, inventory, tables = [], columns = [], types = [] } = {}) {
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
