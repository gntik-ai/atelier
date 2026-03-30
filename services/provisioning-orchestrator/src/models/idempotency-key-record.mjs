import { createHash, randomUUID } from 'node:crypto';

const IDEMPOTENCY_KEY_PATTERN = /^[a-zA-Z0-9_-]+$/;
const DEFAULT_TTL_HOURS = 48;
const DEFAULT_MAX_LENGTH = 128;

function requireField(input, field) {
  if (!input?.[field]) {
    throw Object.assign(new Error(`Missing required field: ${field}`), {
      code: 'VALIDATION_ERROR',
      field
    });
  }
}

function resolveMaxLength(value = process.env.IDEMPOTENCY_KEY_MAX_LENGTH) {
  const parsed = Number.parseInt(value ?? `${DEFAULT_MAX_LENGTH}`, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_LENGTH;
}

export function resolveTtlHours(value = process.env.IDEMPOTENCY_KEY_TTL_HOURS) {
  const parsed = Number.parseInt(value ?? `${DEFAULT_TTL_HOURS}`, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_HOURS;
}

export function validateKeyFormat(key, { maxLength = resolveMaxLength() } = {}) {
  if (typeof key !== 'string' || key.length < 1 || key.length > maxLength || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw Object.assign(new Error('Idempotency key exceeds maximum length or contains invalid characters'), {
      code: 'VALIDATION_ERROR',
      field: 'idempotency_key'
    });
  }

  return key;
}

export function normalizeParams(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeParams(item));
  }

  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        if (value[key] !== undefined) {
          acc[key] = normalizeParams(value[key]);
        }
        return acc;
      }, {});
  }

  return value ?? null;
}

export function hashParams(params = {}) {
  return createHash('sha256').update(JSON.stringify(normalizeParams(params))).digest('hex');
}

export function createIdempotencyKeyRecord(input = {}) {
  requireField(input, 'tenant_id');
  requireField(input, 'idempotency_key');
  requireField(input, 'operation_id');
  requireField(input, 'operation_type');

  validateKeyFormat(input.idempotency_key);

  const createdAt = input.created_at ?? new Date().toISOString();
  const ttlHours = resolveTtlHours(input.ttl_hours);
  const expiresAt = input.expires_at ?? new Date(Date.parse(createdAt) + ttlHours * 60 * 60 * 1000).toISOString();

  return {
    record_id: input.record_id ?? randomUUID(),
    tenant_id: input.tenant_id,
    idempotency_key: input.idempotency_key,
    operation_id: input.operation_id,
    operation_type: input.operation_type,
    params_hash: input.params_hash ?? hashParams(input.params ?? {}),
    created_at: createdAt,
    expires_at: expiresAt
  };
}

export function isExpired(record, now = new Date()) {
  return Date.parse(record.expires_at) <= Date.parse(now instanceof Date ? now.toISOString() : now);
}
