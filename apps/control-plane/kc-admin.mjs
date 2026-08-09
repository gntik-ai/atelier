// Keycloak admin client for the control-plane (domain B).
//
// The repo's createTenant/user sagas are stubs (workflows/wf-con-002.mjs:
// createKeycloakRealm just returns a snapshot, no real call). So domain B needs a
// real admin client. This talks to the Keycloak admin REST API using the
// master-realm admin credentials (password grant, client admin-cli). Zero deps
// (native fetch). Falcone's tenancy model is realm-per-tenant: each tenant gets
// its own Keycloak realm (realm name == tenantId), per
// packages/provisioning-orchestrator/src/reprovision/identifier-map.mjs::deriveIamRealm.
const BASE = (process.env.KEYCLOAK_BASE_URL || 'http://falcone-keycloak:8080').replace(/\/+$/, '');
const ADMIN_USER = process.env.KEYCLOAK_ADMIN_USERNAME || 'admin';
const ADMIN_PASS = process.env.KEYCLOAK_ADMIN_PASSWORD || '';

export const KEYCLOAK_ADMIN_SAFE_MESSAGE = 'Identity provider operation failed. Please retry or contact support if the problem continues.';

function diagnosticBody(body) {
  if (body === undefined || body === null) return '';
  return typeof body === 'string' ? body : JSON.stringify(body);
}

function looksLikeRawKeycloakAdminMessage(message) {
  const text = String(message ?? '');
  return /^keycloak\s+[A-Z]+\s+\/realms\//i.test(text)
    || /^keycloak\s+admin\s+token\s+failed\b/i.test(text)
    || /\bkeycloak\s+[A-Z]+\s+\/admin\/realms\//i.test(text)
    || /https?:\/\/\S+\/admin\/realms\//i.test(text)
    || /\/admin\/realms\//i.test(text)
    || /\/realms\/[^/\s]+\/(?:users|roles|clients|groups|identity-provider|client-scopes|default-default-client-scopes)\b/i.test(text);
}

export class KeycloakAdminError extends Error {
  constructor({ method = 'REQUEST', path = '', status = 502, statusCode, body = null, diagnosticMessage } = {}) {
    super(KEYCLOAK_ADMIN_SAFE_MESSAGE);
    this.name = 'KeycloakAdminError';
    this.code = 'KEYCLOAK_ADMIN_REQUEST_FAILED';
    this.statusCode = statusCode ?? status ?? 502;
    this.kcStatus = status;
    this.safeMessage = KEYCLOAK_ADMIN_SAFE_MESSAGE;

    Object.defineProperties(this, {
      method: { value: method, enumerable: false },
      path: { value: path, enumerable: false },
      upstreamStatus: { value: status, enumerable: false },
      upstreamBody: { value: body, enumerable: false },
      diagnosticMessage: {
        value: diagnosticMessage ?? `keycloak ${method} ${path} -> ${status}: ${diagnosticBody(body)}`,
        enumerable: false
      }
    });
  }
}

export function isKeycloakAdminError(error) {
  return error instanceof KeycloakAdminError
    || error?.code === 'KEYCLOAK_ADMIN_REQUEST_FAILED'
    || typeof error?.kcStatus === 'number'
    || looksLikeRawKeycloakAdminMessage(error?.message ?? error);
}

export function safeKeycloakAdminMessage(error, fallback = KEYCLOAK_ADMIN_SAFE_MESSAGE) {
  if (isKeycloakAdminError(error)) return error?.safeMessage ?? fallback;
  const message = String(error?.message ?? error ?? '').trim();
  if (!message || looksLikeRawKeycloakAdminMessage(message)) return fallback;
  return message;
}

