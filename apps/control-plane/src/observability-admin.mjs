import {
  getAlertAudienceRouting,
  getAlertCategory,
  getAlertMaskingPolicy as getObservabilityAlertMaskingPolicy,
  getAlertOscillationDetection,
  getAlertSeverityLevel,
  getAlertSuppressionDefaults as getObservabilityAlertSuppressionDefaults,
  getApiFamily,
  getAlertCorrelationStrategy,
  getAlertEventEnvelopeSchema,
  getAlertKafkaTopicConfig,
  getAlertSuppressionCause,
  getHardLimitAuditContract,
  getHardLimitDimension,
  getHardLimitEnforcementPolicy,
  getHardLimitErrorContract,
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
  getQuotaEvaluationAuditContract,
  getQuotaEvaluationDefaults,
  getQuotaPolicyScope,
  getQuotaPostureState,
  getQuotaThresholdType,
  getUsageCalculationAuditContract,
  getUsageConsumptionScope,
  getUsageFreshnessState,
  getUsageMeteredDimension,
  getUsageRefreshPolicy,
  getObservedSubsystem,
  listAlertCategories,
  listAlertEventTypes,
  listAlertLifecycleStates,
  listAlertSeverityLevels,
  listAlertSuppressionCauses,
  listHardLimitDimensions,
  listHardLimitSurfaceMappings,
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
  listQuotaPolicyScopes,
  listQuotaPostureStates,
  listQuotaThresholdTypes,
  listUsageConsumptionScopes,
  listUsageFreshnessStates,
  listUsageMeteredDimensions,
  readObservabilityBusinessMetrics,
  readObservabilityConsoleAlerts,
  readObservabilityHardLimitEnforcement,
  readObservabilityThresholdAlerts,
  readObservabilityDashboards,
  readObservabilityHealthChecks,
  readObservabilityMetricsStack,
  readObservabilityQuotaPolicies,
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
export const observabilityQuotaPolicies = readObservabilityQuotaPolicies();
export const quotaPolicyScopes = listQuotaPolicyScopes();
export const quotaThresholdTypes = listQuotaThresholdTypes();
export const quotaPostureStates = listQuotaPostureStates();
export const quotaEvaluationDefaults = getQuotaEvaluationDefaults();
export const quotaEvaluationAuditContract = getQuotaEvaluationAuditContract();
export const observabilityThresholdAlerts = readObservabilityThresholdAlerts();
export const thresholdAlertEventTypes = listAlertEventTypes();
export const thresholdAlertSuppressionCauses = listAlertSuppressionCauses();
export const thresholdAlertKafkaConfig = getAlertKafkaTopicConfig();
export const thresholdAlertEnvelopeSchema = getAlertEventEnvelopeSchema();
export const thresholdAlertCorrelationStrategy = getAlertCorrelationStrategy();
export const observabilityHardLimitEnforcement = readObservabilityHardLimitEnforcement();
export const hardLimitDimensions = listHardLimitDimensions();
export const hardLimitSurfaceMappings = listHardLimitSurfaceMappings();
export const hardLimitErrorContract = getHardLimitErrorContract();
export const hardLimitAuditContract = getHardLimitAuditContract();
export const hardLimitEnforcementPolicy = getHardLimitEnforcementPolicy();

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

export const QUOTA_POLICY_ERROR_CODES = Object.freeze({
  SCOPE_VIOLATION: 'QUOTA_POLICY_SCOPE_VIOLATION',
  UNKNOWN_DIMENSION: 'QUOTA_POLICY_UNKNOWN_DIMENSION',
  UNKNOWN_THRESHOLD_TYPE: 'QUOTA_POLICY_UNKNOWN_THRESHOLD_TYPE',
  UNKNOWN_POSTURE_STATE: 'QUOTA_POLICY_UNKNOWN_POSTURE_STATE',
  INVALID_POLICY: 'QUOTA_POLICY_INVALID_POLICY',
  INVALID_POSTURE: 'QUOTA_POLICY_INVALID_POSTURE'
});

function quotaInvariant(condition, message, code) {
  if (!condition) {
    const error = new Error(message);
    error.code = code;
    throw error;
  }
}

function resolveQuotaScope(scopeId) {
  const scope = getQuotaPolicyScope(scopeId);
  quotaInvariant(Boolean(scope), `Unknown quota policy scope ${scopeId}.`, QUOTA_POLICY_ERROR_CODES.SCOPE_VIOLATION);
  return scope;
}

function resolveQuotaPostureState(stateId) {
  const state = getQuotaPostureState(stateId);
  quotaInvariant(Boolean(state), `Unknown quota posture state ${stateId}.`, QUOTA_POLICY_ERROR_CODES.UNKNOWN_POSTURE_STATE);
  return state;
}

function resolveQuotaThresholdType(typeId) {
  const type = getQuotaThresholdType(typeId);
  quotaInvariant(Boolean(type), `Unknown quota threshold type ${typeId}.`, QUOTA_POLICY_ERROR_CODES.UNKNOWN_THRESHOLD_TYPE);
  return type;
}

function normalizeQuotaScopeBinding(scope, context = {}, input = {}) {
  if (scope.id === 'tenant') {
    const tenantId = input.tenantId ?? context.routeTenantId ?? context.targetTenantId ?? context.tenantId;
    quotaInvariant(Boolean(tenantId), 'tenantId is required for tenant quota posture.', QUOTA_POLICY_ERROR_CODES.SCOPE_VIOLATION);

    if (context.tenantId && tenantId !== context.tenantId) {
      quotaInvariant(false, 'tenant quota posture must stay within the caller tenant scope.', QUOTA_POLICY_ERROR_CODES.SCOPE_VIOLATION);
    }

    quotaInvariant(!(input.workspaceId ?? context.routeWorkspaceId ?? context.targetWorkspaceId ?? context.workspaceId), 'tenant quota posture does not allow workspace scope widening.', QUOTA_POLICY_ERROR_CODES.SCOPE_VIOLATION);

    return {
      tenantId,
      workspaceId: null,
      queryScope: 'tenant'
    };
  }

  const workspaceId = input.workspaceId ?? context.routeWorkspaceId ?? context.targetWorkspaceId ?? context.workspaceId;
  quotaInvariant(Boolean(workspaceId), 'workspaceId is required for workspace quota posture.', QUOTA_POLICY_ERROR_CODES.SCOPE_VIOLATION);

  if (context.workspaceId && workspaceId !== context.workspaceId) {
    quotaInvariant(false, 'workspace quota posture must stay within the caller workspace scope.', QUOTA_POLICY_ERROR_CODES.SCOPE_VIOLATION);
  }

  const tenantId = input.tenantId ?? context.tenantId ?? context.routeTenantId ?? context.targetTenantId;
  quotaInvariant(Boolean(tenantId), 'tenantId is required for workspace quota posture.', QUOTA_POLICY_ERROR_CODES.SCOPE_VIOLATION);

  if (context.tenantId && tenantId !== context.tenantId) {
    quotaInvariant(false, 'workspace quota posture must stay within the caller tenant scope.', QUOTA_POLICY_ERROR_CODES.SCOPE_VIOLATION);
  }

  return {
    tenantId,
    workspaceId,
    queryScope: 'workspace'
  };
}

function normalizeNumericThreshold(value, fieldName) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const numeric = Number(value);
  quotaInvariant(Number.isFinite(numeric), `${fieldName} must be numeric when provided.`, QUOTA_POLICY_ERROR_CODES.INVALID_POLICY);
  quotaInvariant(numeric >= 0, `${fieldName} must be greater than or equal to zero.`, QUOTA_POLICY_ERROR_CODES.INVALID_POLICY);
  return numeric;
}

