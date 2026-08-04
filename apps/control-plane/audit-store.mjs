// Action-audit store (domain B, kind deploy) — the WRITER side of the
// Observability audit-records surface (add-audit-write-and-scope-enforcement-store, #557).
//
// The live 2-tenant campaign found that after real control-plane actions (create
// users / workspaces / etc.) the audit-records query returned ZERO entries: nothing
// wrote an audit record, and the metrics audit handler returned a hardcoded empty
// page. This module records each mutating action into `plan_audit_events` (the table
// already created at boot in tenant-store.mjs, carrying a correlation_id column) and
// reads it back, TENANT-SCOPED, for the metrics audit-records handler.
//
// Isolation (cardinal rule, multitenant BaaS): every record carries tenant_id (and,
// when applicable, the owning workspace under new_state.workspaceId); reads are
// filtered by the path-resolved tenant (and workspace) so a tenant only ever sees its
// own action history. The metrics handler additionally guards cross-tenant access
// before calling in.
//
// plan_audit_events columns (see tenant-store.mjs::ensureSchema):
//   id, action_type, actor_id, tenant_id, plan_id, previous_state, new_state,
//   correlation_id, created_at. We reuse it as the generic action-audit log: the
//   workspace id (when present) is carried in new_state.workspaceId so the workspace
//   read can filter without a schema change.

import { createHash, randomUUID } from 'node:crypto';
import { auditCanonical, computeRowHash } from './audit-hash.mjs';

const ACTION_CATEGORY_BY_TYPE = Object.freeze({
  'tenant.create': 'resource_creation',
  'tenant.delete': 'resource_deletion',
  'tenant.purge': 'resource_deletion',
  'tenant.user.create': 'access_control_modification',
  'tenant.auth-config.update': 'access_control_modification',
  'tenant.social-provider.upsert': 'access_control_modification',
  'tenant.social-provider.delete': 'access_control_modification',
  'workspace.create': 'resource_creation',
  'workspace.promote': 'configuration_change',
  'workspace.service-account.create': 'access_control_modification',
  'workspace.service-account.credential.issue': 'access_control_modification',
  'workspace.service-account.credential.rotate': 'configuration_change',
  'workspace.service-account.credential.revoke': 'access_control_modification',
  'workspace.database.provision': 'resource_creation',
  'workspace.database.credential.rotate': 'configuration_change',
  'workspace.function.register': 'resource_creation',
  'workspace.secret.set': 'configuration_change',
  'workspace.secret.get': 'configuration_change',
  'workspace.secret.list': 'configuration_change',
  'workspace.secret.delete': 'configuration_change',
  'iam.user.create': 'access_control_modification',
  'iam.user.delete': 'access_control_modification',
  'iam.user.status': 'access_control_modification',
  'iam.role.create': 'access_control_modification',
  'iam.group.create': 'access_control_modification',
  'iam.user.role-assign': 'access_control_modification',
  'iam.user.role-remove': 'access_control_modification',
  'iam.user.group-add': 'access_control_modification',
  'iam.user.group-remove': 'access_control_modification',
  'quota.override.created': 'quota_adjustment',
  'quota.override.modified': 'quota_adjustment',
  'quota.override.revoked': 'quota_adjustment',
  'quota.override.superseded': 'quota_adjustment',
  'quota.override.expired': 'quota_adjustment',
  'quota.sub_quota.set': 'quota_adjustment',
  'quota.sub_quota.removed': 'quota_adjustment',
  'plan.limit.set': 'quota_adjustment',
  'plan.limit.removed': 'quota_adjustment',
  'plan.capability.enabled': 'configuration_change',
  'plan.capability.disabled': 'configuration_change',
  'plan.created': 'configuration_change',
  'plan.updated': 'configuration_change',
  'plan.lifecycle_transitioned': 'configuration_change',
  'plan.change_impact_recorded': 'configuration_change',
  'assignment.created': 'configuration_change',
  'assignment.superseded': 'configuration_change'
});
const CONTRACTUAL_ACTION_CATEGORIES = new Set([
  'resource_creation',
  'resource_deletion',
  'configuration_change',
  'access_control_modification',
  'quota_adjustment',
  'privilege_escalation',
  'secret_rotation',
  'policy_override',
  'backup_restore',
  'provider_reconciliation'
]);

