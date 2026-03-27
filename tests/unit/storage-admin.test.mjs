import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STORAGE_ADMIN_ERROR_CODES,
  STORAGE_BUCKET_OBJECT_ERRORS,
  STORAGE_LOGICAL_ORGANIZATION_ERRORS,
  STORAGE_PROVIDER_CAPABILITIES,
  TENANT_STORAGE_ERROR_CODES,
  buildStorageOperationEvent,
  buildTenantStorageEvent,
  deleteStorageBucketPreview,
  deleteStorageObjectPreviewResult,
  downloadStorageObjectPreviewResult,
  getStorageAdminRoute,
  getStorageCompatibilitySummary,
  listStorageAdminRoutes,
  listStorageBucketsPreview,
  listStorageObjectsPreview,
  previewReservedStoragePrefix,
  previewStorageBucket,
  previewStorageLogicalOrganization,
  previewStorageObject,
  previewStorageObjectOrganization,
  previewTenantStorageContext,
  previewWorkspaceStorageBootstrapContext,
  rotateTenantStorageCredentialPreview,
  summarizeStorageBucket,
  summarizeStorageObjectMetadata,
  summarizeStorageProviderIntrospection,
  summarizeStorageProviderSupport,
  summarizeTenantStorageContext,
  uploadStorageObjectPreviewResult
} from '../../apps/control-plane/src/storage-admin.mjs';

test('storage admin helper exposes bucket/object routes and provider introspection routes', () => {
  const routes = listStorageAdminRoutes();
  const createRoute = getStorageAdminRoute('createStorage');
  const listRoute = getStorageAdminRoute('listStorage');
  const getRoute = getStorageAdminRoute('getStorage');
  const deleteRoute = getStorageAdminRoute('deleteStorage');
  const listObjectsRoute = getStorageAdminRoute('listStorageObjects');
  const uploadRoute = getStorageAdminRoute('uploadStorageObject');
  const downloadRoute = getStorageAdminRoute('downloadStorageObject');
  const metadataRoute = getStorageAdminRoute('getStorageObjectMetadata');
  const deleteObjectRoute = getStorageAdminRoute('deleteStorageObject');
  const providerRoute = getStorageAdminRoute('getStorageProviderIntrospection');

  assert.ok(routes.some((route) => route.operationId === 'createStorage'));
  assert.ok(routes.some((route) => route.operationId === 'listStorage'));
  assert.ok(routes.some((route) => route.operationId === 'deleteStorage'));
  assert.ok(routes.some((route) => route.operationId === 'listStorageObjects'));
  assert.ok(routes.some((route) => route.operationId === 'uploadStorageObject'));
  assert.ok(routes.some((route) => route.operationId === 'downloadStorageObject'));
  assert.ok(routes.some((route) => route.operationId === 'getStorageObjectMetadata'));
  assert.ok(routes.some((route) => route.operationId === 'deleteStorageObject'));
  assert.ok(routes.some((route) => route.operationId === 'getStorageProviderIntrospection'));
  assert.equal(createRoute.resourceType, 'bucket');
  assert.equal(listRoute.resourceType, 'bucket');
  assert.equal(getRoute.resourceType, 'bucket');
  assert.equal(deleteRoute.resourceType, 'bucket');
  assert.equal(listObjectsRoute.resourceType, 'bucket_object');
  assert.equal(uploadRoute.resourceType, 'bucket_object');
  assert.equal(downloadRoute.resourceType, 'bucket_object');
  assert.equal(metadataRoute.resourceType, 'bucket_object');
  assert.equal(deleteObjectRoute.resourceType, 'bucket_object');
  assert.equal(providerRoute.resourceType, 'storage_provider');
});