// Deployment-configured redirect-URI / web-origin allow-list for per-tenant public app clients
// (#670). NEVER a wildcard: a `['*']` allow-list makes the authorization endpoint accept an
// arbitrary attacker-controlled `redirect_uri` (auth-code interception). Parse a comma-separated
// env list and drop any wildcard entry; fall back to a NON-wildcard placeholder when unset.
//   - TENANT_APP_REDIRECT_URIS: e.g. "https://app.dev.example.com/*,http://localhost:8088/*"
//   - TENANT_APP_WEB_ORIGINS:   e.g. "+"  (Keycloak idiom for "the registered redirect URIs'
//     origins" — explicitly NOT `*`).
export function parseAllowList(raw, fallback) {
  const items = String(raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => s !== '*'); // a wildcard is never an acceptable allow-list entry
  return items.length > 0 ? items : fallback;
}
// Non-wildcard fallbacks (repo convention placeholder host). `+` web-origin = "origins of the
// registered redirect URIs", which is NOT `*`.
const DEFAULT_APP_REDIRECT_URIS = parseAllowList(process.env.TENANT_APP_REDIRECT_URIS, ['https://app.in-falcone.example.com/*']);
const DEFAULT_APP_WEB_ORIGINS = parseAllowList(process.env.TENANT_APP_WEB_ORIGINS, ['+']);

// Keycloak brute-force detection for provisioned tenant realms (#668). Keycloak defaults
// `bruteForceProtected` to FALSE, so without this every provisioned realm accepts unlimited
// wrong-password attempts (no lockout, attack-detection not even counting) — a brute-force /
// credential-stuffing exposure on every tenant. We turn detection ON by default and stamp sane,
// env-overridable thresholds onto the realm representation at create time (mirrors the #670
// module-level env pattern: parse once at load into DEFAULT_* consts). The `failureFactor`
// default is deliberately 10 (Keycloak's own default of 30 is too weak) — meaningful protection
// while still typo-tolerant.
//
// Env knobs (all optional; safe defaults applied when unset):
//   - REALM_BRUTE_FORCE_PROTECTED            (bool, default true)  — master on/off switch
//   - REALM_BRUTE_FORCE_FAILURE_FACTOR       (int,  default 10)    — failures before lockout
//   - REALM_BRUTE_FORCE_MAX_WAIT_SECONDS     (int,  default 900)   — max temporary lockout window
//   - REALM_BRUTE_FORCE_PERMANENT_LOCKOUT    (bool, default false) — disable the account permanently
//   - REALM_BRUTE_FORCE_WAIT_INCREMENT_SECONDS        (int, default 60)
//   - REALM_BRUTE_FORCE_QUICK_LOGIN_WAIT_SECONDS      (int, default 60)
//   - REALM_BRUTE_FORCE_QUICK_LOGIN_CHECK_MS          (int, default 1000)
//   - REALM_BRUTE_FORCE_MAX_DELTA_SECONDS             (int, default 43200)
function parseBool(raw, fallback) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const v = String(raw).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(v)) return true;
  if (['false', '0', 'no', 'off'].includes(v)) return false;
  return fallback;
}
function parseIntEnv(raw, fallback) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const n = Number.parseInt(String(raw).trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
// Build the Keycloak RealmRepresentation brute-force fields from env (or an explicit override),
// applying the documented defaults. Returns a plain object ready to spread into a realm rep / PUT.
// Exported so the unit test can assert the env-resolution contract directly (mirrors how #670
// exports `parseAllowList`).
export function bruteForceRealmConfig(env = process.env) {
  return {
    bruteForceProtected: parseBool(env.REALM_BRUTE_FORCE_PROTECTED, true),
    failureFactor: parseIntEnv(env.REALM_BRUTE_FORCE_FAILURE_FACTOR, 10),
    maxFailureWaitSeconds: parseIntEnv(env.REALM_BRUTE_FORCE_MAX_WAIT_SECONDS, 900),
    waitIncrementSeconds: parseIntEnv(env.REALM_BRUTE_FORCE_WAIT_INCREMENT_SECONDS, 60),
    minimumQuickLoginWaitSeconds: parseIntEnv(env.REALM_BRUTE_FORCE_QUICK_LOGIN_WAIT_SECONDS, 60),
    quickLoginCheckMilliSeconds: parseIntEnv(env.REALM_BRUTE_FORCE_QUICK_LOGIN_CHECK_MS, 1000),
    maxDeltaTimeSeconds: parseIntEnv(env.REALM_BRUTE_FORCE_MAX_DELTA_SECONDS, 43200),
    permanentLockout: parseBool(env.REALM_BRUTE_FORCE_PERMANENT_LOCKOUT, false),
  };
}
const DEFAULT_BRUTE_FORCE = bruteForceRealmConfig(process.env);

let cachedToken = null; // { token, exp }
async function adminToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - 30 > now) return cachedToken.token;
  const res = await fetch(`${BASE}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: ADMIN_USER, password: ADMIN_PASS })
  });
  if (!res.ok) {
    const body = await res.text();
    throw new KeycloakAdminError({
      method: 'POST',
      path: '/realms/master/protocol/openid-connect/token',
      status: res.status,
      statusCode: 502,
      body,
      diagnosticMessage: `keycloak admin token failed: ${res.status} ${body}`
    });
  }
  const data = await res.json();
  cachedToken = { token: data.access_token, exp: now + (data.expires_in ?? 60) };
  return cachedToken.token;
}

async function kc(method, path, body) {
  const token = await adminToken();
  const res = await fetch(`${BASE}/admin${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) {
    throw new KeycloakAdminError({ method, path, status: res.status, statusCode: res.status, body: json });
  }
  // Keycloak returns 201 + Location header (no body) on creates; surface the id.
  const loc = res.headers.get('location');
  return { status: res.status, json, id: loc ? loc.split('/').pop() : undefined };
}

