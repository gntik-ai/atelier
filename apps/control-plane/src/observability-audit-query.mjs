import {
  getAuditConsoleSurface,
  getAuditQueryPaginationPolicy,
  getAuditQueryResponseContract,
  getAuditQueryScope,
  getPublicRoute,
  listAuditQueryFilters,
  listAuditQueryScopes
} from '../../../services/internal-contracts/src/index.mjs';

export const AUDIT_QUERY_ERROR_CODES = Object.freeze({
  SCOPE_VIOLATION: 'AUDIT_QUERY_SCOPE_VIOLATION',
  LIMIT_EXCEEDED: 'AUDIT_QUERY_LIMIT_EXCEEDED',
  INVALID_SORT: 'AUDIT_QUERY_INVALID_SORT',
  INVALID_TIME_WINDOW: 'AUDIT_QUERY_INVALID_TIME_WINDOW'
});

function invariant(condition, message, code) {
  if (!condition) {
    const error = new Error(message);
    error.code = code;
    throw error;
  }
}

function findScope(scopeId) {
  const scope = getAuditQueryScope(scopeId);
  invariant(scope, `unknown audit query scope ${scopeId}.`, AUDIT_QUERY_ERROR_CODES.SCOPE_VIOLATION);
  return scope;
}

function normalizeLimit(limit, pagination) {
  const resolved = limit ?? pagination.default_limit ?? 25;
  invariant(resolved <= (pagination.max_limit ?? 200), 'audit query limit cannot exceed the configured maximum.', AUDIT_QUERY_ERROR_CODES.LIMIT_EXCEEDED);
  invariant(resolved > 0, 'audit query limit must be positive.', AUDIT_QUERY_ERROR_CODES.LIMIT_EXCEEDED);
  return resolved;
}

function normalizeSort(scope, sort) {
  const resolved = sort ?? scope.default_sort;
  invariant(
    (scope.allowed_sort_keys ?? []).includes(resolved),
    `audit query sort ${resolved} is not supported for scope ${scope.id}.`,
    AUDIT_QUERY_ERROR_CODES.INVALID_SORT
  );
  return resolved;
}

function normalizeTimeWindow(params = {}) {
  const occurredAfter = params.occurredAfter;
  const occurredBefore = params.occurredBefore;

  if (occurredAfter && occurredBefore) {
    const afterDate = new Date(occurredAfter);
    const beforeDate = new Date(occurredBefore);
    invariant(!Number.isNaN(afterDate.valueOf()), 'filter[occurredAfter] must be a valid ISO timestamp.', AUDIT_QUERY_ERROR_CODES.INVALID_TIME_WINDOW);
    invariant(!Number.isNaN(beforeDate.valueOf()), 'filter[occurredBefore] must be a valid ISO timestamp.', AUDIT_QUERY_ERROR_CODES.INVALID_TIME_WINDOW);
    invariant(afterDate <= beforeDate, 'filter[occurredAfter] must be earlier than or equal to filter[occurredBefore].', AUDIT_QUERY_ERROR_CODES.INVALID_TIME_WINDOW);
  }

  return { occurredAfter, occurredBefore };
}

function normalizeFilters(params = {}) {
  const filters = {
    occurred_after: params.occurredAfter,
    occurred_before: params.occurredBefore,
    subsystem: params.subsystem,
    action_category: params.actionCategory,
    action_id: params.actionId,
    outcome: params.outcome,
    actor_type: params.actorType,
    actor_id: params.actorId,
    resource_type: params.resourceType,
    resource_id: params.resourceId,
    origin_surface: params.originSurface,
    correlation_id: params.correlationId
  };

  return Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined && value !== null && value !== ''));
}

