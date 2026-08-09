/**
 * Black-box regression: fix-end-user-tenant-realm-placement (#493)
 *
 * Verifies that POST /v1/auth/signups creates end-users in the TENANT's
 * iam_realm (not the shared in-falcone-platform realm) and stamps tenant_id /
 * workspace_id attributes so the tenant-context scope yields scoped tokens.
 *
 * Only the public interface (AUTH_HANDLERS.signup) is exercised.
 * kcAdmin and the tenant store are injected via ctx._kcAdmin and a fake pool
 * (the handler uses ctx._kcAdmin ?? module-level kcAdmin and ctx.pool).
 *
 * AAS-2 (HIGH, tenant-isolation): signup must route to the tenant realm.
 * AAS-3 (MED): user must carry tenant_id/workspace_id attributes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { AUTH_HANDLERS } from '../../apps/control-plane/auth-handlers.mjs';

const { signup } = AUTH_HANDLERS;

// ─── constants ────────────────────────────────────────────────────────────────
const PLATFORM_REALM = 'in-falcone-platform';
const TENANT_ID      = 'ffd33d99-aaaa-bbbb-cccc-000000000001';
const WORKSPACE_ID   = 'ws-0001-aaaa-bbbb-cccc-000000000001';
const TENANT_REALM   = TENANT_ID; // Falcone realm-per-tenant: realm name == tenantId

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Fake pool that returns a known tenant record when queried, and — since #961 — the workspace
 * signup resolves before stamping the binding. Mirrors the minimal pg Pool.query interface used
 * by tenant-store.getTenant / getWorkspace.
 */
function fakeTenantPool(tenant, workspace = { id: WORKSPACE_ID, tenant_id: TENANT_ID, slug: 'acme-ws' }) {
  return {
    async query(sql, _params) {
      // getWorkspace runs: SELECT … FROM workspaces WHERE id=$1 OR slug=$1
      if (/FROM workspaces/i.test(sql)) return { rows: workspace ? [workspace] : [] };
      // getTenant runs: SELECT … FROM tenants WHERE id=$1 OR slug=$1
      return { rows: tenant ? [tenant] : [] };
    }
  };
}

/**
 * Fake kcAdmin that records calls and returns a deterministic userId.
 * Injected via ctx._kcAdmin so only auth-handlers uses it (no module mutation).
 */
function fakeKcAdmin(capturedCalls = []) {
  return {
    async createUser(realm, opts) {
      capturedCalls.push({ op: 'createUser', realm, opts });
      return 'user-uuid-' + realm.slice(0, 8);
    }
  };
}

/**
 * Build a minimal signup ctx mirroring the server's LOCAL_HANDLERS dispatch.
 */
function makeCtx({ tenantId, workspaceId, email, username, password } = {}, pool, kcAdminMock) {
  return {
    params: {},
    query: {},
    body: { tenantId, workspaceId, email, username, password, primaryEmail: email },
    identity: null,
    callerContext: null,
    pool,
    _kcAdmin: kcAdminMock,   // DI seam for test injection
  };
}

// ─── bbx-signup-realm-01 ─────────────────────────────────────────────────────
// Signup for a tenant that HAS an iam_realm → user created in TENANT realm,
// not in in-falcone-platform, with tenant_id attribute stamped.

test('bbx-signup-realm-01: signup routes user to tenant iam_realm, not platform realm', async () => {
  const tenant = { id: TENANT_ID, tenant_id: TENANT_ID, slug: 'acme', display_name: 'Acme', status: 'active', iam_realm: TENANT_REALM };
  const calls = [];
  const pool  = fakeTenantPool(tenant);
  const kc    = fakeKcAdmin(calls);

  const result = await signup(makeCtx(
    { tenantId: TENANT_ID, workspaceId: WORKSPACE_ID, email: 'alice@acme.test', username: 'alice', password: 'Secret123!' },
    pool, kc
  ));

  assert.equal(result.statusCode, 201, `expected 201, got ${result.statusCode}: ${JSON.stringify(result.body)}`);

  const createCall = calls.find((c) => c.op === 'createUser');
  assert.ok(createCall, 'kcAdmin.createUser must be called');

  // Core invariant: user created in the TENANT realm, NOT the platform realm.
  assert.notEqual(
    createCall.realm, PLATFORM_REALM,
    `user MUST NOT be created in ${PLATFORM_REALM}; was: ${createCall.realm}`
  );
  assert.equal(
    createCall.realm, TENANT_REALM,
    `user MUST be created in tenant realm ${TENANT_REALM}; was: ${createCall.realm}`
  );
});

