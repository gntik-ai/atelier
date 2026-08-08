/**
 * Query handler backing the platform-admin billing usage routes:
 *   GET /v1/platform/billing/usage             (paginated, all tenants)
 *   GET /v1/platform/billing/usage/{tenantId}  (single-tenant filtered)
 *
 * Authorization is enforced here at the handler layer (in addition to the
 * gateway `scope-enforcement` plugin): only platform-admin actors
 * (superadmin / sre actor types, internal service actors, or the
 * `platform_admin` role) may read usage records. Every query is parameterized;
 * the tenant-scoped variant binds `tenant_id` so no cross-tenant rows leak.
 *
 * Dependency-injected (`deps.db`) so the SQL contract is black-box testable.
 */

const ALLOWED_ACTOR_TYPES = new Set(['superadmin', 'sre', 'internal']);
const ALLOWED_ROLES = new Set([
  'superadmin', 'sre', 'platform_admin', 'platform_operator', 'platform_auditor'
]);

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 200;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isPlatformAdmin(actor = {}) {
  if (ALLOWED_ACTOR_TYPES.has(actor.type ?? actor.role)) return true;
  const roles = Array.isArray(actor.roles) ? actor.roles : [];
  return roles.some((role) => ALLOWED_ROLES.has(role));
}

function pageSize(value) {
  const n = Number(value);
  if (value == null) return DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(n) || n < 1 || n > MAX_PAGE_SIZE) {
    throw Object.assign(new Error(`page[size] must be an integer between 1 and ${MAX_PAGE_SIZE}`), {
      statusCode: 400,
      code: 'INVALID_PAGE_SIZE'
    });
  }
  return n;
}

function decodeCursor(value, tenantId) {
  if (value == null) return null;
  if (typeof value !== 'string' || value.length < 1 || value.length > 256) {
    throw Object.assign(new Error('page[after] must be an opaque cursor of 1-256 characters'), {
      statusCode: 400,
      code: 'INVALID_PAGE_CURSOR'
    });
  }
  try {
    const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (cursor?.v !== 1 || typeof cursor.createdAt !== 'string' || typeof cursor.id !== 'string'
      || (cursor.tenantId ?? null) !== (tenantId ?? null)) throw new Error('invalid cursor fields');
    if (!Number.isFinite(new Date(cursor.createdAt).valueOf())) throw new Error('invalid cursor timestamp');
    if (!UUID_PATTERN.test(cursor.id)) throw new Error('invalid cursor record id');
    return cursor;
  } catch {
    throw Object.assign(new Error('page[after] is invalid or belongs to another billing scope'), {
      statusCode: 400,
      code: 'INVALID_PAGE_CURSOR'
    });
  }
}

function encodeCursor(row, tenantId) {
  const createdAt = isoTimestamp(row.created_at ?? row.createdAt);
  if (!createdAt || row.id == null) return null;
  return Buffer.from(JSON.stringify({
    v: 1,
    createdAt,
    id: String(row.id),
    tenantId: tenantId ?? null
  })).toString('base64url');
}

function isoTimestamp(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) ? parsed.toISOString() : String(value);
}

function projectUsageRecord(row = {}) {
  const record = {
    id: String(row.id),
    cycleId: String(row.cycle_id ?? row.cycleId),
    tenantId: String(row.tenant_id ?? row.tenantId),
    snapshotTimestamp: isoTimestamp(row.snapshot_at ?? row.snapshotTimestamp),
    dimensions: Array.isArray(row.dimensions) ? row.dimensions : [],
    hasDegradedDimensions: Boolean(row.has_degraded_dimensions ?? row.hasDegradedDimensions)
  };
  const createdAt = isoTimestamp(row.created_at ?? row.createdAt);
  if (createdAt != null) record.createdAt = createdAt;
  return record;
}

export async function main(params = {}, deps = {}) {
  const db = deps.db ?? params.db;
  const actor = params.callerContext?.actor ?? {};

  if (!actor.id || !isPlatformAdmin(actor)) {
    const err = new Error('Forbidden: requires platform-admin scope');
    err.statusCode = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }

  const limit = pageSize(params.pageSize);
  const tenantId = params.tenantId ?? null;
  const cursor = decodeCursor(params.pageAfter, tenantId);
  const fetchLimit = limit + 1;

  let result;
  if (tenantId) {
    result = cursor
      ? await db.query(
          `SELECT * FROM billing_usage_records
           WHERE tenant_id = $1 AND (created_at, id) < ($2::timestamptz, $3::uuid)
           ORDER BY created_at DESC, id DESC
           LIMIT $4`,
          [tenantId, cursor.createdAt, cursor.id, fetchLimit]
        )
      : await db.query(
          `SELECT * FROM billing_usage_records
           WHERE tenant_id = $1
           ORDER BY created_at DESC, id DESC
           LIMIT $2`,
          [tenantId, fetchLimit]
        );
  } else {
    result = cursor
      ? await db.query(
          `SELECT * FROM billing_usage_records
           WHERE (created_at, id) < ($1::timestamptz, $2::uuid)
           ORDER BY created_at DESC, id DESC
           LIMIT $3`,
          [cursor.createdAt, cursor.id, fetchLimit]
        )
      : await db.query(
          `SELECT * FROM billing_usage_records
           ORDER BY created_at DESC, id DESC
           LIMIT $1`,
          [fetchLimit]
        );
  }

  const rows = result?.rows ?? [];
  const hasNext = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const nextCursor = hasNext ? encodeCursor(pageRows.at(-1), tenantId) : null;

  return {
    statusCode: 200,
    body: {
      records: pageRows.map(projectUsageRecord),
      pagination: {
        limit,
        offset: 0,
        total: pageRows.length,
        ...(nextCursor ? { nextCursor } : {})
      }
    }
  };
}
