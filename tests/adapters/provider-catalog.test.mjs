import test from 'node:test';
import assert from 'node:assert/strict';

import {
  adapterCallContract,
  adapterResultContract,
  buildStorageOperationEvent,
  buildTenantStorageEvent,
  deleteStorageBucketPreview,
  deleteStorageObjectPreview,
  downloadStorageObjectPreview,
  getStorageBucketRecord,
  getStorageBucketSummary,
  getStorageLogicalOrganization,
  getStorageObjectMetadata,
  getStorageObjectOrganization,
  getStorageObjectRecord,
  getStorageProviderCompatibilitySummary,
  getStorageProviderProfile,
  getTenantStorageContextRecord,
  getTenantStorageContextSummary,
  getWorkspaceStorageBootstrapPreview,
  isReservedStoragePrefix,
  listAuditAdapters,
  listProvisioningAdapters,
  listStorageBuckets,
  listStorageObjects,
  listStorageProviderProfiles,
  providerAdapterCatalog,
  rotateTenantStorageCredential,
  storageBucketObjectErrorCodes,
  storageLogicalOrganizationErrorCodes,
  supportedStorageProviderTypes,
  uploadStorageObjectPreview
} from '../../services/adapters/src/provider-catalog.mjs';
import {
  adapterContextTargets,
  adapterEnforcementSurfaces,
  workspaceOwnedResourceSemantics
} from '../../services/adapters/src/authorization-policy.mjs';

test('provider adapter catalog covers all baseline providers', () => {
  const providerIds = new Set(providerAdapterCatalog.map((adapter) => adapter.id));

  for (const providerId of ['keycloak', 'postgresql', 'mongodb', 'kafka', 'openwhisk', 'storage']) {
    assert.ok(providerIds.has(providerId), `missing provider adapter ${providerId}`);
  }

  assert.equal(adapterCallContract.owner, 'services/adapters');
  assert.equal(adapterResultContract.owner, 'services/adapters');
});

test('consumer-specific adapter views remain separated', () => {
  const provisioningIds = new Set(listProvisioningAdapters().map((adapter) => adapter.id));
  const auditIds = new Set(listAuditAdapters().map((adapter) => adapter.id));
  const storageProfiles = listStorageProviderProfiles();
  const minioProfile = getStorageProviderProfile({ providerType: 'minio' });
  const unavailableProfile = getStorageProviderProfile({ providerType: 'unsupported' });
  const compatibility = getStorageProviderCompatibilitySummary({ providerType: 'garage' });

  assert.ok(provisioningIds.has('keycloak'));
  assert.ok(provisioningIds.has('storage'));
  assert.ok(auditIds.has('postgresql'));
  assert.ok(auditIds.has('storage'));
  assert.ok(!auditIds.has('keycloak'));

  assert.equal(supportedStorageProviderTypes.includes('minio'), true);
  assert.equal(supportedStorageProviderTypes.includes('ceph-rgw'), true);
  assert.equal(storageProfiles.length >= 2, true);
  assert.equal(minioProfile.status, 'ready');
  assert.equal(minioProfile.capabilityManifest.bucketOperations, true);
  assert.equal(unavailableProfile.status, 'unavailable');
  assert.equal(compatibility.providerType, 'garage');
  assert.equal(compatibility.capabilityCount >= 4, true);
});

test('adapter authorization policy exposes scoped enforcement targets', () => {
  const surfaceIds = new Set(adapterEnforcementSurfaces.map((surface) => surface.id));
  const targetIds = new Set(adapterContextTargets.map((target) => target.target));
  const resourceTypes = new Set(workspaceOwnedResourceSemantics.map((resource) => resource.resource_type));

  assert.deepEqual([...surfaceIds].sort(), ['data_api', 'event_bus', 'functions_runtime', 'object_storage']);
  assert.deepEqual([...targetIds].sort(), ['adapter_call', 'kafka_headers', 'openwhisk_activation', 'storage_presign_context']);
  assert.ok(resourceTypes.has('database'));
  assert.ok(resourceTypes.has('bucket'));
  assert.ok(resourceTypes.has('topic'));
  assert.ok(resourceTypes.has('function'));
  assert.ok(resourceTypes.has('app'));
});

