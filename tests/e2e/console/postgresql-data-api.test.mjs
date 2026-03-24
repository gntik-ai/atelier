import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPostgresDataApiPlan } from '../../../services/adapters/src/postgresql-data-api.mjs';

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