test('storage provider support normalizes explicit provider selection into a ready provider profile', () => {
  const profile = summarizeStorageProviderSupport({
    storage: {
      config: {
        inline: {
          providerType: 'ceph_rgw',
          accessKey: 'should-not-leak'
        }
      }
    }
  });
  const compatibility = getStorageCompatibilitySummary({
    storage: {
      config: {
        inline: {
          providerType: 'minio'
        }
      }
    }
  });

  assert.equal(profile.providerType, 'ceph-rgw');
  assert.equal(profile.status, 'ready');
  assert.equal(profile.configured, true);
  assert.equal(profile.configuredVia, 'storage.config.inline.providerType');
  assert.deepEqual(Object.keys(profile.capabilityManifest), STORAGE_PROVIDER_CAPABILITIES);
  assert.equal(profile.capabilityManifest.bucketOperations, true);
  assert.equal(profile.capabilityManifest.objectCrud, true);
  assert.equal(profile.supportedProviderTypes.includes('minio'), true);
  assert.equal(profile.supportedProviderTypes.includes('ceph-rgw'), true);
  assert.equal(JSON.stringify(profile).includes('should-not-leak'), false);

  assert.equal(compatibility.providerType, 'minio');
  assert.equal(compatibility.status, 'ready');
  assert.equal(compatibility.routeIds.includes('getStorageProviderIntrospection'), true);
  assert.equal(compatibility.publicBucketRoutes.includes('createStorage'), true);
  assert.equal(compatibility.publicBucketRoutes.includes('listStorage'), true);
  assert.equal(compatibility.publicBucketRoutes.includes('getStorage'), true);
  assert.equal(compatibility.publicBucketRoutes.includes('deleteStorage'), true);
  assert.equal(compatibility.publicObjectRoutes.includes('listStorageObjects'), true);
  assert.equal(compatibility.publicObjectRoutes.includes('uploadStorageObject'), true);
  assert.equal(compatibility.publicObjectRoutes.includes('downloadStorageObject'), true);
});

test('storage provider support fails safely for missing, unknown, and ambiguous provider selection', () => {
  const missing = summarizeStorageProviderSupport({});
  const unknown = summarizeStorageProviderSupport({ providerType: 'unknown-provider' });
  const ambiguous = summarizeStorageProviderSupport({
    providerType: 'minio',
    storage: {
      config: {
        inline: {
          providerType: 'garage'
        }
      }
    }
  });
  const introspection = summarizeStorageProviderIntrospection({ providerType: 'minio' });

  assert.equal(missing.status, 'unavailable');
  assert.equal(missing.errorCode, STORAGE_ADMIN_ERROR_CODES.MISSING_PROVIDER_TYPE);
  assert.equal(Object.values(missing.capabilityManifest).every((value) => value === false), true);

  assert.equal(unknown.status, 'unavailable');
  assert.equal(unknown.errorCode, STORAGE_ADMIN_ERROR_CODES.UNKNOWN_PROVIDER_TYPE);

  assert.equal(ambiguous.status, 'unavailable');
  assert.equal(ambiguous.errorCode, STORAGE_ADMIN_ERROR_CODES.AMBIGUOUS_PROVIDER_SELECTION);
  assert.equal(Array.isArray(ambiguous.configuredVia), true);

  assert.equal(introspection.route.operationId, 'getStorageProviderIntrospection');
  assert.equal(introspection.supportedProviders.length >= 2, true);
  assert.deepEqual(introspection.capabilityFields, STORAGE_PROVIDER_CAPABILITIES);
});

