/**
 * Black-box regression suite for #961 — "no principal ever receives a workspace_id claim".
 *
 * Drives the PUBLIC surfaces only: `kcAdmin` (apps/control-plane/kc-admin.mjs) against a fake
 * Keycloak admin REST API installed at the `fetch` boundary, and `AUTH_HANDLERS.signup`
 * (apps/control-plane/auth-handlers.mjs) with an injected store/kcAdmin.
 *
 * Defect (two independent breakages that combine):
 *   1. Keycloak 26's declarative user profile is always on and unmanaged attributes are disabled
 *      by default. `createRealm` declared nothing, so the tenant_id/workspace_id attributes
 *      `createUser` sends were DISCARDED at persist time — the user came back `attributes: null`,
 *      with no error to the caller.
 *   2. The `tenant-context` / `workspace-context` client scopes were created with ZERO protocol
 *      mappers, so even a persisted attribute could not reach a token. Both scopes appeared in the
 *      token's `scope` string and contributed no claim.
 * `tenant_id` survived only via the hardcoded client mapper createTenant installs.
 *
 * Why the pre-existing coverage did not catch it: tests/blackbox/auth-signup-tenant-realm-placement
 * asserts only that the attributes are PASSED to a fake kcAdmin. It never asserts that the realm
 * declares them, nor that a mapper exists — it passes while the capability does not exist. These
 * tests assert the Keycloak WIRE CONTRACT instead: the exact admin REST calls provisioning makes.
 * tests/env/keycloak/workspace-id-claim.test.mjs proves the same contract against a real KC 26.
 *
 * Scenario coverage (capability: tenant-provisioning / identity):
 *   bbx-wsid-01  createRealm DECLARES tenant_id + workspace_id in the realm user profile
 *   bbx-wsid-02  the declarations are admin-edit-only (a holder cannot rewrite their own binding)
 *   bbx-wsid-03  workspace-context gets a workspace_id user-attribute protocol mapper
 *   bbx-wsid-04  tenant-context gets NO user-attribute tenant_id mapper (hardcoded mapper stays
 *                the single, un-forgeable source — see kc-admin CONTEXT_SCOPE_CLAIM_MAPPERS)
 *   bbx-wsid-05  mapper creation is idempotent AND retrofits an already-existing scope
 *   bbx-wsid-10  re-applying the template survives Keycloak's 409 on an already-default scope
 *   bbx-wsid-06  relaxUserProfile still relaxes email/firstName/lastName (#496 not regressed)
 *   bbx-wsid-07  signup REJECTS a workspaceId belonging to another tenant
 *   bbx-wsid-08  signup REJECTS an unknown workspaceId with the same response (no existence oracle)
 *   bbx-wsid-09  signup stamps a workspaceId that really belongs to the tenant
 *   bbx-wsid-11  a slug two tenants both use resolves to the CALLER's workspace, not an arbitrary one
 *   bbx-wsid-12  a workspace addressed by its canonical id is never resolved to a slug impostor
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// Namespace import on purpose: a NAMED import of a not-yet-existing export is a link-time error
// that takes the whole file down, which would collapse the pre-fix RED baseline into one opaque
// failure instead of showing which scenarios the defect breaks.
import * as kcAdminModule from '../../apps/control-plane/kc-admin.mjs';
import { AUTH_HANDLERS } from '../../apps/control-plane/auth-handlers.mjs';

const { kcAdmin, TENANT_REALM_SCOPES } = kcAdminModule;

const REALM = 'ten-acme-961';
const TENANT_ID = 'ffd33d99-aaaa-bbbb-cccc-000000000001';
const WORKSPACE_ID = 'a3be0b6d-1111-2222-3333-000000000001';
const OTHER_TENANT_ID = 'ffd33d99-aaaa-bbbb-cccc-000000000002';

// ─── fake Keycloak admin REST API ────────────────────────────────────────────
// Answers only the calls provisioning is allowed to make; anything else throws, so a change that
// silently starts calling a different endpoint fails loudly rather than passing on a stub.
function makeFakeKeycloak({ existingScopes = [], existingMappers = {} } = {}) {
  const calls = [];
  const defaultedScopeIds = new Set();
  const scopeIdByName = new Map(existingScopes.map((n, i) => [n, `scope-${i}-${n}`]));
  const mappersByScopeId = new Map(
    Object.entries(existingMappers).map(([name, ms]) => [scopeIdByName.get(name), ms]),
  );
  let profile = {
    // KC 26's stock tenant-realm profile: the four declared attributes, email required for "user".
    attributes: [
      { name: 'username', permissions: { view: ['admin', 'user'], edit: ['admin', 'user'] } },
      { name: 'email', required: { roles: ['user'] }, permissions: { view: ['admin', 'user'], edit: ['admin', 'user'] } },
      { name: 'firstName', required: { roles: ['user'] }, permissions: { view: ['admin', 'user'], edit: ['admin', 'user'] } },
      { name: 'lastName', required: { roles: ['user'] }, permissions: { view: ['admin', 'user'], edit: ['admin', 'user'] } },
    ],
    groups: [{ name: 'user-metadata' }],
    unmanagedAttributePolicy: null,
  };

  const res = (status, body, headers = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    async text() { return body == null ? '' : JSON.stringify(body); },
    async json() { return body ?? null; },
  });

  async function fetchImpl(url, init = {}) {
    const u = String(url);
    const method = init.method ?? 'GET';
    if (u.endsWith('/realms/master/protocol/openid-connect/token')) {
      return res(200, { access_token: 'fake-admin-token', expires_in: 60 });
    }
    const body = init.body ? JSON.parse(init.body) : undefined;
    const path = u.replace(/^.*?\/admin/, '');
    calls.push({ method, path, body });

    if (/^\/realms$/.test(path) && method === 'POST') return res(201, null);

    if (/^\/realms\/[^/]+\/users\/profile$/.test(path)) {
      if (method === 'GET') return res(200, structuredClone(profile));
      profile = structuredClone(body);
      return res(200, null);
    }

    if (/^\/realms\/[^/]+\/client-scopes$/.test(path)) {
      if (method === 'GET') {
        return res(200, [...scopeIdByName].map(([name, id]) => ({ id, name })));
      }
      const id = `scope-new-${body.name}`;
      scopeIdByName.set(body.name, id);
      return res(201, null, { location: `${u}/${id}` });
    }

    const mapperPath = /^\/realms\/[^/]+\/client-scopes\/([^/]+)\/protocol-mappers\/models$/.exec(path);
    if (mapperPath) {
      const scopeId = mapperPath[1];
      if (method === 'GET') return res(200, mappersByScopeId.get(scopeId) ?? []);
      mappersByScopeId.set(scopeId, [...(mappersByScopeId.get(scopeId) ?? []), body]);
      return res(201, null);
    }

    const defaultScope = /^\/realms\/[^/]+\/default-default-client-scopes\/([^/]+)$/.exec(path);
    if (defaultScope && method === 'PUT') {
      // Real KC 26 answers 409 "Duplicate resource error" when the scope is already a realm
      // default — the behaviour that made the retrofit path fail. Model it.
      const id = defaultScope[1];
      if (defaultedScopeIds.has(id)) return res(409, { error: 'unknown_error', error_description: 'Duplicate resource error' });
      defaultedScopeIds.add(id);
      return res(204, null);
    }

    throw new Error(`unexpected Keycloak admin call: ${method} ${path}`);
  }

  return {
    fetchImpl,
    calls,
    profileNow: () => profile,
    scopeId: (name) => scopeIdByName.get(name),
    mappersOn: (name) => mappersByScopeId.get(scopeIdByName.get(name)) ?? [],
  };
}

let realFetch;
test.beforeEach(() => { realFetch = globalThis.fetch; });
test.afterEach(() => { globalThis.fetch = realFetch; });

/** Provision a realm the way createTenant does, against a fresh fake Keycloak. */
async function provision(opts) {
  const kc = makeFakeKeycloak(opts);
  globalThis.fetch = kc.fetchImpl;
  await kcAdmin.createRealm({ realm: REALM, displayName: 'Acme' });
  return kc;
}

