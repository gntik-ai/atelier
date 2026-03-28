import {
  getApiFamily,
  getObservabilityCollectionHealth,
  getObservabilityDashboardScope,
  getObservabilityHealthComponent,
  getObservabilityHealthExposureTemplates,
  getObservabilityHealthProjection,
  getObservabilityProbeType,
  getObservedSubsystem,
  listObservabilityDashboardDimensions,
  listObservabilityDashboardScopes,
  listObservabilityDashboardWidgets,
  listObservabilityHealthComponents,
  listObservabilityMetricFamilies,
  listObservabilityProbeTypes,
  listObservedSubsystems,
  readObservabilityDashboards,
  readObservabilityHealthChecks,
  readObservabilityMetricsStack
} from '../../../services/internal-contracts/src/index.mjs';

export const observabilityApiFamily = getApiFamily('metrics');
export const observabilityMetricsStack = readObservabilityMetricsStack();
export const observabilityMetricFamilies = listObservabilityMetricFamilies();
export const observabilityCollectionHealth = getObservabilityCollectionHealth();
export const observabilityDashboards = readObservabilityDashboards();
export const observabilityDashboardScopes = listObservabilityDashboardScopes();
export const observabilityDashboardDimensions = listObservabilityDashboardDimensions();
export const observabilityDashboardWidgets = listObservabilityDashboardWidgets();
export const observabilityHealthChecks = readObservabilityHealthChecks();
export const observabilityProbeTypes = listObservabilityProbeTypes();
export const observabilityHealthComponents = listObservabilityHealthComponents();
export const observabilityHealthExposureTemplates = getObservabilityHealthExposureTemplates();
export const observabilityHealthProjection = getObservabilityHealthProjection();

export function listObservabilitySubsystems() {
  return listObservedSubsystems();
}

export function getObservabilitySubsystem(subsystemId) {
  return getObservedSubsystem(subsystemId);
}

export function summarizeObservabilityPlane() {
  return {
    family: observabilityApiFamily?.id ?? 'metrics',
    version: observabilityMetricsStack.version,
    collectionModel: observabilityMetricsStack.operating_targets?.collection_model ?? 'hybrid',
    retention: observabilityMetricsStack.operating_targets?.retention ?? {},
    resolution: observabilityMetricsStack.operating_targets?.resolution ?? {},
    requiredLabels: observabilityMetricsStack.naming?.required_labels ?? [],
    metricScopeLabel: observabilityMetricsStack.naming?.metric_scope_label ?? 'metric_scope',
    collectionHealth: observabilityCollectionHealth,
    normalizedMetricFamilies: observabilityMetricFamilies.map((family) => ({
      id: family.id,
      name: family.name,
      type: family.type,
      requiredLabels: family.required_labels ?? []
    })),
    subsystems: listObservabilitySubsystems().map((subsystem) => ({
      id: subsystem.id,
      displayName: subsystem.display_name,
      collectionMode: subsystem.collection_mode,
      target: subsystem.target,
      supportedScopes: subsystem.supported_scopes,
      tenantAttributable: subsystem.tenant_attributable
    }))
  };
}

export function buildObservabilityQueryScope(input = {}) {
  const tenantLabel = observabilityMetricsStack.naming?.tenant_isolation?.tenant_label ?? 'tenant_id';
  const workspaceLabel = observabilityMetricsStack.naming?.tenant_isolation?.workspace_label ?? 'workspace_id';
  const metricScopeLabel = observabilityMetricsStack.naming?.metric_scope_label ?? 'metric_scope';
  const platformScopeValue = observabilityMetricsStack.naming?.tenant_isolation?.platform_scope_value ?? 'platform';
  const tenantScopeValue = observabilityMetricsStack.naming?.tenant_isolation?.tenant_scope_value ?? 'tenant';
  const workspaceScopeValue = observabilityMetricsStack.naming?.tenant_isolation?.workspace_scope_value ?? 'workspace';

  const labels = {};
  const filters = [];

  if (input.subsystem) {
    labels.subsystem = input.subsystem;
    filters.push(`subsystem=${input.subsystem}`);
  }

  if (input.includePlatform === true && !input.tenantId) {
    labels[metricScopeLabel] = platformScopeValue;
    filters.push(`${metricScopeLabel}=${platformScopeValue}`);
  }

  if (input.tenantId) {
    labels[tenantLabel] = input.tenantId;
    labels[metricScopeLabel] = input.workspaceId ? workspaceScopeValue : tenantScopeValue;
    filters.push(`${tenantLabel}=${input.tenantId}`);
    filters.push(`${metricScopeLabel}=${labels[metricScopeLabel]}`);
  }

  if (input.workspaceId) {
    labels[workspaceLabel] = input.workspaceId;
    filters.push(`${workspaceLabel}=${input.workspaceId}`);
  }

  return {
    labels,
    filters,
    includePlatform: input.includePlatform === true,
    platformExcludedFromTenantQueries: Boolean(input.tenantId),
    collectionHealthMetric: observabilityCollectionHealth.metric_name
  };
}