function normalizeQuotaPolicyInputMap(input = {}) {
  const policyMap = new Map();

  for (const [dimensionId, policy] of Object.entries(input.policies ?? {})) {
    policyMap.set(dimensionId, { dimensionId, ...(policy ?? {}) });
  }

  for (const policy of input.dimensionPolicies ?? []) {
    if (!policy?.dimensionId) {
      continue;
    }

    policyMap.set(policy.dimensionId, policy);
  }

  return policyMap;
}

function calculateRemaining(limit, value) {
  if (limit === null || limit === undefined) {
    return null;
  }

  return Number((limit - value).toFixed(6));
}

function buildUsageSnapshotForQuota(scopeId, input = {}) {
  if (input.usageSnapshot) {
    return input.usageSnapshot;
  }

  return scopeId === 'tenant'
    ? buildTenantUsageSnapshot(input)
    : buildWorkspaceUsageSnapshot(input);
}

function resolveQuotaPolicyMode(rawMode, hasAnyThreshold) {
  if (rawMode) {
    return rawMode;
  }

  return hasAnyThreshold ? quotaEvaluationDefaults.default_policy_mode ?? 'enforced' : 'unbounded';
}

function validateThresholdOrdering({ warningThreshold, softLimit, hardLimit }, dimensionId) {
  if (warningThreshold !== null && softLimit !== null) {
    quotaInvariant(warningThreshold <= softLimit, `Quota policy ${dimensionId} requires warningThreshold <= softLimit.`, QUOTA_POLICY_ERROR_CODES.INVALID_POLICY);
  }

  if (softLimit !== null && hardLimit !== null) {
    quotaInvariant(softLimit <= hardLimit, `Quota policy ${dimensionId} requires softLimit <= hardLimit.`, QUOTA_POLICY_ERROR_CODES.INVALID_POLICY);
  }

  if (warningThreshold !== null && softLimit === null && hardLimit !== null) {
    quotaInvariant(warningThreshold <= hardLimit, `Quota policy ${dimensionId} requires warningThreshold <= hardLimit when softLimit is absent.`, QUOTA_POLICY_ERROR_CODES.INVALID_POLICY);
  }
}

export function buildQuotaDimensionPolicy(input = {}) {
  const dimension = resolveUsageDimension(input.dimensionId ?? input.id);
  const scopeId = input.scopeId ?? input.queryScope ?? 'tenant';
  quotaInvariant((dimension.supported_scopes ?? []).includes(scopeId), `Usage dimension ${dimension.id} does not support quota scope ${scopeId}.`, QUOTA_POLICY_ERROR_CODES.SCOPE_VIOLATION);

  const warningThreshold = normalizeNumericThreshold(input.warningThreshold, `${dimension.id}.warningThreshold`);
  const softLimit = normalizeNumericThreshold(input.softLimit, `${dimension.id}.softLimit`);
  const hardLimit = normalizeNumericThreshold(input.hardLimit, `${dimension.id}.hardLimit`);
  const hasAnyThreshold = [warningThreshold, softLimit, hardLimit].some((value) => value !== null);
  const policyMode = resolveQuotaPolicyMode(input.policyMode, hasAnyThreshold);
  quotaInvariant(['enforced', 'unbounded'].includes(policyMode), `Quota policy ${dimension.id} must use policyMode enforced or unbounded.`, QUOTA_POLICY_ERROR_CODES.INVALID_POLICY);

  if (policyMode === 'enforced') {
    validateThresholdOrdering({ warningThreshold, softLimit, hardLimit }, dimension.id);
  }

  resolveQuotaThresholdType('warning_threshold');
  resolveQuotaThresholdType('soft_limit');
  resolveQuotaThresholdType('hard_limit');

  return {
    dimensionId: dimension.id,
    displayName: dimension.display_name,
    scope: scopeId,
    unit: input.unit ?? dimension.unit,
    policyMode,
    comparisonRule: 'greater_than_or_equal',
    warningThreshold,
    softLimit,
    hardLimit
  };
}

