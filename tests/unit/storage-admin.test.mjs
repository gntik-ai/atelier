import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STORAGE_ADMIN_ERROR_CODES,
  STORAGE_PROVIDER_CAPABILITIES,
  getStorageAdminRoute,
  getStorageCompatibilitySummary,
  listStorageAdminRoutes,
  summarizeStorageProviderIntrospection,
  summarizeStorageProviderSupport
} from '../../apps/control-plane/src/storage-admin.mjs';

test('storage admin helper exposes bucket routes and provider introspection route', () => {
  const routes = listStorageAdminRoutes();
  const createRoute = getStorageAdminRoute('createStorage');
  const getRoute = getStorageAdminRoute('getStorage');
  const providerRoute = getStorageAdminRoute('getStorageProviderIntrospection');

  assert.ok(routes.some((route) => route.operationId === 'createStorage'));
  assert.ok(routes.some((route) => route.operationId === 'getStorage'));
  assert.ok(routes.some((route) => route.operationId === 'getStorageProviderIntrospection'));
  assert.equal(createRoute.resourceType, 'bucket');
  assert.equal(getRoute.resourceType, 'bucket');
  assert.equal(providerRoute.resourceType, 'storage_provider');
  assert.equal(providerRoute.scope, 'platform');
  assert.equal(providerRoute.tenantBinding, 'none');
  assert.equal(providerRoute.workspaceBinding, 'none');
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
  assert.equal(compatibility.publicBucketRoutes.includes('getStorage'), true);
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
