// Domain B handlers (local to the control-plane): tenant lifecycle + user
// management. These are REAL implementations of what the repo only stubs
// (workflows/wf-con-002.mjs). Each handler: async (ctx) => { statusCode, body }
// where ctx = { params, query, body, identity, pool, callerContext }.
import { createHash, randomUUID } from 'node:crypto';
import { kcAdmin, safeKeycloakAdminMessage, TENANT_REALM_ROLES } from './kc-admin.mjs';
import * as store from './tenant-store.mjs';
import { AUTH_HANDLERS } from './auth-handlers.mjs';
import { startSaga } from './saga.mjs';
import { provisionWorkspaceDatabase, rotateWorkspaceDatabaseCredential, dropWorkspaceDatabase } from './dataplane.mjs';
import { deleteBucket } from './storage-handlers.mjs';
import { deleteTopics } from './kafka-handlers.mjs';
import { METRICS_HANDLERS } from './metrics-handlers.mjs';
import { STORAGE_HANDLERS } from './storage-handlers.mjs';
import { MONGO_HANDLERS, mongoTeardown, mongoClient } from './mongo-handlers.mjs';
import { PG_HANDLERS } from './pg-handlers.mjs';
import { KAFKA_HANDLERS } from './kafka-handlers.mjs';
import { FN_HANDLERS } from './fn-handlers.mjs';
import { WEBHOOK_HANDLERS } from './webhook-handlers.mjs';
import { REALTIME_HANDLERS } from './realtime-handlers.mjs';
import { APPLICATION_HANDLERS } from './application-handlers.mjs';
import { KNATIVE_RUNTIME_HANDLERS } from './knative-runtime-handlers.mjs';
import { checkWorkspaceQuota } from './workspace-quota.mjs';
import { recordScopeDenial, recordQuotaEnforcement } from './audit-writer.mjs';
import { buildTenantConfigExport } from './tenant-config-export.mjs';

function slugify(s) {
  return String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
}
const ok = (statusCode, body) => ({ statusCode, body });
const err = (statusCode, code, message) => ({ statusCode, body: { code, message } });
function statusFromError(error, fallback = 502) {
  const status = Number(error?.statusCode ?? error?.kcStatus);
  return status >= 400 && status < 500 ? status : fallback;
}
function kcBackedErr(error, code) {
  return err(statusFromError(error), code, safeKeycloakAdminMessage(error));
}

// A plan id in the catalog is a UUID; the console CreateTenantWizard sends a SLUG (e.g. "starter").
// Detect so we can resolve a slug -> id before the real plan-assign action (which keys on the UUID).
function isPlanUuid(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id ?? ''));
}

// Assign a plan to a freshly-created tenant BEST-EFFORT (fix-console-create-tenant-plan). Plan
// assignment is optional (see createTenant), so an unresolvable/invalid plan must NEVER abort tenant
// creation. Resolve a slug -> id, assign when the plan exists, and otherwise return a structured
// {assigned:false, reason} instead of throwing — previously a non-uuid planId (the wizard's slug)
// made the assignPlan saga step throw "invalid input syntax for type uuid", rolling the tenant back
// with a 502. Loaders are injectable so the resolution/best-effort logic is unit-testable.
async function assignPlanBestEffort(pool, { tenantId, planId, assignedBy }, deps = {}) {
  const loadPlanRepo = deps.loadPlanRepo
    ?? (() => import('/repo/packages/provisioning-orchestrator/src/repositories/plan-repository.mjs'));
  const loadPlanAssign = deps.loadPlanAssign
    ?? (async () => (await import('/repo/packages/provisioning-orchestrator/src/actions/plan-assign.mjs')).main);
  try {
    let resolvedPlanId = planId;
    if (!isPlanUuid(planId)) {
      const planRepo = await loadPlanRepo();
      const plan = await planRepo.findBySlug(pool, planId);
      if (!plan) return { assigned: false, requestedPlanId: planId, reason: `no plan matches "${planId}"` };
      resolvedPlanId = plan.id;
    }
    const planAssign = await loadPlanAssign();
    const res = await planAssign(
      { tenantId, planId: resolvedPlanId, assignedBy, callerContext: { actor: { id: assignedBy, type: 'superadmin' } } },
      { db: pool });
    return { assigned: true, ...(res?.body ?? {}) };
  } catch (e) {
    return { assigned: false, requestedPlanId: planId, reason: String(e?.message ?? e) };
  }
}

// The web-console SPA consumes camelCase shapes ({tenantId, workspaceId,
// displayName, slug, state} and {items, page}); our rows are snake_case. Map at
// the edge, keeping the original columns too so existing API callers still work.
function tenantOut(t) {
  return { ...t, tenantId: t.id, displayName: t.display_name, slug: t.slug,
    state: t.status, iamRealm: t.iam_realm,
    // The console Members page resolves the realm from identityContext.consoleUserRealm.
    identityContext: { consoleUserRealm: t.iam_realm } };
}
function workspaceOut(w) {
  return { ...w, workspaceId: w.id, tenantId: w.tenant_id, displayName: w.display_name,
    slug: w.slug, state: w.status, environment: w.environment ?? null };
}
const collection = (items, total) => ({ items, total, page: { after: null, size: items.length } });

// Map a service_accounts row -> the console's ConsoleServiceAccount shape
// (serviceAccountId/iamBinding/credentialStatus/accessProjection/credentials).
function serviceAccountOut(sa) {
  const active = sa.status === 'active';
  return {
    serviceAccountId: sa.id,
    displayName: sa.display_name,
    entityType: 'service_account',
    desiredState: active ? 'active' : 'suspended',
    expiresAt: null,
    iamBinding: { realm: sa.iam_realm ?? null, clientId: sa.kc_client_id, credentialRef: sa.kc_client_id },
    credentialStatus: { state: sa.status === 'revoked' ? 'revoked' : 'active', issuedAt: sa.created_at ?? null, expiresAt: null, lastUsedAt: null },
    accessProjection: { effectiveAccess: active ? 'granted' : 'blocked', blockedByTenantSuspension: false,
      clientState: active ? 'enabled' : 'disabled', credentialState: sa.status === 'revoked' ? 'revoked' : 'active' },
    credentials: [{ credentialId: sa.kc_client_id, issuedAt: sa.created_at ?? null, expiresAt: null, status: sa.status }]
  };
}

// POST /v1/tenants  (superadmin) — create the tenant end-to-end:
//   Keycloak realm + standard realm roles (+ optional owner user) + DB record
//   (+ optional plan assignment). Best-effort compensation on failure.
async function createTenant(ctx) {
  const { body, identity, pool } = ctx;
  // Dependency seam (same idiom as issueCredential/rotateCredential below): tests inject
  // store/kcAdmin/startSaga via ctx; production never sets them (server.mjs builds ctx without
  // these keys), so the live path uses the module singletons unchanged.
  const st = ctx.store ?? store;
  const kc = ctx.kcAdmin ?? kcAdmin;
  const beginSaga = ctx.startSaga ?? startSaga;
  const displayName = body.displayName ?? body.name;
  if (!displayName) return err(400, 'VALIDATION_ERROR', 'displayName is required');
  const slug = slugify(body.slug ?? displayName);
  if (!slug) return err(400, 'VALIDATION_ERROR', 'a valid slug could not be derived');
  if (await st.slugTaken(pool, slug)) return err(409, 'SLUG_TAKEN', `tenant slug '${slug}' already exists`);

  const tenantId = randomUUID();
  const realm = tenantId; // realm name == tenantId (Falcone tenancy model)
  let realmExists;
  try { realmExists = await kc.realmExists(realm); }
  catch (e) { return kcBackedErr(e, 'CREATE_TENANT_FAILED'); }
  if (realmExists) return err(409, 'REALM_EXISTS', `realm ${realm} already exists`);

  // Durable saga: each forward step records a serializable compensation in
  // Postgres, so a crash mid-provision is rolled back (here on failure, or by
  // recoverSagas() on the next startup) — no orphaned realm / DB row.
  const saga = await beginSaga(pool, 'createTenant', { tenantId, slug, displayName }, {
    tenantId, actorId: identity.sub, actorType: identity.actorType ?? 'superadmin',
    correlationId: ctx.callerContext?.correlationId, operationType: 'tenant.create'
  });
  try {
    await saga.step('createRealm',
      () => kc.createRealm({ realm, displayName }),
      { type: 'kc.deleteRealm', args: { realm } });
    // Roles live inside the realm; deleting the realm (above) compensates them.
    await saga.step('createRealmRoles',
      async () => { for (const role of TENANT_REALM_ROLES) await kc.createRealmRole(realm, role); });

    // Tenant-realm app client + un-forgeable tenant_id claim (fix-tenant-realm-token-issuance, A3).
    // Without a client the tenant realm cannot issue tokens at all; the hardcoded tenant_id mapper
    // stamps the owning tenant id (== realm name) so tokens carry tenant_id for claim consumers,
    // while the executor independently derives it from the verified issuer. (No separate
    // compensation: the client lives in the realm, which createRealm's compensation deletes.)
    await saga.step('createTenantAppClient',
      async () => {
        const clientUuid = await kc.createPublicAppClient(realm, { clientId: `${slug}-app`, name: `${displayName} App` });
        await kc.addHardcodedClaimMapper(realm, clientUuid, { name: 'tenant_id', claimName: 'tenant_id', claimValue: tenantId });
      });

    let owner = null;
    if (body.ownerUsername || body.ownerEmail) {
      const username = body.ownerUsername ?? body.ownerEmail;
      const userId = await saga.step('createOwnerUser',
        async () => {
          const id = await kc.createUser(realm, {
            username, email: body.ownerEmail ?? null,
            firstName: body.ownerFirstName ?? 'Tenant', lastName: body.ownerLastName ?? 'Owner',
            password: body.ownerPassword ?? null, temporary: !body.ownerPassword
          });
          await kc.assignRealmRoles(realm, id, ['tenant_owner']);
          return id;
        });
      owner = { id: userId, username };
    }

    const record = await saga.step('insertTenant',
      () => st.insertTenant(pool, { id: tenantId, slug, displayName, iamRealm: realm, createdBy: identity.sub }),
      { type: 'store.deleteTenant', args: { id: tenantId } });

    // Optional: assign a plan immediately (reuses the REAL plan-assign action). BEST-EFFORT —
    // resolves a slug->id and never throws, so an unknown/empty-catalog plan does not roll the
    // tenant back (fix-console-create-tenant-plan).
    let planAssignment = null;
    if (body.planId) {
      planAssignment = await saga.step('assignPlan',
        () => assignPlanBestEffort(pool, { tenantId, planId: body.planId, assignedBy: identity.sub }));
    }

    await saga.complete({ tenantId, realm });
    return ok(201, { tenant: tenantOut(record), ...tenantOut(record), iamRealm: realm, owner, planAssignment, sagaId: saga.runId });
  } catch (e) {
    await saga.fail(e); // durable: replays recorded compensations newest-first (loser's realm/client/owner roll back)
    // Concurrent same-slug create (#665, the tenant twin of the workspace fix #634): the slugTaken
    // pre-check above is a TOCTOU read — two racers both pass it, then the UNIQUE constraint
    // tenants_slug_key (the real atomicity guarantee) makes the loser's insertTenant throw SQLSTATE
    // 23505. Map it to the SAME clean 409 SLUG_TAKEN the sequential pre-check emits — so the race and
    // a sequential collision are indistinguishable to clients — instead of leaking the raw PG
    // constraint text as a 502. Keyed on the named constraint (slug is the ONLY unique column the
    // tenants insert can violate: id/tenant_id are randomUUID, iam_realm is not UNIQUE), with a bare
    // 23505 fallback when the driver omits .constraint, so an unrelated future 23505 still 502s.
    if (e?.code === '23505' && (e?.constraint === 'tenants_slug_key' || !e?.constraint)) {
      return err(409, 'SLUG_TAKEN', `tenant slug '${slug}' already exists`);
    }
    return kcBackedErr(e, 'CREATE_TENANT_FAILED');
  }
}