const declared = (profile, name) => (profile.attributes ?? []).find((a) => a.name === name);

// ─── bbx-wsid-01 ─────────────────────────────────────────────────────────────
// The cardinal assertion. Pre-fix, createRealm declared nothing, so Keycloak dropped every
// attribute the platform stamps and `workspace_id` could not exist on any principal.

test('bbx-wsid-01: createRealm declares tenant_id and workspace_id in the realm user profile', async () => {
  const kc = await provision();

  const profilePuts = kc.calls.filter((c) => c.method === 'PUT' && c.path.endsWith('/users/profile'));
  assert.ok(profilePuts.length >= 1, 'provisioning must PUT the realm user profile');

  const profile = kc.profileNow();
  for (const name of ['tenant_id', 'workspace_id']) {
    assert.ok(
      declared(profile, name),
      `user profile MUST declare "${name}"; KC26 silently discards undeclared attributes, `
      + `so an undeclared ${name} can never be persisted or claimed. Declared: `
      + `${(profile.attributes ?? []).map((a) => a.name).join(', ')}`,
    );
  }

  // Narrower than flipping the realm to accept anything: unmanaged attributes stay off.
  assert.notEqual(
    profile.unmanagedAttributePolicy, 'ENABLED',
    'the fix must declare the two attributes, not open the realm to arbitrary unmanaged attributes',
  );
});

