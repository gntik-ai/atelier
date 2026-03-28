import { readJson } from './quality-gates.mjs';

export const OBSERVABILITY_THRESHOLD_ALERTS_PATH = 'services/internal-contracts/src/observability-threshold-alerts.json';
export const OBSERVABILITY_USAGE_CONSUMPTION_PATH = 'services/internal-contracts/src/observability-usage-consumption.json';
export const OBSERVABILITY_QUOTA_POLICIES_PATH = 'services/internal-contracts/src/observability-quota-policies.json';
export const OBSERVABILITY_AUDIT_EVENT_SCHEMA_PATH = 'services/internal-contracts/src/observability-audit-event-schema.json';
export const AUTHORIZATION_MODEL_PATH = 'services/internal-contracts/src/authorization-model.json';
export const PUBLIC_API_TAXONOMY_PATH = 'services/internal-contracts/src/public-api-taxonomy.json';

const REQUIRED_EVENT_TYPES = [
  'quota.threshold.warning_reached',
  'quota.threshold.soft_limit_exceeded',
  'quota.threshold.hard_limit_reached',
  'quota.threshold.warning_recovered',
  'quota.threshold.soft_limit_recovered',
  'quota.threshold.hard_limit_reached',
  'quota.threshold.hard_limit_recovered',
  'quota.threshold.alert_suppressed'
];
const REQUIRED_SUPPRESSION_CAUSES = ['evidence_degraded', 'evidence_unavailable'];
const REQUIRED_BOUNDARIES = [
  'hard_limit_blocking_is_defined_in_us_obs_03_t04',
  'console_usage_projection_is_defined_in_us_obs_03_t05',
  'cross_module_consumption_and_enforcement_tests_are_defined_in_us_obs_03_t06'
];
const REQUIRED_FIELDS = [
  'eventType',
  'tenantId',
  'workspaceId',
  'dimension',
  'evidenceFreshness',
  'evaluationTimestamp',
  'snapshotTimestamp',
  'correlationId',
  'actor',
  'action',
  'resource'
];

export function readObservabilityThresholdAlerts() {
  return readJson(OBSERVABILITY_THRESHOLD_ALERTS_PATH);
}

export function readObservabilityUsageConsumption() {
  return readJson(OBSERVABILITY_USAGE_CONSUMPTION_PATH);
}

export function readObservabilityQuotaPolicies() {
  return readJson(OBSERVABILITY_QUOTA_POLICIES_PATH);
}

export function readObservabilityAuditEventSchema() {
  return readJson(OBSERVABILITY_AUDIT_EVENT_SCHEMA_PATH);
}

export function readAuthorizationModel() {
  return readJson(AUTHORIZATION_MODEL_PATH);
}

export function readPublicApiTaxonomy() {
  return readJson(PUBLIC_API_TAXONOMY_PATH);
}

function indexBy(items = [], keyField = 'id') {
  return new Map(items.map((item) => [item?.[keyField], item]));
}