// GET /v1/tenants  (superadmin) — list tenants from the registry.
async function listTenants(ctx) {
  const { query, pool } = ctx;
  const limit = Number(query['page[size]'] ?? query.limit ?? 100) || 100;
  const offset = Number(query.offset ?? 0) || 0;
  const res = await store.listTenants(pool, { limit, offset });
  return ok(200, collection(res.items.map(tenantOut), res.total));
}

// GET /v1/tenants/{tenantId}  (superadmin any; tenant_owner own) — get one.
async function getTenant(ctx) {
  const { params, identity, pool } = ctx;
  const t = await store.getTenant(pool, params.tenantId);
  if (!t) return err(404, 'TENANT_NOT_FOUND', `tenant ${params.tenantId} not found`);
  if (identity.actorType !== 'superadmin' && identity.actorType !== 'internal' && identity.tenantId !== t.id)
    return err(403, 'FORBIDDEN', 'cannot read another tenant');
  return ok(200, { tenant: tenantOut(t), ...tenantOut(t) });
}

function canManageTenant(identity, tenant) {
  if (identity.actorType === 'superadmin' || identity.actorType === 'internal') return true;
  return ['tenant_owner', 'tenant_admin'].includes(identity.actorType) && identity.tenantId === tenant.id;
}

// POST /v1/tenants/{tenantId}/users  (superadmin or tenant_owner/admin of it)
//   Create a user in the tenant's realm + assign realm roles.
async function createTenantUser(ctx) {
  const { params, body, identity, pool } = ctx;
  const t = await store.getTenant(pool, params.tenantId);
  if (!t) return err(404, 'TENANT_NOT_FOUND', `tenant ${params.tenantId} not found`);
  if (!canManageTenant(identity, t)) return err(403, 'FORBIDDEN', 'requires superadmin or tenant owner/admin of this tenant');
  const username = body.username ?? body.email;
  if (!username) return err(400, 'VALIDATION_ERROR', 'username or email is required');
  const roles = Array.isArray(body.roles) && body.roles.length ? body.roles : ['tenant_developer'];
  const bad = roles.filter((r) => !TENANT_REALM_ROLES.includes(r));
  if (bad.length) return err(400, 'INVALID_ROLE', `unknown realm roles: ${bad.join(', ')}`);
  const kc = ctx.kcAdmin ?? kcAdmin;
  try {
    const userId = await kc.createUser(t.iam_realm, {
      username, email: body.email ?? null, firstName: body.firstName ?? null, lastName: body.lastName ?? null,
      password: body.password ?? null, temporary: !body.password
    });
    await kc.assignRealmRoles(t.iam_realm, userId, roles);
    return ok(201, { userId, username, realm: t.iam_realm, roles });
  } catch (e) {
    return kcBackedErr(e, 'CREATE_USER_FAILED');
  }
}

// GET /v1/tenants/{tenantId}/users  (superadmin or tenant owner/admin)
async function listTenantUsers(ctx) {
  const { params, identity, pool } = ctx;
  const t = await store.getTenant(pool, params.tenantId);
  if (!t) return err(404, 'TENANT_NOT_FOUND', `tenant ${params.tenantId} not found`);
  if (!canManageTenant(identity, t)) return err(403, 'FORBIDDEN', 'requires superadmin or tenant owner/admin of this tenant');
  const kc = ctx.kcAdmin ?? kcAdmin;
  let users;
  try { users = await kc.listUsers(t.iam_realm, { max: Number(params.max ?? ctx.query.max ?? 100) }); }
  catch (e) { return kcBackedErr(e, 'IAM_LIST_TENANT_USERS_FAILED'); }
  return ok(200, {
    items: users.map((u) => ({ id: u.id, username: u.username, email: u.email, enabled: u.enabled,
      firstName: u.firstName, lastName: u.lastName, createdTimestamp: u.createdTimestamp })),
    total: users.length, realm: t.iam_realm
  });
}

function canManageTenantId(identity, tenantId) {
  if (identity.actorType === 'superadmin' || identity.actorType === 'internal') return true;
  return ['tenant_owner', 'tenant_admin'].includes(identity.actorType) && identity.tenantId === tenantId;
}

const INVITATION_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITATION_EMAIL_HASH_RE = /^[0-9a-f]{64}$/i;
const INVITATION_ROLE_ALIASES = new Map([
  ['viewer', 'workspace_viewer'],
  ['editor', 'workspace_developer']
]);
const INVITABLE_ROLES = new Set(TENANT_REALM_ROLES);

