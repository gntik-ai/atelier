import * as repo from '../repositories/secret-rotation-repo.mjs';

function allowed(auth, domain, tenantId) {
  const roles = auth?.roles ?? [];
  if (roles.includes('superadmin')) return true;
  if (roles.includes('platform-operator') && ['platform', 'gateway', 'iam', 'functions'].includes(domain)) return true;
  if (roles.includes('tenant-owner') && domain === 'tenant' && auth?.tenantId === tenantId) return true;
  return false;
}

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
  const { auth, secretPath, domain, tenantId, vaultVersion, justification, forceRevoke = false } = params;
  if (!allowed(auth, domain, tenantId)) return { error: { code: 'FORBIDDEN', status: 403 } };

  const target = await dataRepo.getVersionByVaultVersion(db, { secretPath, vaultVersion });
  if (!target) return { error: { code: 'VERSION_NOT_FOUND', status: 404 } };

  const allValid = [await dataRepo.getActiveVersion(db, secretPath), await dataRepo.getGraceVersion(db, secretPath)].filter(Boolean);
  const otherValid = allValid.filter((row) => row.id !== target.id);
  if (otherValid.length === 0 && forceRevoke !== true) {
    return { error: { code: 'REVOKE_LEAVES_NO_ACTIVE_VERSION', status: 409 } };
  }

  await db.query('BEGIN');
  try {
    await dataRepo.revokeVersion(db, { id: target.id, justification, actorId: auth.sub });
    await dataRepo.insertRotationEvent(db, {
      secretPath,
      domain,
      tenantId,
      eventType: 'revoked',
      vaultVersionOld: vaultVersion,
      actorId: auth.sub,
      actorRoles: auth?.roles ?? [],
      detail: { justification, forceRevoke }
    });
    if (forceRevoke === true) {
      await dataRepo.insertRotationEvent(db, {
        secretPath,
        domain,
        tenantId,
        eventType: 'revoke_confirmed',
        vaultVersionOld: vaultVersion,
        actorId: auth.sub,
        actorRoles: auth?.roles ?? [],
        detail: { justification }
      });
    }
    await vaultClient.deleteSecretVersion(secretPath, vaultVersion);
    await db.query('COMMIT');
    await publishEvent('console.secrets.rotation.revoked', { secretPath, vaultVersion, revokedBy: auth.sub, justification, forceRevoke });
    return { revokedVersion: vaultVersion, effectiveAt: new Date().toISOString() };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}
