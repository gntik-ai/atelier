import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPostgresDataApiPlan,
  buildPostgresDataStableEndpointInvocationPlan,
  buildPostgresSavedQueryExecutionPlan
} from '../../../services/adapters/src/postgresql-data-api.mjs';

function buildWorkspaceFixture(overrides = {}) {
  return {
    workspaceId: 'wrk_01alphaprod',
    databaseName: 'tenant_alpha_main',
    table: {
      schemaName: 'alpha_prod_app',
      tableName: 'customer_orders',
      columns: [
        { columnName: 'id', primaryKey: true, nullable: false, dataType: 'uuid' },
        { columnName: 'tenantId', nullable: false, dataType: 'text' },
        { columnName: 'customerId', nullable: false, dataType: 'uuid' },
        { columnName: 'status', nullable: false, dataType: 'text' },
        { columnName: 'totalAmount', nullable: false, dataType: 'numeric' },
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
              { columnName: 'displayName', nullable: false, dataType: 'text' }
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
        },
        {
          relationName: 'internalNotes',
          relationType: 'one_to_many',
          sourceColumn: 'id',
          targetColumn: 'orderId',
          target: {
            schemaName: 'alpha_prod_app',
            tableName: 'order_internal_notes',
            columns: [
              { columnName: 'id', primaryKey: true, nullable: false, dataType: 'uuid' },
              { columnName: 'orderId', nullable: false, dataType: 'uuid' },
              { columnName: 'tenantId', nullable: false, dataType: 'text' },
              { columnName: 'body', nullable: false, dataType: 'text' }
            ],
            primaryKey: ['id'],
            schemaGrants: [
              { granteeRoleName: 'alpha_runtime', privileges: ['usage'], target: { schemaName: 'alpha_prod_app' } }
            ],
            objectGrants: [],
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
    },
    actorRoleName: 'workspace_viewer',
    effectiveRoles: ['workspace_viewer', 'alpha_runtime'],
    schemaGrants: [
      { granteeRoleName: 'alpha_runtime', privileges: ['usage'], target: { schemaName: 'alpha_prod_app' } }
    ],
    objectGrants: [
      {
        granteeRoleName: 'alpha_runtime',
        privileges: ['select'],
        target: { schemaName: 'alpha_prod_app', objectName: 'customer_orders' }
      }
    ],
    tableSecurity: { rlsEnabled: true },
    policies: [
      {
        appliesTo: { command: 'select', roles: ['alpha_runtime'] },
        runtimePredicate: { kind: 'session_equals_row', sessionKey: 'tenantId', columnName: 'tenantId' }
      }
    ],
    sessionContext: { tenantId: 'ten_alpha' },
    ...overrides
  };
}

test('workspace data API query plan supports related customer reads while preserving tenant RLS', () => {
  const plan = buildPostgresDataApiPlan({
    operation: 'list',
    ...buildWorkspaceFixture(),
    select: ['id', 'status', 'totalAmount'],
    joins: [{ relation: 'customer', select: ['id', 'displayName'] }],
    filters: [{ column: 'status', operator: 'eq', value: 'open' }],
    order: [{ column: 'createdAt', direction: 'desc' }],
    page: { size: 20 }
  });

  assert.equal(plan.effectiveRoleName, 'alpha_runtime');
  assert.equal(plan.access.rlsEnforced, true);
  assert.equal(plan.joins[0].relationName, 'customer');
  assert.equal(plan.sql.text.includes('FROM "alpha_prod_app"."customer_orders" AS base'), true);
  assert.equal(plan.sql.text.includes('FROM "alpha_prod_app"."customers" AS customer_rel'), true);
  assert.equal(plan.sql.text.includes('customer_rel."tenantId" ='), true);
  assert.equal(plan.sql.text.includes('base."tenantId" ='), true);
});

test('workspace data API query plan blocks related tables that are outside the effective grant surface', () => {
  assert.throws(
    () =>
      buildPostgresDataApiPlan({
        operation: 'list',
        ...buildWorkspaceFixture(),
        select: ['id', 'status'],
        joins: [{ relation: 'internalNotes', select: ['id', 'body'] }]
      }),
    /No effective role satisfies/
  );
});

test('workspace data API surfaces optional count metadata for external-console exports', () => {
  const plan = buildPostgresDataApiPlan({
    operation: 'export',
    ...buildWorkspaceFixture(),
    format: 'csv',
    select: ['id', 'status', 'createdAt'],
    filters: [{ column: 'status', operator: 'eq', value: 'open' }],
    order: [{ column: 'createdAt', direction: 'desc' }],
    responseOptions: { countMode: 'exact', paginationMode: 'basic' },
    originSurface: 'console'
  });

  assert.equal(plan.capability, 'postgres_data_export');
  assert.equal(plan.response.count.mode, 'exact');
  assert.equal(plan.sql.text.includes('COPY ('), true);
  assert.equal(plan.trace.originSurface, 'console');
});

test('workspace data API can execute saved queries and published stable endpoints with shared pagination semantics', () => {
  const fixture = buildWorkspaceFixture();
  const savedQuery = {
    workspaceId: fixture.workspaceId,
    databaseName: fixture.databaseName,
    savedQueryId: 'orders_open',
    sourceType: 'table',
    schemaName: 'alpha_prod_app',
    tableName: 'customer_orders',
    select: ['id', 'status'],
    filters: [{ column: 'status', operator: 'eq', value: { parameter: 'status' } }],
    parameters: [{ parameterName: 'status', required: true }],
    responseOptions: { countMode: 'estimated', paginationMode: 'full' },
    table: fixture.table
  };

  const savedQueryPlan = buildPostgresSavedQueryExecutionPlan({
    savedQuery,
    parameters: { status: 'open' },
    table: fixture.table,
    ...fixture
  });
  const endpointPlan = buildPostgresDataStableEndpointInvocationPlan({
    endpoint: {
      workspaceId: fixture.workspaceId,
      databaseName: fixture.databaseName,
      endpointId: 'orders_public',
      slug: 'orders-public',
      sourceType: 'saved_query',
      authModes: ['workspace_bearer'],
      responseOptions: { countMode: 'estimated', paginationMode: 'full' },
      savedQuery
    },
    savedQuery,
    parameters: { status: 'open' },
    table: fixture.table,
    ...fixture
  });

  assert.equal(savedQueryPlan.capability, 'postgres_data_saved_query_execute');
  assert.equal(savedQueryPlan.response.countMode, 'estimated');
  assert.equal(savedQueryPlan.page.metadataMode, 'full');
  assert.equal(endpointPlan.capability, 'postgres_data_stable_endpoint_invoke');
  assert.equal(endpointPlan.endpoint.stablePath, '/v1/postgres/workspaces/wrk_01alphaprod/data/tenant_alpha_main/published/orders-public');
  assert.equal(endpointPlan.response.paginationMode, 'full');
});
