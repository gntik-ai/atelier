import test from 'node:test';
import assert from 'node:assert/strict';

import {
  adapterCallContract,
  adapterResultContract,
  getStorageProviderCompatibilitySummary,
  getStorageProviderProfile,
  listAuditAdapters,
  listProvisioningAdapters,
  listStorageProviderProfiles,
  providerAdapterCatalog,
  supportedStorageProviderTypes
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