// ─── bbx-wsid-02 ─────────────────────────────────────────────────────────────
// workspace_id is what workspace-scoped authorization binds to. A self-editable binding is a
// binding the holder chooses, so `edit` must never include "user".

test('bbx-wsid-02: the declared identity attributes are admin-edit-only', async () => {
  const kc = await provision();
  const profile = kc.profileNow();

  for (const name of ['tenant_id', 'workspace_id']) {
    const attr = declared(profile, name);
    const edit = attr?.permissions?.edit ?? [];
    assert.deepEqual(
      [...edit].sort(), ['admin'],
      `"${name}" must be editable by admin ONLY (got: ${JSON.stringify(edit)}); a user-editable `
      + 'workspace_id lets a principal re-point its own workspace binding',
    );
  }

  // The exported declaration table is the contract the real Keycloak sees — pin it too.
  const declarations = kcAdminModule.IDENTITY_PROFILE_ATTRIBUTES;
  assert.ok(Array.isArray(declarations) && declarations.length > 0,
    'kc-admin must export IDENTITY_PROFILE_ATTRIBUTES — the declared identity-attribute contract');
  for (const declaration of declarations) {
    assert.ok(!(declaration.permissions?.edit ?? []).includes('user'),
      `IDENTITY_PROFILE_ATTRIBUTES["${declaration.name}"] must not grant user edit`);
  }
});

// ─── bbx-wsid-03 ─────────────────────────────────────────────────────────────
// The second half of the defect: the scope existed, was a realm default, appeared in the token's
// `scope` string — and carried no mapper, so it contributed no claim.

test('bbx-wsid-03: workspace-context carries a workspace_id user-attribute protocol mapper', async () => {
  const kc = await provision();

  const mappers = kc.mappersOn('workspace-context');
  const mapper = mappers.find((m) => m.config?.['claim.name'] === 'workspace_id');
  assert.ok(
    mapper,
    'the workspace-context client scope MUST carry a workspace_id mapper; a mapper-less scope is '
    + `decorative. Mappers found: ${JSON.stringify(mappers)}`,
  );

  assert.equal(mapper.protocolMapper, 'oidc-usermodel-attribute-mapper');
  assert.equal(mapper.config['user.attribute'], 'workspace_id');
  assert.equal(mapper.config['access.token.claim'], 'true',
    'the claim must reach the ACCESS token — that is the token executor/gateway authorization reads');
});

