import test from 'node:test';
import assert from 'node:assert/strict';

import {
  POSTGRES_DATA_API_OPERATIONS,
  buildPostgresDataApiPlan,
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

test('postgres data API control-plane helpers expose the CRUD/query surface', () => {
  const routes = listPostgresDataApiRoutes();
  const summary = summarizePostgresDataApiSurface();
  const capabilitySummary = summarizePostgresDataApiCapabilityMatrix();

  assert.equal(postgresDataApiFamily.id, 'postgres');
  assert.ok(routes.some((route) => route.path === '/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/rows'));
  assert.ok(routes.some((route) => route.path === '/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/rows/by-primary-key'));
  assert.equal(getPostgresDataApiRoute('listPostgresDataRows').resourceType, 'postgres_data_rows');
  assert.equal(getPostgresDataApiRoute('getPostgresDataRowByPrimaryKey').resourceType, 'postgres_data_row');
  assert.deepEqual(POSTGRES_DATA_API_OPERATIONS, ['list', 'get', 'insert', 'update', 'delete']);
  assert.equal(summary.routeCount, 5);
  assert.equal(summary.operations.find((entry) => entry.operation === 'list').routeCount, 1);
  assert.equal(summary.operations.find((entry) => entry.operation === 'get').routeCount, 1);
  assert.equal(summary.operations.find((entry) => entry.operation === 'insert').routeCount, 1);
  assert.equal(summary.operations.find((entry) => entry.operation === 'update').routeCount, 1);
  assert.equal(summary.filterOperators.includes('json_contains'), true);
  assert.equal(summary.relationTypes.includes('one_to_many'), true);
  assert.equal(capabilitySummary.find((entry) => entry.operation === 'delete').capability, 'postgres_data_delete');
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
});
