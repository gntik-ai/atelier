import {
  getAuditCorrelationConsoleSurface,
  getAuditCorrelationMaskingCompatibility,
  getAuditCorrelationRequestContract,
  getAuditCorrelationScope,
  getPublicRoute,
  listAuditCorrelationScopes,
  listAuditCorrelationStatuses,
  listAuditCorrelationTimelinePhases
} from '../../../services/internal-contracts/src/index.mjs';
import { applyAuditExportMasking } from './observability-audit-export.mjs';

export const AUDIT_CORRELATION_ERROR_CODES = Object.freeze({
  SCOPE_VIOLATION: 'AUDIT_CORRELATION_SCOPE_VIOLATION',
  MISSING_CORRELATION_ID: 'AUDIT_CORRELATION_MISSING_CORRELATION_ID',
  LIMIT_EXCEEDED: 'AUDIT_CORRELATION_LIMIT_EXCEEDED'
});

function invariant(condition, message, code) {
  if (!condition) {
    const error = new Error(message);
    error.code = code;
    throw error;
  }
}

function normalizeBoolean(value, defaultValue) {
  return typeof value === 'boolean' ? value : defaultValue;
}

function findScope(scopeId) {
  const scope = getAuditCorrelationScope(scopeId);
  invariant(Boolean(scope), `unknown audit correlation scope ${scopeId}.`, AUDIT_CORRELATION_ERROR_CODES.SCOPE_VIOLATION);
  return scope;
}

function assertScopeBinding(scope, context = {}, input = {}) {
  if (scope.id === 'tenant') {
    const tenantId = input.tenantId ?? context.routeTenantId ?? context.targetTenantId ?? context.tenantId;
    invariant(tenantId, 'tenantId is required for tenant audit correlation.', AUDIT_CORRELATION_ERROR_CODES.SCOPE_VIOLATION);

    if (context.tenantId && tenantId !== context.tenantId) {
      invariant(false, 'tenant audit correlation must stay within the caller tenant scope.', AUDIT_CORRELATION_ERROR_CODES.SCOPE_VIOLATION);
    }

    invariant(
      !(input.workspaceId ?? context.routeWorkspaceId ?? context.targetWorkspaceId),
      'tenant audit correlation does not allow workspace scope widening.',
      AUDIT_CORRELATION_ERROR_CODES.SCOPE_VIOLATION
    );

    return { tenantId, queryScope: 'tenant' };
  }

  const workspaceId = input.workspaceId ?? context.routeWorkspaceId ?? context.targetWorkspaceId ?? context.workspaceId;
  invariant(workspaceId, 'workspaceId is required for workspace audit correlation.', AUDIT_CORRELATION_ERROR_CODES.SCOPE_VIOLATION);

  if (context.workspaceId && workspaceId !== context.workspaceId) {
    invariant(false, 'workspace audit correlation must stay within the caller workspace scope.', AUDIT_CORRELATION_ERROR_CODES.SCOPE_VIOLATION);
  }

  return {
    tenantId: context.tenantId ?? input.tenantId,
    workspaceId,
    queryScope: 'workspace'
  };
}

function normalizeMaxItems(input = {}, requestContract = {}, scope = {}) {
  const maxItems = input.maxItems ?? requestContract.default_max_items ?? scope.default_max_items ?? 25;
  invariant(maxItems > 0, 'audit correlation maxItems must be positive.', AUDIT_CORRELATION_ERROR_CODES.LIMIT_EXCEEDED);
  invariant(maxItems <= (requestContract.max_items ?? 200), 'audit correlation maxItems cannot exceed the configured maximum.', AUDIT_CORRELATION_ERROR_CODES.LIMIT_EXCEEDED);
  return maxItems;
}

function normalizeRequestedCorrelationId(context = {}, input = {}) {
  const requestedCorrelationId = input.correlationId ?? context.routeCorrelationId ?? context.targetCorrelationId;
  invariant(Boolean(requestedCorrelationId), 'audit correlation requires a target correlationId.', AUDIT_CORRELATION_ERROR_CODES.MISSING_CORRELATION_ID);
  return requestedCorrelationId;
}