export function normalizeKeycloakAttributes(attributes = {}) {
  return Object.fromEntries(Object.entries(attributes).map(([key, value]) => {
    const values = Array.isArray(value) ? value : [value];
    return [key, values.map((entry) => String(entry))];
  }));
}

export const kcAdmin = {
  base: BASE,
  async realmExists(realm) {
    try { await kc('GET', `/realms/${encodeURIComponent(realm)}`); return true; }
    catch (e) { if (e.kcStatus === 404) return false; throw e; }
  },
  async createRealm({ realm, displayName, enabled = true }) {
    await kc('POST', '/realms', {
      realm, displayName: displayName ?? realm, enabled,
      loginWithEmailAllowed: true, registrationAllowed: false, rememberMe: true,
      resetPasswordAllowed: true, verifyEmail: false,
      // Brute-force detection ON by default with env-overridable thresholds (#668). Without this,
      // Keycloak defaults `bruteForceProtected:false` and the realm accepts unlimited wrong-password
      // attempts (no lockout). Spreading the resolved config keeps the realm rep self-contained.
      ...DEFAULT_BRUTE_FORCE,
      attributes: { 'in-falcone.realm-type': 'tenant', 'in-falcone.control-plane.platform-realm': 'in-falcone-platform' }
    });
    // Keycloak 26's declarative user profile requires email/firstName/lastName for role "user",
    // so a tenant principal provisioned without them fails Direct Access Grant with
    // invalid_grant "Account is not fully set up" — even with requiredActions:[] (#496). Relax
    // those to optional so any provisioned user can authenticate (the platform realm gets the
    // same treatment from the chart bootstrap's ensure_keycloak_user_profile).
    await this.relaxUserProfile(realm);
    // Apply the chart tenantRealmTemplate.requiredClientScopes to the new realm so a provisioned
    // tenant realm carries the template's required client scopes (no more template drift) — mirrors
    // the requiredRealmRoles applied by createRealmRoles (#568).
    await this.applyRequiredClientScopes(realm, TENANT_REALM_SCOPES);
  },
  // Make email/firstName/lastName optional in the realm's KC26 user profile, and DECLARE the
  // identity attributes the platform stamps on its principals. Idempotent (read-merge-PUT).
  //
  // #961: Keycloak 26's declarative user profile is always on and unmanaged attributes are
  // disabled by default, so an attribute that is not declared here is silently DISCARDED at
  // persist time — no error to the caller. `createUser` duly sent tenant_id/workspace_id and the
  // user came back with `attributes: null`, which is why no principal on this platform ever
  // received a workspace_id claim.
  async relaxUserProfile(realm) {
    const prof = (await kc('GET', `/realms/${encodeURIComponent(realm)}/users/profile`)).json;
    if (!prof || !Array.isArray(prof.attributes)) return;
    let changed = false;
    for (const attr of prof.attributes) {
      if (['email', 'firstName', 'lastName'].includes(attr.name) && attr.required) {
        delete attr.required;
        changed = true;
      }
    }
    for (const declaration of IDENTITY_PROFILE_ATTRIBUTES) {
      if (prof.attributes.some((attr) => attr.name === declaration.name)) continue;
      prof.attributes.push(structuredClone(declaration));
      changed = true;
    }
    if (changed) await kc('PUT', `/realms/${encodeURIComponent(realm)}/users/profile`, prof);
  },
  async deleteRealm(realm) { try { await kc('DELETE', `/realms/${encodeURIComponent(realm)}`); } catch (e) { if (e.kcStatus !== 404) throw e; } },

  // ---- realm auth-config: login methods + social identity providers (#568) ---
  // A project owner toggles auth methods (username/password registration, email login,
  // password reset, remember-me) and configures social IdPs through the Falcone API; these
  // drive the realm's KC config. Idempotent (read-merge-PUT / upsert), zero-dep like the rest.

  // Read the realm's login options + the social identity providers it has configured.
  async getRealmAuthConfig(realm) {
    const r = (await kc('GET', `/realms/${encodeURIComponent(realm)}`)).json ?? {};
    const idps = await this.listIdentityProviders(realm);
    return {
      registrationAllowed: r.registrationAllowed === true,
      loginWithEmailAllowed: r.loginWithEmailAllowed !== false,
      resetPasswordAllowed: r.resetPasswordAllowed === true,
      rememberMe: r.rememberMe === true,
      verifyEmail: r.verifyEmail === true,
      identityProviders: idps,
    };
  },
  // Toggle realm login options. Read-merge-PUT so only the supplied flags change (idempotent).
  async setRealmAuthConfig(realm, patch = {}) {
    const current = (await kc('GET', `/realms/${encodeURIComponent(realm)}`)).json ?? {};
    const allowed = ['registrationAllowed', 'loginWithEmailAllowed', 'resetPasswordAllowed', 'rememberMe', 'verifyEmail'];
    const next = { ...current };
    for (const k of allowed) if (k in patch && typeof patch[k] === 'boolean') next[k] = patch[k];
    await kc('PUT', `/realms/${encodeURIComponent(realm)}`, next);
  },

  // ---- social identity providers (Keycloak /identity-provider/instances) ------
  async listIdentityProviders(realm) {
    const list = (await kc('GET', `/realms/${encodeURIComponent(realm)}/identity-provider/instances`)).json ?? [];
    return list.map((p) => ({ alias: p.alias, providerId: p.providerId, enabled: p.enabled !== false, displayName: p.displayName ?? null }));
  },
  // Create-or-update a social IdP (idempotent on alias): POST when new, PUT when it exists.
  async upsertIdentityProvider(realm, { alias, providerId, enabled = true, displayName, config = {} }) {
    const rep = { alias, providerId, enabled: enabled !== false, displayName: displayName ?? alias, config };
    let exists = false;
    try { await kc('GET', `/realms/${encodeURIComponent(realm)}/identity-provider/instances/${encodeURIComponent(alias)}`); exists = true; }
    catch (e) { if (e.kcStatus !== 404) throw e; }
    if (exists) await kc('PUT', `/realms/${encodeURIComponent(realm)}/identity-provider/instances/${encodeURIComponent(alias)}`, rep);
    else await kc('POST', `/realms/${encodeURIComponent(realm)}/identity-provider/instances`, rep);
  },
  async deleteIdentityProvider(realm, alias) {
    try { await kc('DELETE', `/realms/${encodeURIComponent(realm)}/identity-provider/instances/${encodeURIComponent(alias)}`); }
    catch (e) { if (e.kcStatus !== 404) throw e; }
  },

  // ---- client scopes + realm default scopes (template requiredClientScopes) ----
  // Read-only views of the two things #961 turned out to depend on. Used by
  // scripts/backfill-tenant-realm-identity-claims.mjs to report what a realm is missing before
  // deciding to touch it (its dry run reads, never writes).
  async getUserProfile(realm) {
    return (await kc('GET', `/realms/${encodeURIComponent(realm)}/users/profile`)).json ?? null;
  },
  async listClientScopes(realm) {
    return (await kc('GET', `/realms/${encodeURIComponent(realm)}/client-scopes`)).json ?? [];
  },
  // Ensure a client scope exists (idempotent) and return its id.
  async ensureClientScope(realm, name) {
    const list = (await kc('GET', `/realms/${encodeURIComponent(realm)}/client-scopes`)).json ?? [];
    const found = list.find((s) => s.name === name);
    if (found) return found.id;
    const created = await kc('POST', `/realms/${encodeURIComponent(realm)}/client-scopes`, {
      name, protocol: 'openid-connect', attributes: { 'include.in.token.scope': 'true', 'display.on.consent.screen': 'false' }
    });
    if (created.id) return created.id;
    const after = (await kc('GET', `/realms/${encodeURIComponent(realm)}/client-scopes`)).json ?? [];
    return after.find((s) => s.name === name)?.id;
  },
  // Mark a client scope as a realm default client scope. New clients then get it automatically,
  // so the realm carries the template's required client scopes.
  //
  // Keycloak answers 409 "Duplicate resource error" when the scope is ALREADY a realm default, so
  // this PUT was never actually idempotent despite the old comment saying so — it just never ran
  // twice, because applyRequiredClientScopes only ever ran on a freshly created realm. Swallowing
  // 409 (same idiom as createRealmRole) is what makes the #961 retrofit of existing realms
  // possible at all.
  async setDefaultClientScope(realm, scopeId) {
    if (!scopeId) return;
    try {
      await kc('PUT', `/realms/${encodeURIComponent(realm)}/default-default-client-scopes/${encodeURIComponent(scopeId)}`, {});
    } catch (e) { if (e.kcStatus !== 409) throw e; }
  },
  // Ensure a client scope carries a protocol mapper (idempotent on mapper NAME: list first, POST
  // only when absent). Kept separate from ensureClientScope so an ALREADY-EXISTING scope — every
  // realm provisioned before #961 — is retrofitted on the next applyRequiredClientScopes, rather
  // than skipped by ensureClientScope's early return.
  async ensureScopeClaimMapper(realm, scopeId, mapper) {
    if (!scopeId) return;
    const base = `/realms/${encodeURIComponent(realm)}/client-scopes/${encodeURIComponent(scopeId)}/protocol-mappers/models`;
    const existing = (await kc('GET', base)).json ?? [];
    if (existing.some((m) => m.name === mapper.name)) return;
    await kc('POST', base, mapper);
  },
  // Apply the template's required client scopes to a realm: ensure each exists, set it default,
  // and give it the protocol mappers its claims need (#961 — a mapper-less context scope is
  // decorative and mints no claim).
  async applyRequiredClientScopes(realm, scopeNames = []) {
    for (const name of scopeNames) {
      const id = await this.ensureClientScope(realm, name);
      await this.setDefaultClientScope(realm, id);
      for (const mapper of CONTEXT_SCOPE_CLAIM_MAPPERS[name] ?? []) {
        await this.ensureScopeClaimMapper(realm, id, mapper);
      }
    }
  },
  async createRealmRole(realm, name) {
    try { await kc('POST', `/realms/${encodeURIComponent(realm)}/roles`, { name }); }
    catch (e) { if (e.kcStatus !== 409) throw e; } // 409 = already exists, fine
  },
  async getRealmRole(realm, name) { return (await kc('GET', `/realms/${encodeURIComponent(realm)}/roles/${encodeURIComponent(name)}`)).json; },
  async createUser(realm, {
    username,
    email,
    firstName,
    lastName,
    password,
    enabled = true,
    temporary = false,
    attributes,
    emailVerified = true,
    requiredActions = [],
  }) {
    const created = await kc('POST', `/realms/${encodeURIComponent(realm)}/users`, {
      username, email, firstName, lastName, enabled, emailVerified,
      requiredActions,
      ...(password ? { credentials: [{ type: 'password', value: password, temporary }] } : {}),
      ...(attributes && Object.keys(attributes).length > 0
        ? { attributes: normalizeKeycloakAttributes(attributes) }
        : {})
    });
    let id = created.id;
    if (!id) { // some KC versions omit Location; look up by username
      const found = (await kc('GET', `/realms/${encodeURIComponent(realm)}/users?username=${encodeURIComponent(username)}&exact=true`)).json;
      id = Array.isArray(found) && found[0] ? found[0].id : undefined;
    }
    return id;
  },
  async assignRealmRoles(realm, userId, roleNames) {
    const reps = [];
    for (const name of roleNames) reps.push(await this.getRealmRole(realm, name));
    await kc('POST', `/realms/${encodeURIComponent(realm)}/users/${encodeURIComponent(userId)}/role-mappings/realm`, reps);
  },
  async listUsers(realm, { max = 100 } = {}) {
    return (await kc('GET', `/realms/${encodeURIComponent(realm)}/users?max=${max}`)).json ?? [];
  },
  async getUser(realm, userId) {
    return (await kc('GET', `/realms/${encodeURIComponent(realm)}/users/${encodeURIComponent(userId)}`)).json ?? null;
  },
  // Enable/disable an end-user (KC: PUT with `enabled`). A disabled user can no
  // longer authenticate (ROPC -> "Account disabled"). (#567)
  async setUserEnabled(realm, userId, enabled) {
    await kc('PUT', `/realms/${encodeURIComponent(realm)}/users/${encodeURIComponent(userId)}`, { enabled: !!enabled });
  },
  async deleteUser(realm, userId) { try { await kc('DELETE', `/realms/${encodeURIComponent(realm)}/users/${encodeURIComponent(userId)}`); } catch (e) { if (e.kcStatus !== 404) throw e; } },

  // ---- clients (service accounts = confidential client w/ service account) ----
  async findClient(realm, clientId) {
    const list = (await kc('GET', `/realms/${encodeURIComponent(realm)}/clients?clientId=${encodeURIComponent(clientId)}`)).json ?? [];
    return list[0] ?? null;
  },
  async createConfidentialClient(realm, { clientId, name, serviceAccountsEnabled = true }) {
    const created = await kc('POST', `/realms/${encodeURIComponent(realm)}/clients`, {
      clientId, name: name ?? clientId, enabled: true, protocol: 'openid-connect',
      publicClient: false, serviceAccountsEnabled, standardFlowEnabled: false, directAccessGrantsEnabled: false,
      attributes: { 'in-falcone.kind': 'service-account' }
    });
    let uuid = created.id;
    if (!uuid) { const c = await this.findClient(realm, clientId); uuid = c?.id; }
    return uuid;
  },
  // Per-tenant app client in the tenant realm (fix-tenant-realm-token-issuance, A3): a public
  // client with the password (ROPC) + standard flows enabled, so tenant owners/users in the realm
  // can actually obtain tokens. Returns the client UUID (idempotent on clientId).
  //
  // SECURITY (#670): the redirect-URI / web-origin allow-list MUST NOT default to a wildcard
  // (`['*']`). A wildcard makes the authorization-code endpoint accept any attacker-controlled
  // `redirect_uri`, a classic auth-code interception vector. The defaults come from the
  // deployment-configured allow-list (TENANT_APP_REDIRECT_URIS / TENANT_APP_WEB_ORIGINS); a
  // caller may still pass explicit `redirectUris`/`webOrigins` to override. PKCE (S256) is always
  // enabled for the public client to harden the auth-code flow; ROPC (directAccessGrants) is
  // unaffected by PKCE and keeps working.
  async createPublicAppClient(realm, { clientId, name, redirectUris = DEFAULT_APP_REDIRECT_URIS, webOrigins = DEFAULT_APP_WEB_ORIGINS }) {
    const created = await kc('POST', `/realms/${encodeURIComponent(realm)}/clients`, {
      clientId, name: name ?? clientId, enabled: true, protocol: 'openid-connect',
      publicClient: true, standardFlowEnabled: true, directAccessGrantsEnabled: true, serviceAccountsEnabled: false,
      redirectUris, webOrigins,
      attributes: { 'in-falcone.kind': 'tenant-app', 'pkce.code.challenge.method': 'S256' }
    });
    let uuid = created.id;
    if (!uuid) { const c = await this.findClient(realm, clientId); uuid = c?.id; }
    return uuid;
  },
  // Hardcoded claim mapper (A3): injects a FIXED claim value into the client's tokens regardless of
  // user attributes — used to stamp the un-forgeable tenant_id (== realm name) into tenant-realm
  // tokens, so a tenant user cannot set it to another tenant's id.
  async addHardcodedClaimMapper(realm, clientUuid, { name, claimName, claimValue }) {
    await kc('POST', `/realms/${encodeURIComponent(realm)}/clients/${encodeURIComponent(clientUuid)}/protocol-mappers/models`, {
      name, protocol: 'openid-connect', protocolMapper: 'oidc-hardcoded-claim-mapper',
      config: {
        'claim.name': claimName, 'claim.value': claimValue, 'jsonType.label': 'String',
        'access.token.claim': 'true', 'id.token.claim': 'true', 'userinfo.token.claim': 'true',
      },
    });
  },
  async getClientSecret(realm, clientUuid) {
    return (await kc('GET', `/realms/${encodeURIComponent(realm)}/clients/${encodeURIComponent(clientUuid)}/client-secret`)).json?.value ?? null;
  },
  async regenerateClientSecret(realm, clientUuid) {
    return (await kc('POST', `/realms/${encodeURIComponent(realm)}/clients/${encodeURIComponent(clientUuid)}/client-secret`)).json?.value ?? null;
  },
  async setClientEnabled(realm, clientUuid, enabled) {
    await kc('PUT', `/realms/${encodeURIComponent(realm)}/clients/${encodeURIComponent(clientUuid)}`, { enabled });
  },
  async deleteClient(realm, clientUuid) { try { await kc('DELETE', `/realms/${encodeURIComponent(realm)}/clients/${encodeURIComponent(clientUuid)}`); } catch (e) { if (e.kcStatus !== 404) throw e; } },

  // ---- fine-grained IAM reads/writes (platform admin) ----------------------
  async listRealmRoles(realm) { return (await kc('GET', `/realms/${encodeURIComponent(realm)}/roles`)).json ?? []; },
  async deleteRealmRole(realm, name) { try { await kc('DELETE', `/realms/${encodeURIComponent(realm)}/roles/${encodeURIComponent(name)}`); } catch (e) { if (e.kcStatus !== 404) throw e; } },
  async listClients(realm) { return (await kc('GET', `/realms/${encodeURIComponent(realm)}/clients`)).json ?? []; },
  async listGroups(realm) { return (await kc('GET', `/realms/${encodeURIComponent(realm)}/groups`)).json ?? []; },
  async createGroup(realm, name) {
    const created = await kc('POST', `/realms/${encodeURIComponent(realm)}/groups`, { name });
    return created.id;
  },
  async deleteGroup(realm, groupId) { try { await kc('DELETE', `/realms/${encodeURIComponent(realm)}/groups/${encodeURIComponent(groupId)}`); } catch (e) { if (e.kcStatus !== 404) throw e; } },

  // ---- role assignment to users (fine-grained IAM) -------------------------
  async listUserRealmRoles(realm, userId) {
    return (await kc('GET', `/realms/${encodeURIComponent(realm)}/users/${encodeURIComponent(userId)}/role-mappings/realm`)).json ?? [];
  },
  async removeRealmRoles(realm, userId, roleNames) {
    const reps = [];
    for (const name of roleNames) reps.push(await this.getRealmRole(realm, name));
    await kc('DELETE', `/realms/${encodeURIComponent(realm)}/users/${encodeURIComponent(userId)}/role-mappings/realm`, reps);
  },

  // ---- group membership ----------------------------------------------------
  async addUserToGroup(realm, userId, groupId) {
    await kc('PUT', `/realms/${encodeURIComponent(realm)}/users/${encodeURIComponent(userId)}/groups/${encodeURIComponent(groupId)}`, {});
  },
  async removeUserFromGroup(realm, userId, groupId) {
    try { await kc('DELETE', `/realms/${encodeURIComponent(realm)}/users/${encodeURIComponent(userId)}/groups/${encodeURIComponent(groupId)}`); }
    catch (e) { if (e.kcStatus !== 404) throw e; }
  },
  async listGroupMembers(realm, groupId, { max = 200 } = {}) {
    return (await kc('GET', `/realms/${encodeURIComponent(realm)}/groups/${encodeURIComponent(groupId)}/members?max=${max}`)).json ?? [];
  },
  async listUserGroups(realm, userId) {
    return (await kc('GET', `/realms/${encodeURIComponent(realm)}/users/${encodeURIComponent(userId)}/groups`)).json ?? [];
  }
};

