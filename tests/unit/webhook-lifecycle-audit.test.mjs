import test from 'node:test';
import assert from 'node:assert/strict';
import {
  auditRowToRecord,
  recordAuditEventInTransaction,
} from '../../apps/control-plane/audit-store.mjs';

test('P4 platform-maintenance audit uses the established sanitized internal record shape', async () => {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });
      if (/SELECT row_hash/.test(sql)) return { rows: [] };
      if (/INSERT INTO plan_audit_events/.test(sql)) {
        const [
          id, action_type, actor_id, tenant_id, previous_state, new_state,
          outcome, correlation_id, created_at, prev_hash, row_hash,
        ] = params;
        return {
          rows: [{
            id,
            action_type,
            actor_id,
            tenant_id,
            previous_state: previous_state ? JSON.parse(previous_state) : null,
            new_state: JSON.parse(new_state),
            outcome,
            correlation_id,
            created_at,
            prev_hash,
            row_hash,
          }],
        };
      }
      return { rows: [] };
    },
  };
  const row = await recordAuditEventInTransaction(client, {
    actionType: 'webhook.master-key.rotate',
    actorId: 'falcone:platform-maintenance',
    tenantId: null,
    outcome: 'succeeded',
    correlationId: 'rotate-audit-001',
    newState: {
      actionCategory: 'configuration_change',
      source: 'platform-maintenance',
      action: 'rotate',
      requestId: 'rotate-audit-001',
      rotationId: 'rotation-audit-001',
      sourceKeyId: `wk1:${'a'.repeat(64)}`,
      targetKeyId: `wk1:${'b'.repeat(64)}`,
      state: 'completed',
      affectedCount: 7,
      verifiedCount: 7,
      recoveryDeadline: '2026-07-30T12:00:00.000Z',
      errorCode: null,
    },
  }, {
    id: '11111111-1111-4111-8111-111111111111',
    createdAt: '2026-07-23T12:00:00.000Z',
  });
  const record = auditRowToRecord(row);
  assert.equal(record.actor.actorId, 'falcone:platform-maintenance');
  assert.equal(record.scope.tenantId, null);
  assert.equal(record.action.actionId, 'webhook.master-key.rotate');
  assert.equal(record.result.outcome, 'succeeded');
  assert.equal(record.correlationId, 'rotate-audit-001');
  assert.equal(record.detail.source, 'platform-maintenance');
  assert.equal(record.detail.affectedCount, 7);
  assert.equal(record.detail.verifiedCount, 7);
  assert.equal(calls.some(({ sql }) => /^BEGIN|^COMMIT/.test(sql.trim())), false);
  assert.match(
    calls.find(({ sql }) => /SELECT row_hash/.test(sql)).sql,
    /tenant_id IS NOT DISTINCT FROM \$1/,
  );
  assert.doesNotMatch(
    JSON.stringify(record),
    /keyBytes|WEBHOOK_SIGNING_KEY|secret_cipher|secret_iv|ciphertext|plaintext|v1:[A-Za-z0-9_-]{43}/,
  );
});
