import { readFileSync } from 'node:fs';

const INTERNAL_SERVICE_MAP_URL = new URL('./internal-service-map.json', import.meta.url);
const DEPLOYMENT_TOPOLOGY_URL = new URL('./deployment-topology.json', import.meta.url);

let cachedInternalServiceMap;
let cachedDeploymentTopology;

export function readInternalServiceMap() {
  if (!cachedInternalServiceMap) {
    cachedInternalServiceMap = JSON.parse(readFileSync(INTERNAL_SERVICE_MAP_URL, 'utf8'));
  }

  return cachedInternalServiceMap;
}

export function readDeploymentTopology() {
  if (!cachedDeploymentTopology) {
    cachedDeploymentTopology = JSON.parse(readFileSync(DEPLOYMENT_TOPOLOGY_URL, 'utf8'));
  }

  return cachedDeploymentTopology;
}

export const INTERNAL_CONTRACT_VERSION = readInternalServiceMap().version;
export const DEPLOYMENT_TOPOLOGY_VERSION = readDeploymentTopology().version;
export const CONTROL_API_SERVICE_ID = 'control_api';
export const PROVISIONING_ORCHESTRATOR_SERVICE_ID = 'provisioning_orchestrator';
export const AUDIT_MODULE_SERVICE_ID = 'audit_module';

export function listServices() {
  return readInternalServiceMap().services;
}

export function getService(serviceId) {
  return listServices().find((service) => service.id === serviceId);
}

export function listAdapterPorts() {
  return readInternalServiceMap().adapter_ports;
}

export function getAdapterPort(adapterId) {
  return listAdapterPorts().find((adapter) => adapter.id === adapterId);
}

export function listContracts() {
  return Object.entries(readInternalServiceMap().contracts).map(([id, contract]) => ({ id, ...contract }));
}

export function getContract(contractId) {
  return readInternalServiceMap().contracts[contractId];
}

export function listInteractionFlows() {
  return readInternalServiceMap().interaction_flows;
}

export function listEnvironmentProfiles() {
  return readDeploymentTopology().environment_profiles;
}

export function getEnvironmentProfile(environmentId) {
  return listEnvironmentProfiles().find((profile) => profile.id === environmentId);
}

export function listDeploymentPlatforms() {
  return Object.entries(readDeploymentTopology().platform_matrix).map(([id, platform]) => ({ id, ...platform }));
}

export function getDeploymentContract(contractId) {
  return readDeploymentTopology().contracts[contractId];
}

export function listAdapterPortsForConsumer(serviceId) {
  return listAdapterPorts().filter((adapter) => adapter.consumers.includes(serviceId));
}

export function listContractsForService(serviceId) {
  const service = getService(serviceId);
  if (!service) return [];

  return [...service.inbound_contracts, ...service.outbound_contracts].map((contractId) => ({
    id: contractId,
    ...getContract(contractId)
  }));
}
