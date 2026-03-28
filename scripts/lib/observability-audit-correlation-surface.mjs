import { readJson } from './quality-gates.mjs';

export const OBSERVABILITY_AUDIT_CORRELATION_SURFACE_PATH = 'services/internal-contracts/src/observability-audit-correlation-surface.json';
export const OBSERVABILITY_AUDIT_EVENT_SCHEMA_PATH = 'services/internal-contracts/src/observability-audit-event-schema.json';
export const OBSERVABILITY_AUDIT_QUERY_SURFACE_PATH = 'services/internal-contracts/src/observability-audit-query-surface.json';
export const OBSERVABILITY_AUDIT_EXPORT_SURFACE_PATH = 'services/internal-contracts/src/observability-audit-export-surface.json';
export const AUTHORIZATION_MODEL_PATH = 'services/internal-contracts/src/authorization-model.json';
export const INTERNAL_SERVICE_MAP_PATH = 'services/internal-contracts/src/internal-service-map.json';
export const PUBLIC_ROUTE_CATALOG_PATH = 'services/internal-contracts/src/public-route-catalog.json';
export const PUBLIC_API_TAXONOMY_PATH = 'services/internal-contracts/src/public-api-taxonomy.json';

const REQUIRED_SCOPE_IDS = ['tenant', 'workspace'];
const REQUIRED_STATUS_IDS = ['complete', 'partial', 'broken', 'not_found'];
const REQUIRED_PHASE_IDS = ['console_initiation', 'control_plane_execution', 'downstream_system_effect', 'audit_persistence'];
const REQUIRED_ROUTE_IDS = ['getTenantAuditCorrelation', 'getWorkspaceAuditCorrelation'];
const REQUIRED_PUBLIC_RESOURCE_TYPES = ['tenant_audit_correlation', 'workspace_audit_correlation'];
const REQUIRED_BOUNDARIES = [
  'end_to_end_traceability_verification_is_defined_in_us_obs_02_t06',
  'durable_case_management_is_out_of_scope_for_us_obs_02_t05'
];

export function readObservabilityAuditCorrelationSurface() {
  return readJson(OBSERVABILITY_AUDIT_CORRELATION_SURFACE_PATH);
}

export function readObservabilityAuditEventSchema() {
  return readJson(OBSERVABILITY_AUDIT_EVENT_SCHEMA_PATH);
}

export function readObservabilityAuditQuerySurface() {
  return readJson(OBSERVABILITY_AUDIT_QUERY_SURFACE_PATH);
}

export function readObservabilityAuditExportSurface() {
  return readJson(OBSERVABILITY_AUDIT_EXPORT_SURFACE_PATH);
}

export function readAuthorizationModel() {
  return readJson(AUTHORIZATION_MODEL_PATH);
}

