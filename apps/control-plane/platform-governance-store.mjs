// C-08 platform-governance store: durable projections + idempotent command log.
//
// Backs the five CQRS-style platform entity families the public API advertises:
//   deployment_profile (dpf_) | plan (pln_) | quota_policy (qta_) |
//   provider_capability (pvc_) | platform_user (usr_)
//
// Each POST validates the write request, authorizes at platform scope (in the
// handler), then ACCEPTS a command: it durably records the accepted command
// (idempotency-keyed) and the current entity projection in one transaction, and
// returns a MutationAccepted (202) envelope. A GET returns the stored projection
// or a bounded not-found. Replays of the same idempotency key return the original
// accepted command with no duplicate effect; a different body under the same key
// is a conflict.
//
// Pure/data-driven so the validation + projection contract is unit-testable
// without a database; the transactional accept/read take an injected pg client.
import { createHash, randomUUID } from 'node:crypto';

const ENTITY_STATES = Object.freeze(['draft', 'provisioning', 'pending_activation', 'active', 'suspended', 'soft_deleted', 'deleted']);
const PLAN_STATUSES = Object.freeze(['draft', 'active', 'grandfathered', 'retired']);
const WORKSPACE_ENVIRONMENTS = Object.freeze(['dev', 'sandbox', 'staging', 'prod', 'preview']);
const DEPLOYMENT_PROFILE_CLASSES = Object.freeze(['shared', 'dedicated', 'federated']);
const QUOTA_SCOPES = Object.freeze(['tenant', 'workspace', 'tenant_and_workspace']);
const QUOTA_ENFORCEMENT_MODES = Object.freeze(['hard_stop', 'throttle', 'advisory']);
const QUOTA_LIMIT_SCOPES = Object.freeze(['tenant', 'workspace']);
const CAPABILITY_PLANES = Object.freeze(['control', 'data', 'identity', 'observability']);
const PROVIDER_CAPABILITY_STATUSES = Object.freeze(['available', 'limited', 'disabled']);
const SUPPORT_LEVELS = Object.freeze(['preview', 'ga', 'deprecated']);
const PLATFORM_ROLES = Object.freeze(['platform_admin', 'platform_operator', 'platform_auditor']);
const BILLING_INTERVALS = Object.freeze(['monthly', 'annual']);
const IAM_SUBJECT_TYPES = Object.freeze(['console_user', 'break_glass_operator']);

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---- validation error --------------------------------------------------------
export class ValidationError extends Error {
  constructor(message, code = 'VALIDATION_ERROR') {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
    this.statusCode = 400;
  }
}