export function evaluateQuotaDimensionPosture(input = {}) {
  const usageDimension = input.usageDimension ?? buildUsageDimensionSnapshot({
    dimensionId: input.dimensionId,
    scopeId: input.scopeId,
    value: input.measuredValue ?? input.value,
    freshnessStatus: input.freshnessStatus,
    observedAt: input.observedAt ?? input.usageSnapshotTimestamp ?? input.snapshotTimestamp,
    sourceMode: input.sourceMode,
    sourceRef: input.sourceRef
  });
  const policy = input.policy ?? buildQuotaDimensionPolicy({
    dimensionId: usageDimension.dimensionId,
    scopeId: input.scopeId ?? usageDimension.scope,
    unit: usageDimension.unit,
    warningThreshold: input.warningThreshold,
    softLimit: input.softLimit,
    hardLimit: input.hardLimit,
    policyMode: input.policyMode
  });

  const measuredValue = toNumber(input.measuredValue ?? usageDimension.value, 0);
  const freshnessStatus = resolveUsageFreshnessState(input.freshnessStatus ?? usageDimension.freshnessStatus).id;
  const warningThreshold = policy.warningThreshold ?? null;
  const softLimit = policy.softLimit ?? null;
  const hardLimit = policy.hardLimit ?? null;

  let status = quotaEvaluationDefaults.normal_status ?? 'within_limit';

  if (policy.policyMode === 'unbounded') {
    status = quotaEvaluationDefaults.unbounded_status ?? 'unbounded';
  } else if (freshnessStatus === 'unavailable') {
    status = quotaEvaluationDefaults.evidence_unavailable_status ?? 'evidence_unavailable';
  } else if (hardLimit !== null && measuredValue >= hardLimit) {
    status = quotaEvaluationDefaults.hard_limit_status ?? 'hard_limit_reached';
  } else if (softLimit !== null && measuredValue >= softLimit) {
    status = quotaEvaluationDefaults.soft_limit_status ?? 'soft_limit_exceeded';
  } else if (warningThreshold !== null && measuredValue >= warningThreshold) {
    status = quotaEvaluationDefaults.warning_status ?? 'warning_threshold_reached';
  } else if (freshnessStatus === 'degraded') {
    status = quotaEvaluationDefaults.evidence_degraded_status ?? 'evidence_degraded';
  }

  resolveQuotaPostureState(status);

  return {
    dimensionId: usageDimension.dimensionId,
    displayName: usageDimension.displayName,
    scope: usageDimension.scope,
    measuredValue,
    unit: usageDimension.unit,
    freshnessStatus,
    policyMode: policy.policyMode,
    status,
    warningThreshold,
    softLimit,
    hardLimit,
    remainingToWarning: calculateRemaining(warningThreshold, measuredValue),
    remainingToSoftLimit: calculateRemaining(softLimit, measuredValue),
    remainingToHardLimit: calculateRemaining(hardLimit, measuredValue),
    usageSnapshotTimestamp: normalizeTimestamp(input.usageSnapshotTimestamp ?? input.snapshotTimestamp ?? usageDimension.observedAt, 'usageSnapshotTimestamp')
  };
}

export function summarizeObservabilityQuotaPolicies() {
  return {
    version: observabilityQuotaPolicies.version,
    sourceContracts: {
      usageConsumption: observabilityQuotaPolicies.source_usage_contract,
      healthChecks: observabilityQuotaPolicies.source_health_contract,
      auditEventSchema: observabilityQuotaPolicies.source_audit_event_schema_contract,
      authorizationModel: observabilityQuotaPolicies.source_authorization_contract,
      publicApi: observabilityQuotaPolicies.source_public_api_contract
    },
    scopes: quotaPolicyScopes.map((scope) => ({
      id: scope.id,
      displayName: scope.display_name,
      requiredPermission: scope.required_permission,
      requiredContextFields: scope.required_context_fields ?? [],
      routeOperationId: scope.route_operation_id,
      resourceType: scope.resource_type
    })),
    thresholdTypes: quotaThresholdTypes.map((type) => ({
      id: type.id,
      displayName: type.display_name,
      comparisonRule: type.comparison_rule
    })),
    postureStates: quotaPostureStates.map((state) => ({
      id: state.id,
      severityRank: state.severity_rank,
      blocksNewResourceCreation: state.blocks_new_resource_creation
    })),
    supportedDimensions: observabilityQuotaPolicies.supported_dimensions ?? [],
    evaluationDefaults: quotaEvaluationDefaults,
    boundaries: observabilityQuotaPolicies.boundaries ?? []
  };
}

function buildQuotaPosture(scopeId, context = {}, input = {}) {
  const scope = resolveQuotaScope(scopeId);
  const scopeBinding = normalizeQuotaScopeBinding(scope, context, input);
  const usageSnapshot = buildUsageSnapshotForQuota(scopeId, {
    ...input,
    tenantId: scopeBinding.tenantId,
    workspaceId: scopeBinding.workspaceId
  });
  const evaluatedAt = normalizeTimestamp(input.evaluatedAt ?? input.snapshotTimestamp ?? usageSnapshot.snapshotTimestamp, 'evaluatedAt');
  const usageSnapshotTimestamp = normalizeTimestamp(usageSnapshot.snapshotTimestamp, 'usageSnapshot.snapshotTimestamp');
  const observationWindow = normalizeObservationWindow(usageSnapshot.observationWindow ?? {});
  const policyMap = normalizeQuotaPolicyInputMap(input);

  const dimensions = usageSnapshot.dimensions.map((usageDimension) => {
    const policyInput = policyMap.get(usageDimension.dimensionId) ?? {};
    const policy = buildQuotaDimensionPolicy({
      dimensionId: usageDimension.dimensionId,
      scopeId,
      policyMode: policyInput.policyMode,
      warningThreshold: policyInput.warningThreshold,
      softLimit: policyInput.softLimit,
      hardLimit: policyInput.hardLimit
    });

    return evaluateQuotaDimensionPosture({
      usageDimension,
      policy,
      usageSnapshotTimestamp
    });
  });

  const hardLimitBreaches = dimensions.filter((dimension) => dimension.status === (quotaEvaluationDefaults.hard_limit_status ?? 'hard_limit_reached')).map((dimension) => dimension.dimensionId);
  const softLimitBreaches = dimensions.filter((dimension) => dimension.status === (quotaEvaluationDefaults.soft_limit_status ?? 'soft_limit_exceeded')).map((dimension) => dimension.dimensionId);
  const warningDimensions = dimensions.filter((dimension) => dimension.status === (quotaEvaluationDefaults.warning_status ?? 'warning_threshold_reached')).map((dimension) => dimension.dimensionId);
  const degradedDimensions = dimensions.filter((dimension) => dimension.freshnessStatus !== 'fresh').map((dimension) => dimension.dimensionId);

  const overallStatus = (quotaEvaluationDefaults.overall_status_precedence ?? []).find((status) => dimensions.some((dimension) => dimension.status === status)) ?? (quotaEvaluationDefaults.normal_status ?? 'within_limit');

  return {
    postureId: input.postureId ?? `quota-${scopeId}-${scopeBinding.tenantId}-${scopeBinding.workspaceId ?? 'all'}-${slugTimestamp(evaluatedAt)}`,
    queryScope: scopeBinding.queryScope,
    tenantId: scopeBinding.tenantId,
    workspaceId: scopeBinding.workspaceId,
    evaluatedAt,
    usageSnapshotTimestamp,
    observationWindow,
    dimensions,
    overallStatus,
    degradedDimensions,
    hardLimitBreaches,
    softLimitBreaches,
    warningDimensions,
    evaluationAudit: buildQuotaEvaluationAuditRecord({
      evaluationId: input.evaluationId,
      queryScope: scopeBinding.queryScope,
      overallStatus,
      hardLimitBreaches,
      softLimitBreaches,
      warningDimensions,
      evaluatedAt
    })
  };
}