const STORED_ACTION_CATEGORY_SQL = `COALESCE(
  NULLIF(new_state->>'actionCategory', ''),
  NULLIF(new_state->>'action_category', '')
)`;
const DERIVED_ACTION_CATEGORY_SQL = `CASE action_type
    ${Object.entries(ACTION_CATEGORY_BY_TYPE).map(([actionType, category]) => `WHEN '${actionType}' THEN '${category}'`).join('\n    ')}
    ELSE 'configuration_change'
  END`;
const ACTION_CATEGORY_SQL = `CASE
  WHEN ${STORED_ACTION_CATEGORY_SQL} IN (${[...CONTRACTUAL_ACTION_CATEGORIES].map((value) => `'${value}'`).join(', ')})
    THEN ${STORED_ACTION_CATEGORY_SQL}
  ELSE ${DERIVED_ACTION_CATEGORY_SQL}
END`;

const WORKSPACE_ID_SQL = `NULLIF(new_state->>'workspaceId', '')`;
const STORED_SUBSYSTEM_SQL = `COALESCE(
  NULLIF(new_state->>'subsystem', ''),
  NULLIF(new_state->>'subsystemId', '')
)`;
const SUBSYSTEM_SQL = `CASE
  WHEN ${STORED_SUBSYSTEM_SQL} IN ('iam', 'postgresql', 'mongodb', 'kafka', 'openwhisk', 'storage', 'quota_metering', 'tenant_control_plane', 'mcp')
    THEN ${STORED_SUBSYSTEM_SQL}
  ELSE 'tenant_control_plane'
END`;
const OUTCOME_SQL = `CASE
  WHEN outcome = 'error' THEN 'failed'
  WHEN outcome IN ('succeeded', 'failed', 'denied', 'partial', 'accepted') THEN outcome
  ELSE 'partial'
END`;
const STORED_ACTOR_TYPE_SQL = `COALESCE(
  NULLIF(new_state->>'actorType', ''),
  NULLIF(new_state->>'actor_type', '')
)`;
const ACTOR_TYPE_SQL = `CASE
  WHEN ${STORED_ACTOR_TYPE_SQL} IN ('platform_user', 'tenant_user', 'workspace_user', 'service_account', 'system', 'provider_adapter')
    THEN ${STORED_ACTOR_TYPE_SQL}
  ELSE CASE
    WHEN actor_id IS NULL OR actor_id = '' THEN 'system'
    WHEN ${WORKSPACE_ID_SQL} IS NOT NULL THEN 'workspace_user'
    ELSE 'tenant_user'
  END
END`;
const RESOURCE_TYPE_SQL = `COALESCE(
  NULLIF(new_state->>'resourceType', ''),
  NULLIF(new_state->>'resource_type', ''),
  CASE WHEN ${WORKSPACE_ID_SQL} IS NOT NULL THEN 'workspace' ELSE 'tenant' END
)`;
const RESOURCE_ID_SQL = `COALESCE(
  NULLIF(new_state->>'resourceId', ''),
  NULLIF(new_state->>'resource_id', ''),
  ${WORKSPACE_ID_SQL},
  tenant_id::text
)`;
const STORED_ORIGIN_SURFACE_SQL = `COALESCE(
  NULLIF(new_state->>'originSurface', ''),
  NULLIF(new_state->>'origin_surface', '')
)`;
const ORIGIN_SURFACE_SQL = `CASE
  WHEN ${STORED_ORIGIN_SURFACE_SQL} IN ('control_api', 'console_backend', 'internal_reconciler', 'provider_adapter', 'bootstrap_job', 'scheduled_operation')
    THEN ${STORED_ORIGIN_SURFACE_SQL}
  ELSE 'control_api'
END`;
const CORRELATION_ID_SQL = `COALESCE(NULLIF(correlation_id, ''), 'legacy-' || id::text)`;
const CURSOR_CREATED_AT_SQL = `to_char(
  created_at AT TIME ZONE 'UTC',
  'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
)`;