function assertScopeBinding(scope, context = {}, params = {}) {
  if (scope.id === 'tenant') {
    const tenantId = params.tenantId ?? context.routeTenantId ?? context.targetTenantId ?? context.tenantId;
    invariant(tenantId, 'tenantId is required for tenant audit queries.', AUDIT_QUERY_ERROR_CODES.SCOPE_VIOLATION);

    if (context.tenantId && tenantId !== context.tenantId) {
      invariant(false, 'tenant audit query must stay within the caller tenant scope.', AUDIT_QUERY_ERROR_CODES.SCOPE_VIOLATION);
    }

    return {
      tenantId,
      workspaceId: params.workspaceId,
      queryScope: 'tenant'
    };
  }

  const workspaceId = params.workspaceId ?? context.routeWorkspaceId ?? context.targetWorkspaceId ?? context.workspaceId;
  invariant(workspaceId, 'workspaceId is required for workspace audit queries.', AUDIT_QUERY_ERROR_CODES.SCOPE_VIOLATION);

  if (context.workspaceId && workspaceId !== context.workspaceId) {
    invariant(false, 'workspace audit query must stay within the caller workspace scope.', AUDIT_QUERY_ERROR_CODES.SCOPE_VIOLATION);
  }

  const tenantId = context.tenantId ?? params.tenantId;
  return {
    tenantId,
    workspaceId,
    queryScope: 'workspace'
  };
}

export function normalizeAuditRecordQuery(scopeId, context = {}, params = {}) {
  const scope = findScope(scopeId);
  const pagination = getAuditQueryPaginationPolicy();
  const scopeBinding = assertScopeBinding(scope, context, params);
  const filters = normalizeFilters(params);
  normalizeTimeWindow(params);

  return {
    ...scopeBinding,
    actor: context.actor,
    limit: normalizeLimit(params.limit ?? params.pageSize, pagination),
    cursor: params.cursor,
    sort: normalizeSort(scope, params.sort),
    filters
  };
}

function defaultLoader(query) {
  return {
    items: [],
    page: {
      size: query.limit,
      nextCursor: undefined,
      hasMore: false
    }
  };
}

function buildAvailableFilters() {
  return listAuditQueryFilters().map((filter) => ({
    id: filter.id,
    param: filter.param,
    label: filter.label,
    type: filter.type,
    allowedValues: filter.allowed_values ?? []
  }));
}

function buildConsoleHints(scopeId) {
  const surface = getAuditConsoleSurface();
  return {
    scopeId,
    defaultColumns: surface.default_columns ?? [],
    savedPresets: (surface.saved_presets ?? [])
      .filter((preset) => (preset.scope_ids ?? []).includes(scopeId))
      .map((preset) => ({
        id: preset.id,
        filters: preset.filters
      })),
    states: surface.states ?? {}
  };
}

function executeScopedQuery(scopeId, context = {}, params = {}) {
  const query = normalizeAuditRecordQuery(scopeId, context, params);
  const loader = context.queryAuditRecords ?? defaultLoader;
  const result = loader(query);
  const responseContract = getAuditQueryResponseContract();

  return {
    items: result.items ?? [],
    page: {
      size: result.page?.size ?? query.limit,
      nextCursor: result.page?.nextCursor,
      hasMore: result.page?.hasMore ?? Boolean(result.page?.nextCursor)
    },
    queryScope: scopeId,
    appliedFilters: query.filters,
    availableFilters: buildAvailableFilters(),
    consoleHints: buildConsoleHints(scopeId),
    responseContract
  };
}

export function queryTenantAuditRecords(context = {}, params = {}) {
  return executeScopedQuery('tenant', context, params);
}

export function queryWorkspaceAuditRecords(context = {}, params = {}) {
  return executeScopedQuery('workspace', context, params);
}

export function listAuditQueryRoutes() {
  return listAuditQueryScopes()
    .map((scope) => getPublicRoute(scope.route_operation_id))
    .filter(Boolean);
}

export function buildAuditExplorerView({ scopeId = 'tenant', currentCorrelationId } = {}) {
  const scope = findScope(scopeId);
  const route = getPublicRoute(scope.route_operation_id);
  const consoleHints = buildConsoleHints(scopeId);

  const presets = consoleHints.savedPresets.map((preset) => ({
    ...preset,
    filters: Object.fromEntries(
      Object.entries(preset.filters ?? {}).map(([filterId, value]) => [
        filterId,
        value === '$CURRENT_CORRELATION_ID' ? currentCorrelationId : value
      ])
    )
  }));

  return {
    scopeId,
    route,
    defaultSort: scope.default_sort,
    availableFilters: buildAvailableFilters(),
    defaultColumns: consoleHints.defaultColumns,
    states: consoleHints.states,
    presets
  };
}
