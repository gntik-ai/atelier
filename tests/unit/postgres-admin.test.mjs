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
  buildPostgresConstraintExplorer,
  buildPostgresIndexExplorer,
  buildPostgresRoutineExplorer,
  buildPostgresTableExplorer,
  buildPostgresTypeFilterOptions,
  buildPostgresViewExplorer,
  buildWorkspacePostgresExplorer,
  getConsolePostgresRoute,
  listConsolePostgresRoutes,
  postgresConsoleFamily
} from '../../apps/web-console/src/postgres-admin.mjs';

test('postgres admin control-plane helpers expose the expanded postgres family surface', () => {
  const routes = listPostgresAdminRoutes();
  const summary = summarizePostgresAdminSurface();
  const resourceKinds = new Map(summary.map((entry) => [entry.resourceKind, entry]));

  assert.equal(postgresApiFamily.id, 'postgres');
  assert.ok(routes.some((route) => route.path === '/v1/postgres/roles'));
  assert.ok(routes.some((route) => route.path === '/v1/postgres/databases/{databaseName}/schemas/{schemaName}/tables/{tableName}/constraints'));
  assert.ok(routes.some((route) => route.path === '/v1/postgres/databases/{databaseName}/schemas/{schemaName}/tables/{tableName}/indexes'));
  assert.ok(routes.some((route) => route.path === '/v1/postgres/databases/{databaseName}/schemas/{schemaName}/views'));
  assert.ok(routes.some((route) => route.path === '/v1/postgres/databases/{databaseName}/schemas/{schemaName}/materialized-views'));
  assert.ok(routes.some((route) => route.path === '/v1/postgres/databases/{databaseName}/schemas/{schemaName}/functions'));
  assert.ok(routes.some((route) => route.path === '/v1/postgres/databases/{databaseName}/schemas/{schemaName}/procedures'));
  assert.equal(getPostgresAdminRoute('getPostgresInventory').resourceType, 'postgres_inventory');
  assert.equal(getPostgresAdminRoute('getPostgresMaterializedView').resourceType, 'postgres_materialized_view');
  assert.equal(resourceKinds.get('constraint').routeCount, 5);
  assert.equal(resourceKinds.get('index').routeCount, 5);
  assert.equal(resourceKinds.get('view').routeCount, 5);
  assert.equal(resourceKinds.get('materialized_view').routeCount, 5);
  assert.equal(resourceKinds.get('function').routeCount, 5);
  assert.equal(resourceKinds.get('procedure').routeCount, 5);
  assert.equal(resourceKinds.get('type').routeCount, 1);
  assert.equal(resourceKinds.get('inventory').routeCount, 1);
});

test('postgres admin compatibility summary reflects placement-aware capability flags and quota guardrails for advanced structural resources', () => {
  const growth = getPostgresCompatibilitySummary({ planId: 'pln_01growth' });
  const enterprise = getPostgresCompatibilitySummary({ planId: 'pln_01enterprise' });

  assert.equal(growth.provider, 'postgresql');
  assert.equal(growth.placementMode, 'schema_per_tenant');
  assert.equal(growth.databaseMutationsSupported, false);
  assert.equal(growth.minimumEnginePolicy.requiresCreatedb, false);
  assert.equal(growth.supportedVersions.length, 3);
  assert.equal(growth.quotaGuardrails.tables.limit > 0, true);
  assert.equal(growth.quotaGuardrails.columns.limit > 0, true);
  assert.equal(growth.quotaGuardrails.constraints.limit > growth.quotaGuardrails.columns.limit, true);
  assert.equal(growth.quotaGuardrails.materializedViews.limit > 0, true);
  assert.equal(growth.minimumEnginePolicy.allowedCapabilities.includes('create_workspace_materialized_views'), true);

  assert.equal(enterprise.placementMode, 'database_per_tenant');
  assert.equal(enterprise.databaseMutationsSupported, true);
  assert.equal(enterprise.minimumEnginePolicy.requiresCreatedb, true);
  assert.equal(enterprise.minimumEnginePolicy.forbiddenAttributes.includes('SUPERUSER'), true);
  assert.equal(enterprise.quotaGuardrails.functions.limit > enterprise.quotaGuardrails.procedures.limit, true);
});