const SUBSYSTEMS = Object.freeze([
  'iam', 'postgresql', 'mongodb', 'kafka', 'openwhisk', 'storage', 'quota_metering',
  'tenant_control_plane', 'mcp'
]);
const ACTION_CATEGORIES = Object.freeze([...CONTRACTUAL_ACTION_CATEGORIES]);
const OUTCOMES = Object.freeze(['succeeded', 'failed', 'denied', 'partial', 'accepted']);
const ACTOR_TYPES = Object.freeze([
  'platform_user', 'tenant_user', 'workspace_user', 'service_account', 'system', 'provider_adapter'
]);
const ORIGIN_SURFACES = Object.freeze([
  'control_api', 'console_backend', 'internal_reconciler', 'provider_adapter', 'bootstrap_job',
  'scheduled_operation'
]);

export const AUDIT_FILTER_DESCRIPTORS = Object.freeze([
  { id: 'occurred_after', key: 'occurredAfter', param: 'filter[occurredAfter]', label: 'Occurred after', type: 'date-time', sql: 'created_at', operator: '>=' },
  { id: 'occurred_before', key: 'occurredBefore', param: 'filter[occurredBefore]', label: 'Occurred before', type: 'date-time', sql: 'created_at', operator: '<=' },
  { id: 'subsystem', key: 'subsystem', param: 'filter[subsystem]', label: 'Subsystem', type: 'enum', allowedValues: SUBSYSTEMS, sql: SUBSYSTEM_SQL },
  { id: 'action_category', key: 'actionCategory', param: 'filter[actionCategory]', label: 'Action category', type: 'enum', allowedValues: ACTION_CATEGORIES, sql: ACTION_CATEGORY_SQL },
  { id: 'action_id', key: 'actionId', param: 'filter[actionId]', label: 'Action ID', type: 'string', minLength: 1, sql: 'action_type' },
  { id: 'outcome', key: 'outcome', param: 'filter[outcome]', label: 'Outcome', type: 'enum', allowedValues: OUTCOMES, sql: OUTCOME_SQL },
  { id: 'actor_type', key: 'actorType', param: 'filter[actorType]', label: 'Actor type', type: 'enum', allowedValues: ACTOR_TYPES, sql: ACTOR_TYPE_SQL },
  { id: 'actor_id', key: 'actorId', param: 'filter[actorId]', label: 'Actor ID', type: 'string', minLength: 1, sql: 'actor_id' },
  { id: 'resource_type', key: 'resourceType', param: 'filter[resourceType]', label: 'Resource type', type: 'string', minLength: 1, sql: RESOURCE_TYPE_SQL },
  { id: 'resource_id', key: 'resourceId', param: 'filter[resourceId]', label: 'Resource ID', type: 'string', minLength: 1, sql: RESOURCE_ID_SQL },
  { id: 'origin_surface', key: 'originSurface', param: 'filter[originSurface]', label: 'Origin surface', type: 'enum', allowedValues: ORIGIN_SURFACES, sql: ORIGIN_SURFACE_SQL },
  { id: 'correlation_id', key: 'correlationId', param: 'filter[correlationId]', label: 'Correlation ID', type: 'string', minLength: 1, sql: CORRELATION_ID_SQL }
].map((descriptor) => Object.freeze(descriptor)));

export const AUDIT_QUERY_ERROR_CODES = Object.freeze({
  SCOPE_VIOLATION: 'AUDIT_QUERY_SCOPE_VIOLATION',
  INVALID_PAGE_SIZE: 'AUDIT_QUERY_INVALID_PAGE_SIZE',
  INVALID_SORT: 'AUDIT_QUERY_INVALID_SORT',
  INVALID_TIME_WINDOW: 'AUDIT_QUERY_INVALID_TIME_WINDOW',
  INVALID_FILTER: 'AUDIT_QUERY_INVALID_FILTER',
  INVALID_CURSOR: 'AUDIT_QUERY_INVALID_CURSOR'
});

function auditQueryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function validateAuditQueryScope({ tenantId, workspaceId = null, queryScope } = {}) {
  if (typeof tenantId !== 'string' || tenantId.trim() === '') {
    throw auditQueryError(AUDIT_QUERY_ERROR_CODES.SCOPE_VIOLATION, 'tenantId is required for audit-record queries.');
  }
  if (queryScope !== 'tenant' && queryScope !== 'workspace') {
    throw auditQueryError(AUDIT_QUERY_ERROR_CODES.SCOPE_VIOLATION, 'queryScope must be tenant or workspace.');
  }
  if (workspaceId !== null && (typeof workspaceId !== 'string' || workspaceId.trim() === '')) {
    throw auditQueryError(AUDIT_QUERY_ERROR_CODES.SCOPE_VIOLATION, 'workspaceId must be a non-empty string when supplied.');
  }
  if (queryScope === 'workspace' && workspaceId === null) {
    throw auditQueryError(AUDIT_QUERY_ERROR_CODES.SCOPE_VIOLATION, 'workspaceId is required for workspace audit-record queries.');
  }
}

function singleQueryValue(query, param, code = AUDIT_QUERY_ERROR_CODES.INVALID_FILTER) {
  const value = query?.[param];
  if (Array.isArray(value)) {
    throw auditQueryError(code, `${param} must be supplied exactly once.`);
  }
  return value;
}

const RFC3339_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/;
const CANONICAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function parseRfc3339(value, param) {
  const text = String(value);
  const match = RFC3339_PATTERN.exec(text);
  if (!match) {
    throw auditQueryError(AUDIT_QUERY_ERROR_CODES.INVALID_TIME_WINDOW, `${param} must be a complete RFC 3339 date-time.`);
  }
  const [, year, month, day, hour, minute, second, fraction = '', zone, offsetSign, offsetHour = '00', offsetMinute = '00'] = match;
  const calendarDate = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const calendarIsValid = calendarDate.getUTCFullYear() === Number(year)
    && calendarDate.getUTCMonth() === Number(month) - 1
    && calendarDate.getUTCDate() === Number(day);
  const clockIsValid = Number(hour) <= 23 && Number(minute) <= 59 && Number(second) <= 59;
  const offsetIsValid = zone === 'Z' || (Number(offsetHour) <= 23 && Number(offsetMinute) <= 59);
  const timestamp = Date.parse(text);
  if (!calendarIsValid || !clockIsValid || !offsetIsValid || !Number.isFinite(timestamp)) {
    throw auditQueryError(AUDIT_QUERY_ERROR_CODES.INVALID_TIME_WINDOW, `${param} must be a valid RFC 3339 date-time.`);
  }
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

function normalizeRfc3339(value, param) {
  return parseRfc3339(value, param).text;
}

function canonicalFingerprintInput({ tenantId, workspaceId = null, queryScope, filters = {}, sort }) {
  const orderedFilters = Object.fromEntries(
    Object.entries(filters).sort(([left], [right]) => left.localeCompare(right))
  );
  return {
    scope: {
      tenantId: String(tenantId),
      ...(workspaceId ? { workspaceId: String(workspaceId) } : {}),
      queryScope
    },
    filters: orderedFilters,
    sort
  };
}

export function auditQueryFingerprint(query) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalFingerprintInput(query)), 'utf8')
    .digest('hex');
}

function validateCursorPosition(position) {
  const keys = position && typeof position === 'object' && !Array.isArray(position)
    ? Object.keys(position).sort()
    : [];
  if (keys.length !== 2 || keys[0] !== 'createdAt' || keys[1] !== 'id') {
    throw auditQueryError(AUDIT_QUERY_ERROR_CODES.INVALID_CURSOR, 'page[after] has an invalid position shape.');
  }
  let createdAt;
  try {
    createdAt = normalizeRfc3339(position.createdAt, 'page[after].position.createdAt');
  } catch {
    throw auditQueryError(AUDIT_QUERY_ERROR_CODES.INVALID_CURSOR, 'page[after] has an invalid timestamp position.');
  }
  if (typeof position.id !== 'string' || !CANONICAL_UUID_PATTERN.test(position.id)) {
    throw auditQueryError(AUDIT_QUERY_ERROR_CODES.INVALID_CURSOR, 'page[after] has an invalid event ID position.');
  }
  return { createdAt, id: position.id };
}

