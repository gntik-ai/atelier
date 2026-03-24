import test from 'node:test';
import assert from 'node:assert/strict';

import { getPublicRoute } from '../../services/internal-contracts/src/index.mjs';
import { validatePostgresAdminSqlRequest } from '../../services/adapters/src/postgresql-admin.mjs';

test('restricted admin SQL requests are blocked from public data-api style origins and service-account contexts', () => {
  const decision = validatePostgresAdminSqlRequest({
    planId: 'pln_01enterprise',
    scopes: ['database.read', 'database.write'],
    effectiveRoles: ['workspace_service_account'],
    originSurface: 'data_api',
    actorType: 'service_account',
    payload: {
      databaseName: 'tenant_alpha_main',
      sqlText: 'SELECT * FROM pg_stat_activity',
      executionMode: 'preview'
    }
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.violations.some((entry) => entry.includes('database.admin')), true);
  assert.equal(decision.violations.some((entry) => entry.includes('only available from')), true);
  assert.equal(decision.violations.some((entry) => entry.includes('human-operated admin contexts')), true);
});

test('route catalog clearly separates workspace data RPC from restricted admin SQL channel', () => {
  const rpcRoute = getPublicRoute('executePostgresDataRpc');
  const adminSqlRoute = getPublicRoute('executePostgresAdminSql');

  assert.equal(rpcRoute.path.includes('/data/'), true);
  assert.equal(rpcRoute.resourceType, 'postgres_data_rpc');
  assert.equal(adminSqlRoute.path.includes('/admin/'), true);
  assert.equal(adminSqlRoute.path.includes('/data/'), false);
  assert.equal(adminSqlRoute.resourceType, 'postgres_admin_sql');
  assert.equal(adminSqlRoute.adminChannel, 'restricted_admin_sql');
  assert.equal(adminSqlRoute.explicitConfirmationRequired, true);
  assert.deepEqual(adminSqlRoute.requiredPlanFlags, ['postgres.admin_sql', 'postgres.admin_sql.audit']);
});
