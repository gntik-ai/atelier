import { readFileSync } from 'node:fs';

const INTERNAL_SERVICE_MAP_URL = new URL('./internal-service-map.json', import.meta.url);
const DEPLOYMENT_TOPOLOGY_URL = new URL('./deployment-topology.json', import.meta.url);
const AUTHORIZATION_MODEL_URL = new URL('./authorization-model.json', import.meta.url);
const DOMAIN_MODEL_URL = new URL('./domain-model.json', import.meta.url);
const PUBLIC_API_TAXONOMY_URL = new URL('./public-api-taxonomy.json', import.meta.url);
const PUBLIC_ROUTE_CATALOG_URL = new URL('./public-route-catalog.json', import.meta.url);

let cachedInternalServiceMap;
let cachedDeploymentTopology;
let cachedAuthorizationModel;
let cachedDomainModel;
let cachedPublicApiTaxonomy;
let cachedPublicRouteCatalog;

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

export function readPublicApiTaxonomy() {
  if (!cachedPublicApiTaxonomy) {
    cachedPublicApiTaxonomy = JSON.parse(readFileSync(PUBLIC_API_TAXONOMY_URL, 'utf8'));
  }

  return cachedPublicApiTaxonomy;
}

export function readPublicRouteCatalog() {
  if (!cachedPublicRouteCatalog) {
    cachedPublicRouteCatalog = JSON.parse(readFileSync(PUBLIC_ROUTE_CATALOG_URL, 'utf8'));
  }

  return cachedPublicRouteCatalog;
}

export const INTERNAL_CONTRACT_VERSION = readInternalServiceMap().version;
export const DEPLOYMENT_TOPOLOGY_VERSION = readDeploymentTopology().version;
export const AUTHORIZATION_MODEL_VERSION = readAuthorizationModel().version;
export const DOMAIN_MODEL_VERSION = readDomainModel().version;
export const PUBLIC_API_VERSION = readPublicApiTaxonomy().version;
export const CONTROL_API_SERVICE_ID = 'control_api';
export const PROVISIONING_ORCHESTRATOR_SERVICE_ID = 'provisioning_orchestrator';
export const EVENT_GATEWAY_SERVICE_ID = 'event_gateway';
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

export function getPublicApiRelease() {
  return readPublicApiTaxonomy().release;
}

export function listApiFamilies() {
  return readPublicApiTaxonomy().families;
}

export function getApiFamily(familyId) {
  return listApiFamilies().find((family) => family.id === familyId);
}

export function listPublicRoutes() {
  return readPublicRouteCatalog().routes ?? [];
}

export function getPublicRoute(operationId) {
  return listPublicRoutes().find((route) => route.operationId === operationId);
}

export function filterPublicRoutes(filters = {}) {
  const predicateEntries = Object.entries(filters).filter(([, value]) => value !== undefined && value !== null && value !== '');

  return listPublicRoutes().filter((route) =>
    predicateEntries.every(([field, value]) => {
      const routeValue = route[field];

      if (Array.isArray(routeValue)) {
        return routeValue.includes(value);
      }

      return routeValue === value;
    })
  );
}

export function listResourceTaxonomy() {
  return readPublicApiTaxonomy().resource_taxonomy ?? [];
}