export function encodeAuditCursor({ position, fingerprint } = {}) {
  const normalizedPosition = validateCursorPosition(position);
  if (typeof fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(fingerprint)) {
    throw auditQueryError(AUDIT_QUERY_ERROR_CODES.INVALID_CURSOR, 'cursor fingerprint must be a SHA-256 value.');
  }
  return Buffer.from(JSON.stringify({ v: 1, position: normalizedPosition, fingerprint }), 'utf8').toString('base64url');
}

export function decodeAuditCursor(rawCursor) {
  if (typeof rawCursor !== 'string' || rawCursor.length < 1 || rawCursor.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(rawCursor)) {
    throw auditQueryError(AUDIT_QUERY_ERROR_CODES.INVALID_CURSOR, 'page[after] must be bounded unpadded base64url.');
  }
  let bytes;
  let payload;
  try {
    bytes = Buffer.from(rawCursor, 'base64url');
    if (bytes.length > 2048 || bytes.toString('base64url') !== rawCursor) throw new Error('non-canonical base64url');
    payload = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw auditQueryError(AUDIT_QUERY_ERROR_CODES.INVALID_CURSOR, 'page[after] must contain valid versioned JSON.');
  }
  const keys = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? Object.keys(payload).sort()
    : [];
  if (keys.length !== 3 || keys[0] !== 'fingerprint' || keys[1] !== 'position' || keys[2] !== 'v' || payload.v !== 1) {
    throw auditQueryError(AUDIT_QUERY_ERROR_CODES.INVALID_CURSOR, 'page[after] has an unsupported version or shape.');
  }
  if (typeof payload.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(payload.fingerprint)) {
    throw auditQueryError(AUDIT_QUERY_ERROR_CODES.INVALID_CURSOR, 'page[after] has an invalid fingerprint.');
  }
  return {
    v: 1,
    position: validateCursorPosition(payload.position),
    fingerprint: payload.fingerprint
  };
}

export function normalizeAuditEventQuery(rawQuery = {}, {
  tenantId,
  workspaceId = null,
  queryScope = workspaceId ? 'workspace' : 'tenant'
} = {}) {
  validateAuditQueryScope({ tenantId, workspaceId, queryScope });
  const rawPageSize = singleQueryValue(rawQuery, 'page[size]', AUDIT_QUERY_ERROR_CODES.INVALID_PAGE_SIZE);
  let pageSize = 25;
  if (rawPageSize !== undefined && rawPageSize !== null) {
    const text = String(rawPageSize);
    if (!/^(?:[1-9]|[1-9]\d|1\d\d|200)$/.test(text)) {
      throw auditQueryError(AUDIT_QUERY_ERROR_CODES.INVALID_PAGE_SIZE, 'page[size] must be an integer from 1 through 200.');
    }
    pageSize = Number(text);
  }

  const rawSort = singleQueryValue(rawQuery, 'sort', AUDIT_QUERY_ERROR_CODES.INVALID_SORT);
  const sort = rawSort === undefined || rawSort === null ? '-eventTimestamp' : String(rawSort);
  if (sort !== 'eventTimestamp' && sort !== '-eventTimestamp') {
    throw auditQueryError(AUDIT_QUERY_ERROR_CODES.INVALID_SORT, 'sort must be eventTimestamp or -eventTimestamp.');
  }

  const filters = {};
  for (const descriptor of AUDIT_FILTER_DESCRIPTORS) {
    const rawValue = singleQueryValue(rawQuery, descriptor.param);
    if (rawValue === undefined || rawValue === null) continue;
    let value = String(rawValue);
    if (descriptor.type === 'date-time') value = normalizeRfc3339(value, descriptor.param);
    if (descriptor.type === 'string' && value.length < (descriptor.minLength ?? 1)) {
      throw auditQueryError(AUDIT_QUERY_ERROR_CODES.INVALID_FILTER, `${descriptor.param} must not be empty.`);
    }
    if (descriptor.type === 'enum' && !descriptor.allowedValues.includes(value)) {
      throw auditQueryError(AUDIT_QUERY_ERROR_CODES.INVALID_FILTER, `${descriptor.param} is not a supported value.`);
    }
    filters[descriptor.id] = value;
  }
  if (filters.occurred_after && filters.occurred_before
    && parseRfc3339(filters.occurred_after, 'filter[occurredAfter]').instantNanoseconds
      > parseRfc3339(filters.occurred_before, 'filter[occurredBefore]').instantNanoseconds) {
    throw auditQueryError(AUDIT_QUERY_ERROR_CODES.INVALID_TIME_WINDOW, 'filter[occurredAfter] must not be later than filter[occurredBefore].');
  }

  const fingerprint = auditQueryFingerprint({ tenantId, workspaceId, queryScope, filters, sort });
  const rawCursor = singleQueryValue(rawQuery, 'page[after]', AUDIT_QUERY_ERROR_CODES.INVALID_CURSOR);
  let cursorPosition = null;
  if (rawCursor !== undefined && rawCursor !== null) {
    const cursor = decodeAuditCursor(rawCursor);
    if (cursor.fingerprint !== fingerprint) {
      throw auditQueryError(AUDIT_QUERY_ERROR_CODES.INVALID_CURSOR, 'page[after] is incompatible with the authorized query.');
    }
    cursorPosition = cursor.position;
  }

  return { pageSize, sort, filters, fingerprint, cursorPosition };
}

