import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPostgresAdminSqlAdapterCall,
  resolvePostgresAdminSqlPolicy,
  validatePostgresAdminSqlRequest
} from '../../services/adapters/src/postgresql-admin.mjs';

test('postgres admin SQL preview call binds named parameters and exposes plan flags', () => {
  const call = buildPostgresAdminSqlAdapterCall({
    callId: 'call_pgsql_admin_preview',
    tenantId: 'ten_alpha',
    workspaceId: 'wrk_01alphaprod',
    planId: 'pln_01enterprise',
    scopes: ['database.admin'],
    effectiveRoles: ['workspace_admin'],
    correlationId: 'corr_pgsql_admin_preview',
    authorizationDecisionId: 'authz_pgsql_admin_preview',
    idempotencyKey: 'idem_pgsql_admin_preview',
    targetRef: 'postgres://tenant_alpha_main/admin-sql',
    payload: {
      databaseName: 'tenant_alpha_main',
      schemaName: 'pg_catalog',
      sqlText: 'SELECT pid, state FROM pg_stat_activity WHERE datname = :databaseName',
      parameters: { databaseName: 'tenant_alpha_main' },
      executionMode: 'preview'
    },
    context: {
      originSurface: 'web_console',
      actorType: 'human_operator'
    }
  });

  assert.equal(call.capability, 'postgres_admin_sql_execute');
  assert.equal(call.payload.compiledQuery.sqlText, 'SELECT pid, state FROM pg_stat_activity WHERE datname = $1');
  assert.deepEqual(call.payload.compiledQuery.values, ['tenant_alpha_main']);
  assert.equal(call.payload.queryPreview.planFlags.includes('postgres.admin_sql'), true);
  assert.equal(call.payload.queryPreview.parameterMode, 'named');
  assert.equal(call.payload.riskProfile.transactionMode, 'single_statement');
  assert.equal(call.payload.auditSummary.operationClass, 'administrative_sql');
});

test('postgres admin SQL execute call requires an explicit matching fingerprint confirmation', () => {
  const preview = buildPostgresAdminSqlAdapterCall({
    callId: 'call_pgsql_admin_preview_confirm',
    tenantId: 'ten_alpha',
    workspaceId: 'wrk_01alphaprod',
    planId: 'pln_01enterprise',
    scopes: ['database.admin'],
    effectiveRoles: ['workspace_admin'],
    correlationId: 'corr_pgsql_admin_preview_confirm',
    authorizationDecisionId: 'authz_pgsql_admin_preview_confirm',
    idempotencyKey: 'idem_pgsql_admin_preview_confirm',
    targetRef: 'postgres://tenant_alpha_main/admin-sql',
    payload: {
      databaseName: 'tenant_alpha_main',
      sqlText: 'VACUUM ANALYZE tenant_alpha_main.public.customer_orders',
      executionMode: 'preview'
    },
    context: {
      originSurface: 'web_console',
      actorType: 'human_operator'
    }
  });

  const execute = buildPostgresAdminSqlAdapterCall({
    callId: 'call_pgsql_admin_execute',
    tenantId: 'ten_alpha',
    workspaceId: 'wrk_01alphaprod',
    planId: 'pln_01enterprise',
    scopes: ['database.admin'],
    effectiveRoles: ['workspace_admin'],
    correlationId: 'corr_pgsql_admin_execute',
    authorizationDecisionId: 'authz_pgsql_admin_execute',
    idempotencyKey: 'idem_pgsql_admin_execute',
    targetRef: 'postgres://tenant_alpha_main/admin-sql',
    payload: {
      databaseName: 'tenant_alpha_main',
      sqlText: 'VACUUM ANALYZE tenant_alpha_main.public.customer_orders',
      executionMode: 'execute',
      confirmation: {
        confirmed: true,
        statementFingerprint: preview.payload.queryPreview.statementFingerprint
      }
    },
    context: {
      originSurface: 'web_console',
      actorType: 'human_operator'
    }
  });

  assert.equal(execute.payload.queryPreview.statementFingerprint, preview.payload.queryPreview.statementFingerprint);
  assert.equal(execute.payload.auditSummary.statementFingerprint, preview.payload.queryPreview.statementFingerprint);
  assert.equal(execute.payload.riskProfile.acknowledgementRequired, true);
});

test('postgres admin SQL policy blocks unauthorized plans and request origins', () => {
  const policy = resolvePostgresAdminSqlPolicy({
    planId: 'pln_01growth',
    originSurface: 'data_api',
    actorType: 'service_account',
    scopes: ['database.read'],
    effectiveRoles: ['workspace_service_account']
  });
  const validation = validatePostgresAdminSqlRequest({
    planId: 'pln_01growth',
    scopes: ['database.read'],
    effectiveRoles: ['workspace_service_account'],
    originSurface: 'data_api',
    actorType: 'service_account',
    payload: {
      databaseName: 'tenant_alpha_main',
      sqlText: 'SELECT 1',
      executionMode: 'preview'
    }
  });

  assert.equal(policy.enabled, false);
  assert.equal(validation.ok, false);
  assert.equal(validation.violations.some((entry) => entry.includes('postgres.admin_sql')), true);
  assert.equal(validation.violations.some((entry) => entry.includes('only available from')), true);
  assert.equal(validation.violations.some((entry) => entry.includes('human-operated admin contexts')), true);
});
