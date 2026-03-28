import test from 'node:test';
import assert from 'node:assert/strict';

import { buildStorageProviderProfile } from '../../services/adapters/src/storage-provider-profile.mjs';
import { isStorageReservedPrefix } from '../../services/adapters/src/storage-logical-organization.mjs';
import { STORAGE_NORMALIZED_ERROR_CODES } from '../../services/adapters/src/storage-error-taxonomy.mjs';
import {
  MULTIPART_LIFECYCLE_TRANSITIONS,
  MULTIPART_NORMALIZED_ERROR_CODES,
  MULTIPART_SESSION_STATES,
  PRESIGNED_URL_OPERATIONS,
  buildCapabilityNotAvailableError,
  buildMultipartAbortPreview,
  buildMultipartCompletionPreview,
  buildMultipartLifecycleAuditEvent,
  buildMultipartPartReceipt,
  buildMultipartUploadSession,
  buildPresignedUrlAuditEvent,
  buildPresignedUrlRecord,
  buildStaleSessionCleanupRecord,
  checkMultipartCapability,
  checkPresignedUrlCapability,
  evaluateMultipartSessionStaleness,
  validateMultipartObjectKey,
  validatePartList,
  validatePresignedTtl
} from '../../services/adapters/src/storage-multipart-presigned.mjs';

function makeUnsatisfiedProfile(capabilityId) {
  const profile = buildStorageProviderProfile({ providerType: 'minio' });
  profile.capabilityDetails = profile.capabilityDetails.map((entry) => (
    entry.capabilityId === capabilityId
      ? { ...entry, state: 'unsatisfied', constraints: [] }
      : entry
  ));
  return profile;
}

function makeSession() {
  return buildMultipartUploadSession({
    tenantId: 'ten_01',
    workspaceId: 'wrk_01',
    bucketId: 'bucket-01',
    objectKey: 'uploads/file.bin',
    ttlSeconds: 3600,
    now: '2026-03-28T00:00:00Z',
    correlationId: 'cor_01'
  });
}

test('multipart session states catalog is frozen and distinct from lifecycle transitions', () => {
  assert.deepEqual(Object.values(MULTIPART_SESSION_STATES), ['active', 'stale', 'completing', 'completed', 'aborted']);
  assert.equal(Object.isFrozen(MULTIPART_SESSION_STATES), true);
  assert.equal(Object.values(MULTIPART_SESSION_STATES).some((value) => Object.values(MULTIPART_LIFECYCLE_TRANSITIONS).includes(value)), false);
  assert.throws(() => {
    MULTIPART_SESSION_STATES.ACTIVE = 'mutated';
  }, TypeError);
});

test('multipart normalized error catalog is frozen and additive', () => {
  const newCodes = Object.values(MULTIPART_NORMALIZED_ERROR_CODES).map((entry) => entry.code);
  const existingCodes = Object.values(STORAGE_NORMALIZED_ERROR_CODES);

  assert.deepEqual(newCodes.sort(), [
    'CAPABILITY_NOT_AVAILABLE',
    'MULTIPART_CONSTRAINT_EXCEEDED',
    'MULTIPART_INVALID_PART_ORDER',
    'MULTIPART_SESSION_EXPIRED',
    'MULTIPART_SESSION_NOT_FOUND',
    'PRESIGNED_TTL_EXCEEDED'
  ]);
  assert.equal(Object.isFrozen(MULTIPART_NORMALIZED_ERROR_CODES), true);
  assert.equal(newCodes.some((code) => existingCodes.includes(code)), false);
});

test('presigned URL operations catalog is frozen', () => {
  assert.deepEqual(Object.values(PRESIGNED_URL_OPERATIONS), ['upload', 'download']);
  assert.equal(Object.isFrozen(PRESIGNED_URL_OPERATIONS), true);
});

test('multipart error definitions expose retryability and fallback hints', () => {
  for (const definition of Object.values(MULTIPART_NORMALIZED_ERROR_CODES)) {
    assert.equal(typeof definition.httpStatus, 'number');
    assert.equal(definition.retryability, 'not_retryable');
    assert.equal(typeof definition.fallbackHint, 'string');
    assert.ok(definition.fallbackHint.length > 0);
  }
});

test('checkMultipartCapability allows MinIO multipart support', () => {
  const result = checkMultipartCapability({ providerProfile: buildStorageProviderProfile({ providerType: 'minio' }) });
  assert.equal(result.allowed, true);
  assert.equal(result.capabilityId, 'object.multipart_upload');
  assert.equal(result.satisfactionState, 'satisfied');
  assert.ok(Array.isArray(result.constraints));
});

