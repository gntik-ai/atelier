import * as repo from '../repositories/secret-rotation-repo.mjs';

export function resolveDependencies(params = {}) {
  return {
    db: params.db,
    repo: params.repo ?? repo,
    publishEvent: params.publishEvent ?? (async () => {})
  };
}

export async function main(params = {}) {
  const { db, repo: dataRepo, publishEvent } = resolveDependencies(params);
  const { consumerId, secretPath, vaultVersion } = params;
  const before = await dataRepo.listPendingPropagations(db, { secretPath, vaultVersion });
  await dataRepo.confirmPropagation(db, { secretPath, vaultVersion, consumerId });
  const version = await dataRepo.getVersionByVaultVersion(db, { secretPath, vaultVersion });
  if (before.some((row) => row.consumer_id === consumerId)) {
    await dataRepo.insertRotationEvent(db, {
      secretPath,
      domain: version?.domain ?? 'platform',
      tenantId: version?.tenant_id ?? null,
      eventType: 'consumer_reload_confirmed',
      vaultVersionNew: vaultVersion,
      actorId: consumerId,
      actorRoles: ['consumer'],
      detail: { consumerId }
    });
  }
  await publishEvent('console.secrets.consumer.reload-confirmed', {
    consumerId,
    secretPath,
    vaultVersion,
    confirmedAt: new Date().toISOString()
  });
  return { ack: true };
}
