import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSignature, decryptSecret, encryptSecret, verifyAgainstSecretSet, verifyIncomingWebhook } from '../../services/webhook-engine/src/webhook-signing.mjs';

test('signatures are deterministic and tamper sensitive', () => {
  const key = 'secret';
  const body = JSON.stringify({ ok: true });
  const signature = computeSignature(body, key);
  assert.equal(signature, computeSignature(body, key));
  assert.notEqual(signature, computeSignature('{"ok":false}', key));
  assert.ok(verifyIncomingWebhook(body, signature, key));
  assert.equal(verifyIncomingWebhook(body, signature, 'other'), false);
});

test('encrypt and decrypt round trip', () => {
  const encrypted = encryptSecret('hello', 'master-key');
  assert.equal(decryptSecret(encrypted.cipher, encrypted.iv, 'master-key'), 'hello');
});

test('secret set respects grace period and revocation', () => {
  const body = 'payload';
  const oldSig = computeSignature(body, 'old');
  const records = [
    { status: 'grace', grace_expires_at: new Date(Date.now() + 1000).toISOString(), secret: 'old' },
    { status: 'active', secret: 'new' }
  ];
  assert.equal(verifyAgainstSecretSet(body, oldSig, records), true);
  assert.equal(verifyAgainstSecretSet(body, oldSig, [{ status: 'grace', grace_expires_at: new Date(Date.now() - 1000).toISOString(), secret: 'old' }]), false);
});
