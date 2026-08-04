import { createHash } from 'node:crypto';

import {
  getAuditConsoleSurface,
  getAuditQueryPaginationPolicy,
  getAuditQueryResponseContract,
  getAuditQueryScope,
  getPublicRoute,
  listAuditQueryFilters,
  listAuditQueryScopes
} from '../../../packages/internal-contracts/src/index.mjs';
import { applyAuditExportMasking } from './observability-audit-export.mjs';

export const AUDIT_QUERY_ERROR_CODES = Object.freeze({
  SCOPE_VIOLATION: 'AUDIT_QUERY_SCOPE_VIOLATION',
  LIMIT_EXCEEDED: 'AUDIT_QUERY_LIMIT_EXCEEDED',
  INVALID_SORT: 'AUDIT_QUERY_INVALID_SORT',
  INVALID_TIME_WINDOW: 'AUDIT_QUERY_INVALID_TIME_WINDOW',
  INVALID_FILTER: 'AUDIT_QUERY_INVALID_FILTER',
  INVALID_CURSOR: 'AUDIT_QUERY_INVALID_CURSOR'
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
  invariant(!Array.isArray(resolved), 'audit query page size must be supplied exactly once.', AUDIT_QUERY_ERROR_CODES.LIMIT_EXCEEDED);
  const text = String(resolved);
  invariant(/^(?:[1-9]|[1-9]\d|1\d\d|200)$/.test(text), 'audit query page size must be an integer from 1 through 200.', AUDIT_QUERY_ERROR_CODES.LIMIT_EXCEEDED);
  const normalized = Number(text);
  invariant(normalized <= (pagination.max_limit ?? 200), 'audit query limit cannot exceed the configured maximum.', AUDIT_QUERY_ERROR_CODES.LIMIT_EXCEEDED);
  return normalized;
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

const RFC3339_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/;
const CANONICAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function parseRfc3339(value, param, code = AUDIT_QUERY_ERROR_CODES.INVALID_TIME_WINDOW) {
  const text = String(value);
  const match = RFC3339_PATTERN.exec(text);
  invariant(match, `${param} must be a complete RFC 3339 date-time.`, code);
  const [, year, month, day, hour, minute, second, fraction = '', zone, offsetSign, offsetHour = '00', offsetMinute = '00'] = match;
  const calendarDate = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const calendarIsValid = calendarDate.getUTCFullYear() === Number(year)
    && calendarDate.getUTCMonth() === Number(month) - 1
    && calendarDate.getUTCDate() === Number(day);
  const clockIsValid = Number(hour) <= 23 && Number(minute) <= 59 && Number(second) <= 59;
  const offsetIsValid = zone === 'Z' || (Number(offsetHour) <= 23 && Number(offsetMinute) <= 59);
  const timestamp = Date.parse(text);
  invariant(calendarIsValid && clockIsValid && offsetIsValid && Number.isFinite(timestamp), `${param} must be a valid RFC 3339 date-time.`, code);
  const localEpochSeconds = BigInt(Math.trunc(Date.UTC(
    Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)
  ) / 1000));
  const offsetSeconds = BigInt((Number(offsetHour) * 60 + Number(offsetMinute)) * 60);
  const utcEpochSeconds = localEpochSeconds + (offsetSign === '-' ? offsetSeconds : -offsetSeconds);
  return {
    text,
    instantNanoseconds: utcEpochSeconds * 1_000_000_000n + BigInt(fraction.padEnd(9, '0') || '0')
  };
}

function normalizeRfc3339(value, param, code = AUDIT_QUERY_ERROR_CODES.INVALID_TIME_WINDOW) {
  return parseRfc3339(value, param, code).text;
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

  const descriptors = new Map(listAuditQueryFilters().map((filter) => [filter.id, filter]));
  const normalized = {};
  for (const [id, rawValue] of Object.entries(filters)) {
    if (rawValue === undefined || rawValue === null) continue;
    invariant(!Array.isArray(rawValue), `${descriptors.get(id)?.param ?? id} must be supplied exactly once.`, AUDIT_QUERY_ERROR_CODES.INVALID_FILTER);
    const descriptor = descriptors.get(id);
    let value = String(rawValue);
    if (descriptor?.type === 'date-time') value = normalizeRfc3339(value, descriptor.param);
    if (descriptor?.type === 'string') {
      invariant(value.length >= (descriptor.min_length ?? 1), `${descriptor.param} must not be empty.`, AUDIT_QUERY_ERROR_CODES.INVALID_FILTER);
    }
    if (descriptor?.type === 'enum') {
      invariant((descriptor.allowed_values ?? []).includes(value), `${descriptor.param} is not a supported value.`, AUDIT_QUERY_ERROR_CODES.INVALID_FILTER);
    }
    normalized[id] = value;
  }
  if (normalized.occurred_after && normalized.occurred_before) {
    invariant(
      parseRfc3339(normalized.occurred_after, 'filter[occurredAfter]').instantNanoseconds
        <= parseRfc3339(normalized.occurred_before, 'filter[occurredBefore]').instantNanoseconds,
      'filter[occurredAfter] must be earlier than or equal to filter[occurredBefore].',
      AUDIT_QUERY_ERROR_CODES.INVALID_TIME_WINDOW
    );
  }
  return normalized;
}

function auditQueryFingerprint({ tenantId, workspaceId = null, queryScope, filters, sort }) {
  const orderedFilters = Object.fromEntries(
    Object.entries(filters).sort(([left], [right]) => left.localeCompare(right))
  );
  return createHash('sha256').update(JSON.stringify({
    scope: {
      tenantId: String(tenantId),
      ...(workspaceId ? { workspaceId: String(workspaceId) } : {}),
      queryScope
    },
    filters: orderedFilters,
    sort
  }), 'utf8').digest('hex');
}

function normalizeCursorPosition(position) {
  const keys = position && typeof position === 'object' && !Array.isArray(position)
    ? Object.keys(position).sort()
    : [];
  invariant(keys.length === 2 && keys[0] === 'createdAt' && keys[1] === 'id', 'audit cursor position shape is invalid.', AUDIT_QUERY_ERROR_CODES.INVALID_CURSOR);
  const createdAt = normalizeRfc3339(position.createdAt, 'cursor.position.createdAt', AUDIT_QUERY_ERROR_CODES.INVALID_CURSOR);
  invariant(typeof position.id === 'string' && CANONICAL_UUID_PATTERN.test(position.id), 'audit cursor event ID position is invalid.', AUDIT_QUERY_ERROR_CODES.INVALID_CURSOR);
  return { createdAt, id: position.id };
}

export function encodeAuditRecordQueryCursor({ position, fingerprint } = {}) {
  const normalizedPosition = normalizeCursorPosition(position);
  invariant(typeof fingerprint === 'string' && /^[a-f0-9]{64}$/.test(fingerprint), 'audit cursor fingerprint is invalid.', AUDIT_QUERY_ERROR_CODES.INVALID_CURSOR);
  return Buffer.from(JSON.stringify({ v: 1, position: normalizedPosition, fingerprint }), 'utf8').toString('base64url');
}

export function decodeAuditRecordQueryCursor(rawCursor) {
  invariant(typeof rawCursor === 'string' && rawCursor.length > 0 && rawCursor.length <= 4096 && /^[A-Za-z0-9_-]+$/.test(rawCursor), 'audit cursor must be bounded unpadded base64url.', AUDIT_QUERY_ERROR_CODES.INVALID_CURSOR);
  let bytes;
  let payload;
  try {
    bytes = Buffer.from(rawCursor, 'base64url');
    invariant(bytes.length <= 2048 && bytes.toString('base64url') === rawCursor, 'audit cursor encoding is invalid.', AUDIT_QUERY_ERROR_CODES.INVALID_CURSOR);
    payload = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    if (error?.code === AUDIT_QUERY_ERROR_CODES.INVALID_CURSOR) throw error;
    invariant(false, 'audit cursor must contain valid versioned JSON.', AUDIT_QUERY_ERROR_CODES.INVALID_CURSOR);
  }
  const keys = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? Object.keys(payload).sort()
    : [];
  invariant(keys.length === 3 && keys[0] === 'fingerprint' && keys[1] === 'position' && keys[2] === 'v' && payload.v === 1, 'audit cursor version or shape is invalid.', AUDIT_QUERY_ERROR_CODES.INVALID_CURSOR);
  invariant(typeof payload.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(payload.fingerprint), 'audit cursor fingerprint is invalid.', AUDIT_QUERY_ERROR_CODES.INVALID_CURSOR);
  return { v: 1, position: normalizeCursorPosition(payload.position), fingerprint: payload.fingerprint };
}

function canonicalScopeIdentifier(name, candidates) {
  const supplied = candidates.filter((value) => value !== undefined && value !== null);
  invariant(supplied.length > 0, `${name} is required for audit queries.`, AUDIT_QUERY_ERROR_CODES.SCOPE_VIOLATION);
  invariant(
    supplied.every((value) => typeof value === 'string' && value.trim() !== ''),
    `${name} must be a non-empty string for audit queries.`,
    AUDIT_QUERY_ERROR_CODES.SCOPE_VIOLATION
  );
  const [canonical] = supplied;
  invariant(
    supplied.every((value) => value === canonical),
    `${name} must agree across the authorized context and route parameters.`,
    AUDIT_QUERY_ERROR_CODES.SCOPE_VIOLATION
  );
  return canonical;
}

function assertScopeBinding(scope, context = {}, params = {}) {
  const tenantId = canonicalScopeIdentifier('tenantId', [
    params.tenantId,
    context.routeTenantId,
    context.targetTenantId,
    context.tenantId
  ]);
  if (scope.id === 'tenant') {
    return {
      tenantId,
      workspaceId: params.workspaceId,
      queryScope: 'tenant'
    };
  }

  const workspaceId = canonicalScopeIdentifier('workspaceId', [
    params.workspaceId,
    context.routeWorkspaceId,
    context.targetWorkspaceId,
    context.workspaceId
  ]);
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
  const sort = normalizeSort(scope, params.sort);
  const fingerprint = auditQueryFingerprint({ ...scopeBinding, filters, sort });
  const decodedCursor = params.cursor === undefined || params.cursor === null
    ? null
    : decodeAuditRecordQueryCursor(params.cursor);
  invariant(!decodedCursor || decodedCursor.fingerprint === fingerprint, 'audit cursor is incompatible with the authorized query.', AUDIT_QUERY_ERROR_CODES.INVALID_CURSOR);

  return {
    ...scopeBinding,
    actor: context.actor,
    limit: normalizeLimit(params.limit ?? params.pageSize, pagination),
    cursor: decodedCursor?.position ?? null,
    cursorFingerprint: fingerprint,
    sort,
    filters
  };
}

function defaultLoader(query) {
  return {
    items: [],
    page: {
      size: 0,
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

function normalizeAuditRecord(record = {}) {
  return {
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
  };
}

function buildMaskedAuditItems(items = []) {
  return items.map((record) => applyAuditExportMasking(normalizeAuditRecord(record)));
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

  const items = buildMaskedAuditItems(result.items ?? []);
  const nextCursor = result.page?.nextCursor;
  return {
    items,
    page: {
      size: result.page?.size ?? items.length,
      hasMore: result.page?.hasMore ?? Boolean(nextCursor),
      ...(nextCursor ? { nextCursor } : {})
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
