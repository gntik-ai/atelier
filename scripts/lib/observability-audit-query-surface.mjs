import { readJson } from './quality-gates.mjs';

export const OBSERVABILITY_AUDIT_QUERY_SURFACE_PATH = 'services/internal-contracts/src/observability-audit-query-surface.json';
export const OBSERVABILITY_AUDIT_PIPELINE_PATH = 'services/internal-contracts/src/observability-audit-pipeline.json';
export const OBSERVABILITY_AUDIT_EVENT_SCHEMA_PATH = 'services/internal-contracts/src/observability-audit-event-schema.json';
export const AUTHORIZATION_MODEL_PATH = 'services/internal-contracts/src/authorization-model.json';
export const PUBLIC_ROUTE_CATALOG_PATH = 'services/internal-contracts/src/public-route-catalog.json';
export const PUBLIC_API_TAXONOMY_PATH = 'services/internal-contracts/src/public-api-taxonomy.json';
export const ARCHITECTURE_AUDIT_QUERY_SURFACE_DOC_PATH = 'docs/reference/architecture/observability-audit-query-surface.md';
export const ARCHITECTURE_README_PATH = 'docs/reference/architecture/README.md';
export const OBS_TASK_DOC_PATH = 'docs/tasks/us-obs-02.md';
export const PACKAGE_JSON_PATH = 'package.json';

const REQUIRED_SCOPE_IDS = ['tenant', 'workspace'];
const REQUIRED_FILTER_IDS = [
  'occurred_after',
  'occurred_before',
  'subsystem',
  'action_category',
  'action_id',
  'outcome',
  'actor_type',
  'actor_id',
  'resource_type',
  'resource_id',
  'origin_surface',
  'correlation_id'
];
const REQUIRED_ROUTE_IDS = ['listTenantAuditRecords', 'listWorkspaceAuditRecords'];
const REQUIRED_BOUNDARIES = [
  'export_is_defined_in_us_obs_02_t04',
  'masking_is_defined_in_us_obs_02_t04',
  'correlation_execution_is_defined_in_us_obs_02_t05'
];
const REQUIRED_ITEM_FIELDS = ['eventId', 'eventTimestamp', 'actor', 'scope', 'resource', 'action', 'result', 'correlationId', 'origin'];

export function readObservabilityAuditQuerySurface() {
  return readJson(OBSERVABILITY_AUDIT_QUERY_SURFACE_PATH);
}