function compactId(prefix) {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

function normalizeInvitationRole(role) {
  const raw = String(role ?? '').trim();
  return INVITATION_ROLE_ALIASES.get(raw) ?? raw;
}

function emailHash(email) {
  return createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex');
}

function normalizeEmailHash(hash) {
  if (typeof hash !== 'string') return null;
  const candidate = hash.trim();
  return INVITATION_EMAIL_HASH_RE.test(candidate) ? candidate.toLowerCase() : null;
}

function maskEmail(email) {
  const [local = '', domain = ''] = String(email).trim().split('@');
  if (!local || !domain) return null;
  const visibleLocal = local.length === 1
    ? '*'
    : local.length === 2
      ? `${local[0]}*`
      : `${local[0]}${'*'.repeat(Math.min(local.length - 2, 6))}${local.at(-1)}`;
  return `${visibleLocal}@${domain}`;
}

function isWorkspaceInviteOperator(identity, workspaceId, tenantId) {
  if (!identity || !workspaceId || identity.tenantId !== tenantId) return false;
  const roles = new Set(identity.roles ?? []);
  const isWorkspaceOperator = identity.actorType === 'workspace_admin'
    || roles.has('workspace_owner')
    || roles.has('workspace_admin');
  if (!isWorkspaceOperator) return false;
  const workspaceIds = new Set([identity.workspaceId, ...(identity.workspaceIds ?? [])].filter(Boolean).map(String));
  return workspaceIds.has(workspaceId);
}

function invitationExpiresAt(body) {
  const supplied = Date.parse(body.expiresAt ?? '');
  if (Number.isFinite(supplied) && supplied > Date.now()) return new Date(supplied).toISOString();
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
}

function invitationTargetBindings({ tenantId, workspaceId, role }) {
  const bindings = [{ bindingType: 'tenant', bindingRef: tenantId }];
  if (role.startsWith('workspace_')) {
    bindings.push({ bindingType: 'workspace', bindingRef: workspaceId });
  }
  return bindings;
}

function invitationBody(body, { tenantId, workspaceId, actorId }) {
  const role = normalizeInvitationRole(body.role ?? body.roleName);
  if (!role) return { error: err(400, 'VALIDATION_ERROR', 'role is required') };
  if (!INVITABLE_ROLES.has(role)) return { error: err(400, 'INVALID_ROLE', `unknown invitation role: ${role}`) };
  const rawEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (rawEmail && !INVITATION_EMAIL_RE.test(rawEmail)) {
    return { error: err(400, 'VALIDATION_ERROR', 'email must be a valid email address') };
  }
  const suppliedHash = normalizeEmailHash(body.emailHash);
  const hasMalformedHash = typeof body.emailHash === 'string' && body.emailHash.trim() && !suppliedHash;
  const hash = rawEmail ? emailHash(rawEmail) : suppliedHash;
  if (!hash) {
    return {
      error: err(
        400,
        'VALIDATION_ERROR',
        hasMalformedHash
          ? 'emailHash must be a SHA-256 hex digest'
          : 'email or emailHash is required'
      )
    };
  }
  if (role.startsWith('workspace_') && !workspaceId) {
    return { error: err(400, 'VALIDATION_ERROR', 'workspaceId is required for workspace roles') };
  }
  const message = typeof body.message === 'string' && body.message.trim()
    ? body.message.trim().slice(0, 500)
    : null;
  const metadata = {};
  if (message) metadata.message = message;
  const targetBindings = invitationTargetBindings({ tenantId, workspaceId, role });
  return {
    invitation: {
      id: compactId('inv'),
      tenantId,
      workspaceId,
      emailHash: hash,
      maskedEmail: rawEmail ? maskEmail(rawEmail) : null,
      role,
      status: 'pending',
      expiresAt: invitationExpiresAt(body),
      metadata,
      targetBindings,
      createdBy: actorId
    }
  };
}

// POST /v1/tenants/{tenantId}/invitations — canonical public invitation route.
// Tenant owners/admins can invite at tenant scope; workspace owners/admins can
// invite only into a workspace explicitly bound to their verified token.
async function createInvitation(ctx) {
  const { params, body = {}, identity, pool } = ctx;
  const st = ctx.store ?? store;
  const tenant = await st.getTenant(pool, params.tenantId);
  if (!tenant) return err(404, 'TENANT_NOT_FOUND', `tenant ${params.tenantId} not found`);

  const workspaceId = body.workspaceId ?? null;
  let workspace = null;
  if (workspaceId) {
    workspace = await st.getWorkspace(pool, workspaceId);
    if (!workspace || workspace.tenant_id !== tenant.id) {
      return err(404, 'WORKSPACE_NOT_FOUND', `workspace ${workspaceId} not found`);
    }
  }

  const isTenantManager = canManageTenant(identity, tenant);
  const isWorkspaceOperator = isWorkspaceInviteOperator(identity, workspace?.id ?? workspaceId, tenant.id);
  const allowed = isTenantManager || isWorkspaceOperator;
  if (!allowed) return err(403, 'FORBIDDEN', 'requires tenant owner/admin or workspace owner/admin for the target workspace');

  const parsed = invitationBody(body, {
    tenantId: tenant.id,
    workspaceId: workspace?.id ?? workspaceId,
    actorId: identity?.sub ?? 'unknown'
  });
  if (parsed.error) return parsed.error;
  if (!isTenantManager && !parsed.invitation.role.startsWith('workspace_')) {
    return err(403, 'FORBIDDEN', 'workspace invite operators can only grant workspace roles');
  }

  const invitation = await st.insertInvitation(pool, parsed.invitation);
  const acceptedAt = new Date().toISOString();
  return ok(202, {
    commandId: compactId('cmd'),
    requestId: compactId('req'),
    entityType: 'invitation',
    entityId: invitation?.id ?? parsed.invitation.id,
    tenantId: tenant.id,
    workspaceId: workspace?.id ?? workspaceId ?? undefined,
    status: 'accepted',
    acceptedEventType: 'iam.invitation.created',
    desiredState: 'active',
    correlationId: ctx.callerContext?.correlationId ?? compactId('corr'),
    acceptedAt
  });
}

// ---- tenant offboarding (add-tenant-delete-purge-cascade #501) --------------
// DELETE /v1/tenants/{tenantId} — soft delete: mark the tenant 'deleted' (reversible;
// resources are retained until an explicit purge). Returns 404 only if the tenant is unknown.
async function deleteTenant(ctx) {
  const { params, identity, pool } = ctx;
  const tenant = await store.getTenant(pool, params.tenantId);
  if (!tenant) return err(404, 'TENANT_NOT_FOUND', `tenant ${params.tenantId} not found`);
  if (!canManageTenantId(identity, tenant.id)) return err(403, 'FORBIDDEN', 'requires superadmin or tenant owner/admin');
  const rec = await store.markTenantDeleted(pool, tenant.id);
  return ok(200, { tenant: { id: tenant.id, status: rec?.status ?? 'deleted' },
    message: 'tenant marked deleted; POST /v1/tenants/{id}/purge to remove all owned resources' });
}

// POST /v1/tenants/{tenantId}/purge — hard cascade: remove EVERY resource the tenant owns
// (workspaces, databases, realms, buckets, topics, keys, registry rows, async-op rows), leaving
// no orphaned data. Physical teardown (DB drop, realm delete) is reliable; bucket/topic teardown
// is best-effort (the registry rows are removed regardless, so no orphaned rows remain).
async function purgeTenant(ctx) {
  const { params, identity, pool } = ctx;
  const tenant = await store.getTenant(pool, params.tenantId);
  if (!tenant) return err(404, 'TENANT_NOT_FOUND', `tenant ${params.tenantId} not found`);
  if (!canManageTenantId(identity, tenant.id)) return err(403, 'FORBIDDEN', 'requires superadmin or tenant owner/admin');
  const realm = tenant.iam_realm;

  // 1. Delete all registry rows + collect the physical resources to tear down.
  const phys = await store.purgeTenant(pool, tenant.id);
  // 2. Drop each physical workspace database (catalog-level isolation teardown).
  const databasesDropped = [];
  for (const db of phys.databases) { try { await dropWorkspaceDatabase(pool, db); databasesDropped.push(db); } catch { /* best-effort */ } }
  // 3. Delete the tenant's Keycloak realm — cascades its clients, users, and roles.
  let realmDeleted = false;
  if (realm) { try { await kcAdmin.deleteRealm(realm); realmDeleted = true; } catch { /* best-effort */ } }
  // 4. Best-effort physical object-store + topic teardown (rows already removed above).
  const bucketsDeleted = [];
  for (const b of phys.buckets) { try { await deleteBucket(b); bucketsDeleted.push(b); } catch { /* best-effort */ } }
  let topicsDeleted = [];
  try { await deleteTopics(phys.topics); topicsDeleted = phys.topics; } catch { /* best-effort */ }
  // 5. Isolation-safe FerretDB document teardown (fix-tenant-purge-ferretdb-cascade, #682):
  //    delete THIS tenant's documents (by tenantId) from each recorded mongo db and drop a
  //    db only when it is empty across ALL tenants (a same-named shared db with another
  //    tenant's data is RETAINED). Best-effort — never aborts the purge (rows already removed).
  const mongo = await tearDownMongo(ctx, tenant.id, phys.mongoDatabases);

  return ok(200, {
    tenantId: tenant.id, purged: true,
    removed: {
      workspaces: phys.workspaceIds.length,
      databases: databasesDropped, realm: realmDeleted ? realm : null,
      buckets: bucketsDeleted, topics: topicsDeleted,
      // FerretDB databases physically dropped (empty across all tenants); `mongoDatabasesRetained`
      // are same-named shared dbs kept because another tenant still has data (only this tenant's
      // documents were removed).
      mongoDatabases: mongo.dropped, mongoDatabasesRetained: mongo.retained,
    },
    // Resources whose physical teardown is not wired in this runtime (rows ARE removed).
    residual: { knativeServices: phys.ksvcs },
  });
}

// Run the isolation-safe FerretDB teardown for a purge/delete, best-effort. The mongo
// client + teardown fn are injectable via ctx (mirrors deleteWorkspace's ctx.* seams and
// mongo-handlers' ctx.mongoClient) so the cascade is testable with a fake client. A failure
// here NEVER aborts the caller — it returns empty results and the caller proceeds.
async function tearDownMongo(ctx, tenantId, databaseNames) {
  const names = (databaseNames ?? []).filter(Boolean);
  if (!names.length) return { dropped: [], retained: [], errors: [] };
  const teardown = ctx.mongoTeardown ?? mongoTeardown;
  try {
    const client = ctx.mongoClient ?? await mongoClient();
    return await teardown({ client, tenantId, databaseNames: names });
  } catch (e) {
    return { dropped: [], retained: [], errors: [{ error: String(e?.message ?? e) }] };
  }
}

// First-class environment catalog (#503). The set of runtime environments a workspace may belong
// to; a tenant/project holds multiple workspaces across these, each environment carrying its own
// isolated resource set (its per-workspace wsdb_* database, bucket, topics).
const ENVIRONMENT_CATALOG = ['dev', 'staging', 'prod', 'sandbox', 'preview'];

// GET /v1/tenants/{tenantId}/environments — list the tenant's first-class environments, each with
// its workspaces + provisioned databases (proves multiple isolated environments per project).
async function listEnvironments(ctx) {
  const { params, identity, pool } = ctx;
  const tenant = await store.getTenant(pool, params.tenantId);
  if (!tenant) return err(404, 'TENANT_NOT_FOUND', `tenant ${params.tenantId} not found`);
  if (!canManageTenantId(identity, tenant.id)) return err(403, 'FORBIDDEN', 'requires superadmin or tenant owner/admin');
  const environments = await store.listTenantEnvironments(pool, tenant.id);
  return ok(200, { tenantId: tenant.id, catalog: ENVIRONMENT_CATALOG, environments });
}

// ---- workspaces ------------------------------------------------------------
// POST /v1/tenants/{tenantId}/workspaces
async function createWorkspace(ctx) {
  const { params, body, identity, pool } = ctx;
  const tenant = await store.getTenant(pool, params.tenantId);
  if (!tenant) return err(404, 'TENANT_NOT_FOUND', `tenant ${params.tenantId} not found`);
  if (!canManageTenantId(identity, tenant.id)) return err(403, 'FORBIDDEN', 'requires superadmin or tenant owner/admin');
  const displayName = body.displayName ?? body.name;
  if (!displayName) return err(400, 'VALIDATION_ERROR', 'displayName is required');
  const slug = slugify(body.slug ?? displayName);
  if (await store.workspaceSlugTaken(pool, tenant.id, slug)) return err(409, 'SLUG_TAKEN', `workspace slug '${slug}' already exists in tenant`);
  // Enforce the tenant's resolved max_workspaces entitlement (#556 BUG-QUOTA-ENFORCE).
  // Count BEFORE inserting and gate on the governance model (override → plan → default 3),
  // so the create that WOULD exceed the limit is rejected. Fails open if governance is
  // unavailable (availability over a non-isolation governance control).
  const usedWorkspaces = await store.countTenantWorkspaces(pool, tenant.id);
  const quota = await checkWorkspaceQuota(pool, tenant.id, usedWorkspaces);
  if (!quota.allowed) {
    // Record the quota denial (fix-audit-enforcement-logging #594) — best-effort, never blocks.
    await recordQuotaEnforcement(pool, {
      tenantId: tenant.id, dimensionKey: quota.dimensionKey ?? 'max_workspaces',
      attemptedAction: 'workspace.create', currentUsage: quota.currentUsage ?? usedWorkspaces,
      effectiveLimit: quota.effectiveLimit, quotaType: quota.quotaType, graceMargin: quota.graceMargin,
      effectiveCeiling: quota.effectiveCeiling, source: quota.source, decision: quota.decision,
      actorId: identity.sub, correlationId: ctx.callerContext?.correlationId, warning: quota.warning ?? null,
    });
    return err(402, 'QUOTA_EXCEEDED',
      `workspace quota reached (max_workspaces): ${usedWorkspaces}/${quota.effectiveLimit ?? '?'}`);
  }
  // First-class environment (#503): a workspace is the delivery boundary for one runtime
  // environment. Validate against the environment catalog (domain rule: "Workspace environment
  // must align with the deployment topology environment catalog"); default to 'dev'.
  const environment = String(body.environment ?? 'dev').toLowerCase();
  if (!ENVIRONMENT_CATALOG.includes(environment)) {
    return err(400, 'INVALID_ENVIRONMENT', `environment must be one of: ${ENVIRONMENT_CATALOG.join(', ')}`);
  }
  let ws;
  try {
    ws = await store.insertWorkspace(pool, { id: randomUUID(), tenantId: tenant.id, slug, displayName, environment, createdBy: identity.sub });
  } catch (e) {
    // Concurrent same-slug create (#634): the workspaceSlugTaken pre-check above is a TOCTOU read;
    // the (tenant_id, slug) UNIQUE constraint is the real atomicity guarantee. Map the loser's
    // unique-violation (SQLSTATE 23505) to a clean 409 Conflict instead of letting the raw
    // SQLSTATE surface as a 500 with code "23505".
    if (e?.code === '23505') return err(409, 'WORKSPACE_SLUG_CONFLICT', `workspace slug '${slug}' already exists in tenant`);
    throw e;
  }
  // Provision the workspace's real backing database as part of creation (#502), so the data API
  // routes to a real, isolated database instead of co-mingling in the shared control-plane DB.
  // Best-effort: the saga leaves NO orphaned registry row on failure, and the data API falls back
  // to the shared DB, so the workspace is still usable and provisioning can be retried via
  // POST /v1/workspaces/{id}/database. `database: null` signals the DB is not yet ready.
  let database = null;
  try {
    const out = await runWorkspaceDbProvisionSaga(pool, { ws, tenant, identity, callerContext: ctx.callerContext });
    database = out.database;
  } catch {
    database = null;
  }
  return ok(201, { workspace: workspaceOut(ws), ...workspaceOut(ws), database });
}
// GET /v1/workspaces  (superadmin: all; tenant scope: own tenant)
async function listWorkspaces(ctx) {
  const { query, identity, pool } = ctx;
  const isPlatform = identity.actorType === 'superadmin' || identity.actorType === 'internal';
  const filterTenant = query['filter[tenantId]'] ?? query.tenantId ?? null;
  const tenantId = isPlatform ? filterTenant : identity.tenantId;
  // Fail-closed (#800): a non-platform principal with no resolvable tenant must NEVER fall through
  // to the unscoped (all-tenants) listing. By-id reads already 403 such a principal (canManageTenantId);
  // the list MUST agree and return no rows rather than leak every tenant's workspace inventory.
  if (!isPlatform && !tenantId) return ok(200, collection([], 0));
  const res = await store.listWorkspaces(pool, { tenantId, allTenants: isPlatform && !tenantId,
    limit: Number(query['page[size]'] ?? query.limit ?? 100) || 100, offset: Number(query.offset ?? 0) || 0 });
  return ok(200, collection(res.items.map(workspaceOut), res.total));
}
// GET /v1/tenants/{tenantId}/workspaces
async function listTenantWorkspaces(ctx) {
  const { params, identity, pool } = ctx;
  const tenant = await store.getTenant(pool, params.tenantId);
  if (!tenant) return err(404, 'TENANT_NOT_FOUND', `tenant ${params.tenantId} not found`);
  if (!canManageTenantId(identity, tenant.id)) return err(403, 'FORBIDDEN', 'requires superadmin or tenant owner/admin');
  const res = await store.listWorkspaces(pool, { tenantId: tenant.id });
  return ok(200, collection(res.items.map(workspaceOut), res.total));
}
// GET /v1/workspaces/{workspaceId}
async function getWorkspace(ctx) {
  const { params, identity, pool } = ctx;
  const ws = await store.getWorkspace(pool, params.workspaceId);
  if (!ws) return err(404, 'WORKSPACE_NOT_FOUND', `workspace ${params.workspaceId} not found`);
  if (!canManageTenantId(identity, ws.tenant_id)) return err(403, 'FORBIDDEN', 'cannot read another tenant workspace');
  return ok(200, { workspace: workspaceOut(ws), ...workspaceOut(ws) });
}

// POST /v1/workspaces/{workspaceId}/promotions — promote a source workspace's promotable
// definition into a target workspace that lives in a DIFFERENT environment of the SAME tenant
// (first-class environment promotion, #641; completes #503/#502). Promotion copies the FUNCTION
// REGISTRY only and NEVER carries secrets, credentials, or service accounts — those are stage-scoped
// by design, so a dev secret can never leak into prod. The source is read-only (never mutated), and
// a function whose name already exists in the target is skipped (promotion never overwrites the
// target), so the operation is safely repeatable. ISOLATION (cardinal rule): resolve-then-gate BOTH
// the source and the target — a missing OR cross-tenant workspace is 404 (no existence leak),
// mirroring deleteWorkspace; a target in another tenant can never be a promotion sink.
async function promoteWorkspace(ctx) {
  const { params, body, identity, pool } = ctx;
  const source = await store.getWorkspace(pool, params.workspaceId);
  if (!source || !canManageTenantId(identity, source.tenant_id)) {
    return err(404, 'WORKSPACE_NOT_FOUND', `workspace ${params.workspaceId} not found`);
  }
  const targetEnvironment = String(body.targetEnvironment ?? '').toLowerCase();
  if (!ENVIRONMENT_CATALOG.includes(targetEnvironment)) {
    return err(400, 'INVALID_ENVIRONMENT', `targetEnvironment must be one of: ${ENVIRONMENT_CATALOG.join(', ')}`);
  }
  const sourceEnvironment = source.environment ?? 'dev';
  if (targetEnvironment === sourceEnvironment) {
    return err(400, 'SAME_ENVIRONMENT', `source and target are both in '${targetEnvironment}'; promote across environments`);
  }
  if (!body.targetWorkspaceId) {
    return err(400, 'VALIDATION_ERROR', 'targetWorkspaceId is required');
  }
  const target = await store.getWorkspace(pool, body.targetWorkspaceId);
  // Resolve-then-gate the target: missing, cross-tenant, or a different tenant than the source is
  // 404 (no existence leak). A foreign tenant can never probe or receive a promotion.
  if (!target || !canManageTenantId(identity, target.tenant_id) || target.tenant_id !== source.tenant_id) {
    return err(404, 'TARGET_WORKSPACE_NOT_FOUND', `target workspace ${body.targetWorkspaceId} not found`);
  }
  if (target.id === source.id) {
    return err(400, 'SAME_WORKSPACE', 'source and target workspace are the same');
  }
  if ((target.environment ?? 'dev') !== targetEnvironment) {
    return err(409, 'ENVIRONMENT_MISMATCH', `target workspace is in '${target.environment ?? 'dev'}', not '${targetEnvironment}'`);
  }
  // Copy the source's promotable artifacts (the function registry) into the target. The source is
  // read-only here; we only INSERT into the target. A name already present in the target is skipped.
  const srcFns = await store.listFunctions(pool, source.id);
  const promoted = [];
  const skipped = [];
  for (const fn of srcFns.items) {
    if (await store.functionNameTaken(pool, target.id, fn.name)) {
      skipped.push({ name: fn.name, reason: 'already_exists_in_target' });
      continue;
    }
    await store.insertFunction(pool, {
      id: randomUUID(), workspaceId: target.id, tenantId: target.tenant_id, name: fn.name,
      runtime: fn.runtime, handler: fn.handler, sourceRef: fn.source_ref, createdBy: identity.sub });
    promoted.push(fn.name);
  }
  return ok(200, {
    promotion: {
      sourceWorkspaceId: source.id, sourceEnvironment,
      targetWorkspaceId: target.id, targetEnvironment,
      promoted: { functions: promoted },
      skipped: { functions: skipped },
      // Stage-scoped by design (#502/#503): each environment keeps its OWN secrets, credentials, and
      // service accounts, and its own isolated database — promotion NEVER copies them.
      notCopied: ['secrets', 'credentials', 'service-accounts', 'database-data'],
    },
  });
}

// ---- tenant configuration export (#683, data-export-import-clone) -----------
// POST /v1/tenants/{tenantId}/exports — emit a READ-ONLY, portable snapshot of the tenant's
// NON-SENSITIVE configuration (metadata, its workspaces, its first-class environments, and resolved
// quota LIMITS). Own-tenant gated (cross-tenant → 404, no existence leak). NEVER includes secrets,
// credentials, BYOK keys, service-account material, or tokens (the assembler strips them). The
// snapshot is assembled by the pure buildTenantConfigExport from already-authorized rows.
async function exportTenantConfiguration(ctx) {
  const { params, identity, pool } = ctx;
  const tenant = await store.getTenant(pool, params.tenantId);
  // Resolve-then-gate: a missing OR cross-tenant tenant is 404 (no existence leak), matching the
  // storage/workspace no-existence-leak idiom (NOT 403, which would confirm the tenant exists).
  if (!tenant || !canManageTenantId(identity, tenant.id)) {
    return err(404, 'TENANT_NOT_FOUND', `tenant ${params.tenantId} not found`);
  }
  const [workspaces, environments] = await Promise.all([
    store.listWorkspaces(pool, { tenantId: tenant.id, limit: 1000 }),
    store.listTenantEnvironments(pool, tenant.id)
  ]);
  // Resolved quota limits (best-effort, like the metrics handlers): a non-owner actor-type or a
  // missing quota relation must not fail the export — the snapshot then omits quotas.
  let quotaLimits = [];
  try {
    const mod = await import('/repo/packages/provisioning-orchestrator/src/actions/tenant-effective-entitlements-get.mjs');
    const res = await mod.main({ tenantId: tenant.id, include: 'consumption', callerContext: ctx.callerContext }, { db: pool });
    quotaLimits = res?.body?.quantitativeLimits ?? [];
  } catch { quotaLimits = []; }
  const snapshot = buildTenantConfigExport({
    tenant, workspaces: workspaces.items ?? [], environments, quotaLimits,
    environmentCatalog: ENVIRONMENT_CATALOG
  });
  return ok(200, snapshot);
}

// ---- workspace clone (#683, data-export-import-clone) -----------------------
// buildWorkspaceCloneDraft is in packages/internal-contracts (vendored at /repo in the image, but not
// resolvable from the repo root in the blackbox harness), so it is LAZILY loaded with a dual-path
// fallback + a minimal inline fallback that enforces the same NEVER-copy-credentials policy.
let _buildWorkspaceCloneDraft = null;
async function loadBuildWorkspaceCloneDraft() {
  if (_buildWorkspaceCloneDraft) return _buildWorkspaceCloneDraft;
  const candidates = [
    '/repo/packages/internal-contracts/src/index.mjs',
    new URL('../../packages/internal-contracts/src/index.mjs', import.meta.url).href
  ];
  for (const c of candidates) {
    try { const m = await import(c); if (m?.buildWorkspaceCloneDraft) { _buildWorkspaceCloneDraft = m.buildWorkspaceCloneDraft; return _buildWorkspaceCloneDraft; } }
    catch { /* try next */ }
  }
  _buildWorkspaceCloneDraft = ({ sourceWorkspace, targetWorkspace = {}, clonePolicy = {} }) => ({
    entityType: 'workspace_clone',
    slug: targetWorkspace.slug,
    displayName: targetWorkspace.displayName,
    environment: targetWorkspace.environment ?? sourceWorkspace.environment,
    clonePolicy: { resetCredentialReferences: true, ...clonePolicy }
  });
  return _buildWorkspaceCloneDraft;
}

// POST /v1/workspaces/{workspaceId}/clone — reproduce a source workspace's resources into a NEW
// target workspace in the SAME tenant. ISOLATION (cardinal rule): resolve-then-gate the source; a
// missing OR cross-tenant source is 404 (no existence leak). The new target is ALWAYS created under
// the source's VERIFIED tenant — a clone into another tenant is therefore impossible (Scenario 2
// analog). Copies the function-definition registry per the clone policy; NEVER copies secrets,
// credentials, or service accounts (resetCredentialReferences). The new workspace's own backing
// database is provisioned fresh (no source data co-mingling).
async function cloneWorkspace(ctx) {
  const { params, body, identity, pool } = ctx;
  const source = await store.getWorkspace(pool, params.workspaceId);
  if (!source || !canManageTenantId(identity, source.tenant_id)) {
    return err(404, 'WORKSPACE_NOT_FOUND', `workspace ${params.workspaceId} not found`);
  }
  const displayName = body.displayName ?? body.targetWorkspace?.displayName ?? `${source.display_name} (clone)`;
  const slug = slugify(body.slug ?? body.targetWorkspace?.slug ?? `${source.slug}-clone`);
  if (!slug) return err(400, 'VALIDATION_ERROR', 'a valid target slug could not be derived');
  // Reject a body that tries to target a DIFFERENT tenant (defense in depth: the target is created
  // under the source's tenant regardless, but an explicit foreign targetTenantId is a clear signal
  // of a cross-tenant attempt → denied, mirroring promoteWorkspace's cross-tenant 404).
  const requestedTenantId = body.targetTenantId ?? body.targetWorkspace?.tenantId ?? null;
  if (requestedTenantId && requestedTenantId !== source.tenant_id) {
    return err(404, 'TENANT_NOT_FOUND', 'cannot clone a workspace into another tenant');
  }
  if (await store.workspaceSlugTaken(pool, source.tenant_id, slug)) {
    return err(409, 'SLUG_TAKEN', `workspace slug '${slug}' already exists in tenant`);
  }
  const environment = String(body.environment ?? body.targetWorkspace?.environment ?? source.environment ?? 'dev').toLowerCase();
  if (!ENVIRONMENT_CATALOG.includes(environment)) {
    return err(400, 'INVALID_ENVIRONMENT', `environment must be one of: ${ENVIRONMENT_CATALOG.join(', ')}`);
  }
  // Enforce the tenant's max_workspaces entitlement (the clone creates a NEW workspace) — same gate
  // createWorkspace applies. Fails open if governance is unavailable.
  const usedWorkspaces = await store.countTenantWorkspaces(pool, source.tenant_id);
  const quota = await checkWorkspaceQuota(pool, source.tenant_id, usedWorkspaces);
  if (!quota.allowed) {
    return err(402, 'QUOTA_EXCEEDED', `workspace quota reached (max_workspaces): ${usedWorkspaces}/${quota.effectiveLimit ?? '?'}`);
  }
  // Build the clone draft (records the clone policy; resetCredentialReferences:true). The draft is
  // descriptive — the actual copy below honours it (function registry only, never credentials).
  const buildDraft = await loadBuildWorkspaceCloneDraft();
  const clonePolicy = { resetCredentialReferences: true, includeServiceAccounts: false, ...(body.clonePolicy ?? {}) };
  const draft = buildDraft({
    sourceWorkspace: { workspaceId: source.id, slug: source.slug, environment: source.environment, description: source.display_name },
    targetWorkspace: { slug, displayName, environment },
    clonePolicy
  });
  // Create the target workspace under the SOURCE's tenant (never a body-supplied tenant).
  let target;
  try {
    target = await store.insertWorkspace(pool, { id: randomUUID(), tenantId: source.tenant_id, slug, displayName, environment, createdBy: identity.sub });
  } catch (e) {
    if (e?.code === '23505') return err(409, 'WORKSPACE_SLUG_CONFLICT', `workspace slug '${slug}' already exists in tenant`);
    throw e;
  }
  // Provision the target's own fresh backing database (best-effort; mirrors createWorkspace).
  // ctx.skipDbProvision is a test seam (mirrors deleteWorkspace's ctx.* seams) so the clone is
  // unit-testable without a live Postgres; production never sets it.
  let database = null;
  if (!ctx.skipDbProvision) {
    try { const out = await runWorkspaceDbProvisionSaga(pool, { ws: target, tenant: { id: source.tenant_id }, identity, callerContext: ctx.callerContext }); database = out.database; }
    catch { database = null; }
  }
  // Copy the source's function registry into the target (the clone-able artifact). Never secrets/
  // credentials/service-accounts.
  const copied = [];
  try {
    const srcFns = await store.listFunctions(pool, source.id);
    for (const fn of srcFns.items) {
      if (await store.functionNameTaken(pool, target.id, fn.name)) continue;
      await store.insertFunction(pool, {
        id: randomUUID(), workspaceId: target.id, tenantId: source.tenant_id, name: fn.name,
        runtime: fn.runtime, handler: fn.handler, sourceRef: fn.source_ref, createdBy: identity.sub });
      copied.push(fn.name);
    }
  } catch { /* registry copy is best-effort; the target workspace already exists */ }
  return ok(201, {
    clone: {
      sourceWorkspaceId: source.id,
      targetWorkspaceId: target.id,
      tenantId: source.tenant_id,
      environment,
      copied: { functions: copied },
      clonePolicy: draft.clonePolicy ?? clonePolicy,
      // NEVER copied (resetCredentialReferences): each workspace keeps its own isolated secrets,
      // credentials, service accounts, and backing database.
      notCopied: ['secrets', 'credentials', 'service-accounts', 'database-data'],
    },
    workspace: workspaceOut(target),
    database,
  });
}

// DELETE /v1/workspaces/{workspaceId} — single-workspace cascading teardown
// (add-deploy-completeness-cluster, #562). Tears down EVERYTHING the workspace owns, scoped to the
// owning tenant — the per-workspace counterpart of purgeTenant. ISOLATION (cardinal rule): resolve
// the workspace FIRST, then gate that the caller owns it. A tenant owner/admin may delete ONLY a
// workspace whose tenant_id matches their verified identity; a cross-tenant id is reported as 404
// (no existence leak). superadmin/internal may delete any. Mirrors getWorkspace's ownership gate
// (but 404, not 403, on a foreign workspace, matching the storage/kafka no-existence-leak idiom).
// Physical teardown (DB drop, bucket/topic delete) is best-effort (try/catch, report what was
// removed); the registry-row teardown is reliable, so no orphaned rows remain. Teardown ops are
// injectable (ctx.*) for testing, defaulting to the real module functions.
async function deleteWorkspace(ctx) {
  const { params, identity, pool } = ctx;
  const dropDb = ctx.dropWorkspaceDatabase ?? dropWorkspaceDatabase;
  const delBucket = ctx.deleteBucket ?? deleteBucket;
  const delTopics = ctx.deleteTopics ?? deleteTopics;

  const ws = await store.getWorkspace(pool, params.workspaceId);
  // Resolve-then-gate: a missing OR cross-tenant workspace is 404 (no existence leak). Superadmin/
  // internal bypass the tenant match; everyone else must own the workspace's tenant.
  const owns = ws && canManageTenantId(identity, ws.tenant_id);
  if (!ws || !owns) return err(404, 'WORKSPACE_NOT_FOUND', `workspace ${params.workspaceId} not found`);

  // 1. Delete the workspace's registry rows + collect the physical resources to tear down.
  const phys = await store.purgeWorkspace(pool, ws.id);
  // 2. Drop the per-workspace database(s) — best-effort (rows already removed above).
  const databasesDropped = [];
  for (const db of phys.databases) { try { await dropDb(pool, db); databasesDropped.push(db); } catch { /* best-effort */ } }
  // 3. Best-effort physical object-store + topic teardown.
  const bucketsDeleted = [];
  for (const b of phys.buckets) { try { await delBucket(b); bucketsDeleted.push(b); } catch { /* best-effort */ } }
  let topicsDeleted = [];
  try { await delTopics(phys.topics); topicsDeleted = phys.topics; } catch { /* best-effort */ }
  // 4. Isolation-safe FerretDB document teardown for the workspace's recorded mongo db(s)
  //    (fix-tenant-purge-ferretdb-cascade, #682): scope by the workspace's owning tenant,
  //    delete only that tenant's documents, and drop a db only when empty across ALL tenants
  //    (a shared db with another tenant's data is retained). Best-effort.
  const mongo = await tearDownMongo(ctx, ws.tenant_id, phys.mongoDatabases);

  return ok(200, {
    workspaceId: ws.id, tenantId: ws.tenant_id, deleted: true,
    removed: {
      databases: databasesDropped, buckets: bucketsDeleted, topics: topicsDeleted,
      mongoDatabases: mongo.dropped, mongoDatabasesRetained: mongo.retained,
    },
    // Resources whose physical teardown is not wired in this runtime (rows ARE removed).
    residual: { knativeServices: phys.ksvcs },
  });
}

// ---- service accounts (= confidential Keycloak client in the tenant realm) --
async function resolveWorkspaceForManage(ctx) {
  const st = ctx.store ?? store;
  const ws = await st.getWorkspace(ctx.pool, ctx.params.workspaceId);
  if (!ws) return { error: err(404, 'WORKSPACE_NOT_FOUND', `workspace ${ctx.params.workspaceId} not found`) };
  if (!canManageTenantId(ctx.identity, ws.tenant_id)) return { error: err(403, 'FORBIDDEN', 'requires superadmin or tenant owner/admin') };
  const tenant = await st.getTenant(ctx.pool, ws.tenant_id);
  if (!tenant?.iam_realm) return { error: err(409, 'NO_REALM', 'tenant has no IAM realm') };
  return { ws, realm: tenant.iam_realm };
}
// POST /v1/workspaces/{workspaceId}/service-accounts
async function createServiceAccount(ctx) {
  const { body, identity, pool } = ctx;
  const r = await resolveWorkspaceForManage(ctx); if (r.error) return r.error;
  const displayName = body.displayName ?? body.name;
  if (!displayName) return err(400, 'VALIDATION_ERROR', 'name is required');
  const saId = randomUUID();
  const clientId = `sa-${r.ws.slug ?? r.ws.id.slice(0, 8)}-${slugify(displayName)}`;
  const kc = ctx.kcAdmin ?? kcAdmin;
  try {
    if (await kc.findClient(r.realm, clientId)) return err(409, 'SA_EXISTS', `service account client ${clientId} already exists`);
    const uuid = await kc.createConfidentialClient(r.realm, { clientId, name: displayName, serviceAccountsEnabled: true });
    const rec = await store.insertServiceAccount(pool, { id: saId, workspaceId: r.ws.id, tenantId: r.ws.tenant_id, iamRealm: r.realm, kcClientId: clientId, kcClientUuid: uuid, displayName, createdBy: identity.sub });
    // Top-level serviceAccountId is what the console persists to fetch the SA back.
    return ok(201, { serviceAccountId: rec.id, ...serviceAccountOut({ ...rec, iam_realm: r.realm }), serviceAccount: rec });
  } catch (e) {
    return kcBackedErr(e, 'CREATE_SA_FAILED');
  }
}
// GET /v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}
async function getServiceAccount(ctx) {
  const r = await resolveWorkspaceForManage(ctx); if (r.error) return r.error;
  const sa = await store.getServiceAccount(ctx.pool, ctx.params.serviceAccountId);
  if (!sa || sa.workspace_id !== r.ws.id) return err(404, 'SA_NOT_FOUND', 'service account not found');
  const { iam_realm, kc_client_uuid, ...safe } = sa;
  // Console shape at top level (it passes the whole response to normalizeServiceAccount).
  return ok(200, { ...serviceAccountOut(sa), serviceAccount: safe });
}
// GET /v1/workspaces/{workspaceId}/service-accounts
async function listServiceAccountsHandler(ctx) {
  const st = ctx.store ?? store;
  const r = await resolveWorkspaceForManage(ctx); if (r.error) return r.error;
  const result = await st.listServiceAccounts(ctx.pool, r.ws.id);
  const items = (result.items ?? []).map((sa) => ({ ...sa, ...serviceAccountOut(sa) }));
  return ok(200, collection(items, result.total ?? items.length));
}
async function saForCredential(ctx) {
  const st = ctx.store ?? store;
  const r = await resolveWorkspaceForManage(ctx); if (r.error) return { error: r.error };
  const sa = await st.getServiceAccount(ctx.pool, ctx.params.serviceAccountId);
  if (!sa || sa.workspace_id !== r.ws.id) return { error: err(404, 'SA_NOT_FOUND', 'service account not found') };
  return { sa };
}
// POST /v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}/credential-issuance
async function issueCredential(ctx) {
  const kc = ctx.kcAdmin ?? kcAdmin;
  const r = await saForCredential(ctx); if (r.error) return r.error;
  // A revoked SA's Keycloak client is disabled (fix-sa-credential-revocation-invalidate-tokens, #684),
  // so any secret returned here could never obtain a token (client_credentials → 401 invalid_client).
  // Reject explicitly instead of returning a misleading 201 carrying an unusable secret (#685).
  if (r.sa.status === 'revoked') return err(409, 'CREDENTIAL_REVOKED', 'service account credential is revoked; re-create the service account to issue a new credential');
  try {
    const secret = await kc.getClientSecret(r.sa.iam_realm, r.sa.kc_client_uuid);
    return ok(201, { credentialId: r.sa.kc_client_id, secret, expiresAt: null,
      clientId: r.sa.kc_client_id, clientSecret: secret, tokenEndpoint: `${kc.base}/realms/${r.sa.iam_realm}/protocol/openid-connect/token`, grantType: 'client_credentials', issuedAt: new Date().toISOString() });
  } catch (e) {
    return kcBackedErr(e, 'ISSUE_CREDENTIAL_FAILED');
  }
}
// POST .../credential-rotations
// Rotating the secret blocks NEW client_credentials grants with the old secret. To also cut off
// access tokens already minted from the pre-rotation secret (fix-sa-credential-revocation-invalidate-
// tokens, #684), stamp the SA's revocation cutoff so the auth path's not-before check rejects them
// within the bounded propagation window. Previously this handler touched NO DB row.
async function rotateCredential(ctx) {
  const kc = ctx.kcAdmin ?? kcAdmin; const st = ctx.store ?? store;
  const r = await saForCredential(ctx); if (r.error) return r.error;
  // Rotating a revoked SA is meaningless: its client is disabled, so the regenerated secret is unusable.
  // Reject with the same explicit conflict as issuance instead of a misleading 201 (#685). Re-revoking a
  // revoked SA stays idempotent because this guard lives ONLY in issue/rotate, not in revokeCredential.
  if (r.sa.status === 'revoked') return err(409, 'CREDENTIAL_REVOKED', 'service account credential is revoked; re-create the service account to issue a new credential');
  let secret;
  try { secret = await kc.regenerateClientSecret(r.sa.iam_realm, r.sa.kc_client_uuid); }
  catch (e) { return kcBackedErr(e, 'ROTATE_CREDENTIAL_FAILED'); }
  await st.markServiceAccountCredentialsInvalidated(ctx.pool, r.sa.id);
  return ok(201, { credentialId: r.sa.kc_client_id, secret, expiresAt: null,
    clientId: r.sa.kc_client_id, clientSecret: secret, rotatedAt: new Date().toISOString() });
}
// POST .../credential-revocations
// In addition to disabling the Keycloak client + regenerating its secret + flipping PG status, stamp
// the revocation cutoff (fix-sa-credential-revocation-invalidate-tokens, #684) so already-issued
// access tokens (which offline JWT verification would otherwise accept until their natural expiry)
// are rejected by the auth path's not-before check within the bounded propagation window.
async function revokeCredential(ctx) {
  const kc = ctx.kcAdmin ?? kcAdmin; const st = ctx.store ?? store;
  const r = await saForCredential(ctx); if (r.error) return r.error;
  try {
    await kc.regenerateClientSecret(r.sa.iam_realm, r.sa.kc_client_uuid); // invalidate the old secret
    await kc.setClientEnabled(r.sa.iam_realm, r.sa.kc_client_uuid, false);
  } catch (e) { return kcBackedErr(e, 'REVOKE_CREDENTIAL_FAILED'); }
  await st.setServiceAccountStatus(ctx.pool, r.sa.id, 'revoked');
  await st.markServiceAccountCredentialsInvalidated(ctx.pool, r.sa.id);
  return ok(200, { serviceAccountId: r.sa.id, status: 'revoked', revokedAt: new Date().toISOString() });
}
// DELETE /v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}
// Fully removes a service account (#687): revoke/rotate leave the Keycloak client AND the PG row
// behind (the client is merely disabled, status flipped to 'revoked'), so revoked/unused SAs
// accumulate forever in both stores. DELETE removes BOTH — the KC confidential client and the PG
// row — so the SA disappears from list results. saForCredential() reuses resolveWorkspaceForManage
// (→ 403 cross-tenant via canManageTenantId, 409 NO_REALM) AND returns 404 SA_NOT_FOUND for a
// missing/foreign SA, so a 2nd DELETE (or any GET) on the now-removed SA is idempotently 404. Works
// for an active OR a revoked SA. kcAdmin.deleteClient is 404-tolerant, so a KC client already gone
// (e.g. deleted out of band) still lets the PG row be removed.
async function deleteServiceAccount(ctx) {
  const kc = ctx.kcAdmin ?? kcAdmin; const st = ctx.store ?? store;
  const r = await saForCredential(ctx); if (r.error) return r.error;
  try {
    await kc.deleteClient(r.sa.iam_realm, r.sa.kc_client_uuid);
  } catch (e) {
    // deleteClient already swallows 404 (idempotent); any other KC failure is a downstream error —
    // surface it as a 502 (mirrors createServiceAccount) WITHOUT removing the PG row, so the caller
    // can retry rather than orphan a still-present Keycloak client.
    return kcBackedErr(e, 'DELETE_SA_FAILED');
  }
  await st.deleteServiceAccount(ctx.pool, r.sa.id);
  return ok(200, { serviceAccountId: r.sa.id, deleted: true, deletedAt: new Date().toISOString() });
}

// ---- fine-grained IAM (platform admin; realmId in the path) ----------------
// Items carry BOTH the IAM Access page's fields (id/name) AND the Members page's
// (userId/realmRoles, roleName/composite). realmRoles is enriched per user (small
// realms), so the Members table shows each user's roles inline.
async function iamListUsers(ctx) {
  // A tenant_owner/admin may list the app end-users of ITS OWN realm; superadmin any.
  // Previously superadmin-only (route gate), so an owner got 403 on its own end-users
  // (P1 BUG-ENDUSER-OWNER-403). authorizeRealmManage denies cross-tenant (the owner of
  // another tenant's realm → 403) by resolving realm→tenant + canManageTenant.
  const az = await authorizeRealmManage(ctx);
  if (az.error) return az.error;
  const kc = ctx.kcAdmin ?? kcAdmin;
  const realm = ctx.params.realmId;
  const max = Number(ctx.query['page[size]'] ?? ctx.query.max ?? 200) || 200;
  let users;
  try { users = await kc.listUsers(realm, { max }); }
  catch (e) { return kcBackedErr(e, 'IAM_LIST_USERS_FAILED'); }
  const items = await Promise.all(users.map(async (u) => {
    let realmRoles = [];
    try {
      realmRoles = (await kc.listUserRealmRoles(realm, u.id))
        .map((r) => r.name).filter((n) => n && !String(n).startsWith('default-roles'));
    } catch { /* best-effort: show no roles rather than fail the list */ }
    return {
      id: u.id, userId: u.id, realmId: realm, username: u.username, email: u.email ?? null,
      enabled: u.enabled, state: u.enabled ? 'active' : 'suspended',
      firstName: u.firstName, lastName: u.lastName, createdTimestamp: u.createdTimestamp,
      realmRoles, requiredActions: u.requiredActions ?? [], attributes: u.attributes ?? {}
    };
  }));
  return ok(200, { items, total: items.length, page: { after: null, size: items.length } });
}
// Extract the password to set on a created user from the documented
// `bootstrapCredentials.temporaryPassword` field or legacy payload shapes kept for
// compatibility with earlier console/API callers.
export function credentialPasswordFromBody(body = {}) {
  const bootstrap = body.bootstrapCredentials;
  if (bootstrap && typeof bootstrap.temporaryPassword === 'string' && bootstrap.temporaryPassword) {
    return { value: bootstrap.temporaryPassword, temporary: false };
  }
  if (typeof body.password === 'string' && body.password) {
    return { value: body.password, temporary: body.temporary === true };
  }
  const cred = Array.isArray(body.credentials)
    ? body.credentials.find((c) => c && (c.type ?? 'password') === 'password' && typeof c.value === 'string' && c.value)
    : null;
  return cred ? { value: cred.value, temporary: cred.temporary === true } : null;
}

function uniqueStrings(values = []) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
}

