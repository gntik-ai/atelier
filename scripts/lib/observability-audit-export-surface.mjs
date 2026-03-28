import { readJson } from './quality-gates.mjs';

export const OBSERVABILITY_AUDIT_EXPORT_SURFACE_PATH = 'services/internal-contracts/src/observability-audit-export-surface.json';
export const OBSERVABILITY_AUDIT_PIPELINE_PATH = 'services/internal-contracts/src/observability-audit-pipeline.json';
export const OBSERVABILITY_AUDIT_EVENT_SCHEMA_PATH = 'services/internal-contracts/src/observability-audit-event-schema.json';
export const OBSERVABILITY_AUDIT_QUERY_SURFACE_PATH = 'services/internal-contracts/src/observability-audit-query-surface.json';
export const AUTHORIZATION_MODEL_PATH = 'services/internal-contracts/src/authorization-model.json';
export const PUBLIC_ROUTE_CATALOG_PATH = 'services/internal-contracts/src/public-route-catalog.json';
export const PUBLIC_API_TAXONOMY_PATH = 'services/internal-contracts/src/public-api-taxonomy.json';
export const ARCHITECTURE_AUDIT_EXPORT_SURFACE_DOC_PATH = 'docs/reference/architecture/observability-audit-export-surface.md';
export const ARCHITECTURE_README_PATH = 'docs/reference/architecture/README.md';
export const OBS_TASK_DOC_PATH = 'docs/tasks/us-obs-02.md';
export const PACKAGE_JSON_PATH = 'package.json';

const REQUIRED_SCOPE_IDS = ['tenant', 'workspace'];
const REQUIRED_ROUTE_IDS = ['exportTenantAuditRecords', 'exportWorkspaceAuditRecords'];
const REQUIRED_FORMAT_IDS = ['jsonl', 'csv'];
const REQUIRED_BOUNDARIES = [
  'correlation_execution_is_defined_in_us_obs_02_t05',
  'end_to_end_traceability_verification_is_defined_in_us_obs_02_t06',
  'durable_export_distribution_is_out_of_scope_for_us_obs_02_t04'
];
const REQUIRED_ITEM_FIELDS = [
  'eventId',
  'eventTimestamp',
  'actor',
  'scope',
  'resource',
  'action',
  'result',
  'correlationId',
  'origin',
  'detail',
  'maskingApplied',
  'maskedFieldRefs',
  'sensitivityCategories'
];
const REQUIRED_EXPORT_ACTIONS = ['tenant.audit.export', 'workspace.audit.export'];

export function readObservabilityAuditExportSurface() {
  return readJson(OBSERVABILITY_AUDIT_EXPORT_SURFACE_PATH);
}

export function readObservabilityAuditPipeline() {
  return readJson(OBSERVABILITY_AUDIT_PIPELINE_PATH);
}

export function readObservabilityAuditEventSchema() {
  return readJson(OBSERVABILITY_AUDIT_EVENT_SCHEMA_PATH);
}

