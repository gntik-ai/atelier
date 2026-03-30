import crypto from 'node:crypto';
import * as repo from '../repositories/secret-rotation-repo.mjs';
import { SECRET_ROTATION_DEFAULT_GRACE_SECONDS, SECRET_ROTATION_MAX_GRACE_SECONDS, SECRET_ROTATION_MIN_GRACE_SECONDS } from '../models/secret-version-state.mjs';

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
    vaultClient: params.vaultClient ?? { async writeSecret() { return { data: { version: 1 } }; } },
    publishEvent: params.publishEvent ?? (async () => {}),
    triggerEsoRefresh: params.triggerEsoRefresh ?? (async () => {})
  };
}

export async function main(params = {}) {
  const { db, repo: dataRepo, vaultClient, publishEvent, triggerEsoRefresh } = resolveDependencies(params);
  const { auth, secretPath, domain, tenantId, newValue, justification } = params;
  const gracePeriodSeconds = params.gracePeriodSeconds ?? SECRET_ROTATION_DEFAULT_GRACE_SECONDS;

  if (!allowed(auth, domain, tenantId)) return { error: { code: 'FORBIDDEN', status: 403 } };
  if (!Number.isInteger(gracePeriodSeconds) || gracePeriodSeconds < SECRET_ROTATION_MIN_GRACE_SECONDS || gracePeriodSeconds > SECRET_ROTATION_MAX_GRACE_SECONDS) {
    return { error: { code: 'INVALID_GRACE_PERIOD', status: 422 } };
  }

  const client = db;
  const previousActive = await dataRepo.getActiveVersion(client, secretPath);
  const existingGrace = await dataRepo.getGraceVersion(client, secretPath);
  const secretName = secretPath.split('/').pop();
  const rotationId = crypto.randomUUID();

  await client.query('BEGIN');
  try {
    if (existingGrace) {
      await dataRepo.expireGraceVersion(client, { id: existingGrace.id, actorId: auth.sub });
    }
    const graced = previousActive ? await dataRepo.transitionToGrace(client, { secretPath, gracePeriodSeconds, initiatedBy: auth.sub }) : null;
    let inserted = await dataRepo.insertSecretVersion(client, {
      secretPath,
      domain,
      tenantId,
      secretName,
      vaultVersion: -1,
      state: 'active',
      gracePeriodSeconds: 0,
      initiatedBy: auth.sub
    });
    await dataRepo.insertRotationEvent(client, {
      secretPath,
      domain,
      tenantId,
      eventType: 'initiated',
      vaultVersionOld: previousActive?.vault_version ?? null,
      actorId: auth.sub,
      actorRoles: auth?.roles ?? [],
      detail: { justification, rotationId }
    });
    await dataRepo.insertRotationEvent(client, {
      secretPath,
      domain,
      tenantId,
      eventType: 'grace_started',
      vaultVersionOld: previousActive?.vault_version ?? null,
      gracePeriodSeconds,
      actorId: auth.sub,
      actorRoles: auth?.roles ?? [],
      detail: { rotationId }
    });

    let vaultVersion;
    try {
      const response = await vaultClient.writeSecret(secretPath, { data: { value: newValue } });
      vaultVersion = Number(response?.data?.version ?? response?.version ?? 1);
      inserted = await dataRepo.updateSecretVersionVaultVersion(client, { id: inserted.id, vaultVersion });
    } catch {
      await client.query('ROLLBACK');
      return { error: { code: 'VAULT_WRITE_FAILED', status: 502 } };
    }

    await client.query('COMMIT');
    const consumers = await dataRepo.listConsumers(client, secretPath);
    for (const consumer of consumers) {
      const pending = await dataRepo.insertPropagationEvent(client, { secretPath, vaultVersion, consumerId: consumer.consumer_id, state: 'pending' });
      if (consumer.reload_mechanism === 'eso_annotation') {
        await triggerEsoRefresh(consumer.eso_external_secret_name, consumer.consumer_namespace);
      }
      await publishEvent('console.secrets.consumer.reload-requested', {
        consumerId: consumer.consumer_id,
        secretPath,
        vaultVersion,
        requestedAt: pending.requested_at
      });
    }

    await publishEvent('console.secrets.rotation.initiated', {
      secretPath,
      domain,
      tenantId,
      actor: auth.sub,
      vaultVersionNew: vaultVersion,
      vaultVersionOld: previousActive?.vault_version ?? null
    });
    await publishEvent('console.secrets.rotation.grace-started', {
      secretPath,
      gracePeriodSeconds,
      graceExpiresAt: graced?.grace_expires_at ?? null
    });

    return {
      rotationId,
      vaultVersionNew: vaultVersion,
      vaultVersionOld: previousActive?.vault_version ?? null,
      gracePeriodSeconds,
      graceExpiresAt: graced?.grace_expires_at ?? null
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
