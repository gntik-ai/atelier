import { getPublicRoute } from '../../../services/internal-contracts/src/index.mjs';
import {
  OPENWHISK_AUDIT_ACTION_TYPES,
  buildAdminActionAuditEvent,
  buildDeploymentAuditEvent,
  buildQuotaEnforcementEvent,
  buildRollbackEvidenceEvent
} from '../../../services/adapters/src/openwhisk-admin.mjs';

export const AUDIT_ACTION_TYPES = OPENWHISK_AUDIT_ACTION_TYPES;
export const AUDIT_SCOPE_ERROR_CODES = Object.freeze({
  SCOPE_VIOLATION: 'AUDIT_SCOPE_VIOLATION',
  LIMIT_EXCEEDED: 'AUDIT_LIMIT_EXCEEDED',
  COVERAGE_UNAUTHORIZED: 'AUDIT_COVERAGE_UNAUTHORIZED'
});
export const FUNCTION_AUDIT_TOPIC = 'function.audit.events';

function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertBaseContext(context = {}) {
  invariant(context.actor, 'actor is required for function audit events.');
  invariant(context.tenantId, 'tenantId is required for function audit events.');
  invariant(context.workspaceId, 'workspaceId is required for function audit events.');
}

function toEventId(event = {}) {
  return event.eventId ?? event.auditRecordId ?? event.recordId;
}

function publishAuditEvent(event, context = {}) {
  const publisher = context.publishAuditEvent ?? ((payload, meta = {}) => ({ topic: meta.topic, eventId: toEventId(payload) }));
  publisher(event, { topic: FUNCTION_AUDIT_TOPIC });
  return toEventId(event);
}

function assertScopedQuery(context = {}, params = {}) {
  invariant(context.tenantId, 'tenantId is required for function audit queries.');
  invariant(context.workspaceId, 'workspaceId is required for function audit queries.');

  if ((params.tenantId ?? context.routeTenantId ?? context.targetTenantId ?? context.tenantId) !== context.tenantId) {
    const error = new Error('function audit query must stay within the caller tenant scope.');
    error.code = AUDIT_SCOPE_ERROR_CODES.SCOPE_VIOLATION;
    throw error;
  }

  if ((params.workspaceId ?? context.routeWorkspaceId ?? context.targetWorkspaceId ?? context.workspaceId) !== context.workspaceId) {
    const error = new Error('function audit query must stay within the caller workspace scope.');
    error.code = AUDIT_SCOPE_ERROR_CODES.SCOPE_VIOLATION;
    throw error;
  }
}

function normalizeQueryParams(params = {}) {
  const limit = params.limit ?? 50;
  if (limit > 200) {
    const error = new Error('function audit query limit cannot exceed 200.');
    error.code = AUDIT_SCOPE_ERROR_CODES.LIMIT_EXCEEDED;
    throw error;
  }

  return {
    actionType: params.actionType,
    actor: params.actor,
    functionId: params.functionId,
    since: params.since,
    until: params.until,
    cursor: params.cursor,
    limit
  };
}

function runQuery(context = {}, params = {}, forcedActionType) {
  assertScopedQuery(context, params);
  const normalized = normalizeQueryParams(params);
  const query = {
    tenantId: context.tenantId,
    workspaceId: context.workspaceId,
    queryScope: 'workspace',
    actionType: forcedActionType ?? normalized.actionType,
    actor: normalized.actor,
    functionId: normalized.functionId,
    since: normalized.since,
    until: normalized.until,
    cursor: normalized.cursor,
    limit: normalized.limit
  };
  const loader = context.queryAuditRecords ?? (() => ({ items: [], page: { size: query.limit, nextCursor: undefined } }));
  return loader(query);
}

export function emitDeploymentAuditEvent(context = {}, detail = {}) {
  assertBaseContext(context);
  const event = buildDeploymentAuditEvent(context, detail);
  return publishAuditEvent(event, context);
}

export function emitAdminActionAuditEvent(context = {}, detail = {}) {
  assertBaseContext(context);
  const event = buildAdminActionAuditEvent(context, detail);
  return publishAuditEvent(event, context);
}

export function emitRollbackEvidenceEvent(context = {}, detail = {}) {
  assertBaseContext(context);
  invariant(['success', 'failure'].includes(detail.outcome), 'rollback audit outcome must be success or failure.');
  const event = buildRollbackEvidenceEvent(context, detail);
  return publishAuditEvent(event, context);
}

export function emitQuotaEnforcementEvent(context = {}, detail = {}) {
  assertBaseContext(context);
  invariant(['allowed', 'denied'].includes(detail.decision), 'quota enforcement decision must be allowed or denied.');
  const event = buildQuotaEnforcementEvent(context, detail);
  return publishAuditEvent(event, context);
}

export function queryAuditRecords(context = {}, params = {}) {
  return runQuery(context, params);
}

export function queryRollbackEvidence(context = {}, params = {}) {
  return runQuery(context, params, AUDIT_ACTION_TYPES.ROLLBACK);
}

export function queryQuotaEnforcement(context = {}, params = {}) {
  return runQuery(context, params, AUDIT_ACTION_TYPES.QUOTA_ENFORCED);
}

export function buildAuditCoverageReport(adminContext = {}, params = {}) {
  if (!adminContext.isSuperadmin) {
    const error = new Error('superadmin access is required for function audit coverage.');
    error.code = AUDIT_SCOPE_ERROR_CODES.COVERAGE_UNAUTHORIZED;
    throw error;
  }

  const expectedActionTypes = Object.values(AUDIT_ACTION_TYPES);
  const loader = adminContext.queryCoverage ?? (() => ({ activeScopes: 0, coverageByActionType: expectedActionTypes.map((actionType) => ({ actionType, coveredScopes: 0, missingScopes: 0 })) }));
  const coverage = loader({ since: params.since, until: params.until, expectedActionTypes });

  return {
    generatedAt: params.generatedAt ?? '2026-03-27T00:00:00Z',
    expectedActionTypes,
    activeScopes: coverage.activeScopes ?? 0,
    coverageByActionType: (coverage.coverageByActionType ?? []).map((entry) => ({
      actionType: entry.actionType,
      coveredScopes: entry.coveredScopes ?? 0,
      missingScopes: entry.missingScopes ?? 0
    }))
  };
}

export function listFunctionAuditRoutes() {
  return [
    getPublicRoute('listFunctionDeploymentAudit'),
    getPublicRoute('listFunctionRollbackEvidence'),
    getPublicRoute('listFunctionQuotaEnforcement'),
    getPublicRoute('getFunctionAuditCoverage')
  ].filter(Boolean);
}
