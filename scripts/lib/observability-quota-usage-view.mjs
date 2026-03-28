import { readJson } from './quality-gates.mjs';

export const OBSERVABILITY_QUOTA_USAGE_VIEW_PATH = 'services/internal-contracts/src/observability-quota-usage-view.json';
export const OBSERVABILITY_USAGE_CONSUMPTION_PATH = 'services/internal-contracts/src/observability-usage-consumption.json';
export const OBSERVABILITY_QUOTA_POLICIES_PATH = 'services/internal-contracts/src/observability-quota-policies.json';
export const OBSERVABILITY_HARD_LIMIT_ENFORCEMENT_PATH = 'services/internal-contracts/src/observability-hard-limit-enforcement.json';
export const AUTHORIZATION_MODEL_PATH = 'services/internal-contracts/src/authorization-model.json';
export const PUBLIC_ROUTE_CATALOG_PATH = 'services/internal-contracts/src/public-route-catalog.json';
export const PUBLIC_API_TAXONOMY_PATH = 'services/internal-contracts/src/public-api-taxonomy.json';

const REQUIRED_SCOPE_IDS = ['tenant_overview', 'workspace_overview'];
const REQUIRED_PERMISSION_IDS = ['tenant.overview.read', 'workspace.overview.read'];
const REQUIRED_ROUTE_IDS = ['getTenantQuotaUsageOverview', 'getWorkspaceQuotaUsageOverview'];
const REQUIRED_RESOURCE_TYPES = ['tenant_quota_usage_view', 'workspace_quota_usage_view'];
const REQUIRED_VISUAL_STATES = ['healthy', 'warning', 'elevated', 'critical', 'degraded', 'unknown'];
const REQUIRED_PROVISIONING_SUMMARIES = ['active', 'provisioning', 'degraded', 'error'];
const REQUIRED_PROVISIONING_COMPONENT_STATES = ['ready', 'in_progress', 'degraded', 'error'];
const REQUIRED_PROVISIONING_COMPONENTS = ['storage', 'databases', 'messaging', 'functions', 'realtime'];
const REQUIRED_DIMENSION_FIELDS = [
  'dimensionId',
  'displayName',
  'scope',
  'currentUsage',
  'unit',
  'warningThreshold',
  'softLimit',
  'hardLimit',
  'usagePercentage',
  'posture',
  'visualState',
  'freshnessStatus',
  'lastUpdatedAt',
  'blockingState',
  'blockingReasonCode'
];
const REQUIRED_OVERVIEW_FIELDS = [
  'overviewId',
  'queryScope',
  'tenantId',
  'workspaceId',
  'generatedAt',
  'policiesConfigured',
  'dimensions',
  'overallPosture',
  'warningDimensions',
  'softLimitDimensions',
  'hardLimitDimensions',
  'accessAudit'
];
const REQUIRED_ACCESS_AUDIT_FIELDS = [
  'eventType',
  'queryScope',
  'tenantId',
  'workspaceId',
  'permissionId',
  'routeOperationId',
  'requestedBy',
  'generatedAt'
];
const REQUIRED_BOUNDARIES = ['cross_module_consumption_and_enforcement_tests_are_defined_in_us_obs_03_t06'];

export function readObservabilityQuotaUsageView() {
  return readJson(OBSERVABILITY_QUOTA_USAGE_VIEW_PATH);
}

export function readObservabilityUsageConsumption() {
  return readJson(OBSERVABILITY_USAGE_CONSUMPTION_PATH);
}

export function readObservabilityQuotaPolicies() {
  return readJson(OBSERVABILITY_QUOTA_POLICIES_PATH);
}

