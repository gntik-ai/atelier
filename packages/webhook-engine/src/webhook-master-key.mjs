import crypto from 'node:crypto';

const CANONICAL_RE = /^v1:([A-Za-z0-9_-]{43})$/;
const KEY_ID_RE = /^wk1:[a-f0-9]{64}$/;
const KEY_CONTEXT = Symbol('falcone.webhook-key-context');
const LIFECYCLE_VERIFIED_CONTEXT = Symbol('falcone.webhook-key-context.lifecycle-verified');

const SAFE_MESSAGES = Object.freeze({
  WEBHOOK_KEY_MISSING: 'Webhook signing key is required',
  WEBHOOK_KEY_FORMAT_INVALID: 'Webhook signing key format is invalid',
  WEBHOOK_KEY_ID_INVALID: 'Webhook signing key identity is invalid',
  WEBHOOK_KEY_MODE_INVALID: 'Webhook signing key mode is invalid',
  WEBHOOK_KEY_LEGACY_NOT_AUTHORIZED: 'Legacy webhook signing key use is not authorized',
  WEBHOOK_KEY_CONTEXT_INVALID: 'Webhook signing key context is invalid',
  WEBHOOK_KEY_CONTEXT_NOT_VERIFIED: 'Webhook signing key context is not lifecycle verified',
  WEBHOOK_KEY_VERIFICATION_FAILED: 'Webhook signing key verification failed',
});

export class WebhookKeyError extends Error {
  constructor(code) {
    super(SAFE_MESSAGES[code] ?? 'Webhook signing key operation failed');
    this.name = 'WebhookKeyError';
    this.code = SAFE_MESSAGES[code] ? code : 'WEBHOOK_KEY_CONTEXT_INVALID';
  }
}

function fail(code) {
  throw new WebhookKeyError(code);
}

function canonicalBase64Url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

/**
 * Stable non-secret identity for a Kubernetes Secret reference. It is derived
 * exclusively from namespace/name/key metadata, never key material.
 */
export function deriveWebhookKeyId(namespace, secretName, secretKey) {
  const parts = [namespace, secretName, secretKey].map((value) => String(value ?? ''));
  if (parts.some((value) => value.length === 0 || value.includes('/'))) fail('WEBHOOK_KEY_ID_INVALID');
  return `wk1:${crypto.createHash('sha256').update(parts.join('/'), 'utf8').digest('hex')}`;
}

export function assertWebhookKeyId(keyId) {
  if (!KEY_ID_RE.test(String(keyId ?? ''))) fail('WEBHOOK_KEY_ID_INVALID');
  return String(keyId);
}

/** Parse only canonical v1 material. No trimming, padding, hashing, or fallback. */
export function parseCanonicalWebhookKey(material) {
  if (typeof material !== 'string' || material.length === 0) fail('WEBHOOK_KEY_MISSING');
  const matched = CANONICAL_RE.exec(material);
  if (!matched) fail('WEBHOOK_KEY_FORMAT_INVALID');
  let bytes;
  try {
    bytes = Buffer.from(matched[1], 'base64url');
  } catch {
    fail('WEBHOOK_KEY_FORMAT_INVALID');
  }
  if (bytes.length !== 32 || canonicalBase64Url(bytes) !== matched[1]) fail('WEBHOOK_KEY_FORMAT_INVALID');
  return bytes;
}

/**
 * Exact pre-C-25 normalization. This helper is deliberately not a runtime
 * parser: callers must identify an adoption/recovery purpose or prove an
 * already-established legacy serving state.
 */
function parseLegacyWebhookKey(material, authorization) {
  const allowed = authorization === 'adopt'
    || authorization === 'recover'
    || authorization === 'established-legacy-serving';
  if (!allowed) fail('WEBHOOK_KEY_LEGACY_NOT_AUTHORIZED');
  if (typeof material !== 'string' || material.length === 0) fail('WEBHOOK_KEY_MISSING');
  const raw = Buffer.from(material, 'utf8');
  return raw.length === 32 ? raw : crypto.createHash('sha256').update(raw).digest();
}

function makeContext(keyBytes, keyId, mode, lifecycleVerified = false) {
  if (!Buffer.isBuffer(keyBytes) || keyBytes.length !== 32) fail('WEBHOOK_KEY_CONTEXT_INVALID');
  const context = {
    keyId: assertWebhookKeyId(keyId),
    mode,
  };
  Object.defineProperty(context, 'keyBytes', {
    value: Buffer.from(keyBytes), enumerable: false, writable: false,
  });
  Object.defineProperty(context, KEY_CONTEXT, { value: true, enumerable: false });
  if (lifecycleVerified) {
    Object.defineProperty(context, LIFECYCLE_VERIFIED_CONTEXT, { value: true, enumerable: false });
  }
  return Object.freeze(context);
}

export function createCanonicalWebhookKeyContext(material, keyId) {
  return makeContext(parseCanonicalWebhookKey(material), keyId, 'canonical-v1');
}

export function createLifecycleWebhookKeyContext({ material, keyId, mode, purpose }) {
  if (mode === 'canonical-v1') return createCanonicalWebhookKeyContext(material, keyId);
  if (mode !== 'legacy') fail('WEBHOOK_KEY_MODE_INVALID');
  return makeContext(parseLegacyWebhookKey(material, purpose), keyId, 'legacy');
}

/**
 * Runtime resolution is allowed to normalize a legacy value only after the
 * database has established the same identity/mode in a serving state.
 */
export function createRuntimeWebhookKeyContext({ material, keyId, mode, lifecycleState }) {
  if (!['canonical-v1', 'legacy'].includes(mode)) fail('WEBHOOK_KEY_MODE_INVALID');
  const established = lifecycleState?.lifecycle_state === 'serving'
    && lifecycleState?.current_key_id === keyId
    && lifecycleState?.current_mode === mode;
  if (!established) {
    fail(mode === 'legacy' ? 'WEBHOOK_KEY_LEGACY_NOT_AUTHORIZED' : 'WEBHOOK_KEY_CONTEXT_NOT_VERIFIED');
  }
  if (mode === 'canonical-v1') {
    return makeContext(parseCanonicalWebhookKey(material), keyId, mode, true);
  }
  return makeContext(parseLegacyWebhookKey(material, 'established-legacy-serving'), keyId, 'legacy', true);
}

export function assertWebhookKeyContext(context) {
  if (!context || context[KEY_CONTEXT] !== true
      || !Buffer.isBuffer(context.keyBytes) || context.keyBytes.length !== 32
      || !KEY_ID_RE.test(String(context.keyId ?? ''))
      || !['canonical-v1', 'legacy'].includes(context.mode)) {
    fail('WEBHOOK_KEY_CONTEXT_INVALID');
  }
  return context;
}

export function assertLifecycleVerifiedWebhookKeyContext(context) {
  assertWebhookKeyContext(context);
  if (context[LIFECYCLE_VERIFIED_CONTEXT] !== true) fail('WEBHOOK_KEY_CONTEXT_NOT_VERIFIED');
  return context;
}

export function formatCanonicalWebhookKey(bytes = crypto.randomBytes(32)) {
  const value = Buffer.from(bytes);
  if (value.length !== 32) fail('WEBHOOK_KEY_FORMAT_INVALID');
  return `v1:${canonicalBase64Url(value)}`;
}

export const WEBHOOK_KEY_PATTERNS = Object.freeze({
  canonical: CANONICAL_RE,
  keyId: KEY_ID_RE,
});
