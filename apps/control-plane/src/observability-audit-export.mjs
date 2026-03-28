import { createHash } from 'node:crypto';

import {
  getAuditExportConsoleSurface,
  getAuditExportFormat,
  getAuditExportMaskingProfile,
  getAuditExportRequestContract,
  getAuditExportScope,
  getPublicRoute,
  getAuditQueryFilter,
  listAuditExportFormats,
  listAuditExportMaskingProfiles,
  listAuditExportScopes,
  getAuditExportSensitiveFieldRules
} from '../../../services/internal-contracts/src/index.mjs';

export const AUDIT_EXPORT_ERROR_CODES = Object.freeze({
  SCOPE_VIOLATION: 'AUDIT_EXPORT_SCOPE_VIOLATION',
  LIMIT_EXCEEDED: 'AUDIT_EXPORT_LIMIT_EXCEEDED',
  INVALID_FORMAT: 'AUDIT_EXPORT_INVALID_FORMAT',
  INVALID_TIME_WINDOW: 'AUDIT_EXPORT_INVALID_TIME_WINDOW',
  UNKNOWN_MASKING_PROFILE: 'AUDIT_EXPORT_UNKNOWN_MASKING_PROFILE'
});

function invariant(condition, message, code) {
  if (!condition) {
    const error = new Error(message);
    error.code = code;
    throw error;
  }
}

function normalizeFilterValue(value) {
  return value === undefined || value === null || value === '' ? undefined : value;
}

function normalizeFilters(filters = {}) {
  return Object.fromEntries(
    [
      ['occurred_after', normalizeFilterValue(filters.occurredAfter ?? filters.occurred_after)],
      ['occurred_before', normalizeFilterValue(filters.occurredBefore ?? filters.occurred_before)],
      ['subsystem', normalizeFilterValue(filters.subsystem)],
      ['action_category', normalizeFilterValue(filters.actionCategory ?? filters.action_category)],
      ['action_id', normalizeFilterValue(filters.actionId ?? filters.action_id)],
      ['outcome', normalizeFilterValue(filters.outcome)],
      ['actor_type', normalizeFilterValue(filters.actorType ?? filters.actor_type)],
      ['actor_id', normalizeFilterValue(filters.actorId ?? filters.actor_id)],
      ['resource_type', normalizeFilterValue(filters.resourceType ?? filters.resource_type)],
      ['resource_id', normalizeFilterValue(filters.resourceId ?? filters.resource_id)],
      ['origin_surface', normalizeFilterValue(filters.originSurface ?? filters.origin_surface)],
      ['correlation_id', normalizeFilterValue(filters.correlationId ?? filters.correlation_id)]
    ].filter(([, value]) => value !== undefined)
  );
}

function normalizeTimeWindow(filters = {}, requestContract = {}) {
  const occurredAfter = filters.occurred_after;
  const occurredBefore = filters.occurred_before;

  if (occurredAfter && occurredBefore) {
    const afterDate = new Date(occurredAfter);
    const beforeDate = new Date(occurredBefore);

    invariant(!Number.isNaN(afterDate.valueOf()), 'filters.occurredAfter must be a valid ISO timestamp.', AUDIT_EXPORT_ERROR_CODES.INVALID_TIME_WINDOW);
    invariant(!Number.isNaN(beforeDate.valueOf()), 'filters.occurredBefore must be a valid ISO timestamp.', AUDIT_EXPORT_ERROR_CODES.INVALID_TIME_WINDOW);
    invariant(afterDate <= beforeDate, 'filters.occurredAfter must be earlier than or equal to filters.occurredBefore.', AUDIT_EXPORT_ERROR_CODES.INVALID_TIME_WINDOW);

    const windowMs = beforeDate.valueOf() - afterDate.valueOf();
    const maxWindowDays = requestContract.max_window_days ?? 31;
    invariant(windowMs <= maxWindowDays * 24 * 60 * 60 * 1000, 'audit export time window exceeds the configured maximum.', AUDIT_EXPORT_ERROR_CODES.INVALID_TIME_WINDOW);
  }
}

function normalizePageSize(input = {}, requestContract = {}) {
  const pageSize = input.pageSize ?? requestContract.default_page_size ?? 500;
  invariant(pageSize > 0, 'audit export page size must be positive.', AUDIT_EXPORT_ERROR_CODES.LIMIT_EXCEEDED);
  invariant(pageSize <= (requestContract.max_page_size ?? 10000), 'audit export page size cannot exceed the configured maximum.', AUDIT_EXPORT_ERROR_CODES.LIMIT_EXCEEDED);
  return pageSize;
}

