import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../services/provisioning-orchestrator/src/actions/credential-rotation-expiry-sweep.mjs';

test('expiry sweep processes expired rotations and tolerates partial failures', async () => {
  const events = [];
  const processed = await main({
    db: {},
    repo: {
      async listExpiredRotations() { return [{ id: 'r1', tenant_id: 'ten_1', workspace_id: 'wrk_1', service_account_id: 'svc_1', old_credential_id: 'old1', new_credential_id: 'new1', rotation_type: 'grace_period', grace_period_seconds: 10, initiated_by: 'usr_1', initiated_at: new Date().toISOString() }, { id: 'r2', tenant_id: 'ten_1', workspace_id: 'wrk_1', service_account_id: 'svc_2', old_credential_id: 'old2', new_credential_id: 'new2', rotation_type: 'grace_period', grace_period_seconds: 10, initiated_by: 'usr_1', initiated_at: new Date().toISOString() }]; },
      async completeRotation(_db, { id }) { return { id, completed_at: new Date().toISOString() }; },
      async writeRotationHistory() {}
    },
    async revokeCredential(id) { if (id === 'old2') throw Object.assign(new Error('boom'), { code: 'FAIL' }); },
    async removeGatewayCredential() {},
    async publishEvent(topic, payload) { events.push({ topic, payload }); }
  });
  assert.equal(processed.processed, 1);
  assert.equal(processed.errors.length, 1);
  assert.equal(events[0].topic, 'console.credential-rotation.deprecated-expired');
});