function inferPhaseFromOriginSurface(originSurface = '') {
  switch (originSurface) {
    case 'console_backend':
      return 'console_initiation';
    case 'control_api':
    case 'internal_reconciler':
      return 'control_plane_execution';
    case 'provider_adapter':
    case 'bootstrap_job':
    case 'scheduled_operation':
      return 'downstream_system_effect';
    default:
      return 'audit_persistence';
  }
}

function normalizeAuditRecord(record = {}, profileId = 'default_masked') {
  const masked = applyAuditExportMasking(
    {
      eventId: record.eventId ?? record.event_id,
      eventTimestamp: record.eventTimestamp ?? record.event_timestamp,
      actor: record.actor ?? {},
      scope: record.scope ?? {},
      resource: record.resource ?? {},
      action: record.action ?? {},
      result: record.result ?? {},
      correlationId: record.correlationId ?? record.correlation_id,
      origin: record.origin ?? {},
      detail: record.detail ?? {}
    },
    profileId
  );

  return masked;
}

function auditRecordToTimelineEntry(record = {}) {
  return {
    nodeId: record.eventId,
    phase: inferPhaseFromOriginSurface(record.origin?.originSurface),
    eventTimestamp: record.eventTimestamp,
    originSurface: record.origin?.originSurface ?? 'control_api',
    subsystemId: record.resource?.subsystemId ?? record.resource?.subsystem_id ?? 'tenant_control_plane',
    resourceType: record.resource?.resourceType ?? record.resource?.resource_type ?? 'audit_record',
    actionId: record.action?.actionId ?? record.action?.action_id ?? 'unknown',
    outcome: record.result?.outcome ?? 'unknown',
    auditRecordId: record.eventId,
    sourceType: 'audit_record',
    maskingApplied: record.maskingApplied,
    maskedFieldRefs: record.maskedFieldRefs,
    sensitivityCategories: record.sensitivityCategories
  };
}

function normalizeEvidencePointer(pointer = {}, event = {}, index = 0) {
  return {
    pointerId: pointer.pointerId ?? pointer.pointer_id ?? `${event.id ?? event.auditRecordId ?? event.actionId ?? 'ptr'}_${index + 1}`,
    sourceContractId: pointer.sourceContractId ?? pointer.source_contract_id ?? event.sourceContractId ?? event.source_contract_id ?? 'unknown',
    pointerType: pointer.pointerType ?? pointer.pointer_type ?? event.pointerType ?? event.pointer_type ?? 'audit_reference',
    safeRef: pointer.safeRef ?? pointer.safe_ref ?? event.safeRef ?? event.safe_ref ?? '[MASKED]',
    auditRecordId: pointer.auditRecordId ?? pointer.audit_record_id ?? event.auditRecordId ?? event.audit_record_id ?? '',
    subsystemId: pointer.subsystemId ?? pointer.subsystem_id ?? event.subsystemId ?? event.subsystem_id ?? 'unknown',
    observedAt: pointer.observedAt ?? pointer.observed_at ?? event.observedAt ?? event.eventTimestamp ?? event.observed_at ?? null
  };
}

function normalizeDownstreamEvent(event = {}) {
  const pointers = (event.evidencePointers ?? event.evidence_pointers ?? []).map((pointer, index) => normalizeEvidencePointer(pointer, event, index));

  if (pointers.length === 0 && (event.safeRef ?? event.safe_ref)) {
    pointers.push(normalizeEvidencePointer({}, event, 0));
  }

  return {
    id: event.id ?? event.eventId ?? event.event_id ?? event.auditRecordId ?? event.audit_record_id ?? event.actionId ?? 'downstream_event',
    sourceContractId: event.sourceContractId ?? event.source_contract_id ?? 'unknown',
    phase: event.phase ?? 'downstream_system_effect',
    eventTimestamp: event.eventTimestamp ?? event.event_timestamp ?? event.observedAt ?? event.observed_at,
    originSurface: event.originSurface ?? event.origin_surface ?? 'provider_adapter',
    subsystemId: event.subsystemId ?? event.subsystem_id ?? 'unknown',
    resourceType: event.resourceType ?? event.resource_type ?? 'managed_resource',
    actionId: event.actionId ?? event.action_id ?? 'unknown',
    outcome: event.outcome ?? event.status ?? 'unknown',
    auditRecordId: event.auditRecordId ?? event.audit_record_id ?? '',
    evidencePointers: pointers
  };
}