export function collectObservabilityThresholdAlertViolations(
  contract = readObservabilityThresholdAlerts(),
  dependencies = {
    usageConsumption: readObservabilityUsageConsumption(),
    quotaPolicies: readObservabilityQuotaPolicies(),
    auditEventSchema: readObservabilityAuditEventSchema(),
    authorizationModel: readAuthorizationModel(),
    publicApiTaxonomy: readPublicApiTaxonomy()
  }
) {
  const violations = [];
  const { usageConsumption, quotaPolicies, auditEventSchema, authorizationModel, publicApiTaxonomy } = dependencies;

  if (typeof contract?.version !== 'string' || contract.version.length === 0) {
    violations.push('Observability threshold alerts contract version must be a non-empty string.');
  }

  if (contract?.source_usage_contract !== usageConsumption?.version) {
    violations.push('Observability threshold alerts source_usage_contract must align with observability-usage-consumption.json version.');
  }

  if (contract?.source_quota_policy_contract !== quotaPolicies?.version) {
    violations.push('Observability threshold alerts source_quota_policy_contract must align with observability-quota-policies.json version.');
  }

  if (contract?.source_audit_event_schema_contract !== auditEventSchema?.version) {
    violations.push('Observability threshold alerts source_audit_event_schema_contract must align with observability-audit-event-schema.json version.');
  }

  if (contract?.source_authorization_contract !== authorizationModel?.version) {
    violations.push('Observability threshold alerts source_authorization_contract must align with authorization-model.json version.');
  }

  if (contract?.source_public_api_contract !== publicApiTaxonomy?.version) {
    violations.push('Observability threshold alerts source_public_api_contract must align with public-api-taxonomy.json version.');
  }

  const eventTypes = indexBy(contract?.event_types ?? []);
  for (const id of REQUIRED_EVENT_TYPES) {
    const eventType = eventTypes.get(id);
    if (!eventType) {
      violations.push(`Missing threshold alert event type ${id}.`);
      continue;
    }

    if (typeof eventType.trigger_condition !== 'string' || eventType.trigger_condition.trim() === '') {
      violations.push(`Threshold alert event type ${id} must define a non-empty trigger_condition.`);
    }
  }

  const freshnessStates = new Set((usageConsumption?.freshness_states ?? []).map((state) => state.id));
  const suppressionCauses = indexBy(contract?.suppression_causes ?? []);
  for (const id of REQUIRED_SUPPRESSION_CAUSES) {
    const cause = suppressionCauses.get(id);
    if (!cause) {
      violations.push(`Missing threshold alert suppression cause ${id}.`);
      continue;
    }

    if (!freshnessStates.has(cause.freshness_state)) {
      violations.push(`Suppression cause ${id} must map to a known usage freshness state.`);
    }
  }

  const kafka = contract?.kafka ?? {};
  for (const field of ['topicName', 'partitionKey', 'schemaSubject']) {
    if (typeof kafka[field] !== 'string' || kafka[field].length === 0) {
      violations.push(`Threshold alert Kafka config must define ${field}.`);
    }
  }

  const envelopeFields = new Set(contract?.event_envelope?.required_fields ?? []);
  for (const field of REQUIRED_FIELDS) {
    if (!envelopeFields.has(field)) {
      violations.push(`Threshold alert event envelope must require ${field}.`);
    }
  }

  const correlationReferences = new Set(contract?.correlation_strategy?.references ?? []);
  if (!correlationReferences.has('quota_posture_snapshot') || !correlationReferences.has('usage_snapshot')) {
    violations.push('Threshold alert correlation strategy must reference both quota_posture_snapshot and usage_snapshot.');
  }

  const boundaries = new Set(contract?.boundaries ?? []);
  for (const boundary of REQUIRED_BOUNDARIES) {
    if (!boundaries.has(boundary)) {
      violations.push(`Threshold alert contract must document downstream boundary ${boundary}.`);
    }
  }

  const nonGoals = (contract?.non_goals ?? []).join(' ').toLowerCase();
  if (nonGoals.includes('block resource creation') === false) {
    violations.push('Threshold alert contract must explicitly preserve the no-blocking boundary.');
  }

  const auditSubsystems = new Set(auditEventSchema?.resource?.supported_subsystem_ids ?? []);
  if (!auditSubsystems.has(contract?.event_envelope?.audit_vocabulary_alignment?.resource_subsystem_id)) {
    violations.push('Threshold alert audit subsystem must remain aligned with the canonical audit event schema.');
  }

  const taxonomyResources = new Set((publicApiTaxonomy?.resource_taxonomy ?? []).map((entry) => entry.resource_type));
  if (!taxonomyResources.has('tenant_quota_posture') || !taxonomyResources.has('workspace_quota_posture')) {
    violations.push('Threshold alert contract depends on quota posture resource taxonomy entries remaining available.');
  }

  return violations;
}
