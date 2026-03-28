import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStorageCapabilityNotAvailableError,
  buildStorageMultipartSession,
  buildStoragePresignedUrlAuditEvent,
  buildStoragePresignedUrlRecord,
  checkStorageMultipartCapability,
  checkStoragePresignedUrlCapability,
  storageMultipartLifecycleTransitions,
  storageMultipartNormalizedErrorCodes,
  storageMultipartSessionStates,
  storagePresignedUrlOperations,
  validateStoragePartList,
  buildStorageMultipartPartReceipt,
  buildStorageMultipartCompletionPreview,
  buildStorageMultipartAbortPreview,
  buildStorageMultipartUploadList,
  buildStorageMultipartSessionSummary,
  buildStorageMultipartLifecycleEvent,
  evaluateStorageMultipartStaleness,
  buildStorageStaleSessionCleanupRecord,
  validateStorageMultipartObjectKey,
  validateStoragePresignedTtl
} from '../../services/adapters/src/provider-catalog.mjs';
import { buildStorageProviderProfile } from '../../services/adapters/src/storage-provider-profile.mjs';

function makeUnsatisfiedProfile(capabilityId) {
  const profile = buildStorageProviderProfile({ providerType: 'minio' });
  profile.capabilityDetails = profile.capabilityDetails.map((entry) => (
    entry.capabilityId === capabilityId
      ? { ...entry, state: 'unsatisfied', constraints: [] }
      : entry
  ));
  return profile;
}

test('MinIO multipart capability exposes maxParts constraint', () => {
  const minioProfile = buildStorageProviderProfile({ providerType: 'minio' });
  const result = checkStorageMultipartCapability({ providerProfile: minioProfile });
  assert.equal(result.allowed, true);
  assert.equal(result.constraints.some((constraint) => constraint.key === 'maxParts' && constraint.value === 10000), true);
});

test('Garage multipart capability is allowed', () => {
  const garageProfile = buildStorageProviderProfile({ providerType: 'garage' });
  const result = checkStorageMultipartCapability({ providerProfile: garageProfile });
  assert.equal(result.allowed, true);
});

test('MinIO presigned capability is allowed', () => {
  const minioProfile = buildStorageProviderProfile({ providerType: 'minio' });
  const result = checkStoragePresignedUrlCapability({ providerProfile: minioProfile });
  assert.equal(result.allowed, true);
});

test('Garage presigned capability is allowed', () => {
  const garageProfile = buildStorageProviderProfile({ providerType: 'garage' });
  const result = checkStoragePresignedUrlCapability({ providerProfile: garageProfile });
  assert.equal(result.allowed, true);
});

test('unsatisfied multipart capability produces additive not-available error', () => {
  const result = checkStorageMultipartCapability({ providerProfile: makeUnsatisfiedProfile('object.multipart_upload') });
  const error = buildStorageCapabilityNotAvailableError({
    capabilityId: 'object.multipart_upload',
    fallbackHint: 'Use single-request object.put instead.'
  });

  assert.equal(result.allowed, false);
  assert.equal(result.capabilityId, 'object.multipart_upload');
  assert.equal(result.satisfactionState, 'unsatisfied');
  assert.equal(result.errorEnvelope.code, 'STORAGE_UNKNOWN_ERROR');
  assert.equal(result.errorEnvelope.normalizedCode, 'CAPABILITY_NOT_AVAILABLE');
  assert.equal(result.errorEnvelope.httpStatus, 501);
  assert.equal(result.errorEnvelope.missingCapabilityId, 'object.multipart_upload');
  assert.equal(error.normalizedCode, 'CAPABILITY_NOT_AVAILABLE');
  assert.equal(error.httpStatus, 501);
});

test('buildStorageMultipartSession returns an active frozen session', () => {
  const session = buildStorageMultipartSession({
    tenantId: 'ten_01',
    workspaceId: 'wrk_01',
    bucketId: 'bucket-01',
    objectKey: 'uploads/file.bin',
    ttlSeconds: 3600,
    now: '2026-03-28T00:00:00Z'
  });

  assert.match(session.sessionId, /^mp_/);
  assert.equal(session.state, 'active');
  assert.equal(session.partCount, 0);
  assert.equal(Object.isFrozen(session), true);
});

test('buildStoragePresignedUrlRecord builds upload records', () => {
  const record = buildStoragePresignedUrlRecord({
    operation: 'upload',
    bucketId: 'bucket-01',
    objectKey: 'uploads/file.bin',
    tenantId: 'ten_01',
    workspaceId: 'wrk_01',
    grantedTtlSeconds: 3600,
    ttlClamped: false,
    generatedAt: '2026-03-28T00:00:00Z'
  });

  assert.equal(record.operation, 'upload');
  assert.ok(new Date(record.expiresAt).getTime() > new Date(record.generatedAt).getTime());
  assert.equal(record.ttlClamped, false);
  assert.equal(Object.isFrozen(record), true);
});

test('validateStoragePartList enforces maxParts boundary', () => {
  const validParts = Array.from({ length: 10000 }, (_, index) => ({ partNumber: index + 1, sizeBytes: 5_242_880 }));
  const invalidParts = Array.from({ length: 10001 }, (_, index) => ({ partNumber: index + 1, sizeBytes: 5_242_880 }));

  assert.equal(validateStoragePartList({ parts: validParts, maxParts: 10000, minPartSizeBytes: 5_242_880 }).valid, true);
  assert.equal(validateStoragePartList({ parts: invalidParts, maxParts: 10000, minPartSizeBytes: 5_242_880 }).valid, false);
});

test('all additive multipart-presigned provider catalog exports are defined', () => {
  for (const value of [
    buildStorageMultipartSession,
    buildStorageMultipartPartReceipt,
    buildStorageMultipartCompletionPreview,
    buildStorageMultipartAbortPreview,
    buildStorageMultipartUploadList,
    buildStorageMultipartSessionSummary,
    buildStorageMultipartLifecycleEvent,
    evaluateStorageMultipartStaleness,
    buildStorageStaleSessionCleanupRecord,
    validateStoragePartList,
    validateStorageMultipartObjectKey,
    buildStoragePresignedUrlRecord,
    buildStoragePresignedUrlAuditEvent,
    validateStoragePresignedTtl,
    checkStorageMultipartCapability,
    checkStoragePresignedUrlCapability,
    buildStorageCapabilityNotAvailableError,
    storageMultipartSessionStates,
    storageMultipartLifecycleTransitions,
    storagePresignedUrlOperations,
    storageMultipartNormalizedErrorCodes
  ]) {
    assert.notEqual(value, undefined);
  }
});

test('buildStoragePresignedUrlAuditEvent does not leak URL-like values', () => {
  const record = buildStoragePresignedUrlRecord({
    operation: 'download',
    bucketId: 'bucket-01',
    objectKey: 'uploads/file.bin',
    tenantId: 'ten_01',
    workspaceId: 'wrk_01',
    grantedTtlSeconds: 3600,
    ttlClamped: false,
    generatedAt: '2026-03-28T00:00:00Z'
  });
  const event = buildStoragePresignedUrlAuditEvent({
    presignedUrlRecord: record,
    requestingIdentity: 'user_01'
  });
  const payload = JSON.stringify(event);

  assert.equal(/https?:\/\//.test(payload), false);
  assert.equal(/secret:\/\//.test(payload), false);
  assert.equal(Object.isFrozen(event), true);
});