function downstreamEventToTimelineEntry(event = {}) {
  return {
    nodeId: event.id,
    phase: event.phase,
    eventTimestamp: event.eventTimestamp,
    originSurface: event.originSurface,
    subsystemId: event.subsystemId,
    resourceType: event.resourceType,
    actionId: event.actionId,
    outcome: event.outcome,
    auditRecordId: event.auditRecordId,
    sourceType: 'downstream_event',
    sourceContractId: event.sourceContractId
  };
}

function compareTimelineEntries(left = {}, right = {}) {
  const leftValue = left.eventTimestamp ? new Date(left.eventTimestamp).valueOf() : 0;
  const rightValue = right.eventTimestamp ? new Date(right.eventTimestamp).valueOf() : 0;

  if (leftValue === rightValue) {
    return String(left.nodeId).localeCompare(String(right.nodeId));
  }

  return leftValue - rightValue;
}

function defaultLoader() {
  return { auditRecords: [], downstreamEvents: [] };
}

function deriveMissingLinks({ timeline = [], auditRecords = [], evidencePointers = [], downstreamEvents = [], expectedSubsystemIds = [] } = {}) {
  const missingLinks = [];
  const hasConsoleInitiation = timeline.some((entry) => entry.phase === 'console_initiation');
  const hasDownstreamEffect = timeline.some((entry) => entry.phase === 'downstream_system_effect') || evidencePointers.length > 0;
  const hasAuditLink = auditRecords.length > 0 || timeline.some((entry) => Boolean(entry.auditRecordId));

  if (!hasConsoleInitiation) missingLinks.push('console_initiation_missing');
  if (!hasDownstreamEffect) missingLinks.push('downstream_system_effect_missing');
  if (!hasAuditLink) missingLinks.push('audit_link_missing');

  const presentSubsystems = new Set((downstreamEvents ?? []).map((event) => event?.subsystemId).filter(Boolean));
  const requiredSubsystems = Array.from(new Set(expectedSubsystemIds ?? [])).filter(Boolean);
  if (presentSubsystems.size > 0 && requiredSubsystems.length > 0) {
    for (const subsystemId of requiredSubsystems) {
      if (!presentSubsystems.has(subsystemId)) {
        missingLinks.push(`subsystem_missing:${subsystemId}`);
      }
    }
  }

  return missingLinks;
}

function deriveTraceStatus({ timeline = [], auditRecords = [], evidencePointers = [], missingLinks = [] } = {}) {
  if (timeline.length === 0 && auditRecords.length === 0 && evidencePointers.length === 0) {
    return 'not_found';
  }

  if (missingLinks.length === 0) {
    return 'complete';
  }

  const hasConsoleInitiation = timeline.some((entry) => entry.phase === 'console_initiation');
  const hasDownstreamEffect = timeline.some((entry) => entry.phase === 'downstream_system_effect') || evidencePointers.length > 0;

  if (!hasConsoleInitiation || !hasDownstreamEffect) {
    return 'broken';
  }

  return 'partial';
}

export function normalizeAuditCorrelationRequest(scopeId, context = {}, input = {}) {
  const scope = findScope(scopeId);
  const requestContract = getAuditCorrelationRequestContract();
  const scopeBinding = assertScopeBinding(scope, context, input);
  const requestedCorrelationId = normalizeRequestedCorrelationId(context, input);

  return {
    ...scopeBinding,
    actor: context.actor,
    requestedCorrelationId,
    correlationId: context.correlationId ?? input.requestCorrelationId,
    includeRecords: normalizeBoolean(input.includeRecords, requestContract.default_include_records ?? true),
    includeEvidence: normalizeBoolean(input.includeEvidence, requestContract.default_include_evidence ?? true),
    maxItems: normalizeMaxItems(input, requestContract, scope)
  };
}

