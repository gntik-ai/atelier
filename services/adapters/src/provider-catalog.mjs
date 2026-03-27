import {
  getContract,
  listAdapterPorts,
  listAdapterPortsForConsumer
} from '../../internal-contracts/src/index.mjs';
import {
  SUPPORTED_STORAGE_PROVIDER_TYPES,
  buildStorageProviderProfile,
  listSupportedStorageProviders,
  summarizeStorageProviderCompatibility
} from './storage-provider-profile.mjs';
import {
  buildTenantStorageContextIntrospection,
  buildTenantStorageContextRecord,
  buildTenantStorageProvisioningEvent,
  previewWorkspaceStorageBootstrap,
  rotateTenantStorageContextCredential
} from './storage-tenant-context.mjs';
import {
  STORAGE_BUCKET_OBJECT_ERROR_CODES,
  buildStorageBucketCollection,
  buildStorageBucketRecord,
  buildStorageBucketSummary,
  buildStorageMutationEvent,
  buildStorageObjectCollection,
  buildStorageObjectMetadata,
  buildStorageObjectRecord,
  previewStorageBucketDeletion,
  previewStorageObjectDeletion,
  previewStorageObjectDownload,
  previewStorageObjectUpload
} from './storage-bucket-object-ops.mjs';
import {
  STORAGE_LOGICAL_ORGANIZATION_ERROR_CODES,
  buildStorageLogicalOrganization,
  buildStorageObjectOrganization,
  isStorageReservedPrefix
} from './storage-logical-organization.mjs';

export const providerAdapterCatalog = listAdapterPorts();
export const adapterCallContract = getContract('adapter_call');
export const adapterResultContract = getContract('adapter_result');
export const supportedStorageProviderTypes = SUPPORTED_STORAGE_PROVIDER_TYPES;
export const storageBucketObjectErrorCodes = STORAGE_BUCKET_OBJECT_ERROR_CODES;
export const storageLogicalOrganizationErrorCodes = STORAGE_LOGICAL_ORGANIZATION_ERROR_CODES;

export function listProvisioningAdapters() {
  return listAdapterPortsForConsumer('provisioning_orchestrator');
}

export function listAuditAdapters() {
  return listAdapterPortsForConsumer('audit_module');
}

export function listStorageProviderProfiles() {
  return listSupportedStorageProviders();
}

export function getStorageProviderProfile(input = {}) {
  return buildStorageProviderProfile(input);
}

export function getStorageProviderCompatibilitySummary(input = {}) {
  return summarizeStorageProviderCompatibility(input);
}

export function getTenantStorageContextRecord(input = {}) {
  return buildTenantStorageContextRecord(input);
}

export function getTenantStorageContextSummary(input = {}) {
  return buildTenantStorageContextIntrospection(input);
}

export function buildTenantStorageEvent(input = {}) {
  return buildTenantStorageProvisioningEvent(input);
}

export function getWorkspaceStorageBootstrapPreview(input = {}) {
  return previewWorkspaceStorageBootstrap(input);
}

export function rotateTenantStorageCredential(input = {}) {
  return rotateTenantStorageContextCredential(input);
}

export function getStorageLogicalOrganization(input = {}) {
  return buildStorageLogicalOrganization(input);
}

export function getStorageObjectOrganization(input = {}) {
  return buildStorageObjectOrganization(input);
}

export function isReservedStoragePrefix(input = {}) {
  return isStorageReservedPrefix(input);
}

export function getStorageBucketRecord(input = {}) {
  return buildStorageBucketRecord(input);
}

export function getStorageBucketSummary(input = {}) {
  return buildStorageBucketSummary(input);
}

export function listStorageBuckets(input = {}) {
  return buildStorageBucketCollection(input);
}

export function deleteStorageBucketPreview(input = {}) {
  return previewStorageBucketDeletion(input);
}

export function getStorageObjectRecord(input = {}) {
  return buildStorageObjectRecord(input);
}

export function getStorageObjectMetadata(input = {}) {
  return buildStorageObjectMetadata(input);
}

export function listStorageObjects(input = {}) {
  return buildStorageObjectCollection(input);
}

export function uploadStorageObjectPreview(input = {}) {
  return previewStorageObjectUpload(input);
}

export function downloadStorageObjectPreview(input = {}) {
  return previewStorageObjectDownload(input);
}

export function deleteStorageObjectPreview(input = {}) {
  return previewStorageObjectDeletion(input);
}

export function buildStorageOperationEvent(input = {}) {
  return buildStorageMutationEvent(input);
}
