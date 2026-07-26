import { buildWebhookMasterKeyRepository } from '../../packages/webhook-engine/src/webhook-master-key-lifecycle.mjs';

const MODES = new Set(['canonical-v1', 'legacy']);

function required(env, name) {
  const value = env?.[name];
  if (typeof value !== 'string' || value.length === 0) {
    const error = new Error('Webhook signing key configuration is incomplete');
    error.code = 'WEBHOOK_KEY_CONFIG_REQUIRED';
    throw error;
  }
  return value;
}

/**
 * Resolve exactly one verified key context after migration and before listen.
 * This is the only serving path that reads WEBHOOK_SIGNING_KEY.
 */
export async function resolveWebhookKeyBeforeServing(pool, env = process.env) {
  const material = required(env, 'WEBHOOK_SIGNING_KEY');
  const keyId = required(env, 'WEBHOOK_SIGNING_KEY_ID');
  const mode = required(env, 'WEBHOOK_SIGNING_KEY_MODE');
  if (!MODES.has(mode)) {
    const error = new Error('Webhook signing key mode is invalid');
    error.code = 'WEBHOOK_KEY_MODE_INVALID';
    throw error;
  }
  const managed = env.WEBHOOK_SIGNING_KEY_MANAGED === 'true';
  const repository = buildWebhookMasterKeyRepository(pool);
  return repository.initializeOrVerify({ material, keyId, mode, managed });
}

export function sanitizedWebhookBootstrapError(caught) {
  const allowed = new Set([
    'WEBHOOK_ADOPTION_REQUIRED',
    'WEBHOOK_DATABASE_PRINCIPALS_INVALID',
    'WEBHOOK_DATABASE_PRINCIPALS_REQUIRED',
    'WEBHOOK_POSTGRESQL_16_REQUIRED',
    'WEBHOOK_KEY_CONFIG_REQUIRED',
    'WEBHOOK_KEY_CONTEXT_NOT_VERIFIED',
    'WEBHOOK_KEY_FORMAT_INVALID',
    'WEBHOOK_KEY_ID_INVALID',
    'WEBHOOK_KEY_LEGACY_NOT_AUTHORIZED',
    'WEBHOOK_KEY_MODE_INVALID',
    'WEBHOOK_KEY_STATE_AMBIGUOUS',
    'WEBHOOK_KEY_STATE_CONFLICT',
    'WEBHOOK_KEY_VERIFICATION_FAILED',
    'WEBHOOK_RECOVERY_WINDOW_EXPIRED',
    'WEBHOOK_ROW_KEY_MISMATCH',
  ]);
  return allowed.has(caught?.code) ? caught.code : 'WEBHOOK_KEY_BOOTSTRAP_FAILED';
}
