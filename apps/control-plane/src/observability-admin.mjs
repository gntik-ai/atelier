import {
  getAlertAudienceRouting,
  getAlertCategory,
  getAlertMaskingPolicy as getObservabilityAlertMaskingPolicy,
  getAlertOscillationDetection,
  getAlertSeverityLevel,
  getAlertSuppressionDefaults as getObservabilityAlertSuppressionDefaults,
  getApiFamily,
  getHealthSummaryAggregationRule,
  getHealthSummaryFreshnessThreshold,
  getHealthSummaryScope,
  getHealthSummaryScopeIsolationRule,
  getObservabilityBusinessDomain,
  getObservabilityBusinessMetricControls,
  getObservabilityBusinessMetricFamily,
  getObservabilityBusinessMetricType,
  getObservabilityCollectionHealth,
  getObservabilityDashboardScope,
  getObservabilityHealthComponent,
  getObservabilityHealthExposureTemplates,
  getObservabilityHealthProjection,
  getObservabilityProbeType,
  getPublicRoute,
  getUsageCalculationAuditContract,
  getUsageConsumptionScope,
  getUsageFreshnessState,
  getUsageMeteredDimension,
  getUsageRefreshPolicy,
  getObservedSubsystem,
  listAlertCategories,
  listAlertLifecycleStates,
  listAlertSeverityLevels,
  listHealthSummaryScopes,
  listHealthSummaryStatuses,
  listObservabilityBusinessDomains,
  listObservabilityBusinessMetricFamilies,
  listObservabilityBusinessMetricTypes,
  listObservabilityDashboardDimensions,
  listObservabilityDashboardScopes,
  listObservabilityDashboardWidgets,
  listObservabilityHealthComponents,
  listObservabilityMetricFamilies,
  listObservabilityProbeTypes,
  listObservedSubsystems,
  listUsageConsumptionScopes,
  listUsageFreshnessStates,
  listUsageMeteredDimensions,
  readObservabilityBusinessMetrics,
  readObservabilityConsoleAlerts,
  readObservabilityDashboards,
  readObservabilityHealthChecks,
  readObservabilityMetricsStack,
  readObservabilityUsageConsumption
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
export const observabilityBusinessMetrics = readObservabilityBusinessMetrics();
export const observabilityBusinessDomains = listObservabilityBusinessDomains();
export const observabilityBusinessMetricTypes = listObservabilityBusinessMetricTypes();
export const observabilityBusinessMetricFamilies = listObservabilityBusinessMetricFamilies();
export const observabilityBusinessMetricControls = getObservabilityBusinessMetricControls();
export const observabilityConsoleAlerts = readObservabilityConsoleAlerts();
export const observabilityHealthSummaryScopes = listHealthSummaryScopes();
export const observabilityHealthSummaryStatuses = listHealthSummaryStatuses();
export const observabilityAlertCategories = listAlertCategories();
export const observabilityAlertSeverityLevels = listAlertSeverityLevels();
export const observabilityAlertLifecycleStates = listAlertLifecycleStates();
export const observabilityUsageConsumption = readObservabilityUsageConsumption();
export const usageConsumptionScopes = listUsageConsumptionScopes();
export const usageFreshnessStates = listUsageFreshnessStates();
export const usageMeteredDimensions = listUsageMeteredDimensions();
export const usageRefreshPolicy = getUsageRefreshPolicy();
export const usageCalculationAuditContract = getUsageCalculationAuditContract();

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

export function listBusinessMetricDomains() {
  return observabilityBusinessDomains;
}

export function getBusinessMetricDomain(domainId) {
  return getObservabilityBusinessDomain(domainId);
}

export function listBusinessMetricTypes() {
  return observabilityBusinessMetricTypes;
}

export function getBusinessMetricType(metricTypeId) {
  return getObservabilityBusinessMetricType(metricTypeId);
}

export function listBusinessMetricFamilies() {
  return observabilityBusinessMetricFamilies;
}

export function getBusinessMetricFamily(metricFamilyId) {
  return getObservabilityBusinessMetricFamily(metricFamilyId);
}

export function summarizeObservabilityBusinessMetrics() {
  return {
    version: observabilityBusinessMetrics.version,
    sourceMetricsContract: observabilityBusinessMetrics.source_metrics_contract,
    sourceDashboardContract: observabilityBusinessMetrics.source_dashboard_contract,
    sourceHealthContract: observabilityBusinessMetrics.source_health_contract,
    principles: observabilityBusinessMetrics.principles ?? [],
    scopeAliases: observabilityBusinessMetrics.scope_aliases ?? {},
    metricTypes: observabilityBusinessMetricTypes.map((metricType) => ({
      id: metricType.id,
      description: metricType.description
    })),
    businessDomains: observabilityBusinessDomains.map((domain) => ({
      id: domain.id,
      displayName: domain.display_name,
      primaryConsumers: domain.primary_consumers ?? []
    })),
    requiredLabels: observabilityBusinessMetricControls.requiredLabels ?? [],
    boundedDimensionCatalog: observabilityBusinessMetricControls.boundedDimensionCatalog ?? [],
    cardinalityControls: observabilityBusinessMetricControls.cardinalityControls ?? {},
    auditContext: observabilityBusinessMetricControls.auditContext ?? {},
    freshnessAndCollection: observabilityBusinessMetricControls.freshnessAndCollection ?? {},
    metricFamilies: observabilityBusinessMetricFamilies.map((metricFamily) => ({
      id: metricFamily.id,
      name: metricFamily.name,
      domain: metricFamily.domain,
      metricType: metricFamily.metric_type,
      kind: metricFamily.kind,
      producer: metricFamily.producer,
      supportedScopes: metricFamily.supported_scopes ?? [],
      downstreamUses: metricFamily.downstream_uses ?? []
    }))
  };
}

export function buildObservabilityBusinessMetricQuery(input = {}) {
  const metricFamily = getBusinessMetricFamily(input.metricFamilyId);
  const domain = input.domainId ? getBusinessMetricDomain(input.domainId) : null;
  const metricType = input.metricTypeId ? getBusinessMetricType(input.metricTypeId) : null;
  const requestedScope = input.scope ?? (input.workspaceId ? 'workspace' : input.tenantId ? 'tenant' : 'platform');

  if (!['platform', 'tenant', 'workspace'].includes(requestedScope)) {
    throw new Error(`Unknown business metric scope ${requestedScope}.`);
  }

  if (requestedScope === 'tenant' && !input.tenantId) {
    throw new Error('tenantId is required for tenant-scoped business metric queries.');
  }

  if (requestedScope === 'workspace' && (!input.tenantId || !input.workspaceId)) {
    throw new Error('tenantId and workspaceId are required for workspace-scoped business metric queries.');
  }

  if (metricFamily && !(metricFamily.supported_scopes ?? []).includes(requestedScope)) {
    throw new Error(`Business metric family ${metricFamily.id} does not support scope ${requestedScope}.`);
  }

  const queryScope = buildObservabilityQueryScope({
    subsystem: input.subsystem,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    includePlatform: requestedScope === 'platform'
  });
  const labels = {
    ...queryScope.labels,
    domain: domain?.id ?? metricFamily?.domain ?? input.domainId ?? undefined,
    metric_type: metricType?.id ?? metricFamily?.metric_type ?? input.metricTypeId ?? undefined
  };
  const filters = [...queryScope.filters];

  if (labels.domain) {
    filters.push(`domain=${labels.domain}`);
  }

  if (labels.metric_type) {
    filters.push(`metric_type=${labels.metric_type}`);
  }

  return {
    requestedScope,
    dashboardScope: observabilityBusinessMetrics.scope_aliases?.[requestedScope]?.dashboard_scope ?? (requestedScope === 'platform' ? 'global' : requestedScope),
    requiredContext: {
      tenantId: input.tenantId ?? null,
      workspaceId: input.workspaceId ?? null
    },
    metricFamily: metricFamily
      ? {
          id: metricFamily.id,
          name: metricFamily.name,
          supportedScopes: metricFamily.supported_scopes ?? [],
          safeAttributionPolicy: metricFamily.safe_attribution_policy,
          downstreamUses: metricFamily.downstream_uses ?? []
        }
      : null,
    queryScope: {
      ...queryScope,
      labels,
      filters
    },
    auditFields: observabilityBusinessMetricControls.auditContext?.required_fields ?? [],
    forbiddenLabels: observabilityBusinessMetricControls.cardinalityControls?.forbidden_labels ?? [],
    freshnessMetric: observabilityBusinessMetricControls.freshnessAndCollection?.collection_health_metric ?? observabilityCollectionHealth.metric_name
  };
}

function resolveObservabilityConsoleScope(scope) {
  return scope === 'global' ? 'platform' : scope;
}

function buildConsoleSummaryScopeContext(scopeDescriptor, options = {}) {
  if (!scopeDescriptor) {
    throw new Error('Health summary scope descriptor is required.');
  }

  const dashboardScope = buildObservabilityDashboardScope({
    dashboardScope: scopeDescriptor.dashboard_scope,
    subsystem: options.subsystem,
    tenantId: options.tenantId,
    workspaceId: options.workspaceId
  });

  return {
    scope: scopeDescriptor.id,
    displayName: scopeDescriptor.display_name,
    dashboardScope: dashboardScope.dashboardScope,
    requiredContext: dashboardScope.requiredContext,
    requiredScopeContext: dashboardScope.requiredScopeContext,
    queryScope: dashboardScope.queryScope,
    authorization: dashboardScope.authorization,
    traceability: dashboardScope.traceability
  };
}

export function buildHealthSummaryContext(scope, options = {}) {
  const normalizedScope = resolveObservabilityConsoleScope(scope);
  const scopeDescriptor = getHealthSummaryScope(normalizedScope);

  if (!scopeDescriptor) {
    throw new Error(`Unknown observability health summary scope ${scope}.`);
  }

  const scopeContext = buildConsoleSummaryScopeContext(scopeDescriptor, options);
  const aggregationRule = getHealthSummaryAggregationRule(normalizedScope) ?? {};
  const scopeIsolation = getHealthSummaryScopeIsolationRule(normalizedScope) ?? null;

  return {
    scope: normalizedScope,
    displayName: scopeDescriptor.display_name,
    dashboardScope: scopeContext.dashboardScope,
    requiredContext: scopeContext.requiredContext,
    requiredScopeContext: scopeContext.requiredScopeContext,
    queryScope: scopeContext.queryScope,
    scopeVisibility: scopeDescriptor.summary_visibility,
    attributionModes: scopeDescriptor.safe_attribution_labels ?? [],
    supportedStatuses: observabilityHealthSummaryStatuses.map((status) => ({
      id: status.id,
      displayName: status.display_name,
      operationalMeaning: status.operational_meaning,
      aggregationPriority: status.aggregation_priority
    })),
    summaryRequiredFields: observabilityConsoleAlerts.health_summary?.required_fields ?? [],
    freshnessThresholdSeconds: getHealthSummaryFreshnessThreshold(),
    aggregationRule,
    scopeIsolation,
    supportingContracts: {
      metricsStack: observabilityConsoleAlerts.source_metrics_contract,
      dashboards: observabilityConsoleAlerts.source_dashboard_contract,
      healthChecks: observabilityConsoleAlerts.source_health_contract,
      businessMetrics: observabilityConsoleAlerts.source_business_metrics_contract
    },
    authorization: scopeContext.authorization,
    traceability: {
      dashboard: scopeContext.traceability,
      summaryAccess: observabilityConsoleAlerts.audit_context?.summary_access_event ?? {},
      requiredFields: observabilityConsoleAlerts.audit_context?.required_fields ?? []
    }
  };
}

export function buildAlertContext(categoryId, scope, options = {}) {
  const normalizedScope = resolveObservabilityConsoleScope(scope);
  const category = getAlertCategory(categoryId);

  if (!category) {
    throw new Error(`Unknown observability alert category ${categoryId}.`);
  }

  if (!(category.scope_rules ?? []).includes(normalizedScope)) {
    throw new Error(`Observability alert category ${categoryId} does not support scope ${normalizedScope}.`);
  }

  const scopeDescriptor = getHealthSummaryScope(normalizedScope);
  const scopeContext = buildConsoleSummaryScopeContext(scopeDescriptor, options);
  const defaultSeverity = getAlertSeverityLevel(category.default_severity) ?? { id: category.default_severity };
  const suppressionDefaults = getObservabilityAlertSuppressionDefaults();

  return {
    category: {
      id: category.id,
      description: category.description,
      defaultSeverity,
      requiredFields: [
        ...(observabilityConsoleAlerts.alert_contract?.required_fields ?? []),
        ...(category.required_fields ?? [])
      ],
      evidenceSources: category.evidence_sources ?? [],
      resolutionEventRequired: category.resolution_event_required === true
    },
    scope: normalizedScope,
    displayName: scopeDescriptor?.display_name ?? normalizedScope,
    dashboardScope: scopeContext.dashboardScope,
    requiredContext: scopeContext.requiredContext,
    requiredScopeContext: scopeContext.requiredScopeContext,
    authorization: scopeContext.authorization,
    routing: getAlertAudienceRouting(normalizedScope),
    suppression: {
      defaultWindowSeconds: category.default_suppression_window_seconds,
      dedupeKeyFields: suppressionDefaults.dedupe_key_fields ?? [],
      boundaryRule: suppressionDefaults.boundary_rule,
      repeatSummaryBehavior: suppressionDefaults.repeat_summary_behavior,
      suppressedAlertsRemainQueryable: suppressionDefaults.suppressed_alerts_remain_queryable === true,
      oscillationDetection: getAlertOscillationDetection()
    },
    lifecycle: {
      initialState: 'active',
      states: observabilityAlertLifecycleStates.map((state) => ({
        id: state.id,
        displayName: state.display_name,
        terminal: state.terminal,
        allowedTransitions: state.allowed_transitions ?? []
      }))
    },
    maskingPolicy: getObservabilityAlertMaskingPolicy(),
    auditContext: observabilityConsoleAlerts.audit_context?.alert_delivery_event ?? {}
  };
}

export function getAlertLifecycleStateMachine() {
  return {
    version: observabilityConsoleAlerts.version,
    states: observabilityAlertLifecycleStates.map((state) => ({
      id: state.id,
      displayName: state.display_name,
      terminal: state.terminal,
      allowedTransitions: state.allowed_transitions ?? []
    })),
    adjacency: Object.fromEntries(
      observabilityAlertLifecycleStates.map((state) => [state.id, state.allowed_transitions ?? []])
    )
  };
}

export function getAlertSuppressionDefaults() {
  return {
    ...getObservabilityAlertSuppressionDefaults(),
    categories: observabilityAlertCategories.map((category) => ({
      id: category.id,
      defaultSeverity: category.default_severity,
      defaultSuppressionWindowSeconds: category.default_suppression_window_seconds
    })),
    oscillationDetection: getAlertOscillationDetection()
  };
}

export function summarizeConsoleAlertsContract() {
  return {
    version: observabilityConsoleAlerts.version,
    sourceContracts: {
      metricsStack: observabilityConsoleAlerts.source_metrics_contract,
      dashboards: observabilityConsoleAlerts.source_dashboard_contract,
      healthChecks: observabilityConsoleAlerts.source_health_contract,
      businessMetrics: observabilityConsoleAlerts.source_business_metrics_contract
    },
    healthSummary: {
      scopes: observabilityHealthSummaryScopes.map((scope) => ({
        id: scope.id,
        displayName: scope.display_name,
        dashboardScope: scope.dashboard_scope,
        requiredContext: scope.required_context ?? [],
        summaryVisibility: scope.summary_visibility,
        attributionModes: scope.safe_attribution_labels ?? []
      })),
      statuses: observabilityHealthSummaryStatuses.map((status) => ({
        id: status.id,
        aggregationPriority: status.aggregation_priority
      })),
      freshnessThresholdSeconds: getHealthSummaryFreshnessThreshold(),
      aggregationOrderByScope: Object.fromEntries(
        observabilityHealthSummaryScopes.map((scope) => [
          scope.id,
          getHealthSummaryAggregationRule(scope.id)?.summary_status_order ?? []
        ])
      )
    },
    alerts: {
      categories: observabilityAlertCategories.map((category) => ({
        id: category.id,
        defaultSeverity: category.default_severity,
        defaultSuppressionWindowSeconds: category.default_suppression_window_seconds,
        scopeRules: category.scope_rules ?? []
      })),
      severityLevels: observabilityAlertSeverityLevels.map((severity) => ({
        id: severity.id,
        rank: severity.rank
      })),
      lifecycleStates: getAlertLifecycleStateMachine().states,
      audienceRouting: Object.fromEntries(
        observabilityHealthSummaryScopes.map((scope) => [scope.id, getAlertAudienceRouting(scope.id)])
      ),
      suppressionDefaults: getAlertSuppressionDefaults(),
      maskingPolicy: getObservabilityAlertMaskingPolicy()
    },
    auditContext: observabilityConsoleAlerts.audit_context ?? {},
    downstreamConsumers: observabilityConsoleAlerts.downstream_consumers ?? []
  };
}

export const USAGE_CONSUMPTION_ERROR_CODES = Object.freeze({
  SCOPE_VIOLATION: 'USAGE_CONSUMPTION_SCOPE_VIOLATION',
  UNKNOWN_DIMENSION: 'USAGE_CONSUMPTION_UNKNOWN_DIMENSION',
  UNKNOWN_FRESHNESS_STATE: 'USAGE_CONSUMPTION_UNKNOWN_FRESHNESS_STATE',
  INVALID_SNAPSHOT: 'USAGE_CONSUMPTION_INVALID_SNAPSHOT'
});

function usageInvariant(condition, message, code) {
  if (!condition) {
    const error = new Error(message);
    error.code = code;
    throw error;
  }
}

function normalizeTimestamp(value, fieldName) {
  usageInvariant(typeof value === 'string' && value.length > 0, `${fieldName} must be a non-empty ISO timestamp.`, USAGE_CONSUMPTION_ERROR_CODES.INVALID_SNAPSHOT);
  const date = new Date(value);
  usageInvariant(!Number.isNaN(date.valueOf()), `${fieldName} must be a valid ISO timestamp.`, USAGE_CONSUMPTION_ERROR_CODES.INVALID_SNAPSHOT);
  return value;
}

function normalizeObservationWindow(window = {}) {
  const startedAt = normalizeTimestamp(window.startedAt, 'observationWindow.startedAt');
  const endedAt = normalizeTimestamp(window.endedAt, 'observationWindow.endedAt');
  usageInvariant(new Date(startedAt).valueOf() <= new Date(endedAt).valueOf(), 'observationWindow.startedAt must be earlier than or equal to observationWindow.endedAt.', USAGE_CONSUMPTION_ERROR_CODES.INVALID_SNAPSHOT);
  return { startedAt, endedAt };
}

function toNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function slugTimestamp(timestamp) {
  return String(timestamp).replace(/[:.]/g, '-');
}

function resolveUsageScope(scopeId) {
  const scope = getUsageConsumptionScope(scopeId);
  usageInvariant(Boolean(scope), `Unknown usage consumption scope ${scopeId}.`, USAGE_CONSUMPTION_ERROR_CODES.SCOPE_VIOLATION);
  return scope;
}

function resolveUsageDimension(dimensionId) {
  const dimension = getUsageMeteredDimension(dimensionId);
  usageInvariant(Boolean(dimension), `Unknown usage metered dimension ${dimensionId}.`, USAGE_CONSUMPTION_ERROR_CODES.UNKNOWN_DIMENSION);
  return dimension;
}

function resolveUsageFreshnessState(stateId) {
  const state = getUsageFreshnessState(stateId);
  usageInvariant(Boolean(state), `Unknown usage freshness state ${stateId}.`, USAGE_CONSUMPTION_ERROR_CODES.UNKNOWN_FRESHNESS_STATE);
  return state;
}

function normalizeUsageScopeBinding(scope, context = {}, input = {}) {
  if (scope.id === 'tenant') {
    const tenantId = input.tenantId ?? context.routeTenantId ?? context.targetTenantId ?? context.tenantId;
    usageInvariant(Boolean(tenantId), 'tenantId is required for tenant usage snapshots.', USAGE_CONSUMPTION_ERROR_CODES.SCOPE_VIOLATION);

    if (context.tenantId && tenantId !== context.tenantId) {
      usageInvariant(false, 'tenant usage snapshot must stay within the caller tenant scope.', USAGE_CONSUMPTION_ERROR_CODES.SCOPE_VIOLATION);
    }

    usageInvariant(!(input.workspaceId ?? context.routeWorkspaceId ?? context.targetWorkspaceId ?? context.workspaceId), 'tenant usage snapshot does not allow workspace scope widening.', USAGE_CONSUMPTION_ERROR_CODES.SCOPE_VIOLATION);

    return {
      tenantId,
      workspaceId: null,
      queryScope: 'tenant'
    };
  }

  const workspaceId = input.workspaceId ?? context.routeWorkspaceId ?? context.targetWorkspaceId ?? context.workspaceId;
  usageInvariant(Boolean(workspaceId), 'workspaceId is required for workspace usage snapshots.', USAGE_CONSUMPTION_ERROR_CODES.SCOPE_VIOLATION);

  if (context.workspaceId && workspaceId !== context.workspaceId) {
    usageInvariant(false, 'workspace usage snapshot must stay within the caller workspace scope.', USAGE_CONSUMPTION_ERROR_CODES.SCOPE_VIOLATION);
  }

  const tenantId = input.tenantId ?? context.tenantId ?? context.routeTenantId ?? context.targetTenantId;
  usageInvariant(Boolean(tenantId), 'tenantId is required for workspace usage snapshots.', USAGE_CONSUMPTION_ERROR_CODES.SCOPE_VIOLATION);

  if (context.tenantId && tenantId !== context.tenantId) {
    usageInvariant(false, 'workspace usage snapshot must stay within the caller tenant scope.', USAGE_CONSUMPTION_ERROR_CODES.SCOPE_VIOLATION);
  }

  return {
    tenantId,
    workspaceId,
    queryScope: 'workspace'
  };
}

function normalizeDimensionValueMap(input = {}) {
  const valueMap = new Map();

  for (const [dimensionId, value] of Object.entries(input.values ?? {})) {
    valueMap.set(dimensionId, { value });
  }

  for (const dimension of input.dimensions ?? []) {
    if (!dimension?.dimensionId) {
      continue;
    }

    valueMap.set(dimension.dimensionId, {
      value: dimension.value,
      freshnessStatus: dimension.freshnessStatus,
      observedAt: dimension.observedAt,
      sourceMode: dimension.sourceMode,
      sourceRef: dimension.sourceRef
    });
  }

  return valueMap;
}

export function summarizeObservabilityUsageConsumption() {
  return {
    version: observabilityUsageConsumption.version,
    sourceContracts: {
      businessMetrics: observabilityUsageConsumption.source_business_metrics_contract,
      healthChecks: observabilityUsageConsumption.source_health_contract,
      auditEventSchema: observabilityUsageConsumption.source_audit_event_schema_contract,
      authorizationModel: observabilityUsageConsumption.source_authorization_contract,
      publicApi: observabilityUsageConsumption.source_public_api_contract
    },
    refreshPolicy: usageRefreshPolicy,
    scopes: usageConsumptionScopes.map((scope) => ({
      id: scope.id,
      displayName: scope.display_name,
      requiredPermission: scope.required_permission,
      requiredContextFields: scope.required_context_fields ?? [],
      routeOperationId: scope.route_operation_id,
      resourceType: scope.resource_type
    })),
    freshnessStates: usageFreshnessStates.map((state) => ({
      id: state.id,
      label: state.label,
      usableForQuotaEvaluation: state.usable_for_quota_evaluation
    })),
    meteredDimensions: usageMeteredDimensions.map((dimension) => ({
      id: dimension.id,
      displayName: dimension.display_name,
      unit: dimension.unit,
      aggregationKind: dimension.aggregation_kind,
      sourceMode: dimension.source_mode,
      sourceRef: dimension.source_ref,
      supportedScopes: dimension.supported_scopes ?? []
    })),
    calculationAudit: usageCalculationAuditContract,
    boundaries: observabilityUsageConsumption.boundaries ?? []
  };
}

export function buildUsageDimensionSnapshot(input = {}) {
  const dimension = resolveUsageDimension(input.dimensionId ?? input.id);
  const scopeId = input.scopeId ?? input.queryScope ?? 'tenant';
  usageInvariant((dimension.supported_scopes ?? []).includes(scopeId), `Usage dimension ${dimension.id} does not support scope ${scopeId}.`, USAGE_CONSUMPTION_ERROR_CODES.SCOPE_VIOLATION);
  const freshnessState = resolveUsageFreshnessState(input.freshnessStatus ?? 'fresh');

  return {
    dimensionId: dimension.id,
    displayName: dimension.display_name,
    value: toNumber(input.value, 0),
    unit: input.unit ?? dimension.unit,
    scope: scopeId,
    freshnessStatus: freshnessState.id,
    sourceMode: input.sourceMode ?? dimension.source_mode,
    sourceRef: input.sourceRef ?? dimension.source_ref,
    observedAt: normalizeTimestamp(input.observedAt, 'observedAt')
  };
}

function buildUsageSnapshot(scopeId, context = {}, input = {}) {
  const scope = resolveUsageScope(scopeId);
  const scopeBinding = normalizeUsageScopeBinding(scope, context, input);
  const snapshotTimestamp = normalizeTimestamp(input.snapshotTimestamp, 'snapshotTimestamp');
  const observationWindow = normalizeObservationWindow(input.observationWindow ?? {});
  const dimensionValueMap = normalizeDimensionValueMap(input);

  const dimensions = usageMeteredDimensions
    .filter((dimension) => (dimension.supported_scopes ?? []).includes(scopeId))
    .map((dimension) => {
      const overrides = dimensionValueMap.get(dimension.id) ?? {};

      return buildUsageDimensionSnapshot({
        dimensionId: dimension.id,
        scopeId,
        value: overrides.value,
        freshnessStatus: overrides.freshnessStatus ?? (input.dimensionFreshness?.[dimension.id] ?? 'fresh'),
        observedAt: overrides.observedAt ?? (input.dimensionObservedAt?.[dimension.id] ?? observationWindow.endedAt),
        sourceMode: overrides.sourceMode,
        sourceRef: overrides.sourceRef
      });
    });

  const degradedDimensions = dimensions
    .filter((dimension) => dimension.freshnessStatus !== 'fresh')
    .map((dimension) => dimension.dimensionId);

  const calculationCycle = {
    cycleId: input.cycleId ?? `usage-cycle-${scopeId}-${slugTimestamp(snapshotTimestamp)}`,
    cadenceSeconds: input.cadenceSeconds ?? usageRefreshPolicy.default_cadence_seconds ?? 300,
    processedScopes: input.processedScopes ?? [scopeId],
    degradedDimensions,
    snapshotTimestamp
  };

  return {
    snapshotId: input.snapshotId ?? `usage-${scopeId}-${scopeBinding.tenantId}-${scopeBinding.workspaceId ?? 'all'}-${slugTimestamp(snapshotTimestamp)}`,
    queryScope: scopeBinding.queryScope,
    tenantId: scopeBinding.tenantId,
    workspaceId: scopeBinding.workspaceId,
    snapshotTimestamp,
    observationWindow,
    dimensions,
    degradedDimensions,
    calculationCycle
  };
}

export function buildTenantUsageSnapshot(input = {}) {
  return buildUsageSnapshot('tenant', {}, input);
}

export function buildWorkspaceUsageSnapshot(input = {}) {
  return buildUsageSnapshot('workspace', {}, input);
}

export function buildUsageCalculationCycleAuditRecord(input = {}) {
  const startedAt = normalizeTimestamp(input.startedAt ?? input.snapshotTimestamp, 'startedAt');
  const completedAt = normalizeTimestamp(input.completedAt ?? input.snapshotTimestamp, 'completedAt');
  const snapshotTimestamp = normalizeTimestamp(input.snapshotTimestamp ?? completedAt, 'snapshotTimestamp');

  return {
    subsystemId: usageCalculationAuditContract.subsystem_id,
    actionCategory: usageCalculationAuditContract.action_category,
    originSurface: usageCalculationAuditContract.origin_surface,
    resultOutcome: input.resultOutcome ?? usageCalculationAuditContract.result_outcome_default ?? 'succeeded',
    detail: {
      cycleId: input.cycleId ?? `usage-cycle-${slugTimestamp(snapshotTimestamp)}`,
      processedScopes: input.processedScopes ?? [],
      degradedDimensions: input.degradedDimensions ?? [],
      snapshotTimestamp,
      startedAt,
      completedAt
    }
  };
}

function defaultUsageLoader(_query, input = {}) {
  return input;
}

function executeUsageSnapshotQuery(scopeId, context = {}, input = {}) {
  const scope = resolveUsageScope(scopeId);
  const scopeBinding = normalizeUsageScopeBinding(scope, context, input);
  const loader = context.loadUsageSnapshot ?? defaultUsageLoader;
  const loaded = loader({
    scopeId,
    tenantId: scopeBinding.tenantId,
    workspaceId: scopeBinding.workspaceId,
    requiredPermission: scope.required_permission,
    routeOperationId: scope.route_operation_id
  }, input) ?? {};

  const resolvedInput = {
    ...input,
    ...loaded,
    tenantId: scopeBinding.tenantId,
    workspaceId: scopeBinding.workspaceId
  };

  return scopeId === 'tenant'
    ? buildTenantUsageSnapshot(resolvedInput)
    : buildWorkspaceUsageSnapshot(resolvedInput);
}

export function queryTenantUsageSnapshot(context = {}, input = {}) {
  return executeUsageSnapshotQuery('tenant', context, input);
}

export function queryWorkspaceUsageSnapshot(context = {}, input = {}) {
  return executeUsageSnapshotQuery('workspace', context, input);
}

export function listUsageConsumptionRoutes() {
  return usageConsumptionScopes
    .map((scope) => getPublicRoute(scope.route_operation_id))
    .filter(Boolean);
}
