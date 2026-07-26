#!/usr/bin/env node
import { Buffer } from 'node:buffer';
import {
  createLifecycleWebhookKeyContext,
  deriveWebhookKeyId,
  formatCanonicalWebhookKey,
  parseCanonicalWebhookKey,
} from '../../packages/webhook-engine/src/webhook-master-key.mjs';
import { createKubernetesApi } from './kubernetes-api.mjs';

function required(env, name) {
  const value = env[name];
  if (typeof value !== 'string' || value.length === 0) throw Object.assign(new Error('invalid input'), { code: 'CREDENTIAL_INPUT_INVALID' });
  return value;
}

function bool(env, name) {
  return env[name] === 'true';
}

function parseSecretValue(secret, key) {
  const encoded = secret?.data?.[key];
  if (typeof encoded !== 'string' || encoded.length === 0) throw Object.assign(new Error('missing key'), { code: 'CREDENTIAL_SECRET_KEY_MISSING' });
  return Buffer.from(encoded, 'base64').toString('utf8');
}

function validateMaterial(material, mode, keyId) {
  if (mode === 'canonical-v1') return parseCanonicalWebhookKey(material);
  if (mode === 'legacy') return createLifecycleWebhookKeyContext({ material, keyId, mode, purpose: 'adopt' });
  throw Object.assign(new Error('invalid mode'), { code: 'CREDENTIAL_MODE_INVALID' });
}

function isOwned(secret, env) {
  return secret?.immutable === true
    && secret?.metadata?.labels?.['in-falcone.io/webhook-key-managed'] === 'true'
    && secret?.metadata?.labels?.['app.kubernetes.io/instance'] === env.RELEASE_NAME
    && secret?.metadata?.annotations?.['meta.helm.sh/release-name'] === env.RELEASE_NAME
    && secret?.metadata?.annotations?.['meta.helm.sh/release-namespace'] === env.RELEASE_NAMESPACE;
}

export async function finalizeWebhookCredential({ api, env, expectedRecoveryKeyId, sourceManaged }) {
  const currentName = required(env, 'WEBHOOK_SECRET_NAME');
  const currentKey = required(env, 'WEBHOOK_SECRET_KEY');
  const sourceName = required(env, 'WEBHOOK_SOURCE_SECRET_NAME');
  const sourceKey = required(env, 'WEBHOOK_SOURCE_SECRET_KEY');
  const sourceKeyId = deriveWebhookKeyId(api.namespace, sourceName, sourceKey);
  if (sourceName === currentName && sourceKey === currentKey) {
    throw Object.assign(new Error('current identity'), { code: 'CREDENTIAL_DELETE_CURRENT_FORBIDDEN' });
  }
  if (sourceKeyId !== expectedRecoveryKeyId) {
    throw Object.assign(new Error('recovery identity mismatch'), { code: 'CREDENTIAL_RECOVERY_IDENTITY_CONFLICT' });
  }
  if (sourceManaged !== true) {
    return { operation: 'finalize', keyId: sourceKeyId, deleted: false };
  }
  const secret = await api.getSecret(sourceName);
  if (!secret) return { operation: 'finalize', keyId: sourceKeyId, deleted: false };
  const annotatedId = secret?.metadata?.annotations?.['in-falcone.io/webhook-key-id'];
  if (!isOwned(secret, env) || annotatedId !== expectedRecoveryKeyId) {
    throw Object.assign(new Error('managed ownership mismatch'), { code: 'CREDENTIAL_MANAGED_OWNERSHIP_CONFLICT' });
  }
  await api.deleteSecret(sourceName);
  return { operation: 'finalize', keyId: sourceKeyId, deleted: true };
}