// The standard per-tenant realm roles (../falcone-charts/charts/in-falcone values: tenantRealmTemplate.requiredRealmRoles).
export const TENANT_REALM_ROLES = [
  'tenant_owner', 'tenant_admin', 'tenant_developer', 'tenant_viewer',
  'workspace_owner', 'workspace_admin', 'workspace_developer', 'workspace_operator',
  'workspace_auditor', 'workspace_viewer', 'workspace_service_account'
];

// The standard per-tenant realm client scopes (../falcone-charts/charts/in-falcone values:
// tenantRealmTemplate.requiredClientScopes). Applied to every provisioned tenant realm
// by createRealm (mirrors TENANT_REALM_ROLES) so realms no longer drift from the template (#568).
export const TENANT_REALM_SCOPES = [
  'tenant-context', 'workspace-context', 'plan-context', 'workspace-roles'
];

// The identity attributes the platform stamps on tenant principals, declared in the realm's KC26
// user profile so Keycloak PERSISTS them instead of silently discarding them (#961).
//
// This is the SAME declaration the chart already applies to the platform realm (finding A4,
// ../falcone-charts/charts/in-falcone values: bootstrap.oneShot.keycloak.userProfile — asserted by
// tests/blackbox/platform-user-profile-tenant-attr.test.mjs). Only the platform realm ever got it;
// tenant realms, which is where every end-user principal actually lives, never did. Keeping the
// two shapes identical is the point — one identity contract, both realm kinds.
//
// `edit: ['admin']` — never `user`. The account console must not be able to rewrite these: a
// self-editable workspace_id is a workspace_id the holder chooses, and workspace-scoped
// authorization binds to exactly this claim. Writing them stays an admin-API operation, i.e. the
// platform's own provisioning path. `view` includes `user` because the value is in the holder's
// own token anyway, so hiding it from the account console buys nothing.
//
// Declaring the two attributes explicitly is deliberately narrower than flipping
// `unmanagedAttributePolicy`, which would make the realm accept ANY attribute the admin API sends.
// `user-metadata` is a group KC 26 ships in every realm's default profile.
export const IDENTITY_PROFILE_ATTRIBUTES = [
  {
    name: 'tenant_id',
    displayName: 'Tenant ID',
    group: 'user-metadata',
    validations: { length: { max: 255 } },
    permissions: { view: ['admin', 'user'], edit: ['admin'] },
    multivalued: false,
  },
  {
    name: 'workspace_id',
    displayName: 'Workspace ID',
    group: 'user-metadata',
    validations: { length: { max: 255 } },
    permissions: { view: ['admin', 'user'], edit: ['admin'] },
    multivalued: false,
  },
];