export function buildTenantQuotaPosture(input = {}) {
  return buildQuotaPosture('tenant', {}, input);
}

export function buildWorkspaceQuotaPosture(input = {}) {
  return buildQuotaPosture('workspace', {}, input);
}

export function buildQuotaEvaluationAuditRecord(input = {}) {
  const evaluatedAt = normalizeTimestamp(input.evaluatedAt, 'evaluatedAt');

  return {
    subsystemId: quotaEvaluationAuditContract.subsystem_id,
    actionCategory: quotaEvaluationAuditContract.action_category,
    originSurface: quotaEvaluationAuditContract.origin_surface,
    resultOutcome: input.resultOutcome ?? quotaEvaluationAuditContract.result_outcome_default ?? 'succeeded',
    detail: {
      evaluationId: input.evaluationId ?? `quota-evaluation-${slugTimestamp(evaluatedAt)}`,
      queryScope: input.queryScope,
      overallStatus: input.overallStatus,
      hardLimitBreaches: input.hardLimitBreaches ?? [],
      softLimitBreaches: input.softLimitBreaches ?? [],
      warningDimensions: input.warningDimensions ?? [],
      evaluatedAt
    }
  };
}

function defaultQuotaLoader(_query, input = {}) {
  return input;
}

function executeQuotaPostureQuery(scopeId, context = {}, input = {}) {
  const scope = resolveQuotaScope(scopeId);
  const scopeBinding = normalizeQuotaScopeBinding(scope, context, input);
  const loader = context.loadQuotaPosture ?? defaultQuotaLoader;
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
    ? buildTenantQuotaPosture(resolvedInput)
    : buildWorkspaceQuotaPosture(resolvedInput);
}

export function queryTenantQuotaPosture(context = {}, input = {}) {
  return executeQuotaPostureQuery('tenant', context, input);
}

export function queryWorkspaceQuotaPosture(context = {}, input = {}) {
  return executeQuotaPostureQuery('workspace', context, input);
}

export function listQuotaPolicyRoutes() {
  return quotaPolicyScopes
    .map((scope) => getPublicRoute(scope.route_operation_id))
    .filter(Boolean);
}

function normalizeThresholdAlertContext(context = {}, input = {}) {
  return {
    tenantId: input.tenantId ?? context.tenantId,
    workspaceId: input.workspaceId ?? context.workspaceId ?? null,
    dimensionId: input.dimensionId,
    scopeId: input.workspaceId ?? context.workspaceId ? 'workspace' : 'tenant'
  };
}

function determinePostureSeverity(posture = 'within_limit') {
  const severityByPosture = new Map([
    ['unbounded', 0],
    ['within_limit', 10],
    ['warning_threshold_reached', 20],
    ['soft_limit_exceeded', 30],
    ['hard_limit_reached', 40],
    ['evidence_degraded', 15],
    ['evidence_unavailable', 25]
  ]);

  return severityByPosture.get(posture) ?? 0;
}

function postureStateForThreshold(level) {
  if (level === 'warning') return quotaEvaluationDefaults.warning_status ?? 'warning_threshold_reached';
  if (level === 'soft_limit') return quotaEvaluationDefaults.soft_limit_status ?? 'soft_limit_exceeded';
  if (level === 'hard_limit') return quotaEvaluationDefaults.hard_limit_status ?? 'hard_limit_reached';
  return quotaEvaluationDefaults.normal_status ?? 'within_limit';
}

function thresholdLevelFromPosture(posture) {
  if (posture === (quotaEvaluationDefaults.warning_status ?? 'warning_threshold_reached')) return 'warning';
  if (posture === (quotaEvaluationDefaults.soft_limit_status ?? 'soft_limit_exceeded')) return 'soft_limit';
  if (posture === (quotaEvaluationDefaults.hard_limit_status ?? 'hard_limit_reached')) return 'hard_limit';
  return 'within_limit';
}

function getTransitionEventType(direction, level) {
  if (direction === 'suppression') return 'quota.threshold.alert_suppressed';
  if (direction === 'escalation' && level === 'warning') return 'quota.threshold.warning_reached';
  if (direction === 'escalation' && level === 'soft_limit') return 'quota.threshold.soft_limit_exceeded';
  if (direction === 'escalation' && level === 'hard_limit') return 'quota.threshold.hard_limit_reached';
  if (direction === 'recovery' && level === 'warning') return 'quota.threshold.warning_recovered';
  if (direction === 'recovery' && level === 'soft_limit') return 'quota.threshold.soft_limit_recovered';
  if (direction === 'recovery' && level === 'hard_limit') return 'quota.threshold.hard_limit_recovered';
  return null;
}

