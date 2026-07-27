import crypto from 'node:crypto';

// Flow-trigger webhook secrets have a pre-existing, executor-local key contract. Keep that
// compatibility boundary separate from the platform webhook master-key lifecycle: the latter
// accepts only a resolved WebhookKeyContext and must never normalize arbitrary strings.
function normalizeFlowTriggerKey(masterKey) {
  const keyBuffer = Buffer.isBuffer(masterKey) ? masterKey : Buffer.from(masterKey, 'utf8');
  return keyBuffer.length === 32 ? keyBuffer : crypto.createHash('sha256').update(keyBuffer).digest();
}

export function encryptFlowTriggerSecret(plaintext, masterKey) {
  const key = normalizeFlowTriggerKey(masterKey);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    cipher: Buffer.concat([ciphertext, tag]).toString('base64'),
    iv: iv.toString('base64'),
  };
}

export function decryptFlowTriggerSecret(ciphertextAndTag, iv, masterKey) {
  const key = normalizeFlowTriggerKey(masterKey);
  const rawCipher = Buffer.from(ciphertextAndTag, 'base64');
  const ivBuffer = Buffer.from(iv, 'base64');
  const ciphertext = rawCipher.subarray(0, rawCipher.length - 16);
  const tag = rawCipher.subarray(rawCipher.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, ivBuffer);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
