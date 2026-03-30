import test from 'node:test';
import assert from 'node:assert/strict';
import { createOperation } from '../../services/provisioning-orchestrator/src/models/async-operation.mjs';
import { findPolicyForType } from '../../services/provisioning-orchestrator/src/repositories/async-operation-repo.mjs';

test('findPolicyForType prefers specific policy and falls back to default', async () => {
  const db = {
    async query(_sql, [operation_type]) {
      if (operation_type === 'create-workspace') {
        return { rows: [{ operation_type: 'create-workspace', timeout_minutes: 10 }] };
      }
      return { rows: [{ operation_type: '*', timeout_minutes: 60 }] };
    }
  };

  assert.equal((await findPolicyForType(db, { operation_type: 'create-workspace' })).operation_type, 'create-workspace');
  assert.equal((await findPolicyForType(db, { operation_type: 'unknown' })).operation_type, '*');
});

test('createOperation stores timeout_policy_snapshot for snapshot isolation', () => {
  const policy = { timeout_minutes: 10, orphan_threshold_minutes: 30 };
  const operation = createOperation({
    tenant_id: 'tenant-1',
    actor_id: 'actor-1',
    actor_type: 'tenant_owner',
    operation_type: 'create-workspace',
    timeout_policy_snapshot: policy
  });

  policy.timeout_minutes = 999;
  assert.deepEqual(operation.timeout_policy_snapshot, { timeout_minutes: 10, orphan_threshold_minutes: 30 });
});
