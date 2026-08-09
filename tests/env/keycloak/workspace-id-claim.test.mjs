// Real-Keycloak-26 proof for #961 — "no principal ever receives a workspace_id claim".
//
// The defect had two halves and both are Keycloak-behaviour claims, so neither can be settled by a
// fake: (1) KC26's declarative user profile is always on and unmanaged attributes are disabled by
// default, so the tenant_id/workspace_id attributes the platform stamps were DISCARDED at persist
// time with no error to the caller — the user came back `attributes: null`; (2) the
// tenant-context / workspace-context client scopes were created with zero protocol mappers, so
// even a persisted attribute could not reach a token.
//
// This runs the REAL provisioning code (apps/control-plane/kc-admin.mjs) against a real KC 26 and
// proves the differential in one deterministic run:
//   RED   realm provisioned the pre-fix way  -> attributes dropped, no workspace_id claim
//   GREEN realm provisioned by kcAdmin.createRealm -> attribute persists, claim reaches the token
//
// The RED realm is built from raw admin calls that mirror the pre-fix createRealm exactly (relax
// email/firstName/lastName; create the four scopes mapper-less; mark them default). That keeps the
// baseline honest without needing to check out the old code.
//
// Run via tests/env/keycloak/run.sh (brings up the tests/env Keycloak 26 on :8081).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const KC = process.env.KC_BASE_URL ?? 'http://localhost:8081';
const ADMIN_USER = process.env.KC_ADMIN ?? 'admin';
const ADMIN_PW = process.env.KC_ADMIN_PASSWORD ?? 'admin';

// Realm name == tenant id (Falcone realm-per-tenant), so use real UUID shapes.
const RED_REALM = '961b0000-1111-4222-8333-444455556666';
const GREEN_REALM = '961a1111-2222-4333-8444-555566667777';
const WORKSPACE_ID = 'a3be0b6d-8888-4999-8aaa-bbbbccccdddd';
const OTHER_WORKSPACE_ID = 'ffffffff-8888-4999-8aaa-bbbbccccdddd';
const USERNAME = 'wsid-probe-user';
const PW = 'Passw0rd!961';

let token;
let kcAdmin;
let TENANT_REALM_SCOPES;
let runBackfill;