function normalizeFormat(input = {}, requestContract = {}) {
  const formatId = input.format ?? requestContract.default_format;
  const format = getAuditExportFormat(formatId);
  invariant(Boolean(format), `audit export format ${formatId} is not supported.`, AUDIT_EXPORT_ERROR_CODES.INVALID_FORMAT);
  return format;
}

function normalizeMaskingProfile(input = {}) {
  const requestContract = getAuditExportRequestContract();
  const profileId = input.maskingProfileId ?? getAuditExportConsoleSurface().default_profile_id ?? requestContract.default_masking_profile_id ?? 'default_masked';
  const profile = getAuditExportMaskingProfile(profileId);
  invariant(Boolean(profile), `audit export masking profile ${profileId} is not supported.`, AUDIT_EXPORT_ERROR_CODES.UNKNOWN_MASKING_PROFILE);
  return profile;
}

function findScope(scopeId) {
  const scope = getAuditExportScope(scopeId);
  invariant(Boolean(scope), `unknown audit export scope ${scopeId}.`, AUDIT_EXPORT_ERROR_CODES.SCOPE_VIOLATION);
  return scope;
}

function assertScopeBinding(scope, context = {}, input = {}) {
  if (scope.id === 'tenant') {
    const tenantId = input.tenantId ?? context.routeTenantId ?? context.targetTenantId ?? context.tenantId;
    invariant(tenantId, 'tenantId is required for tenant audit exports.', AUDIT_EXPORT_ERROR_CODES.SCOPE_VIOLATION);

    if (context.tenantId && tenantId !== context.tenantId) {
      invariant(false, 'tenant audit export must stay within the caller tenant scope.', AUDIT_EXPORT_ERROR_CODES.SCOPE_VIOLATION);
    }

    const workspaceId = input.workspaceId;
    if (context.workspaceId && workspaceId && workspaceId !== context.workspaceId) {
      invariant(false, 'tenant audit export workspace narrowing must stay within the caller workspace scope.', AUDIT_EXPORT_ERROR_CODES.SCOPE_VIOLATION);
    }

    return { tenantId, workspaceId, queryScope: 'tenant' };
  }

  const workspaceId = input.workspaceId ?? context.routeWorkspaceId ?? context.targetWorkspaceId ?? context.workspaceId;
  invariant(workspaceId, 'workspaceId is required for workspace audit exports.', AUDIT_EXPORT_ERROR_CODES.SCOPE_VIOLATION);

  if (context.workspaceId && workspaceId !== context.workspaceId) {
    invariant(false, 'workspace audit export must stay within the caller workspace scope.', AUDIT_EXPORT_ERROR_CODES.SCOPE_VIOLATION);
  }

  return {
    tenantId: context.tenantId ?? input.tenantId,
    workspaceId,
    queryScope: 'workspace'
  };
}

function buildDeterministicExportId(request, generatedAt) {
  const seed = JSON.stringify({
    queryScope: request.queryScope,
    tenantId: request.tenantId,
    workspaceId: request.workspaceId,
    correlationId: request.correlationId,
    format: request.format.id,
    generatedAt,
    filters: request.filters,
    pageSize: request.pageSize,
    maskingProfileId: request.maskingProfile.id
  });

  return `aexp_${createHash('sha256').update(seed).digest('hex').slice(0, 16)}`;
}

function ruleLookup() {
  const rules = getAuditExportSensitiveFieldRules();
  return new Map(
    rules.flatMap((rule) =>
      (rule.field_refs ?? []).map((fieldRef) => [fieldRef, { category: rule.id, replacement: rule.replacement ?? '[MASKED]' }])
    )
  );
}

function maskValue(value, path, lookup, maskedFieldRefs, categories) {
  if (Array.isArray(value)) {
    return value.map((entry, index) => maskValue(entry, `${path}[${index}]`, lookup, maskedFieldRefs, categories));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => {
      const nextPath = path ? `${path}.${key}` : key;
      const rule = lookup.get(key);
      if (rule) {
        maskedFieldRefs.push(nextPath);
        categories.add(rule.category);
        return [key, rule.replacement];
      }

      return [key, maskValue(nestedValue, nextPath, lookup, maskedFieldRefs, categories)];
    })
  );
}