export async function runWebhookCredentialLifecycle(env = process.env, deps = {}) {
  if ((deps.argv ?? process.argv).length !== 2) throw Object.assign(new Error('arguments forbidden'), { code: 'CREDENTIAL_ARGUMENTS_FORBIDDEN' });
  const api = deps.api ?? await createKubernetesApi(env);
  const operation = required(env, 'WEBHOOK_KEY_CREDENTIAL_ACTION');
  const secretName = required(env, operation === 'finalize' ? 'WEBHOOK_SOURCE_SECRET_NAME' : 'WEBHOOK_SECRET_NAME');
  const secretKey = required(env, operation === 'finalize' ? 'WEBHOOK_SOURCE_SECRET_KEY' : 'WEBHOOK_SECRET_KEY');

  if (operation === 'finalize') {
    return finalizeWebhookCredential({
      api,
      env,
      expectedRecoveryKeyId: required(env, 'WEBHOOK_EXPECTED_RECOVERY_KEY_ID'),
      sourceManaged: bool(env, 'WEBHOOK_RECOVERY_MANAGED'),
    });
  }

  if (operation !== 'ensure') throw Object.assign(new Error('invalid operation'), { code: 'CREDENTIAL_ACTION_INVALID' });
  const create = env.WEBHOOK_KEY_CREATE === 'true';
  const isUpgrade = env.WEBHOOK_KEY_IS_UPGRADE === 'true';
  const lifecycleAction = env.WEBHOOK_KEY_LIFECYCLE_ACTION ?? 'none';
  const mode = required(env, 'WEBHOOK_SIGNING_KEY_MODE');
  const keyId = deriveWebhookKeyId(api.namespace, secretName, secretKey);
  let secret = await api.getSecret(secretName);
  let created = false;

  if (!secret) {
    if (!create) throw Object.assign(new Error('external missing'), { code: 'CREDENTIAL_EXTERNAL_SECRET_MISSING' });
    if (mode === 'legacy') throw Object.assign(new Error('legacy must be provisioned'), { code: 'CREDENTIAL_LEGACY_GENERATION_FORBIDDEN' });
    if (isUpgrade && lifecycleAction !== 'rotate') {
      throw Object.assign(new Error('managed missing'), { code: 'CREDENTIAL_MANAGED_SECRET_MISSING' });
    }
    const material = formatCanonicalWebhookKey();
    secret = await api.createSecret({
      apiVersion: 'v1',
      kind: 'Secret',
      immutable: true,
      metadata: {
        name: secretName,
        namespace: api.namespace,
        labels: {
          'app.kubernetes.io/name': env.APP_NAME,
          'app.kubernetes.io/instance': env.RELEASE_NAME,
          'app.kubernetes.io/managed-by': 'Helm',
          'app.kubernetes.io/part-of': 'in-falcone',
          'app.kubernetes.io/component': 'webhook-master-key',
          'in-falcone.io/webhook-key-managed': 'true',
        },
        annotations: {
          'helm.sh/resource-policy': 'keep',
          'meta.helm.sh/release-name': env.RELEASE_NAME,
          'meta.helm.sh/release-namespace': env.RELEASE_NAMESPACE,
          'in-falcone.io/webhook-key-id': keyId,
        },
      },
      type: 'Opaque',
      data: { [secretKey]: Buffer.from(material, 'utf8').toString('base64') },
    });
    created = true;
  } else if (create) {
    if (!isOwned(secret, env)) {
      throw Object.assign(new Error('ownership conflict'), { code: 'CREDENTIAL_MANAGED_OWNERSHIP_CONFLICT' });
    }
    if (secret?.metadata?.annotations?.['in-falcone.io/webhook-key-id'] !== keyId) {
      throw Object.assign(new Error('managed identity conflict'), { code: 'CREDENTIAL_MANAGED_IDENTITY_CONFLICT' });
    }
  }

  validateMaterial(parseSecretValue(secret, secretKey), mode, keyId);
  return { operation, keyId, custody: create ? 'managed' : 'external', created };
}

function sanitizedCode(caught) {
  const code = String(caught?.code ?? 'CREDENTIAL_OPERATION_FAILED');
  return /^(CREDENTIAL|KUBE|WEBHOOK_KEY)_[A-Z0-9_]+$/.test(code) ? code : 'CREDENTIAL_OPERATION_FAILED';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runWebhookCredentialLifecycle()
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((caught) => {
      process.stderr.write(`${JSON.stringify({ status: 'failed', code: sanitizedCode(caught) })}\n`);
      process.exitCode = 1;
    });
}