function filterValue(value) {
  if (value === undefined || value === null || value === '') return null;
  return String(value);
}

export function auditActionCategoryForType(actionType, explicitCategory = null) {
  const explicit = filterValue(explicitCategory);
  if (explicit && CONTRACTUAL_ACTION_CATEGORIES.has(explicit)) return explicit;
  const key = filterValue(actionType);
  return ACTION_CATEGORY_BY_TYPE[key] ?? 'configuration_change';
}

// Record a single action-audit event. Best-effort by design: auditing must NEVER
// fail the action it describes, so callers wrap this and swallow errors.
//
// The row carries the TRUE `outcome` (succeeded/denied/failed/error) and is linked
// into a per-tenant append-only HASH CHAIN (#644): within one transaction holding a
// per-tenant advisory lock (to serialize concurrent audit writes for the tenant), we
// read the tenant's latest row_hash as prev_hash, generate id + created_at in-app so
// they are covered by the hash, compute row_hash, and INSERT atomically.
export async function recordAuditEvent(db, {
  actionType, actorId, tenantId = null, workspaceId = null, outcome = 'succeeded',
  previousState = null, newState = {}, correlationId = null
} = {}) {
  const merged = workspaceId ? { ...(newState ?? {}), workspaceId } : (newState ?? {});
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const at = String(actionType ?? 'action').slice(0, 64);
  const actor = String(actorId ?? 'unknown');
  const tid = tenantId ?? null;

  const usePooled = typeof db.connect === 'function';
  const client = usePooled ? await db.connect() : db;
  try {
    await client.query('BEGIN');
    // Serialize per-tenant chain appends so two concurrent writes can't fork it.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::int8)', [`audit:${tid ?? 'global'}`]);
    const prev = await client.query(
      'SELECT row_hash FROM plan_audit_events WHERE tenant_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1',
      [tid]
    );
    const prevHash = prev.rows[0]?.row_hash ?? '';
    const rowHash = computeRowHash(auditCanonical({ id, actionType: at, actorId: actor, tenantId: tid, outcome, createdAt, newState: merged }), prevHash);
    const res = await client.query(
      `INSERT INTO plan_audit_events (id, action_type, actor_id, tenant_id, plan_id, previous_state, new_state, outcome, correlation_id, created_at, prev_hash, row_hash)
       VALUES ($1,$2,$3,$4,NULL,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11)
       RETURNING id, action_type, actor_id, tenant_id, previous_state, new_state, outcome, correlation_id, created_at, prev_hash, row_hash`,
      [id, at, actor, tid, previousState == null ? null : JSON.stringify(previousState), JSON.stringify(merged ?? {}), outcome, correlationId ?? null, createdAt, prevHash, rowHash]
    );
    await client.query('COMMIT');
    return res.rows[0] ?? null;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  } finally {
    if (usePooled) client.release?.();
  }
}

