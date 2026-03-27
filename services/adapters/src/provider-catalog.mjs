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

export const providerAdapterCatalog = listAdapterPorts();
export const adapterCallContract = getContract('adapter_call');
export const adapterResultContract = getContract('adapter_result');
export const supportedStorageProviderTypes = SUPPORTED_STORAGE_PROVIDER_TYPES;

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