// ─── bbx-signup-realm-02 ─────────────────────────────────────────────────────
// Tenant_id and workspace_id attributes must be stamped on the created user
// so the tenant-context Keycloak client scope maps them into the token claims.

test('bbx-signup-realm-02: signup stamps tenant_id and workspace_id attributes on created user', async () => {
  const tenant = { id: TENANT_ID, tenant_id: TENANT_ID, slug: 'acme', display_name: 'Acme', status: 'active', iam_realm: TENANT_REALM };
  const calls = [];
  const pool  = fakeTenantPool(tenant);
  const kc    = fakeKcAdmin(calls);

  await signup(makeCtx(
    { tenantId: TENANT_ID, workspaceId: WORKSPACE_ID, email: 'bob@acme.test', username: 'bob', password: 'Secret123!' },
    pool, kc
  ));

  const createCall = calls.find((c) => c.op === 'createUser');
  assert.ok(createCall, 'kcAdmin.createUser must be called');

  const attrs = createCall.opts.attributes ?? {};
  assert.equal(attrs.tenant_id, TENANT_ID,   `tenant_id attribute must be ${TENANT_ID}; got ${attrs.tenant_id}`);
  assert.equal(attrs.workspace_id, WORKSPACE_ID, `workspace_id attribute must be ${WORKSPACE_ID}; got ${attrs.workspace_id}`);
});

// ─── bbx-signup-realm-03 ─────────────────────────────────────────────────────
// Signup for a tenant with NO iam_realm provisioned must be rejected with a
// clear 4xx rather than falling back to the platform realm.

test('bbx-signup-realm-03: signup for tenant without iam_realm is rejected with 4xx', async () => {
  const tenant = { id: TENANT_ID, tenant_id: TENANT_ID, slug: 'orphan', display_name: 'Orphan', status: 'active', iam_realm: null };
  const calls = [];
  const pool  = fakeTenantPool(tenant);
  const kc    = fakeKcAdmin(calls);

  const result = await signup(makeCtx(
    { tenantId: TENANT_ID, workspaceId: WORKSPACE_ID, email: 'x@orphan.test', username: 'xuser', password: 'Secret123!' },
    pool, kc
  ));

  assert.ok(
    result.statusCode >= 400 && result.statusCode < 500,
    `expected a 4xx, got ${result.statusCode}: ${JSON.stringify(result.body)}`
  );

  // No user must be created in any realm (especially not the platform realm).
  const createCall = calls.find((c) => c.op === 'createUser');
  assert.ok(!createCall, `kcAdmin.createUser must NOT be called when tenant has no realm; was called with realm=${createCall?.realm}`);
});

// ─── bbx-signup-realm-04 ─────────────────────────────────────────────────────
// Signup for a non-existent tenant must be rejected with a 4xx.

test('bbx-signup-realm-04: signup for non-existent tenant is rejected with 4xx', async () => {
  const calls = [];
  const pool  = fakeTenantPool(null);   // no tenant record
  const kc    = fakeKcAdmin(calls);

  const result = await signup(makeCtx(
    { tenantId: 'does-not-exist', workspaceId: WORKSPACE_ID, email: 'y@ghost.test', username: 'yuser', password: 'Secret123!' },
    pool, kc
  ));

  assert.ok(
    result.statusCode >= 400 && result.statusCode < 500,
    `expected a 4xx, got ${result.statusCode}: ${JSON.stringify(result.body)}`
  );
  const createCall = calls.find((c) => c.op === 'createUser');
  assert.ok(!createCall, `kcAdmin.createUser must NOT be called for non-existent tenant`);
});

// ─── bbx-signup-realm-05 ─────────────────────────────────────────────────────
// Platform realm safety: no signup creates a user in in-falcone-platform.

test('bbx-signup-realm-05: platform realm stays free of signup-created end-users', async () => {
  const tenant = { id: TENANT_ID, tenant_id: TENANT_ID, slug: 'acme', display_name: 'Acme', status: 'active', iam_realm: TENANT_REALM };
  const calls = [];
  const pool  = fakeTenantPool(tenant);
  const kc    = fakeKcAdmin(calls);

  await signup(makeCtx(
    { tenantId: TENANT_ID, workspaceId: WORKSPACE_ID, email: 'carol@acme.test', username: 'carol', password: 'Secret123!' },
    pool, kc
  ));

  const platformRealm = calls.filter((c) => c.op === 'createUser' && c.realm === PLATFORM_REALM);
  assert.equal(
    platformRealm.length, 0,
    `in-falcone-platform must receive no signup users; got calls: ${JSON.stringify(platformRealm)}`
  );
});