// Read action-audit events for a scope, NEWEST first. Always filtered by tenant_id;
// when workspaceId is given, additionally filter to events whose new_state.workspaceId
// matches (workspace-scoped read). Optional audit filters are SQL predicates, so an
// unmatched value narrows to an empty page rather than falling back to the full set.
// `tenantId` is required — never return cross-tenant.
export async function queryAuditEvents(db, {
  tenantId,
  workspaceId = null,
  queryScope = workspaceId ? 'workspace' : 'tenant',
  limit = 50,
  pageSize,
  sort = '-eventTimestamp',
  cursorPosition = null,
  filters = null,
  maxLimit = 200,
  outcome = null,
  actionCategory = null,
  actorId = null,
  occurredAfter = null,
  occurredBefore = null
} = {}) {
  validateAuditQueryScope({ tenantId, workspaceId, queryScope });
  const paginated = Number.isInteger(pageSize);
  const exportMode = maxLimit > 200;
  const cap = Number.isInteger(maxLimit) ? Math.min(Math.max(maxLimit, 1), 10000) : 200;
  const safePageSize = paginated ? Math.min(Math.max(pageSize, 1), exportMode ? cap : 200) : null;
  const safeLimit = paginated
    ? (exportMode ? safePageSize : safePageSize + 1)
    : Math.min(Math.max(Number(limit) || 50, 1), exportMode ? cap : 200);
  const effectiveFilters = filters ?? Object.fromEntries([
    ['outcome', filterValue(outcome)],
    ['action_category', filterValue(actionCategory)],
    ['actor_id', filterValue(actorId)],
    ['occurred_after', filterValue(occurredAfter)],
    ['occurred_before', filterValue(occurredBefore)]
  ].filter(([, value]) => value !== null));
  const params = [tenantId];
  const where = ['tenant_id = $1'];
  if (workspaceId) {
    params.push(workspaceId);
    where.push(`new_state->>'workspaceId' = $${params.length}`);
  }
  for (const descriptor of AUDIT_FILTER_DESCRIPTORS) {
    const value = filterValue(effectiveFilters[descriptor.id]);
    if (value === null) continue;
    params.push(value);
    const cast = descriptor.type === 'date-time' ? '::timestamptz' : '';
    where.push(`${descriptor.sql} ${descriptor.operator ?? '='} $${params.length}${cast}`);
  }
  const ascending = sort === 'eventTimestamp';
  if (cursorPosition) {
    params.push(cursorPosition.createdAt, cursorPosition.id);
    const timestampParam = `$${params.length - 1}::timestamptz`;
    const idParam = `$${params.length}`;
    where.push(`(created_at, id) ${ascending ? '>' : '<'} (${timestampParam}, ${idParam})`);
  }
  params.push(safeLimit);
  const sql = `SELECT id, action_type, ${ACTION_CATEGORY_SQL} AS action_category,
              ${SUBSYSTEM_SQL} AS subsystem_id,
              ${ACTOR_TYPE_SQL} AS actor_type,
              actor_id, tenant_id, ${WORKSPACE_ID_SQL} AS workspace_id,
              ${RESOURCE_TYPE_SQL} AS resource_type,
              ${RESOURCE_ID_SQL} AS resource_id,
              ${ORIGIN_SURFACE_SQL} AS origin_surface,
              ${CORRELATION_ID_SQL} AS canonical_correlation_id,
              previous_state, new_state, outcome, correlation_id, created_at,
              ${CURSOR_CREATED_AT_SQL} AS cursor_created_at,
              prev_hash, row_hash
         FROM plan_audit_events
         WHERE ${where.join(' AND ')}
         ORDER BY created_at ${ascending ? 'ASC' : 'DESC'}, id ${ascending ? 'ASC' : 'DESC'} LIMIT $${params.length}`;
  const res = await db.query(sql, params);
  return res.rows ?? [];
}