function getThresholdValueForLevel(posture, level) {
  if (level === 'warning') return posture.warningThreshold ?? null;
  if (level === 'soft_limit') return posture.softLimit ?? null;
  if (level === 'hard_limit') return posture.hardLimit ?? null;
  return null;
}

export function summarizeObservabilityThresholdAlerts() {
  return {
    version: observabilityThresholdAlerts.version,
    sourceContracts: {
      usageConsumption: observabilityThresholdAlerts.source_usage_contract,
      quotaPolicies: observabilityThresholdAlerts.source_quota_policy_contract,
      auditEventSchema: observabilityThresholdAlerts.source_audit_event_schema_contract
    },
    kafka: thresholdAlertKafkaConfig,
    eventTypes: thresholdAlertEventTypes.map((eventType) => ({
      id: eventType.id,
      transitionDirection: eventType.transition_direction,
      thresholdType: eventType.threshold_type
    })),
    suppressionCauses: thresholdAlertSuppressionCauses.map((cause) => ({
      id: cause.id,
      freshnessState: cause.freshness_state
    })),
    boundaries: observabilityThresholdAlerts.boundaries ?? []
  };
}

export function getAlertKafkaTopicName() {
  return thresholdAlertKafkaConfig.topicName ?? 'quota.threshold.alerts';
}

export function getAlertEventEnvelopeDefaults() {
  return {
    actor: {
      actor_id: thresholdAlertEnvelopeSchema.audit_vocabulary_alignment?.actor_id ?? 'quota-alert-evaluator',
      actor_type: thresholdAlertEnvelopeSchema.audit_vocabulary_alignment?.actor_type ?? 'system'
    },
    resource: {
      subsystem_id: thresholdAlertEnvelopeSchema.audit_vocabulary_alignment?.resource_subsystem_id ?? 'quota_metering',
      resource_type: thresholdAlertEnvelopeSchema.audit_vocabulary_alignment?.resource_type ?? 'quota_dimension'
    }
  };
}

export function readLastKnownPosture(context = {}, input = {}) {
  const { tenantId, workspaceId = null, dimensionId } = normalizeThresholdAlertContext(context, input);
  if (!tenantId || !dimensionId) {
    return null;
  }

  if (typeof context.loadLastKnownPosture === 'function') {
    return context.loadLastKnownPosture({ tenantId, workspaceId, dimensionId }) ?? null;
  }

  const store = context.lastKnownPostureStore;
  if (store instanceof Map) {
    return store.get(`${tenantId}::${workspaceId ?? ''}::${dimensionId}`) ?? null;
  }

  return null;
}

export function writeLastKnownPosture(context = {}, input = {}) {
  const { tenantId, workspaceId = null, dimensionId } = normalizeThresholdAlertContext(context, input);
  const record = {
    tenantId,
    workspaceId,
    dimensionId,
    posture: input.posture,
    evaluatedAt: input.evaluatedAt,
    snapshotTimestamp: input.snapshotTimestamp,
    correlationId: input.correlationId
  };

  if (typeof context.persistLastKnownPosture === 'function') {
    context.persistLastKnownPosture(record);
    return record;
  }

  if (!(context.lastKnownPostureStore instanceof Map)) {
    context.lastKnownPostureStore = new Map();
  }

  context.lastKnownPostureStore.set(`${tenantId}::${workspaceId ?? ''}::${dimensionId}`, record);
  return record;
}

export function detectPostureTransitions(currentPosture = {}, lastKnownPosture = null, policyContext = {}) {
  const currentStatus = currentPosture.status ?? currentPosture.posture ?? quotaEvaluationDefaults.normal_status ?? 'within_limit';
  const previousStatus = lastKnownPosture?.posture ?? lastKnownPosture?.status ?? quotaEvaluationDefaults.normal_status ?? 'within_limit';

  if (currentPosture.policyMode === 'unbounded' || currentStatus === 'unbounded') {
    return [];
  }

  const ladder = ['warning', 'soft_limit', 'hard_limit'];
  const currentSeverity = determinePostureSeverity(currentStatus);
  const previousSeverity = determinePostureSeverity(previousStatus);

  if (currentSeverity === previousSeverity && currentStatus === previousStatus) {
    return [];
  }

  if (currentSeverity > previousSeverity) {
    const transitions = [];
    for (const level of ladder) {
      const levelSeverity = determinePostureSeverity(postureStateForThreshold(level));
      if (levelSeverity > previousSeverity && levelSeverity <= currentSeverity) {
        transitions.push({
          direction: 'escalation',
          thresholdLevel: level,
          eventType: getTransitionEventType('escalation', level),
          previousPosture: previousStatus,
          newPosture: postureStateForThreshold(level),
          thresholdValue: getThresholdValueForLevel(currentPosture, level),
          dimensionId: currentPosture.dimensionId,
          policyContext
        });
      }
    }
    return transitions;
  }

  const recoveries = [];
  for (const level of ['hard_limit', 'soft_limit', 'warning']) {
    const levelSeverity = determinePostureSeverity(postureStateForThreshold(level));
    if (levelSeverity <= previousSeverity && levelSeverity > currentSeverity) {
      recoveries.push({
        direction: 'recovery',
        thresholdLevel: level,
        eventType: getTransitionEventType('recovery', level),
        previousPosture: previousStatus,
        newPosture: currentStatus,
        thresholdValue: getThresholdValueForLevel(currentPosture, level),
        dimensionId: currentPosture.dimensionId,
        policyContext
      });
    }
  }
  return recoveries;
}

function buildDeterministicAlertCorrelationId({ tenantId, workspaceId, dimensionId, snapshotTimestamp, token }) {
  return `quota-alert:${tenantId}:${workspaceId ?? 'tenant'}:${dimensionId}:${snapshotTimestamp}:${token}`;
}

