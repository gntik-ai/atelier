import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBuiltInWorkspaceStorageDefaults,
  buildStorageBucketPolicy,
  buildStoragePolicyAttachmentSummary,
  buildStoragePolicyDecisionAuditEvent,
  evaluateStorageAccessDecision,
  getStorageBucketRecord,
  storagePolicyActions,
  storagePolicyConditionTypes,
  storagePolicyEffects,
  storagePolicyNormalizedErrorCodes,
  storagePolicyPrincipalTypes,
  storagePolicySources
} from '../../services/adapters/src/provider-catalog.mjs';

test('provider catalog exposes additive storage policy exports', () => {
  assert.equal(storagePolicyEffects.ALLOW, 'allow');
  assert.equal(storagePolicyPrincipalTypes.SERVICE_ACCOUNT, 'service_account');
  assert.equal(storagePolicyActions.MULTIPART_UPLOAD_PART, 'multipart.upload_part');
  assert.equal(storagePolicyActions.PRESIGNED_GENERATE_DOWNLOAD, 'presigned.generate_download');
  assert.equal(storagePolicyConditionTypes.OBJECT_KEY_PREFIX, 'object_key_prefix');
  assert.equal(storagePolicySources.BUCKET_POLICY, 'bucket_policy');
  assert.equal(storagePolicyNormalizedErrorCodes.BUCKET_POLICY_DENIED.code, 'BUCKET_POLICY_DENIED');
});

test('provider catalog evaluates storage access decisions and bucket attachment summaries additively', () => {
  const policyAttachment = buildStoragePolicyAttachmentSummary({
    policyId: 'pol_01',
    source: storagePolicySources.BUCKET_POLICY,
    statementCount: 2,
    updatedAt: '2026-03-28T00:00:00Z',
    overrideActive: false
  });
  const bucket = getStorageBucketRecord({
    tenantId: 'ten_01',
    workspaceId: 'wrk_01',
    bucketName: 'policy-bucket',
    tenantStorageContext: {
      entityType: 'tenant_storage_context',
      tenantId: 'ten_01',
      providerType: 'minio',
      providerDisplayName: 'MinIO',
      namespace: 'tenants/ten_01',
      state: 'active',
      bucketProvisioningAllowed: true,
      quotaAssignment: { capabilityAvailable: true }
    },
    policyAttachment
  });
  const bucketPolicy = buildStorageBucketPolicy({
    tenantId: 'ten_01',
    workspaceId: 'wrk_01',
    bucketId: bucket.resourceId,
    statements: [{ effect: 'allow', principals: [{ type: 'service_account', value: 'svc_uploader' }], actions: ['multipart.upload_part', 'presigned.generate_download'] }]
  });
  const decision = evaluateStorageAccessDecision({
    isolationAllowed: true,
    bucketPolicy,
    builtinDefault: buildBuiltInWorkspaceStorageDefaults({ tenantId: 'ten_01', workspaceId: 'wrk_01' }),
    actor: { type: 'service_account', id: 'svc_uploader', roles: ['member'] },
    action: 'multipart.upload_part',
    tenantId: 'ten_01',
    workspaceId: 'wrk_01',
    bucketId: bucket.resourceId,
    objectKey: 'uploads/chunk-0001'
  });
  const event = buildStoragePolicyDecisionAuditEvent({ decision, correlationId: 'cor_01' });

  assert.deepEqual(bucket.policyAttachment, policyAttachment);
  assert.equal(decision.allowed, true);
  assert.equal(decision.source, 'bucket_policy');
  assert.equal(event.actor.id, 'svc_uploader');
  assert.equal(JSON.stringify(event).includes('https://'), false);
});
