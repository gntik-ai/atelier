import { readJson } from './quality-gates.mjs';

export const OBSERVABILITY_USAGE_CONSUMPTION_PATH = 'services/internal-contracts/src/observability-usage-consumption.json';
export const OBSERVABILITY_BUSINESS_METRICS_PATH = 'services/internal-contracts/src/observability-business-metrics.json';
export const OBSERVABILITY_HEALTH_CHECKS_PATH = 'services/internal-contracts/src/observability-health-checks.json';
export const OBSERVABILITY_AUDIT_EVENT_SCHEMA_PATH = 'services/internal-contracts/src/observability-audit-event-schema.json';
export const AUTHORIZATION_MODEL_PATH = 'services/internal-contracts/src/authorization-model.json';
export const PUBLIC_ROUTE_CATALOG_PATH = 'services/internal-contracts/src/public-route-catalog.json';
export const PUBLIC_API_TAXONOMY_PATH = 'services/internal-contracts/src/public-api-taxonomy.json';

const REQUIRED_SCOPE_IDS = ['tenant', 'workspace'];
const REQUIRED_PERMISSION_IDS = ['tenant.usage.read', 'workspace.usage.read'];
const REQUIRED_ROUTE_IDS = ['getTenantUsageSnapshot', 'getWorkspaceUsageSnapshot'];
const REQUIRED_RESOURCE_TYPES = ['tenant_usage_snapshot', 'workspace_usage_snapshot'];
const REQUIRED_FRESHNESS_IDS = ['fresh', 'degraded', 'unavailable'];
const REQUIRED_DIMENSION_IDS = [
  'api_requests',
  'function_invocations',
  'storage_volume_bytes',
  'data_service_operations',
  'realtime_connections',
  'logical_databases',
  'topics',
  'collections_tables',
  'error_count'
];
const REQUIRED_BOUNDARIES = [
  'threshold_policy_evaluation_is_defined_in_us_obs_03_t02',
  'alert_emission_is_defined_in_us_obs_03_t03',
  'hard_limit_blocking_is_defined_in_us_obs_03_t04',
  'console_usage_projection_is_defined_in_us_obs_03_t05',
  'cross_module_consumption_and_enforcement_tests_are_defined_in_us_obs_03_t06'
];
const REQUIRED_BUSINESS_METRIC_FAMILY_IDS = [
  'api_requests_total',
  'function_invocations_total',
  'storage_logical_volume_bytes',
  'data_service_operations_total',
  'realtime_connections_active',
  'identity_events_total'
];

export function readObservabilityUsageConsumption() {
  return readJson(OBSERVABILITY_USAGE_CONSUMPTION_PATH);
}

export function readObservabilityBusinessMetrics() {
  return readJson(OBSERVABILITY_BUSINESS_METRICS_PATH);
}

export function readObservabilityHealthChecks() {
  return readJson(OBSERVABILITY_HEALTH_CHECKS_PATH);
}

export function readObservabilityAuditEventSchema() {
  return readJson(OBSERVABILITY_AUDIT_EVENT_SCHEMA_PATH);
}

export function readAuthorizationModel() {
  return readJson(AUTHORIZATION_MODEL_PATH);
}

export function readPublicRouteCatalog() {
  return readJson(PUBLIC_ROUTE_CATALOG_PATH);
}

export function readPublicApiTaxonomy() {
  return readJson(PUBLIC_API_TAXONOMY_PATH);
}

function collectKnownPermissions(authorizationModel = {}) {
  return new Set(Object.values(authorizationModel?.resource_actions ?? {}).flatMap((actions) => actions ?? []));
}

function indexBy(items = [], keyField = 'id') {
  return new Map(items.map((item) => [item?.[keyField], item]));
}