async function adminToken() {
  const res = await fetch(`${KC}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: ADMIN_USER, password: ADMIN_PW }),
  });
  if (!res.ok) throw new Error(`admin token failed: ${res.status}`);
  return (await res.json()).access_token;
}
const api = (method, path, body) => fetch(`${KC}${path}`, {
  method,
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

async function dropRealm(realm) {
  await api('DELETE', `/admin/realms/${realm}`);
  for (let i = 0; i < 30; i++) {
    if ((await api('GET', `/admin/realms/${realm}`)).status === 404) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`realm ${realm} did not disappear`);
}

/** Provision RED exactly as the pre-fix createRealm did: relax only, scopes with no mappers. */
async function provisionPreFix(realm) {
  const create = await api('POST', '/admin/realms', {
    realm, displayName: 'Pre-fix', enabled: true,
    loginWithEmailAllowed: true, registrationAllowed: false, rememberMe: true,
    resetPasswordAllowed: true, verifyEmail: false,
  });
  assert.equal(create.status, 201, 'RED realm created fresh');

  const prof = await (await api('GET', `/admin/realms/${realm}/users/profile`)).json();
  for (const a of prof.attributes ?? []) {
    if (['email', 'firstName', 'lastName'].includes(a.name)) delete a.required;
  }
  assert.equal((await api('PUT', `/admin/realms/${realm}/users/profile`, prof)).status, 200);

  for (const name of TENANT_REALM_SCOPES) {
    const res = await api('POST', `/admin/realms/${realm}/client-scopes`, {
      name, protocol: 'openid-connect',
      attributes: { 'include.in.token.scope': 'true', 'display.on.consent.screen': 'false' },
    });
    assert.equal(res.status, 201, `RED scope ${name} created`);
    const id = res.headers.get('location').split('/').pop();
    await api('PUT', `/admin/realms/${realm}/default-default-client-scopes/${id}`, {});
  }
}

/** The tenant app client createTenant installs, plus the hardcoded un-forgeable tenant_id mapper. */
async function createAppClient(realm) {
  const res = await api('POST', `/admin/realms/${realm}/clients`, {
    clientId: 'probe-app', name: 'Probe App', enabled: true, protocol: 'openid-connect',
    publicClient: true, standardFlowEnabled: true, directAccessGrantsEnabled: true,
    serviceAccountsEnabled: false, redirectUris: ['https://app.example.test/*'], webOrigins: ['+'],
  });
  assert.equal(res.status, 201, 'app client created');
  const uuid = res.headers.get('location').split('/').pop();
  await api('POST', `/admin/realms/${realm}/clients/${uuid}/protocol-mappers/models`, {
    name: 'tenant_id', protocol: 'openid-connect', protocolMapper: 'oidc-hardcoded-claim-mapper',
    config: {
      'claim.name': 'tenant_id', 'claim.value': realm, 'jsonType.label': 'String',
      'access.token.claim': 'true', 'id.token.claim': 'true', 'userinfo.token.claim': 'true',
    },
  });
  return uuid;
}

async function createProbeUser(realm, attributes) {
  const res = await api('POST', `/admin/realms/${realm}/users`, {
    username: USERNAME, email: `${USERNAME}@example.test`, firstName: 'Probe', lastName: 'User',
    enabled: true, emailVerified: true, requiredActions: [],
    credentials: [{ type: 'password', value: PW, temporary: false }],
    attributes,
  });
  assert.ok([201, 409].includes(res.status), `probe user created (${res.status})`);
  const found = await (await api('GET', `/admin/realms/${realm}/users?username=${USERNAME}&exact=true`)).json();
  return found[0].id;
}

/** ROPC against the tenant realm — the #953 workaround the issue's evidence used. */
async function accessTokenClaims(realm) {
  const res = await fetch(`${KC}/realms/${realm}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password', client_id: 'probe-app', scope: 'openid', username: USERNAME, password: PW,
    }),
  });
  const j = await res.json();
  assert.ok(j.access_token, `ROPC must succeed; got ${JSON.stringify(j)}`);
  return JSON.parse(Buffer.from(j.access_token.split('.')[1], 'base64url').toString('utf8'));
}

before(async () => {
  token = await adminToken();
  // kc-admin resolves its Keycloak target at module load, so the env must be set before import.
  process.env.KEYCLOAK_BASE_URL = KC;
  process.env.KEYCLOAK_ADMIN_USERNAME = ADMIN_USER;
  process.env.KEYCLOAK_ADMIN_PASSWORD = ADMIN_PW;
  process.env.TENANT_APP_REDIRECT_URIS = 'https://app.example.test/*';
  ({ kcAdmin, TENANT_REALM_SCOPES } = await import('../../../apps/control-plane/kc-admin.mjs'));
  ({ runBackfill } = await import('../../../scripts/backfill-tenant-realm-identity-claims.mjs'));

  await dropRealm(RED_REALM);
  await dropRealm(GREEN_REALM);
});

after(async () => {
  if (!token) return;
  await api('DELETE', `/admin/realms/${RED_REALM}`);
  await api('DELETE', `/admin/realms/${GREEN_REALM}`);
});

// ─── RED ──────────────────────────────────────────────────────────────────────
// Reproduces the issue's two printed observations against a real KC 26.

