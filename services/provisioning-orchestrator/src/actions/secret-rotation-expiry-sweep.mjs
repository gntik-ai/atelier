import * as repo from '../repositories/secret-rotation-repo.mjs';

const DEFAULT_BATCH_SIZE = parseInt(process.env.SECRET_ROTATION_SWEEP_BATCH_SIZE ?? '50', 10);

export function resolveDependencies(params = {}) {
  return {
    db: params.db,
    repo: params.repo ?? repo,
    vaultClient: params.vaultClient ?? { async deleteSecretVersion() {} },
    publishEvent: params.publishEvent ?? (async () => {})
  };
}

export async function main(params = {}) {
  const { db, repo: dataRepo, vaultClient, publishEvent } = resolveDependencies(params);
  const batchSize = params.batchSize ?? DEFAULT_BATCH_SIZE;
  const versions = await dataRepo.listExpiredGraceVersions(db, batchSize);
  const errors = [];
  let processed = 0;

  for (const version of versions) {
    try {
      await dataRepo.expireGraceVersion(db, { id: version.id, actorId: 'system:expiry-sweep' });
      await vaultClient.deleteSecretVersion(version.secret_path, version.vault_version);
      await dataRepo.insertRotationEvent(db, {
        secretPath: version.secret_path,
        domain: version.domain,
        tenantId: version.tenant_id,
        eventType: 'grace_expired',
        vaultVersionOld: version.vault_version,
        actorId: 'system:expiry-sweep',
        actorRoles: ['system'],
        detail: {}
      });
      await publishEvent('console.secrets.rotation.grace-expired', {
        secretPath: version.secret_path,
        vaultVersionOld: version.vault_version,
        expiredAt: new Date().toISOString()
      });
      processed += 1;
    } catch (error) {
      errors.push({ secretPath: version.secret_path, vaultVersion: version.vault_version, message: error.message });
    }
  }

  return { processed, errors };
}
