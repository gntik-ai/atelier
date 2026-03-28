import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPostgresAdminQueryConsole } from '../../../apps/web-console/src/actions/postgres-admin.mjs';
import { buildPostgresAdminSqlAdapterCall } from '../../../services/adapters/src/postgresql-admin.mjs';

test('admin SQL console flow preserves preview history and confirmation fingerprint between preview and execute', () => {
  const previewCall = buildPostgresAdminSqlAdapterCall({
    callId: 'call_console_admin_sql_preview',
    tenantId: 'ten_alpha',
    workspaceId: 'wrk_01alphaprod',
    planId: 'pln_01enterprise',
    scopes: ['database.admin'],
    effectiveRoles: ['workspace_admin'],
    correlationId: 'corr_console_admin_sql_preview',
    authorizationDecisionId: 'authz_console_admin_sql_preview',
    idempotencyKey: 'idem_console_admin_sql_preview',
    targetRef: 'postgres://tenant_alpha_main/admin-sql',
    payload: {
      databaseName: 'tenant_alpha_main',
      schemaName: 'pg_catalog',
      sqlText: 'SELECT pid FROM pg_stat_activity WHERE datname = :databaseName',
      parameters: { databaseName: 'tenant_alpha_main' },
      executionMode: 'preview',
      queryLabel: 'Inspect sessions'
    },
    context: {
      originSurface: 'web_console',
      actorType: 'human_operator'
    }
  });

  const consoleModel = buildPostgresAdminQueryConsole({
    workspaceId: 'wrk_01alphaprod',
    databaseName: 'tenant_alpha_main',
    draft: {
      sqlText: 'SELECT pid FROM pg_stat_activity WHERE datname = :databaseName',
      parameters: { databaseName: 'tenant_alpha_main' },
      executionMode: 'execute',
      queryLabel: 'Inspect sessions'
    },
    history: [
      {
        historyId: 'hist_console_01',
        queryLabel: 'Inspect sessions',
        databaseName: 'tenant_alpha_main',
        executionMode: 'preview',
        statementFingerprint: previewCall.payload.queryPreview.statementFingerprint,
        statementType: previewCall.payload.queryPreview.statementType,
        preExecutionWarnings: previewCall.payload.preExecutionWarnings
      }
    ],
    queryPreview: previewCall.payload.queryPreview,
    preExecutionWarnings: previewCall.payload.preExecutionWarnings,
    riskProfile: previewCall.payload.riskProfile
  });

  const executeCall = buildPostgresAdminSqlAdapterCall({
    callId: 'call_console_admin_sql_execute',
    tenantId: 'ten_alpha',
    workspaceId: 'wrk_01alphaprod',
    planId: 'pln_01enterprise',
    scopes: ['database.admin'],
    effectiveRoles: ['workspace_admin'],
    correlationId: 'corr_console_admin_sql_execute',
    authorizationDecisionId: 'authz_console_admin_sql_execute',
    idempotencyKey: 'idem_console_admin_sql_execute',
    targetRef: 'postgres://tenant_alpha_main/admin-sql',
    payload: {
      databaseName: 'tenant_alpha_main',
      schemaName: 'pg_catalog',
      sqlText: 'SELECT pid FROM pg_stat_activity WHERE datname = :databaseName',
      parameters: { databaseName: 'tenant_alpha_main' },
      executionMode: 'execute',
      confirmation: {
        confirmed: true,
        statementFingerprint: consoleModel.confirmation.statementFingerprint
      }
    },
    context: {
      originSurface: 'web_console',
      actorType: 'human_operator'
    }
  });

  assert.equal(consoleModel.route.operationId, 'executePostgresAdminSql');
  assert.equal(consoleModel.history[0].statementFingerprint, previewCall.payload.queryPreview.statementFingerprint);
  assert.equal(consoleModel.confirmation.required, true);
  assert.equal(executeCall.payload.queryPreview.statementFingerprint, previewCall.payload.queryPreview.statementFingerprint);
});
