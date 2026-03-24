import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPostgresDataApiPlan,
  parsePostgresDataApiCursor,
  serializePostgresDataApiCursor
} from '../../services/adapters/src/postgresql-data-api.mjs';

function buildAccessContext(overrides = {}) {
  return {
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
    sessionContext: { tenantId: 'ten_alpha' },
    ...overrides
  };
}

function buildTable(overrides = {}) {
  return {
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
    ...overrides
  };
}

test('postgres data API plan builder renders list, insert, update, and delete plans with RLS-aware SQL', () => {
  const listCursor = serializePostgresDataApiCursor({
    order: [
      { columnName: 'createdAt', direction: 'desc', value: '2026-03-24T12:00:00.000Z' },
      { columnName: 'id', direction: 'asc', value: 'ord_002' }
    ]
  });
  const listPlan = buildPostgresDataApiPlan({
    operation: 'list',
    workspaceId: 'wrk_01alphaprod',
    databaseName: 'tenant_alpha_main',
    table: buildTable(),
    select: ['id', 'status', 'createdAt'],
    filters: [
      { column: 'status', operator: 'in', value: ['open', 'paid'] },
      { column: 'payload', operator: 'json_contains', value: { source: 'checkout' } },
      { column: 'totalAmount', operator: 'between', value: [100, 500] }
    ],
    order: [{ column: 'createdAt', direction: 'desc' }],
    page: { size: 10, after: listCursor },
    ...buildAccessContext()
  });
  const insertPlan = buildPostgresDataApiPlan({
    operation: 'insert',
    workspaceId: 'wrk_01alphaprod',
    databaseName: 'tenant_alpha_main',
    table: buildTable(),
    select: ['id', 'status'],
    values: {
      id: 'ord_003',
      tenantId: 'ten_alpha',
      customerId: 'cus_003',
      status: 'open',
      totalAmount: 199,
      payload: { source: 'checkout' },
      createdAt: '2026-03-24T18:00:00.000Z'
    },
    ...buildAccessContext()
  });
  const updatePlan = buildPostgresDataApiPlan({
    operation: 'update',
    workspaceId: 'wrk_01alphaprod',
    databaseName: 'tenant_alpha_main',
    table: buildTable(),
    primaryKey: { id: 'ord_003' },
    changes: { status: 'paid' },
    select: ['id', 'status'],
    ...buildAccessContext()
  });
  const deletePlan = buildPostgresDataApiPlan({
    operation: 'delete',
    workspaceId: 'wrk_01alphaprod',
    databaseName: 'tenant_alpha_main',
    table: buildTable(),
    primaryKey: { id: 'ord_003' },
    ...buildAccessContext()
  });

  assert.equal(parsePostgresDataApiCursor(listCursor).order[0].columnName, 'createdAt');
  assert.equal(listPlan.sql.text.includes('SELECT base."id" AS "id", base."status" AS "status", base."createdAt" AS "createdAt"'), true);
  assert.equal(listPlan.sql.text.includes('base."status" IN ('), true);
  assert.equal(listPlan.sql.text.includes('base."payload" @>'), true);
  assert.equal(listPlan.sql.text.includes('base."totalAmount" BETWEEN'), true);
  assert.equal(listPlan.sql.text.includes('base."tenantId" ='), true);
  assert.equal(listPlan.sql.text.includes('LIMIT 10'), true);
  assert.equal(listPlan.sql.values.includes('ten_alpha'), true);

  assert.equal(insertPlan.capability, 'postgres_data_insert');
  assert.equal(insertPlan.sql.text.includes('INSERT INTO "alpha_prod_app"."customer_orders"'), true);
  assert.equal(insertPlan.sql.text.includes('RETURNING "id", "status"'), true);
  assert.equal(insertPlan.mutation.returningColumns.includes('status'), true);

  assert.equal(updatePlan.capability, 'postgres_data_update');
  assert.equal(updatePlan.sql.text.includes('UPDATE "alpha_prod_app"."customer_orders" AS base'), true);
  assert.equal(updatePlan.sql.text.includes('SET "status" ='), true);
  assert.equal(updatePlan.sql.text.includes('RETURNING "id", "status"'), true);

  assert.equal(deletePlan.capability, 'postgres_data_delete');
  assert.equal(deletePlan.sql.text.includes('DELETE FROM "alpha_prod_app"."customer_orders" AS base'), true);
  assert.equal(deletePlan.sql.text.includes('RETURNING "id"'), true);
});

