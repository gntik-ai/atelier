import { readFileSync } from 'node:fs';

const INTERNAL_SERVICE_MAP_URL = new URL('./internal-service-map.json', import.meta.url);
const DEPLOYMENT_TOPOLOGY_URL = new URL('./deployment-topology.json', import.meta.url);
const AUTHORIZATION_MODEL_URL = new URL('./authorization-model.json', import.meta.url);
const DOMAIN_MODEL_URL = new URL('./domain-model.json', import.meta.url);
const OBSERVABILITY_METRICS_STACK_URL = new URL('./observability-metrics-stack.json', import.meta.url);
const OBSERVABILITY_DASHBOARDS_URL = new URL('./observability-dashboards.json', import.meta.url);
const OBSERVABILITY_HEALTH_CHECKS_URL = new URL('./observability-health-checks.json', import.meta.url);
const OBSERVABILITY_BUSINESS_METRICS_URL = new URL('./observability-business-metrics.json', import.meta.url);
const PUBLIC_API_TAXONOMY_URL = new URL('./public-api-taxonomy.json', import.meta.url);
const PUBLIC_ROUTE_CATALOG_URL = new URL('./public-route-catalog.json', import.meta.url);

let cachedInternalServiceMap;
let cachedDeploymentTopology;
let cachedAuthorizationModel;
let cachedDomainModel;
let cachedObservabilityMetricsStack;
let cachedObservabilityDashboards;
let cachedObservabilityHealthChecks;
let cachedObservabilityBusinessMetrics;
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

export function readObservabilityMetricsStack() {
  if (!cachedObservabilityMetricsStack) {
    cachedObservabilityMetricsStack = JSON.parse(readFileSync(OBSERVABILITY_METRICS_STACK_URL, 'utf8'));
  }

  return cachedObservabilityMetricsStack;
}

export function readObservabilityDashboards() {
  if (!cachedObservabilityDashboards) {
    cachedObservabilityDashboards = JSON.parse(readFileSync(OBSERVABILITY_DASHBOARDS_URL, 'utf8'));
  }

  return cachedObservabilityDashboards;
}

export function readObservabilityHealthChecks() {
  if (!cachedObservabilityHealthChecks) {
    cachedObservabilityHealthChecks = JSON.parse(readFileSync(OBSERVABILITY_HEALTH_CHECKS_URL, 'utf8'));
  }

  return cachedObservabilityHealthChecks;
}