export function buildThresholdAlertEvent(transition = {}, context = {}) {
  const defaults = getAlertEventEnvelopeDefaults();
  const posture = context.currentPosture ?? {};
  const tenantId = context.tenantId ?? posture.tenantId;
  const workspaceId = context.workspaceId ?? posture.workspaceId ?? null;
  const dimensionId = transition.dimensionId ?? posture.dimensionId;
  const snapshotTimestamp = context.snapshotTimestamp ?? posture.usageSnapshotTimestamp;
  const evaluationTimestamp = context.evaluatedAt ?? context.evaluationTimestamp ?? posture.usageSnapshotTimestamp;
  const correlationId = context.correlationId ?? buildDeterministicAlertCorrelationId({
    tenantId,
    workspaceId,
    dimensionId,
    snapshotTimestamp,
    token: transition.eventType ?? transition.thresholdLevel ?? 'transition'
  });

  return {
    eventType: transition.eventType,
    tenantId,
    workspaceId,
    dimension: {
      dimensionId,
      displayName: posture.displayName,
      scope: posture.scope
    },
    measuredValue: posture.measuredValue,
    thresholdValue: transition.thresholdValue ?? null,
    thresholdType: transition.thresholdLevel,
    previousPosture: transition.previousPosture,
    newPosture: transition.newPosture,
    headroom: posture.remainingToHardLimit ?? posture.remainingToSoftLimit ?? posture.remainingToWarning ?? null,
    evidenceFreshness: posture.freshnessStatus,
    evaluationTimestamp,
    snapshotTimestamp,
    correlationId,
    actor: defaults.actor,
    action: {
      action_id: 'quota_threshold_alert_evaluated',
      category: thresholdAlertEnvelopeSchema.audit_vocabulary_alignment?.action_category ?? 'configuration_change'
    },
    resource: {
      ...defaults.resource,
      resource_id: `${tenantId}:${workspaceId ?? 'tenant'}:${dimensionId}`,
      resource_display_name: posture.displayName
    },
    origin: {
      origin_surface: thresholdAlertEnvelopeSchema.audit_vocabulary_alignment?.origin_surface ?? 'scheduled_operation',
      emitting_service: 'control_plane'
    }
  };
}

export function buildAlertSuppressionEvent(context = {}, input = {}) {
  const cause = getAlertSuppressionCause(input.cause);
  const currentPosture = context.currentPosture ?? {};
  const tenantId = input.tenantId ?? context.tenantId ?? currentPosture.tenantId;
  const workspaceId = input.workspaceId ?? context.workspaceId ?? currentPosture.workspaceId ?? null;
  const dimensionId = input.dimensionId ?? context.dimensionId ?? currentPosture.dimensionId;
  const snapshotTimestamp = input.snapshotTimestamp ?? context.snapshotTimestamp ?? currentPosture.usageSnapshotTimestamp;
  const evaluationTimestamp = input.evaluatedAt ?? context.evaluatedAt ?? snapshotTimestamp;
  const correlationId = input.correlationId ?? buildDeterministicAlertCorrelationId({
    tenantId,
    workspaceId,
    dimensionId,
    snapshotTimestamp,
    token: cause?.id ?? 'suppressed'
  });
  const defaults = getAlertEventEnvelopeDefaults();

  return {
    eventType: 'quota.threshold.alert_suppressed',
    tenantId,
    workspaceId,
    dimension: {
      dimensionId,
      displayName: currentPosture.displayName,
      scope: currentPosture.scope ?? (workspaceId ? 'workspace' : 'tenant')
    },
    suppressionCause: cause?.id ?? input.cause,
    suppressedEventType: input.suppressedEventType ?? getTransitionEventType('escalation', thresholdLevelFromPosture(currentPosture.status)),
    evidenceFreshness: currentPosture.freshnessStatus ?? cause?.freshness_state,
    evaluationTimestamp,
    snapshotTimestamp,
    correlationId,
    actor: defaults.actor,
    action: {
      action_id: 'quota_threshold_alert_suppressed',
      category: thresholdAlertEnvelopeSchema.audit_vocabulary_alignment?.action_category ?? 'configuration_change'
    },
    resource: {
      ...defaults.resource,
      resource_id: `${tenantId}:${workspaceId ?? 'tenant'}:${dimensionId}`,
      resource_display_name: currentPosture.displayName
    },
    origin: {
      origin_surface: thresholdAlertEnvelopeSchema.audit_vocabulary_alignment?.origin_surface ?? 'scheduled_operation',
      emitting_service: 'control_plane'
    }
  };
}

function emitAlertEvents(context = {}, events = []) {
  if (typeof context.emitThresholdAlerts === 'function') {
    context.emitThresholdAlerts(events, thresholdAlertKafkaConfig);
    return;
  }

  if (!Array.isArray(context.emittedThresholdAlerts)) {
    context.emittedThresholdAlerts = [];
  }

  context.emittedThresholdAlerts.push(...events);
}

export function recordAlertEvaluationMetrics(summary = {}) {
  const metrics = summary.metrics ?? summary.context?.metrics ?? {};
  const record = metrics.record ?? ((name, value, labels = {}) => {
    if (!Array.isArray(metrics.records)) {
      metrics.records = [];
    }
    metrics.records.push({ name, value, labels });
  });

  for (const event of summary.emittedEvents ?? []) {
    record('quota_threshold_alerts_emitted_total', 1, { event_type: event.eventType, tenant_id: event.tenantId });
  }

  for (const event of summary.suppressedEvents ?? []) {
    record('quota_threshold_alerts_suppressed_total', 1, { cause: event.suppressionCause, tenant_id: event.tenantId });
  }

  record('quota_threshold_alert_evaluation_duration_seconds', summary.durationSeconds ?? 0, {});
  record('quota_threshold_alerts_producer_lag_seconds', summary.producerLagSeconds ?? 0, {});

  return metrics.records ?? [];
}