test('web console postgres helpers expose explorer sections for constraints indexes views materialized views and routines', () => {
  const routes = listConsolePostgresRoutes();
  const tableCards = buildPostgresTableExplorer({
    tables: [{ databaseName: 'tenant_alpha_main', schemaName: 'alpha_prod_app', tableName: 'customer_orders', tableKind: 'base_table' }],
    columns: [
      { databaseName: 'tenant_alpha_main', schemaName: 'alpha_prod_app', tableName: 'customer_orders', columnName: 'id' },
      { databaseName: 'tenant_alpha_main', schemaName: 'alpha_prod_app', tableName: 'customer_orders', columnName: 'payload' }
    ]
  });
  const constraintCards = buildPostgresConstraintExplorer([
    {
      databaseName: 'tenant_alpha_main',
      schemaName: 'alpha_prod_app',
      tableName: 'customer_orders',
      constraintName: 'customer_orders_pkey',
      constraintType: 'primary_key',
      columns: ['id']
    }
  ]);
  const indexCards = buildPostgresIndexExplorer([
    {
      databaseName: 'tenant_alpha_main',
      schemaName: 'alpha_prod_app',
      tableName: 'customer_orders',
      indexName: 'customer_orders_status_created_at_idx',
      indexMethod: 'btree',
      keys: [{ columnName: 'status' }, { columnName: 'created_at', order: 'desc' }],
      predicateExpression: "status <> 'archived'"
    }
  ]);
  const filters = buildPostgresTypeFilterOptions([
    { schemaName: 'pg_catalog', category: 'built_in', kind: 'json' },
    { schemaName: 'public', category: 'extension', kind: 'scalar' },
    { schemaName: 'alpha_prod_app', category: 'user_defined', kind: 'enum' }
  ]);
  const viewCards = buildPostgresViewExplorer([
    {
      databaseName: 'tenant_alpha_main',
      schemaName: 'alpha_prod_app',
      viewName: 'customer_order_projection',
      dependencySummary: { readsFrom: [{ relationName: 'customer_orders' }] }
    }
  ]);
  const functionCards = buildPostgresRoutineExplorer([
    {
      databaseName: 'tenant_alpha_main',
      schemaName: 'alpha_prod_app',
      routineName: 'get_customer_order',
      language: 'sql',
      signature: 'get_customer_order(uuid)',
      documentation: { summary: 'Fetch one order.' }
    }
  ]);
  const explorer = buildWorkspacePostgresExplorer({
    workspaceId: 'wrk_01alphaprod',
    inventory: { counts: { tables: 1, columns: 2, indexes: 1, materializedViews: 1 } },
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
    constraints: [
      {
        databaseName: 'tenant_alpha_main',
        schemaName: 'alpha_prod_app',
        tableName: 'customer_orders',
        constraintName: 'customer_orders_pkey',
        constraintType: 'primary_key',
        columns: ['id']
      }
    ],
    indexes: [
      {
        databaseName: 'tenant_alpha_main',
        schemaName: 'alpha_prod_app',
        tableName: 'customer_orders',
        indexName: 'customer_orders_status_created_at_idx',
        indexMethod: 'btree',
        keys: [{ columnName: 'status' }, { columnName: 'created_at', order: 'desc' }],
        predicateExpression: "status <> 'archived'"
      }
    ],
    views: [
      {
        databaseName: 'tenant_alpha_main',
        schemaName: 'alpha_prod_app',
        viewName: 'customer_order_projection',
        dependencySummary: { readsFrom: [{ relationName: 'customer_orders' }] }
      }
    ],
    materializedViews: [
      {
        databaseName: 'tenant_alpha_main',
        schemaName: 'alpha_prod_app',
        viewName: 'customer_order_rollups',
        refreshPolicy: 'manual',
        dependencySummary: { readsFrom: [{ relationName: 'customer_orders' }] }
      }
    ],
    functions: [
      {
        databaseName: 'tenant_alpha_main',
        schemaName: 'alpha_prod_app',
        routineName: 'get_customer_order',
        language: 'sql',
        signature: 'get_customer_order(uuid)',
        documentation: { summary: 'Fetch one order.' }
      }
    ],
    procedures: [
      {
        databaseName: 'tenant_alpha_main',
        schemaName: 'alpha_prod_app',
        routineName: 'refresh_customer_order_rollups',
        language: 'plpgsql',
        signature: 'refresh_customer_order_rollups()'
      }
    ],
    types: [
      { schemaName: 'pg_catalog', typeName: 'jsonb', fullName: 'jsonb', displayName: 'jsonb', category: 'built_in', kind: 'json' },
      { schemaName: 'alpha_prod_app', typeName: 'order_status', fullName: 'alpha_prod_app.order_status', displayName: 'alpha_prod_app.order_status', category: 'user_defined', kind: 'enum' }
    ]
  });

  assert.equal(postgresConsoleFamily.id, 'postgres');
  assert.ok(routes.some((route) => route.path === '/v1/postgres/workspaces/{workspaceId}/types'));
  assert.ok(routes.some((route) => route.path === '/v1/postgres/databases/{databaseName}/schemas/{schemaName}/functions'));
  assert.equal(getConsolePostgresRoute('listPostgresTypes').resourceType, 'postgres_type');
  assert.equal(tableCards[0].columnCount, 2);
  assert.equal(constraintCards[0].constraintType, 'primary_key');
  assert.equal(indexCards[0].compound, true);
  assert.equal(indexCards[0].partial, true);
  assert.deepEqual(filters.categories, ['built_in', 'extension', 'user_defined']);
  assert.deepEqual(filters.schemas, ['alpha_prod_app', 'pg_catalog', 'public']);
  assert.equal(viewCards[0].dependencyCount, 1);
  assert.equal(functionCards[0].documentationSummary, 'Fetch one order.');
  assert.equal(explorer.sections.find((section) => section.id === 'tables').count, 1);
  assert.equal(explorer.sections.find((section) => section.id === 'columns').items[0].dataType, 'jsonb');
  assert.equal(explorer.sections.find((section) => section.id === 'constraints').items[0].title, 'customer_orders_pkey');
  assert.equal(explorer.sections.find((section) => section.id === 'materialized_views').items[0].refreshPolicy, 'manual');
  assert.equal(explorer.sections.find((section) => section.id === 'functions').items[0].signature, 'get_customer_order(uuid)');
  assert.equal(explorer.sections.find((section) => section.id === 'types').filters.kinds.includes('enum'), true);
});
