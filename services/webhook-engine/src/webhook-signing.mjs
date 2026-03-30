import crypto from 'node:crypto';

function normaliseKey(masterKey) {
  const keyBuffer = Buffer.isBuffer(masterKey) ? masterKey : Buffer.from(masterKey, 'utf8');
  return keyBuffer.length === 32 ? keyBuffer : crypto.createHash('sha256').update(keyBuffer).digest();
}

export function generateSigningSecret() {
  return crypto.randomBytes(32).toString('hex');
}

export function encryptSecret(plaintext, masterKey) {
  const key = normaliseKey(masterKey);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    cipher: Buffer.concat([ciphertext, tag]).toString('base64'),
    iv: iv.toString('base64')
  };
}

export function decryptSecret(cipher, iv, masterKey) {
  const key = normaliseKey(masterKey);
  const rawCipher = Buffer.from(cipher, 'base64');
  const ivBuffer = Buffer.from(iv, 'base64');
  const ciphertext = rawCipher.subarray(0, rawCipher.length - 16);
  const tag = rawCipher.subarray(rawCipher.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, ivBuffer);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function computeSignature(rawBody, secret) {
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody));
  return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
}

export function verifySignature(rawBody, secret, header) {
  const expected = Buffer.from(computeSignature(rawBody, secret));
  const actual = Buffer.from(String(header || ''));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export function verifyIncomingWebhook(rawBody, signatureHeader, secret) {
  return verifySignature(rawBody, secret, signatureHeader);
}

export function verifyAgainstSecretSet(rawBody, signatureHeader, secretRecords, now = new Date()) {
  return secretRecords.some((record) => {
    if (record.status === 'revoked') return false;
    if (record.status === 'grace' && record.grace_expires_at && new Date(record.grace_expires_at) < now) return false;
    return verifyIncomingWebhook(rawBody, signatureHeader, record.secret);
  });
}