export function runAlertEvaluationCycle(context = {}, input = {}) {
  const posture = input.posture ?? input.currentPosture;
  if (!posture) {
    throw new Error('runAlertEvaluationCycle requires input.posture.');
  }

  const lastKnownPosture = input.lastKnownPosture ?? readLastKnownPosture(context, {
    tenantId: input.tenantId ?? posture.tenantId,
    workspaceId: input.workspaceId ?? posture.workspaceId,
    dimensionId: posture.dimensionId
  });

  const freshness = posture.freshnessStatus;
  const emittedEvents = [];
  const suppressedEvents = [];
  const startedAt = Date.now();

  if (freshness === 'degraded' || freshness === 'unavailable') {
    const suppressedEvent = buildAlertSuppressionEvent({ ...context, currentPosture: posture }, {
      tenantId: input.tenantId ?? posture.tenantId,
      workspaceId: input.workspaceId ?? posture.workspaceId,
      dimensionId: posture.dimensionId,
      cause: freshness === 'degraded' ? 'evidence_degraded' : 'evidence_unavailable',
      snapshotTimestamp: input.snapshotTimestamp ?? posture.usageSnapshotTimestamp,
      evaluatedAt: input.evaluatedAt ?? posture.usageSnapshotTimestamp
    });
    suppressedEvents.push(suppressedEvent);
    emitAlertEvents(context, suppressedEvents);
    const summary = {
      tenantId: suppressedEvent.tenantId,
      workspaceId: suppressedEvent.workspaceId,
      dimensionId: posture.dimensionId,
      emittedEvents,
      suppressedEvents,
      transitions: [],
      lastKnownPostureUpdated: false,
      durationSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(6)),
      producerLagSeconds: input.producerLagSeconds ?? 0,
      context
    };
    recordAlertEvaluationMetrics(summary);
    return summary;
  }

  const transitions = detectPostureTransitions(posture, lastKnownPosture, input.policyContext ?? {});
  for (const transition of transitions) {
    emittedEvents.push(buildThresholdAlertEvent(transition, {
      ...context,
      currentPosture: posture,
      tenantId: input.tenantId ?? posture.tenantId,
      workspaceId: input.workspaceId ?? posture.workspaceId,
      snapshotTimestamp: input.snapshotTimestamp ?? posture.usageSnapshotTimestamp,
      evaluatedAt: input.evaluatedAt ?? posture.usageSnapshotTimestamp
    }));
  }

  emitAlertEvents(context, emittedEvents);
  let lastKnownPostureRecord = null;
  if (transitions.length > 0 || !lastKnownPosture || lastKnownPosture.posture !== posture.status) {
    lastKnownPostureRecord = writeLastKnownPosture(context, {
      tenantId: input.tenantId ?? posture.tenantId,
      workspaceId: input.workspaceId ?? posture.workspaceId,
      dimensionId: posture.dimensionId,
      posture: posture.status,
      evaluatedAt: input.evaluatedAt ?? posture.usageSnapshotTimestamp,
      snapshotTimestamp: input.snapshotTimestamp ?? posture.usageSnapshotTimestamp,
      correlationId: emittedEvents[emittedEvents.length - 1]?.correlationId ?? buildDeterministicAlertCorrelationId({
        tenantId: input.tenantId ?? posture.tenantId,
        workspaceId: input.workspaceId ?? posture.workspaceId,
        dimensionId: posture.dimensionId,
        snapshotTimestamp: input.snapshotTimestamp ?? posture.usageSnapshotTimestamp,
        token: posture.status
      })
    });
  }

  const summary = {
    tenantId: input.tenantId ?? posture.tenantId,
    workspaceId: input.workspaceId ?? posture.workspaceId,
    dimensionId: posture.dimensionId,
    transitions,
    emittedEvents,
    suppressedEvents,
    lastKnownPosture: lastKnownPostureRecord,
    lastKnownPostureUpdated: Boolean(lastKnownPostureRecord),
    durationSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(6)),
    producerLagSeconds: input.producerLagSeconds ?? 0,
    context
  };
  recordAlertEvaluationMetrics(summary);
  return summary;
}

export function evaluateTenantAlerts(context = {}, input = {}) {
  return runAlertEvaluationCycle({ ...context, tenantId: input.tenantId ?? context.tenantId }, { ...input, tenantId: input.tenantId ?? context.tenantId });
}

export function evaluateWorkspaceAlerts(context = {}, input = {}) {
  return runAlertEvaluationCycle(
    { ...context, tenantId: input.tenantId ?? context.tenantId, workspaceId: input.workspaceId ?? context.workspaceId },
    { ...input, tenantId: input.tenantId ?? context.tenantId, workspaceId: input.workspaceId ?? context.workspaceId }
  );
}

function normalizeHardLimitDimensionId(dimensionId) {
  const dimension = getHardLimitDimension(dimensionId);
  return dimension?.id ?? dimensionId ?? null;
}

function normalizeScopePriority(scopeType) {
  if (scopeType === 'workspace') {
    return 2;
  }
  if (scopeType === 'tenant') {
    return 1;
  }
  return 0;
}

function toFiniteNumberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function summarizeObservabilityHardLimitEnforcement() {
  return {
    version: observabilityHardLimitEnforcement.version,
    sources: {
      usageConsumption: observabilityHardLimitEnforcement.source_usage_contract,
      quotaPolicies: observabilityHardLimitEnforcement.source_quota_policy_contract,
      thresholdAlerts: observabilityHardLimitEnforcement.source_threshold_alert_contract,
      publicApi: observabilityHardLimitEnforcement.source_public_api_contract
    },
    policy: hardLimitEnforcementPolicy,
    errorContract: hardLimitErrorContract,
    dimensions: hardLimitDimensions.map((dimension) => ({
      id: dimension.id,
      sourceDimensions: dimension.source_dimensions ?? [],
      scopeTypes: dimension.scope_types ?? [],
      blockingMode: dimension.blocking_mode ?? 'resource_creation'
    })),
    surfaces: hardLimitSurfaceMappings,
    boundaries: observabilityHardLimitEnforcement.boundaries ?? []
  };
}

export function listEnforceableQuotaDimensions() {
  return hardLimitDimensions;
}

export function getHardLimitErrorResponseSchema() {
  return hardLimitErrorContract;
}

