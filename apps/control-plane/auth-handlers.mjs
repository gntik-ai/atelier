// Domain B — console auth endpoints (login/refresh/logout/signup-policy).
//
// The SPA's LoginPage calls these (apps/web-console/src/lib/console-auth.ts);
// the repo ships no implementation. We back them with Keycloak ROPC against the
// platform realm + public console client, returning the ConsoleLoginSession
// shape the SPA expects. Handler contract: async (ctx) => { statusCode, body }.
import { randomUUID } from 'node:crypto';
import { kcAdmin } from './kc-admin.mjs';
import * as store from './tenant-store.mjs';
const KC_BASE = (process.env.KEYCLOAK_BASE_URL || 'http://falcone-keycloak:8080').replace(/\/+$/, '');
const REALM = process.env.CONSOLE_AUTH_REALM || 'in-falcone-platform';
const CLIENT = process.env.CONSOLE_AUTH_CLIENT_ID || 'in-falcone-console';
const SELF_SERVICE = (process.env.CONSOLE_SIGNUP_SELF_SERVICE ?? 'true') === 'true';
// Self-service signup minimum password length. Single source of truth for the
// value advertised by signupPolicy AND enforced by signup (no drift, #669).
// Fail-closed to 8 on missing/invalid config: if CONSOLE_SIGNUP_PASSWORD_MIN_LENGTH
// is unset or garbage, Number(...) is NaN and `length < NaN` is always false, which
// would silently DISABLE enforcement (fail-open) — so we fall back to 8, never NaN.
const SIGNUP_PASSWORD_MIN_LENGTH = (() => {
  const n = Number(process.env.CONSOLE_SIGNUP_PASSWORD_MIN_LENGTH);
  return Number.isInteger(n) && n > 0 ? n : 8;
})();
const ok = (statusCode, body) => ({ statusCode, body });
const errBody = (statusCode, code, message) => ({ statusCode, body: { code, message, statusView: 'login' } });

const CONSOLE_ACCOUNT_STATUS_VIEWS = Object.freeze({
  login: Object.freeze({
    statusView: 'login',
    title: 'Inicia sesión en Falcone',
    message: 'Usa tus credenciales de consola para acceder a tus tenants y workspaces.',
    allowedActions: Object.freeze([
      Object.freeze({ actionId: 'start_login', label: 'Iniciar sesión', target: '/login' }),
      Object.freeze({ actionId: 'create_account', label: 'Crear cuenta', target: '/signup' })
    ])
  }),
  signup: Object.freeze({
    statusView: 'signup',
    title: 'Crea tu cuenta de consola',
    message: 'Completa el registro para solicitar acceso a Falcone o activar el alta configurada para tu tenant.',
    allowedActions: Object.freeze([
      Object.freeze({ actionId: 'create_account', label: 'Crear cuenta', target: '/signup' }),
      Object.freeze({ actionId: 'start_login', label: 'Iniciar sesión', target: '/login' })
    ])
  }),
  pending_activation: Object.freeze({
    statusView: 'pending_activation',
    title: 'Tu registro está pendiente de activación',
    message: 'Hemos recibido tu solicitud de acceso, pero todavía necesita aprobación o activación antes de entrar en la consola.',
    // PendingActivationPage already owns the login/signup escape actions, and
    // LoginPage has a pending-state fallback that links to that page.
    allowedActions: Object.freeze([])
  }),
  account_suspended: Object.freeze({
    statusView: 'account_suspended',
    title: 'Tu cuenta está suspendida',
    message: 'El acceso a la consola está suspendido temporalmente para esta cuenta.',
    allowedActions: Object.freeze([
      Object.freeze({ actionId: 'return_to_login', label: 'Volver a login', target: '/login' })
    ])
  }),
  credentials_expired: Object.freeze({
    statusView: 'credentials_expired',
    title: 'Tus credenciales han expirado',
    message: 'Necesitas actualizar o recuperar tus credenciales antes de volver a entrar.',
    allowedActions: Object.freeze([
      Object.freeze({ actionId: 'recover_password', label: 'Recuperar contraseña', target: '/password-recovery' }),
      Object.freeze({ actionId: 'return_to_login', label: 'Volver a login', target: '/login' })
    ])
  }),
  password_recovery: Object.freeze({
    statusView: 'password_recovery',
    title: 'Recupera el acceso a tu cuenta',
    message: 'Solicita instrucciones de recuperación para volver a acceder a la consola.',
    allowedActions: Object.freeze([
      Object.freeze({ actionId: 'recover_password', label: 'Recuperar contraseña', target: '/password-recovery' }),
      Object.freeze({ actionId: 'return_to_login', label: 'Volver a login', target: '/login' })
    ])
  })
});