export function readObservabilityBusinessMetrics() {
  if (!cachedObservabilityBusinessMetrics) {
    cachedObservabilityBusinessMetrics = JSON.parse(readFileSync(OBSERVABILITY_BUSINESS_METRICS_URL, 'utf8'));
  }

  return cachedObservabilityBusinessMetrics;
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
export const OBSERVABILITY_METRICS_STACK_VERSION = readObservabilityMetricsStack().version;
export const OBSERVABILITY_DASHBOARDS_VERSION = readObservabilityDashboards().version;
export const OBSERVABILITY_HEALTH_CHECKS_VERSION = readObservabilityHealthChecks().version;
export const OBSERVABILITY_BUSINESS_METRICS_VERSION = readObservabilityBusinessMetrics().version;
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

export function listObservabilityContracts() {
  return Object.entries(readObservabilityMetricsStack().contracts ?? {}).map(([id, contract]) => ({ id, ...contract }));
}

export function getObservabilityContract(contractId) {
  return readObservabilityMetricsStack().contracts?.[contractId];
}

export function listObservabilityMetricFamilies() {
  return readObservabilityMetricsStack().naming?.normalized_metric_families ?? [];
}

export function getObservabilityMetricFamily(metricFamilyId) {
  return listObservabilityMetricFamilies().find((family) => family.id === metricFamilyId);
}

export function listObservedSubsystems() {
  return readObservabilityMetricsStack().subsystems ?? [];
}

export function getObservedSubsystem(subsystemId) {
  return listObservedSubsystems().find((subsystem) => subsystem.id === subsystemId);
}

export function getObservabilityCollectionHealth() {
  return readObservabilityMetricsStack().collection_health ?? {};
}

export function listObservabilityDashboardScopes() {
  return readObservabilityDashboards().dashboard_scopes ?? [];
}

export function getObservabilityDashboardScope(scopeId) {
  return listObservabilityDashboardScopes().find((scope) => scope.id === scopeId);
}

export function listObservabilityDashboardDimensions() {
  return readObservabilityDashboards().mandatory_health_dimensions ?? [];
}

export function getObservabilityDashboardDimension(dimensionId) {
  return listObservabilityDashboardDimensions().find((dimension) => dimension.id === dimensionId);
}

export function listObservabilityDashboardWidgets() {
  return readObservabilityDashboards().subsystem_widget_catalog ?? [];
}

export function getObservabilityDashboardWidget(widgetId) {
  return listObservabilityDashboardWidgets().find((widget) => widget.id === widgetId);
}

export function listObservabilityProbeTypes() {
  return readObservabilityHealthChecks().probe_types ?? [];
}

export function getObservabilityProbeType(probeTypeId) {
  return listObservabilityProbeTypes().find((probeType) => probeType.id === probeTypeId);
}

export function listObservabilityHealthComponents() {
  return readObservabilityHealthChecks().components ?? [];
}

export function getObservabilityHealthComponent(componentId) {
  return listObservabilityHealthComponents().find((component) => component.id === componentId);
}

export function getObservabilityHealthExposureTemplates() {
  return readObservabilityHealthChecks().exposure_templates ?? {};
}

export function getObservabilityHealthProjection() {
  return readObservabilityHealthChecks().observability_projection ?? {};
}

export function listObservabilityBusinessDomains() {
  return readObservabilityBusinessMetrics().business_domains ?? [];
}

export function getObservabilityBusinessDomain(domainId) {
  return listObservabilityBusinessDomains().find((domain) => domain.id === domainId);
}

export function listObservabilityBusinessMetricTypes() {
  return readObservabilityBusinessMetrics().metric_types ?? [];
}

export function getObservabilityBusinessMetricType(metricTypeId) {
  return listObservabilityBusinessMetricTypes().find((metricType) => metricType.id === metricTypeId);
}

export function listObservabilityBusinessMetricFamilies() {
  return readObservabilityBusinessMetrics().metric_families ?? [];
}

export function getObservabilityBusinessMetricFamily(metricFamilyId) {
  return listObservabilityBusinessMetricFamilies().find((metricFamily) => metricFamily.id === metricFamilyId);
}

export function getObservabilityBusinessMetricControls() {
  const businessMetrics = readObservabilityBusinessMetrics();

  return {
    requiredLabels: businessMetrics.required_labels ?? [],
    boundedDimensionCatalog: businessMetrics.bounded_dimension_catalog ?? [],
    cardinalityControls: businessMetrics.cardinality_controls ?? {},
    auditContext: businessMetrics.audit_context ?? {},
    freshnessAndCollection: businessMetrics.freshness_and_collection ?? {}
  };
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

export function listExternalApplicationSupportedFlows() {
  return readDomainModel().governance_catalogs?.external_application_supported_flows ?? [];
}

export function getExternalApplicationSupportedFlow(flowId) {
  return listExternalApplicationSupportedFlows().find((flow) => flow.flowId === flowId);
}

export function listExternalApplicationTemplates() {
  return readDomainModel().governance_catalogs?.external_application_templates ?? [];
}

export function getExternalApplicationTemplate(templateId) {
  return listExternalApplicationTemplates().find((template) => template.templateId === templateId);
}

export function listExternalApplicationPlanLimits() {
  return readDomainModel().governance_catalogs?.external_application_plan_limits ?? [];
}

export function getExternalApplicationPlanLimit(planId) {
  return listExternalApplicationPlanLimits().find((planLimit) => planLimit.planId === planId);
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

function getWorkspaceApplicationBaseUrl({ workspaceSlug, workspaceEnvironment, applicationSlug }) {
  const environmentProfile = getEnvironmentProfile(workspaceEnvironment);
  const subdomainConfig = readDeploymentTopology().public_surface?.optional_workspace_subdomain ?? {};

  if (!environmentProfile) {
    throw new Error(`Unknown workspace environment ${workspaceEnvironment}.`);
  }

  const allowedEnvironments = new Set(subdomainConfig.allowed_environments ?? []);
  if (allowedEnvironments.has(workspaceEnvironment)) {
    return `https://${workspaceSlug}.apps.${workspaceEnvironment}.in-atelier.example.com/${applicationSlug}`;
  }

  return `https://${environmentProfile.hostnames.api}/workspaces/${workspaceSlug}/apps/${applicationSlug}`;
}

export function resolveWorkspaceApiSurface({
  workspaceId,
  workspaceSlug,
  workspaceEnvironment,
  iamRealm = null,
  applications = []
}) {
  const environmentProfile = getEnvironmentProfile(workspaceEnvironment);

  if (!environmentProfile) {
    throw new Error(`Unknown workspace environment ${workspaceEnvironment}.`);
  }

  const controlApiBaseUrl = `https://${environmentProfile.hostnames.api}/v1/workspaces/${workspaceId}`;
  const consoleBaseUrl = `https://${environmentProfile.hostnames.console}/workspaces/${workspaceId}`;
  const identityBaseUrl = iamRealm
    ? `https://${environmentProfile.hostnames.identity}/realms/${iamRealm}`
    : `https://${environmentProfile.hostnames.identity}`;
  const realtimeBaseUrl = `https://${environmentProfile.hostnames.realtime}/v1/websockets`;
  const applicationBaseUrlPattern = getWorkspaceApplicationBaseUrl({
    workspaceSlug,
    workspaceEnvironment,
    applicationSlug: '{applicationSlug}'
  });

  return {
    workspaceId,
    workspaceSlug,
    environment: workspaceEnvironment,
    controlApiBaseUrl,
    consoleBaseUrl,
    identityBaseUrl,
    realtimeBaseUrl,
    applicationBaseUrlPattern,
    endpoints: [
      { name: 'control-api', audience: 'control_plane', url: controlApiBaseUrl },
      { name: 'console', audience: 'console', url: consoleBaseUrl },
      { name: 'identity', audience: 'identity', url: identityBaseUrl },
      { name: 'realtime', audience: 'realtime', url: realtimeBaseUrl }
    ],
    applicationEndpoints: applications.map((application) => {
      const publicBaseUrl = getWorkspaceApplicationBaseUrl({
        workspaceSlug,
        workspaceEnvironment,
        applicationSlug: application.slug
      });

      return {
        applicationId: application.applicationId,
        applicationSlug: application.slug,
        protocol: application.protocol,
        publicBaseUrl,
        callbackBaseUrl: `${publicBaseUrl}/callback`
      };
    })
  };
}

export function resolveWorkspaceResourceInheritance({
  mode = 'tenant_defaults',
  sourceWorkspaceId = null,
  logicalResources = []
} = {}) {
  const sharedResourceKeys = [];
  const specializedResourceKeys = [];

  for (const resource of logicalResources) {
    if (resource?.sharingScope === 'tenant_shared' || resource?.specializationMode === 'shared') {
      sharedResourceKeys.push(resource.resourceKey);
    } else {
      specializedResourceKeys.push(resource.resourceKey);
    }
  }

  return {
    mode,
    sourceWorkspaceId,
    logicalResources,
    sharedResourceKeys,
    specializedResourceKeys,
    requiresCloneLineage: mode === 'clone_workspace' && Boolean(sourceWorkspaceId)
  };
}

export function buildWorkspaceCloneDraft({ sourceWorkspace, targetWorkspace = {}, clonePolicy = {} }) {
  if (!sourceWorkspace?.workspaceId) {
    throw new Error('sourceWorkspace.workspaceId is required to build a clone draft.');
  }

  const mergedClonePolicy = {
    includeApplications: true,
    includeServiceAccounts: true,
    includeManagedResourceBindings: true,
    resetCredentialReferences: true,
    reuseTenantLogicalResources: true,
    cloneMetadata: true,
    ...clonePolicy
  };

  return {
    entityType: 'workspace_clone',
    slug: targetWorkspace.slug,
    displayName: targetWorkspace.displayName,
    description: targetWorkspace.description ?? sourceWorkspace.description,
    environment: targetWorkspace.environment ?? sourceWorkspace.environment,
    desiredState: targetWorkspace.desiredState ?? 'draft',
    metadata: targetWorkspace.metadata ?? sourceWorkspace.metadata ?? {},
    iamBoundary: targetWorkspace.iamBoundary ?? sourceWorkspace.iamBoundary,
    resourceInheritance:
      targetWorkspace.resourceInheritance ??
      resolveWorkspaceResourceInheritance({
        mode: 'clone_workspace',
        sourceWorkspaceId: sourceWorkspace.workspaceId,
        logicalResources: sourceWorkspace.resourceInheritance?.logicalResources ?? []
      }),
    clonePolicy: mergedClonePolicy
  };
}

function getAllowedBusinessTransitions(machineId, currentState) {
  const machine = getBusinessStateMachine(machineId);
  return (machine?.allowed_transitions ?? []).filter((transition) => transition.from === currentState).map((transition) => transition.to);
}

function countBy(items, resolver) {
  return items.reduce((counts, item) => {
    const key = resolver(item);
    if (!key) return counts;
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function sumQuotaUsage(workspaceSubquotas = [], metricKey) {
  return workspaceSubquotas.filter((subquota) => subquota.metricKey === metricKey).reduce((total, subquota) => total + (subquota.used ?? 0), 0);
}

export function buildTenantResourceInventory({
  tenant,
  workspaces = [],
  externalApplications = [],
  serviceAccounts = [],
  managedResources = [],
  generatedAt = '2026-03-24T00:00:00Z'
}) {
  const resourcesByKind = countBy(managedResources, (resource) => resource.kind);
  const resourcesByState = countBy(managedResources, (resource) => resource.state);

  return {
    tenantId: tenant?.tenantId,
    generatedAt,
    lastConsistentAt: generatedAt,
    workspaceCount: workspaces.length,
    applicationCount: externalApplications.length,
    serviceAccountCount: serviceAccounts.length,
    managedResourceCount: managedResources.length,
    sharedResourceCount: managedResources.filter((resource) => resource.sharingScope === 'tenant_shared').length,
    resourcesByKind,
    resourcesByState,
    workspaces: workspaces.map((workspace) => {
      const workspaceResources = managedResources.filter((resource) => resource.workspaceId === workspace.workspaceId);
      const workspaceApplications = externalApplications.filter((application) => application.workspaceId === workspace.workspaceId);
      const workspaceServiceAccounts = serviceAccounts.filter((serviceAccount) => serviceAccount.workspaceId === workspace.workspaceId);

      return {
        workspaceId: workspace.workspaceId,
        workspaceSlug: workspace.slug,
        environment: workspace.environment,
        state: workspace.state,
        applicationCount: workspaceApplications.length,
        serviceAccountCount: workspaceServiceAccounts.length,
        managedResourceCount: workspaceResources.length,
        resourceKinds: countBy(workspaceResources, (resource) => resource.kind),
        resourceStates: countBy(workspaceResources, (resource) => resource.state)
      };
    })
  };
}

export function buildTenantFunctionalConfigurationExport({
  tenant,
  workspaces = [],
  externalApplications = [],
  serviceAccounts = [],
  managedResources = [],
  generatedAt = '2026-03-24T00:00:00Z'
}) {
  const inventory = buildTenantResourceInventory({
    tenant,
    workspaces,
    externalApplications,
    serviceAccounts,
    managedResources,
    generatedAt
  });

  return {
    exportId: tenant?.exportProfile?.lastExportId ?? `exp_${tenant?.tenantId?.slice(4) ?? 'tenant'}_snapshot`,
    tenantId: tenant?.tenantId,
    generatedAt,
    consistencyCheckpoint: tenant?.exportProfile?.lastConsistencyCheckpoint ?? `chk_${tenant?.tenantId?.slice(4) ?? 'tenant'}_snapshot`,
    status: tenant?.exportProfile?.lastStatus ?? 'completed',
    redactionMode: tenant?.exportProfile?.redactionMode ?? 'secret_references_only',
    includedSections: [
      'tenant',
      'tenant_labels',
      'tenant_quotas',
      'tenant_governance',
      'workspace_inventory',
      'application_inventory',
      'service_account_inventory',
      'managed_resource_inventory'
    ],
    recoveryArtifacts: [
      {
        type: 'consistency_checkpoint',
        reference: tenant?.exportProfile?.lastConsistencyCheckpoint ?? `chk_${tenant?.tenantId?.slice(4) ?? 'tenant'}_snapshot`
      },
      {
        type: 'inventory_summary',
        reference: inventory
      }
    ],
    inventory
  };
}

export function summarizeTenantGovernanceDashboard({
  tenant,
  workspaces = [],
  externalApplications = [],
  serviceAccounts = [],
  managedResources = [],
  generatedAt = '2026-03-24T00:00:00Z'
}) {
  const inventory = buildTenantResourceInventory({
    tenant,
    workspaces,
    externalApplications,
    serviceAccounts,
    managedResources,
    generatedAt
  });
  const quotaProfile = tenant?.quotaProfile ?? { limits: [], workspaceSubquotas: [], governanceStatus: 'nominal' };
  const quotaAlerts = (quotaProfile.limits ?? [])
    .map((limit) => {
      const reservedWorkspaceUsage = limit.scope === 'workspace' ? sumQuotaUsage(quotaProfile.workspaceSubquotas, limit.metricKey) : 0;
      const effectiveUsed = Math.max(limit.used ?? 0, reservedWorkspaceUsage);
      const remaining = Math.max((limit.limit ?? 0) - effectiveUsed, 0);
      const utilization = limit.limit > 0 ? Number(((effectiveUsed / limit.limit) * 100).toFixed(1)) : 0;
      return {
        metricKey: limit.metricKey,
        scope: limit.scope,
        limit: limit.limit,
        used: effectiveUsed,
        remaining,
        utilizationPercent: utilization,
        severity: utilization >= 100 ? 'blocked' : utilization >= 80 ? 'warning' : 'nominal'
      };
    })
    .filter((alert) => alert.severity !== 'nominal');

  return {
    tenantId: tenant?.tenantId,
    state: tenant?.state,
    labels: tenant?.labels ?? [],
    provisioningStatus: tenant?.provisioning?.status ?? 'unknown',
    governanceStatus: tenant?.governance?.governanceStatus ?? quotaProfile.governanceStatus ?? 'nominal',
    inventory,
    quotaAlerts,
    allowedActions: getAllowedBusinessTransitions('tenant_lifecycle', tenant?.state),
    deleteProtection: tenant?.governance?.deleteProtection === true,
    retentionDays: tenant?.governance?.retentionPolicy?.retentionDays ?? null,
    lastExportId: tenant?.exportProfile?.lastExportId ?? null
  };
}

export function buildTenantPurgeDraft({ tenant, actorUserId = null, approvalTicket = '', confirmationText = '' }) {
  return {
    tenantId: tenant?.tenantId,
    actorUserId,
    approvalTicket,
    confirmationText: confirmationText || `PURGE ${tenant?.tenantId ?? 'tenant'} ${tenant?.slug ?? ''}`.trim(),
    expectedState: 'deleted',
    redactionMode: tenant?.exportProfile?.redactionMode ?? 'secret_references_only',
    consistencyCheckpoint: tenant?.exportProfile?.lastConsistencyCheckpoint ?? null,
    requiresElevatedAccess: tenant?.governance?.retentionPolicy?.purgeRequiresElevatedAccess !== false,
    requiresDualConfirmation: tenant?.governance?.retentionPolicy?.purgeRequiresDualConfirmation !== false
  };
}

export function evaluateTenantLifecycleMutation({
  tenant,
  action,
  workspaces = [],
  managedResources = [],
  now = '2026-03-24T00:00:00Z',
  hasElevatedAccess = false,
  hasSecondConfirmation = false
}) {
  if (!tenant?.tenantId) {
    throw new Error('tenant.tenantId is required to evaluate lifecycle mutations.');
  }

  const actions = {
    activate: { currentState: 'pending_activation', transition: 'active' },
    suspend: { currentState: 'active', transition: 'suspended' },
    reactivate: { currentState: 'suspended', transition: 'active' },
    soft_delete: { currentState: tenant.state, transition: 'deleted' },
    purge: { currentState: 'deleted', transition: 'purged' }
  };
  const requested = actions[action];

  if (!requested) {
    throw new Error(`Unknown tenant lifecycle action ${action}.`);
  }

  if (action !== 'soft_delete' && tenant.state !== requested.currentState) {
    return {
      action,
      allowed: false,
      nextState: tenant.state,
      blocker: `tenant must be ${requested.currentState} before ${action}`,
      descendantImpacts: []
    };
  }

  if (action === 'soft_delete') {
    const allowedStates = new Set(['pending_activation', 'active', 'suspended']);
    if (!allowedStates.has(tenant.state)) {
      return {
        action,
        allowed: false,
        nextState: tenant.state,
        blocker: 'tenant must be pending_activation, active, or suspended before logical deletion',
        descendantImpacts: []
      };
    }
  }

  if (action === 'purge') {
    const purgeEligibleAt = tenant?.governance?.retentionPolicy?.purgeEligibleAt;
    const exportCheckpoint = tenant?.exportProfile?.lastConsistencyCheckpoint;
    const retentionReady = !purgeEligibleAt || new Date(purgeEligibleAt).getTime() <= new Date(now).getTime();

    if (!retentionReady) {
      return {
        action,
        allowed: false,
        nextState: tenant.state,
        blocker: 'tenant retention window has not elapsed',
        descendantImpacts: []
      };
    }

    if (!exportCheckpoint) {
      return {
        action,
        allowed: false,
        nextState: tenant.state,
        blocker: 'tenant export checkpoint is required before purge',
        descendantImpacts: []
      };
    }

    if (!hasElevatedAccess || !hasSecondConfirmation) {
      return {
        action,
        allowed: false,
        nextState: tenant.state,
        blocker: 'purge requires elevated access and reinforced confirmation',
        descendantImpacts: []
      };
    }
  }

  const descendantImpacts = [];
  if (action === 'suspend') {
    descendantImpacts.push(
      ...workspaces.map((workspace) => ({ entityType: 'workspace', entityId: workspace.workspaceId, targetState: 'suspended' })),
      ...managedResources.map((resource) => ({ entityType: 'managed_resource', entityId: resource.resourceId, targetState: 'suspended' })),
      { entityType: 'tenant_iam_access', entityId: tenant.tenantId, targetState: 'suspended' }
    );
  }

  if (action === 'reactivate') {
    descendantImpacts.push(
      ...workspaces.map((workspace) => ({ entityType: 'workspace', entityId: workspace.workspaceId, targetState: workspace.state === 'suspended' ? 'active' : workspace.state })),
      { entityType: 'tenant_iam_access', entityId: tenant.tenantId, targetState: 'active' }
    );
  }

  if (action === 'soft_delete') {
    descendantImpacts.push(
      ...workspaces.map((workspace) => ({ entityType: 'workspace', entityId: workspace.workspaceId, targetState: 'soft_deleted' })),
      ...managedResources.map((resource) => ({ entityType: 'managed_resource', entityId: resource.resourceId, targetState: 'soft_deleted' })),
      { entityType: 'tenant_iam_access', entityId: tenant.tenantId, targetState: 'suspended' }
    );
  }

  if (action === 'purge') {
    descendantImpacts.push(
      ...workspaces.map((workspace) => ({ entityType: 'workspace', entityId: workspace.workspaceId, targetState: 'purged' })),
      ...managedResources.map((resource) => ({ entityType: 'managed_resource', entityId: resource.resourceId, targetState: 'purged' }))
    );
  }

  return {
    action,
    allowed: true,
    nextState: requested.transition,
    blocker: null,
    descendantImpacts,
    requiredControls:
      action === 'purge'
        ? ['elevated_access', 'dual_confirmation', 'retention_elapsed', 'export_checkpoint']
        : action === 'soft_delete'
          ? ['audit_retention', 'logical_delete_first']
          : ['tenant_scope_audit']
  };
}

export function listInitialTenantBootstrapTemplates() {
  return readDomainModel().governance_catalogs?.initial_tenant_bootstrap_templates ?? [];
}

export function getInitialTenantBootstrapTemplate(resourceKey) {
  return listInitialTenantBootstrapTemplates().find((template) => template.resourceKey === resourceKey);
}

export function resolveInitialTenantBootstrap({
  tenantId = null,
  ownerUserId = null,
  workspaceId,
  workspaceEnvironment = 'dev',
  planId,
  tenantStorageContext,
  provisioningRunId = 'prn_bootstrappreview',
  lifecycleTrigger = 'signup_activation',
  resolvedAt = '2026-03-24T00:00:00Z'
}) {
  const tenantResolution = resolveTenantEffectiveCapabilities({ tenantId, planId, resolvedAt });
  const workspaceResolution = resolveWorkspaceEffectiveCapabilities({
    tenantId,
    workspaceId,
    workspaceEnvironment,
    planId,
    resolvedAt
  });
  const capabilityKeys = new Set([
    ...tenantResolution.capabilities.map((capability) => capability.capabilityKey),
    ...workspaceResolution.capabilities.map((capability) => capability.capabilityKey)
  ]);
  const resourceStates = listInitialTenantBootstrapTemplates().map((template) => {
    const enabled =
      template.provisioningMode === 'always' ||
      (template.requiredCapabilityKey ? capabilityKeys.has(template.requiredCapabilityKey) : false);

    const baseState = {
      resourceKey: template.resourceKey,
      resourceType: template.resourceType,
      scope: template.scope,
      displayName: template.displayName,
      provider: template.provider,
      gatingMode: template.provisioningMode,
      requiredCapabilityKey: template.requiredCapabilityKey,
      status: enabled ? 'pending' : 'skipped',
      attemptCount: 0,
      visibleInConsole: template.visibleInConsole === true
    };

    if (template.resourceKey !== 'default_storage_bucket' || tenantStorageContext === undefined) {
      return baseState;
    }

    if (!tenantStorageContext) {
      return {
        ...baseState,
        status: 'dependency_wait',
        dependency: {
          entityType: 'tenant_storage_context',
          tenantId,
          requiredState: 'active',
          currentState: 'missing',
          reasonCode: 'CONTEXT_MISSING'
        }
      };
    }

    const currentState = tenantStorageContext.state ?? 'draft';
    const currentReasonCode = tenantStorageContext?.provisioning?.reasonCode ?? null;
    const bucketReady = currentState === 'active' && tenantStorageContext.bucketProvisioningAllowed !== false;

    return {
      ...baseState,
      status: bucketReady
        ? 'pending'
        : currentReasonCode === 'CAPABILITY_NOT_AVAILABLE' || ['suspended', 'soft_deleted'].includes(currentState)
          ? 'blocked'
          : 'dependency_wait',
      dependency: {
        entityType: 'tenant_storage_context',
        tenantId,
        requiredState: 'active',
        currentState,
        reasonCode:
          currentReasonCode
          ?? (currentState === 'suspended'
            ? 'CONTEXT_SUSPENDED'
            : currentState === 'soft_deleted'
              ? 'CONTEXT_SOFT_DELETED'
              : 'CONTEXT_PENDING')
      },
      namespace: tenantStorageContext.namespace ?? null,
      providerType: tenantStorageContext.providerType ?? null
    };
  });

  return {
    provisioningRunId,
    lifecycleTrigger,
    status: 'pending',
    startedAt: resolvedAt,
    updatedAt: resolvedAt,
    ownerBindings: [
      {
        bindingType: 'tenant_membership',
        role: 'tenant_owner',
        userId: ownerUserId,
        tenantId,
        status: 'pending'
      },
      {
        bindingType: 'workspace_membership',
        role: 'workspace_owner',
        userId: ownerUserId,
        tenantId,
        workspaceId,
        status: 'pending'
      }
    ],
    resourceStates,
    retry: {
      retryable: false,
      attemptCount: 0,
      idempotencyKey: `signup-activation-${tenantId ?? 'tenant'}-${workspaceId ?? 'workspace'}`
    }
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