export function buildQuotaHardLimitDecision(input = {}) {
  const dimensionId = normalizeHardLimitDimensionId(input.dimensionId);
  const scopeType = input.scopeType ?? (input.workspaceId ? 'workspace' : 'tenant');
  const scopeId = input.scopeId ?? (scopeType === 'workspace' ? input.workspaceId ?? null : input.tenantId ?? null);
  const currentUsage = toFiniteNumberOrNull(input.currentUsage);
  const hardLimit = toFiniteNumberOrNull(input.hardLimit);
  const evidenceAvailable = input.evidenceAvailable !== false;
  const isDenied = input.allowed === false || (evidenceAvailable === false && hardLimitEnforcementPolicy.fail_closed_on_missing_evidence === true)
    || (currentUsage != null && hardLimit != null && currentUsage >= hardLimit);
  const blockingAction = input.blockingAction ?? 'create_resource';
  const fallbackScopeId = scopeId ?? (scopeType === 'workspace' ? input.workspaceId ?? input.tenantId ?? 'unknown-scope' : input.tenantId ?? 'unknown-scope');

  return Object.freeze({
    allowed: !isDenied,
    denied: isDenied,
    errorCode: hardLimitErrorContract.error_code ?? 'QUOTA_HARD_LIMIT_REACHED',
    httpStatus: hardLimitErrorContract.http_status ?? 429,
    retryable: input.retryable ?? hardLimitErrorContract.retryable ?? false,
    dimensionId,
    scopeType,
    scopeId: fallbackScopeId,
    tenantId: input.tenantId ?? null,
    workspaceId: input.workspaceId ?? null,
    currentUsage: currentUsage ?? 0,
    hardLimit: hardLimit ?? 0,
    blockingAction,
    message:
      input.message
      ?? `Quota hard limit reached for ${dimensionId ?? 'unknown_dimension'} at ${scopeType} scope ${fallbackScopeId}.`,
    metricKey: input.metricKey ?? null,
    sourceDimensionIds: getHardLimitDimension(dimensionId)?.source_dimensions ?? [],
    evaluatedAt: input.evaluatedAt ?? new Date().toISOString(),
    evidenceAvailable,
    reasonCode: input.reasonCode ?? null,
    violation: input.violation ?? null,
    surfaceId: input.surfaceId ?? null,
    resourceKind: input.resourceKind ?? null
  });
}

export function pickStrictestHardLimitDecision(decisions = []) {
  const normalized = decisions.filter(Boolean).map((decision) => (decision.errorCode ? decision : buildQuotaHardLimitDecision(decision)));
  const denied = normalized.filter((decision) => decision.denied === true);
  if (denied.length === 0) {
    return normalized[0] ?? null;
  }

  return denied.sort((left, right) => {
    const priorityDelta = normalizeScopePriority(right.scopeType) - normalizeScopePriority(left.scopeType);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }
    return (right.currentUsage - right.hardLimit) - (left.currentUsage - left.hardLimit);
  })[0];
}

export function buildQuotaHardLimitErrorResponse(decision = {}, context = {}) {
  const resolved = decision.errorCode ? decision : buildQuotaHardLimitDecision({ ...context, ...decision });
  return Object.freeze({
    error_code: resolved.errorCode,
    dimension_id: resolved.dimensionId,
    scope_type: resolved.scopeType,
    scope_id: resolved.scopeId,
    current_usage: resolved.currentUsage,
    hard_limit: resolved.hardLimit,
    blocking_action: resolved.blockingAction,
    retryable: resolved.retryable,
    message: resolved.message,
    tenant_id: resolved.tenantId,
    workspace_id: resolved.workspaceId,
    evaluated_at: resolved.evaluatedAt,
    metric_key: resolved.metricKey,
    reason_code: resolved.reasonCode
  });
}

export function buildQuotaHardLimitAuditEvent(decision = {}, context = {}) {
  const resolved = decision.errorCode ? decision : buildQuotaHardLimitDecision({ ...context, ...decision });
  return Object.freeze({
    eventType: hardLimitAuditContract.event_type ?? 'quota.hard_limit.evaluated',
    decision: resolved.denied ? 'denied' : 'allowed',
    tenantId: resolved.tenantId ?? context.tenantId ?? null,
    workspaceId: resolved.workspaceId ?? context.workspaceId ?? null,
    dimensionId: resolved.dimensionId,
    scopeType: resolved.scopeType,
    scopeId: resolved.scopeId,
    blockingAction: resolved.blockingAction,
    currentUsage: resolved.currentUsage,
    hardLimit: resolved.hardLimit,
    evaluatedAt: resolved.evaluatedAt,
    errorCode: resolved.errorCode,
    surfaceId: resolved.surfaceId,
    resourceKind: resolved.resourceKind
  });
}

export function mapAdapterQuotaDecisionToEnforcementDecision(input = {}) {
  if (input.decision?.errorCode) {
    return input.decision;
  }

  if (input.effectiveViolation) {
    const violation = input.effectiveViolation;
    const delta = toFiniteNumberOrNull(violation.delta) ?? 1;
    const currentUsage = toFiniteNumberOrNull(input.currentUsage)
      ?? toFiniteNumberOrNull(violation.used)
      ?? Math.max((toFiniteNumberOrNull(violation.nextUsed) ?? delta) - delta, 0);
    const hardLimit = toFiniteNumberOrNull(input.hardLimit)
      ?? toFiniteNumberOrNull(violation.limit)
      ?? toFiniteNumberOrNull(violation.used)
      ?? 0;
    return buildQuotaHardLimitDecision({
      ...input,
      allowed: input.allowed ?? false,
      scopeType: input.scopeType ?? violation.scope ?? (input.workspaceId ? 'workspace' : 'tenant'),
      scopeId: input.scopeId ?? violation.scopeId,
      currentUsage,
      hardLimit,
      metricKey: input.metricKey ?? violation.metricKey,
      reasonCode: input.reasonCode ?? violation.reasonCode ?? violation.normalizedCode,
      violation
    });
  }

  return buildQuotaHardLimitDecision(input);
}

export function isQuotaHardLimitReached(decision = {}) {
  const resolved = decision.errorCode ? decision : buildQuotaHardLimitDecision(decision);
  return resolved.denied === true;
}
