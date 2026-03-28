import { readJson } from './quality-gates.mjs';

export const OBSERVABILITY_HARD_LIMIT_ENFORCEMENT_PATH = 'services/internal-contracts/src/observability-hard-limit-enforcement.json';
export const OBSERVABILITY_USAGE_CONSUMPTION_PATH = 'services/internal-contracts/src/observability-usage-consumption.json';
export const OBSERVABILITY_QUOTA_POLICIES_PATH = 'services/internal-contracts/src/observability-quota-policies.json';
export const OBSERVABILITY_THRESHOLD_ALERTS_PATH = 'services/internal-contracts/src/observability-threshold-alerts.json';
export const PUBLIC_API_TAXONOMY_PATH = 'services/internal-contracts/src/public-api-taxonomy.json';

const REQUIRED_DIMENSIONS = [
  'api_requests',
  'serverless_functions',
  'storage_buckets',
  'logical_databases',
  'kafka_topics',
  'collections_tables',
  'realtime_connections',
  'error_budget'
];
const REQUIRED_SURFACES = [
  'storage.bucket.create',
  'functions.action.create',
  'events.topic.create',
  'postgres.database.create',
  'mongo.database.create'
];
const REQUIRED_BOUNDARIES = [
  'console_usage_projection_is_defined_in_us_obs_03_t05',
  'cross_module_consumption_and_enforcement_tests_are_defined_in_us_obs_03_t06'
];
const REQUIRED_ERROR_FIELDS = [
  'error_code',
  'dimension_id',
  'scope_type',
  'scope_id',
  'current_usage',
  'hard_limit',
  'blocking_action',
  'retryable',
  'message'
];
const REQUIRED_AUDIT_FIELDS = [
  'eventType',
  'decision',
  'tenantId',
  'workspaceId',
  'dimensionId',
  'scopeType',
  'scopeId',
  'blockingAction',
  'currentUsage',
  'hardLimit',
  'evaluatedAt'
];

export function readObservabilityHardLimitEnforcement() {
  return readJson(OBSERVABILITY_HARD_LIMIT_ENFORCEMENT_PATH);
}

export function readObservabilityUsageConsumption() {
  return readJson(OBSERVABILITY_USAGE_CONSUMPTION_PATH);
}

export function readObservabilityQuotaPolicies() {
  return readJson(OBSERVABILITY_QUOTA_POLICIES_PATH);
}

export function readObservabilityThresholdAlerts() {
  return readJson(OBSERVABILITY_THRESHOLD_ALERTS_PATH);
}

export function readPublicApiTaxonomy() {
  return readJson(PUBLIC_API_TAXONOMY_PATH);
}

export function collectObservabilityHardLimitEnforcementViolations(
  contract = readObservabilityHardLimitEnforcement(),
  dependencies = {
    usageConsumption: readObservabilityUsageConsumption(),
    quotaPolicies: readObservabilityQuotaPolicies(),
    thresholdAlerts: readObservabilityThresholdAlerts(),
    publicApiTaxonomy: readPublicApiTaxonomy()
  }
) {
  const violations = [];
  const { usageConsumption, quotaPolicies, thresholdAlerts, publicApiTaxonomy } = dependencies;

  if (typeof contract?.version !== 'string' || contract.version.length === 0) {
    violations.push('Observability hard-limit enforcement contract version must be a non-empty string.');
  }

  if (contract?.source_usage_contract !== usageConsumption?.version) {
    violations.push('Observability hard-limit enforcement source_usage_contract must align with observability-usage-consumption.json version.');
  }

  if (contract?.source_quota_policy_contract !== quotaPolicies?.version) {
    violations.push('Observability hard-limit enforcement source_quota_policy_contract must align with observability-quota-policies.json version.');
  }

  if (contract?.source_threshold_alert_contract !== thresholdAlerts?.version) {
    violations.push('Observability hard-limit enforcement source_threshold_alert_contract must align with observability-threshold-alerts.json version.');
  }

  if (contract?.source_public_api_contract !== publicApiTaxonomy?.version) {
    violations.push('Observability hard-limit enforcement source_public_api_contract must align with public-api-taxonomy.json version.');
  }

  const dimensionIds = (contract?.dimensions ?? []).map((entry) => entry?.id).filter(Boolean);
  for (const id of REQUIRED_DIMENSIONS) {
    if (!dimensionIds.includes(id)) {
      violations.push(`Missing hard-limit dimension ${id}.`);
    }
  }
  if (new Set(dimensionIds).size !== dimensionIds.length) {
    violations.push('Hard-limit dimensions must be unique.');
  }

  const surfaceMappings = new Map((contract?.surface_mappings ?? []).map((entry) => [entry?.id, entry]));
  for (const id of REQUIRED_SURFACES) {
    if (!surfaceMappings.has(id)) {
      violations.push(`Missing hard-limit surface mapping ${id}.`);
    }
  }

  const errorFields = new Set(contract?.error_contract?.required_fields ?? []);
  for (const field of REQUIRED_ERROR_FIELDS) {
    if (!errorFields.has(field)) {
      violations.push(`Hard-limit error contract must require ${field}.`);
    }
  }
  if (contract?.error_contract?.error_code !== 'QUOTA_HARD_LIMIT_REACHED') {
    violations.push('Hard-limit error contract must use error_code QUOTA_HARD_LIMIT_REACHED.');
  }

  const auditFields = new Set(contract?.audit_contract?.required_fields ?? []);
  for (const field of REQUIRED_AUDIT_FIELDS) {
    if (!auditFields.has(field)) {
      violations.push(`Hard-limit audit contract must require ${field}.`);
    }
  }

  if (contract?.enforcement_policy?.fail_closed_on_missing_evidence !== true) {
    violations.push('Hard-limit enforcement policy must fail closed on missing evidence.');
  }

  const boundaries = new Set(contract?.boundaries ?? []);
  for (const boundary of REQUIRED_BOUNDARIES) {
    if (!boundaries.has(boundary)) {
      violations.push(`Hard-limit contract must document downstream boundary ${boundary}.`);
    }
  }

  const nonGoals = (contract?.non_goals ?? []).join(' ').toLowerCase();
  if (!nonGoals.includes('t05') || !nonGoals.includes('t06')) {
    violations.push('Hard-limit contract must preserve explicit non-goals for T05 and T06.');
  }

  return violations;
}
