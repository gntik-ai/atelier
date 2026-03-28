import { readJson } from './quality-gates.mjs';

export const OBSERVABILITY_QUOTA_POLICIES_PATH = 'services/internal-contracts/src/observability-quota-policies.json';
export const OBSERVABILITY_USAGE_CONSUMPTION_PATH = 'services/internal-contracts/src/observability-usage-consumption.json';
export const OBSERVABILITY_HEALTH_CHECKS_PATH = 'services/internal-contracts/src/observability-health-checks.json';
export const OBSERVABILITY_AUDIT_EVENT_SCHEMA_PATH = 'services/internal-contracts/src/observability-audit-event-schema.json';
export const AUTHORIZATION_MODEL_PATH = 'services/internal-contracts/src/authorization-model.json';
export const PUBLIC_ROUTE_CATALOG_PATH = 'services/internal-contracts/src/public-route-catalog.json';
export const PUBLIC_API_TAXONOMY_PATH = 'services/internal-contracts/src/public-api-taxonomy.json';

const REQUIRED_SCOPE_IDS = ['tenant', 'workspace'];
const REQUIRED_PERMISSION_IDS = ['tenant.quota.read', 'workspace.quota.read'];
const REQUIRED_ROUTE_IDS = ['getTenantQuotaPosture', 'getWorkspaceQuotaPosture'];
const REQUIRED_RESOURCE_TYPES = ['tenant_quota_posture', 'workspace_quota_posture'];
const REQUIRED_THRESHOLD_TYPE_IDS = ['warning_threshold', 'soft_limit', 'hard_limit'];
const REQUIRED_POLICY_MODE_IDS = ['enforced', 'unbounded'];
const REQUIRED_POSTURE_STATE_IDS = [
  'within_limit',
  'warning_threshold_reached',
  'soft_limit_exceeded',
  'hard_limit_reached',
  'evidence_degraded',
  'evidence_unavailable',
  'unbounded'
];
const REQUIRED_BOUNDARIES = [
  'alert_emission_is_defined_in_us_obs_03_t03',
  'hard_limit_blocking_is_defined_in_us_obs_03_t04',
  'console_usage_projection_is_defined_in_us_obs_03_t05',
  'cross_module_consumption_and_enforcement_tests_are_defined_in_us_obs_03_t06'
];
const REQUIRED_POSTURE_FIELDS = [
  'postureId',
  'queryScope',
  'tenantId',
  'workspaceId',
  'evaluatedAt',
  'usageSnapshotTimestamp',
  'observationWindow',
  'dimensions',
  'overallStatus',
  'degradedDimensions',
  'hardLimitBreaches',
  'softLimitBreaches',
  'warningDimensions',
  'evaluationAudit'
];
const REQUIRED_DIMENSION_FIELDS = [
  'dimensionId',
  'displayName',
  'scope',
  'measuredValue',
  'unit',
  'freshnessStatus',
  'policyMode',
  'status',
  'warningThreshold',
  'softLimit',
  'hardLimit',
  'remainingToWarning',
  'remainingToSoftLimit',
  'remainingToHardLimit',
  'usageSnapshotTimestamp'
];
const REQUIRED_AUDIT_DETAIL_FIELDS = [
  'evaluationId',
  'queryScope',
  'overallStatus',
  'hardLimitBreaches',
  'softLimitBreaches',
  'warningDimensions',
  'evaluatedAt'
];

export function readObservabilityQuotaPolicies() {
  return readJson(OBSERVABILITY_QUOTA_POLICIES_PATH);
}