export function readObservabilityHardLimitEnforcement() {
  return readJson(OBSERVABILITY_HARD_LIMIT_ENFORCEMENT_PATH);
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

export function collectObservabilityQuotaUsageViewViolations(
  contract = readObservabilityQuotaUsageView(),
  dependencies = {
    usageConsumption: readObservabilityUsageConsumption(),
    quotaPolicies: readObservabilityQuotaPolicies(),
    hardLimitEnforcement: readObservabilityHardLimitEnforcement(),
    authorizationModel: readAuthorizationModel(),
    routeCatalog: readPublicRouteCatalog(),
    publicApiTaxonomy: readPublicApiTaxonomy()
  }
) {
  const violations = [];
  const {
    usageConsumption,
    quotaPolicies,
    hardLimitEnforcement,
    authorizationModel,
    routeCatalog,
    publicApiTaxonomy
  } = dependencies;

  if (typeof contract?.version !== 'string' || contract.version.length === 0) {
    violations.push('Observability quota usage view contract version must be a non-empty string.');
  }

  if (contract?.source_usage_contract !== usageConsumption?.version) {
    violations.push('Observability quota usage view source_usage_contract must align with observability-usage-consumption.json version.');
  }

  if (contract?.source_quota_policy_contract !== quotaPolicies?.version) {
    violations.push('Observability quota usage view source_quota_policy_contract must align with observability-quota-policies.json version.');
  }

  if (contract?.source_hard_limit_contract !== hardLimitEnforcement?.version) {
    violations.push('Observability quota usage view source_hard_limit_contract must align with observability-hard-limit-enforcement.json version.');
  }

  if (contract?.source_authorization_contract !== authorizationModel?.version) {
    violations.push('Observability quota usage view source_authorization_contract must align with authorization-model.json version.');
  }

  if (contract?.source_public_api_contract !== publicApiTaxonomy?.version) {
    violations.push('Observability quota usage view source_public_api_contract must align with public-api-taxonomy.json version.');
  }

  const scopeById = indexBy(contract?.supported_overview_scopes ?? []);
  const visualStateIds = new Set((contract?.visual_states ?? []).map((state) => state?.id));
  const provisioningSummaryIds = new Set((contract?.provisioning_state_summaries ?? []).map((state) => state?.id));
  const provisioningComponentStateIds = new Set((contract?.provisioning_component_states ?? []).map((state) => state?.id));
  const provisioningComponentIds = new Set((contract?.provisioning_components ?? []).map((component) => component?.id));
  const knownUsageDimensions = new Set((usageConsumption?.metered_dimensions ?? []).map((dimension) => dimension?.id));
  const knownQuotaDimensions = new Set(quotaPolicies?.supported_dimensions ?? []);
  const knownHardLimitDimensions = new Set((hardLimitEnforcement?.dimensions ?? []).flatMap((dimension) => dimension?.source_dimensions ?? []));
  const routeIds = new Set((routeCatalog?.routes ?? []).map((route) => route.operationId));
  const resourceTypes = new Set((publicApiTaxonomy?.resource_taxonomy ?? []).map((entry) => entry.resource_type));
  const knownPermissions = collectKnownPermissions(authorizationModel);
  const mappedPostures = new Set((contract?.posture_visual_state_mappings ?? []).map((mapping) => mapping?.posture_id));
  const publishedQuotaPostures = new Set((quotaPolicies?.posture_states ?? []).map((state) => state?.id));
  const requiredDimensionFields = new Set(contract?.dimension_view_contract?.required_fields ?? []);
  const requiredOverviewFields = new Set(contract?.overview_contract?.required_fields ?? []);
  const requiredAccessAuditFields = new Set(contract?.access_audit?.required_fields ?? []);

  for (const scopeId of REQUIRED_SCOPE_IDS) {
    if (!scopeById.has(scopeId)) {
      violations.push(`Observability quota usage view must declare supported overview scope ${scopeId}.`);
    }
  }

  for (const permissionId of REQUIRED_PERMISSION_IDS) {
    if (!knownPermissions.has(permissionId)) {
      violations.push(`Observability quota usage view permission ${permissionId} must exist in authorization-model.json.`);
    }
  }

  for (const routeId of REQUIRED_ROUTE_IDS) {
    if (!routeIds.has(routeId)) {
      violations.push(`Observability quota usage view route ${routeId} must exist in the public route catalog.`);
    }
  }

  for (const resourceType of REQUIRED_RESOURCE_TYPES) {
    if (!resourceTypes.has(resourceType)) {
      violations.push(`Observability quota usage view resource type ${resourceType} must exist in public-api-taxonomy.json.`);
    }
  }

  for (const stateId of REQUIRED_VISUAL_STATES) {
    if (!visualStateIds.has(stateId)) {
      violations.push(`Observability quota usage view must define visual state ${stateId}.`);
    }
  }

  for (const stateId of REQUIRED_PROVISIONING_SUMMARIES) {
    if (!provisioningSummaryIds.has(stateId)) {
      violations.push(`Observability quota usage view must define provisioning summary state ${stateId}.`);
    }
  }

  for (const stateId of REQUIRED_PROVISIONING_COMPONENT_STATES) {
    if (!provisioningComponentStateIds.has(stateId)) {
      violations.push(`Observability quota usage view must define provisioning component state ${stateId}.`);
    }
  }

  for (const componentId of REQUIRED_PROVISIONING_COMPONENTS) {
    if (!provisioningComponentIds.has(componentId)) {
      violations.push(`Observability quota usage view must define provisioning component ${componentId}.`);
    }
  }

  for (const dimensionId of contract?.supported_dimensions ?? []) {
    if (!knownUsageDimensions.has(dimensionId)) {
      violations.push(`Observability quota usage view dimension ${dimensionId} must exist in observability-usage-consumption.json.`);
    }
    if (!knownQuotaDimensions.has(dimensionId)) {
      violations.push(`Observability quota usage view dimension ${dimensionId} must exist in observability-quota-policies.json.`);
    }
  }

  if (!knownHardLimitDimensions.has('function_invocations') || !knownHardLimitDimensions.has('storage_volume_bytes')) {
    violations.push('Observability quota usage view must remain aligned to hard-limit source dimensions for blocking context.');
  }

  for (const postureId of publishedQuotaPostures) {
    if (!mappedPostures.has(postureId)) {
      violations.push(`Observability quota usage view must map posture ${postureId} to a visual state.`);
    }
  }

  for (const field of REQUIRED_DIMENSION_FIELDS) {
    if (!requiredDimensionFields.has(field)) {
      violations.push(`Observability quota usage view dimension contract must require field ${field}.`);
    }
  }

  for (const field of REQUIRED_OVERVIEW_FIELDS) {
    if (!requiredOverviewFields.has(field)) {
      violations.push(`Observability quota usage view overview contract must require field ${field}.`);
    }
  }

  for (const field of REQUIRED_ACCESS_AUDIT_FIELDS) {
    if (!requiredAccessAuditFields.has(field)) {
      violations.push(`Observability quota usage view access-audit contract must require field ${field}.`);
    }
  }

  for (const boundary of REQUIRED_BOUNDARIES) {
    if (!(contract?.boundaries ?? []).includes(boundary)) {
      violations.push(`Observability quota usage view must declare boundary ${boundary}.`);
    }
  }

  return violations;
}
