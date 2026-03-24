import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getPostgresAdminRoute,
  getPostgresCompatibilitySummary,
  listPostgresAdminRoutes,
  postgresApiFamily,
  summarizePostgresAdminSurface
} from '../../apps/control-plane/src/postgres-admin.mjs';
import {
  buildPostgresTableExplorer,
  buildPostgresTypeFilterOptions,
  buildWorkspacePostgresExplorer,
  getConsolePostgresRoute,
  listConsolePostgresRoutes,
  postgresConsoleFamily
} from '../../apps/web-console/src/postgres-admin.mjs';

test('postgres admin control-plane helpers expose the generated postgres family surface', () => {
  const routes = listPostgresAdminRoutes();
  const summary = summarizePostgresAdminSurface();
  const roleSummary = summary.find((entry) => entry.resourceKind === 'role');
  const tableSummary = summary.find((entry) => entry.resourceKind === 'table');
  const columnSummary = summary.find((entry) => entry.resourceKind === 'column');
  const typeSummary = summary.find((entry) => entry.resourceKind === 'type');
  const inventorySummary = summary.find((entry) => entry.resourceKind === 'inventory');

  assert.equal(postgresApiFamily.id, 'postgres');
  assert.ok(routes.some((route) => route.path === '/v1/postgres/roles'));
  assert.ok(routes.some((route) => route.path === '/v1/postgres/users'));
  assert.ok(routes.some((route) => route.path === '/v1/postgres/databases/{databaseName}/schemas/{schemaName}'));
  assert.ok(routes.some((route) => route.path === '/v1/postgres/databases/{databaseName}/schemas/{schemaName}/tables'));
  assert.ok(routes.some((route) => route.path === '/v1/postgres/databases/{databaseName}/schemas/{schemaName}/tables/{tableName}/columns'));
  assert.ok(routes.some((route) => route.path === '/v1/postgres/workspaces/{workspaceId}/types'));
  assert.ok(routes.some((route) => route.path === '/v1/postgres/workspaces/{workspaceId}/inventory'));
  assert.equal(getPostgresAdminRoute('getPostgresInventory').resourceType, 'postgres_inventory');
  assert.ok(roleSummary.routeCount >= 5);
  assert.ok(tableSummary.routeCount >= 5);
  assert.ok(columnSummary.routeCount >= 5);
  assert.equal(typeSummary.routeCount, 1);
  assert.equal(inventorySummary.routeCount, 1);
});

test('postgres admin compatibility summary reflects placement-aware capabilities and minimum privilege guidance', () => {
  const growth = getPostgresCompatibilitySummary({ planId: 'pln_01growth' });
  const enterprise = getPostgresCompatibilitySummary({ planId: 'pln_01enterprise' });

  assert.equal(growth.provider, 'postgresql');
  assert.equal(growth.placementMode, 'schema_per_tenant');
  assert.equal(growth.databaseMutationsSupported, false);
  assert.equal(growth.minimumEnginePolicy.requiresCreatedb, false);
  assert.equal(growth.supportedVersions.length, 3);
  assert.equal(growth.quotaGuardrails.tables.limit > 0, true);
  assert.equal(growth.quotaGuardrails.columns.limit > 0, true);

  assert.equal(enterprise.placementMode, 'database_per_tenant');
  assert.equal(enterprise.databaseMutationsSupported, true);
  assert.equal(enterprise.minimumEnginePolicy.requiresCreatedb, true);
  assert.equal(enterprise.minimumEnginePolicy.forbiddenAttributes.includes('SUPERUSER'), true);
});

test('web console postgres helpers expose explorer sections for tables columns and types', () => {
  const routes = listConsolePostgresRoutes();
  const tableCards = buildPostgresTableExplorer({
    tables: [{ databaseName: 'tenant_alpha_main', schemaName: 'alpha_prod_app', tableName: 'customer_orders', tableKind: 'base_table' }],
    columns: [
      { databaseName: 'tenant_alpha_main', schemaName: 'alpha_prod_app', tableName: 'customer_orders', columnName: 'id' },
      { databaseName: 'tenant_alpha_main', schemaName: 'alpha_prod_app', tableName: 'customer_orders', columnName: 'payload' }
    ]
  });
  const filters = buildPostgresTypeFilterOptions([
    { schemaName: 'pg_catalog', category: 'built_in', kind: 'json' },
    { schemaName: 'public', category: 'extension', kind: 'scalar' },
    { schemaName: 'alpha_prod_app', category: 'user_defined', kind: 'enum' }
  ]);
  const explorer = buildWorkspacePostgresExplorer({
    workspaceId: 'wrk_01alphaprod',
    inventory: { counts: { tables: 1, columns: 2 } },
    tables: [{ databaseName: 'tenant_alpha_main', schemaName: 'alpha_prod_app', tableName: 'customer_orders', tableKind: 'base_table', columnCount: 2 }],
    columns: [
      {
        databaseName: 'tenant_alpha_main',
        schemaName: 'alpha_prod_app',
        tableName: 'customer_orders',
        columnName: 'payload',
        dataType: { displayName: 'jsonb' },
        nullable: false
      }
    ],
    types: [
      { schemaName: 'pg_catalog', typeName: 'jsonb', fullName: 'jsonb', displayName: 'jsonb', category: 'built_in', kind: 'json' },
      { schemaName: 'alpha_prod_app', typeName: 'order_status', fullName: 'alpha_prod_app.order_status', displayName: 'alpha_prod_app.order_status', category: 'user_defined', kind: 'enum' }
    ]
  });

  assert.equal(postgresConsoleFamily.id, 'postgres');
  assert.ok(routes.some((route) => route.path === '/v1/postgres/workspaces/{workspaceId}/types'));
  assert.equal(getConsolePostgresRoute('listPostgresTypes').resourceType, 'postgres_type');
  assert.equal(tableCards[0].columnCount, 2);
  assert.deepEqual(filters.categories, ['built_in', 'extension', 'user_defined']);
  assert.deepEqual(filters.schemas, ['alpha_prod_app', 'pg_catalog', 'public']);
  assert.equal(explorer.sections.find((section) => section.id === 'tables').count, 1);
  assert.equal(explorer.sections.find((section) => section.id === 'columns').items[0].dataType, 'jsonb');
  assert.equal(explorer.sections.find((section) => section.id === 'types').filters.kinds.includes('enum'), true);
});
