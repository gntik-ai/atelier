import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import SwaggerParser from '@apidevtools/swagger-parser';
import {
  getAdapterPort,
  getPublicRoute
} from '../../services/internal-contracts/src/index.mjs';
import { OPENAPI_PATH } from '../../scripts/lib/quality-gates.mjs';
import {
  buildStorageErrorEvent,
  downloadStorageObjectPreviewResult,
  listStorageObjectsPreview,
  previewStorageBucket,
  previewStorageErrorEnvelope,
  previewStorageObject,
  previewStorageNormalizedError,
  previewTenantStorageContext,
  summarizeStorageProviderIntrospection,
  summarizeTenantStorageContext
} from '../../apps/control-plane/src/storage-admin.mjs';
import {
  buildStorageBucketPolicy,
  buildStorageEventGovernanceProfile,
  buildStorageEventNotificationRule,
  buildStorageMultipartSession,
  buildStoragePolicyAttachmentSummary,
  buildStoragePresignedUrlRecord,
  buildStorageQuotaProfile,
  buildTenantStoragePermissionTemplate,
  buildWorkspaceStoragePermissionSet,
  checkStorageMultipartCapability,
  evaluateStorageAccessDecision,
  evaluateStorageEventNotifications,
  getStorageBucketRecord,
  getStorageProviderProfile,
  previewStorageBucketQuotaAdmission,
  previewStorageObjectQuotaAdmission,
  storageEventNotificationErrorCodes,
  storageMultipartNormalizedErrorCodes,
  storageNormalizedErrorCodes,
  storagePolicyNormalizedErrorCodes,
  storageProviderCapabilityIds,
  storageQuotaGuardrailErrorCodes,
  supportedStorageProviderTypes
} from '../../services/adapters/src/provider-catalog.mjs';
import {
  VERIFICATION_VERDICT,
  buildVerificationReport,
  buildVerificationRun
} from '../../services/adapters/src/storage-provider-verification.mjs';

