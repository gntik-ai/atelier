import { readYaml } from './quality-gates.mjs';
import {
  readAuthorizationModel,
  readInternalServiceMap,
  readObservabilityAuditCorrelationSurface,
  readObservabilityAuditEventSchema,
  readObservabilityAuditExportSurface,
  readObservabilityAuditPipeline,
  readObservabilityAuditQuerySurface
} from '../../services/internal-contracts/src/index.mjs';

export const AUDIT_TRACEABILITY_MATRIX_PATH = 'tests/reference/audit-traceability-matrix.yaml';
export const REQUIRED_TRACEABILITY_CATEGORY_IDS = Object.freeze([
  'full_chain_traceability',
  'masking_consistency',
  'tenant_isolation',
  'workspace_isolation',
  'permission_boundary',
  'trace_state_diagnostics'
]);
export const REQUIRED_RF_OBS_REFS = Object.freeze([
  'RF-OBS-004',
  'RF-OBS-005',
  'RF-OBS-006',
  'RF-OBS-007',
  'RF-OBS-008',
  'RF-OBS-018',
  'RF-OBS-020'
]);

const REQUIRED_SURFACE_KEYS = Object.freeze(['pipeline', 'schema', 'consultation', 'export', 'correlation']);

export function readAuditTraceabilityMatrix() {
  return readYaml(AUDIT_TRACEABILITY_MATRIX_PATH);
}

export function listTraceabilityScenarios(matrix = readAuditTraceabilityMatrix()) {
  return matrix?.verification_scenarios ?? [];
}

export function listScenariosByCategory(matrix = readAuditTraceabilityMatrix(), categoryId) {
  return listTraceabilityScenarios(matrix).filter((scenario) => scenario?.category === categoryId);
}

export function collectCoveredRequirementRefs(matrix = readAuditTraceabilityMatrix()) {
  return Array.from(new Set(listTraceabilityScenarios(matrix).flatMap((scenario) => scenario?.requirement_refs ?? []))).sort();
}

function collectKnownPermissions(authorizationModel = {}) {
  return new Set(Object.values(authorizationModel?.resource_actions ?? {}).flatMap((actions) => actions ?? []));
}

function collectDeclaredScopeIds(contract = {}, key) {
  return new Set((contract?.[key] ?? []).map((entry) => entry?.id).filter(Boolean));
}

function collectDeclaredSurfaceIds(matrix = {}) {
  return new Set(Object.values(matrix?.surface_contracts ?? {}).filter(Boolean));
}

function toSortedArray(values) {
  return Array.from(new Set(values ?? [])).sort();
}

function pushMissingEntries(violations, label, expectedEntries = [], actualEntries = []) {
  const actual = new Set(actualEntries ?? []);

  for (const entry of expectedEntries ?? []) {
    if (!actual.has(entry)) {
      violations.push(`${label} must include ${entry}.`);
    }
  }
}