export function buildAuditCorrelationTrace(scopeId, context = {}, input = {}) {
  const request = normalizeAuditCorrelationRequest(scopeId, context, input);
  const maskingCompatibility = getAuditCorrelationMaskingCompatibility();
  const loader = context.loadAuditCorrelation ?? defaultLoader;
  const loaded = input.auditRecords || input.downstreamEvents ? input : loader(request);
  const profileId = maskingCompatibility.source_profile_id ?? 'default_masked';
  const auditRecords = request.includeRecords
    ? (loaded.auditRecords ?? loaded.records ?? [])
        .slice(0, request.maxItems)
        .map((record) => normalizeAuditRecord(record, profileId))
    : [];
  const downstreamEvents = (loaded.downstreamEvents ?? []).slice(0, request.maxItems).map(normalizeDownstreamEvent);
  const evidencePointers = request.includeEvidence
    ? downstreamEvents.flatMap((event) => event.evidencePointers ?? []).slice(0, request.maxItems)
    : [];
  const timeline = [...auditRecords.map(auditRecordToTimelineEntry), ...downstreamEvents.map(downstreamEventToTimelineEntry)]
    .filter((entry) => Boolean(entry.eventTimestamp))
    .sort(compareTimelineEntries)
    .slice(0, request.maxItems);
  const missingLinks = deriveMissingLinks({
    timeline,
    auditRecords,
    evidencePointers,
    downstreamEvents,
    expectedSubsystemIds: input.expectedSubsystemIds ?? input.expectedSubsystems
  });
  const traceStatus = deriveTraceStatus({ timeline, auditRecords, evidencePointers, missingLinks });
  const subsystems = Array.from(new Set(timeline.map((entry) => entry.subsystemId).filter(Boolean))).sort();
  const startedAt = timeline[0]?.eventTimestamp ?? null;
  const completedAt = timeline[timeline.length - 1]?.eventTimestamp ?? null;

  return {
    correlationId: request.requestedCorrelationId,
    queryScope: request.queryScope,
    traceStatus,
    startedAt,
    completedAt,
    subsystems,
    timeline,
    auditRecords,
    evidencePointers,
    missingLinks: traceStatus === 'not_found' ? ['correlation_trace_not_found'] : missingLinks,
    consoleSummary: {
      initiatedFromConsole: timeline.some((entry) => entry.phase === 'console_initiation'),
      timelineEntryCount: timeline.length,
      auditRecordCount: auditRecords.length,
      evidencePointerCount: evidencePointers.length,
      missingLinkCount: traceStatus === 'not_found' ? 1 : missingLinks.length,
      involvedSubsystemCount: subsystems.length
    }
  };
}

export function traceTenantAuditCorrelation(context = {}, input = {}) {
  return buildAuditCorrelationTrace('tenant', context, input);
}

export function traceWorkspaceAuditCorrelation(context = {}, input = {}) {
  return buildAuditCorrelationTrace('workspace', context, input);
}

export function listAuditCorrelationRoutes() {
  return listAuditCorrelationScopes()
    .map((scope) => getPublicRoute(scope.route_operation_id))
    .filter(Boolean);
}

export function buildAuditCorrelationConsoleView({ scopeId = 'tenant' } = {}) {
  const scope = findScope(scopeId);
  const route = getPublicRoute(scope.route_operation_id);
  const consoleSurface = getAuditCorrelationConsoleSurface();

  return {
    scopeId,
    route,
    statuses: listAuditCorrelationStatuses().map((status) => ({
      id: status.id,
      label: status.label
    })),
    phases: listAuditCorrelationTimelinePhases().map((phase) => ({
      id: phase.id,
      label: phase.label
    })),
    states: consoleSurface.states ?? {},
    statusBadges: consoleSurface.status_badges ?? [],
    defaultTimelineGrouping: consoleSurface.default_timeline_grouping ?? 'phase',
    showEvidencePointersByDefault: consoleSurface.show_evidence_pointers_by_default ?? true
  };
}