test('storage OpenAPI contract exposes additive provider, bucket, and object routes and schemas', async () => {
  const document = await SwaggerParser.validate(OPENAPI_PATH);
  const providerRoute = document.paths['/v1/platform/storage/provider']?.get;
  const tenantContextRoute = document.paths['/v1/tenants/{tenantId}/storage-context']?.get;
  const tenantRotationRoute = document.paths['/v1/tenants/{tenantId}/storage-context/credential-rotations']?.post;
  const listBucketsRoute = document.paths['/v1/storage/buckets']?.get;
  const createBucketRoute = document.paths['/v1/storage/buckets']?.post;
  const getBucketRoute = document.paths['/v1/storage/buckets/{resourceId}']?.get;
  const deleteBucketRoute = document.paths['/v1/storage/buckets/{resourceId}']?.delete;
  const listObjectsRoute = document.paths['/v1/storage/buckets/{resourceId}/objects']?.get;
  const uploadObjectRoute = document.paths['/v1/storage/buckets/{resourceId}/objects/{objectKey}']?.put;
  const downloadObjectRoute = document.paths['/v1/storage/buckets/{resourceId}/objects/{objectKey}']?.get;
  const deleteObjectRoute = document.paths['/v1/storage/buckets/{resourceId}/objects/{objectKey}']?.delete;
  const metadataRoute = document.paths['/v1/storage/buckets/{resourceId}/objects/{objectKey}/metadata']?.get;
  const manifestSchema = document.components.schemas.StorageCapabilityManifest;
  const capabilityConstraintSchema = document.components.schemas.StorageCapabilityConstraint;
  const capabilityEntrySchema = document.components.schemas.StorageCapabilityEntry;
  const capabilityBaselineSchema = document.components.schemas.StorageCapabilityBaseline;
  const capabilityGapSchema = document.components.schemas.StorageCapabilityGap;
  const providerCapabilitiesSchema = document.components.schemas.StorageProviderCapabilities;
  const normalizedErrorSchema = document.components.schemas.StorageNormalizedError;
  const normalizedErrorEnvelopeSchema = document.components.schemas.StorageNormalizedErrorEnvelope;
  const providerSchema = document.components.schemas.StorageProviderIntrospection;
  const limitationSchema = document.components.schemas.StorageProviderLimitation;
  const tenantContextSchema = document.components.schemas.TenantStorageContext;
  const tenantQuotaSchema = document.components.schemas.TenantStorageQuotaAssignment;
  const tenantCredentialSchema = document.components.schemas.TenantStorageCredentialStatus;
  const bucketCollectionSchema = document.components.schemas.StorageBucketCollection;
  const logicalOrganizationSchema = document.components.schemas.StorageLogicalOrganization;
  const reservedPrefixSchema = document.components.schemas.StorageReservedPrefix;
  const objectOrganizationSchema = document.components.schemas.StorageObjectOrganization;
  const objectWriteSchema = document.components.schemas.StorageObjectWriteRequest;
  const objectMetadataSchema = document.components.schemas.StorageObjectMetadata;
  const objectPayloadSchema = document.components.schemas.StorageObjectPayload;
  const objectDownloadSchema = document.components.schemas.StorageObjectDownload;
  const objectCollectionSchema = document.components.schemas.StorageObjectCollection;
  const objectKeyParam = document.components.parameters.ObjectKey;

  assert.ok(providerRoute);
  assert.ok(tenantContextRoute);
  assert.ok(tenantRotationRoute);
  assert.ok(listBucketsRoute);
  assert.ok(createBucketRoute);
  assert.ok(getBucketRoute);
  assert.ok(deleteBucketRoute);
  assert.ok(listObjectsRoute);
  assert.ok(uploadObjectRoute);
  assert.ok(downloadObjectRoute);
  assert.ok(deleteObjectRoute);
  assert.ok(metadataRoute);

  assert.equal(providerRoute['x-family'], 'platform');
  assert.equal(providerRoute['x-resource-type'], 'storage_provider');
  assert.equal(providerRoute['x-scope'], 'platform');
  assert.equal(tenantContextRoute['x-family'], 'tenants');
  assert.equal(tenantContextRoute['x-resource-type'], 'tenant_storage_context');
  assert.equal(tenantRotationRoute['x-resource-type'], 'tenant_storage_context');
  assert.equal(listBucketsRoute['x-resource-type'], 'bucket');
  assert.equal(deleteBucketRoute['x-resource-type'], 'bucket');
  assert.equal(listObjectsRoute['x-resource-type'], 'bucket_object');
  assert.equal(uploadObjectRoute['x-resource-type'], 'bucket_object');
  assert.equal(downloadObjectRoute['x-resource-type'], 'bucket_object');
  assert.equal(deleteObjectRoute['x-resource-type'], 'bucket_object');
  assert.equal(metadataRoute['x-resource-type'], 'bucket_object');

  assert.ok(manifestSchema);
  assert.ok(capabilityConstraintSchema);
  assert.ok(capabilityEntrySchema);
  assert.ok(capabilityBaselineSchema);
  assert.ok(capabilityGapSchema);
  assert.ok(providerCapabilitiesSchema);
  assert.ok(normalizedErrorSchema);
  assert.ok(normalizedErrorEnvelopeSchema);
  assert.ok(providerSchema);
  assert.ok(limitationSchema);
  assert.ok(tenantContextSchema);
  assert.ok(tenantQuotaSchema);
  assert.ok(tenantCredentialSchema);
  assert.ok(bucketCollectionSchema);
  assert.ok(logicalOrganizationSchema);
  assert.ok(reservedPrefixSchema);
  assert.ok(objectOrganizationSchema);
  assert.ok(objectWriteSchema);
  assert.ok(objectMetadataSchema);
  assert.ok(objectPayloadSchema);
  assert.ok(objectDownloadSchema);
  assert.ok(objectCollectionSchema);
  assert.ok(objectKeyParam);

  assert.deepEqual(providerSchema.required.includes('capabilityManifest'), true);
  assert.deepEqual(providerSchema.required.includes('capabilityManifestVersion'), true);
  assert.deepEqual(providerSchema.required.includes('capabilityDetails'), true);
  assert.deepEqual(providerSchema.required.includes('capabilityBaseline'), true);
  assert.deepEqual(tenantContextSchema.required.includes('credential'), true);
  assert.deepEqual(tenantContextSchema.required.includes('providerCapabilities'), true);
  assert.deepEqual(bucketCollectionSchema.required, ['items', 'page']);
  assert.deepEqual(logicalOrganizationSchema.required, [
    'strategy',
    'layoutVersion',
    'tenantRootPrefix',
    'workspaceRootPrefix',
    'workspaceSharedPrefix',
    'applicationRootPrefixTemplate',
    'reservedPrefixes',
    'quotaAttributionMode',
    'auditScopeMode',
    'slugIndependent'
  ]);
  assert.deepEqual(reservedPrefixSchema.required, ['key', 'prefix', 'purpose']);
  assert.deepEqual(objectOrganizationSchema.required, [
    'strategy',
    'layoutVersion',
    'placementType',
    'tenantRootPrefix',
    'workspaceRootPrefix',
    'objectPrefix',
    'canonicalObjectPath',
    'quotaAttributionKey',
    'auditResourceKey'
  ]);
  assert.deepEqual(objectCollectionSchema.required, ['items', 'page']);
  assert.deepEqual(objectDownloadSchema.required, ['metadata', 'payload']);
  assert.equal(bucketCollectionSchema.properties.items.type, 'array');
  assert.ok(bucketCollectionSchema.properties.items.items.properties.bucketName);
  assert.ok(document.components.schemas.StorageBucket.properties.organization.properties.workspaceSharedPrefix);
  assert.ok(objectMetadataSchema.properties.organization.properties.canonicalObjectPath);
  assert.equal(objectWriteSchema.properties.applicationId.pattern, '^app_[0-9a-z]+$');
  assert.deepEqual(Object.keys(manifestSchema.properties), [
    'bucketOperations',
    'objectCrud',
    'presignedUrls',
    'multipartUpload',
    'objectVersioning',
    'bucketPolicies',
    'bucketLifecycle',
    'objectLock',
    'eventNotifications'
  ]);
  assert.deepEqual(capabilityConstraintSchema.required, ['key', 'operator', 'value']);
  assert.deepEqual(capabilityEntrySchema.required, ['capabilityId', 'required', 'state', 'summary', 'constraints']);
  assert.deepEqual(capabilityBaselineSchema.required, ['version', 'checkedAt', 'requiredCapabilities', 'optionalCapabilities', 'eligible', 'missingCapabilities', 'insufficientCapabilities']);
  assert.deepEqual(capabilityGapSchema.required, ['capabilityId', 'expectedState', 'actualState']);
  assert.deepEqual(normalizedErrorSchema.required, ['code', 'message', 'httpStatus', 'retryability', 'operationContext', 'observedAt']);
  assert.deepEqual(normalizedErrorEnvelopeSchema.required, ['error']);
  assert.ok(providerSchema.properties.capabilityDetails.items.properties.capabilityId);
  assert.ok(providerSchema.properties.capabilityBaseline.properties.eligible);
  assert.ok(tenantContextSchema.properties.providerCapabilities.properties.baseline.properties.insufficientCapabilities);
});

