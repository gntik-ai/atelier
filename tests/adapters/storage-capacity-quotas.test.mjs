import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStorageQuotaAuditEvent,
  buildStorageQuotaProfile,
  getTenantStorageContextRecord,
  previewStorageBucketQuotaAdmission,
  previewStorageObjectQuotaAdmission,
  storageQuotaDimensions,
  storageQuotaGuardrailErrorCodes,
  storageQuotaOperationTypes,
  storageQuotaScopeTypes
} from '../../services/adapters/src/provider-catalog.mjs';

function buildTenantContext() {
  return getTenantStorageContextRecord({
    tenant: {
      tenantId: 'ten_01catalogquota',
      slug: 'catalog-quota',
      state: 'active',
      planId: 'pln_01growth'
    },
    storage: {
      config: {
        inline: {
          providerType: 'minio'
        }
      }
    },
    now: '2026-03-28T00:10:00Z'
  });
}

test('provider catalog exposes storage quota guardrail constants additively', () => {
  assert.equal(storageQuotaDimensions.TOTAL_BYTES, 'total_bytes');
  assert.equal(storageQuotaScopeTypes.WORKSPACE, 'workspace');
  assert.equal(storageQuotaOperationTypes.BUCKET_CREATE, 'bucket_create');
  assert.equal(storageQuotaGuardrailErrorCodes.OBJECT_SIZE_LIMIT_EXCEEDED.normalizedCode, 'STORAGE_OBJECT_TOO_LARGE');
  assert.equal(Object.isFrozen(storageQuotaGuardrailErrorCodes), true);
});

test('provider catalog builds storage quota profiles from tenant context and workspace overrides', () => {
  const profile = buildStorageQuotaProfile({
    tenantStorageContext: buildTenantContext(),
    workspaceId: 'wrk_01catalogquota',
    workspaceUsage: {
      totalBytes: 256,
      bucketCount: 1,
      objectCount: 2
    },
    workspaceLimits: {
      totalBytes: 1024,
      maxBuckets: 2,
      maxObjects: 4,
      maxObjectSizeBytes: 128
    }
  });

  const workspaceScope = profile.scopes.find((scope) => scope.scope === 'workspace');
  assert.equal(profile.tenantId, 'ten_01catalogquota');
  assert.equal(workspaceScope.totalBytes.limit, 1024);
  assert.equal(workspaceScope.bucketCount.limit, 2);
  assert.equal(workspaceScope.objectCount.limit, 4);
  assert.equal(workspaceScope.objectSizeBytes.limit, 128);
});

test('provider catalog bucket admission preview rejects exhausted workspace bucket quotas', () => {
  const decision = previewStorageBucketQuotaAdmission({
    quotaProfile: buildStorageQuotaProfile({
      tenantStorageContext: buildTenantContext(),
      workspaceId: 'wrk_01catalogquota',
      workspaceUsage: { bucketCount: 2 },
      workspaceLimits: { maxBuckets: 2 }
    }),
    requestedAt: '2026-03-28T00:11:00Z'
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.effectiveViolation.reasonCode, 'BUCKET_LIMIT_EXCEEDED');
});

test('provider catalog object admission preview blocks oversize and preserves audit evidence', () => {
  const decision = previewStorageObjectQuotaAdmission({
    quotaProfile: buildStorageQuotaProfile({
      tenantStorageContext: buildTenantContext(),
      workspaceId: 'wrk_01catalogquota',
      workspaceUsage: {
        totalBytes: 100,
        objectCount: 1
      },
      workspaceLimits: {
        totalBytes: 1024,
        maxObjects: 3,
        maxObjectSizeBytes: 64
      }
    }),
    byteDelta: 80,
    objectDelta: 1,
    requestedObjectSizeBytes: 80,
    action: storageQuotaOperationTypes.MULTIPART_COMPLETE,
    requestedAt: '2026-03-28T00:12:00Z'
  });
  const auditEvent = buildStorageQuotaAuditEvent({
    decision,
    actorRef: 'svc_catalog_quota',
    bucketId: 'bucket-01',
    objectKey: 'reports/oversize.bin',
    occurredAt: '2026-03-28T00:12:05Z'
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.effectiveViolation.reasonCode, 'OBJECT_SIZE_LIMIT_EXCEEDED');
  assert.equal(auditEvent.violationCount, 1);
  assert.equal(auditEvent.action, 'multipart_complete');
  assert.equal(Object.isFrozen(auditEvent), true);
});

test('provider catalog bucket admission exposes structured quotaDecision metadata', () => {
  const decision = previewStorageBucketQuotaAdmission({
    quotaProfile: buildStorageQuotaProfile({
      tenantStorageContext: buildTenantContext(),
      workspaceId: 'wrk_01catalogquota',
      workspaceUsage: { bucketCount: 2 },
      workspaceLimits: { maxBuckets: 2 }
    })
  });

  assert.equal(decision.quotaDecision.errorCode, 'QUOTA_HARD_LIMIT_REACHED');
  assert.equal(decision.quotaDecision.dimensionId, 'storage_buckets');
  assert.equal(decision.quotaDecision.scopeType, 'workspace');
});
