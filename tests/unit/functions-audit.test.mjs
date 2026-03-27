import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AUDIT_ACTION_TYPES,
  AUDIT_SCOPE_ERROR_CODES,
  buildAuditCoverageReport,
  emitAdminActionAuditEvent,
  emitDeploymentAuditEvent,
  emitQuotaEnforcementEvent,
  emitRollbackEvidenceEvent,
  queryAuditRecords,
  queryQuotaEnforcement,
  queryRollbackEvidence
} from '../../apps/control-plane/src/functions-audit.mjs';

test('functions audit emitters publish typed deployment, admin, rollback, and quota events', () => {
  const published = [];
  const context = {
    actor: 'usr_01alice',
    tenantId: 'ten_01growthalpha',
    workspaceId: 'wrk_01alphadev',
    correlationId: 'corr_fn_audit_01',
    resourceId: 'res_01fnactionbilling',
    publishAuditEvent: (event, meta) => published.push({ event, meta })
  };

  const deploymentEventId = emitDeploymentAuditEvent(context, { deploymentNature: 'redeploy' });
  const adminEventId = emitAdminActionAuditEvent(context, { adminAction: 'visibility_change' });
  const rollbackEventId = emitRollbackEvidenceEvent(context, { sourceVersionId: 'fnv_01old', targetVersionId: 'fnv_01new', outcome: 'failure' });
  const quotaEventId = emitQuotaEnforcementEvent(context, { decision: 'denied', quotaDimension: 'function_count', denialReason: 'workspace limit exceeded' });

  assert.equal(published.length, 4);
  assert.equal(published[0].meta.topic, 'function.audit.events');
  assert.equal(published[0].event.actionType, AUDIT_ACTION_TYPES.DEPLOY);
  assert.equal(published[1].event.actionType, AUDIT_ACTION_TYPES.ADMIN);
  assert.equal(published[2].event.outcome, 'failure');
  assert.equal(published[3].event.decision, 'denied');
  assert.ok(deploymentEventId);
  assert.ok(adminEventId);
  assert.ok(rollbackEventId);
  assert.ok(quotaEventId);
});

test('functions audit queries enforce scope and bounded pagination', () => {
  assert.throws(() => queryAuditRecords({ tenantId: 'ten_a', workspaceId: 'wrk_a' }, { tenantId: 'ten_b' }), (error) => error.code === AUDIT_SCOPE_ERROR_CODES.SCOPE_VIOLATION);
  assert.throws(() => queryAuditRecords({ tenantId: 'ten_a', workspaceId: 'wrk_a' }, { workspaceId: 'wrk_b' }), (error) => error.code === AUDIT_SCOPE_ERROR_CODES.SCOPE_VIOLATION);
  assert.throws(() => queryAuditRecords({ tenantId: 'ten_a', workspaceId: 'wrk_a' }, { limit: 201 }), (error) => error.code === AUDIT_SCOPE_ERROR_CODES.LIMIT_EXCEEDED);

  const rollback = queryRollbackEvidence({ tenantId: 'ten_a', workspaceId: 'wrk_a', queryAuditRecords: (query) => ({ items: [{ actionType: query.actionType }], page: { size: query.limit } }) }, {});
  const quota = queryQuotaEnforcement({ tenantId: 'ten_a', workspaceId: 'wrk_a', queryAuditRecords: (query) => ({ items: [{ actionType: query.actionType }], page: { size: query.limit } }) }, {});

  assert.equal(rollback.items[0].actionType, AUDIT_ACTION_TYPES.ROLLBACK);
  assert.equal(quota.items[0].actionType, AUDIT_ACTION_TYPES.QUOTA_ENFORCED);
});

test('functions audit coverage is superadmin-only and strips business details', () => {
  assert.throws(() => buildAuditCoverageReport({ isSuperadmin: false }), (error) => error.code === AUDIT_SCOPE_ERROR_CODES.COVERAGE_UNAUTHORIZED);

  const report = buildAuditCoverageReport({
    isSuperadmin: true,
    queryCoverage: ({ expectedActionTypes }) => ({
      activeScopes: 3,
      coverageByActionType: expectedActionTypes.map((actionType) => ({ actionType, coveredScopes: 3, missingScopes: 0, functionId: 'hidden' }))
    })
  });

  assert.equal(report.activeScopes, 3);
  assert.equal(report.coverageByActionType[0].functionId, undefined);
  assert.deepEqual(report.expectedActionTypes, Object.values(AUDIT_ACTION_TYPES));
});