// ─── bbx-wsid-04 ─────────────────────────────────────────────────────────────
// Deliberate non-change, asserted so a later "symmetry" refactor cannot quietly weaken A3:
// tenant_id comes from the hardcoded client mapper (value == realm name, un-forgeable). A parallel
// user-attribute mapper would give the same claim a second, weaker source.

test('bbx-wsid-04: tenant-context gets NO user-attribute tenant_id mapper', async () => {
  const kc = await provision();

  const tenantMappers = kc.mappersOn('tenant-context');
  assert.equal(
    tenantMappers.filter((m) => m.protocolMapper === 'oidc-usermodel-attribute-mapper').length, 0,
    'tenant_id must keep the hardcoded client mapper as its single source (fix-tenant-realm-token-'
    + `issuance / A3); got: ${JSON.stringify(tenantMappers)}`,
  );
});

// ─── bbx-wsid-05 ─────────────────────────────────────────────────────────────
// Every realm provisioned before this fix already has the scopes, so ensureClientScope returns
// early for them. The mapper step must therefore be separate — and must not duplicate.

test('bbx-wsid-05: mappers retrofit an existing scope and are not created twice', async () => {
  // Realm whose scopes all pre-exist (i.e. any realm provisioned before #961), no mappers.
  const retro = makeFakeKeycloak({ existingScopes: TENANT_REALM_SCOPES });
  globalThis.fetch = retro.fetchImpl;
  await kcAdmin.applyRequiredClientScopes(REALM, TENANT_REALM_SCOPES);

  assert.equal(
    retro.mappersOn('workspace-context').length, 1,
    'an already-provisioned realm must be retrofitted with the workspace_id mapper',
  );
  assert.equal(
    retro.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/client-scopes')).length, 0,
    'existing scopes must not be re-created',
  );

  // Second application: the mapper now exists → no duplicate POST (Keycloak permits duplicates,
  // and two mappers for one claim make the emitted value undefined).
  const before = retro.calls.filter((c) => c.method === 'POST' && c.path.includes('protocol-mappers')).length;
  await kcAdmin.applyRequiredClientScopes(REALM, TENANT_REALM_SCOPES);
  const after = retro.calls.filter((c) => c.method === 'POST' && c.path.includes('protocol-mappers')).length;
  assert.equal(after, before, 'a re-apply must not POST the mapper again');
  assert.equal(retro.mappersOn('workspace-context').length, 1, 'still exactly one workspace_id mapper');
});

// ─── bbx-wsid-10 ─────────────────────────────────────────────────────────────
// setDefaultClientScope was documented "idempotent PUT" and was not: Keycloak answers 409
// "Duplicate resource error" for a scope that is already a realm default. Nothing hit it while
// applyRequiredClientScopes only ever ran on a fresh realm; the retrofit runs it on realms where
// every scope is already default, so the whole retrofit died on the first scope.

test('bbx-wsid-10: re-applying the template survives the 409 on an already-default scope', async () => {
  const kc = makeFakeKeycloak({ existingScopes: TENANT_REALM_SCOPES });
  globalThis.fetch = kc.fetchImpl;

  await kcAdmin.applyRequiredClientScopes(REALM, TENANT_REALM_SCOPES);
  await kcAdmin.applyRequiredClientScopes(REALM, TENANT_REALM_SCOPES); // every scope now default → 409s

  assert.equal(
    kc.calls.filter((c) => c.path.includes('default-default-client-scopes') && c.method === 'PUT').length,
    TENANT_REALM_SCOPES.length * 2,
    'the second pass must still attempt each scope (proving the 409s were actually raised)',
  );
  assert.equal(kc.mappersOn('workspace-context').length, 1,
    'and the pass must reach the mapper step rather than aborting on the first 409');
});

