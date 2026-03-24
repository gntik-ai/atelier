import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluatePostgresDataApiAccess } from '../../services/adapters/src/postgresql-admin.mjs';

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