export function realmRolesFromBody(body = {}) {
  if (Array.isArray(body.realmRoles)) return uniqueStrings(body.realmRoles);
  if (Array.isArray(body.roles)) return uniqueStrings(body.roles);
  return [];
}

export function requiredActionsFromBody(body = {}) {
  return uniqueStrings([
    ...(Array.isArray(body.requiredActions) ? body.requiredActions : []),
    ...(Array.isArray(body.bootstrapCredentials?.requiredActions) ? body.bootstrapCredentials.requiredActions : []),
  ]);
}

function unsupportedIamCreateFields(body = {}) {
  const unsupported = [];
  if (Array.isArray(body.groups) && body.groups.length > 0) unsupported.push('groups');
  if (body.metadata && Object.keys(body.metadata).length > 0) unsupported.push('metadata');
  if (body.bootstrapCredentials?.sendEmail === true) unsupported.push('bootstrapCredentials.sendEmail');
  return unsupported;
}

async function iamCreateUser(ctx) {
  const { params, body, identity } = ctx;
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  if (!username) return err(400, 'VALIDATION_ERROR', 'username required');
  const unsupported = unsupportedIamCreateFields(body);
  if (unsupported.length > 0) {
    return err(400, 'UNSUPPORTED_FIELD', `unsupported create-user fields: ${unsupported.join(', ')}`);
  }
  try {
    const kc = ctx.kcAdmin ?? kcAdmin;
    const pw = credentialPasswordFromBody(body);
    const realmRoles = realmRolesFromBody(body);
    const requiredActions = requiredActionsFromBody(body);
    const attributes = body.attributes && typeof body.attributes === 'object' ? body.attributes : {};
    const id = await kc.createUser(params.realmId, {
      username,
      email: body.email ?? null,
      firstName: body.firstName ?? null,
      lastName: body.lastName ?? null,
      password: pw?.value ?? null,
      temporary: pw?.temporary === true,
      enabled: body.enabled !== false,
      emailVerified: body.emailVerified !== false,
      requiredActions,
      attributes,
    });
    if (realmRoles.length) await kc.assignRealmRoles(params.realmId, id, realmRoles);
    return ok(201, {
      userId: id,
      username,
      realm: params.realmId,
      roles: realmRoles,
      realmRoles,
      attributes,
      requiredActions,
      createdBy: identity?.sub ?? null,
    });
  } catch (e) { return kcBackedErr(e, 'IAM_CREATE_USER_FAILED'); }
}
async function iamListRoles(ctx) {
  const kc = ctx.kcAdmin ?? kcAdmin;
  let roles;
  try { roles = await kc.listRealmRoles(ctx.params.realmId); }
  catch (e) { return kcBackedErr(e, 'IAM_LIST_ROLES_FAILED'); }
  const items = roles.map((r) => ({
    id: r.id, name: r.name, roleName: r.name, realmId: ctx.params.realmId,
    description: r.description ?? null, composite: Boolean(r.composite), compositeRoles: [],
    attributes: r.attributes ?? {}
  }));
  return ok(200, { items, total: items.length, page: { after: null, size: items.length } });
}
async function iamCreateRole(ctx) {
  const roleName = typeof ctx.body?.roleName === 'string' && ctx.body.roleName.trim()
    ? ctx.body.roleName.trim()
    : typeof ctx.body?.name === 'string' && ctx.body.name.trim()
      ? ctx.body.name.trim()
      : '';
  if (!roleName) return err(400, 'VALIDATION_ERROR', 'roleName required');
  const kc = ctx.kcAdmin ?? kcAdmin;
  try {
    await kc.createRealmRole(ctx.params.realmId, roleName);
    return ok(201, { name: roleName, roleName, realm: ctx.params.realmId });
  } catch (e) {
    return kcBackedErr(e, 'IAM_CREATE_ROLE_FAILED');
  }
}
async function iamListGroups(ctx) {
  const kc = ctx.kcAdmin ?? kcAdmin;
  let groups;
  try { groups = await kc.listGroups(ctx.params.realmId); }
  catch (e) { return kcBackedErr(e, 'IAM_LIST_GROUPS_FAILED'); }
  return ok(200, { items: groups.map((g) => ({ id: g.id, name: g.name, path: g.path })), total: groups.length });
}
async function iamCreateGroup(ctx) {
  if (!ctx.body.name) return err(400, 'VALIDATION_ERROR', 'name required');
  const kc = ctx.kcAdmin ?? kcAdmin;
  try {
    const id = await kc.createGroup(ctx.params.realmId, ctx.body.name);
    return ok(201, { id, name: ctx.body.name, realm: ctx.params.realmId });
  } catch (e) {
    return kcBackedErr(e, 'IAM_CREATE_GROUP_FAILED');
  }
}
async function iamListClients(ctx) {
  const kc = ctx.kcAdmin ?? kcAdmin;
  let clients;
  try { clients = await kc.listClients(ctx.params.realmId); }
  catch (e) { return kcBackedErr(e, 'IAM_LIST_CLIENTS_FAILED'); }
  return ok(200, { items: clients.map((c) => ({ id: c.id, clientId: c.clientId, enabled: c.enabled, publicClient: c.publicClient, serviceAccountsEnabled: c.serviceAccountsEnabled })), total: clients.length });
}

