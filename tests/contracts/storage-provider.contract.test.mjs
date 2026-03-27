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
  downloadStorageObjectPreviewResult,
  listStorageObjectsPreview,
  previewStorageBucket,
  previewStorageObject,
  previewTenantStorageContext,
  summarizeStorageProviderIntrospection,
  summarizeTenantStorageContext
} from '../../apps/control-plane/src/storage-admin.mjs';

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
  assert.deepEqual(tenantContextSchema.required.includes('credential'), true);
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
    'objectVersioning'
  ]);
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

  assert.equal(introspection.profile.providerType, 'garage');
  assert.equal(introspection.profile.status, 'ready');
  assert.equal(introspection.supportedProviders.length >= 2, true);
  assert.equal(tenantContext.route.operationId, 'getTenantStorageContext');
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

  assert.ok(bucketObjectTaxonomy);
  assert.equal(bucketObjectTaxonomy.family, 'storage');
  assert.equal(bucketObjectTaxonomy.scope, 'workspace');
  assert.equal(bucketObjectTaxonomy.authorization_resource, 'bucket');
});