test('checkMultipartCapability rejects unsatisfied multipart capability', () => {
  const result = checkMultipartCapability({ providerProfile: makeUnsatisfiedProfile('object.multipart_upload') });
  assert.equal(result.allowed, false);
  assert.equal(result.errorEnvelope.normalizedCode, 'CAPABILITY_NOT_AVAILABLE');
  assert.equal(result.errorEnvelope.missingCapabilityId, 'object.multipart_upload');
  assert.equal(result.errorEnvelope.httpStatus, 501);
});

test('checkPresignedUrlCapability allows MinIO presigned URLs', () => {
  const result = checkPresignedUrlCapability({ providerProfile: buildStorageProviderProfile({ providerType: 'minio' }) });
  assert.equal(result.allowed, true);
  assert.equal(result.capabilityId, 'bucket.presigned_urls');
});

test('checkPresignedUrlCapability rejects unsatisfied presigned capability', () => {
  const result = checkPresignedUrlCapability({ providerProfile: makeUnsatisfiedProfile('bucket.presigned_urls') });
  assert.equal(result.allowed, false);
  assert.equal(result.errorEnvelope.missingCapabilityId, 'bucket.presigned_urls');
  assert.ok(result.errorEnvelope.fallbackHint.length > 0);
});

test('buildMultipartUploadSession creates an active frozen session', () => {
  const session = makeSession();
  assert.match(session.sessionId, /^mp_/);
  assert.equal(session.state, 'active');
  assert.equal(session.partCount, 0);
  assert.equal(session.accumulatedSizeBytes, 0);
  assert.ok(new Date(session.ttlDeadline).getTime() > new Date(session.initiatedAt).getTime());
  assert.equal(Object.isFrozen(session), true);
});

test('buildMultipartUploadSession produces unique session ids', () => {
  const first = makeSession();
  const second = makeSession();
  assert.notEqual(first.sessionId, second.sessionId);
});