// ---- catalogued IAM routes that were unrouted (fix-iam-route-wiring #598) ----
// getIamUser / getIamRole / deleteIamRole and realm CRUD (list/get/update) were in the public
// route catalog but returned 404 NO_ROUTE in the kind runtime. Wire them to the existing
// KC-admin + store helpers; single-entity reads mirror the list handlers' item shapes.
// GET /v1/iam/realms/{realmId}/users/{userId} — owner-of-realm OR superadmin (handler authorizes).
async function iamGetUser(ctx) {
  const kc = ctx.kcAdmin ?? kcAdmin;
  const az = await authorizeRealmManage(ctx);
  if (az.error) return az.error;
  let u;
  try { u = await kc.getUser(az.realm, ctx.params.userId); }
  catch (e) { if (e.kcStatus === 404) u = null; else return kcBackedErr(e, 'IAM_GET_USER_FAILED'); }
  if (!u) return err(404, 'USER_NOT_FOUND', `user ${ctx.params.userId} not found`);
  let realmRoles = [];
  try { realmRoles = (await kc.listUserRealmRoles(az.realm, u.id)).map((r) => r.name).filter((n) => n && !String(n).startsWith('default-roles')); }
  catch { /* best-effort: show no roles rather than fail */ }
  return ok(200, {
    id: u.id, userId: u.id, realmId: az.realm, username: u.username, email: u.email ?? null,
    enabled: u.enabled, state: u.enabled ? 'active' : 'suspended',
    firstName: u.firstName, lastName: u.lastName, createdTimestamp: u.createdTimestamp,
    realmRoles, requiredActions: u.requiredActions ?? [], attributes: u.attributes ?? {},
  });
}
// GET /v1/iam/realms/{realmId}/roles/{roleName} — superadmin (route-gated).
async function iamGetRole(ctx) {
  const kc = ctx.kcAdmin ?? kcAdmin;
  let r;
  try { r = await kc.getRealmRole(ctx.params.realmId, ctx.params.roleName); }
  catch (e) { if (e.kcStatus === 404) r = null; else return kcBackedErr(e, 'IAM_GET_ROLE_FAILED'); }
  if (!r) return err(404, 'ROLE_NOT_FOUND', `role ${ctx.params.roleName} not found`);
  return ok(200, {
    id: r.id, name: r.name, roleName: r.name, realmId: ctx.params.realmId,
    description: r.description ?? null, composite: Boolean(r.composite), compositeRoles: [], attributes: r.attributes ?? {},
  });
}
// DELETE /v1/iam/realms/{realmId}/roles/{roleName} — superadmin (route-gated). Idempotent (KC 404 → ok).
async function iamDeleteRole(ctx) {
  const kc = ctx.kcAdmin ?? kcAdmin;
  try {
    await kc.deleteRealmRole(ctx.params.realmId, ctx.params.roleName);
    return ok(200, { roleName: ctx.params.roleName, realmId: ctx.params.realmId, deleted: true });
  } catch (e) {
    return kcBackedErr(e, 'DELETE_ROLE_FAILED');
  }
}
// GET /v1/iam/realms — superadmin lists every tenant realm (route-gated to superadmin).
async function iamListRealms(ctx) {
  const max = Number(ctx.query.max ?? ctx.query['page[size]'] ?? 200) || 200;
  const { items } = await store.listTenants(ctx.pool, { limit: max });
  const realms = items.filter((t) => t.iam_realm).map((t) => ({
    realmId: t.iam_realm, realm: t.iam_realm, tenantId: t.tenant_id, slug: t.slug,
    displayName: t.display_name, status: t.status,
  }));
  return ok(200, { items: realms, total: realms.length, page: { after: null, size: realms.length } });
}
// GET /v1/iam/realms/{realmId} — superadmin OR the owning tenant; includes login options.
async function iamGetRealm(ctx) {
  const kc = ctx.kcAdmin ?? kcAdmin;
  const az = await authorizeRealmManage(ctx);
  if (az.error) return az.error;
  const tenant = az.tenant ?? await store.getTenantByRealm(ctx.pool, az.realm);
  let authConfig = null;
  try { authConfig = await kc.getRealmAuthConfig(az.realm); }
  catch (e) { if (e.kcStatus === 404) return err(404, 'REALM_NOT_FOUND', `realm ${az.realm} not found`); return kcBackedErr(e, 'IAM_GET_REALM_FAILED'); }
  return ok(200, {
    realmId: az.realm, realm: az.realm, tenantId: tenant?.tenant_id ?? null, slug: tenant?.slug ?? null,
    displayName: tenant?.display_name ?? null, status: tenant?.status ?? null, authConfig,
  });
}
// PUT /v1/iam/realms/{realmId} — superadmin OR the owning tenant updates realm login options.
async function iamUpdateRealm(ctx) {
  const kc = ctx.kcAdmin ?? kcAdmin;
  const az = await authorizeRealmManage(ctx);
  if (az.error) return az.error;
  try {
    await kc.setRealmAuthConfig(az.realm, ctx.body ?? {});
    const authConfig = await kc.getRealmAuthConfig(az.realm);
    return ok(200, { realmId: az.realm, realm: az.realm, authConfig });
  } catch (e) {
    if (e.kcStatus === 404) return err(404, 'REALM_NOT_FOUND', `realm ${az.realm} not found`);
    return kcBackedErr(e, 'IAM_UPDATE_REALM_FAILED');
  }
}