export function getResourceTaxonomy(resourceType) {
  return listResourceTaxonomy().find((resource) => resource.resource_type === resourceType);
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

export function listBusinessStateMachines() {
  return readDomainModel().business_state_machines ?? [];
}

export function getBusinessStateMachine(stateMachineId) {
  return listBusinessStateMachines().find((machine) => machine.id === stateMachineId);
}

export function listCommercialPlans() {
  return readDomainModel().governance_catalogs?.plans ?? [];
}

export function getCommercialPlan(planId) {
  return listCommercialPlans().find((plan) => plan.planId === planId);
}

export function listQuotaPolicies() {
  return readDomainModel().governance_catalogs?.quota_policies ?? [];
}

export function getQuotaPolicy(quotaPolicyId) {
  return listQuotaPolicies().find((policy) => policy.quotaPolicyId === quotaPolicyId);
}

export function listDeploymentProfileCatalog() {
  return readDomainModel().governance_catalogs?.deployment_profiles ?? [];
}

export function getDeploymentProfileCatalogEntry(deploymentProfileId) {
  return listDeploymentProfileCatalog().find((profile) => profile.deploymentProfileId === deploymentProfileId);
}

export function listProviderCapabilityCatalog() {
  return readDomainModel().governance_catalogs?.provider_capabilities ?? [];
}

export function getProviderCapabilityCatalogEntry(providerCapabilityId) {
  return listProviderCapabilityCatalog().find((capability) => capability.providerCapabilityId === providerCapabilityId);
}

export function getEffectiveCapabilityResolutionContract() {
  return readDomainModel().contracts?.effective_capability_resolution;
}

export function getEffectiveCapabilityResolutionDescriptor() {
  return readDomainModel().effective_capability_resolution;
}

export function listPlanChangeScenarios() {
  return readDomainModel().plan_change_scenarios ?? [];
}

function indexQuotaLimits(quotaPolicy) {
  return new Map((quotaPolicy?.defaultLimits ?? []).map((limit) => [limit.metricKey, limit]));
}

function normalizeProviderCapability(providerCapability, enabled) {
  return {
    capabilityKey: providerCapability.capabilityKey,
    provider: providerCapability.provider,
    plane: providerCapability.plane,
    enabled,
    capabilityStatus: providerCapability.capabilityStatus,
    supportLevel: providerCapability.supportLevel,
    allowedEnvironments: providerCapability.allowedEnvironments,
    reason: enabled ? 'enabled_by_plan_and_profile' : 'not_granted_or_unavailable'
  };
}

function buildCapabilityResolution({ scope, tenantId, workspaceId, plan, deploymentProfile, quotaPolicy, capabilities, resolvedAt }) {
  return {
    scope,
    tenantId,
    workspaceId,
    planId: plan.planId,
    deploymentProfileId: deploymentProfile.deploymentProfileId,
    quotas: (quotaPolicy.defaultLimits ?? []).map((limit) => ({
      metricKey: limit.metricKey,
      scope: limit.scope,
      unit: limit.unit,
      limit: limit.limit,
      enforcementMode: quotaPolicy.enforcementMode
    })),
    capabilities,
    resolvedAt,
    correlationContext: {
      contractVersion: getEffectiveCapabilityResolutionContract()?.version ?? readDomainModel().version,
      planes: [...new Set(capabilities.map((capability) => capability.plane))]
    }
  };
}

export function resolveTenantEffectiveCapabilities({ tenantId = null, planId, resolvedAt = '2026-03-24T00:00:00Z' }) {
  const plan = getCommercialPlan(planId);
  if (!plan) {
    throw new Error(`Unknown plan ${planId}.`);
  }

  const quotaPolicy = getQuotaPolicy(plan.quotaPolicyId);
  const deploymentProfile = getDeploymentProfileCatalogEntry(plan.deploymentProfileId);
  const providerCapabilities = new Map(
    listProviderCapabilityCatalog().map((capability) => [capability.providerCapabilityId, capability])
  );

  if (!quotaPolicy || !deploymentProfile) {
    throw new Error(`Plan ${planId} is missing quota policy or deployment profile metadata.`);
  }

  const capabilities = (deploymentProfile.providerCapabilityIds ?? [])
    .map((providerCapabilityId) => providerCapabilities.get(providerCapabilityId))
    .filter(Boolean)
    .map((providerCapability) =>
      normalizeProviderCapability(providerCapability, plan.capabilityKeys.includes(providerCapability.capabilityKey))
    )
    .filter((capability) => capability.enabled);

  return buildCapabilityResolution({
    scope: 'tenant',
    tenantId,
    workspaceId: undefined,
    plan,
    deploymentProfile,
    quotaPolicy,
    capabilities,
    resolvedAt
  });
}

export function resolveWorkspaceEffectiveCapabilities({
  tenantId = null,
  workspaceId,
  workspaceEnvironment,
  planId,
  resolvedAt = '2026-03-24T00:00:00Z'
}) {
  const tenantResolution = resolveTenantEffectiveCapabilities({ tenantId, planId, resolvedAt });
  const capabilities = tenantResolution.capabilities.filter((capability) =>
    capability.allowedEnvironments.includes(workspaceEnvironment)
  );

  return {
    ...tenantResolution,
    scope: 'workspace',
    workspaceId,
    capabilities
  };
}

export function evaluatePlanChange({ fromPlanId, toPlanId, currentUsage = {}, resolvedAt = '2026-03-24T00:00:00Z' }) {
  const fromResolution = resolveTenantEffectiveCapabilities({ planId: fromPlanId, resolvedAt });
  const toResolution = resolveTenantEffectiveCapabilities({ planId: toPlanId, resolvedAt });
  const fromCapabilities = new Set(fromResolution.capabilities.map((capability) => capability.capabilityKey));
  const toCapabilities = new Set(toResolution.capabilities.map((capability) => capability.capabilityKey));
  const fromQuotaLimits = indexQuotaLimits(getQuotaPolicy(fromResolution.planId ? getCommercialPlan(fromPlanId).quotaPolicyId : undefined));
  const toQuotaLimits = indexQuotaLimits(getQuotaPolicy(toResolution.planId ? getCommercialPlan(toPlanId).quotaPolicyId : undefined));
  const addedCapabilities = [...toCapabilities].filter((capability) => !fromCapabilities.has(capability));
  const removedCapabilities = [...fromCapabilities].filter((capability) => !toCapabilities.has(capability));
  const blockingMetrics = [];
  const quotaDelta = [];

  for (const [metricKey, nextLimit] of toQuotaLimits.entries()) {
    const previousLimit = fromQuotaLimits.get(metricKey);
    quotaDelta.push({
      metricKey,
      previousLimit: previousLimit?.limit ?? null,
      nextLimit: nextLimit.limit
    });

    if ((currentUsage[metricKey] ?? 0) > nextLimit.limit) {
      blockingMetrics.push(metricKey);
    }
  }

  return {
    fromPlanId,
    toPlanId,
    status: blockingMetrics.length > 0 ? 'requires_remediation' : 'compatible',
    addedCapabilities,
    removedCapabilities,
    blockingMetrics,
    quotaDelta
  };
}
