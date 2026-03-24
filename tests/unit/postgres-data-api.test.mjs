import test from 'node:test';
import assert from 'node:assert/strict';

import {
  POSTGRES_DATA_API_OPERATIONS,
  POSTGRES_DATA_COUNT_MODES,
  POSTGRES_DATA_PAGINATION_METADATA_MODES,
  buildPostgresDataApiPlan,
  buildPostgresDataScopedCredential,
  buildPostgresDataStableEndpointDefinition,
  buildPostgresDataStableEndpointInvocationPlan,
  buildPostgresSavedQueryDefinition,
  buildPostgresSavedQueryExecutionPlan,
  serializePostgresDataApiCursor,
  summarizePostgresDataApiCapabilityMatrix
} from '../../services/adapters/src/postgresql-data-api.mjs';
import {
  getPostgresDataApiRoute,
  listPostgresDataApiRoutes,
  postgresDataApiFamily,
  summarizePostgresDataApiSurface
} from '../../apps/control-plane/src/postgres-data-api.mjs';

const baseTable = {
  schemaName: 'alpha_prod_app',
  tableName: 'customer_orders',
  columns: [
    { columnName: 'id', primaryKey: true, nullable: false, dataType: 'uuid' },
    { columnName: 'tenantId', nullable: false, dataType: 'text' },
    { columnName: 'customerId', nullable: false, dataType: 'uuid' },
    { columnName: 'status', nullable: false, dataType: 'text' },
    { columnName: 'totalAmount', nullable: false, dataType: 'numeric' },
    { columnName: 'payload', nullable: false, dataType: 'jsonb', json: true },
    { columnName: 'createdAt', nullable: false, dataType: 'timestamptz' }
  ],
  primaryKey: ['id'],
  relations: [
    {
      relationName: 'customer',
      relationType: 'many_to_one',
      sourceColumn: 'customerId',
      targetColumn: 'id',
      target: {
        schemaName: 'alpha_prod_app',
        tableName: 'customers',
        columns: [
          { columnName: 'id', primaryKey: true, nullable: false, dataType: 'uuid' },
          { columnName: 'tenantId', nullable: false, dataType: 'text' },
          { columnName: 'displayName', nullable: false, dataType: 'text' },
          { columnName: 'segment', nullable: false, dataType: 'text' }
        ],
        primaryKey: ['id'],
        schemaGrants: [
          { granteeRoleName: 'alpha_runtime', privileges: ['usage'], target: { schemaName: 'alpha_prod_app' } }
        ],
        objectGrants: [
          {
            granteeRoleName: 'alpha_runtime',
            privileges: ['select'],
            target: { schemaName: 'alpha_prod_app', objectName: 'customers' }
          }
        ],
        tableSecurity: { rlsEnabled: true },
        policies: [
          {
            appliesTo: { command: 'select', roles: ['alpha_runtime'] },
            runtimePredicate: { kind: 'session_equals_row', sessionKey: 'tenantId', columnName: 'tenantId' }
          }
        ]
      }
    }
  ]
};

const accessContext = {
  actorRoleName: 'workspace_viewer',
  effectiveRoles: ['workspace_viewer', 'alpha_runtime'],
  schemaGrants: [
    { granteeRoleName: 'alpha_runtime', privileges: ['usage'], target: { schemaName: 'alpha_prod_app' } }
  ],
  objectGrants: [
    {
      granteeRoleName: 'alpha_runtime',
      privileges: ['select', 'insert', 'update', 'delete'],
      target: { schemaName: 'alpha_prod_app', objectName: 'customer_orders' }
    }
  ],
  tableSecurity: { rlsEnabled: true },
  policies: [
    {
      appliesTo: { command: 'select', roles: ['alpha_runtime'] },
      runtimePredicate: { kind: 'session_equals_row', sessionKey: 'tenantId', columnName: 'tenantId' }
    },
    {
      appliesTo: { command: 'insert', roles: ['alpha_runtime'] },
      runtimePredicate: { kind: 'session_equals_row', sessionKey: 'tenantId', columnName: 'tenantId' }
    },
    {
      appliesTo: { command: 'update', roles: ['alpha_runtime'] },
      runtimePredicate: { kind: 'session_equals_row', sessionKey: 'tenantId', columnName: 'tenantId' }
    },
    {
      appliesTo: { command: 'delete', roles: ['alpha_runtime'] },
      runtimePredicate: { kind: 'session_equals_row', sessionKey: 'tenantId', columnName: 'tenantId' }
    }
  ],
  sessionContext: { tenantId: 'ten_alpha' }
};