export function readObservabilityAuditQuerySurface() {
  return readJson(OBSERVABILITY_AUDIT_QUERY_SURFACE_PATH);
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

function flattenActions(resourceActions = {}) {
  return new Set(Object.values(resourceActions).flatMap((actions) => actions ?? []));
}

export function collectAuditExportSurfaceViolations(
  contract = readObservabilityAuditExportSurface(),
  dependencies = {
    auditPipeline: readObservabilityAuditPipeline(),
    auditEventSchema: readObservabilityAuditEventSchema(),
    auditQuerySurface: readObservabilityAuditQuerySurface(),
    authorizationModel: readAuthorizationModel(),
    routeCatalog: readPublicRouteCatalog(),
    publicApiTaxonomy: readPublicApiTaxonomy()
  }
) {
  const violations = [];
  const { auditPipeline, auditEventSchema, auditQuerySurface, authorizationModel, routeCatalog, publicApiTaxonomy } = dependencies;

  if (typeof contract?.version !== 'string' || contract.version.length === 0) {
    violations.push('Observability audit export surface contract version must be a non-empty string.');
  }

  if (contract?.source_audit_pipeline_contract !== auditPipeline?.version) {
    violations.push('Observability audit export surface source_audit_pipeline_contract must align with observability-audit-pipeline.json version.');
  }

  if (contract?.source_audit_event_schema_contract !== auditEventSchema?.version) {
    violations.push('Observability audit export surface source_audit_event_schema_contract must align with observability-audit-event-schema.json version.');
  }

  if (contract?.source_audit_query_surface_contract !== auditQuerySurface?.version) {
    violations.push('Observability audit export surface source_audit_query_surface_contract must align with observability-audit-query-surface.json version.');
  }

  if (contract?.source_authorization_contract !== authorizationModel?.version) {
    violations.push('Observability audit export surface source_authorization_contract must align with authorization-model.json version.');
  }

  if (contract?.source_public_api_contract !== publicApiTaxonomy?.version) {
    violations.push('Observability audit export surface source_public_api_contract must align with public-api-taxonomy.json version.');
  }

  const knownActions = flattenActions(authorizationModel?.resource_actions ?? {});
  const scopeEntries = contract?.supported_export_scopes ?? [];
  const scopeById = new Map(scopeEntries.map((scope) => [scope.id, scope]));
  const routeIds = new Set((routeCatalog?.routes ?? []).map((route) => route.operationId));
  const queryFilterIds = new Set((auditQuerySurface?.filter_dimensions ?? []).map((filter) => filter.id));
  const formatEntries = contract?.supported_formats ?? [];
  const formatById = new Map(formatEntries.map((format) => [format.id, format]));
  const maskingProfiles = contract?.masking_profiles ?? [];
  const maskingProfileById = new Map(maskingProfiles.map((profile) => [profile.id, profile]));
  const protectedFields = new Set((auditPipeline?.masking_policy?.forbidden_exposed_fields ?? []).map((field) => String(field)));
  const sensitiveFieldCoverage = new Set((contract?.sensitive_field_rules ?? []).flatMap((rule) => rule.field_refs ?? []).map((field) => String(field)));
  const responseFields = new Set(contract?.response_contract?.required_fields ?? []);
  const itemFields = new Set(contract?.response_contract?.item_projection?.required_fields ?? []);

  for (const actionId of REQUIRED_EXPORT_ACTIONS) {
    if (!knownActions.has(actionId)) {
      violations.push(`Observability audit export surface requires authorization action ${actionId}.`);
    }
  }

  for (const scopeId of REQUIRED_SCOPE_IDS) {
    if (!scopeById.has(scopeId)) {
      violations.push(`Observability audit export surface must declare supported export scope ${scopeId}.`);
    }
  }

  for (const routeId of REQUIRED_ROUTE_IDS) {
    if (!routeIds.has(routeId)) {
      violations.push(`Observability audit export surface requires public route catalog operation ${routeId}.`);
    }
  }

  for (const scope of scopeEntries) {
    if (!scope.route_operation_id || !routeIds.has(scope.route_operation_id)) {
      violations.push(`Observability audit export scope ${scope.id} must reference a known public route operation id.`);
    }

    if (!knownActions.has(scope.required_permission)) {
      violations.push(`Observability audit export scope ${scope.id} must reference known authorization action ${scope.required_permission}.`);
    }

    if (!formatById.has(scope.default_format)) {
      violations.push(`Observability audit export scope ${scope.id} must reference known default format ${scope.default_format}.`);
    }
  }

  for (const formatId of REQUIRED_FORMAT_IDS) {
    const format = formatById.get(formatId);
    if (!format) {
      violations.push(`Observability audit export surface must define format ${formatId}.`);
      continue;
    }

    if (!format.media_type || typeof format.media_type !== 'string') {
      violations.push(`Observability audit export format ${formatId} must declare media_type.`);
    }
  }

  const defaultProfile = maskingProfiles.find((profile) => profile.is_default === true);
  if (!defaultProfile) {
    violations.push('Observability audit export surface must define one default masking profile.');
  }

  for (const profile of maskingProfiles) {
    for (const category of profile.protected_field_categories ?? []) {
      if (!(contract?.sensitive_field_rules ?? []).some((rule) => rule.id === category)) {
        violations.push(`Observability audit export masking profile ${profile.id} references unknown sensitive-field category ${category}.`);
      }
    }
  }

  const filterReuseIds = new Set(contract?.request_contract?.filter_reuse_ids ?? []);
  for (const filterId of filterReuseIds) {
    if (!queryFilterIds.has(filterId)) {
      violations.push(`Observability audit export surface filter_reuse_ids references unknown T03 filter ${filterId}.`);
    }
  }

  for (const requiredField of ['format']) {
    if (!(contract?.request_contract?.required_fields ?? []).includes(requiredField)) {
      violations.push(`Observability audit export request_contract must require field ${requiredField}.`);
    }
  }

  for (const protectedField of protectedFields) {
    if (!sensitiveFieldCoverage.has(protectedField)) {
      violations.push(`Observability audit export surface must cover protected field ${protectedField} from the audit pipeline masking policy.`);
    }
  }

  for (const field of ['exportId', 'queryScope', 'format', 'maskingProfileId', 'correlationId', 'generatedAt', 'appliedFilters', 'itemCount', 'maskedItemCount', 'items']) {
    if (!responseFields.has(field)) {
      violations.push(`Observability audit export response_contract must require field ${field}.`);
    }
  }

  for (const field of REQUIRED_ITEM_FIELDS) {
    if (!itemFields.has(field)) {
      violations.push(`Observability audit export item projection must require field ${field}.`);
    }
  }

  if (!(auditEventSchema?.required_top_level_fields ?? []).includes('detail')) {
    violations.push('Observability audit event schema must require detail for the audit export surface to remain valid.');
  }

  const defaultFormat = contract?.request_contract?.default_format;
  if (!formatById.has(defaultFormat)) {
    violations.push('Observability audit export request_contract default_format must reference a known supported format.');
  }

  const defaultProfileId = contract?.console_surface?.default_profile_id;
  if (!maskingProfileById.has(defaultProfileId)) {
    violations.push('Observability audit export console_surface default_profile_id must reference a known masking profile.');
  }

  for (const scopeId of contract?.console_surface?.entry_scopes ?? []) {
    if (!scopeById.has(scopeId)) {
      violations.push(`Observability audit export console_surface references unknown scope ${scopeId}.`);
    }
  }

  for (const formatId of contract?.console_surface?.supported_format_ids ?? []) {
    if (!formatById.has(formatId)) {
      violations.push(`Observability audit export console_surface references unknown format ${formatId}.`);
    }
  }

  const boundaries = new Set(contract?.governance?.future_work_boundaries ?? []);
  for (const boundary of REQUIRED_BOUNDARIES) {
    if (!boundaries.has(boundary)) {
      violations.push(`Observability audit export surface governance must preserve boundary ${boundary}.`);
    }
  }

  return violations;
}