// ─── bbx-wsid-06 ─────────────────────────────────────────────────────────────
// The declaration is added to the SAME profile PUT that relaxes the required fields; assert the
// #496 behaviour is untouched.

test('bbx-wsid-06: relaxUserProfile still relaxes email/firstName/lastName (#496)', async () => {
  const kc = await provision();
  const profile = kc.profileNow();

  for (const name of ['email', 'firstName', 'lastName']) {
    assert.equal(
      declared(profile, name)?.required, undefined,
      `"${name}" must stay optional or a provisioned principal cannot obtain a token (#496)`,
    );
  }
});

// ─── signup workspace binding ────────────────────────────────────────────────
// POST /v1/auth/signups is PUBLIC and takes workspaceId from the request body. While Keycloak
// discarded the attribute an unchecked value was inert; once the claim is actually minted, an
// unchecked value is self-assignment of any workspace. The binding must be resolved.

// Mirrors the real SQL rather than the intent: `workspaces` is keyed by (id | slug) AND scoped by
// tenant_id, because slug is only UNIQUE (tenant_id, slug). `workspaces` may hold rows from several
// tenants — that is the case bbx-wsid-11 exists for.
function fakeStorePool({ tenant, workspaces = [] }) {
  return {
    async query(sql, params) {
      if (/FROM workspaces/i.test(sql)) {
        const scoped = /tenant_id = \$2/.test(sql) ? workspaces.filter((w) => w.tenant_id === params[1]) : workspaces;
        const matched = scoped.filter((w) => w.id === params[0] || w.slug === params[0]);
        // Mirror `ORDER BY (id = $1) DESC` when the SQL asks for it; otherwise physical order.
        if (/ORDER BY \(id = \$1\) DESC/.test(sql)) matched.sort((a, b) => (b.id === params[0]) - (a.id === params[0]));
        return { rows: matched.length ? [matched[0]] : [] };
      }
      return { rows: tenant ? [tenant] : [] };
    },
  };
}
const TENANT_ROW = { id: TENANT_ID, tenant_id: TENANT_ID, slug: 'acme', display_name: 'Acme', status: 'active', iam_realm: TENANT_ID };
function signupCtx(pool, workspaceId, calls) {
  return {
    params: {}, query: {}, identity: null, callerContext: null, pool,
    body: { tenantId: TENANT_ID, workspaceId, username: 'alice', primaryEmail: 'alice@acme.test', password: 'Secret123!' },
    _kcAdmin: { async createUser(realm, opts) { calls.push({ realm, opts }); return 'user-uuid'; } },
  };
}

// ─── bbx-wsid-07 ─────────────────────────────────────────────────────────────

test('bbx-wsid-07: signup rejects a workspaceId belonging to another tenant', async () => {
  const calls = [];
  const foreign = { id: WORKSPACE_ID, tenant_id: OTHER_TENANT_ID, slug: 'other-ws' };
  const result = await AUTH_HANDLERS.signup(signupCtx(fakeStorePool({ tenant: TENANT_ROW, workspaces: [foreign] }), WORKSPACE_ID, calls));

  assert.equal(result.statusCode, 400,
    `a foreign workspace binding must be refused, got ${result.statusCode}: ${JSON.stringify(result.body)}`);
  assert.equal(result.body.code, 'WORKSPACE_NOT_IN_TENANT');
  assert.equal(calls.length, 0, 'no Keycloak user may be created for a refused binding');
});

// ─── bbx-wsid-08 ─────────────────────────────────────────────────────────────

test('bbx-wsid-08: signup rejects an unknown workspaceId identically (no existence oracle)', async () => {
  const calls = [];
  const result = await AUTH_HANDLERS.signup(signupCtx(fakeStorePool({ tenant: TENANT_ROW, workspaces: [] }), WORKSPACE_ID, calls));

  assert.equal(result.statusCode, 400);
  assert.equal(result.body.code, 'WORKSPACE_NOT_IN_TENANT',
    'unknown and foreign workspaces must be indistinguishable to an unauthenticated caller');
  assert.equal(calls.length, 0);
});