// ---- field validators (return the normalized value or throw ValidationError) --
function requireString(value, field, { min = 1, max = Infinity } = {}) {
  if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`);
  if (value.length < min || value.length > max) throw new ValidationError(`${field} length must be within [${min}, ${max}]`);
  return value;
}
function requireEnum(value, field, allowed) {
  if (!allowed.includes(value)) throw new ValidationError(`${field} must be one of ${allowed.join(', ')}`);
  return value;
}
function requireSlug(value, field = 'slug') {
  requireString(value, field, { min: 1, max: 63 });
  if (!SLUG_RE.test(value)) throw new ValidationError(`${field} must match ${SLUG_RE}`);
  return value;
}
function requireArrayOfEnum(value, field, allowed, { min = 0 } = {}) {
  if (!Array.isArray(value)) throw new ValidationError(`${field} must be an array`);
  if (value.length < min) throw new ValidationError(`${field} must contain at least ${min} item(s)`);
  for (const item of value) requireEnum(item, `${field}[]`, allowed);
  return [...value];
}
function optionalArrayOfPattern(value, field, re) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new ValidationError(`${field} must be an array`);
  for (const item of value) {
    if (typeof item !== 'string' || !re.test(item)) throw new ValidationError(`${field}[] must match ${re}`);
  }
  return [...value];
}
function requireMetadata(value, field = 'metadata') {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError(`${field} must be an object`);
  for (const [k, v] of Object.entries(value)) {
    if (typeof v !== 'string' || v.length > 1024) throw new ValidationError(`${field}.${k} must be a string of at most 1024 chars`);
  }
  return { ...value };
}
function requirePlaneBindings(value, field = 'planeBindings') {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError(`${field} must be an object`);
  const out = {};
  for (const plane of ['control', 'data', 'identity', 'observability']) {
    out[plane] = requireString(value[plane], `${field}.${plane}`, { min: 3, max: 120 });
  }
  return out;
}
function requireQuotaLimits(value, field = 'defaultLimits') {
  if (!Array.isArray(value)) throw new ValidationError(`${field} must be an array`);
  return value.map((limit, i) => {
    if (limit == null || typeof limit !== 'object') throw new ValidationError(`${field}[${i}] must be an object`);
    const metricKey = requireString(limit.metricKey, `${field}[${i}].metricKey`, { min: 3, max: 120 });
    const scope = requireEnum(limit.scope, `${field}[${i}].scope`, QUOTA_LIMIT_SCOPES);
    const unit = requireString(limit.unit, `${field}[${i}].unit`, { min: 1, max: 40 });
    if (!Number.isInteger(limit.limit) || limit.limit < 0) throw new ValidationError(`${field}[${i}].limit must be a non-negative integer`);
    return { metricKey, scope, unit, limit: limit.limit };
  });
}
function optionalInteger(value, field, { min, max } = {}) {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value)) throw new ValidationError(`${field} must be an integer`);
  if (min !== undefined && value < min) throw new ValidationError(`${field} must be >= ${min}`);
  if (max !== undefined && value > max) throw new ValidationError(`${field} must be <= ${max}`);
  return value;
}
function optionalMemberships(value, field) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new ValidationError(`${field} must be an array`);
  // Memberships are opaque governance sub-records; preserve them verbatim after a
  // shallow object-shape check. They are projected back unchanged.
  for (const [i, m] of value.entries()) {
    if (m == null || typeof m !== 'object' || Array.isArray(m)) throw new ValidationError(`${field}[${i}] must be an object`);
  }
  return value.map((m) => ({ ...m }));
}
function optionalIamBinding(value) {
  if (value === undefined) return undefined;
  if (value == null || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError('iamBinding must be an object');
  const realm = requireString(value.realm, 'iamBinding.realm', { min: 1 });
  const subjectType = requireEnum(value.subjectType, 'iamBinding.subjectType', IAM_SUBJECT_TYPES);
  const out = { realm, subjectType };
  if (value.subject !== undefined) out.subject = requireString(value.subject, 'iamBinding.subject');
  if (value.preferredUsername !== undefined) out.preferredUsername = requireString(value.preferredUsername, 'iamBinding.preferredUsername');
  return out;
}

// ---- lifecycle timestamps ----------------------------------------------------
function timestampsFor(state, nowIso) {
  const timestamps = { createdAt: nowIso, updatedAt: nowIso };
  if (state === 'active') timestamps.activatedAt = nowIso;
  if (state === 'suspended') timestamps.suspendedAt = nowIso;
  if (state === 'soft_deleted' || state === 'deleted') timestamps.deletedAt = nowIso;
  return timestamps;
}

// ---- per-entity specifications ----------------------------------------------
// Each spec validates + normalizes a write request, exposes the durable slug key
// (uniqueness scope) and builds the schema-valid projection stored/returned.
export const ENTITY_SPECS = Object.freeze({
  deployment_profile: {
    idPrefix: 'dpf',
    mutationEntityType: 'managed_resource',
    acceptedEventType: 'platform.deployment_profile.write.accepted',
    parented: false,
    references: (w) => (w.providerCapabilityIds ?? []).map((entityId) => ({
      entityType: 'provider_capability', entityId
    })),
    validate(body) {
      requireEnum(body?.entityType, 'entityType', ['deployment_profile']);
      return {
        slug: requireSlug(body.slug),
        displayName: requireString(body.displayName, 'displayName', { min: 1, max: 120 }),
        profileClass: requireEnum(body.profileClass, 'profileClass', DEPLOYMENT_PROFILE_CLASSES),
        supportedEnvironments: requireArrayOfEnum(body.supportedEnvironments, 'supportedEnvironments', WORKSPACE_ENVIRONMENTS, { min: 1 }),
        planeBindings: requirePlaneBindings(body.planeBindings),
        providerCapabilityIds: optionalArrayOfPattern(body.providerCapabilityIds, 'providerCapabilityIds', /^pvc_[0-9a-z]+$/),
        desiredState: requireEnum(body.desiredState, 'desiredState', ENTITY_STATES),
        metadata: requireMetadata(body.metadata)
      };
    },
    slugKey: (w) => w.slug,
    buildProjection(w, { entityId, nowIso }) {
      const projection = {
        entityType: 'deployment_profile',
        deploymentProfileId: entityId,
        slug: w.slug,
        displayName: w.displayName,
        profileClass: w.profileClass,
        supportedEnvironments: w.supportedEnvironments,
        planeBindings: w.planeBindings,
        state: w.desiredState,
        timestamps: timestampsFor(w.desiredState, nowIso),
        metadata: w.metadata
      };
      if (w.providerCapabilityIds !== undefined) projection.providerCapabilityIds = w.providerCapabilityIds;
      return projection;
    }
  },

  plan: {
    idPrefix: 'pln',
    mutationEntityType: 'managed_resource',
    acceptedEventType: 'platform.plan.write.accepted',
    parented: false,
    // The profile must exist.  quotaPolicyId is a forward allocation: the nested
    // quota-policy POST materializes exactly that id beneath this plan.  Requiring the
    // quota first would make the published create pair circular and unusable.
    references: (w) => [
      { entityType: 'deployment_profile', entityId: w.deploymentProfileId }
    ],
    validate(body) {
      requireEnum(body?.entityType, 'entityType', ['plan']);
      const w = {
        slug: requireSlug(body.slug),
        displayName: requireString(body.displayName, 'displayName', { min: 1, max: 120 }),
        planFamily: requireString(body.planFamily, 'planFamily', { min: 3, max: 80 }),
        planStatus: requireEnum(body.planStatus, 'planStatus', PLAN_STATUSES),
        deploymentProfileId: requireString(body.deploymentProfileId, 'deploymentProfileId', { min: 5 }),
        quotaPolicyId: requireString(body.quotaPolicyId, 'quotaPolicyId', { min: 5 }),
        desiredState: requireEnum(body.desiredState, 'desiredState', ENTITY_STATES),
        metadata: requireMetadata(body.metadata)
      };
      if (!/^dpf_[0-9a-z]+$/.test(w.deploymentProfileId)) throw new ValidationError('deploymentProfileId must match ^dpf_[0-9a-z]+$');
      if (!/^qta_[0-9a-z]+$/.test(w.quotaPolicyId)) throw new ValidationError('quotaPolicyId must match ^qta_[0-9a-z]+$');
      if (body.billingInterval !== undefined) w.billingInterval = requireEnum(body.billingInterval, 'billingInterval', BILLING_INTERVALS);
      if (body.capabilityKeys !== undefined) {
        if (!Array.isArray(body.capabilityKeys)) throw new ValidationError('capabilityKeys must be an array');
        w.capabilityKeys = body.capabilityKeys.map((k, i) => requireString(k, `capabilityKeys[${i}]`, { min: 3, max: 120 }));
      }
      return w;
    },
    slugKey: (w) => w.slug,
    buildProjection(w, { entityId, nowIso }) {
      const projection = {
        entityType: 'plan',
        planId: entityId,
        slug: w.slug,
        displayName: w.displayName,
        planFamily: w.planFamily,
        planStatus: w.planStatus,
        deploymentProfileId: w.deploymentProfileId,
        quotaPolicyId: w.quotaPolicyId,
        state: w.desiredState,
        timestamps: timestampsFor(w.desiredState, nowIso),
        metadata: w.metadata
      };
      if (w.billingInterval !== undefined) projection.billingInterval = w.billingInterval;
      if (w.capabilityKeys !== undefined) projection.capabilityKeys = w.capabilityKeys;
      return projection;
    }
  },

  quota_policy: {
    idPrefix: 'qta',
    mutationEntityType: 'managed_resource',
    acceptedEventType: 'platform.quota_policy.write.accepted',
    parented: true, // created under a plan (path planId)
    validate(body) {
      requireEnum(body?.entityType, 'entityType', ['quota_policy']);
      const w = {
        slug: requireSlug(body.slug),
        displayName: requireString(body.displayName, 'displayName', { min: 1, max: 120 }),
        quotaScope: requireEnum(body.quotaScope, 'quotaScope', QUOTA_SCOPES),
        enforcementMode: requireEnum(body.enforcementMode, 'enforcementMode', QUOTA_ENFORCEMENT_MODES),
        defaultLimits: requireQuotaLimits(body.defaultLimits),
        desiredState: requireEnum(body.desiredState, 'desiredState', ENTITY_STATES),
        metadata: requireMetadata(body.metadata)
      };
      const warn = optionalInteger(body.warningThresholdPercent, 'warningThresholdPercent', { min: 1, max: 99 });
      if (warn !== undefined) w.warningThresholdPercent = warn;
      return w;
    },
    slugKey: (w) => w.slug,
    buildProjection(w, { entityId, nowIso }) {
      const projection = {
        entityType: 'quota_policy',
        quotaPolicyId: entityId,
        slug: w.slug,
        displayName: w.displayName,
        quotaScope: w.quotaScope,
        enforcementMode: w.enforcementMode,
        defaultLimits: w.defaultLimits,
        state: w.desiredState,
        timestamps: timestampsFor(w.desiredState, nowIso),
        metadata: w.metadata
      };
      if (w.warningThresholdPercent !== undefined) projection.warningThresholdPercent = w.warningThresholdPercent;
      return projection;
    }
  },

  provider_capability: {
    idPrefix: 'pvc',
    mutationEntityType: 'managed_resource',
    acceptedEventType: 'platform.provider_capability.write.accepted',
    parented: false,
    validate(body) {
      requireEnum(body?.entityType, 'entityType', ['provider_capability']);
      const w = {
        provider: requireString(body.provider, 'provider', { min: 2, max: 80 }),
        capabilityKey: requireString(body.capabilityKey, 'capabilityKey', { min: 3, max: 120 }),
        plane: requireEnum(body.plane, 'plane', CAPABILITY_PLANES),
        capabilityStatus: requireEnum(body.capabilityStatus, 'capabilityStatus', PROVIDER_CAPABILITY_STATUSES),
        allowedEnvironments: requireArrayOfEnum(body.allowedEnvironments, 'allowedEnvironments', WORKSPACE_ENVIRONMENTS),
        desiredState: requireEnum(body.desiredState, 'desiredState', ENTITY_STATES),
        metadata: requireMetadata(body.metadata)
      };
      if (body.supportLevel !== undefined) w.supportLevel = requireEnum(body.supportLevel, 'supportLevel', SUPPORT_LEVELS);
      return w;
    },
    // Uniqueness is (provider, capabilityKey) — no public slug field.
    slugKey: (w) => `${w.provider}:${w.capabilityKey}`,
    buildProjection(w, { entityId, nowIso }) {
      const projection = {
        entityType: 'provider_capability',
        providerCapabilityId: entityId,
        provider: w.provider,
        capabilityKey: w.capabilityKey,
        plane: w.plane,
        capabilityStatus: w.capabilityStatus,
        allowedEnvironments: w.allowedEnvironments,
        state: w.desiredState,
        timestamps: timestampsFor(w.desiredState, nowIso),
        metadata: w.metadata
      };
      if (w.supportLevel !== undefined) projection.supportLevel = w.supportLevel;
      return projection;
    }
  },

  platform_user: {
    idPrefix: 'usr',
    mutationEntityType: 'platform_user',
    acceptedEventType: 'platform.platform_user.write.accepted',
    parented: false,
    conflictCode: 'PLATFORM_USER_CONFLICT', // published 409 on username reuse
    validate(body) {
      requireEnum(body?.entityType, 'entityType', ['platform_user']);
      const w = {
        username: requireSlug(body.username, 'username'),
        displayName: requireString(body.displayName, 'displayName', { min: 1, max: 120 }),
        primaryEmail: requireString(body.primaryEmail, 'primaryEmail', { min: 3 }),
        identitySubject: requireString(body.identitySubject, 'identitySubject', { min: 3, max: 255 }),
        desiredState: requireEnum(body.desiredState, 'desiredState', ENTITY_STATES),
        metadata: requireMetadata(body.metadata)
      };
      if (!EMAIL_RE.test(w.primaryEmail)) throw new ValidationError('primaryEmail must be a valid email address');
      if (body.platformRoles !== undefined) w.platformRoles = requireArrayOfEnum(body.platformRoles, 'platformRoles', PLATFORM_ROLES);
      const tenantMemberships = optionalMemberships(body.tenantMemberships, 'tenantMemberships');
      if (tenantMemberships !== undefined) w.tenantMemberships = tenantMemberships;
      const workspaceMemberships = optionalMemberships(body.workspaceMemberships, 'workspaceMemberships');
      if (workspaceMemberships !== undefined) w.workspaceMemberships = workspaceMemberships;
      const iamBinding = optionalIamBinding(body.iamBinding);
      if (iamBinding !== undefined) w.iamBinding = iamBinding;
      return w;
    },
    slugKey: (w) => w.username,
    buildProjection(w, { entityId, nowIso }) {
      const projection = {
        entityType: 'platform_user',
        userId: entityId,
        username: w.username,
        displayName: w.displayName,
        primaryEmail: w.primaryEmail,
        identitySubject: w.identitySubject,
        state: w.desiredState,
        timestamps: timestampsFor(w.desiredState, nowIso),
        metadata: w.metadata
      };
      if (w.platformRoles !== undefined) projection.platformRoles = w.platformRoles;
      if (w.tenantMemberships !== undefined) projection.tenantMemberships = w.tenantMemberships;
      if (w.workspaceMemberships !== undefined) projection.workspaceMemberships = w.workspaceMemberships;
      if (w.iamBinding !== undefined) projection.iamBinding = w.iamBinding;
      return projection;
    }
  }
});

// ---- identifiers + fingerprints ---------------------------------------------
function randomToken() {
  return randomUUID().replace(/-/g, ''); // 32 hex chars, matches [0-9a-z]
}
export function generateEntityId(prefix) {
  return `${prefix}_${randomToken()}`;
}
// Stable, order-independent fingerprint of a validated write request so a replay
// with the same semantic body is recognised and a different body is a conflict.
export function requestFingerprint(normalized) {
  return createHash('sha256').update(stableStringify(normalized)).digest('hex');
}
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export class GovernanceConflictError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'GovernanceConflictError';
    this.code = code;
    this.statusCode = 409;
  }
}
export class ReferencedEntityNotFoundError extends Error {
  constructor(message, code = 'REFERENCED_ENTITY_NOT_FOUND') {
    super(message);
    this.name = 'ReferencedEntityNotFoundError';
    this.code = code;
    this.statusCode = 404;
  }
}

// ---- reads -------------------------------------------------------------------
export async function getEntityProjection(client, { entityType, entityId, parentId = null }) {
  const params = [entityType, entityId];
  let sql = `SELECT projection, parent_id FROM platform_governance_entities WHERE entity_type = $1 AND entity_id = $2`;
  if (parentId !== null) {
    params.push(parentId);
    sql += ` AND parent_id = $3`;
  }
  const res = await client.query(sql, params);
  if (!res.rows?.length) return null;
  return res.rows[0].projection;
}

async function entityExists(client, { entityType, entityId }) {
  const res = await client.query(
    `SELECT 1 FROM platform_governance_entities WHERE entity_type = $1 AND entity_id = $2 LIMIT 1`,
    [entityType, entityId]
  );
  return Boolean(res.rows?.length);
}

function mutationAcceptedFromCommand(row, spec) {
  if (row.response_body && typeof row.response_body === 'object') return row.response_body;
  const envelope = {
    commandId: row.command_id,
    requestId: row.request_id,
    entityType: spec.mutationEntityType,
    entityId: row.entity_id,
    status: 'accepted',
    acceptedEventType: row.accepted_event_type,
    desiredState: row.desired_state,
    correlationId: row.correlation_id,
    acceptedAt: row.accepted_at instanceof Date ? row.accepted_at.toISOString() : String(row.accepted_at)
  };
  return envelope;
}

/**
 * Validate + accept a platform-governance write as an idempotent command.
 *
 * Runs in a single transaction on the injected client. Returns
 * `{ envelope, replayed, entityId }`. Throws ValidationError (400),
 * GovernanceConflictError (409) or ReferencedEntityNotFoundError (404).
 *
 * @param {import('pg').PoolClient} client   dedicated transactional client
 * @param {object} args
 * @param {string} args.entityType
 * @param {object} args.body                 raw request body
 * @param {string|null} args.idempotencyKey
 * @param {string} args.correlationId
 * @param {string} args.actorId
 * @param {string|null} [args.parentId]      owning plan id for quota_policy
 * @param {()=>string} [args.now]            ISO clock (injectable for tests)
 */
export async function acceptEntityCommand(client, {
  entityType,
  operationId,
  body,
  idempotencyKey,
  correlationId,
  actorId,
  parentId = null,
  entityIdOverride = null,
  referenceValidator = null,
  now = () => new Date().toISOString(),
  idempotencyTtlSeconds = 86_400
}) {
  const spec = ENTITY_SPECS[entityType];
  if (!spec) throw new ValidationError(`unknown entity type ${entityType}`, 'UNKNOWN_ENTITY_TYPE');
  const normalized = spec.validate(body);
  const fingerprint = requestFingerprint({ ...normalized, __parentId: parentId ?? null });

  if (typeof operationId !== 'string' || !operationId) throw new ValidationError('operationId is required', 'INVALID_OPERATION');
  if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
    throw new ValidationError('Idempotency-Key is required and must contain 8-128 safe characters', 'INVALID_IDEMPOTENCY_KEY');
  }
  if (typeof actorId !== 'string' || !actorId) throw new ValidationError('verified actor is required', 'INVALID_ACTOR');

  await client.query('BEGIN');
  try {
    const lockKey = `c08:idempotency:${operationId}:${actorId}:${idempotencyKey}`;
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::int8)', [lockKey]);
    // Remove the actor/operation-scoped replay receipt only after its contractual 24h
    // retention has elapsed.  The domain entity and audit evidence remain durable.
    await client.query(
      `DELETE FROM platform_governance_idempotency
        WHERE operation_id = $1 AND actor_id = $2 AND idempotency_key = $3 AND expires_at <= NOW()`,
      [operationId, actorId, idempotencyKey]
    );
    const existing = await client.query(
      `SELECT c.*, i.request_fingerprint AS replay_fingerprint, i.response_body AS replay_response_body
         FROM platform_governance_idempotency i
         JOIN platform_governance_commands c ON c.command_id = i.command_id
        WHERE i.operation_id = $1 AND i.actor_id = $2 AND i.idempotency_key = $3`,
      [operationId, actorId, idempotencyKey]
    );
    if (existing.rows?.length) {
      const row = existing.rows[0];
      if (row.replay_fingerprint !== fingerprint) {
        throw new GovernanceConflictError('idempotency key reused with a different request body', 'IDEMPOTENCY_KEY_CONFLICT');
      }
      row.response_body = row.replay_response_body;
      await client.query('COMMIT');
      return { envelope: mutationAcceptedFromCommand(row, spec), replayed: true, entityId: row.entity_id };
    }

    // Referential integrity (e.g. plan -> deployment profile + quota policy).
    for (const ref of (spec.references?.(normalized) ?? [])) {
      if (!(await entityExists(client, ref))) {
        throw new ReferencedEntityNotFoundError(`referenced ${ref.entityType} ${ref.entityId} does not exist`);
      }
    }
    if (referenceValidator) await referenceValidator(client, normalized, entityIdOverride);

    const nowIso = now();
    const entityId = entityIdOverride ?? generateEntityId(spec.idPrefix);
    if (!ENTITY_ID_PATTERNS[entityType]?.test(entityId)) {
      throw new ValidationError(`allocated ${entityType} id is malformed`, 'INVALID_ENTITY_ID');
    }
    const projection = spec.buildProjection(normalized, { entityId, nowIso });
    const slugKey = spec.slugKey(normalized);

    // Insert the projection; a unique-slug violation is a published conflict.
    try {
      await client.query(
        `INSERT INTO platform_governance_entities (entity_type, entity_id, parent_id, slug, state, projection, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $7)`,
        [entityType, entityId, parentId, slugKey, normalized.desiredState, JSON.stringify(projection), nowIso]
      );
    } catch (e) {
      if (e?.code === '23505') {
        throw new GovernanceConflictError(`${entityType} slug already exists in this scope`, spec.conflictCode ?? 'SLUG_CONFLICT');
      }
      throw e;
    }

    // Membership objects are self-referential: keep their userId bound to the actual
    // allocated platform user instead of persisting a projection for another identity.
    if (entityType === 'platform_user') {
      for (const membership of [...(projection.tenantMemberships ?? []), ...(projection.workspaceMemberships ?? [])]) {
        if (membership.userId !== entityId) {
          throw new ValidationError('membership userId must equal the allocated platform user id', 'MEMBERSHIP_USER_MISMATCH');
        }
      }
    }

    const commandId = `cmd_${randomToken()}`;
    const requestId = `req_${randomToken()}`;
    const acceptedAt = new Date(nowIso);
    const expiresAt = new Date(acceptedAt.getTime() + idempotencyTtlSeconds * 1000).toISOString();
    const envelope = mutationAcceptedFromCommand({
      command_id: commandId, request_id: requestId, entity_id: entityId,
      accepted_event_type: spec.acceptedEventType, desired_state: normalized.desiredState,
      correlation_id: correlationId, accepted_at: nowIso
    }, spec);
    await client.query(
      `INSERT INTO platform_governance_commands
         (command_id, operation_id, request_id, idempotency_key, entity_type, entity_id,
          parent_id, request_fingerprint, response_body, accepted_event_type, desired_state,
          correlation_id, actor_id, accepted_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15)`,
      [commandId, operationId, requestId, idempotencyKey, entityType, entityId, parentId,
        fingerprint, JSON.stringify(envelope), spec.acceptedEventType, normalized.desiredState,
        correlationId, actorId, nowIso, expiresAt]
    );
    await client.query(
      `INSERT INTO platform_governance_idempotency
         (operation_id, actor_id, idempotency_key, command_id, request_fingerprint, response_body, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
      [operationId, actorId, idempotencyKey, commandId, fingerprint, JSON.stringify(envelope), expiresAt]
    );

    // Append one tamper-evident audit record in this SAME transaction.  The platform
    // chain has its own lock because tenant plan_audit_events cannot represent global scope.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::int8)', ['c08:platform-audit']);
    const previous = await client.query(
      `SELECT row_hash FROM platform_governance_audit
        ORDER BY created_at DESC, audit_id DESC LIMIT 1`
    );
    const prevHash = previous.rows?.[0]?.row_hash ?? '';
    const auditId = `aud_${randomToken()}`;
    const detail = { desiredState: normalized.desiredState, parentId: parentId ?? null };
    const auditCanonical = stableStringify({
      auditId, commandId, operationId, actorId, entityType, entityId, correlationId,
      acceptedEventType: spec.acceptedEventType, outcome: 'accepted', detail, createdAt: nowIso
    });
    const rowHash = createHash('sha256').update(`${auditCanonical}\n${prevHash}`).digest('hex');
    await client.query(
      `INSERT INTO platform_governance_audit
         (audit_id, command_id, operation_id, actor_id, entity_type, entity_id,
          correlation_id, accepted_event_type, outcome, detail, created_at, prev_hash, row_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'accepted',$9::jsonb,$10,$11,$12)`,
      [auditId, commandId, operationId, actorId, entityType, entityId, correlationId,
        spec.acceptedEventType, JSON.stringify(detail), nowIso, prevHash, rowHash]
    );
    await client.query('COMMIT');
    return {
      envelope,
      replayed: false,
      entityId
    };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  }
}

export const ENTITY_ID_PATTERNS = Object.freeze({
  deployment_profile: /^dpf_[0-9a-z]+$/,
  plan: /^pln_[0-9a-z]+$/,
  quota_policy: /^qta_[0-9a-z]+$/,
  provider_capability: /^pvc_[0-9a-z]+$/,
  platform_user: /^usr_[0-9a-z]+$/
});
