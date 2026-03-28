import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getPostgresAdminRoute,
  getPostgresAdminSqlRoute,
  getPostgresCompatibilitySummary,
  listPostgresAdminRoutes,
  listPostgresAdminSqlRoutes,
  postgresApiFamily,
  summarizePostgresAdminSurface
} from '../../apps/control-plane/src/postgres-admin.mjs';
import {
  buildPostgresAdminQueryConsole,
  buildPostgresAdminQueryHistory,
  buildPostgresConstraintExplorer,
  buildPostgresExtensionExplorer,
  buildPostgresGrantExplorer,
  buildPostgresIndexExplorer,
  buildPostgresPolicyExplorer,
  buildPostgresRoutineExplorer,
  buildPostgresTableExplorer,
  buildPostgresTableSecurityExplorer,
  buildPostgresTemplateExplorer,
  buildPostgresTypeFilterOptions,
  buildPostgresViewExplorer,
  buildWorkspacePostgresExplorer,
  getConsolePostgresRoute,
  listConsolePostgresRoutes,
  postgresConsoleFamily
} from '../../apps/web-console/src/actions/postgres-admin.mjs';

test('postgres admin control-plane helpers expose the expanded postgres family surface', () => {
  const routes = listPostgresAdminRoutes();
  const adminSqlRoutes = listPostgresAdminSqlRoutes();
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
  assert.ok(routes.some((route) => route.path === '/v1/postgres/databases/{databaseName}/schemas/{schemaName}/tables/{tableName}/security'));
  assert.ok(routes.some((route) => route.path === '/v1/postgres/databases/{databaseName}/schemas/{schemaName}/tables/{tableName}/policies'));
  assert.ok(routes.some((route) => route.path === '/v1/postgres/workspaces/{workspaceId}/grants'));
  assert.ok(routes.some((route) => route.path === '/v1/postgres/databases/{databaseName}/extensions'));
  assert.ok(routes.some((route) => route.path === '/v1/postgres/workspaces/{workspaceId}/templates'));
  assert.ok(routes.some((route) => route.path === '/v1/postgres/workspaces/{workspaceId}/admin/{databaseName}/sql'));
  assert.equal(adminSqlRoutes.length, 1);
  assert.equal(getPostgresAdminRoute('getPostgresInventory').resourceType, 'postgres_inventory');
  assert.equal(getPostgresAdminSqlRoute().resourceType, 'postgres_admin_sql');
  assert.equal(getPostgresAdminRoute('getPostgresMaterializedView').resourceType, 'postgres_materialized_view');
  assert.equal(getPostgresAdminRoute('getPostgresTableSecurity').resourceType, 'postgres_table_security');
  assert.equal(getPostgresAdminRoute('getPostgresGrant').resourceType, 'postgres_grant');
  assert.equal(resourceKinds.get('constraint').routeCount, 5);
  assert.equal(resourceKinds.get('index').routeCount, 5);
  assert.equal(resourceKinds.get('view').routeCount, 5);
  assert.equal(resourceKinds.get('materialized_view').routeCount, 5);
  assert.equal(resourceKinds.get('function').routeCount, 5);
  assert.equal(resourceKinds.get('procedure').routeCount, 5);
  assert.equal(resourceKinds.get('table_security').routeCount, 2);
  assert.equal(resourceKinds.get('policy').routeCount, 5);
  assert.equal(resourceKinds.get('grant').routeCount, 5);
  assert.equal(resourceKinds.get('extension').routeCount, 5);
  assert.equal(resourceKinds.get('template').routeCount, 5);
  assert.equal(resourceKinds.get('type').routeCount, 1);
  assert.equal(resourceKinds.get('inventory').routeCount, 1);
  assert.equal(resourceKinds.get('admin_sql').routeCount, 1);
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
  assert.equal(growth.tableSecurityMutationsSupported, true);
  assert.equal(growth.policyMutationsSupported, true);
  assert.equal(growth.grantMutationsSupported, true);
  assert.equal(growth.extensionMutationsSupported, true);
  assert.equal(growth.templateCatalogSupported, true);
  assert.equal(growth.authorizedExtensions.some((entry) => entry.extensionName === 'pgcrypto'), true);
  assert.equal(growth.adminSqlEnabled, false);

  assert.equal(enterprise.placementMode, 'database_per_tenant');
  assert.equal(enterprise.databaseMutationsSupported, true);
  assert.equal(enterprise.minimumEnginePolicy.requiresCreatedb, true);
  assert.equal(enterprise.minimumEnginePolicy.forbiddenAttributes.includes('SUPERUSER'), true);
  assert.equal(enterprise.quotaGuardrails.functions.limit > enterprise.quotaGuardrails.procedures.limit, true);
  assert.equal(enterprise.adminSqlEnabled, true);
  assert.equal(enterprise.adminSqlPlanFlags.includes('postgres.admin_sql.audit'), true);
});

