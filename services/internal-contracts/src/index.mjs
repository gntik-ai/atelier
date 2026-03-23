import { readFileSync } from 'node:fs';

const INTERNAL_SERVICE_MAP_URL = new URL('./internal-service-map.json', import.meta.url);
const DEPLOYMENT_TOPOLOGY_URL = new URL('./deployment-topology.json', import.meta.url);
const AUTHORIZATION_MODEL_URL = new URL('./authorization-model.json', import.meta.url);
const DOMAIN_MODEL_URL = new URL('./domain-model.json', import.meta.url);

let cachedInternalServiceMap;
let cachedDeploymentTopology;
let cachedAuthorizationModel;
let cachedDomainModel;

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

export function readAuthorizationModel() {
  if (!cachedAuthorizationModel) {
    cachedAuthorizationModel = JSON.parse(readFileSync(AUTHORIZATION_MODEL_URL, 'utf8'));
  }

  return cachedAuthorizationModel;
}

export function readDomainModel() {
  if (!cachedDomainModel) {
    cachedDomainModel = JSON.parse(readFileSync(DOMAIN_MODEL_URL, 'utf8'));
  }

  return cachedDomainModel;
}

export const INTERNAL_CONTRACT_VERSION = readInternalServiceMap().version;
export const DEPLOYMENT_TOPOLOGY_VERSION = readDeploymentTopology().version;
export const AUTHORIZATION_MODEL_VERSION = readAuthorizationModel().version;
export const DOMAIN_MODEL_VERSION = readDomainModel().version;
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

export function listAuthorizationContracts() {
  return Object.entries(readAuthorizationModel().contracts).map(([id, contract]) => ({ id, ...contract }));
}

export function getAuthorizationContract(contractId) {
  return readAuthorizationModel().contracts[contractId];
}

export function listAuthorizationRoles(scope) {
  if (!scope) {
    return Object.entries(readAuthorizationModel().role_catalog).flatMap(([catalogScope, roles]) =>
      roles.map((role) => ({ catalog_scope: catalogScope, ...role }))
    );
  }

  return (readAuthorizationModel().role_catalog[scope] ?? []).map((role) => ({ catalog_scope: scope, ...role }));
}

export function getAuthorizationRole(scope, roleId) {
  return (readAuthorizationModel().role_catalog[scope] ?? []).find((role) => role.id === roleId);
}

export function listEnforcementSurfaces() {
  return readAuthorizationModel().enforcement_surfaces;
}

export function getEnforcementSurface(surfaceId) {
  return listEnforcementSurfaces().find((surface) => surface.id === surfaceId);
}

export function listResourceSemantics() {
  return readAuthorizationModel().resource_semantics;
}

export function getResourceSemantics(resourceType) {
  return listResourceSemantics().find((resource) => resource.resource_type === resourceType);
}

export function listResourceActions(resourceType) {
  if (!resourceType) {
    return Object.entries(readAuthorizationModel().resource_actions).flatMap(([type, actions]) =>
      actions.map((action) => ({ resource_type: type, action }))
    );
  }

  return (readAuthorizationModel().resource_actions[resourceType] ?? []).map((action) => ({ resource_type: resourceType, action }));
}

export function listPermissionMatrix(scope) {
  if (!scope) {
    return Object.entries(readAuthorizationModel().permission_matrix).flatMap(([matrixScope, entries]) =>
      entries.map((entry) => ({ matrix_scope: matrixScope, ...entry }))
    );
  }

  return (readAuthorizationModel().permission_matrix[scope] ?? []).map((entry) => ({ matrix_scope: scope, ...entry }));
}

export function listContextPropagationTargets() {
  return readAuthorizationModel().propagation_targets;
}

export function getContextPropagationTarget(targetId) {
  return listContextPropagationTargets().find((target) => target.target === targetId);
}

export function listNegativeAuthorizationScenarios() {
  return readAuthorizationModel().negative_scenarios;
}

export function listDomainContracts() {
  return Object.entries(readDomainModel().contracts).map(([id, contract]) => ({ id, ...contract }));
}

export function getDomainContract(contractId) {
  return readDomainModel().contracts[contractId];
}

export function listDomainEntities() {
  return readDomainModel().entities;
}

export function getDomainEntity(entityId) {
  return listDomainEntities().find((entity) => entity.id === entityId);
}

export function listDomainRelationships() {
  return readDomainModel().relationships;
}

export function listLifecycleTransitions() {
  return readDomainModel().lifecycle_transitions;
}

export function listLifecycleEvents(entityType) {
  if (!entityType) {
    return readDomainModel().lifecycle_events;
  }

  return readDomainModel().lifecycle_events.filter((event) => event.entity_type === entityType);
}