export function summarizeObservabilityDashboards() {
  return {
    version: observabilityDashboards.version,
    sourceMetricsContract: observabilityDashboards.source_metrics_contract,
    hierarchy: observabilityDashboards.hierarchy ?? {},
    dashboardScopeAliases: observabilityDashboards.scope_aliases ?? {},
    mandatoryDimensions: observabilityDashboardDimensions.map((dimension) => ({
      id: dimension.id,
      metricCategory: dimension.metric_category,
      description: dimension.description
    })),
    scopes: observabilityDashboardScopes.map((scope) => ({
      id: scope.id,
      displayName: scope.display_name,
      underlyingMetricScope: scope.underlying_metric_scope,
      level: scope.scope_hierarchy_level,
      requiredContext: scope.scope_context_requirements ?? [],
      allowedDrilldownTargets: scope.allowed_drilldown_targets ?? [],
      summaryCards: scope.summary_cards ?? [],
      mandatoryDimensions: scope.mandatory_dimensions ?? [],
      workspaceFallbackPolicy: scope.workspace_fallback_policy,
      authorization: scope.authorization ?? {}
    })),
    widgetCatalog: observabilityDashboardWidgets.map((widget) => ({
      id: widget.id,
      subsystemId: widget.subsystem_id,
      supportsDashboardScopes: widget.supports_dashboard_scopes ?? [],
      supportsMetricScopes: widget.supports_metric_scopes ?? [],
      workspaceFallback: widget.workspace_fallback
    })),
    authorizationAndTraceability: observabilityDashboards.authorization_and_traceability ?? {},
    collectionFreshness: observabilityDashboards.collection_freshness ?? {}
  };
}

export function buildObservabilityDashboardScope(input = {}) {
  const requestedDashboardScope = input.dashboardScope ?? (input.workspaceId ? 'workspace' : input.tenantId ? 'tenant' : 'global');
  const dashboardScope = getObservabilityDashboardScope(requestedDashboardScope);

  if (!dashboardScope) {
    throw new Error(`Unknown observability dashboard scope ${requestedDashboardScope}.`);
  }

  if (dashboardScope.id === 'tenant' && !input.tenantId) {
    throw new Error('tenantId is required for the tenant observability dashboard scope.');
  }

  if (dashboardScope.id === 'workspace' && (!input.tenantId || !input.workspaceId)) {
    throw new Error('tenantId and workspaceId are required for the workspace observability dashboard scope.');
  }

  const queryScope = buildObservabilityQueryScope({
    subsystem: input.subsystem,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    includePlatform: dashboardScope.id === 'global'
  });

  const widgetCatalog = observabilityDashboardWidgets
    .filter((widget) => (widget.supports_dashboard_scopes ?? []).includes(dashboardScope.id))
    .map((widget) => ({
      id: widget.id,
      subsystemId: widget.subsystem_id,
      workspaceFallback: widget.workspace_fallback,
      mandatoryDimensions: widget.mandatory_dimensions ?? [],
      inheritedWhenNarrowerScope: dashboardScope.id === 'workspace' && widget.workspace_fallback !== 'workspace_native'
    }));

  return {
    dashboardScope: dashboardScope.id,
    displayName: dashboardScope.display_name,
    underlyingMetricScope: dashboardScope.underlying_metric_scope,
    hierarchyLevel: dashboardScope.scope_hierarchy_level,
    queryScope,
    requiredContext: {
      tenantId: input.tenantId ?? null,
      workspaceId: input.workspaceId ?? null
    },
    requiredScopeContext: dashboardScope.scope_context_requirements ?? [],
    drilldownTargets: dashboardScope.allowed_drilldown_targets ?? [],
    inheritedDegradation: dashboardScope.inherited_degradation ?? {},
    workspaceFallbackPolicy: dashboardScope.workspace_fallback_policy,
    widgetCatalog,
    authorization: dashboardScope.authorization ?? {},
    traceability: dashboardScope.traceability ?? {},
    collectionFreshnessMetric: observabilityCollectionHealth.metric_name
  };
}