export function collectObservabilityUsageConsumptionViolations(
  contract = readObservabilityUsageConsumption(),
  dependencies = {
    businessMetrics: readObservabilityBusinessMetrics(),
    healthChecks: readObservabilityHealthChecks(),
    auditEventSchema: readObservabilityAuditEventSchema(),
    authorizationModel: readAuthorizationModel(),
    routeCatalog: readPublicRouteCatalog(),
    publicApiTaxonomy: readPublicApiTaxonomy()
  }
) {
  const violations = [];
  const {
    businessMetrics,
    healthChecks,
    auditEventSchema,
    authorizationModel,
    routeCatalog,
    publicApiTaxonomy
  } = dependencies;

  if (typeof contract?.version !== 'string' || contract.version.length === 0) {
    violations.push('Observability usage consumption contract version must be a non-empty string.');
  }

  if (contract?.source_business_metrics_contract !== businessMetrics?.version) {
    violations.push('Observability usage consumption source_business_metrics_contract must align with observability-business-metrics.json version.');
  }

  if (contract?.source_health_contract !== healthChecks?.version) {
    violations.push('Observability usage consumption source_health_contract must align with observability-health-checks.json version.');
  }

  if (contract?.source_audit_event_schema_contract !== auditEventSchema?.version) {
    violations.push('Observability usage consumption source_audit_event_schema_contract must align with observability-audit-event-schema.json version.');
  }

  if (contract?.source_authorization_contract !== authorizationModel?.version) {
    violations.push('Observability usage consumption source_authorization_contract must align with authorization-model.json version.');
  }

  if (contract?.source_public_api_contract !== publicApiTaxonomy?.version) {
    violations.push('Observability usage consumption source_public_api_contract must align with public-api-taxonomy.json version.');
  }

  const scopeById = indexBy(contract?.supported_snapshot_scopes ?? []);
  const freshnessById = indexBy(contract?.freshness_states ?? []);
  const dimensionById = indexBy(contract?.metered_dimensions ?? []);
  const routeIds = new Set((routeCatalog?.routes ?? []).map((route) => route.operationId));
  const resourceTypes = new Set((publicApiTaxonomy?.resource_taxonomy ?? []).map((entry) => entry.resource_type));
  const knownPermissions = collectKnownPermissions(authorizationModel);
  const businessMetricFamilies = indexBy(businessMetrics?.metric_families ?? []);
  const auditSubsystemIds = new Set(auditEventSchema?.resource?.supported_subsystem_ids ?? []);
  const auditActionCategories = new Set(auditEventSchema?.action?.categories ?? []);
  const auditOriginSurfaces = new Set(auditEventSchema?.origin?.origin_surfaces ?? []);
  const requiredSnapshotFields = new Set(contract?.snapshot_contract?.required_fields ?? []);
  const requiredDimensionFields = new Set(contract?.snapshot_contract?.dimension_projection?.required_fields ?? []);
  const requiredObservationWindowFields = new Set(contract?.snapshot_contract?.observation_window?.required_fields ?? []);

  for (const scopeId of REQUIRED_SCOPE_IDS) {
    if (!scopeById.has(scopeId)) {
      violations.push(`Observability usage consumption must declare supported snapshot scope ${scopeId}.`);
    }
  }

  for (const permissionId of REQUIRED_PERMISSION_IDS) {
    if (!knownPermissions.has(permissionId)) {
      violations.push(`Observability usage consumption requires known authorization action ${permissionId}.`);
    }
  }

  for (const routeId of REQUIRED_ROUTE_IDS) {
    if (!routeIds.has(routeId)) {
      violations.push(`Observability usage consumption requires public route catalog operation ${routeId}.`);
    }
  }

  for (const resourceType of REQUIRED_RESOURCE_TYPES) {
    if (!resourceTypes.has(resourceType)) {
      violations.push(`Observability usage consumption requires public API taxonomy resource type ${resourceType}.`);
    }
  }

  for (const freshnessId of REQUIRED_FRESHNESS_IDS) {
    if (!freshnessById.has(freshnessId)) {
      violations.push(`Observability usage consumption must define freshness state ${freshnessId}.`);
    }
  }

  for (const dimensionId of REQUIRED_DIMENSION_IDS) {
    if (!dimensionById.has(dimensionId)) {
      violations.push(`Observability usage consumption must define metered dimension ${dimensionId}.`);
    }
  }

  for (const familyId of REQUIRED_BUSINESS_METRIC_FAMILY_IDS) {
    if (!businessMetricFamilies.has(familyId)) {
      violations.push(`Observability usage consumption depends on known business metric family ${familyId}.`);
    }
  }

  for (const scope of scopeById.values()) {
    if (!scope.route_operation_id || !routeIds.has(scope.route_operation_id)) {
      violations.push(`Observability usage consumption scope ${scope.id} must reference a known public route operation id.`);
    }

    if (!scope.resource_type || !resourceTypes.has(scope.resource_type)) {
      violations.push(`Observability usage consumption scope ${scope.id} must reference a known public resource type.`);
    }

    if (!scope.required_permission || !knownPermissions.has(scope.required_permission)) {
      violations.push(`Observability usage consumption scope ${scope.id} must reference a known authorization action.`);
    }

    if ((scope.required_context_fields ?? []).length === 0) {
      violations.push(`Observability usage consumption scope ${scope.id} must declare required_context_fields.`);
    }
  }

  for (const dimension of dimensionById.values()) {
    if (!dimension.display_name || !dimension.unit || !dimension.aggregation_kind) {
      violations.push(`Observability usage dimension ${dimension.id} must define display_name, unit, and aggregation_kind.`);
    }

    if (!Array.isArray(dimension.supported_scopes) || dimension.supported_scopes.length === 0) {
      violations.push(`Observability usage dimension ${dimension.id} must declare supported_scopes.`);
    }

    for (const scopeId of dimension.supported_scopes ?? []) {
      if (!scopeById.has(scopeId)) {
        violations.push(`Observability usage dimension ${dimension.id} references unknown scope ${scopeId}.`);
      }
    }

    if (!['business_metric_family', 'control_plane_inventory'].includes(dimension.source_mode)) {
      violations.push(`Observability usage dimension ${dimension.id} must use source_mode business_metric_family or control_plane_inventory.`);
    }

    if (dimension.source_mode === 'business_metric_family' && !businessMetricFamilies.has(dimension.source_ref)) {
      violations.push(`Observability usage dimension ${dimension.id} must reference a known business metric family id.`);
    }

    if (dimension.source_mode === 'control_plane_inventory' && typeof dimension.source_ref !== 'string') {
      violations.push(`Observability usage dimension ${dimension.id} must declare inventory source_ref.`);
    }
  }

  for (const field of ['snapshotId', 'queryScope', 'tenantId', 'workspaceId', 'snapshotTimestamp', 'observationWindow', 'dimensions', 'degradedDimensions', 'calculationCycle']) {
    if (!requiredSnapshotFields.has(field)) {
      violations.push(`Observability usage snapshot_contract must require field ${field}.`);
    }
  }

  for (const field of ['startedAt', 'endedAt']) {
    if (!requiredObservationWindowFields.has(field)) {
      violations.push(`Observability usage observation_window must require field ${field}.`);
    }
  }

  for (const field of ['dimensionId', 'displayName', 'value', 'unit', 'freshnessStatus', 'sourceMode', 'sourceRef', 'observedAt']) {
    if (!requiredDimensionFields.has(field)) {
      violations.push(`Observability usage dimension_projection must require field ${field}.`);
    }
  }

  const auditContract = contract?.calculation_audit ?? {};
  if (!auditSubsystemIds.has(auditContract.subsystem_id)) {
    violations.push('Observability usage calculation_audit.subsystem_id must reference a known audit subsystem.');
  }

  if (!auditActionCategories.has(auditContract.action_category)) {
    violations.push('Observability usage calculation_audit.action_category must reference a known audit action category.');
  }

  if (!auditOriginSurfaces.has(auditContract.origin_surface)) {
    violations.push('Observability usage calculation_audit.origin_surface must reference a known audit origin surface.');
  }

  for (const field of ['cycleId', 'processedScopes', 'degradedDimensions', 'snapshotTimestamp']) {
    if (!(auditContract.required_detail_fields ?? []).includes(field)) {
      violations.push(`Observability usage calculation_audit must require detail field ${field}.`);
    }
  }

  if ((contract?.refresh_policy?.default_cadence_seconds ?? 0) <= 0) {
    violations.push('Observability usage refresh_policy default_cadence_seconds must be positive.');
  }

  if ((contract?.refresh_policy?.degraded_after_seconds ?? 0) < (contract?.refresh_policy?.default_cadence_seconds ?? 0)) {
    violations.push('Observability usage refresh_policy degraded_after_seconds must be greater than or equal to default_cadence_seconds.');
  }

  if (contract?.refresh_policy?.collection_health_metric !== businessMetrics?.freshness_and_collection?.collection_health_metric) {
    violations.push('Observability usage refresh_policy collection_health_metric must align with the business-metrics freshness baseline.');
  }

  if (contract?.refresh_policy?.lag_metric !== businessMetrics?.freshness_and_collection?.lag_metric) {
    violations.push('Observability usage refresh_policy lag_metric must align with the business-metrics freshness baseline.');
  }

  for (const boundary of REQUIRED_BOUNDARIES) {
    if (!(contract?.boundaries ?? []).includes(boundary)) {
      violations.push(`Observability usage consumption must retain explicit boundary ${boundary}.`);
    }
  }

  return violations;
}