export function readObservabilityAuditPipeline() {
  return readJson(OBSERVABILITY_AUDIT_PIPELINE_PATH);
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

function flattenActions(resourceActions = {}) {
  return new Set(Object.values(resourceActions).flatMap((actions) => actions ?? []));
}

export function collectAuditQuerySurfaceViolations(
  contract = readObservabilityAuditQuerySurface(),
  dependencies = {
    auditPipeline: readObservabilityAuditPipeline(),
    auditEventSchema: readObservabilityAuditEventSchema(),
    authorizationModel: readAuthorizationModel(),
    routeCatalog: readPublicRouteCatalog(),
    publicApiTaxonomy: readPublicApiTaxonomy()
  }
) {
  const violations = [];
  const { auditPipeline, auditEventSchema, authorizationModel, routeCatalog, publicApiTaxonomy } = dependencies;

  if (typeof contract?.version !== 'string' || contract.version.length === 0) {
    violations.push('Observability audit query surface contract version must be a non-empty string.');
  }

  if (contract?.source_audit_pipeline_contract !== auditPipeline?.version) {
    violations.push('Observability audit query surface source_audit_pipeline_contract must align with observability-audit-pipeline.json version.');
  }

  if (contract?.source_audit_event_schema_contract !== auditEventSchema?.version) {
    violations.push('Observability audit query surface source_audit_event_schema_contract must align with observability-audit-event-schema.json version.');
  }

  if (contract?.source_authorization_contract !== authorizationModel?.version) {
    violations.push('Observability audit query surface source_authorization_contract must align with authorization-model.json version.');
  }

  if (contract?.source_public_api_contract !== publicApiTaxonomy?.version) {
    violations.push('Observability audit query surface source_public_api_contract must align with public-api-taxonomy.json version.');
  }

  const scopeEntries = contract?.supported_query_scopes ?? [];
  const scopeById = new Map(scopeEntries.map((scope) => [scope.id, scope]));
  const knownActions = flattenActions(authorizationModel?.resource_actions ?? {});
  const routeIds = new Set((routeCatalog?.routes ?? []).map((route) => route.operationId));
  const filterEntries = contract?.filter_dimensions ?? [];
  const filterById = new Map(filterEntries.map((filter) => [filter.id, filter]));
  const publicPagination = publicApiTaxonomy?.shared_http?.pagination ?? {};
  const schemaRequiredFields = new Set(auditEventSchema?.required_top_level_fields ?? []);

  for (const scopeId of REQUIRED_SCOPE_IDS) {
    if (!scopeById.has(scopeId)) {
      violations.push(`Observability audit query surface must declare supported query scope ${scopeId}.`);
    }
  }

  for (const routeId of REQUIRED_ROUTE_IDS) {
    if (!routeIds.has(routeId)) {
      violations.push(`Observability audit query surface requires public route catalog operation ${routeId}.`);
    }
  }

  for (const scope of scopeEntries) {
    if (!scope.route_operation_id || !routeIds.has(scope.route_operation_id)) {
      violations.push(`Observability audit query scope ${scope.id} must reference a known public route operation id.`);
    }

    if (!knownActions.has(scope.required_permission)) {
      violations.push(`Observability audit query scope ${scope.id} must reference known authorization action ${scope.required_permission}.`);
    }

    if ((scope.allowed_sort_keys ?? []).length === 0) {
      violations.push(`Observability audit query scope ${scope.id} must declare allowed_sort_keys.`);
    }

    if (!scope.allowed_sort_keys?.includes(scope.default_sort)) {
      violations.push(`Observability audit query scope ${scope.id} default_sort must be one of allowed_sort_keys.`);
    }
  }

  for (const filterId of REQUIRED_FILTER_IDS) {
    const filter = filterById.get(filterId);
    if (!filter) {
      violations.push(`Observability audit query surface must define filter ${filterId}.`);
      continue;
    }

    if (typeof filter.param !== 'string' || !filter.param.startsWith('filter[')) {
      violations.push(`Observability audit query filter ${filterId} must declare a filter[...] parameter name.`);
    }
  }

  if (contract?.pagination?.style !== 'cursor') {
    violations.push('Observability audit query surface pagination.style must be cursor.');
  }

  if (contract?.pagination?.limit_param !== publicPagination?.limit_param) {
    violations.push('Observability audit query surface pagination.limit_param must align with the shared public API pagination limit_param.');
  }

  if (contract?.pagination?.cursor_param !== publicPagination?.cursor_param) {
    violations.push('Observability audit query surface pagination.cursor_param must align with the shared public API pagination cursor_param.');
  }

  if (contract?.pagination?.sort_param !== publicPagination?.sort_param) {
    violations.push('Observability audit query surface pagination.sort_param must align with the shared public API pagination sort_param.');
  }

  if (contract?.pagination?.default_limit !== publicPagination?.default_limit) {
    violations.push('Observability audit query surface pagination.default_limit must align with the shared public API default limit.');
  }

  if (contract?.pagination?.max_limit !== publicPagination?.max_limit) {
    violations.push('Observability audit query surface pagination.max_limit must align with the shared public API max limit.');
  }

  const responseFields = new Set(contract?.response_contract?.required_fields ?? []);
  for (const field of ['items', 'page', 'queryScope', 'appliedFilters', 'availableFilters', 'consoleHints']) {
    if (!responseFields.has(field)) {
      violations.push(`Observability audit query surface response_contract must require field ${field}.`);
    }
  }

  const itemProjection = new Set(contract?.response_contract?.item_projection?.required_fields ?? []);
  for (const field of REQUIRED_ITEM_FIELDS) {
    if (!itemProjection.has(field)) {
      violations.push(`Observability audit query surface item projection must require field ${field}.`);
    }
  }

  if (!schemaRequiredFields.has('correlation_id')) {
    violations.push('Observability audit event schema must require correlation_id for the audit query surface to remain valid.');
  }

  const consoleScopes = contract?.console_surface?.entry_scopes ?? [];
  for (const scopeId of consoleScopes) {
    if (!scopeById.has(scopeId)) {
      violations.push(`Observability audit query surface console_surface references unknown scope ${scopeId}.`);
    }
  }

  const presetScopes = contract?.console_surface?.saved_presets ?? [];
  for (const preset of presetScopes) {
    for (const scopeId of preset.scope_ids ?? []) {
      if (!scopeById.has(scopeId)) {
        violations.push(`Observability audit query surface preset ${preset.id} references unknown scope ${scopeId}.`);
      }
    }

    for (const filterId of Object.keys(preset.filters ?? {})) {
      if (!filterById.has(filterId)) {
        violations.push(`Observability audit query surface preset ${preset.id} references unknown filter ${filterId}.`);
      }
    }
  }

  const boundaries = new Set(contract?.governance?.future_work_boundaries ?? []);
  for (const boundary of REQUIRED_BOUNDARIES) {
    if (!boundaries.has(boundary)) {
      violations.push(`Observability audit query surface governance must preserve boundary ${boundary}.`);
    }
  }

  const subsystemFilter = filterById.get('subsystem');
  const pipelineSubsystemIds = new Set((auditPipeline?.subsystem_roster ?? []).map((subsystem) => subsystem.id));
  for (const subsystemId of subsystemFilter?.allowed_values ?? []) {
    if (!pipelineSubsystemIds.has(subsystemId)) {
      violations.push(`Observability audit query surface subsystem filter references unknown audit subsystem ${subsystemId}.`);
    }
  }

  return violations;
}