export function summarizeObservabilityHealthChecks() {
  return {
    version: observabilityHealthChecks.version,
    sourceMetricsContract: observabilityHealthChecks.source_metrics_contract,
    sourceDashboardContract: observabilityHealthChecks.source_dashboard_contract,
    principles: observabilityHealthChecks.principles ?? [],
    probeTypes: observabilityProbeTypes.map((probeType) => ({
      id: probeType.id,
      displayName: probeType.display_name,
      primaryAudience: probeType.primary_audience,
      allowedStatuses: probeType.allowed_statuses ?? []
    })),
    exposureTemplates: observabilityHealthExposureTemplates,
    projection: observabilityHealthProjection,
    maskingPolicy: observabilityHealthChecks.masking_policy ?? {},
    auditContext: observabilityHealthChecks.audit_context ?? {},
    components: observabilityHealthComponents.map((component) => ({
      id: component.id,
      displayName: component.display_name,
      probeSupport: component.probe_support ?? [],
      supportedMetricScopes: component.supported_metric_scopes ?? [],
      readinessDependencies: component.readiness_dependencies ?? [],
      healthDependencies: component.health_dependencies ?? [],
      narrowerScopePolicy: component.narrower_scope_policy
    }))
  };
}

export function buildObservabilityPlatformProbeRollup(input = {}) {
  const requestedProbeType = input.probeType ?? 'health';
  const probeType = getObservabilityProbeType(requestedProbeType);

  if (!probeType) {
    throw new Error(`Unknown observability probe type ${requestedProbeType}.`);
  }

  const aggregateExposure = observabilityHealthExposureTemplates.aggregate?.[probeType.id];

  return {
    probeType: probeType.id,
    displayName: probeType.display_name,
    aggregateExposure,
    componentCount: observabilityHealthComponents.length,
    requiredComponentIds: observabilityHealthComponents.map((component) => component.id),
    compatibleDashboardStateModel: observabilityHealthChecks.dashboard_alignment?.compatible_health_states ?? [],
    auditFields: observabilityHealthChecks.audit_context?.required_fields ?? [],
    projection: observabilityHealthProjection
  };
}

export function buildComponentHealthProbeSummary(input = {}) {
  const componentId = input.componentId ?? input.subsystem;
  const requestedProbeType = input.probeType ?? 'health';
  const component = getObservabilityHealthComponent(componentId);
  const probeType = getObservabilityProbeType(requestedProbeType);

  if (!component) {
    throw new Error(`Unknown observability health component ${componentId}.`);
  }

  if (!probeType) {
    throw new Error(`Unknown observability probe type ${requestedProbeType}.`);
  }

  if (!(component.probe_support ?? []).includes(probeType.id)) {
    throw new Error(`Component ${component.id} does not support probe type ${probeType.id}.`);
  }

  const dashboardScope = buildObservabilityDashboardScope({
    dashboardScope: input.dashboardScope,
    subsystem: component.id,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId
  });
  const componentExposure = observabilityHealthExposureTemplates.component?.[probeType.id] ?? {};
  const aggregateExposure = observabilityHealthExposureTemplates.aggregate?.[probeType.id] ?? {};

  return {
    componentId: component.id,
    displayName: component.display_name,
    probeType: probeType.id,
    dashboardScope: dashboardScope.dashboardScope,
    requiredContext: dashboardScope.requiredContext,
    queryScope: dashboardScope.queryScope,
    supportedMetricScopes: component.supported_metric_scopes ?? [],
    narrowerScopePolicy: component.narrower_scope_policy,
    readinessDependencies: component.readiness_dependencies ?? [],
    healthDependencies: component.health_dependencies ?? [],
    exposure: {
      aggregatePath: aggregateExposure.path,
      componentPathTemplate: componentExposure.path,
      componentPath: componentExposure.path?.replace('{componentId}', component.id) ?? null,
      audience: componentExposure.audience,
      internalOnly: componentExposure.internal_only === true
    },
    projection: component.metric_projection ?? observabilityHealthProjection,
    dashboardCompatibility: observabilityHealthChecks.dashboard_alignment ?? {},
    auditFields: observabilityHealthChecks.audit_context?.required_fields ?? []
  };
}
