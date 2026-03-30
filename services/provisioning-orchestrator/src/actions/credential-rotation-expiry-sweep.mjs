import { randomUUID } from 'node:crypto';
import { listExpiredRotations, completeRotation, writeRotationHistory } from '../repositories/credential-rotation-repo.mjs';

function resolveDependencies(params = {}) {
  return {
    db: params.db,
    repo: params.repo ?? { listExpiredRotations, completeRotation, writeRotationHistory },
    revokeCredential: params.revokeCredential ?? (async () => {}),
    removeGatewayCredential: params.removeGatewayCredential ?? (async () => {}),
    publishEvent: params.publishEvent ?? (async () => {})
  };
}

export async function main(params = {}) {
  const deps = resolveDependencies(params);
  const errors = [];
  let processed = 0;
  const rotations = await deps.repo.listExpiredRotations(deps.db, 100);

  for (const rotation of rotations) {
    try {
      await deps.revokeCredential(rotation.old_credential_id);
      await deps.removeGatewayCredential(rotation.old_credential_id);
      const completed = await deps.repo.completeRotation(deps.db, { id: rotation.id, completedBy: 'sweep', completionReason: 'expired' });
      await deps.repo.writeRotationHistory(deps.db, {
        id: randomUUID(),
        tenant_id: rotation.tenant_id,
        workspace_id: rotation.workspace_id,
        service_account_id: rotation.service_account_id,
        rotation_state_id: rotation.id,
        rotation_type: rotation.rotation_type,
        grace_period_seconds: rotation.grace_period_seconds,
        old_credential_id: rotation.old_credential_id,
        new_credential_id: rotation.new_credential_id,
        initiated_by: rotation.initiated_by,
        initiated_at: rotation.initiated_at,
        completed_at: completed?.completed_at ?? new Date().toISOString(),
        completed_by: 'sweep',
        completion_reason: 'expired'
      });
      await deps.publishEvent('console.credential-rotation.deprecated-expired', rotation);
      processed += 1;
    } catch (error) {
      errors.push({ id: rotation.id, code: error.code ?? 'INTERNAL_ERROR', message: error.message });
    }
  }
  return { processed, errors };
}
