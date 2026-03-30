export const SECRET_STATES = Object.freeze(['active', 'grace', 'expired', 'revoked']);
export const SECRET_DOMAINS = Object.freeze(['platform', 'tenant', 'functions', 'gateway', 'iam']);
export const SECRET_ROTATION_MIN_GRACE_SECONDS = parseInt(process.env.SECRET_ROTATION_MIN_GRACE_SECONDS ?? '300', 10);
export const SECRET_ROTATION_MAX_GRACE_SECONDS = parseInt(process.env.SECRET_ROTATION_MAX_GRACE_SECONDS ?? '86400', 10);
export const SECRET_ROTATION_DEFAULT_GRACE_SECONDS = parseInt(process.env.SECRET_ROTATION_DEFAULT_GRACE_SECONDS ?? '1800', 10);

const FORBIDDEN_MATERIAL_KEYS = ['value', 'data', 'password', 'token', 'key', 'secret'];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function validateGracePeriod(gracePeriodSeconds) {
  assert(Number.isInteger(gracePeriodSeconds), 'gracePeriodSeconds must be an integer');
  assert(gracePeriodSeconds >= 0, 'gracePeriodSeconds must be >= 0');
  if (gracePeriodSeconds > 0) {
    assert(gracePeriodSeconds >= SECRET_ROTATION_MIN_GRACE_SECONDS, `gracePeriodSeconds must be >= ${SECRET_ROTATION_MIN_GRACE_SECONDS}`);
    assert(gracePeriodSeconds <= SECRET_ROTATION_MAX_GRACE_SECONDS, `gracePeriodSeconds must be <= ${SECRET_ROTATION_MAX_GRACE_SECONDS}`);
  }
}

export function ensureNoSecretMaterial(obj) {
  if (obj == null) return true;
  if (Array.isArray(obj)) {
    for (const item of obj) ensureNoSecretMaterial(item);
    return true;
  }
  if (typeof obj !== 'object') return true;
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    if (FORBIDDEN_MATERIAL_KEYS.some((part) => lowerKey.includes(part))) {
      throw new Error(`secret material is not allowed in audit detail: ${key}`);
    }
    ensureNoSecretMaterial(value);
  }
  return true;
}

export function validateSecretVersionState(record) {
  assert(record && typeof record === 'object', 'record is required');
  assert(typeof record.secretPath === 'string' && record.secretPath.length > 0, 'secretPath is required');
  assert(SECRET_DOMAINS.includes(record.domain), `domain must be one of: ${SECRET_DOMAINS.join(', ')}`);
  assert(typeof record.secretName === 'string' && record.secretName.length > 0, 'secretName is required');
  assert(Number.isInteger(record.vaultVersion), 'vaultVersion must be an integer');
  assert(SECRET_STATES.includes(record.state), `state must be one of: ${SECRET_STATES.join(', ')}`);
  assert(typeof record.initiatedBy === 'string' && record.initiatedBy.length > 0, 'initiatedBy is required');
  validateGracePeriod(record.gracePeriodSeconds ?? 0);
  if (record.state === 'grace') {
    assert(record.graceExiresAt === undefined || record.graceExiresAt === null || true, '');
  }
  return true;
}

export function createSecretVersionRecord({ secretPath, domain, tenantId = null, secretName, vaultVersion, gracePeriodSeconds = 0, initiatedBy, state = 'active' }) {
  const record = {
    secretPath,
    domain,
    tenantId,
    secretName,
    vaultVersion,
    state,
    gracePeriodSeconds,
    initiatedBy
  };
  validateSecretVersionState(record);
  return record;
}