export function collectMatrixAlignmentViolations(
  matrix = readAuditTraceabilityMatrix(),
  dependencies = {
    auditPipeline: readObservabilityAuditPipeline(),
    auditEventSchema: readObservabilityAuditEventSchema(),
    auditQuerySurface: readObservabilityAuditQuerySurface(),
    auditExportSurface: readObservabilityAuditExportSurface(),
    auditCorrelationSurface: readObservabilityAuditCorrelationSurface(),
    authorizationModel: readAuthorizationModel(),
    internalServiceMap: readInternalServiceMap()
  }
) {
  const violations = [];
  const {
    auditPipeline,
    auditEventSchema,
    auditQuerySurface,
    auditExportSurface,
    auditCorrelationSurface,
    authorizationModel,
    internalServiceMap
  } = dependencies;

  if (typeof matrix?.version !== 'string' && typeof matrix?.version !== 'number') {
    violations.push('Audit traceability matrix version must be a string or number.');
  }

  if (String(matrix?.version ?? '') !== String(auditCorrelationSurface?.version ?? '')) {
    violations.push('Audit traceability matrix version must align with observability-audit-correlation-surface.json version.');
  }

  const surfaceContracts = matrix?.surface_contracts ?? {};
  for (const key of REQUIRED_SURFACE_KEYS) {
    if (!surfaceContracts[key]) {
      violations.push(`Audit traceability matrix must declare surface_contracts.${key}.`);
    }
  }

  const declaredSurfaceIds = collectDeclaredSurfaceIds(matrix);
  const shared = matrix?.shared_expectations ?? {};
  const correlationStatuses = toSortedArray((auditCorrelationSurface?.trace_statuses ?? []).map((status) => status?.id));
  const queryScopes = toSortedArray(Array.from(collectDeclaredScopeIds(auditQuerySurface, 'supported_query_scopes')));
  const exportScopes = toSortedArray(Array.from(collectDeclaredScopeIds(auditExportSurface, 'supported_export_scopes')));
  const correlationScopes = toSortedArray(Array.from(collectDeclaredScopeIds(auditCorrelationSurface, 'supported_trace_scopes')));
  const pipelineSubsystems = toSortedArray((auditPipeline?.subsystem_roster ?? []).map((subsystem) => subsystem?.id));
  const maskingCategories = toSortedArray((auditExportSurface?.sensitive_field_rules ?? []).map((rule) => rule?.id));
  const knownPermissions = collectKnownPermissions(authorizationModel);
  const eventOriginSurfaces = new Set(auditEventSchema?.origin?.origin_surfaces ?? []);

  if (toSortedArray(shared.required_correlation_statuses).join('|') !== correlationStatuses.join('|')) {
    violations.push('Audit traceability matrix shared_expectations.required_correlation_statuses must align with the correlation surface statuses.');
  }

  if (toSortedArray(shared.required_audit_scopes).join('|') !== queryScopes.join('|')) {
    violations.push('Audit traceability matrix shared_expectations.required_audit_scopes must align with the audit query scope ids.');
  }

  if (toSortedArray(shared.required_audit_scopes).join('|') !== exportScopes.join('|')) {
    violations.push('Audit traceability matrix shared_expectations.required_audit_scopes must align with the audit export scope ids.');
  }

  if (toSortedArray(shared.required_audit_scopes).join('|') !== correlationScopes.join('|')) {
    violations.push('Audit traceability matrix shared_expectations.required_audit_scopes must align with the audit correlation scope ids.');
  }

  if (toSortedArray(shared.required_subsystems).join('|') !== pipelineSubsystems.join('|')) {
    violations.push('Audit traceability matrix shared_expectations.required_subsystems must align with the audit pipeline subsystem roster.');
  }

  if (toSortedArray(shared.required_masking_categories).join('|') !== maskingCategories.join('|')) {
    violations.push('Audit traceability matrix shared_expectations.required_masking_categories must align with the audit export sensitive field categories.');
  }

  pushMissingEntries(
    violations,
    'Audit traceability matrix shared_expectations.required_audit_permissions',
    shared.required_audit_permissions,
    Array.from(knownPermissions)
  );

  const sourceContracts = new Set(Object.keys(internalServiceMap?.contracts ?? {}));
  for (const source of auditCorrelationSurface?.downstream_trace_sources ?? []) {
    if (!sourceContracts.has(source.contract_id)) {
      violations.push(`Audit traceability dependencies must expose internal service-map contract ${source.contract_id}.`);
    }
  }

  for (const phase of auditCorrelationSurface?.timeline_phases ?? []) {
    for (const originSurface of phase?.allowed_origin_surfaces ?? []) {
      if (!eventOriginSurfaces.has(originSurface)) {
        violations.push(`Audit traceability dependencies reference unknown audit origin surface ${originSurface}.`);
      }
    }
  }

  const scenarios = listTraceabilityScenarios(matrix);
  if (scenarios.length === 0) {
    violations.push('Audit traceability matrix must declare verification_scenarios.');
  }

  const seenScenarioIds = new Set();
  const coveredCategories = new Set();
  for (const scenario of scenarios) {
    if (!scenario?.id) {
      violations.push('Audit traceability scenarios must declare id.');
      continue;
    }

    if (seenScenarioIds.has(scenario.id)) {
      violations.push(`Audit traceability scenario id ${scenario.id} must be unique.`);
    }
    seenScenarioIds.add(scenario.id);

    if (!REQUIRED_TRACEABILITY_CATEGORY_IDS.includes(scenario.category)) {
      violations.push(`Audit traceability scenario ${scenario.id} must use a known category.`);
    } else {
      coveredCategories.add(scenario.category);
    }

    if ((scenario.preconditions ?? []).length === 0) {
      violations.push(`Audit traceability scenario ${scenario.id} must declare preconditions.`);
    }

    if ((scenario.actions ?? []).length === 0) {
      violations.push(`Audit traceability scenario ${scenario.id} must declare actions.`);
    }

    if ((scenario.expected_outcomes ?? []).length === 0) {
      violations.push(`Audit traceability scenario ${scenario.id} must declare expected_outcomes.`);
    }

    if ((scenario.requirement_refs ?? []).length === 0) {
      violations.push(`Audit traceability scenario ${scenario.id} must declare requirement_refs.`);
    }

    for (const requirementRef of scenario.requirement_refs ?? []) {
      if (!REQUIRED_RF_OBS_REFS.includes(requirementRef)) {
        violations.push(`Audit traceability scenario ${scenario.id} references unknown requirement ${requirementRef}.`);
      }
    }

    if ((scenario.contract_surfaces ?? []).length === 0) {
      violations.push(`Audit traceability scenario ${scenario.id} must declare contract_surfaces.`);
    }

    for (const surfaceId of scenario.contract_surfaces ?? []) {
      if (!declaredSurfaceIds.has(surfaceId)) {
        violations.push(`Audit traceability scenario ${scenario.id} references unknown contract surface ${surfaceId}.`);
      }
    }
  }

  for (const categoryId of REQUIRED_TRACEABILITY_CATEGORY_IDS) {
    if (!coveredCategories.has(categoryId)) {
      violations.push(`Audit traceability matrix must cover category ${categoryId}.`);
    }
  }

  const coveredRequirements = new Set(collectCoveredRequirementRefs(matrix));
  for (const requirementRef of REQUIRED_RF_OBS_REFS) {
    if (!coveredRequirements.has(requirementRef)) {
      violations.push(`Audit traceability matrix must cover requirement ${requirementRef}.`);
    }
  }

  return violations;
}