// ─── bbx-wsid-09 ─────────────────────────────────────────────────────────────

test('bbx-wsid-09: signup stamps a workspaceId that really belongs to the tenant', async () => {
  const calls = [];
  const own = { id: WORKSPACE_ID, tenant_id: TENANT_ID, slug: 'acme-ws' };
  const result = await AUTH_HANDLERS.signup(signupCtx(fakeStorePool({ tenant: TENANT_ROW, workspaces: [own] }), WORKSPACE_ID, calls));

  assert.equal(result.statusCode, 201, `expected 201, got ${result.statusCode}: ${JSON.stringify(result.body)}`);
  assert.equal(calls[0]?.opts?.attributes?.workspace_id, WORKSPACE_ID,
    'a real binding must still be stamped — the fix hardens the check, it does not drop the claim');
  assert.equal(calls[0]?.opts?.attributes?.tenant_id, TENANT_ID);
});

// ─── bbx-wsid-11 ─────────────────────────────────────────────────────────────
// `workspaces.slug` is only UNIQUE (tenant_id, slug), so an unscoped `id = $1 OR slug = $1`
// resolves a common slug to whichever tenant wins an arbitrary LIMIT 1. That would refuse a tenant
// its OWN workspace — a fail-closed break, but a break. The lookup is tenant-scoped.

test('bbx-wsid-11: a slug shared by two tenants resolves to the caller\'s own workspace', async () => {
  // Row order deliberately puts the OTHER tenant first: an unscoped LIMIT 1 would pick it.
  const workspaces = [
    { id: 'ws-other-0000-0000-000000000001', tenant_id: OTHER_TENANT_ID, slug: 'default' },
    { id: WORKSPACE_ID, tenant_id: TENANT_ID, slug: 'default' },
  ];
  const calls = [];
  const result = await AUTH_HANDLERS.signup(signupCtx(fakeStorePool({ tenant: TENANT_ROW, workspaces }), 'default', calls));

  assert.equal(result.statusCode, 201,
    `a tenant must be able to sign up for its own 'default' workspace even when another tenant `
    + `has one too; got ${result.statusCode}: ${JSON.stringify(result.body)}`);
  assert.equal(calls[0]?.opts?.attributes?.workspace_id, WORKSPACE_ID,
    'the stamped binding must be the CALLER tenant\'s workspace id');
});

// ─── bbx-wsid-12 ─────────────────────────────────────────────────────────────
// `slugify` allows [a-z0-9-], so a UUID survives it unchanged: one tenant can own a workspace
// whose SLUG is another of its workspaces' ID. `id = $1 OR slug = $1` then matches two rows inside
// a single tenant and a bare LIMIT 1 picks by physical order — so a signup addressed by a
// workspace's canonical id could be bound to a different workspace. The canonical id must win.

test('bbx-wsid-12: a canonical workspace id never resolves to a same-tenant slug impostor', async () => {
  const VICTIM = 'a3be0b6d-1111-2222-3333-000000009999';
  // Impostor listed FIRST so an unordered LIMIT 1 would pick it.
  const workspaces = [
    { id: 'ws-impostor-0000-0000-000000000001', tenant_id: TENANT_ID, slug: VICTIM },
    { id: VICTIM, tenant_id: TENANT_ID, slug: 'victim-ws' },
  ];
  const calls = [];
  const result = await AUTH_HANDLERS.signup(signupCtx(fakeStorePool({ tenant: TENANT_ROW, workspaces }), VICTIM, calls));

  assert.equal(result.statusCode, 201, `expected 201, got ${result.statusCode}: ${JSON.stringify(result.body)}`);
  assert.equal(calls[0]?.opts?.attributes?.workspace_id, VICTIM,
    'addressing a workspace by its canonical id must bind to THAT workspace, not to a sibling '
    + 'whose slug happens to equal that id');
});