test('postgres data API control-plane helpers expose the expanded CRUD/governance surface', () => {
  const routes = listPostgresDataApiRoutes();
  const summary = summarizePostgresDataApiSurface();
  const capabilitySummary = summarizePostgresDataApiCapabilityMatrix();

  assert.equal(postgresDataApiFamily.id, 'postgres');
  assert.ok(routes.some((route) => route.path === '/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/rows'));
  assert.ok(routes.some((route) => route.path === '/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/bulk/insert'));
  assert.ok(routes.some((route) => route.path === '/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/credentials'));
  assert.ok(routes.some((route) => route.path === '/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/saved-queries'));
  assert.ok(routes.some((route) => route.path === '/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/published/{endpointSlug}'));
  assert.equal(getPostgresDataApiRoute('listPostgresDataRows').resourceType, 'postgres_data_rows');
  assert.equal(getPostgresDataApiRoute('executePostgresDataRpc').resourceType, 'postgres_data_rpc');
  assert.equal(getPostgresDataApiRoute('bulkInsertPostgresDataRows').resourceType, 'postgres_data_bulk');
  assert.equal(getPostgresDataApiRoute('importPostgresDataRows').resourceType, 'postgres_data_transfer');
  assert.equal(getPostgresDataApiRoute('createPostgresDataCredential').resourceType, 'postgres_data_credential');
  assert.equal(getPostgresDataApiRoute('createPostgresSavedQuery').resourceType, 'postgres_data_saved_query');
  assert.equal(getPostgresDataApiRoute('createPostgresDataEndpoint').resourceType, 'postgres_data_endpoint');
  assert.deepEqual(POSTGRES_DATA_API_OPERATIONS, [
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
  assert.equal(summary.routeCount, 27);
  assert.equal(summary.operations.find((entry) => entry.operation === 'bulk_insert').routeCount, 1);
  assert.equal(summary.operations.find((entry) => entry.operation === 'bulk_update').routeCount, 1);
  assert.equal(summary.operations.find((entry) => entry.operation === 'bulk_delete').routeCount, 1);
  assert.equal(summary.operations.find((entry) => entry.operation === 'import').routeCount, 1);
  assert.equal(summary.operations.find((entry) => entry.operation === 'export').routeCount, 1);
  assert.equal(summary.operations.find((entry) => entry.operation === 'scoped_credential').routeCount, 4);
  assert.equal(summary.operations.find((entry) => entry.operation === 'saved_query').routeCount, 6);
  assert.equal(summary.operations.find((entry) => entry.operation === 'saved_query_execute').routeCount, 1);
  assert.equal(summary.operations.find((entry) => entry.operation === 'stable_endpoint').routeCount, 6);
  assert.equal(summary.operations.find((entry) => entry.operation === 'stable_endpoint_invoke').routeCount, 1);
  assert.equal(summary.filterOperators.includes('json_contains'), true);
  assert.equal(summary.relationTypes.includes('one_to_many'), true);
  assert.deepEqual(summary.countModes, POSTGRES_DATA_COUNT_MODES);
  assert.deepEqual(summary.paginationMetadataModes, POSTGRES_DATA_PAGINATION_METADATA_MODES);
  assert.equal(capabilitySummary.find((entry) => entry.operation === 'export').capability, 'postgres_data_export');
  assert.equal(capabilitySummary.find((entry) => entry.operation === 'scoped_credential').capability, 'postgres_data_scoped_credential');
});

test('postgres data API plan builder supports filters projections joins ordering and cursors', () => {
  const cursor = serializePostgresDataApiCursor({
    order: [
      { columnName: 'createdAt', direction: 'desc', value: '2026-03-24T00:00:00.000Z' },
      { columnName: 'id', direction: 'asc', value: 'ord_002' }
    ]
  });
  const plan = buildPostgresDataApiPlan({
    operation: 'list',
    workspaceId: 'wrk_01alphaprod',
    databaseName: 'tenant_alpha_main',
    table: baseTable,
    select: ['id', 'status', 'totalAmount', 'createdAt'],
    joins: [{ relation: 'customer', select: ['id', 'displayName', 'segment'] }],
    filters: [
      { column: 'status', operator: 'eq', value: 'open' },
      { column: 'totalAmount', operator: 'gte', value: 100 },
      { column: 'payload', operator: 'json_path_eq', path: ['priority'], value: 'high' }
    ],
    order: [{ column: 'createdAt', direction: 'desc' }],
    page: { size: 25, after: cursor },
    responseOptions: { countMode: 'exact', paginationMode: 'full' },
    actorId: 'usr_01alpha',
    originSurface: 'console',
    correlationId: 'corr_pgdata_01',
    ...accessContext
  });

  assert.equal(plan.capability, 'postgres_data_select');
  assert.equal(plan.effectiveRoleName, 'alpha_runtime');
  assert.equal(plan.access.reason, 'grant_and_rls_filter');
  assert.equal(plan.joins[0].relationName, 'customer');
  assert.equal(plan.selection.includes('totalAmount'), true);
  assert.equal(plan.sql.text.includes('LEFT JOIN LATERAL'), true);
  assert.equal(plan.sql.text.includes('jsonb_extract_path_text(base."payload"'), true);
  assert.equal(plan.sql.text.includes('ORDER BY base."createdAt" DESC, base."id" ASC'), true);
  assert.equal(plan.sql.text.includes('LIMIT 25'), true);
  assert.equal(plan.sql.values.includes('ten_alpha'), true);
  assert.equal(plan.page.size, 25);
  assert.equal(plan.page.metadataMode, 'full');
  assert.equal(plan.response.countMode, 'exact');
  assert.equal(plan.response.count.sql.text.includes('SELECT COUNT(*) AS totalCount'), true);
  assert.equal(plan.trace.actorId, 'usr_01alpha');
  assert.equal(plan.trace.originSurface, 'console');
  assert.equal(plan.trace.sessionSettings.some((entry) => entry.key === 'app.current_workspace_id'), true);
});


test('postgres data API plan builder supports RPC-style routine execution with bound parameters', () => {
  const plan = buildPostgresDataApiPlan({
    operation: 'rpc',
    workspaceId: 'wrk_01alphaprod',
    databaseName: 'tenant_alpha_main',
    schemaName: 'alpha_prod_app',
    routineName: 'get_customer_order',
    routine: {
      schemaName: 'alpha_prod_app',
      routineName: 'get_customer_order',
      signature: 'get_customer_order(uuid, text)',
      returnsSet: true,
      exposedAsRpc: true,
      arguments: [
        { name: 'customerId', dataType: 'uuid' },
        { name: 'tenantId', dataType: 'text' }
      ]
    },
    arguments: { customerId: 'cus_01', tenantId: 'ten_alpha' },
    actorRoleName: 'workspace_developer',
    effectiveRoles: ['workspace_developer', 'alpha_runtime'],
    schemaGrants: [
      { granteeRoleName: 'alpha_runtime', privileges: ['usage'], target: { schemaName: 'alpha_prod_app' } }
    ],
    objectGrants: [
      { granteeRoleName: 'alpha_runtime', privileges: ['execute'], target: { schemaName: 'alpha_prod_app', objectName: 'get_customer_order' } }
    ],
    actorId: 'usr_02beta',
    originSurface: 'stable_endpoint'
  });

  assert.equal(plan.capability, 'postgres_data_rpc');
  assert.equal(plan.effectiveRoleName, 'alpha_runtime');
  assert.equal(plan.resource.routineName, 'get_customer_order');
  assert.equal(plan.routine.returnsSet, true);
  assert.equal(plan.sql.text.includes('FROM "alpha_prod_app"."get_customer_order"($1::uuid, $2::text)'), true);
  assert.deepEqual(plan.sql.values, ['cus_01', 'ten_alpha']);
  assert.equal(plan.trace.originSurface, 'stable_endpoint');
});

test('postgres data API plan builder supports bulk mutations, import/export, and trace metadata', () => {
  const bulkInsert = buildPostgresDataApiPlan({
    operation: 'bulk_insert',
    workspaceId: 'wrk_01alphaprod',
    databaseName: 'tenant_alpha_main',
    table: baseTable,
    rows: [
      { id: 'ord_100', tenantId: 'ten_alpha', customerId: 'cus_01', status: 'open', totalAmount: 120, payload: { priority: 'high' }, createdAt: '2026-03-24T00:00:00.000Z' },
      { id: 'ord_101', tenantId: 'ten_alpha', customerId: 'cus_02', status: 'open', totalAmount: 200, payload: { priority: 'normal' }, createdAt: '2026-03-24T00:05:00.000Z' }
    ],
    bulk: { limit: 10, hardLimit: 50, atomic: true },
    actorId: 'svc_ingestor',
    originSurface: 'external_api',
    ...accessContext
  });
  const bulkUpdate = buildPostgresDataApiPlan({
    operation: 'bulk_update',
    workspaceId: 'wrk_01alphaprod',
    databaseName: 'tenant_alpha_main',
    table: baseTable,
    operations: [
      { primaryKey: { id: 'ord_100' }, changes: { status: 'paid' } },
      { primaryKey: { id: 'ord_101' }, changes: { status: 'cancelled', totalAmount: 0 } }
    ],
    bulk: { limit: 10, hardLimit: 50 },
    ...accessContext
  });
  const bulkDelete = buildPostgresDataApiPlan({
    operation: 'bulk_delete',
    workspaceId: 'wrk_01alphaprod',
    databaseName: 'tenant_alpha_main',
    table: baseTable,
    primaryKeys: [{ id: 'ord_100' }, { id: 'ord_101' }],
    bulk: { limit: 10, hardLimit: 50 },
    ...accessContext
  });
  const jsonImport = buildPostgresDataApiPlan({
    operation: 'import',
    workspaceId: 'wrk_01alphaprod',
    databaseName: 'tenant_alpha_main',
    table: baseTable,
    format: 'json',
    rows: [{ id: 'ord_200', tenantId: 'ten_alpha', customerId: 'cus_03', status: 'open', totalAmount: 42, payload: { priority: 'high' }, createdAt: '2026-03-24T01:00:00.000Z' }],
    validateAfterImport: true,
    validationMode: 'row_count_and_schema',
    bulk: { limit: 5, hardLimit: 20 },
    ...accessContext
  });
  const exportPlan = buildPostgresDataApiPlan({
    operation: 'export',
    workspaceId: 'wrk_01alphaprod',
    databaseName: 'tenant_alpha_main',
    table: baseTable,
    format: 'csv',
    select: ['id', 'status', 'createdAt'],
    filters: [{ column: 'status', operator: 'eq', value: 'open' }],
    order: [{ column: 'createdAt', direction: 'desc' }],
    responseOptions: { countMode: 'estimated', paginationMode: 'basic' },
    ...accessContext
  });

  assert.equal(bulkInsert.capability, 'postgres_data_bulk_insert');
  assert.equal(bulkInsert.bulk.batchSize, 2);
  assert.equal(bulkInsert.sql.text.includes('INSERT INTO "alpha_prod_app"."customer_orders"'), true);
  assert.equal(bulkInsert.trace.originSurface, 'external_api');
  assert.equal(bulkUpdate.capability, 'postgres_data_bulk_update');
  assert.equal(bulkUpdate.sql.text.includes('WITH bulk_input'), true);
  assert.equal(bulkDelete.capability, 'postgres_data_bulk_delete');
  assert.equal(bulkDelete.sql.text.includes('DELETE FROM "alpha_prod_app"."customer_orders" AS base'), true);
  assert.equal(jsonImport.capability, 'postgres_data_import');
  assert.equal(jsonImport.import.validation.strategy, 'row_count_and_schema');
  assert.equal(exportPlan.capability, 'postgres_data_export');
  assert.equal(exportPlan.sql.text.includes('COPY ('), true);
  assert.equal(exportPlan.response.count.mode, 'estimated');
});

test('postgres data API governance helpers support scoped credentials, saved queries, and stable endpoints', () => {
  const scopedCredential = buildPostgresDataScopedCredential({
    workspaceId: 'wrk_01alphaprod',
    databaseName: 'tenant_alpha_main',
    credentialId: 'cred_orders_reader',
    credentialType: 'api_key',
    displayName: 'Orders reader',
    ttlSeconds: 7200,
    actorId: 'usr_admin_01',
    scopes: [
      {
        databaseName: 'tenant_alpha_main',
        schemaName: 'alpha_prod_app',
        tableName: 'customer_orders',
        allowedOperations: ['list', 'get', 'export'],
        savedQueryIds: ['orders_open'],
        endpointIds: ['orders_public']
      }
    ]
  });
  const savedQuery = buildPostgresSavedQueryDefinition({
    workspaceId: 'wrk_01alphaprod',
    databaseName: 'tenant_alpha_main',
    savedQueryId: 'orders_open',
    sourceType: 'table',
    schemaName: 'alpha_prod_app',
    tableName: 'customer_orders',
    select: ['id', 'status', 'createdAt'],
    filters: [{ column: 'status', operator: 'eq', value: { parameter: 'status' } }],
    parameters: [{ parameterName: 'status', required: true }],
    responseOptions: { countMode: 'exact', paginationMode: 'full' }
  });
  const savedQueryPlan = buildPostgresSavedQueryExecutionPlan({
    savedQuery: { ...savedQuery, table: baseTable },
    parameters: { status: 'open' },
    workspaceId: 'wrk_01alphaprod',
    databaseName: 'tenant_alpha_main',
    table: baseTable,
    ...accessContext
  });
  const endpoint = buildPostgresDataStableEndpointDefinition({
    workspaceId: 'wrk_01alphaprod',
    databaseName: 'tenant_alpha_main',
    endpointId: 'orders_public',
    slug: 'orders-public',
    sourceType: 'saved_query',
    httpMethod: 'POST',
    authModes: ['workspace_bearer', 'scoped_key'],
    responseOptions: { countMode: 'exact', paginationMode: 'full' }
  });
  const endpointPlan = buildPostgresDataStableEndpointInvocationPlan({
    endpoint: { ...endpoint, savedQuery: { ...savedQuery, table: baseTable } },
    savedQuery: { ...savedQuery, table: baseTable },
    parameters: { status: 'open' },
    workspaceId: 'wrk_01alphaprod',
    databaseName: 'tenant_alpha_main',
    table: baseTable,
    ...accessContext
  });

  assert.equal(scopedCredential.capability, 'postgres_data_scoped_credential');
  assert.equal(scopedCredential.scopes[0].allowedOperations.includes('export'), true);
  assert.equal(savedQuery.capability, 'postgres_data_saved_query');
  assert.equal(savedQuery.responseOptions.countMode, 'exact');
  assert.equal(savedQueryPlan.capability, 'postgres_data_saved_query_execute');
  assert.equal(savedQueryPlan.filters[0].value, 'open');
  assert.equal(endpoint.capability, 'postgres_data_stable_endpoint');
  assert.equal(endpoint.stablePath, '/v1/postgres/workspaces/wrk_01alphaprod/data/tenant_alpha_main/published/orders-public');
  assert.equal(endpointPlan.capability, 'postgres_data_stable_endpoint_invoke');
  assert.equal(endpointPlan.endpoint.slug, 'orders-public');
});