function decodeJwt(token) {
  try { const p = token.split('.')[1]; return JSON.parse(Buffer.from(p, 'base64url').toString()); } catch { return {}; }
}
function isoIn(secs) { return new Date(Date.now() + secs * 1000).toISOString(); }

function sessionFromTokenResponse(data, sessionId) {
  const claims = decodeJwt(data.access_token);
  const roles = claims?.realm_access?.roles ?? [];
  const platformRoles = roles.filter((r) => /^(superadmin|platform_|tenant_|workspace_)/.test(r));
  return {
    sessionId,
    authenticationState: 'active',
    statusView: 'login',
    issuedAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    expiresAt: isoIn(data.expires_in ?? 300),
    idleExpiresAt: isoIn(data.expires_in ?? 300),
    refreshExpiresAt: isoIn(data.refresh_expires_in ?? 1800),
    sessionPolicy: {},
    tokenSet: {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? '',
      expiresAt: isoIn(data.expires_in ?? 300),
      refreshExpiresAt: isoIn(data.refresh_expires_in ?? 1800),
      expiresIn: data.expires_in ?? 300,
      refreshExpiresIn: data.refresh_expires_in ?? 1800,
      scope: data.scope ?? 'openid',
      tokenType: 'Bearer'
    },
    principal: {
      displayName: claims.name ?? claims.preferred_username ?? 'User',
      primaryEmail: claims.email ?? '',
      state: 'active',
      userId: claims.sub ?? '',
      username: claims.preferred_username ?? '',
      platformRoles,
      tenantIds: claims.tenant_id ? [claims.tenant_id] : [],
      workspaceIds: claims.workspace_id ? [claims.workspace_id] : []
    }
  };
}