test('storage provider contract keeps canonical capability completeness across supported and unavailable profiles', () => {
  const expectedEntryKeys = ['capabilityId', 'required', 'state', 'summary', 'constraints'];

  for (const providerType of supportedStorageProviderTypes) {
    const profile = getStorageProviderProfile({ providerType });

    assert.deepEqual(profile.capabilityDetails.map((entry) => entry.capabilityId), storageProviderCapabilityIds);
    assert.equal(profile.capabilityDetails.every((entry) => JSON.stringify(Object.keys(entry)) === JSON.stringify(expectedEntryKeys)), true);
  }

  const unavailable = summarizeStorageProviderIntrospection({ providerType: 'unknown-provider' }).profile;
  assert.deepEqual(unavailable.capabilityDetails.map((entry) => entry.capabilityId), storageProviderCapabilityIds);
  assert.equal(unavailable.capabilityDetails.every((entry) => entry.state === 'unsatisfied'), true);
  assert.equal(Object.values(unavailable.capabilityManifest).every((value) => value === false), true);
});

test('storage contracts preserve route discoverability, taxonomy, service-map coverage, and bounded previews', () => {
  const providerRoute = getPublicRoute('getStorageProviderIntrospection');
  const tenantContextRoute = getPublicRoute('getTenantStorageContext');
  const tenantRotationRoute = getPublicRoute('rotateTenantStorageContextCredential');
  const listBucketRoute = getPublicRoute('listStorage');
  const deleteBucketRoute = getPublicRoute('deleteStorage');
  const listObjectsRoute = getPublicRoute('listStorageObjects');
  const uploadObjectRoute = getPublicRoute('uploadStorageObject');
  const downloadObjectRoute = getPublicRoute('downloadStorageObject');
  const metadataObjectRoute = getPublicRoute('getStorageObjectMetadata');
  const deleteObjectRoute = getPublicRoute('deleteStorageObject');
  const storageAdapter = getAdapterPort('storage');
  const introspection = summarizeStorageProviderIntrospection({ providerType: 'garage' });
  const tenantContext = summarizeTenantStorageContext({
    tenant: {
      tenantId: 'ten_01contract',
      slug: 'contract',
      state: 'active',
      planId: 'pln_01growth'
    },
    storage: {
      config: {
        inline: {
          providerType: 'garage'
        }
      }
    },
    now: '2026-03-27T21:00:00Z'
  });
  const bucket = previewStorageBucket({
    workspaceId: 'wrk_01contract',
    workspaceSlug: 'contract-dev',
    bucketName: 'contract-assets',
    tenantStorageContext: previewTenantStorageContext({
      tenant: {
        tenantId: 'ten_01contract',
        slug: 'contract',
        state: 'active',
        planId: 'pln_01growth'
      },
      storage: {
        config: {
          inline: {
            providerType: 'garage'
          }
        }
      },
      now: '2026-03-27T21:00:00Z'
    }),
    objectCount: 1,
    totalBytes: 64,
    now: '2026-03-27T21:00:00Z'
  });
  const object = previewStorageObject({
    bucket,
    objectKey: 'files/report.txt',
    applicationId: 'app_01contract',
    applicationSlug: 'reporting-app',
    sizeBytes: 64,
    contentType: 'text/plain',
    now: '2026-03-27T21:00:05Z'
  });
  const objectList = listStorageObjectsPreview({ items: [object] });
  const download = downloadStorageObjectPreviewResult({ bucket, object, requestedAt: '2026-03-27T21:00:06Z' });
  const taxonomy = JSON.parse(fs.readFileSync(new URL('../../services/internal-contracts/src/public-api-taxonomy.json', import.meta.url), 'utf8'));
  const bucketObjectTaxonomy = taxonomy.resource_taxonomy.find((entry) => entry.resource_type === 'bucket_object');

  assert.equal(providerRoute.family, 'platform');
  assert.equal(providerRoute.path, '/v1/platform/storage/provider');
  assert.equal(providerRoute.resourceType, 'storage_provider');
  assert.equal(providerRoute.tenantBinding, 'none');
  assert.equal(providerRoute.workspaceBinding, 'none');
  assert.deepEqual(providerRoute.audiences, ['platform_team']);

  assert.equal(tenantContextRoute.family, 'tenants');
  assert.equal(tenantContextRoute.path, '/v1/tenants/{tenantId}/storage-context');
  assert.equal(tenantContextRoute.resourceType, 'tenant_storage_context');
  assert.equal(tenantRotationRoute.path, '/v1/tenants/{tenantId}/storage-context/credential-rotations');
  assert.equal(tenantRotationRoute.supportsIdempotencyKey, true);
  assert.equal(tenantContextRoute.tenantBinding, 'required');

  assert.equal(listBucketRoute.path, '/v1/storage/buckets');
  assert.equal(deleteBucketRoute.path, '/v1/storage/buckets/{resourceId}');
  assert.equal(listObjectsRoute.path, '/v1/storage/buckets/{resourceId}/objects');
  assert.equal(uploadObjectRoute.resourceType, 'bucket_object');
  assert.equal(downloadObjectRoute.resourceType, 'bucket_object');
  assert.equal(metadataObjectRoute.resourceType, 'bucket_object');
  assert.equal(deleteObjectRoute.supportsIdempotencyKey, true);

  assert.ok(storageAdapter.capabilities.includes('ensure_bucket'));
  assert.ok(storageAdapter.capabilities.includes('resolve_provider_profile'));
  assert.ok(storageAdapter.capabilities.includes('ensure_tenant_context'));
  assert.ok(storageAdapter.capabilities.includes('list_buckets'));
  assert.ok(storageAdapter.capabilities.includes('get_bucket_metadata'));
  assert.ok(storageAdapter.capabilities.includes('delete_bucket'));
  assert.ok(storageAdapter.capabilities.includes('put_object'));
  assert.ok(storageAdapter.capabilities.includes('get_object'));
  assert.ok(storageAdapter.capabilities.includes('get_object_metadata'));
  assert.ok(storageAdapter.capabilities.includes('list_objects'));
  assert.ok(storageAdapter.capabilities.includes('delete_object'));
  assert.ok(storageAdapter.capabilities.includes('get_capability_manifest'));
  assert.ok(storageAdapter.capabilities.includes('normalize_storage_error'));
  assert.ok(storageAdapter.capabilities.includes('validate_capability_baseline'));

  assert.equal(introspection.profile.providerType, 'garage');
  assert.equal(introspection.profile.status, 'ready');
  assert.equal(introspection.profile.capabilityManifest.bucketPolicies, true);
  assert.equal(introspection.profile.capabilityManifest.bucketLifecycle, false);
  assert.equal(introspection.profile.capabilityManifest.objectLock, false);
  assert.equal(introspection.profile.capabilityManifest.eventNotifications, false);
  assert.equal(introspection.profile.capabilityDetails.some((entry) => entry.capabilityId === 'bucket.policy'), true);
  assert.equal(introspection.profile.capabilityDetails.some((entry) => entry.capabilityId === 'bucket.lifecycle'), true);
  assert.equal(introspection.profile.capabilityDetails.some((entry) => entry.capabilityId === 'object.lock'), true);
  assert.equal(introspection.profile.capabilityDetails.some((entry) => entry.capabilityId === 'bucket.event_notifications'), true);
  assert.equal(introspection.profile.capabilityBaseline.eligible, true);
  assert.equal(introspection.supportedProviders.length >= 2, true);
  assert.equal(tenantContext.route.operationId, 'getTenantStorageContext');
  assert.equal(tenantContext.context.providerCapabilities.baseline.eligible, true);
  assert.equal(tenantContext.context.credential.secretReferencePresent, true);
  assert.equal(JSON.stringify(tenantContext).includes('secret://tenants/'), false);
  assert.equal(bucket.organization.workspaceSharedPrefix, 'tenants/ten_01contract/workspaces/wrk_01contract/shared/');

  assert.equal(objectList.route.operationId, 'listStorageObjects');
  assert.equal(objectList.collection.items.length, 1);
  assert.equal(objectList.collection.items[0].organization.placementType, 'application');
  assert.equal(download.route.operationId, 'downloadStorageObject');
  assert.equal(download.metadata.objectKey, 'files/report.txt');
  assert.equal(download.metadata.organization.canonicalObjectPath, 'tenants/ten_01contract/workspaces/wrk_01contract/apps/app_01contract/data/files/report.txt');
  assert.equal(typeof download.payload.contentBase64, 'string');

  const normalizedError = previewStorageNormalizedError({
    providerCode: 'NoSuchKey',
    requestId: 'req_contract_storage_01',
    tenantId: 'ten_01contract',
    workspaceId: 'wrk_01contract',
    operation: 'object.get',
    bucketName: 'contract-assets',
    objectKey: 'files/missing.txt',
    observedAt: '2026-03-27T21:00:07Z'
  });
  const errorEnvelope = previewStorageErrorEnvelope({
    providerCode: 'AccessDenied',
    providerMessage: 'https://garage.internal denied using secret://tenants/ten_01contract/storage/context',
    requestId: 'req_contract_storage_02',
    tenantId: 'ten_01contract',
    workspaceId: 'wrk_01contract',
    operation: 'object.delete',
    bucketName: 'contract-assets',
    objectKey: 'files/report.txt',
    observedAt: '2026-03-27T21:00:08Z'
  });
  const errorEvent = buildStorageErrorEvent({
    providerCode: 'Quota_Exceeded',
    requestId: 'req_contract_storage_03',
    tenantId: 'ten_01contract',
    workspaceId: 'wrk_01contract',
    operation: 'object.put',
    bucketName: 'contract-assets',
    objectKey: 'files/report.txt',
    observedAt: '2026-03-27T21:00:09Z'
  });

  assert.equal(normalizedError.code, 'OBJECT_NOT_FOUND');
  assert.equal(errorEnvelope.error.code, 'STORAGE_ACCESS_DENIED');
  assert.equal(JSON.stringify(errorEnvelope).includes('https://garage.internal'), false);
  assert.equal(errorEvent.errorCode, 'STORAGE_QUOTA_EXCEEDED');

  assert.ok(bucketObjectTaxonomy);
  assert.equal(bucketObjectTaxonomy.family, 'storage');
  assert.equal(bucketObjectTaxonomy.scope, 'workspace');
  assert.equal(bucketObjectTaxonomy.authorization_resource, 'bucket');
});

