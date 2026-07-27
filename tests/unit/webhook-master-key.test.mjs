import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createCanonicalWebhookKeyContext,
  createLifecycleWebhookKeyContext,
  createRuntimeWebhookKeyContext,
  deriveWebhookKeyId,
  formatCanonicalWebhookKey,
  parseCanonicalWebhookKey,
} from '../../packages/webhook-engine/src/webhook-master-key.mjs';
import { encryptSecret } from '../../packages/webhook-engine/src/webhook-signing.mjs';

const keyId = deriveWebhookKeyId('namespace-a', 'webhook-key-a', 'key');
const material = formatCanonicalWebhookKey(Buffer.from(Array.from({ length: 32 }, (_, i) => i)));
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('canonical-v1 round trips exactly 32 bytes without padding', () => {
  assert.match(material, /^v1:[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(parseCanonicalWebhookKey(material), Buffer.from(Array.from({ length: 32 }, (_, i) => i)));
  const context = createCanonicalWebhookKeyContext(material, keyId);
  assert.equal(context.mode, 'canonical-v1');
  assert.equal(context.keyId, keyId);
  assert.equal(context.keyBytes.length, 32);
  assert.deepEqual(JSON.parse(JSON.stringify(context)), { keyId, mode: 'canonical-v1' });
});

test('canonical parser rejects every non-canonical form instead of normalizing it', () => {
  const payload = material.slice(3);
  const invalid = [
    undefined, '', ` ${material}`, `${material}\n`, `${material}=`,
    `v2:${payload}`, `V1:${payload}`, `v1:${payload.slice(0, 42)}`,
    `v1:${payload}A`, `v1:${payload.slice(0, -1)}+`,
    `v1:${'A'.repeat(42)}B`, `v1:${'é'.repeat(43)}`,
  ];
  for (const value of invalid) {
    assert.throws(() => parseCanonicalWebhookKey(value), { code: value ? 'WEBHOOK_KEY_FORMAT_INVALID' : 'WEBHOOK_KEY_MISSING' });
  }
});

test('missing material has no environment-specific fallback', () => {
  for (const nodeEnv of ['development', 'test', 'staging', 'production']) {
    assert.throws(
      () => createCanonicalWebhookKeyContext(undefined, keyId, { nodeEnv }),
      { code: 'WEBHOOK_KEY_MISSING' },
    );
  }
  assert.throws(() => encryptSecret('plaintext', material), { code: 'WEBHOOK_KEY_CONTEXT_INVALID' });
});

test('legacy normalization is explicit and established legacy serving is identity-bound', () => {
  assert.throws(
    () => createLifecycleWebhookKeyContext({ material: 'historical-value', keyId, mode: 'legacy', purpose: 'runtime' }),
    { code: 'WEBHOOK_KEY_LEGACY_NOT_AUTHORIZED' },
  );
  const adopted = createLifecycleWebhookKeyContext({ material: 'historical-value', keyId, mode: 'legacy', purpose: 'adopt' });
  assert.equal(adopted.keyBytes.length, 32);
  assert.throws(
    () => createRuntimeWebhookKeyContext({ material: 'historical-value', keyId, mode: 'legacy', lifecycleState: null }),
    { code: 'WEBHOOK_KEY_LEGACY_NOT_AUTHORIZED' },
  );
  const serving = createRuntimeWebhookKeyContext({
    material: 'historical-value', keyId, mode: 'legacy',
    lifecycleState: { lifecycle_state: 'serving', current_key_id: keyId, current_mode: 'legacy' },
  });
  assert.deepEqual(serving.keyBytes, adopted.keyBytes);
});

test('opaque identity is stable and depends only on namespace, Secret name, and key name', () => {
  assert.equal(keyId, deriveWebhookKeyId('namespace-a', 'webhook-key-a', 'key'));
  assert.notEqual(keyId, deriveWebhookKeyId('namespace-b', 'webhook-key-a', 'key'));
  assert.notEqual(keyId, deriveWebhookKeyId('namespace-a', 'webhook-key-b', 'key'));
  assert.notEqual(keyId, deriveWebhookKeyId('namespace-a', 'webhook-key-a', 'other'));
  assert.match(keyId, /^wk1:[a-f0-9]{64}$/);
});

test('ordinary serving sources contain no development key or raw environment normalization', async () => {
  const paths = [
    'packages/webhook-engine/src/webhook-signing.mjs',
    'packages/webhook-engine/actions/webhook-management.mjs',
    'packages/webhook-engine/actions/webhook-delivery-worker.mjs',
    'apps/control-plane/webhook-handlers.mjs',
  ];
  const servingSource = (await Promise.all(paths.map((path) => readFile(resolve(repoRoot, path), 'utf8')))).join('\n');
  assert.doesNotMatch(servingSource, /development-signing-key/);
  assert.doesNotMatch(servingSource, /createHash\(['"]sha256['"]\).*WEBHOOK_SIGNING_KEY/s);
  assert.doesNotMatch(servingSource, /env\.WEBHOOK_SIGNING_KEY/);
});