test('postgres data API adapter planner renders bulk, import, and export plans with bounded metadata', () => {
  const access = buildAccessContext({ actorRoleName: 'workspace_writer', effectiveRoles: ['workspace_writer', 'alpha_runtime'] });
  const bulkInsertPlan = buildPostgresDataApiPlan({
    operation: 'bulk_insert',
    workspaceId: 'wrk_01alphaprod',
    databaseName: 'tenant_alpha_main',
    table: buildTable(),
    rows: [
      {
        id: 'ord_100',
        tenantId: 'ten_alpha',
        customerId: 'cus_100',
        status: 'open',
        totalAmount: 110,
        payload: { source: 'checkout' },
        createdAt: '2026-03-24T19:00:00.000Z'
      },
      {
        id: 'ord_101',
        tenantId: 'ten_alpha',
        customerId: 'cus_101',
        status: 'paid',
        totalAmount: 99,
        payload: { source: 'checkout' },
        createdAt: '2026-03-24T20:00:00.000Z'
      }
    ],
    bulk: { limit: 20, hardLimit: 50, atomic: true },
    ...access
  });
  const importPlan = buildPostgresDataApiPlan({
    operation: 'import',
    workspaceId: 'wrk_01alphaprod',
    databaseName: 'tenant_alpha_main',
    table: buildTable(),
    format: 'csv',
    columns: ['id', 'tenantId', 'customerId', 'status', 'totalAmount', 'payload', 'createdAt'],
    csvText: 'id,tenantId,customerId,status,totalAmount,payload,createdAt\nord_102,ten_alpha,cus_102,open,55,{"source":"checkout"},2026-03-24T20:30:00.000Z',
    validateAfterImport: true,
    validationMode: 'row_count_and_checksum',
    ...access
  });
  const exportPlan = buildPostgresDataApiPlan({
    operation: 'export',
    workspaceId: 'wrk_01alphaprod',
    databaseName: 'tenant_alpha_main',
    table: buildTable(),
    format: 'json',
    select: ['id', 'status'],
    filters: [{ column: 'status', operator: 'eq', value: 'open' }],
    responseOptions: { countMode: 'estimated', paginationMode: 'basic' },
    ...buildAccessContext()
  });

  assert.equal(bulkInsertPlan.capability, 'postgres_data_bulk_insert');
  assert.equal(bulkInsertPlan.bulk.batchSize, 2);
  assert.equal(bulkInsertPlan.sql.text.includes('VALUES ($1, $2'), true);
  assert.equal(importPlan.capability, 'postgres_data_import');
  assert.equal(importPlan.sql.text.includes('COPY "alpha_prod_app"."customer_orders"'), true);
  assert.equal(importPlan.import.restore.requiresSecretFreeManifest, true);
  assert.equal(exportPlan.capability, 'postgres_data_export');
  assert.equal(exportPlan.response.count.mode, 'estimated');
  assert.equal(exportPlan.trace.sessionSettings.some((entry) => entry.key === 'app.current_workspace_id'), true);
});

test('postgres data API plan builder refuses inaccessible relations and missing session context for RLS-protected reads', () => {
  const tableWithRestrictedRelation = buildTable({
    relations: [
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
  });

  assert.throws(
    () =>
      buildPostgresDataApiPlan({
        operation: 'list',
        workspaceId: 'wrk_01alphaprod',
        databaseName: 'tenant_alpha_main',
        table: tableWithRestrictedRelation,
        joins: [{ relation: 'internalNotes', select: ['id', 'body'] }],
        ...buildAccessContext()
      }),
    /No effective role satisfies/
  );

  assert.throws(
    () =>
      buildPostgresDataApiPlan({
        operation: 'list',
        workspaceId: 'wrk_01alphaprod',
        databaseName: 'tenant_alpha_main',
        table: buildTable(),
        ...buildAccessContext({ sessionContext: {} })
      }),
    /missing_session_context/
  );
});