test('validateMultipartObjectKey rejects reserved prefixes', () => {
  const result = validateMultipartObjectKey({
    objectKey: 'tenants/ten_01/workspaces/wrk_01/_platform/multipart/foo',
    isReservedPrefixFn: ({ candidatePrefix }) => isStorageReservedPrefix({
      tenantId: 'ten_01',
      workspaceId: 'wrk_01',
      candidatePrefix
    })
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors[0].includes('Reserved prefix'));
});

test('validateMultipartObjectKey accepts normal keys', () => {
  const result = validateMultipartObjectKey({
    objectKey: 'uploads/file.bin',
    isReservedPrefixFn: () => false
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('buildMultipartPartReceipt creates a frozen receipt', () => {
  const receipt = buildMultipartPartReceipt({
    sessionId: 'mp_123',
    partNumber: 1,
    integrityToken: 'etag-1',
    sizeBytes: 1024,
    receivedAt: '2026-03-28T00:00:00Z'
  });
  assert.equal(receipt.partNumber, 1);
  assert.equal(receipt.integrityToken, 'etag-1');
  assert.equal(Object.isFrozen(receipt), true);
});

test('validatePartList rejects empty part lists', () => {
  const result = validatePartList({ parts: [] });
  assert.equal(result.valid, false);
  assert.ok(result.errors[0].includes('non-empty'));
});

test('validatePartList rejects gaps in part numbering', () => {
  const parts = [1, 2, 5].map((partNumber) => ({ partNumber, sizeBytes: 5_000_000 }));
  const result = validatePartList({ parts, maxParts: 10000, minPartSizeBytes: 5_000_000 });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('gap')));
});

test('validatePartList accepts ordered valid parts', () => {
  const parts = [1, 2, 3].map((partNumber) => ({ partNumber, sizeBytes: 5_000_000 }));
  const result = validatePartList({ parts, maxParts: 10000, minPartSizeBytes: 5_000_000 });
  assert.equal(result.valid, true);
  assert.equal(result.partCount, 3);
  assert.equal(result.totalSizeBytes, 15_000_000);
});

test('validatePartList rejects lists that exceed maxParts', () => {
  const parts = Array.from({ length: 10001 }, (_, index) => ({ partNumber: index + 1, sizeBytes: 1 }));
  const result = validatePartList({ parts, maxParts: 10000 });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('maxParts')));
});

test('buildMultipartCompletionPreview returns expected object record for valid parts', () => {
  const preview = buildMultipartCompletionPreview({
    session: makeSession(),
    parts: [1, 2, 3].map((partNumber) => ({ partNumber, sizeBytes: 5_000_000 })),
    now: '2026-03-28T00:00:00Z'
  });
  assert.equal(preview.validationOutcome, 'valid');
  assert.equal(preview.expectedObjectRecord.objectKey, 'uploads/file.bin');
  assert.deepEqual(preview.validationErrors, []);
});

test('buildMultipartCompletionPreview rejects invalid part ordering', () => {
  const preview = buildMultipartCompletionPreview({
    session: makeSession(),
    parts: [{ partNumber: 1, sizeBytes: 5_000_000 }, { partNumber: 3, sizeBytes: 5_000_000 }],
    now: '2026-03-28T00:00:00Z'
  });
  assert.equal(preview.validationOutcome, 'invalid');
  assert.ok(preview.validationErrors.length > 0);
  assert.equal(preview.expectedObjectRecord, undefined);
});

test('buildMultipartAbortPreview and abort lifecycle event are structurally valid', () => {
  const session = makeSession();
  const abort = buildMultipartAbortPreview({ session, now: '2026-03-28T00:05:00Z' });
  const event = buildMultipartLifecycleAuditEvent({
    transition: 'abort',
    session,
    abortReason: 'caller_requested',
    occurredAt: '2026-03-28T00:05:00Z'
  });

  assert.equal(abort.state, 'aborted');
  assert.match(abort.abortedAt, /Z$/);
  assert.equal(event.eventType, 'storage.multipart.lifecycle');
  assert.equal(event.transition, 'abort');
  assert.equal(event.sessionId, session.sessionId);
  assert.equal(Object.isFrozen(event), true);
});

test('evaluateMultipartSessionStaleness detects stale and active sessions', () => {
  const session = makeSession();
  const stale = evaluateMultipartSessionStaleness({ session, now: '2026-03-28T02:00:00Z' });
  const active = evaluateMultipartSessionStaleness({ session, now: '2026-03-28T00:30:00Z' });

  assert.equal(stale.isStale, true);
  assert.equal(active.isStale, false);
});

test('validatePresignedTtl and buildPresignedUrlRecord clamp correctly', () => {
  const ok = validatePresignedTtl({ requestedTtlSeconds: 3600, platformMaxTtlSeconds: 7200 });
  const clamped = validatePresignedTtl({ requestedTtlSeconds: 10000, platformMaxTtlSeconds: 7200 });
  const record = buildPresignedUrlRecord({
    operation: 'download',
    bucketId: 'bucket-01',
    objectKey: 'uploads/file.bin',
    tenantId: 'ten_01',
    workspaceId: 'wrk_01',
    grantedTtlSeconds: clamped.effectiveTtlSeconds,
    ttlClamped: clamped.clamped,
    generatedAt: '2026-03-28T00:00:00Z'
  });

  assert.equal(ok.clamped, false);
  assert.equal(ok.effectiveTtlSeconds, 3600);
  assert.equal(clamped.clamped, true);
  assert.equal(clamped.effectiveTtlSeconds, 7200);
  assert.equal(record.operation, 'download');
  assert.ok(new Date(record.expiresAt).getTime() > new Date(record.generatedAt).getTime());
  assert.equal(record.ttlClamped, true);
  assert.equal(Object.isFrozen(record), true);
});

test('presigned URL audit event and stale cleanup record remain redacted and frozen', () => {
  const record = buildPresignedUrlRecord({
    operation: 'download',
    bucketId: 'bucket-01',
    objectKey: 'uploads/file.bin',
    tenantId: 'ten_01',
    workspaceId: 'wrk_01',
    grantedTtlSeconds: 3600,
    ttlClamped: false,
    generatedAt: '2026-03-28T00:00:00Z'
  });
  const event = buildPresignedUrlAuditEvent({ presignedUrlRecord: record, requestingIdentity: 'user_01' });
  const cleanup = buildStaleSessionCleanupRecord({ session: makeSession(), cleanedAt: '2026-03-28T02:00:00Z' });

  assert.equal(event.eventType, 'storage.presigned_url.generated');
  assert.equal(event.requestingIdentity, 'user_01');
  assert.equal(JSON.stringify(event).includes('http'), false);
  assert.equal(cleanup.cleanupReason, 'ttl_exceeded');
  assert.equal(cleanup.state, 'aborted');
  assert.equal(Object.isFrozen(cleanup), true);
});

test('buildCapabilityNotAvailableError returns frozen sanitized envelope-compatible record', () => {
  const error = buildCapabilityNotAvailableError({
    capabilityId: 'object.multipart_upload',
    fallbackHint: 'Use https://example.test upload instead of secret://providers/minio',
    correlationId: 'cor_01'
  });

  assert.equal(error.normalizedCode, 'CAPABILITY_NOT_AVAILABLE');
  assert.equal(error.httpStatus, 501);
  assert.equal(error.retryability, 'not_retryable');
  assert.equal(error.missingCapabilityId, 'object.multipart_upload');
  assert.equal(error.fallbackHint.includes('https://'), false);
  assert.equal(error.fallbackHint.includes('secret://'), false);
  assert.equal(Object.isFrozen(error), true);
});
