import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluatePostgresDataApiAccess } from '../../services/adapters/src/postgresql-admin.mjs';
import {
  buildPostgresDataApiPlan,
  buildPostgresDataScopedCredential
} from '../../services/adapters/src/postgresql-data-api.mjs';

test('data API access evaluation requires both schema/table grants and a matching tenant RLS predicate', () => {
  const allowed = evaluatePostgresDataApiAccess({
    actorRoleName: 'alpha_runtime',
    command: 'select',
    schemaGrants: [
      {
        granteeRoleName: 'alpha_runtime',
        privileges: ['usage'],
        target: { schemaName: 'alpha_prod_app' }
      }
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
    row: { tenantId: 'ten_alpha' },
    resource: { schemaName: 'alpha_prod_app', tableName: 'customer_orders' }
  });
  const filtered = evaluatePostgresDataApiAccess({
    actorRoleName: 'alpha_runtime',
    command: 'select',
    schemaGrants: [
      {
        granteeRoleName: 'alpha_runtime',
        privileges: ['usage'],
        target: { schemaName: 'alpha_prod_app' }
      }
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
    row: { tenantId: 'ten_beta' },
    resource: { schemaName: 'alpha_prod_app', tableName: 'customer_orders' }
  });

  assert.equal(allowed.allowed, true);
  assert.equal(allowed.reason, 'grant_and_rls_allow');
  assert.equal(filtered.allowed, false);
  assert.equal(filtered.reason, 'rls_filtered');
});

test('data API access evaluation blocks requests missing grants even when RLS would match', () => {
  const decision = evaluatePostgresDataApiAccess({
    actorRoleName: 'alpha_runtime',
    command: 'select',
    schemaGrants: [],
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
    row: { tenantId: 'ten_alpha' },
    resource: { schemaName: 'alpha_prod_app', tableName: 'customer_orders' }
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'missing_grant');
});

test('bulk data operations enforce configured limits before SQL generation', () => {
  assert.throws(
    () =>
      buildPostgresDataApiPlan({
        operation: 'bulk_insert',
        workspaceId: 'wrk_01alphaprod',
        databaseName: 'tenant_alpha_main',
        table: {
          schemaName: 'alpha_prod_app',
          tableName: 'customer_orders',
          columns: [
            { columnName: 'id', primaryKey: true, nullable: false, dataType: 'uuid' },
            { columnName: 'tenantId', nullable: false, dataType: 'text' }
          ],
          primaryKey: ['id']
        },
        rows: [
          { id: 'ord_001', tenantId: 'ten_alpha' },
          { id: 'ord_002', tenantId: 'ten_alpha' }
        ],
        bulk: { limit: 1, hardLimit: 10 },
        actorRoleName: 'workspace_writer',
        effectiveRoles: ['workspace_writer', 'alpha_runtime'],
        schemaGrants: [{ granteeRoleName: 'alpha_runtime', privileges: ['usage'], target: { schemaName: 'alpha_prod_app' } }],
        objectGrants: [{ granteeRoleName: 'alpha_runtime', privileges: ['insert'], target: { schemaName: 'alpha_prod_app', objectName: 'customer_orders' } }],
        tableSecurity: { rlsEnabled: true },
        policies: [
          {
            appliesTo: { command: 'insert', roles: ['alpha_runtime'] },
            runtimePredicate: { kind: 'session_equals_row', sessionKey: 'tenantId', columnName: 'tenantId' }
          }
        ],
        sessionContext: { tenantId: 'ten_alpha' }
      }),
    /exceeds the configured limit/
  );
});

test('scoped PostgreSQL credentials reject ambiguous routine and table scopes', () => {
  assert.throws(
    () =>
      buildPostgresDataScopedCredential({
        workspaceId: 'wrk_01alphaprod',
        databaseName: 'tenant_alpha_main',
        credentialId: 'cred_bad_scope',
        scopes: [
          {
            databaseName: 'tenant_alpha_main',
            schemaName: 'alpha_prod_app',
            tableName: 'customer_orders',
            routineName: 'get_customer_order',
            allowedOperations: ['list']
          }
        ]
      }),
    /cannot target both a table and a routine/
  );
});