export function readObservabilityUsageConsumption() {
  return readJson(OBSERVABILITY_USAGE_CONSUMPTION_PATH);
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

function collectKnownUsageDimensions(usageContract = {}) {
  return new Set((usageContract?.metered_dimensions ?? []).map((dimension) => dimension.id));
}

export function collectObservabilityQuotaPolicyViolations(
  contract = readObservabilityQuotaPolicies(),
  dependencies = {
    usageConsumption: readObservabilityUsageConsumption(),
    healthChecks: readObservabilityHealthChecks(),
    auditEventSchema: readObservabilityAuditEventSchema(),
    authorizationModel: readAuthorizationModel(),
    routeCatalog: readPublicRouteCatalog(),
    publicApiTaxonomy: readPublicApiTaxonomy()
  }
) {
  const violations = [];
  const {
    usageConsumption,
    healthChecks,
    auditEventSchema,
    authorizationModel,
    routeCatalog,
    publicApiTaxonomy
  } = dependencies;

  if (typeof contract?.version !== 'string' || contract.version.length === 0) {
    violations.push('Observability quota policies contract version must be a non-empty string.');
  }

  if (contract?.source_usage_contract !== usageConsumption?.version) {
    violations.push('Observability quota policies source_usage_contract must align with observability-usage-consumption.json version.');
  }

  if (contract?.source_health_contract !== healthChecks?.version) {
    violations.push('Observability quota policies source_health_contract must align with observability-health-checks.json version.');
  }

  if (contract?.source_audit_event_schema_contract !== auditEventSchema?.version) {
    violations.push('Observability quota policies source_audit_event_schema_contract must align with observability-audit-event-schema.json version.');
  }

  if (contract?.source_authorization_contract !== authorizationModel?.version) {
    violations.push('Observability quota policies source_authorization_contract must align with authorization-model.json version.');
  }

  if (contract?.source_public_api_contract !== publicApiTaxonomy?.version) {
    violations.push('Observability quota policies source_public_api_contract must align with public-api-taxonomy.json version.');
  }

  const scopeById = indexBy(contract?.supported_posture_scopes ?? []);
  const thresholdTypeById = indexBy(contract?.threshold_types ?? []);
  const policyModeById = indexBy(contract?.policy_modes ?? []);
  const postureStateById = indexBy(contract?.posture_states ?? []);
  const routeIds = new Set((routeCatalog?.routes ?? []).map((route) => route.operationId));
  const resourceTypes = new Set((publicApiTaxonomy?.resource_taxonomy ?? []).map((entry) => entry.resource_type));
  const knownPermissions = collectKnownPermissions(authorizationModel);
  const knownUsageDimensions = collectKnownUsageDimensions(usageConsumption);
  const auditSubsystemIds = new Set(auditEventSchema?.resource?.supported_subsystem_ids ?? []);
  const auditActionCategories = new Set(auditEventSchema?.action?.categories ?? []);
  const auditOriginSurfaces = new Set(auditEventSchema?.origin?.origin_surfaces ?? []);
  const requiredPostureFields = new Set(contract?.posture_contract?.required_fields ?? []);
  const requiredDimensionFields = new Set(contract?.posture_contract?.dimension_projection?.required_fields ?? []);

  for (const scopeId of REQUIRED_SCOPE_IDS) {
    if (!scopeById.has(scopeId)) {
      violations.push(`Observability quota policies must declare supported posture scope ${scopeId}.`);
    }
  }

  for (const thresholdTypeId of REQUIRED_THRESHOLD_TYPE_IDS) {
    if (!thresholdTypeById.has(thresholdTypeId)) {
      violations.push(`Observability quota policies must define threshold type ${thresholdTypeId}.`);
    }
  }

  for (const policyModeId of REQUIRED_POLICY_MODE_IDS) {
    if (!policyModeById.has(policyModeId)) {
      violations.push(`Observability quota policies must define policy mode ${policyModeId}.`);
    }
  }

  for (const postureStateId of REQUIRED_POSTURE_STATE_IDS) {
    if (!postureStateById.has(postureStateId)) {
      violations.push(`Observability quota policies must define posture state ${postureStateId}.`);
    }
  }

  for (const permissionId of REQUIRED_PERMISSION_IDS) {
    if (!knownPermissions.has(permissionId)) {
      violations.push(`Observability quota policies requires known authorization action ${permissionId}.`);
    }
  }

  for (const routeId of REQUIRED_ROUTE_IDS) {
    if (!routeIds.has(routeId)) {
      violations.push(`Observability quota policies requires public route catalog operation ${routeId}.`);
    }
  }

  for (const resourceType of REQUIRED_RESOURCE_TYPES) {
    if (!resourceTypes.has(resourceType)) {
      violations.push(`Observability quota policies requires public API taxonomy resource type ${resourceType}.`);
    }
  }

  for (const scope of scopeById.values()) {
    if (!scope.route_operation_id || !routeIds.has(scope.route_operation_id)) {
      violations.push(`Observability quota policy scope ${scope.id} must reference a known public route operation id.`);
    }

    if (!scope.resource_type || !resourceTypes.has(scope.resource_type)) {
      violations.push(`Observability quota policy scope ${scope.id} must reference a known public resource type.`);
    }

    if (!scope.required_permission || !knownPermissions.has(scope.required_permission)) {
      violations.push(`Observability quota policy scope ${scope.id} must reference a known authorization action.`);
    }

    if ((scope.required_context_fields ?? []).length === 0) {
      violations.push(`Observability quota policy scope ${scope.id} must declare required_context_fields.`);
    }
  }

  for (const thresholdType of thresholdTypeById.values()) {
    if (thresholdType.comparison_rule !== 'greater_than_or_equal') {
      violations.push(`Observability quota threshold type ${thresholdType.id} must use comparison_rule greater_than_or_equal.`);
    }
  }

  for (const dimensionId of contract?.supported_dimensions ?? []) {
    if (!knownUsageDimensions.has(dimensionId)) {
      violations.push(`Observability quota policies supported dimension ${dimensionId} must exist in observability-usage-consumption.json.`);
    }
  }

  const thresholdOrder = contract?.ordering_rules?.threshold_order ?? [];
  for (const thresholdTypeId of REQUIRED_THRESHOLD_TYPE_IDS) {
    if (!thresholdOrder.includes(thresholdTypeId)) {
      violations.push(`Observability quota policies ordering_rules.threshold_order must include ${thresholdTypeId}.`);
    }
  }

  for (const field of REQUIRED_POSTURE_FIELDS) {
    if (!requiredPostureFields.has(field)) {
      violations.push(`Observability quota posture_contract must require field ${field}.`);
    }
  }

  for (const field of REQUIRED_DIMENSION_FIELDS) {
    if (!requiredDimensionFields.has(field)) {
      violations.push(`Observability quota dimension_projection must require field ${field}.`);
    }
  }

  const evaluationDefaults = contract?.evaluation_defaults ?? {};
  for (const key of ['evidence_degraded_status', 'evidence_unavailable_status', 'unbounded_status', 'normal_status', 'warning_status', 'soft_limit_status', 'hard_limit_status']) {
    const postureStateId = evaluationDefaults[key];
    if (!postureStateById.has(postureStateId)) {
      violations.push(`Observability quota evaluation_defaults.${key} must reference a known posture state.`);
    }
  }

  for (const postureStateId of evaluationDefaults.overall_status_precedence ?? []) {
    if (!postureStateById.has(postureStateId)) {
      violations.push(`Observability quota overall_status_precedence references unknown posture state ${postureStateId}.`);
    }
  }

  const auditContract = contract?.evaluation_audit ?? {};
  if (!auditSubsystemIds.has(auditContract.subsystem_id)) {
    violations.push('Observability quota evaluation_audit.subsystem_id must reference a known audit subsystem.');
  }

  if (!auditActionCategories.has(auditContract.action_category)) {
    violations.push('Observability quota evaluation_audit.action_category must reference a known audit action category.');
  }

  if (!auditOriginSurfaces.has(auditContract.origin_surface)) {
    violations.push('Observability quota evaluation_audit.origin_surface must reference a known audit origin surface.');
  }

  for (const field of REQUIRED_AUDIT_DETAIL_FIELDS) {
    if (!(auditContract.required_detail_fields ?? []).includes(field)) {
      violations.push(`Observability quota evaluation_audit must require detail field ${field}.`);
    }
  }

  for (const boundary of REQUIRED_BOUNDARIES) {
    if (!(contract?.boundaries ?? []).includes(boundary)) {
      violations.push(`Observability quota policies must retain boundary marker ${boundary}.`);
    }
  }

  return violations;
}