test('storage multipart and presigned URL schemas are additive and structurally valid', () => {
  const session = buildStorageMultipartSession({
    tenantId: 'ten_01contract',
    workspaceId: 'wrk_01contract',
    bucketId: 'bucket-01',
    objectKey: 'uploads/file.bin',
    ttlSeconds: 3600,
    now: '2026-03-28T00:00:00Z'
  });
  const presigned = buildStoragePresignedUrlRecord({
    operation: 'download',
    bucketId: 'bucket-01',
    objectKey: 'uploads/file.bin',
    tenantId: 'ten_01contract',
    workspaceId: 'wrk_01contract',
    grantedTtlSeconds: 3600,
    ttlClamped: false,
    generatedAt: '2026-03-28T00:00:00Z'
  });
  const capability = checkStorageMultipartCapability({
    providerProfile: {
      capabilityDetails: [{
        capabilityId: 'object.multipart_upload',
        state: 'satisfied',
        constraints: []
      }]
    }
  });

  for (const field of ['sessionId', 'tenantId', 'workspaceId', 'bucketId', 'objectKey', 'initiatedAt', 'ttlDeadline', 'state', 'partCount', 'accumulatedSizeBytes']) {
    assert.equal(field in session, true);
  }

  for (const field of ['operation', 'bucketId', 'objectKey', 'tenantId', 'workspaceId', 'grantedTtlSeconds', 'ttlClamped', 'expiresAt', 'generatedAt']) {
    assert.equal(field in presigned, true);
  }

  for (const field of ['allowed', 'capabilityId', 'satisfactionState', 'constraints']) {
    assert.equal(field in capability, true);
  }

  const multipartCodes = Object.values(storageMultipartNormalizedErrorCodes).map((entry) => entry.code);
  const existingCodes = Object.values(storageNormalizedErrorCodes);

  assert.equal(new Set(multipartCodes).size, 6);
  assert.equal(multipartCodes.some((code) => existingCodes.includes(code)), false);
  assert.equal(Object.isFrozen(storageMultipartNormalizedErrorCodes), true);
});

