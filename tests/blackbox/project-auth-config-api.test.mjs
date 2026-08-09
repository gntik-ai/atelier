/**
 * Black-box tests for the project (tenant) auth-config API
 * (add-project-auth-config-api, #568, epic #545, P2).
 *
 * The gap (live 2-tenant E2E, 2026-06-18): enabling username/password +
 * configuring social identity providers per project was only possible via raw
 * Keycloak admin — there was NO Falcone owner-facing `/v1/...` API. Also the
 * chart's `tenantRealmTemplate.requiredClientScopes` were never applied to
 * tenant realms at provisioning (template drift).
 *
 * The fix adds owner-scoped handlers (driven through the canonical
 * `LOCAL_HANDLERS` map with an injected `ctx.kcAdmin`, never a real Keycloak):
 *   - getAuthConfig:        read a project realm's login options + IdPs
 *   - setAuthConfig:        toggle username/password registration + login flags
 *   - setSocialProvider:    create/update (upsert) a social identity provider
 *   - deleteSocialProvider: remove a social identity provider
 * and applies the template's required client scopes in `createRealm`
 * (kc-admin.mjs::TENANT_REALM_SCOPES, mirroring TENANT_REALM_ROLES).
 *
 * Isolation (cardinal rule): the realm is resolved from the path tenantId, then
 * guarded against the VERIFIED identity — a tenant owner may only configure
 * THEIR OWN project's realm (cross-tenant → 403, no Keycloak call).
 *
 * bbx-568-01: getAuthConfig reflects the realm's login options (own tenant)
 * bbx-568-02: setAuthConfig enables username/password registration via KC PUT
 * bbx-568-03: setSocialProvider upserts a social IdP (provider id + creds)
 * bbx-568-04: deleteSocialProvider removes a social IdP
 * bbx-568-05: a DIFFERENT tenant's owner is denied (403, no KC call) — no cross-tenant
 * bbx-568-06: superadmin may configure any project's realm
 * bbx-568-07: createRealm applies the template's required client scopes
 *             (TENANT_REALM_SCOPES) — they are no longer missing
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { LOCAL_HANDLERS as HANDLERS } from '../../apps/control-plane/b-handlers.mjs';
import { kcAdmin, TENANT_REALM_SCOPES } from '../../apps/control-plane/kc-admin.mjs';

const ACME = 'acme-11111111';
const GLOBEX = 'globex-22222222';
// Falcone realm-per-tenant: realm name == tenantId.
const ACME_REALM = ACME;

// Stub pool: getTenant(id) resolves ACME/GLOBEX with realm == id.
const pool = {
  query: async (_sql, args) => {
    const id = args?.[0];
    if (id === ACME) return { rows: [{ id: ACME, tenant_id: ACME, slug: 'acme', iam_realm: ACME, status: 'active' }] };
    if (id === GLOBEX) return { rows: [{ id: GLOBEX, tenant_id: GLOBEX, slug: 'globex', iam_realm: GLOBEX, status: 'active' }] };
    return { rows: [] };
  },
};

// Recording fake Keycloak admin injected via ctx.kcAdmin.
function fakeKc(initial = {}) {
  const calls = [];
  const realm = {
    registrationAllowed: false,
    loginWithEmailAllowed: true,
    resetPasswordAllowed: true,
    rememberMe: true,
    ...initial.realm,
  };
  let providers = [...(initial.providers ?? [])];
  return {
    calls,
    getRealmAuthConfig: async (r) => {
      calls.push(['getRealmAuthConfig', r]);
      return { ...realm, identityProviders: providers.map((p) => ({ ...p })) };
    },
    setRealmAuthConfig: async (r, patch) => {
      calls.push(['setRealmAuthConfig', r, patch]);
      Object.assign(realm, patch);
    },
    upsertIdentityProvider: async (r, idp) => {
      calls.push(['upsertIdentityProvider', r, idp]);
      providers = providers.filter((p) => p.alias !== idp.alias);
      providers.push({ alias: idp.alias, providerId: idp.providerId, enabled: idp.enabled !== false });
    },
    deleteIdentityProvider: async (r, alias) => {
      calls.push(['deleteIdentityProvider', r, alias]);
      providers = providers.filter((p) => p.alias !== alias);
    },
  };
}

const ctx = (identity, { tenantId = ACME, body = {}, alias, kc } = {}) => ({
  pool, identity, body, kcAdmin: kc, params: { tenantId, alias }, query: {},
});

const acmeOwner = { actorType: 'tenant_owner', tenantId: ACME, sub: 'u-acme' };
const globexOwner = { actorType: 'tenant_owner', tenantId: GLOBEX, sub: 'u-globex' };
const superadmin = { actorType: 'superadmin', sub: 'root' };

test('bbx-568-00: reproduce — auth-config handlers exist on the public surface', () => {
  // Before the fix these were undefined (NO_ROUTE), so an owner could not enable
  // an auth method / social provider through the Falcone API at all.
  for (const name of ['getAuthConfig', 'setAuthConfig', 'setSocialProvider', 'deleteSocialProvider']) {
    assert.equal(typeof HANDLERS[name], 'function', `expected LOCAL_HANDLERS.${name} to be wired`);
  }
});

test('bbx-568-01: getAuthConfig reflects the realm login options (own tenant)', async () => {
  const kc = fakeKc({ providers: [{ alias: 'google', providerId: 'google', enabled: true }] });
  const res = await HANDLERS.getAuthConfig(ctx(acmeOwner, { kc }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.tenantId, ACME);
  assert.equal(res.body.realm, ACME_REALM);
  assert.equal(res.body.registrationAllowed, false);
  assert.equal(res.body.loginWithEmailAllowed, true);
  assert.deepEqual(res.body.identityProviders, [{ alias: 'google', providerId: 'google', enabled: true }]);
  assert.deepEqual(kc.calls, [['getRealmAuthConfig', ACME_REALM]]);
});

test('bbx-568-02: setAuthConfig enables username/password registration (KC PUT)', async () => {
  const kc = fakeKc();
  const res = await HANDLERS.setAuthConfig(ctx(acmeOwner, { kc, body: { registrationAllowed: true } }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.registrationAllowed, true);
  // The realm now reflects the toggle (idempotent PUT, then re-read).
  assert.ok(kc.calls.some(([op, , patch]) => op === 'setRealmAuthConfig' && patch.registrationAllowed === true));
});

test('bbx-568-03: setSocialProvider upserts a social IdP with provider creds', async () => {
  const kc = fakeKc();
  const res = await HANDLERS.setSocialProvider(ctx(acmeOwner, {
    kc,
    alias: 'github',
    body: { providerId: 'github', enabled: true, config: { clientId: 'abc', clientSecret: 'shh' } },
  }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.alias, 'github');
  const upsert = kc.calls.find(([op]) => op === 'upsertIdentityProvider');
  assert.ok(upsert, 'expected upsertIdentityProvider to be called');
  assert.equal(upsert[2].alias, 'github');
  assert.equal(upsert[2].providerId, 'github');
  assert.equal(upsert[2].config.clientId, 'abc');
  // and the read-back lists it
  assert.ok(res.body.identityProviders.some((p) => p.alias === 'github'));
});

test('bbx-568-04: deleteSocialProvider removes a social IdP', async () => {
  const kc = fakeKc({ providers: [{ alias: 'google', providerId: 'google', enabled: true }] });
  const res = await HANDLERS.deleteSocialProvider(ctx(acmeOwner, { kc, alias: 'google' }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.deleted, true);
  assert.deepEqual(kc.calls.find(([op]) => op === 'deleteIdentityProvider'), ['deleteIdentityProvider', ACME_REALM, 'google']);
});

test('bbx-568-05: a different tenant owner is denied (403, no KC call) — no cross-tenant', async () => {
  for (const fn of ['getAuthConfig', 'setAuthConfig', 'setSocialProvider', 'deleteSocialProvider']) {
    const kc = fakeKc();
    // globexOwner targets ACME's project — must be refused before any Keycloak I/O.
    const res = await HANDLERS[fn](ctx(globexOwner, { tenantId: ACME, kc, alias: 'google', body: { providerId: 'google', registrationAllowed: true } }));
    assert.equal(res.statusCode, 403, `${fn} must deny cross-tenant`);
    assert.deepEqual(kc.calls, [], `${fn} must not call Keycloak on a cross-tenant attempt`);
  }
});

test('bbx-568-06: superadmin may configure any project realm', async () => {
  const kc = fakeKc();
  const res = await HANDLERS.setAuthConfig(ctx(superadmin, { tenantId: GLOBEX, kc, body: { registrationAllowed: true } }));
  assert.equal(res.statusCode, 200);
  assert.ok(kc.calls.some(([op, r]) => op === 'setRealmAuthConfig' && r === GLOBEX));
});

test('bbx-568-07: createRealm applies the template required client scopes (no drift)', async () => {
  assert.ok(Array.isArray(TENANT_REALM_SCOPES) && TENANT_REALM_SCOPES.length > 0,
    'TENANT_REALM_SCOPES must enumerate the chart tenantRealmTemplate.requiredClientScopes');
  // The chart template scopes (../falcone-charts/charts/in-falcone values: tenantRealmTemplate.requiredClientScopes).
  for (const s of ['tenant-context', 'workspace-context', 'plan-context', 'workspace-roles']) {
    assert.ok(TENANT_REALM_SCOPES.includes(s), `missing template scope ${s}`);
  }
  // applyRequiredClientScopes must ensure each scope exists AND mark it a realm default
  // client scope (so provisioned realms carry the template's required scopes). Stub the two
  // low-level helpers it composes (singleton methods) to assert deterministically — no network.
  const ensured = [];
  const defaulted = [];
  const origEnsure = kcAdmin.ensureClientScope;
  const origDefault = kcAdmin.setDefaultClientScope;
  // applyRequiredClientScopes also attaches the context scopes' claim mappers (#961); stub that
  // third helper too so this test stays network-free. Its own coverage is
  // tests/blackbox/workspace-id-claim-minting.test.mjs.
  const origMapper = kcAdmin.ensureScopeClaimMapper;
  try {
    kcAdmin.ensureClientScope = async (_realm, name) => { ensured.push(name); return `id-${name}`; };
    kcAdmin.setDefaultClientScope = async (_realm, scopeId) => { defaulted.push(scopeId); };
    kcAdmin.ensureScopeClaimMapper = async () => {};
    await kcAdmin.applyRequiredClientScopes('acme-test-realm', TENANT_REALM_SCOPES);
  } finally {
    kcAdmin.ensureClientScope = origEnsure;
    kcAdmin.setDefaultClientScope = origDefault;
    kcAdmin.ensureScopeClaimMapper = origMapper;
  }
  for (const s of TENANT_REALM_SCOPES) {
    assert.ok(ensured.includes(s), `scope ${s} not ensured`);
    assert.ok(defaulted.includes(`id-${s}`), `scope ${s} not set as realm default`);
  }
});