test('tenant storage context summary is tenant-isolated, introspectable, and secret-safe', () => {
  const preview = previewTenantStorageContext({
    tenant: {
      tenantId: 'ten_01atelier',
      slug: 'atelier',
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
    correlationId: 'cor_storage_ctx_01',
    now: '2026-03-27T20:40:00Z'
  });
  const summary = summarizeTenantStorageContext({
    tenant: {
      tenantId: 'ten_01atelier',
      slug: 'atelier',
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
    correlationId: 'cor_storage_ctx_01',
    now: '2026-03-27T20:40:00Z'
  });
  const event = buildTenantStorageEvent({
    storageContext: preview,
    transition: 'succeeded',
    actorUserId: 'usr_01owner',
    correlationId: 'cor_storage_ctx_01',
    occurredAt: '2026-03-27T20:40:05Z'
  });

  assert.equal(getStorageAdminRoute('getTenantStorageContext').resourceType, 'tenant_storage_context');
  assert.equal(preview.state, 'active');
  assert.equal(preview.bucketProvisioningAllowed, true);
  assert.equal(preview.namespace.startsWith('tctx-atelier-'), true);
  assert.equal(summary.route.operationId, 'getTenantStorageContext');
  assert.equal(summary.context.quotaAssignment.capabilityAvailable, true);
  assert.equal(summary.context.credential.secretReferencePresent, true);
  assert.equal(JSON.stringify(summary).includes('secret://tenants/'), false);
  assert.equal(event.eventType, 'tenant_storage_context.succeeded');
  assert.equal(event.quotaAssignment.maxBuckets >= 8, true);
});

test('storage logical organization previews are deterministic and reserve platform prefixes', () => {
  const activeContext = previewTenantStorageContext({
    tenant: {
      tenantId: 'ten_01layoutactive',
      slug: 'layout-active',
      state: 'active',
      planId: 'pln_01starter'
    },
    storage: {
      config: {
        inline: {
          providerType: 'minio'
        }
      }
    },
    now: '2026-03-27T20:44:00Z'
  });
  const organization = previewStorageLogicalOrganization({
    tenantStorageContext: activeContext,
    workspaceId: 'wrk_01layoutactive',
    workspaceSlug: 'layout-dev'
  });
  const appPlacement = previewStorageObjectOrganization({
    tenantStorageContext: activeContext,
    workspaceId: 'wrk_01layoutactive',
    workspaceSlug: 'layout-dev',
    applicationId: 'app_01layoutactive',
    applicationSlug: 'console-app',
    objectKey: 'avatars/logo.png'
  });
  const sharedPlacement = previewStorageObjectOrganization({
    tenantStorageContext: activeContext,
    workspaceId: 'wrk_01layoutactive',
    workspaceSlug: 'layout-dev',
    objectKey: 'shared/logo.png'
  });

  assert.equal(STORAGE_LOGICAL_ORGANIZATION_ERRORS.RESERVED_PREFIX_CONFLICT, 'RESERVED_PREFIX_CONFLICT');
  assert.equal(organization.strategy, 'tenant-workspace-application-prefix-v1');
  assert.equal(organization.workspaceRootPrefix, 'tenants/ten_01layoutactive/workspaces/wrk_01layoutactive/');
  assert.equal(organization.workspaceSharedPrefix, 'tenants/ten_01layoutactive/workspaces/wrk_01layoutactive/shared/');
  assert.equal(organization.reservedPrefixes.length, 3);
  assert.equal(previewReservedStoragePrefix({ organization, candidatePrefix: 'tenants/ten_01layoutactive/workspaces/wrk_01layoutactive/_platform/multipart/' }), true);
  assert.equal(previewReservedStoragePrefix({ organization, candidatePrefix: 'tenants/ten_01layoutactive/workspaces/wrk_01layoutactive/shared/' }), false);
  assert.equal(appPlacement.placementType, 'application');
  assert.equal(appPlacement.applicationRootPrefix, 'tenants/ten_01layoutactive/workspaces/wrk_01layoutactive/apps/app_01layoutactive/data/');
  assert.equal(appPlacement.canonicalObjectPath, 'tenants/ten_01layoutactive/workspaces/wrk_01layoutactive/apps/app_01layoutactive/data/avatars/logo.png');
  assert.equal(sharedPlacement.placementType, 'workspace_shared');
  assert.equal(sharedPlacement.workspaceSharedPrefix, 'tenants/ten_01layoutactive/workspaces/wrk_01layoutactive/shared/');
});

test('bucket and object previews stay scope-bound and expose bounded metadata/download surfaces', () => {
  const activeContext = previewTenantStorageContext({
    tenant: {
      tenantId: 'ten_01atelieractive',
      slug: 'atelier-active',
      state: 'active',
      planId: 'pln_01starter'
    },
    storage: {
      config: {
        inline: {
          providerType: 'minio'
        }
      }
    },
    now: '2026-03-27T20:45:00Z'
  });
  const bucket = previewStorageBucket({
    workspaceId: 'wrk_01atelieractive',
    workspaceSlug: 'atelier-live',
    bucketName: 'atelier-assets',
    region: 'us-east-1',
    tenantStorageContext: activeContext,
    objectCount: 1,
    totalBytes: 128,
    now: '2026-03-27T20:45:00Z'
  });
  const bucketSummary = summarizeStorageBucket(bucket);
  const bucketList = listStorageBucketsPreview({ items: [bucket] });
  const objectRecord = previewStorageObject({
    bucket,
    objectKey: 'avatars/logo.png',
    applicationId: 'app_01atelieractive',
    applicationSlug: 'console-app',
    sizeBytes: 128,
    contentType: 'image/png',
    metadata: {
      label: 'logo'
    },
    checksumSha256: 'abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abcd',
    now: '2026-03-27T20:45:10Z'
  });
  const metadata = summarizeStorageObjectMetadata(objectRecord);
  const objectList = listStorageObjectsPreview({ items: [objectRecord] });
  const upload = uploadStorageObjectPreviewResult({ bucket, object: objectRecord, requestedAt: '2026-03-27T20:45:12Z' });
  const download = downloadStorageObjectPreviewResult({ bucket, object: objectRecord, requestedAt: '2026-03-27T20:45:13Z' });
  const objectDelete = deleteStorageObjectPreviewResult({ bucket, object: objectRecord, requestedAt: '2026-03-27T20:45:14Z' });
  const event = buildStorageOperationEvent({
    operation: 'object.deleted',
    bucket,
    object: objectRecord,
    actorUserId: 'usr_01atelier',
    correlationId: 'cor_storage_object_01',
    occurredAt: '2026-03-27T20:45:14Z'
  });

  assert.equal(bucketSummary.route.operationId, 'getStorage');
  assert.equal(bucketSummary.bucket.objectStats.objectCount, 1);
  assert.equal(bucketSummary.bucket.organization.workspaceSharedPrefix, 'tenants/ten_01atelieractive/workspaces/wrk_01atelieractive/shared/');
  assert.equal(bucketList.route.operationId, 'listStorage');
  assert.equal(bucketList.collection.items.length, 1);
  assert.equal(metadata.route.operationId, 'getStorageObjectMetadata');
  assert.equal(metadata.object.objectKey, 'avatars/logo.png');
  assert.equal(metadata.object.applicationId, 'app_01atelieractive');
  assert.equal(metadata.object.organization.placementType, 'application');
  assert.equal(metadata.object.organization.canonicalObjectPath, 'tenants/ten_01atelieractive/workspaces/wrk_01atelieractive/apps/app_01atelieractive/data/avatars/logo.png');
  assert.equal(Object.prototype.hasOwnProperty.call(metadata.object, 'contentBase64'), false);
  assert.equal(objectList.route.operationId, 'listStorageObjects');
  assert.equal(objectList.collection.items.length, 1);
  assert.equal(upload.route.operationId, 'uploadStorageObject');
  assert.equal(upload.accepted, true);
  assert.equal(download.route.operationId, 'downloadStorageObject');
  assert.equal(download.payload.encoding, 'base64');
  assert.equal(download.payload.contentType, 'image/png');
  assert.equal(typeof download.payload.contentBase64, 'string');
  assert.equal(objectDelete.route.operationId, 'deleteStorageObject');
  assert.equal(objectDelete.accepted, true);
  assert.equal(event.entityType, 'bucket_object');
  assert.equal(event.objectKey, 'avatars/logo.png');
});

test('tenant storage context lifecycle gating and bucket deletion rules block unsafe operations', () => {
  const pendingContext = previewTenantStorageContext({
    tenant: {
      tenantId: 'ten_01atelierpending',
      slug: 'atelier-pending',
      state: 'pending_activation',
      planId: 'pln_01starter'
    },
    storage: {
      config: {
        inline: {
          providerType: 'minio'
        }
      }
    },
    now: '2026-03-27T20:45:00Z'
  });
  const blocked = previewWorkspaceStorageBootstrapContext({
    tenantId: 'ten_01atelierpending',
    workspaceId: 'wrk_01atelierpending',
    workspaceSlug: 'atelier-dev',
    storageContext: pendingContext,
    now: '2026-03-27T20:45:00Z'
  });
  const activeContext = previewTenantStorageContext({
    tenant: {
      tenantId: 'ten_01atelieractive',
      slug: 'atelier-active',
      state: 'active',
      planId: 'pln_01starter'
    },
    storage: {
      config: {
        inline: {
          providerType: 'minio'
        }
      }
    },
    now: '2026-03-27T20:45:00Z'
  });
  const ready = previewWorkspaceStorageBootstrapContext({
    tenantId: 'ten_01atelieractive',
    workspaceId: 'wrk_01atelieractive',
    workspaceSlug: 'atelier-live',
    storageContext: activeContext,
    now: '2026-03-27T20:45:00Z'
  });
  const rotated = rotateTenantStorageCredentialPreview({
    storageContext: activeContext,
    actorUserId: 'usr_01owner',
    requestedAt: '2026-03-27T20:46:00Z',
    reason: 'scheduled_rotation'
  });
  const blockedBucketDelete = deleteStorageBucketPreview({
    bucket: previewStorageBucket({
      workspaceId: 'wrk_01atelieractive',
      bucketName: 'atelier-retained',
      tenantStorageContext: activeContext,
      objectCount: 2,
      totalBytes: 256,
      now: '2026-03-27T20:46:00Z'
    }),
    now: '2026-03-27T20:46:10Z'
  });
  const protectedBucketDelete = deleteStorageBucketPreview({
    bucket: previewStorageBucket({
      workspaceId: 'wrk_01atelieractive',
      bucketName: 'default-storage-bucket',
      tenantStorageContext: activeContext,
      managed: true,
      managedResourceKey: 'default_storage_bucket',
      objectCount: 0,
      totalBytes: 0,
      now: '2026-03-27T20:46:00Z'
    }),
    now: '2026-03-27T20:46:10Z'
  });
  const allowedBucketDelete = deleteStorageBucketPreview({
    bucket: previewStorageBucket({
      workspaceId: 'wrk_01atelieractive',
      bucketName: 'atelier-empty',
      tenantStorageContext: activeContext,
      objectCount: 0,
      totalBytes: 0,
      now: '2026-03-27T20:46:00Z'
    }),
    now: '2026-03-27T20:46:10Z'
  });

  assert.equal(blocked.requestedState, 'dependency_wait');
  assert.equal(blocked.reasonCode, TENANT_STORAGE_ERROR_CODES.CONTEXT_PENDING);
  assert.equal(ready.requestedState, 'pending');
  assert.equal(ready.namespace, activeContext.namespace);
  assert.equal(rotated.route.operationId, 'rotateTenantStorageContextCredential');
  assert.equal(rotated.context.credential.version, 2);
  assert.equal(rotated.context.credential.health, 'rotated');
  assert.equal(blockedBucketDelete.route.operationId, 'deleteStorage');
  assert.equal(blockedBucketDelete.accepted, false);
  assert.equal(blockedBucketDelete.reasonCode, STORAGE_BUCKET_OBJECT_ERRORS.BUCKET_NOT_EMPTY);
  assert.equal(protectedBucketDelete.accepted, false);
  assert.equal(protectedBucketDelete.reasonCode, STORAGE_BUCKET_OBJECT_ERRORS.BUCKET_PROTECTED);
  assert.equal(allowedBucketDelete.accepted, true);
});