// ---- app end-user lifecycle (#567 BUG-ENDUSER-MGMT) -------------------------
// The owner end-user surface was create+list only; DELETE and status PATCH were in
// the public route catalog but unrouted (NO_ROUTE 404), so an owner could not disable
// or delete a registered app end-user. Authorize superadmin OR the owner/admin of the
// tenant that owns the realm (never cross-tenant), then drive Keycloak.
async function authorizeRealmManage(ctx) {
  const realm = ctx.params.realmId;
  if (ctx.identity?.actorType === 'superadmin' || ctx.identity?.actorType === 'internal') return { realm };
  const tenant = await store.getTenantByRealm(ctx.pool, realm);
  if (tenant && canManageTenant(ctx.identity, tenant)) return { realm, tenant };
  return { error: err(403, 'FORBIDDEN', 'requires superadmin or the owning tenant owner/admin') };
}
// DELETE /v1/iam/realms/{realmId}/users/{userId}
async function iamDeleteUser(ctx) {
  const kc = ctx.kcAdmin ?? kcAdmin;
  const az = await authorizeRealmManage(ctx);
  if (az.error) return az.error;
  try {
    await kc.deleteUser(az.realm, ctx.params.userId);
    return ok(200, { userId: ctx.params.userId, realmId: az.realm, deleted: true });
  } catch (e) {
    return kcBackedErr(e, 'DELETE_USER_FAILED');
  }
}
// PATCH /v1/iam/realms/{realmId}/users/{userId}/status  body: {enabled:bool} | {state:'active'|'suspended'}
async function iamSetUserStatus(ctx) {
  const kc = ctx.kcAdmin ?? kcAdmin;
  const az = await authorizeRealmManage(ctx);
  if (az.error) return az.error;
  const body = ctx.body ?? {};
  let enabled;
  if (typeof body.enabled === 'boolean') enabled = body.enabled;
  else if (typeof body.state === 'string') enabled = ['active', 'enabled'].includes(body.state.toLowerCase());
  else return err(400, 'VALIDATION_ERROR', 'body must include enabled:boolean or state:active|suspended');
  try {
    await kc.setUserEnabled(az.realm, ctx.params.userId, enabled);
    return ok(200, { userId: ctx.params.userId, realmId: az.realm, enabled, state: enabled ? 'active' : 'suspended' });
  } catch (e) {
    return kcBackedErr(e, 'SET_USER_STATUS_FAILED');
  }
}