// Map a plan_audit_events row -> the Observability audit-record shape the console
// audit-records page consumes (eventId/eventTimestamp/actor/scope/action/result/
// correlationId). Mirrors apps/control-plane-executor/src/observability-audit-query.mjs's
// normalizeAuditRecord so the kind read is shape-compatible with the product.
export function auditRowToRecord(row = {}) {
  const newState = row.new_state && typeof row.new_state === 'object' && !Array.isArray(row.new_state)
    ? row.new_state
    : {};
  const eventId = String(row.id ?? `legacy-${row.created_at ?? 'event'}`);
  let eventTimestamp = null;
  for (const candidate of [row.cursor_created_at, row.created_at]) {
    if (typeof candidate !== 'string') continue;
    try {
      eventTimestamp = normalizeRfc3339(candidate, 'audit event timestamp');
      break;
    } catch {
      // Legacy/direct callers may not provide the query projection or may carry an
      // older timestamp representation; fall through to the safe Date conversion.
    }
  }
  if (eventTimestamp === null) {
    const parsedTimestamp = new Date(row.created_at ?? 0);
    eventTimestamp = Number.isFinite(parsedTimestamp.valueOf())
      ? parsedTimestamp.toISOString()
      : new Date(0).toISOString();
  }
  const workspaceId = row.workspace_id ?? newState.workspaceId ?? null;
  const storedOutcome = row.outcome === 'error' ? 'failed' : row.outcome;
  const actorType = row.actor_type ?? newState.actorType ?? newState.actor_type;
  const subsystem = row.subsystem_id ?? newState.subsystem ?? newState.subsystemId;
  const originSurface = row.origin_surface ?? newState.originSurface ?? newState.origin_surface;
  const actionCategory = auditActionCategoryForType(
    row.action_type,
    row.action_category ?? newState.actionCategory ?? newState.action_category
  );
  return {
    eventId,
    eventTimestamp,
    actor: {
      actorId: String(row.actor_id ?? 'unknown'),
      actorType: ACTOR_TYPES.includes(actorType)
        ? actorType
        : (row.actor_id ? (workspaceId ? 'workspace_user' : 'tenant_user') : 'system')
    },
    scope: {
      scopeMode: workspaceId ? 'tenant_workspace' : 'tenant',
      tenantId: String(row.tenant_id ?? 'unknown'),
      ...(workspaceId ? { workspaceId: String(workspaceId) } : {})
    },
    resource: {
      subsystemId: SUBSYSTEMS.includes(subsystem) ? subsystem : 'tenant_control_plane',
      resourceType: String(row.resource_type ?? newState.resourceType ?? newState.resource_type ?? (workspaceId ? 'workspace' : 'tenant')),
      resourceId: String(row.resource_id ?? newState.resourceId ?? newState.resource_id ?? workspaceId ?? row.tenant_id ?? 'unknown')
    },
    action: { actionId: String(row.action_type ?? 'unknown_action'), category: actionCategory },
    actionType: row.action_type ?? null,
    // True outcome from the stored column (#644); legacy NULL rows are conservatively partial.
    result: {
      outcome: ['succeeded', 'denied', 'failed', 'partial', 'accepted'].includes(storedOutcome)
        ? storedOutcome
        : 'partial'
    },
    correlationId: String(row.canonical_correlation_id ?? row.correlation_id ?? `legacy-${eventId}`),
    origin: {
      originSurface: ORIGIN_SURFACES.includes(originSurface) ? originSurface : 'control_api',
      emittingService: 'control-plane'
    },
    // Tamper-evidence: expose the per-tenant hash-chain links so a client can verify.
    rowHash: row.row_hash ?? null,
    prevHash: row.prev_hash ?? null,
    detail: newState
  };
}