test('provider catalog exposes tenant storage context helpers without leaking secret material', () => {
  const record = getTenantStorageContextRecord({
    tenant: {
      tenantId: 'ten_01catalog',
      slug: 'catalog',
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
    now: '2026-03-27T20:50:00Z'
  });
  const summary = getTenantStorageContextSummary(record);
  const rotated = rotateTenantStorageCredential({ storageContext: record, requestedAt: '2026-03-27T20:55:00Z', actorUserId: 'usr_01catalog' });
  const bootstrap = getWorkspaceStorageBootstrapPreview({
    tenantId: 'ten_01catalog',
    workspaceId: 'wrk_01catalog',
    workspaceSlug: 'catalog-dev',
    storageContext: rotated,
    now: '2026-03-27T20:55:00Z'
  });
  const event = buildTenantStorageEvent({ storageContext: rotated, transition: 'reactivated', occurredAt: '2026-03-27T20:56:00Z' });

  assert.equal(record.state, 'active');
  assert.equal(record.quotaAssignment.capabilityAvailable, true);
  assert.equal(summary.credential.secretReferencePresent, true);
  assert.equal(JSON.stringify(summary).includes('secret://tenants/'), false);
  assert.equal(rotated.credentialReference.version, 2);
  assert.equal(bootstrap.requestedState, 'pending');
  assert.equal(event.entityType, 'tenant_storage_context');
});

test('provider catalog exposes deterministic storage logical organization helpers', () => {
  const tenantContext = getTenantStorageContextRecord({
    tenant: {
      tenantId: 'ten_01layout',
      slug: 'layout',
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
    now: '2026-03-27T21:05:00Z'
  });
  const organization = getStorageLogicalOrganization({
    tenantStorageContext: tenantContext,
    workspaceId: 'wrk_01layout',
    workspaceSlug: 'layout-dev'
  });
  const appPlacement = getStorageObjectOrganization({
    tenantStorageContext: tenantContext,
    workspaceId: 'wrk_01layout',
    workspaceSlug: 'layout-dev',
    applicationId: 'app_01layout',
    applicationSlug: 'console-app',
    objectKey: 'images/logo.png'
  });
  const workspacePlacement = getStorageObjectOrganization({
    tenantStorageContext: tenantContext,
    workspaceId: 'wrk_01layout',
    workspaceSlug: 'layout-dev',
    objectKey: 'shared/logo.png'
  });

  assert.equal(storageLogicalOrganizationErrorCodes.RESERVED_PREFIX_CONFLICT, 'RESERVED_PREFIX_CONFLICT');
  assert.equal(organization.strategy, 'tenant-workspace-application-prefix-v1');
  assert.equal(organization.workspaceRootPrefix, 'tenants/ten_01layout/workspaces/wrk_01layout/');
  assert.equal(organization.workspaceSharedPrefix, 'tenants/ten_01layout/workspaces/wrk_01layout/shared/');
  assert.equal(organization.applicationRootPrefixTemplate, 'tenants/ten_01layout/workspaces/wrk_01layout/apps/{applicationId}/data/');
  assert.equal(organization.reservedPrefixes.length, 3);
  assert.equal(organization.slugIndependent, true);
  assert.equal(appPlacement.placementType, 'application');
  assert.equal(appPlacement.applicationId, 'app_01layout');
  assert.equal(appPlacement.applicationRootPrefix, 'tenants/ten_01layout/workspaces/wrk_01layout/apps/app_01layout/data/');
  assert.equal(appPlacement.canonicalObjectPath, 'tenants/ten_01layout/workspaces/wrk_01layout/apps/app_01layout/data/images/logo.png');
  assert.equal(workspacePlacement.placementType, 'workspace_shared');
  assert.equal(workspacePlacement.workspaceSharedPrefix, 'tenants/ten_01layout/workspaces/wrk_01layout/shared/');
  assert.equal(isReservedStoragePrefix({ organization, candidatePrefix: 'tenants/ten_01layout/workspaces/wrk_01layout/_platform/presigned/' }), true);
  assert.equal(isReservedStoragePrefix({ organization, candidatePrefix: 'tenants/ten_01layout/workspaces/wrk_01layout/shared/' }), false);
});

test('provider catalog exposes bucket and object helpers with bounded scope-safe contracts', () => {
  const tenantContext = getTenantStorageContextRecord({
    tenant: {
      tenantId: 'ten_01bucketops',
      slug: 'bucket-ops',
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
  const bucket = getStorageBucketRecord({
    workspaceId: 'wrk_01bucketops',
    workspaceSlug: 'bucket-ops-dev',
    bucketName: 'bucket-ops-assets',
    tenantStorageContext: tenantContext,
    objectCount: 1,
    totalBytes: 512,
    now: '2026-03-27T21:00:00Z'
  });
  const bucketSummary = getStorageBucketSummary(bucket);
  const bucketList = listStorageBuckets({ items: [bucket] });
  const objectRecord = getStorageObjectRecord({
    bucket,
    objectKey: 'images/banner.png',
    applicationId: 'app_01bucketops',
    applicationSlug: 'banner-app',
    sizeBytes: 512,
    contentType: 'image/png',
    metadata: {
      role: 'banner'
    },
    now: '2026-03-27T21:00:05Z'
  });
  const objectMetadata = getStorageObjectMetadata(objectRecord);
  const objectList = listStorageObjects({ items: [objectRecord] });
  const upload = uploadStorageObjectPreview({ bucket, object: objectRecord, requestedAt: '2026-03-27T21:00:10Z' });
  const download = downloadStorageObjectPreview({ bucket, object: objectRecord, requestedAt: '2026-03-27T21:00:11Z' });
  const objectDelete = deleteStorageObjectPreview({ bucket, object: objectRecord, requestedAt: '2026-03-27T21:00:12Z' });
  const blockedBucketDelete = deleteStorageBucketPreview({ bucket, now: '2026-03-27T21:00:13Z' });
  const event = buildStorageOperationEvent({
    operation: 'object.uploaded',
    bucket,
    object: objectRecord,
    actorUserId: 'usr_01bucketops',
    correlationId: 'cor_bucket_ops_01',
    occurredAt: '2026-03-27T21:00:10Z'
  });

  assert.equal(storageBucketObjectErrorCodes.BUCKET_NOT_EMPTY, 'BUCKET_NOT_EMPTY');
  assert.equal(bucket.providerType, 'garage');
  assert.equal(bucket.organization.workspaceSharedPrefix, 'tenants/ten_01bucketops/workspaces/wrk_01bucketops/shared/');
  assert.equal(bucketSummary.bucketName, 'bucket-ops-assets');
  assert.equal(bucketSummary.organization.applicationRootPrefixTemplate, 'tenants/ten_01bucketops/workspaces/wrk_01bucketops/apps/{applicationId}/data/');
  assert.equal(bucketList.items.length, 1);
  assert.equal(objectMetadata.objectKey, 'images/banner.png');
  assert.equal(objectMetadata.applicationId, 'app_01bucketops');
  assert.equal(objectMetadata.organization.placementType, 'application');
  assert.equal(objectMetadata.organization.canonicalObjectPath, 'tenants/ten_01bucketops/workspaces/wrk_01bucketops/apps/app_01bucketops/data/images/banner.png');
  assert.equal(Object.prototype.hasOwnProperty.call(objectMetadata, 'contentBase64'), false);
  assert.equal(objectList.items.length, 1);
  assert.equal(upload.accepted, true);
  assert.equal(download.payload.encoding, 'base64');
  assert.equal(typeof download.payload.contentBase64, 'string');
  assert.equal(objectDelete.accepted, true);
  assert.equal(blockedBucketDelete.accepted, false);
  assert.equal(blockedBucketDelete.reasonCode, storageBucketObjectErrorCodes.BUCKET_NOT_EMPTY);
  assert.equal(event.entityType, 'bucket_object');
  assert.equal(event.objectKey, 'images/banner.png');
});