// ---- data plane: workspace database provisioning ---------------------------
// POST /v1/workspaces/{workspaceId}/database — provision a REAL Postgres
// database for the workspace (catalog-level isolation), via a durable saga.
// Provision the workspace's real Postgres database via the durable saga (createDatabase →
// insertRecord). The saga creates the physical DB BEFORE the registry row and compensates on
// failure (drops the DB), so a failure never leaves a workspace_databases row without a backing
// database (#502). Shared by the explicit endpoint and by auto-provisioning at workspace create.
// Throws on failure (after marking the saga failed); the caller maps/handles it.
async function runWorkspaceDbProvisionSaga(pool, { ws, tenant, identity, callerContext }) {
  const saga = await startSaga(pool, 'provisionWorkspaceDatabase', { workspaceId: ws.id, tenantId: ws.tenant_id }, {
    tenantId: ws.tenant_id, workspaceId: ws.id, actorId: identity.sub, actorType: identity.actorType ?? 'superadmin',
    correlationId: callerContext?.correlationId, operationType: 'workspace.database.provision'
  });
  try {
    const conn = await saga.step('createDatabase',
      () => provisionWorkspaceDatabase(pool, { tenantSlug: tenant?.slug ?? ws.tenant_id, wsSlug: ws.slug ?? ws.id }),
      (val) => ({ type: 'pg.dropDatabase', args: { database: val.database } }));
    const rec = await saga.step('insertRecord',
      () => store.insertWorkspaceDatabase(pool, {
        id: randomUUID(), workspaceId: ws.id, tenantId: ws.tenant_id, engine: conn.engine,
        databaseName: conn.database, mode: conn.mode, username: conn.username, host: conn.host, port: conn.port,
        environment: ws.environment ?? 'dev', createdBy: identity.sub }),
      (val) => ({ type: 'store.deleteWorkspaceDatabase', args: { id: val.id } }));
    await saga.complete({ database: conn.database });
    return { database: rec, connection: conn, sagaId: saga.runId };
  } catch (e) {
    await saga.fail(e);
    throw e;
  }
}

async function provisionDatabase(ctx) {
  const { pool, identity } = ctx;
  const r = await resolveWorkspaceForManage(ctx); if (r.error) return r.error;
  if (await store.getWorkspaceDatabase(pool, r.ws.id)) return err(409, 'DB_ALREADY_PROVISIONED', 'workspace already has a database');
  const tenant = await store.getTenant(pool, r.ws.tenant_id);
  try {
    const out = await runWorkspaceDbProvisionSaga(pool, { ws: r.ws, tenant, identity, callerContext: ctx.callerContext });
    // The role password is surfaced ONCE here (not persisted); rotate to re-issue.
    return ok(201, { database: out.database, connection: out.connection, sagaId: out.sagaId });
  } catch (e) {
    return err(e.statusCode && e.statusCode < 500 ? e.statusCode : 502, 'PROVISION_DB_FAILED', String(e.message ?? e));
  }
}
// POST /v1/workspaces/{workspaceId}/databases — engine-dispatched provisioning
// (the SPA's ProvisionDatabaseWizard targets this; engine = postgresql | mongodb).
async function provisionDatabaseGeneric(ctx) {
  const engine = String(ctx.body?.engine ?? 'postgresql').toLowerCase();
  if (engine === 'mongodb') {
    const r = await resolveWorkspaceForManage(ctx); if (r.error) return r.error;
    return MONGO_HANDLERS.mongoProvision({ ...ctx, workspace: r.ws });
  }
  const res = await provisionDatabase(ctx); // postgres path
  if (res.statusCode === 201) return ok(201, { databaseId: res.body?.database?.id, ...res.body });
  return res;
}
// GET /v1/workspaces/{workspaceId}/database — metadata only (no secret).
async function getDatabase(ctx) {
  const r = await resolveWorkspaceForManage(ctx); if (r.error) return r.error;
  const db = await store.getWorkspaceDatabase(ctx.pool, r.ws.id);
  if (!db) return err(404, 'DB_NOT_PROVISIONED', 'workspace has no database');
  return ok(200, { database: db });
}
// POST /v1/workspaces/{workspaceId}/database/credential-rotations — rotate creds.
// A workspace provisioned in `dedicated_role` mode has its own login role; rotation ALTERs that
// role's password (old credential rejected by Postgres, new one accepted) and returns the new DSN
// (201, the resource-created convention the sibling provision/SA-rotation handlers use).
// A workspace in `shared` mode has NO dedicated credential to rotate, so rotation cannot occur.
// That MUST be signalled with a non-success status — a success-shaped 200 {rotated:false} misleads
// the caller/UI into thinking a rotation happened (#686). We return 409 DB_SHARED_MODE (a state
// conflict, matching the DB_ALREADY_PROVISIONED 409 convention) carrying the explanatory reason.
// The dataplane stays a pure discriminated function ({rotated:true|false}); the HTTP mapping lives
// here. Injectable via ctx for deterministic handler tests (parity with deleteWorkspace's seams).
async function rotateDatabaseCredential(ctx) {
  const st = ctx.store ?? store;
  const rotate = ctx.rotateWorkspaceDatabaseCredential ?? rotateWorkspaceDatabaseCredential;
  const r = await resolveWorkspaceForManage(ctx); if (r.error) return r.error;
  const db = await st.getWorkspaceDatabase(ctx.pool, r.ws.id);
  if (!db) return err(404, 'DB_NOT_PROVISIONED', 'workspace has no database');
  try {
    const res = await rotate(ctx.pool, { database: db.database_name, mode: db.mode, username: db.username });
    if (!res.rotated) return err(409, 'DB_SHARED_MODE', res.reason ?? 'workspace database has no dedicated credential to rotate');
    return ok(201, { databaseId: db.id, ...res });
  } catch (e) {
    return err(e.statusCode && e.statusCode < 500 ? e.statusCode : 502, 'ROTATE_DB_FAILED', String(e.message ?? e));
  }
}
// ---- data plane: function registry (execution pends executor/Knative) -------
// POST /v1/workspaces/{workspaceId}/functions — register a function.
async function registerFunction(ctx) {
  const { body, pool, identity } = ctx;
  const r = await resolveWorkspaceForManage(ctx); if (r.error) return r.error;
  const name = slugify(body.name ?? body.displayName);
  if (!name) return err(400, 'VALIDATION_ERROR', 'name is required');
  if (await store.functionNameTaken(pool, r.ws.id, name)) return err(409, 'FUNCTION_EXISTS', `function '${name}' already exists in workspace`);
  const rec = await store.insertFunction(pool, {
    id: randomUUID(), workspaceId: r.ws.id, tenantId: r.ws.tenant_id, name,
    runtime: body.runtime ?? 'nodejs:20', handler: body.handler ?? 'main', sourceRef: body.sourceRef ?? null, createdBy: identity.sub });
  return ok(201, {
    function: rec,
    // Honest: registered, but execution needs the executor/Knative data plane.
    runtimeStatus: 'pending_data_plane',
    message: 'Function registered. Execution activates when the executor/Knative data plane is available.'
  });
}
// GET /v1/workspaces/{workspaceId}/functions — list registered functions.
async function listFunctionsHandler(ctx) {
  const r = await resolveWorkspaceForManage(ctx); if (r.error) return r.error;
  return ok(200, await store.listFunctions(ctx.pool, r.ws.id));
}

