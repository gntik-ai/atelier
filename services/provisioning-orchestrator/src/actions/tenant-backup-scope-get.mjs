import { getTenantProjection, getActiveProfile } from '../repositories/backup-scope-repository.mjs';
import { publishScopeQueried } from '../events/backup-scope-events.mjs';

const PRIVILEGED_ROLES = new Set(['superadmin', 'sre']);

function getCallerContext(params = {}) {
  return params.callerContext ?? {};
}

function generateCorrelationId() {
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function main(params = {}, deps = {}) {
  const db = deps.db ?? params.__ow_db;
  const producer = deps.producer ?? null;
  const callerContext = getCallerContext(params);
  const actor = callerContext.actor ?? {};
  const actorRole = actor.type ?? actor.role;
  const tenantId = params.tenantId;

  if (!tenantId) {
    const err = new Error('tenantId is required');
    err.statusCode = 400;
    err.code = 'VALIDATION_ERROR';
    throw err;
  }

  // Role check: superadmin/sre can query any tenant; tenant owner/admin only their own
  const isPrivileged = PRIVILEGED_ROLES.has(actorRole);
  const isTenantRole = actorRole === 'tenant:owner' || actorRole === 'tenant:admin';

  if (!isPrivileged && !isTenantRole) {
    const err = new Error('Forbidden: insufficient role');
    err.statusCode = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }

  // Tenant isolation: non-privileged actors must match their own tenant
  if (!isPrivileged && callerContext.tenantId !== tenantId) {
    const err = new Error('Forbidden: cross-tenant access denied');
    err.statusCode = 403;
    err.code = 'FORBIDDEN_CROSS_TENANT';
    throw err;
  }

  // Resolve plan ID from tenant assignment
  let planId = 'unknown';
  try {
    const { rows } = await db.query(
      'SELECT plan_id FROM tenant_plan_assignments WHERE tenant_id = $1 AND is_active = true LIMIT 1',
      [tenantId]
    );
    if (rows.length === 0) {
      const err = new Error(`Tenant not found: ${tenantId}`);
      err.statusCode = 404;
      err.code = 'TENANT_NOT_FOUND';
      throw err;
    }
    planId = rows[0].plan_id;
  } catch (lookupError) {
    if (lookupError.statusCode) throw lookupError;
    // Table may not exist yet; degrade gracefully
    planId = 'unknown';
  }

  const activeProfile = await getActiveProfile(db);
  const entries = await getTenantProjection(db, { tenantId, planId });
  const correlationId = generateCorrelationId();
  const generatedAt = new Date().toISOString();

  // Fire-and-forget audit event (TASK-12 wiring)
  publishScopeQueried(producer, {
    correlationId,
    actor: { id: actor.id, role: actorRole },
    tenantId,
    requestedProfile: null
  }).catch(() => {});

  return {
    statusCode: 200,
    body: {
      tenantId,
      activeProfile,
      planId,
      entries,
      generatedAt,
      correlationId
    }
  };
}