export function readInternalServiceMap() {
  return readJson(INTERNAL_SERVICE_MAP_PATH);
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

export function collectAuditCorrelationSurfaceViolations(
  contract = readObservabilityAuditCorrelationSurface(),
  dependencies = {
    auditEventSchema: readObservabilityAuditEventSchema(),
    auditQuerySurface: readObservabilityAuditQuerySurface(),
    auditExportSurface: readObservabilityAuditExportSurface(),
    authorizationModel: readAuthorizationModel(),
    internalServiceMap: readInternalServiceMap(),
    routeCatalog: readPublicRouteCatalog(),
    publicApiTaxonomy: readPublicApiTaxonomy()
  }
) {
  const violations = [];
  const {
    auditEventSchema,
    auditQuerySurface,
    auditExportSurface,
    authorizationModel,
    internalServiceMap,
    routeCatalog,
    publicApiTaxonomy
  } = dependencies;

  if (typeof contract?.version !== 'string' || contract.version.length === 0) {
    violations.push('Observability audit correlation surface version must be a non-empty string.');
  }

  if (contract?.source_audit_event_schema_contract !== auditEventSchema?.version) {
    violations.push('Observability audit correlation surface source_audit_event_schema_contract must align with observability-audit-event-schema.json version.');
  }

  if (contract?.source_audit_query_surface_contract !== auditQuerySurface?.version) {
    violations.push('Observability audit correlation surface source_audit_query_surface_contract must align with observability-audit-query-surface.json version.');
  }

  if (contract?.source_audit_export_surface_contract !== auditExportSurface?.version) {
    violations.push('Observability audit correlation surface source_audit_export_surface_contract must align with observability-audit-export-surface.json version.');
  }

  if (contract?.source_authorization_contract !== authorizationModel?.version) {
    violations.push('Observability audit correlation surface source_authorization_contract must align with authorization-model.json version.');
  }

  if (contract?.source_internal_service_map_contract !== internalServiceMap?.version) {
    violations.push('Observability audit correlation surface source_internal_service_map_contract must align with internal-service-map.json version.');
  }

  if (contract?.source_public_api_contract !== publicApiTaxonomy?.version) {
    violations.push('Observability audit correlation surface source_public_api_contract must align with public-api-taxonomy.json version.');
  }

  const scopeEntries = contract?.supported_trace_scopes ?? [];
  const scopeById = new Map(scopeEntries.map((scope) => [scope.id, scope]));
  const statusEntries = contract?.trace_statuses ?? [];
  const statusById = new Map(statusEntries.map((status) => [status.id, status]));
  const phaseEntries = contract?.timeline_phases ?? [];
  const phaseById = new Map(phaseEntries.map((phase) => [phase.id, phase]));
  const routeIds = new Set((routeCatalog?.routes ?? []).map((route) => route.operationId));
  const knownPermissions = collectKnownPermissions(authorizationModel);
  const eventOriginSurfaces = new Set(auditEventSchema?.origin?.origin_surfaces ?? []);
  const publicResourceTypes = new Set((publicApiTaxonomy?.resource_taxonomy ?? []).map((entry) => entry.resource_type));
  const internalContracts = internalServiceMap?.contracts ?? {};

  for (const scopeId of REQUIRED_SCOPE_IDS) {
    if (!scopeById.has(scopeId)) {
      violations.push(`Observability audit correlation surface must declare supported trace scope ${scopeId}.`);
    }
  }

  for (const routeId of REQUIRED_ROUTE_IDS) {
    if (!routeIds.has(routeId)) {
      violations.push(`Observability audit correlation surface requires public route catalog operation ${routeId}.`);
    }
  }

  for (const resourceType of REQUIRED_PUBLIC_RESOURCE_TYPES) {
    if (!publicResourceTypes.has(resourceType)) {
      violations.push(`Observability audit correlation surface requires public API taxonomy resource type ${resourceType}.`);
    }
  }

  for (const scope of scopeEntries) {
    if (!scope.route_operation_id || !routeIds.has(scope.route_operation_id)) {
      violations.push(`Observability audit correlation scope ${scope.id} must reference a known public route operation id.`);
    }

    if (!knownPermissions.has(scope.required_permission)) {
      violations.push(`Observability audit correlation scope ${scope.id} must reference known authorization action ${scope.required_permission}.`);
    }

    if ((scope.required_context_fields ?? []).length === 0) {
      violations.push(`Observability audit correlation scope ${scope.id} must declare required_context_fields.`);
    }
  }

  for (const statusId of REQUIRED_STATUS_IDS) {
    if (!statusById.has(statusId)) {
      violations.push(`Observability audit correlation surface must define status ${statusId}.`);
    }
  }

  for (const phaseId of REQUIRED_PHASE_IDS) {
    if (!phaseById.has(phaseId)) {
      violations.push(`Observability audit correlation surface must define phase ${phaseId}.`);
      continue;
    }

    for (const originSurface of phaseById.get(phaseId)?.allowed_origin_surfaces ?? []) {
      if (!eventOriginSurfaces.has(originSurface)) {
        violations.push(`Observability audit correlation phase ${phaseId} references unknown audit origin surface ${originSurface}.`);
      }
    }
  }

  if (contract?.request_contract?.default_max_items > contract?.request_contract?.max_items) {
    violations.push('Observability audit correlation request_contract default_max_items cannot exceed max_items.');
  }

  const responseFields = new Set(contract?.response_contract?.required_fields ?? []);
  for (const field of ['correlationId', 'queryScope', 'traceStatus', 'timeline', 'auditRecords', 'evidencePointers', 'missingLinks', 'consoleSummary']) {
    if (!responseFields.has(field)) {
      violations.push(`Observability audit correlation response_contract must require field ${field}.`);
    }
  }

  const timelineFields = new Set(contract?.response_contract?.timeline_projection?.required_fields ?? []);
  for (const field of ['nodeId', 'phase', 'eventTimestamp', 'originSurface', 'subsystemId', 'resourceType', 'actionId', 'outcome']) {
    if (!timelineFields.has(field)) {
      violations.push(`Observability audit correlation timeline projection must require field ${field}.`);
    }
  }

  const linkedRecordFields = new Set(contract?.response_contract?.linked_audit_record_projection?.required_fields ?? []);
  for (const field of contract?.masking_compatibility?.required_record_fields ?? []) {
    if (!linkedRecordFields.has(field)) {
      violations.push(`Observability audit correlation linked audit record projection must require masking field ${field}.`);
    }
  }

  const exportProfiles = new Set((auditExportSurface?.masking_profiles ?? []).map((profile) => profile.id));
  if (!exportProfiles.has(contract?.masking_compatibility?.source_profile_id)) {
    violations.push('Observability audit correlation masking_compatibility.source_profile_id must reference a known audit export masking profile.');
  }

  if ((auditExportSurface?.sensitive_field_rules ?? []).length === 0) {
    violations.push('Observability audit correlation surface requires the audit export surface to define sensitive_field_rules for masking compatibility.');
  }

  const downstreamSources = contract?.downstream_trace_sources ?? [];
  for (const source of downstreamSources) {
    const internalContract = internalContracts[source.contract_id];
    if (!internalContract) {
      violations.push(`Observability audit correlation source ${source.id} must reference a known internal contract ${source.contract_id}.`);
      continue;
    }

    const requiredFields = new Set(internalContract.required_fields ?? []);
    for (const field of source.required_link_fields ?? []) {
      if (!requiredFields.has(field)) {
        violations.push(`Observability audit correlation source ${source.id} requires internal contract field ${field}.`);
      }
    }
  }

  const boundaries = new Set(contract?.governance?.future_work_boundaries ?? []);
  for (const boundary of REQUIRED_BOUNDARIES) {
    if (!boundaries.has(boundary)) {
      violations.push(`Observability audit correlation governance must preserve boundary ${boundary}.`);
    }
  }

  return violations;
}
