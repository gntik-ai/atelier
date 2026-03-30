import * as repo from '../repositories/secret-rotation-repo.mjs';

const DEFAULT_BATCH_SIZE = parseInt(process.env.SECRET_ROTATION_SWEEP_BATCH_SIZE ?? '50', 10);
const RELOAD_ACK_TIMEOUT_SECONDS = parseInt(process.env.RELOAD_ACK_TIMEOUT_SECONDS ?? '60', 10);

export function resolveDependencies(params = {}) {
  return {
    db: params.db,
    repo: params.repo ?? repo,
    publishEvent: params.publishEvent ?? (async () => {})
  };
}

export async function main(params = {}) {
  const { db, repo: dataRepo, publishEvent } = resolveDependencies(params);
  const timeoutThreshold = new Date(Date.now() - RELOAD_ACK_TIMEOUT_SECONDS * 1000);
  const rows = await dataRepo.listTimedOutPropagations(db, { timeoutThreshold, batchSize: DEFAULT_BATCH_SIZE });
  const errors = [];
  let processed = 0;

  for (const row of rows) {
    try {
      await dataRepo.markPropagationTimeout(db, { id: row.id });
      const target = await dataRepo.getVersionByVaultVersion(db, { secretPath: row.secret_path, vaultVersion: row.vault_version });
      await dataRepo.insertRotationEvent(db, {
        secretPath: row.secret_path,
        domain: target?.domain ?? 'platform',
        tenantId: target?.tenant_id ?? null,
        eventType: 'consumer_reload_timeout',
        vaultVersionNew: row.vault_version,
        actorId: 'system:propagation-timeout-sweep',
        actorRoles: ['system'],
        detail: { consumerId: row.consumer_id }
      });
      await publishEvent('console.secrets.consumer.reload-timeout', {
        consumerId: row.consumer_id,
        secretPath: row.secret_path,
        vaultVersion: row.vault_version
      });
      processed += 1;
    } catch (error) {
      errors.push({ id: row.id, message: error.message });
    }
  }

  return { processed, errors };
}