test('kcw-961-01 RED: pre-fix provisioning drops the attributes and mints no workspace_id claim', async () => {
  await provisionPreFix(RED_REALM);
  await createAppClient(RED_REALM);
  const userId = await createProbeUser(RED_REALM, { tenant_id: [RED_REALM], workspace_id: [WORKSPACE_ID] });

  const user = await (await api('GET', `/admin/realms/${RED_REALM}/users/${userId}`)).json();
  assert.ok(
    !user.attributes?.workspace_id,
    `RED baseline: KC 26 must DISCARD the undeclared attribute (this is the reported "attributes: null"); `
    + `got ${JSON.stringify(user.attributes)}`,
  );

  const scopes = await (await api('GET', `/admin/realms/${RED_REALM}/client-scopes`)).json();
  const wsScope = scopes.find((s) => s.name === 'workspace-context');
  assert.deepEqual(wsScope.protocolMappers ?? [], [], 'RED baseline: workspace-context is mapper-less');

  const claims = await accessTokenClaims(RED_REALM);
  assert.equal(claims.workspace_id, undefined, 'RED baseline: the token carries no workspace_id claim');
  assert.equal(claims.tenant_id, RED_REALM, 'tenant_id survives via the hardcoded client mapper only');
  assert.match(claims.scope, /workspace-context/, 'the decorative scope is still in the scope string');
});

// ─── GREEN ────────────────────────────────────────────────────────────────────
// The same sequence through the real provisioning code.

test('kcw-961-02 GREEN: kcAdmin.createRealm persists the attribute and the claim reaches the token', async () => {
  await kcAdmin.createRealm({ realm: GREEN_REALM, displayName: 'Fixed' });
  await createAppClient(GREEN_REALM);
  const userId = await kcAdmin.createUser(GREEN_REALM, {
    username: USERNAME, email: `${USERNAME}@example.test`, firstName: 'Probe', lastName: 'User',
    password: PW, enabled: true, temporary: false,
    attributes: { tenant_id: GREEN_REALM, workspace_id: WORKSPACE_ID },
  });

  const user = await (await api('GET', `/admin/realms/${GREEN_REALM}/users/${userId}`)).json();
  assert.deepEqual(user.attributes?.workspace_id, [WORKSPACE_ID],
    `Keycloak must now PERSIST workspace_id; got ${JSON.stringify(user.attributes)}`);
  assert.deepEqual(user.attributes?.tenant_id, [GREEN_REALM]);

  const claims = await accessTokenClaims(GREEN_REALM);
  assert.equal(claims.workspace_id, WORKSPACE_ID,
    `the access token MUST carry workspace_id; claims: ${JSON.stringify(claims)}`);
  assert.equal(claims.tenant_id, GREEN_REALM,
    'tenant_id still comes from the hardcoded mapper (single, un-forgeable source)');
});

// ─── retrofit ─────────────────────────────────────────────────────────────────
// createRealm only reaches realms provisioned from now on. Every tenant realm that already exists
// stays broken unless something re-applies the two idempotent helpers — that is what
// scripts/backfill-tenant-realm-identity-claims.mjs is for. Run it against the RED realm built
// above (a genuine pre-fix realm, not a simulation) and prove it becomes GREEN.

