import test from 'node:test';
import assert from 'node:assert/strict';

import SwaggerParser from '@apidevtools/swagger-parser';
import {
  getAdapterPort,
  getPublicRoute
} from '../../services/internal-contracts/src/index.mjs';
import { OPENAPI_PATH } from '../../scripts/lib/quality-gates.mjs';
import { summarizeStorageProviderIntrospection } from '../../apps/control-plane/src/storage-admin.mjs';

test('storage provider OpenAPI contract exposes additive provider introspection route and schemas', async () => {
  const document = await SwaggerParser.validate(OPENAPI_PATH);
  const providerRoute = document.paths['/v1/platform/storage/provider']?.get;
  const manifestSchema = document.components.schemas.StorageCapabilityManifest;
  const providerSchema = document.components.schemas.StorageProviderIntrospection;
  const limitationSchema = document.components.schemas.StorageProviderLimitation;

  assert.ok(providerRoute);
  assert.equal(providerRoute['x-family'], 'platform');
  assert.equal(providerRoute['x-resource-type'], 'storage_provider');
  assert.equal(providerRoute['x-scope'], 'platform');
  assert.ok(manifestSchema);
  assert.ok(providerSchema);
  assert.ok(limitationSchema);
  assert.deepEqual(providerSchema.required.includes('capabilityManifest'), true);
  assert.deepEqual(Object.keys(manifestSchema.properties), [
    'bucketOperations',
    'objectCrud',
    'presignedUrls',
    'multipartUpload',
    'objectVersioning'
  ]);
});

test('storage provider contracts preserve public-route discoverability and adapter capability coverage', () => {
  const publicRoute = getPublicRoute('getStorageProviderIntrospection');
  const storageAdapter = getAdapterPort('storage');
  const introspection = summarizeStorageProviderIntrospection({ providerType: 'garage' });

  assert.equal(publicRoute.family, 'platform');
  assert.equal(publicRoute.path, '/v1/platform/storage/provider');
  assert.equal(publicRoute.resourceType, 'storage_provider');
  assert.equal(publicRoute.tenantBinding, 'none');
  assert.equal(publicRoute.workspaceBinding, 'none');
  assert.deepEqual(publicRoute.audiences, ['platform_team']);

  assert.ok(storageAdapter.capabilities.includes('ensure_bucket'));
  assert.ok(storageAdapter.capabilities.includes('resolve_provider_profile'));
  assert.ok(storageAdapter.capabilities.includes('get_capability_manifest'));
  assert.ok(storageAdapter.capabilities.includes('get_provider_status'));

  assert.equal(introspection.profile.providerType, 'garage');
  assert.equal(introspection.profile.status, 'ready');
  assert.equal(introspection.supportedProviders.length >= 2, true);
});