// ---- fine-grained IAM: role assignment + group membership ------------------
async function iamListUserRoles(ctx) {
  const kc = ctx.kcAdmin ?? kcAdmin;
  let roles;
  try { roles = await kc.listUserRealmRoles(ctx.params.realmId, ctx.params.userId); }
  catch (e) { return kcBackedErr(e, 'IAM_LIST_USER_ROLES_FAILED'); }
  return ok(200, { items: roles.map((r) => ({ id: r.id, name: r.name, description: r.description })), total: roles.length });
}
async function iamAssignUserRoles(ctx) {
  const roles = Array.isArray(ctx.body.roles) ? ctx.body.roles : [];
  if (!roles.length) return err(400, 'VALIDATION_ERROR', 'roles[] is required');
  const kc = ctx.kcAdmin ?? kcAdmin;
  try { await kc.assignRealmRoles(ctx.params.realmId, ctx.params.userId, roles);
    return ok(201, { userId: ctx.params.userId, realm: ctx.params.realmId, assigned: roles }); }
  catch (e) { return kcBackedErr(e, 'IAM_ASSIGN_ROLE_FAILED'); }
}
async function iamRemoveUserRoles(ctx) {
  const roles = Array.isArray(ctx.body.roles) ? ctx.body.roles : [];
  if (!roles.length) return err(400, 'VALIDATION_ERROR', 'roles[] is required');
  const kc = ctx.kcAdmin ?? kcAdmin;
  try { await kc.removeRealmRoles(ctx.params.realmId, ctx.params.userId, roles);
    return ok(200, { userId: ctx.params.userId, realm: ctx.params.realmId, removed: roles }); }
  catch (e) { return kcBackedErr(e, 'IAM_REMOVE_ROLE_FAILED'); }
}
async function iamListGroupMembers(ctx) {
  const kc = ctx.kcAdmin ?? kcAdmin;
  let members;
  try { members = await kc.listGroupMembers(ctx.params.realmId, ctx.params.groupId, { max: Number(ctx.query.max ?? 200) }); }
  catch (e) { return kcBackedErr(e, 'IAM_LIST_GROUP_MEMBERS_FAILED'); }
  return ok(200, { items: members.map((u) => ({ id: u.id, username: u.username, email: u.email, enabled: u.enabled })), total: members.length });
}
async function iamListUserGroups(ctx) {
  const kc = ctx.kcAdmin ?? kcAdmin;
  let groups;
  try { groups = await kc.listUserGroups(ctx.params.realmId, ctx.params.userId); }
  catch (e) { return kcBackedErr(e, 'IAM_LIST_USER_GROUPS_FAILED'); }
  return ok(200, { items: groups.map((g) => ({ id: g.id, name: g.name, path: g.path })), total: groups.length });
}
async function iamAddUserToGroup(ctx) {
  const kc = ctx.kcAdmin ?? kcAdmin;
  try { await kc.addUserToGroup(ctx.params.realmId, ctx.params.userId, ctx.params.groupId);
    return ok(201, { userId: ctx.params.userId, groupId: ctx.params.groupId, realm: ctx.params.realmId, member: true }); }
  catch (e) { return kcBackedErr(e, 'IAM_GROUP_ADD_FAILED'); }
}
async function iamRemoveUserFromGroup(ctx) {
  const kc = ctx.kcAdmin ?? kcAdmin;
  try { await kc.removeUserFromGroup(ctx.params.realmId, ctx.params.userId, ctx.params.groupId);
    return ok(200, { userId: ctx.params.userId, groupId: ctx.params.groupId, realm: ctx.params.realmId, member: false }); }
  catch (e) { return kcBackedErr(e, 'IAM_GROUP_REMOVE_FAILED'); }
}

// ---- project (tenant) auth-config: login methods + social providers (#568) --
// Enabling username/password + configuring social IdPs per project was only possible via raw
// Keycloak admin (no Falcone API). These owner-scoped handlers drive the realm's auth config.
// Isolation (cardinal rule): resolve the tenant from the path, then guard against the VERIFIED
// identity — a tenant owner may configure ONLY their OWN project's realm (cross-tenant → 403).
async function authorizeAuthConfig(ctx) {
  const tenant = await store.getTenant(ctx.pool, ctx.params.tenantId);
  if (!tenant) return { error: err(404, 'TENANT_NOT_FOUND', `tenant ${ctx.params.tenantId} not found`) };
  if (!canManageTenant(ctx.identity, tenant)) return { error: err(403, 'FORBIDDEN', 'requires superadmin or the tenant owner/admin of this project') };
  return { realm: tenant.iam_realm, tenant };
}
// GET /v1/tenants/{tenantId}/auth-config — read login options + configured social IdPs.
async function getAuthConfig(ctx) {
  const kc = ctx.kcAdmin ?? kcAdmin;
  const az = await authorizeAuthConfig(ctx);
  if (az.error) return az.error;
  try {
    const cfg = await kc.getRealmAuthConfig(az.realm);
    return ok(200, { tenantId: az.tenant.id, realm: az.realm, ...cfg });
  } catch (e) {
    return kcBackedErr(e, 'AUTH_CONFIG_READ_FAILED');
  }
}
// PUT /v1/tenants/{tenantId}/auth-config — toggle auth methods (registration/email/reset/rememberMe).
async function setAuthConfig(ctx) {
  const kc = ctx.kcAdmin ?? kcAdmin;
  const az = await authorizeAuthConfig(ctx);
  if (az.error) return az.error;
  const body = ctx.body ?? {};
  const allowed = ['registrationAllowed', 'loginWithEmailAllowed', 'resetPasswordAllowed', 'rememberMe', 'verifyEmail'];
  const patch = {};
  for (const k of allowed) if (typeof body[k] === 'boolean') patch[k] = body[k];
  if (Object.keys(patch).length === 0) return err(400, 'VALIDATION_ERROR', `body must include at least one boolean of: ${allowed.join(', ')}`);
  try {
    await kc.setRealmAuthConfig(az.realm, patch);
    const cfg = await kc.getRealmAuthConfig(az.realm);
    return ok(200, { tenantId: az.tenant.id, realm: az.realm, ...cfg });
  } catch (e) {
    return kcBackedErr(e, 'AUTH_CONFIG_WRITE_FAILED');
  }
}
// PUT /v1/tenants/{tenantId}/auth-config/identity-providers/{alias} — create/update a social IdP.
async function setSocialProvider(ctx) {
  const kc = ctx.kcAdmin ?? kcAdmin;
  const az = await authorizeAuthConfig(ctx);
  if (az.error) return az.error;
  const alias = ctx.params.alias;
  const body = ctx.body ?? {};
  const providerId = body.providerId ?? alias;
  if (!alias) return err(400, 'VALIDATION_ERROR', 'identity-provider alias is required');
  if (!providerId) return err(400, 'VALIDATION_ERROR', 'providerId is required');
  try {
    await kc.upsertIdentityProvider(az.realm, {
      alias, providerId, enabled: body.enabled !== false, displayName: body.displayName, config: body.config ?? {},
    });
    const cfg = await kc.getRealmAuthConfig(az.realm);
    return ok(200, { tenantId: az.tenant.id, realm: az.realm, alias, providerId, identityProviders: cfg.identityProviders });
  } catch (e) {
    return kcBackedErr(e, 'SOCIAL_PROVIDER_WRITE_FAILED');
  }
}
// DELETE /v1/tenants/{tenantId}/auth-config/identity-providers/{alias} — remove a social IdP.
async function deleteSocialProvider(ctx) {
  const kc = ctx.kcAdmin ?? kcAdmin;
  const az = await authorizeAuthConfig(ctx);
  if (az.error) return az.error;
  const alias = ctx.params.alias;
  if (!alias) return err(400, 'VALIDATION_ERROR', 'identity-provider alias is required');
  try {
    await kc.deleteIdentityProvider(az.realm, alias);
    return ok(200, { tenantId: az.tenant.id, realm: az.realm, alias, deleted: true });
  } catch (e) {
    return kcBackedErr(e, 'SOCIAL_PROVIDER_DELETE_FAILED');
  }
}

// ---- scope-enforcement denial ingest (#557) --------------------------------
// The gateway's scope-enforcement plugin (deploy/gateway-config/plugins/
// scope-enforcement.lua) POSTs a snake_case denial payload to its sidecar when it
// denies a request (SCOPE_INSUFFICIENT / WORKSPACE_SCOPE_MISMATCH /
// PLAN_ENTITLEMENT_DENIED / CONFIG_ERROR). In this runtime that sidecar is this
// endpoint: it records the denial into scope_enforcement_denials (the store the
// scope-enforcement audit query reads), carrying tenant_id / workspace_id / actor_id /
// correlation_id so the audit returns it tenant-scoped. Internal (platform) only.
async function recordScopeEnforcementDenial(ctx) {
  const body = ctx.body ?? {};
  const tenantId = body.tenant_id ?? body.tenantId;
  const actorId = body.actor_id ?? body.actorId;
  const correlationId = body.correlation_id ?? body.correlationId ?? ctx.callerContext?.correlationId;
  if (!tenantId || !actorId || !correlationId) {
    return err(400, 'VALIDATION_ERROR', 'tenant_id, actor_id and correlation_id are required');
  }
  const row = await recordScopeDenial(ctx.pool, {
    tenantId, workspaceId: body.workspace_id ?? body.workspaceId ?? null,
    actorId, actorType: body.actor_type ?? body.actorType ?? 'user',
    denialType: body.denial_type ?? body.denialType ?? 'SCOPE_INSUFFICIENT',
    httpMethod: body.http_method ?? body.httpMethod ?? 'GET',
    requestPath: body.request_path ?? body.requestPath ?? '/',
    requiredScopes: body.required_scopes ?? body.requiredScopes ?? [],
    presentedScopes: body.presented_scopes ?? body.presentedScopes ?? [],
    missingScopes: body.missing_scopes ?? body.missingScopes ?? [],
    requiredEntitlement: body.required_entitlement ?? body.requiredEntitlement ?? null,
    currentPlanId: body.current_plan_id ?? body.currentPlanId ?? null,
    sourceIp: body.source_ip ?? body.sourceIp ?? null,
    correlationId, deniedAt: body.denied_at ?? body.deniedAt ?? new Date().toISOString()
  });
  return ok(202, { recorded: Boolean(row), denialId: row?.id ?? null });
}

// GET /v1/console/session — lightweight whoami for the web-console. Confirms the bearer
// session is valid (the reconnect-state-sync probe relies on it for early 401 detection)
// and returns the VERIFIED principal (never the request body/headers). Authenticated, so
// tenant operators reach it too. Previously unrouted → 404 broke the reconnect sync and
// left a dead SPA reference (P1 console operator shell).
function consoleSession(ctx) {
  const id = ctx.identity ?? {};
  return ok(200, {
    authenticated: true,
    principal: {
      sub: id.sub ?? null,
      tenantId: id.tenantId ?? null,
      workspaceId: id.workspaceId ?? null,
      actorType: id.actorType ?? null,
      roles: id.roles ?? [],
      scopes: id.scopes ?? [],
    },
    serverTime: new Date().toISOString(),
  });
}

export const LOCAL_HANDLERS = {
  consoleSession,
  createTenant, listTenants, getTenant, deleteTenant, purgeTenant, listEnvironments, createTenantUser, listTenantUsers,
  createInvitation,
  recordScopeEnforcementDenial,
  getAuthConfig, setAuthConfig, setSocialProvider, deleteSocialProvider,
  createWorkspace, listWorkspaces, listTenantWorkspaces, getWorkspace, promoteWorkspace, cloneWorkspace, deleteWorkspace,
  exportTenantConfiguration,
  createServiceAccount, getServiceAccount, listServiceAccounts: listServiceAccountsHandler,
  issueCredential, rotateCredential, revokeCredential, deleteServiceAccount,
  provisionDatabase, provisionDatabaseGeneric, getDatabase, rotateDatabaseCredential, registerFunction, listFunctions: listFunctionsHandler,
  iamListUsers, iamGetUser, iamCreateUser, iamDeleteUser, iamSetUserStatus, iamListRoles, iamGetRole, iamDeleteRole, iamCreateRole, iamListGroups, iamCreateGroup, iamListClients,
  iamListRealms, iamGetRealm, iamUpdateRealm,
  iamListUserRoles, iamAssignUserRoles, iamRemoveUserRoles,
  iamListGroupMembers, iamListUserGroups, iamAddUserToGroup, iamRemoveUserFromGroup,
  ...METRICS_HANDLERS,
  ...STORAGE_HANDLERS,
  ...MONGO_HANDLERS,
  ...PG_HANDLERS,
  ...KAFKA_HANDLERS,
  ...FN_HANDLERS,
  ...WEBHOOK_HANDLERS,
  ...REALTIME_HANDLERS,
  ...APPLICATION_HANDLERS,
  ...KNATIVE_RUNTIME_HANDLERS,
  ...AUTH_HANDLERS
};

// Exported for unit testing the plan-resolution / best-effort assignment contract.
export { isPlanUuid, assignPlanBestEffort };