test('kcw-961-04: the back-fill retrofits a realm provisioned before the fix', async () => {
  const sink = { out: '', write(s) { this.out += s; } };
  const dry = await runBackfill({ argv: [], loadTenantRealms: async () => [RED_REALM], kcAdmin, outStream: sink });
  assert.equal(dry.exitCode, 0, `dry run must succeed: ${sink.out}`);
  assert.deepEqual(dry.result.inspected[0].missingAttributes, ['tenant_id', 'workspace_id'],
    'dry run must REPORT what the pre-fix realm is missing');
  assert.deepEqual(dry.result.inspected[0].missingMappers, ['workspace-context/workspace_id']);
  assert.deepEqual(dry.result.repaired, [], 'a dry run must change nothing');

  const applied = await runBackfill({ argv: ['--apply'], loadTenantRealms: async () => [RED_REALM], kcAdmin, outStream: sink });
  assert.equal(applied.exitCode, 0, `apply must succeed: ${sink.out}`);
  assert.deepEqual(applied.result.repaired, [RED_REALM]);

  // A principal created AFTER the retrofit now carries the claim in the retrofitted realm.
  const retrofitted = `${USERNAME}-post`;
  const userId = await kcAdmin.createUser(RED_REALM, {
    username: retrofitted, email: `${retrofitted}@example.test`, firstName: 'Probe', lastName: 'User',
    password: PW, enabled: true, temporary: false,
    attributes: { tenant_id: RED_REALM, workspace_id: WORKSPACE_ID },
  });
  const user = await (await api('GET', `/admin/realms/${RED_REALM}/users/${userId}`)).json();
  assert.deepEqual(user.attributes?.workspace_id, [WORKSPACE_ID],
    `the retrofitted realm must now persist workspace_id; got ${JSON.stringify(user.attributes)}`);

  const res = await fetch(`${KC}/realms/${RED_REALM}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password', client_id: 'probe-app', scope: 'openid', username: retrofitted, password: PW,
    }),
  });
  const claims = JSON.parse(Buffer.from((await res.json()).access_token.split('.')[1], 'base64url').toString('utf8'));
  assert.equal(claims.workspace_id, WORKSPACE_ID, `retrofitted realm must mint the claim; claims: ${JSON.stringify(claims)}`);

  // The tail the retrofit CANNOT fix: the user created before it has no stored workspace_id, and
  // the report says so rather than implying the realm is fully healed.
  const tail = applied.result.usersWithoutStoredWorkspaceId.find((r) => r.realm === RED_REALM);
  assert.ok(tail?.usernames.includes(USERNAME),
    `the pre-retrofit principal must be reported as still unbound; got ${JSON.stringify(applied.result.usersWithoutStoredWorkspaceId)}`);

  // Re-running must be a no-op, not a second mapper.
  const again = await runBackfill({ argv: ['--apply'], loadTenantRealms: async () => [RED_REALM], kcAdmin, outStream: sink });
  assert.deepEqual(again.result.inspected[0].missingAttributes, []);
  assert.deepEqual(again.result.inspected[0].missingMappers, []);
  const scopes = await (await api('GET', `/admin/realms/${RED_REALM}/client-scopes`)).json();
  const ws = scopes.find((s) => s.name === 'workspace-context');
  assert.equal((ws.protocolMappers ?? []).filter((m) => m.name === 'workspace_id').length, 1,
    'exactly one workspace_id mapper after two applies');
});

// ─── the binding must not be self-editable ───────────────────────────────────
// The claim is only worth minting if its holder cannot rewrite it. Proven against real KC, not
// against our own declaration: read the profile back and exercise the account API as the user.

test('kcw-961-03: the holder cannot rewrite its own workspace_id through the account API', async () => {
  const prof = await (await api('GET', `/admin/realms/${GREEN_REALM}/users/profile`)).json();
  const attr = (prof.attributes ?? []).find((a) => a.name === 'workspace_id');
  assert.ok(attr, 'workspace_id is declared in the realm user profile');
  assert.deepEqual([...(attr.permissions?.edit ?? [])].sort(), ['admin'],
    `Keycloak must have stored edit:["admin"]; got ${JSON.stringify(attr.permissions)}`);

  // Account REST API with the holder's own token: attempt to re-point the binding.
  const res = await fetch(`${KC}/realms/${GREEN_REALM}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password', client_id: 'probe-app', scope: 'openid', username: USERNAME, password: PW,
    }),
  });
  const userToken = (await res.json()).access_token;
  const account = await fetch(`${KC}/realms/${GREEN_REALM}/account/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${userToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      username: USERNAME, email: `${USERNAME}@example.test`, firstName: 'Probe', lastName: 'User',
      attributes: { workspace_id: [OTHER_WORKSPACE_ID] },
    }),
  });
  // Either the account API refuses the request outright (401/403/400) or it accepts the update and
  // IGNORES the admin-only attribute. Both are fail-closed; what must never happen is the value
  // changing. Assert the ground truth rather than the status code.
  const after = await (await api('GET', `/admin/realms/${GREEN_REALM}/users?username=${USERNAME}&exact=true`)).json();
  assert.deepEqual(
    after[0].attributes?.workspace_id, [WORKSPACE_ID],
    `the holder must not be able to re-point its own workspace binding (account API said ${account.status}); `
    + `attributes now: ${JSON.stringify(after[0].attributes)}`,
  );
});
