import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AUDIT_SCOPE_ERROR_CODES,
  buildAuditCoverageReport,
  queryAuditRecords,
  queryQuotaEnforcement,
  queryRollbackEvidence
} from '../../apps/control-plane/src/functions-audit.mjs';

test('audit resilience denies cross-tenant and cross-workspace queries without exposing foreign records', () => {
  assert.throws(
    () => queryAuditRecords({ tenantId: 'ten_01a', workspaceId: 'wrk_01a' }, { tenantId: 'ten_01b', workspaceId: 'wrk_01foreign', foreignRecord: { actor: 'hidden' } }),
    (error) => error.code === AUDIT_SCOPE_ERROR_CODES.SCOPE_VIOLATION
  );
  assert.throws(
    () => queryAuditRecords({ tenantId: 'ten_01a', workspaceId: 'wrk_01a' }, { tenantId: 'ten_01a', workspaceId: 'wrk_01b', foreignRecord: { actor: 'hidden' } }),
    (error) => error.code === AUDIT_SCOPE_ERROR_CODES.SCOPE_VIOLATION
  );
});

test('audit resilience rejects non-superadmin coverage access and oversized queries', () => {
  assert.throws(() => buildAuditCoverageReport({ isSuperadmin: false }), (error) => error.code === AUDIT_SCOPE_ERROR_CODES.COVERAGE_UNAUTHORIZED);
  assert.throws(() => queryAuditRecords({ tenantId: 'ten_01a', workspaceId: 'wrk_01a' }, { limit: 201 }), (error) => error.code === AUDIT_SCOPE_ERROR_CODES.LIMIT_EXCEEDED);
});

test('audit resilience preserves failed rollback evidence and workspace-bounded quota enforcement visibility', () => {
  const rollback = queryRollbackEvidence({
    tenantId: 'ten_01a',
    workspaceId: 'wrk_01a',
    queryAuditRecords: () => ({ items: [{ outcome: 'failure' }], page: { size: 1 } })
  });
  const quota = queryQuotaEnforcement({
    tenantId: 'ten_01a',
    workspaceId: 'wrk_01b',
    queryAuditRecords: () => ({ items: [{ workspaceId: 'wrk_01b', decision: 'denied' }], page: { size: 1 } })
  });

  assert.equal(rollback.items[0].outcome, 'failure');
  assert.equal(quota.items.some((item) => item.workspaceId === 'wrk_01a'), false);
});