// Protocol mappers the context client scopes must carry for the declared attributes to actually
// reach a token (#961). A mapper-less scope is decorative: it shows up in the token's `scope`
// string and contributes no claim, which is exactly what `tenant-context`/`workspace-context`
// did — every principal's `workspace_id` came back null. Mirrors the chart's platform-realm
// `workspace-context` scope field for field.
//
// `tenant-context` is deliberately ABSENT from this table, and that is the ONE place tenant realms
// must differ from the platform realm. The platform realm hosts principals of many tenants, so
// there tenant_id can only come from a user attribute. A tenant realm's NAME *is* the tenant id,
// and createTenant stamps it with a hardcoded client mapper (addHardcodedClaimMapper) that a
// tenant user cannot forge. Adding a second, user-attribute-sourced mapper for the same claim
// would give tenant_id a weaker parallel source and make which one wins undefined — a downgrade
// of the A3 isolation property, not a fix.
export const CONTEXT_SCOPE_CLAIM_MAPPERS = {
  'workspace-context': [{
    name: 'workspace_id',
    protocol: 'openid-connect',
    protocolMapper: 'oidc-usermodel-attribute-mapper',
    consentRequired: false,
    config: {
      'user.attribute': 'workspace_id',
      'claim.name': 'workspace_id',
      'jsonType.label': 'String',
      'access.token.claim': 'true',
      'id.token.claim': 'true',
      'userinfo.token.claim': 'true',
    },
  }],
};