test('storage quota guardrail contracts are additive and structurally valid', () => {
  const quotaProfile = buildStorageQuotaProfile({
    tenantStorageContext: previewTenantStorageContext({
      tenant: {
        tenantId: 'ten_01contractquota',
        slug: 'contract-quota',
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
      now: '2026-03-28T00:15:00Z'
    }),
    workspaceId: 'wrk_01contractquota',
    workspaceUsage: {
      totalBytes: 100,
      bucketCount: 1,
      objectCount: 1
    },
    workspaceLimits: {
      totalBytes: 256,
      maxBuckets: 2,
      maxObjects: 3,
      maxObjectSizeBytes: 64
    }
  });
  const bucketDecision = previewStorageBucketQuotaAdmission({
    quotaProfile,
    requestedAt: '2026-03-28T00:15:05Z'
  });
  const objectDecision = previewStorageObjectQuotaAdmission({
    quotaProfile,
    byteDelta: 32,
    objectDelta: 1,
    requestedObjectSizeBytes: 32,
    requestedAt: '2026-03-28T00:15:10Z'
  });
  const guardrailCodes = Object.values(storageQuotaGuardrailErrorCodes).map((entry) => entry.code);
  const normalizedCodes = new Set(Object.values(storageNormalizedErrorCodes));

  assert.equal(Array.isArray(quotaProfile.scopes), true);
  assert.equal(quotaProfile.scopes.length >= 1, true);
  assert.equal('allowed' in bucketDecision, true);
  assert.equal('violations' in bucketDecision, true);
  assert.equal('quotaProfile' in bucketDecision, true);
  assert.equal('allowed' in objectDecision, true);
  assert.equal('violations' in objectDecision, true);
  assert.equal('quotaProfile' in objectDecision, true);
  assert.equal(Object.isFrozen(storageQuotaGuardrailErrorCodes), true);
  assert.equal(new Set(guardrailCodes).size, 5);
  assert.equal(Object.values(storageQuotaGuardrailErrorCodes).every((entry) => normalizedCodes.has(entry.normalizedCode)), true);
  assert.equal(guardrailCodes.some((code) => normalizedCodes.has(code)), false);
});

test('storage policy contracts are additive and structurally valid', () => {
  const bucketPolicy = buildStorageBucketPolicy({
    tenantId: 'ten_01contract',
    workspaceId: 'wrk_01contract',
    bucketId: 'bucket-01',
    statements: [{ effect: 'allow', principals: [{ type: 'role', value: 'viewer' }], actions: ['object.get'] }]
  });
  const workspaceDefault = buildWorkspaceStoragePermissionSet({
    tenantId: 'ten_01contract',
    workspaceId: 'wrk_01contract',
    statements: [{ effect: 'allow', principals: [{ type: 'role', value: 'member' }], actions: ['object.list'] }]
  });
  const tenantTemplate = buildTenantStoragePermissionTemplate({
    tenantId: 'ten_01contract',
    statements: [{ effect: 'allow', principals: [{ type: 'service_account', value: 'svc_contract' }], actions: ['object.put'] }]
  });
  const decision = evaluateStorageAccessDecision({
    isolationAllowed: true,
    bucketPolicy,
    actor: { type: 'user', id: 'usr_01contract', roles: ['viewer'] },
    action: 'object.get',
    tenantId: 'ten_01contract',
    workspaceId: 'wrk_01contract',
    bucketId: 'bucket-01'
  });
  const policyAttachment = buildStoragePolicyAttachmentSummary({
    policyId: bucketPolicy.policyId,
    source: 'bucket_policy',
    statementCount: bucketPolicy.statementCount,
    updatedAt: bucketPolicy.timestamps.updatedAt,
    overrideActive: false
  });
  const bucket = getStorageBucketRecord({
    tenantId: 'ten_01contract',
    workspaceId: 'wrk_01contract',
    bucketName: 'policy-contract-bucket',
    tenantStorageContext: {
      entityType: 'tenant_storage_context',
      tenantId: 'ten_01contract',
      providerType: 'garage',
      providerDisplayName: 'Garage',
      namespace: 'tenants/ten_01contract',
      state: 'active',
      bucketProvisioningAllowed: true,
      quotaAssignment: { capabilityAvailable: true }
    },
    policyAttachment
  });

  assert.equal(bucketPolicy.entityType, 'storage_bucket_policy');
  assert.equal(workspaceDefault.entityType, 'workspace_storage_permissions');
  assert.equal(tenantTemplate.entityType, 'tenant_storage_permission_template');
  assert.equal(decision.allowed, true);
  assert.equal(bucket.policyAttachment.policyId, bucketPolicy.policyId);
  assert.equal(new Set(Object.values(storageMultipartNormalizedErrorCodes).map((entry) => entry.code)).size, 6);
  assert.equal(Object.values(storageMultipartNormalizedErrorCodes).some((entry) => entry.code in storagePolicyNormalizedErrorCodes), false);
  assert.equal(Object.values(storageNormalizedErrorCodes).some((code) => code in storagePolicyNormalizedErrorCodes), false);
});

test('storage verification report schema is additive and structurally valid', () => {
  const run = buildVerificationRun({
    providers: ['minio', 'garage'],
    startedAt: '2026-03-27T22:10:00Z'
  });
  const report = buildVerificationReport({
    runId: run.runId,
    providers: ['minio', 'garage'],
    startedAt: '2026-03-27T22:10:00Z',
    completedAt: '2026-03-27T22:11:00Z',
    scenarioResults: [],
    crossProviderEquivalenceAssessments: [],
    errorTaxonomyConsistencyResults: [],
    capabilityBaselineResults: [],
    tenantIsolationResults: [],
    verdicts: {
      minio: 'fail',
      garage: 'fail'
    },
    overallVerdict: 'fail',
    divergences: []
  });

  for (const field of [
    'runId',
    'startedAt',
    'completedAt',
    'configuration',
    'scenarioResults',
    'crossProviderEquivalenceAssessments',
    'errorTaxonomyConsistencyResults',
    'capabilityBaselineResults',
    'tenantIsolationResults',
    'verdicts',
    'overallVerdict',
    'divergences'
  ]) {
    assert.equal(field in report, true);
  }

  assert.equal(Object.values(VERIFICATION_VERDICT).includes(report.overallVerdict), true);
  assert.equal(Object.isFrozen(report), true);
  assert.throws(() => {
    report.overallVerdict = 'pass';
  }, TypeError);
});


test('storage event notification contracts remain additive and audit-safe', () => {
  const governance = buildStorageEventGovernanceProfile({
    tenantId: 'ten_01events',
    workspaceId: 'wrk_01events',
    allowedDestinationTypes: ['kafka_topic', 'openwhisk_action'],
    maxTenantRules: 3,
    currentTenantRuleCount: 1,
    maxWorkspaceRules: 2,
    currentWorkspaceRuleCount: 1
  });
  const rule = buildStorageEventNotificationRule({
    ruleId: 'sen_contract_01',
    tenantId: 'ten_01events',
    workspaceId: 'wrk_01events',
    bucketId: 'bucket_01events',
    destinationType: 'kafka_topic',
    destinationRef: 'topic.storage.events',
    eventTypes: ['object.created'],
    filters: { prefix: 'uploads/' }
  });
  const evaluation = evaluateStorageEventNotifications({
    rules: [rule],
    event: {
      tenantId: 'ten_01events',
      workspaceId: 'wrk_01events',
      bucketId: 'bucket_01events',
      eventType: 'object.created',
      objectKey: 'uploads/file.jpg',
      occurredAt: '2026-03-28T00:20:00Z'
    },
    providerProfile: {
      capabilityDetails: [{
        capabilityId: 'bucket.event_notifications',
        required: false,
        state: 'satisfied',
        summary: 'supported',
        constraints: []
      }]
    },
    evaluatedAt: '2026-03-28T00:20:01Z'
  });

  assert.equal(governance.allowedDestinationTypes.includes('kafka_topic'), true);
  assert.equal(rule.filters.prefix, 'uploads/');
  assert.equal(evaluation.matches.length, 1);
  assert.equal(evaluation.matches[0].ruleId, 'sen_contract_01');
  assert.equal(Object.isFrozen(storageEventNotificationErrorCodes), true);
  assert.equal(storageEventNotificationErrorCodes.RULE_LIMIT_EXCEEDED.normalizedCode, storageNormalizedErrorCodes.STORAGE_QUOTA_EXCEEDED);
});