async function kcToken(form, fetchImpl = fetch) {
  const res = await fetchImpl(`${KC_BASE}/realms/${encodeURIComponent(REALM)}/protocol/openid-connect/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form)
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// Revoke a refresh token AND end the corresponding Keycloak SSO session.
// `in-falcone-console` is a PUBLIC client, so no client_secret is sent. Keycloak
// returns 204 on success; the revoked refresh token then yields invalid_grant on
// any later refresh. Mirrors kcToken's structure; the fetch impl is injectable so
// tests can fake Keycloak without a live server.
async function kcLogout(refreshToken, fetchImpl = fetch) {
  const res = await fetchImpl(`${KC_BASE}/realms/${encodeURIComponent(REALM)}/protocol/openid-connect/logout`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT, refresh_token: refreshToken })
  });
  return { ok: res.ok, status: res.status };
}

// POST /v1/auth/login-sessions  (PUBLIC) — ROPC login.
async function login(ctx) {
  const { body } = ctx;
  if (!body.username || !body.password) return errBody(400, 'VALIDATION_ERROR', 'username and password are required');
  const r = await kcToken({ grant_type: 'password', client_id: CLIENT, scope: 'openid', username: body.username, password: body.password });
  if (!r.ok) {
    const desc = r.data.error_description || r.data.error || 'authentication failed';
    return errBody(401, 'INVALID_CREDENTIALS', desc);
  }
  return ok(201, sessionFromTokenResponse(r.data, randomId()));
}

// POST /v1/auth/login-sessions/{sessionId}/refresh  (PUBLIC) — refresh tokens.
async function refresh(ctx) {
  const { body, params } = ctx;
  if (!body.refreshToken) return errBody(400, 'VALIDATION_ERROR', 'refreshToken is required');
  const r = await kcToken({ grant_type: 'refresh_token', client_id: CLIENT, refresh_token: body.refreshToken }, ctx._fetch ?? fetch);
  if (!r.ok) return errBody(401, 'REFRESH_FAILED', r.data.error_description || 'refresh failed');
  return ok(200, sessionFromTokenResponse(r.data, params.sessionId || randomId()));
}

// DELETE /v1/auth/login-sessions/{sessionId}  (authenticated) — logout.
// The SPA sends the session's refresh token in the request body; we revoke it at
// Keycloak and end the SSO session so no further access tokens can be minted from
// this session (the bare accept was a no-op: the refresh token kept working — #667).
async function logout(ctx) {
  const refreshToken = ctx.body?.refreshToken;
  if (refreshToken) {
    // Best-effort for the RESPONSE (always return accepted; never leak Keycloak
    // error detail), but the revoke MUST be attempted when a token is supplied.
    try {
      await kcLogout(refreshToken, ctx._fetch ?? fetch);
    } catch (e) {
      // Network/Keycloak failure: log server-side, still accept locally. The token
      // remains valid until expiry in this degraded case, but we do not 500.
      console.error('[control-plane] logout: Keycloak refresh-token revoke failed:', e?.message ?? e);
    }
  }
  // Tolerant of older clients that omit the refresh token (no 500): accept locally.
  return ok(200, { sessionId: ctx.params.sessionId, status: 'accepted', acceptedAt: new Date().toISOString() });
}

// GET /v1/auth/signups/policy  (PUBLIC) — self-service registration policy.
async function signupPolicy() {
  return ok(200, {
    selfServiceEnabled: SELF_SERVICE,
    mode: SELF_SERVICE ? 'self_service' : 'invitation',
    statusView: 'signup',
    passwordPolicy: { minLength: SIGNUP_PASSWORD_MIN_LENGTH },
    message: SELF_SERVICE ? 'Self-service signup is enabled.' : 'Signup is invitation-only in this deployment.'
  });
}

// GET /v1/auth/status-views/{statusViewId} (PUBLIC) — static console copy.
// This endpoint is deliberately dependency-free: it returns the contract's
// canonical status-view envelopes without touching Keycloak, the DB, or tenant
// state, so public auth pages can load before a user has a session.
async function getConsoleAccountStatusView(ctx) {
  const statusViewId = ctx.params?.statusViewId;
  const view = Object.prototype.hasOwnProperty.call(CONSOLE_ACCOUNT_STATUS_VIEWS, statusViewId)
    ? CONSOLE_ACCOUNT_STATUS_VIEWS[statusViewId]
    : null;
  if (!view) {
    return ok(404, {
      code: 'STATUS_VIEW_NOT_FOUND',
      message: `Unknown console account status view: ${statusViewId ?? ''}`
    });
  }
  return ok(200, {
    statusView: view.statusView,
    title: view.title,
    message: view.message,
    allowedActions: view.allowedActions.map((action) => ({ ...action }))
  });
}

// POST /v1/auth/signups  (PUBLIC) — self-service account creation in the
// tenant's own iam_realm (NOT the shared platform realm). Resolves the tenant
// by body.tenantId, validates that the tenant has a provisioned iam_realm,
// then creates an enabled Keycloak user with the supplied password and stamps
// tenant_id/workspace_id attributes so the tenant-context client scope maps
// them into access-token claims (ConsoleSignupRegistration shape).
async function signup(ctx) {
  const { body, pool } = ctx;
  // Allow test injection via ctx._kcAdmin; fall back to the module-level singleton.
  const kc = ctx._kcAdmin ?? kcAdmin;
  if (!SELF_SERVICE) return errBody(403, 'SIGNUP_DISABLED', 'Self-service signup is disabled');
  const username = body.username ?? body.primaryEmail;
  if (!username || !body.password) return errBody(400, 'VALIDATION_ERROR', 'username and password are required');
  // Enforce the advertised minimum password length BEFORE the tenant lookup /
  // kc.createUser, so a sub-minimum password creates NO Keycloak user and NO DB
  // side effect. The advertised value (signupPolicy) and this enforced value share
  // SIGNUP_PASSWORD_MIN_LENGTH, so they cannot drift (#669).
  if (String(body.password).length < SIGNUP_PASSWORD_MIN_LENGTH) {
    return errBody(400, 'VALIDATION_ERROR', `password must be at least ${SIGNUP_PASSWORD_MIN_LENGTH} characters`);
  }
  if (!body.tenantId) return errBody(400, 'VALIDATION_ERROR', 'tenantId is required');

  // Resolve the tenant and obtain its iam_realm (realm-per-tenant model).
  const tenant = await store.getTenant(pool, body.tenantId);
  if (!tenant) return errBody(404, 'TENANT_NOT_FOUND', `tenant ${body.tenantId} not found`);
  if (!tenant.iam_realm) return errBody(422, 'REALM_NOT_PROVISIONED', `tenant ${body.tenantId} has no iam_realm provisioned`);

  const realm = tenant.iam_realm;
  const attributes = {};
  attributes.tenant_id = tenant.id;
  // The workspace binding must be REAL before it is stamped (#961). This endpoint is public and
  // takes workspaceId straight from the request body; workspace_id is also the claim
  // workspace-scoped authorization binds to. Until #961 the attribute was silently discarded by
  // Keycloak, so an unchecked value was inert — now that it reaches the token, an unchecked value
  // would be self-assignment of any workspace, so it is resolved and required to belong to the
  // tenant being signed up for.
  //
  // Unknown and foreign workspaces share ONE response: a public endpoint that distinguished them
  // would answer "does workspace X exist" for any caller.
  //
  // 400, not 422: workspaceId is caller-supplied payload, so this is the same class as the
  // VALIDATION_ERRORs above, and 400 is one of the statuses the published contract already
  // declares for this operation ("The signup payload is malformed") — no new response class
  // enters the contract drift.
  // Scoped by tenant, not filtered after the fact: `workspaces.slug` is only
  // `UNIQUE (tenant_id, slug)`, so an unscoped `id = $1 OR slug = $1` resolves a common slug like
  // `default` to whichever tenant wins an arbitrary LIMIT 1 — which would refuse a tenant its OWN
  // workspace. The `tenant_id` re-check below is belt-and-braces on top of the scoped query.
  if (body.workspaceId) {
    const workspace = await store.getWorkspaceInTenant(pool, tenant.id, body.workspaceId);
    if (!workspace || workspace.tenant_id !== tenant.id) {
      return errBody(400, 'WORKSPACE_NOT_IN_TENANT', 'workspaceId does not identify a workspace of this tenant');
    }
    attributes.workspace_id = workspace.id;
  }

  try {
    const userId = await kc.createUser(realm, {
      username, email: body.primaryEmail ?? null,
      firstName: (body.displayName ?? username).split(' ')[0],
      lastName: (body.displayName ?? '').split(' ').slice(1).join(' ') || 'User',
      password: body.password, enabled: true, temporary: false,
      attributes
    });
    return ok(201, {
      registrationId: randomUUID(), userId, activationMode: 'self_service', state: 'active',
      statusView: 'login', createdAt: new Date().toISOString(),
      message: 'Account created. You can now sign in.'
    });
  } catch (e) {
    if (e.kcStatus === 409) return errBody(409, 'USERNAME_TAKEN', 'That username or email is already registered');
    return errBody(e.statusCode && e.statusCode < 500 ? e.statusCode : 502, 'SIGNUP_FAILED', String(e.message ?? e));
  }
}

// Session identifier — cryptographically strong (not Math.random, which is a
// security-sensitive context: this id identifies the console session).
function randomId() { return 'cs_' + randomUUID().replace(/-/g, ''); }

export const AUTH_HANDLERS = { login, refresh, logout, signupPolicy, signup, getConsoleAccountStatusView };