export function applyAuditExportMasking(record = {}, profileId = 'default_masked') {
  const profile = getAuditExportMaskingProfile(profileId);
  invariant(Boolean(profile), `audit export masking profile ${profileId} is not supported.`, AUDIT_EXPORT_ERROR_CODES.UNKNOWN_MASKING_PROFILE);

  const maskedFieldRefs = [];
  const sensitivityCategories = new Set();
  const lookup = ruleLookup();
  const detail = maskValue(record.detail ?? {}, 'detail', lookup, maskedFieldRefs, sensitivityCategories);

  return {
    ...record,
    detail,
    maskingApplied: maskedFieldRefs.length > 0,
    maskedFieldRefs,
    sensitivityCategories: Array.from(sensitivityCategories).sort()
  };
}

export function normalizeAuditExportRequest(scopeId, context = {}, input = {}) {
  const scope = findScope(scopeId);
  const requestContract = getAuditExportRequestContract();
  const scopeBinding = assertScopeBinding(scope, context, input);
  const filters = normalizeFilters(input.filters ?? {});
  normalizeTimeWindow(filters, requestContract);
  const format = normalizeFormat(input, requestContract);
  const maskingProfile = normalizeMaskingProfile(input);

  return {
    ...scopeBinding,
    actor: context.actor,
    correlationId: context.correlationId ?? input.correlationId,
    pageSize: normalizePageSize(input, requestContract),
    sort: input.sort ?? requestContract.supported_sort_keys?.[0] ?? '-eventTimestamp',
    format,
    maskingProfile,
    filters
  };
}

function defaultLoader() {
  return { items: [] };
}

function normalizeRecord(record = {}) {
  return {
    eventId: record.eventId,
    eventTimestamp: record.eventTimestamp,
    actor: record.actor ?? {},
    scope: record.scope ?? {},
    resource: record.resource ?? {},
    action: record.action ?? {},
    result: record.result ?? {},
    correlationId: record.correlationId,
    origin: record.origin ?? {},
    detail: record.detail ?? {}
  };
}

export function buildAuditExportManifest(scopeId, context = {}, input = {}) {
  const request = normalizeAuditExportRequest(scopeId, context, input);
  const loader = context.queryAuditRecords ?? defaultLoader;
  const result = input.records ? { items: input.records } : loader(request);
  const items = (result.items ?? []).slice(0, request.pageSize).map((record) => applyAuditExportMasking(normalizeRecord(record), request.maskingProfile.id));
  const maskedItemCount = items.filter((item) => item.maskingApplied).length;
  const generatedAt = input.generatedAt ?? '2026-03-28T00:00:00Z';

  return {
    exportId: buildDeterministicExportId(request, generatedAt),
    queryScope: request.queryScope,
    format: request.format.id,
    maskingProfileId: request.maskingProfile.id,
    correlationId: request.correlationId,
    generatedAt,
    appliedFilters: request.filters,
    itemCount: items.length,
    maskedItemCount,
    items
  };
}

export function exportTenantAuditRecordsPreview(context = {}, input = {}) {
  return buildAuditExportManifest('tenant', context, input);
}

export function exportWorkspaceAuditRecordsPreview(context = {}, input = {}) {
  return buildAuditExportManifest('workspace', context, input);
}

export function listAuditExportRoutes() {
  return listAuditExportScopes()
    .map((scope) => getPublicRoute(scope.route_operation_id))
    .filter(Boolean);
}

export function buildAuditExportConsoleView({ scopeId = 'tenant' } = {}) {
  const scope = findScope(scopeId);
  const route = getPublicRoute(scope.route_operation_id);
  const consoleSurface = getAuditExportConsoleSurface();
  const requestContract = getAuditExportRequestContract();
  const formats = listAuditExportFormats().map((format) => ({
    id: format.id,
    label: format.label,
    mediaType: format.media_type,
    isDefault: format.id === requestContract.default_format
  }));
  const profiles = listAuditExportMaskingProfiles().map((profile) => ({
    id: profile.id,
    label: profile.label,
    isDefault: profile.is_default === true
  }));
  const reusableFilters = (requestContract.filter_reuse_ids ?? [])
    .map((filterId) => getAuditQueryFilter(filterId))
    .filter(Boolean)
    .map((filter) => ({ id: filter.id, param: filter.param, label: filter.label }));

  return {
    scopeId,
    route,
    formats,
    maskingProfiles: profiles,
    reusableFilters,
    states: consoleSurface.states ?? {},
    maskingBadges: consoleSurface.masking_badges ?? [],
    exportSafePresets: consoleSurface.export_safe_presets ?? []
  };
}
