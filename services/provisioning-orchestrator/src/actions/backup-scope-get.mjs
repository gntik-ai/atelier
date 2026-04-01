import { getMatrix, getActiveProfile } from '../repositories/backup-scope-repository.mjs';
import { publishScopeQueried } from '../events/backup-scope-events.mjs';

const KNOWN_PROFILES = new Set(['all-in-one', 'standard', 'ha', 'all']);
const ALLOWED_ROLES = new Set(['superadmin', 'sre']);

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

  if (!ALLOWED_ROLES.has(actor.type ?? actor.role)) {
    const err = new Error('Forbidden: requires superadmin or sre role');
    err.statusCode = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }

  const profileParam = params.profile ?? null;

  if (profileParam && !KNOWN_PROFILES.has(profileParam)) {
    return {
      statusCode: 400,
      body: {
        error: 'BACKUP_SCOPE_UNKNOWN_PROFILE',
        message: `Unknown profile: '${profileParam}'. Valid values: all-in-one, standard, ha, all`
      }
    };
  }

  const includeAll = profileParam === 'all';
  const profileKey = (!profileParam || profileParam === 'all') ? null : profileParam;

  const activeProfile = await getActiveProfile(db);
  const entries = await getMatrix(db, { profileKey, includeAll });
  const correlationId = generateCorrelationId();
  const generatedAt = new Date().toISOString();

  const requestedProfile = profileParam ?? activeProfile;

  // Fire-and-forget audit event (TASK-12 wiring)
  publishScopeQueried(producer, {
    correlationId,
    actor: { id: actor.id, role: actor.type ?? actor.role },
    tenantId: null,
    requestedProfile: profileParam
  }).catch(() => {});

  return {
    statusCode: 200,
    body: {
      activeProfile,
      requestedProfile,
      entries,
      generatedAt,
      correlationId
    }
  };
}
