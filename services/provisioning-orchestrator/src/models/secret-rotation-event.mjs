import { ensureNoSecretMaterial, SECRET_DOMAINS } from './secret-version-state.mjs';

export const ROTATION_EVENT_TYPES = Object.freeze([
  'initiated',
  'grace_started',
  'consumer_reload_requested',
  'consumer_reload_confirmed',
  'consumer_reload_timeout',
  'grace_expired',
  'revoked',
  'revoke_confirmed',
  'rotation_failed'
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function validateRotationEvent(record) {
  assert(record && typeof record === 'object', 'record is required');
  assert(typeof record.secretPath === 'string' && record.secretPath.length > 0, 'secretPath is required');
  assert(SECRET_DOMAINS.includes(record.domain), `domain must be one of: ${SECRET_DOMAINS.join(', ')}`);
  assert(ROTATION_EVENT_TYPES.includes(record.eventType), `eventType must be one of: ${ROTATION_EVENT_TYPES.join(', ')}`);
  assert(typeof record.actorId === 'string' && record.actorId.length > 0, 'actorId is required');
  ensureNoSecretMaterial(record.detail ?? {});
  return true;
}

export function createRotationEventRecord({ secretPath, domain, tenantId = null, eventType, vaultVersionNew = null, vaultVersionOld = null, gracePeriodSeconds = null, actorId, actorRoles = [], detail = {} }) {
  const record = {
    secretPath,
    domain,
    tenantId,
    eventType,
    vaultVersionNew,
    vaultVersionOld,
    gracePeriodSeconds,
    actorId,
    actorRoles,
    detail
  };
  validateRotationEvent(record);
  return record;
}