test('web console postgres helpers expose explorer sections for security grants extensions templates and advanced structural objects', () => {
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
  const securityCards = buildPostgresTableSecurityExplorer([
    {
      databaseName: 'tenant_alpha_main',
      schemaName: 'alpha_prod_app',
      tableName: 'customer_orders',
      rlsEnabled: true,
      forceRls: true,
      policyCount: 1
    }
  ]);
  const policyCards = buildPostgresPolicyExplorer([
    {
      databaseName: 'tenant_alpha_main',
      schemaName: 'alpha_prod_app',
      tableName: 'customer_orders',
      policyName: 'customer_orders_tenant_isolation',
      appliesTo: { command: 'select', roles: ['alpha_prod_runtime'] },
      policyMode: 'restrictive'
    }
  ]);
  const grantCards = buildPostgresGrantExplorer([
    {
      grantId: 'tenant_alpha_main__alpha_prod_app__table__customer_orders__alpha_prod_runtime',
      granteeRoleName: 'alpha_prod_runtime',
      target: {
        databaseName: 'tenant_alpha_main',
        schemaName: 'alpha_prod_app',
        objectType: 'table',
        objectName: 'customer_orders'
      },
      privileges: ['select']
    }
  ]);
  const extensionCards = buildPostgresExtensionExplorer([
    {
      databaseName: 'tenant_alpha_main',
      extensionName: 'pgcrypto',
      schemaName: 'public',
      authorized: true,
      installedVersion: '1.3'
    }
  ]);
  const templateCards = buildPostgresTemplateExplorer([
    {
      templateId: 'pg_schema_shared_v1',
      templateScope: 'schema',
      defaults: { extensions: ['pgcrypto'] },
      documentation: { summary: 'Shared-schema tenant bootstrap.' }
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
    tableSecurity: [
      {
        databaseName: 'tenant_alpha_main',
        schemaName: 'alpha_prod_app',
        tableName: 'customer_orders',
        rlsEnabled: true,
        forceRls: true,
        policyCount: 1
      }
    ],
    policies: [
      {
        databaseName: 'tenant_alpha_main',
        schemaName: 'alpha_prod_app',
        tableName: 'customer_orders',
        policyName: 'customer_orders_tenant_isolation',
        appliesTo: { command: 'select', roles: ['alpha_prod_runtime'] },
        policyMode: 'restrictive'
      }
    ],
    grants: [
      {
        grantId: 'tenant_alpha_main__alpha_prod_app__table__customer_orders__alpha_prod_runtime',
        granteeRoleName: 'alpha_prod_runtime',
        target: {
          databaseName: 'tenant_alpha_main',
          schemaName: 'alpha_prod_app',
          objectType: 'table',
          objectName: 'customer_orders'
        },
        privileges: ['select']
      }
    ],
    extensions: [
      {
        databaseName: 'tenant_alpha_main',
        extensionName: 'pgcrypto',
        schemaName: 'public',
        authorized: true,
        installedVersion: '1.3'
      }
    ],
    templates: [
      {
        templateId: 'pg_schema_shared_v1',
        templateScope: 'schema',
        defaults: { extensions: ['pgcrypto'] },
        documentation: { summary: 'Shared-schema tenant bootstrap.' }
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
  assert.ok(routes.some((route) => route.path === '/v1/postgres/workspaces/{workspaceId}/grants'));
  assert.ok(routes.some((route) => route.path === '/v1/postgres/databases/{databaseName}/extensions'));
  assert.equal(getConsolePostgresRoute('listPostgresTypes').resourceType, 'postgres_type');
  assert.equal(getConsolePostgresRoute('getPostgresTableSecurity').resourceType, 'postgres_table_security');
  assert.equal(tableCards[0].columnCount, 2);
  assert.equal(constraintCards[0].constraintType, 'primary_key');
  assert.equal(indexCards[0].compound, true);
  assert.equal(indexCards[0].partial, true);
  assert.equal(securityCards[0].forceRls, true);
  assert.equal(policyCards[0].policyMode, 'restrictive');
  assert.equal(grantCards[0].privilegeCount, 1);
  assert.equal(extensionCards[0].authorized, true);
  assert.equal(templateCards[0].documentationSummary, 'Shared-schema tenant bootstrap.');
  assert.deepEqual(filters.categories, ['built_in', 'extension', 'user_defined']);
  assert.deepEqual(filters.schemas, ['alpha_prod_app', 'pg_catalog', 'public']);
  assert.equal(viewCards[0].dependencyCount, 1);
  assert.equal(functionCards[0].documentationSummary, 'Fetch one order.');
  assert.equal(explorer.sections.find((section) => section.id === 'tables').count, 1);
  assert.equal(explorer.sections.find((section) => section.id === 'columns').items[0].dataType, 'jsonb');
  assert.equal(explorer.sections.find((section) => section.id === 'table_security').items[0].forceRls, true);
  assert.equal(explorer.sections.find((section) => section.id === 'policies').items[0].title, 'customer_orders_tenant_isolation');
  assert.equal(explorer.sections.find((section) => section.id === 'grants').items[0].targetType, 'table');
  assert.equal(explorer.sections.find((section) => section.id === 'extensions').items[0].title, 'pgcrypto');
  assert.equal(explorer.sections.find((section) => section.id === 'templates').items[0].title, 'pg_schema_shared_v1');
  assert.equal(explorer.sections.find((section) => section.id === 'constraints').items[0].title, 'customer_orders_pkey');
  assert.equal(explorer.sections.find((section) => section.id === 'materialized_views').items[0].refreshPolicy, 'manual');
  assert.equal(explorer.sections.find((section) => section.id === 'functions').items[0].signature, 'get_customer_order(uuid)');
  assert.equal(explorer.sections.find((section) => section.id === 'types').filters.kinds.includes('enum'), true);
});


test('web console admin SQL helpers expose a minimal query editor with history and explicit confirmation', () => {
  const history = buildPostgresAdminQueryHistory([
    {
      historyId: 'hist_01',
      queryLabel: 'Check locks',
      databaseName: 'tenant_alpha_main',
      schemaName: 'pg_catalog',
      executionMode: 'preview',
      statementFingerprint: '1234567890abcdef12345678',
      statementType: 'read',
      preExecutionWarnings: []
    }
  ]);
  const consoleModel = buildPostgresAdminQueryConsole({
    workspaceId: 'wrk_01alphaprod',
    databaseName: 'tenant_alpha_main',
    draft: {
      sqlText: 'SELECT * FROM pg_stat_activity WHERE datname = :databaseName',
      parameters: { databaseName: 'tenant_alpha_main' },
      executionMode: 'execute',
      queryLabel: 'Inspect sessions',
      schemaName: 'pg_catalog'
    },
    history,
    queryPreview: {
      statementFingerprint: '1234567890abcdef12345678',
      statementType: 'read',
      parameterMode: 'named',
      parameterCount: 1,
      transactionMode: 'single_statement',
      planFlags: ['postgres.admin_sql', 'postgres.admin_sql.audit'],
      safeGuards: ['One statement only'],
      sqlText: 'SELECT * FROM pg_stat_activity WHERE datname = $1'
    },
    preExecutionWarnings: [
      { warningCode: 'preview_only', severity: 'info', category: 'execution_mode', summary: 'Preview only', impactLevel: 'none', requiresAcknowledgement: false }
    ],
    riskProfile: { acknowledgementRequired: true }
  });

  assert.equal(history[0].title, 'Check locks');
  assert.equal(history[0].statementType, 'read');
  assert.equal(consoleModel.route.operationId, 'executePostgresAdminSql');
  assert.equal(consoleModel.editor.language, 'sql');
  assert.equal(consoleModel.editor.executionMode, 'execute');
  assert.equal(consoleModel.preview.planFlags.includes('postgres.admin_sql.audit'), true);
  assert.equal(consoleModel.confirmation.required, true);
  assert.equal(consoleModel.confirmation.explicitConfirmation, true);
  assert.equal(consoleModel.confirmation.intentPhrase, 'EXECUTE 1234567890abcdef12345678');
});
