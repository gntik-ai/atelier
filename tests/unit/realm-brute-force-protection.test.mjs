/**
 * Regression: add-brute-force-protection (#668)
 *
 * Brute-force detection was OFF on EVERY provisioned realm. `kc-admin.mjs::createRealm` POSTs a
 * Keycloak RealmRepresentation that never set `bruteForceProtected`, and Keycloak defaults that to
 * FALSE — so the realm accepted unlimited wrong-password attempts (no lockout, attack-detection not
 * even counting). Confirmed live: 35 wrong ROPC attempts → 35×401, then the correct password → 200
 * (no lockout); `attack-detection numFailures:0`.
 *
 * These tests drive the REAL `kcAdmin.createRealm` (apps/control-plane/kc-admin.mjs) against
 * a FAKE Keycloak injected through `globalThis.fetch` (mirrors the fetch-seam harness used by
 * oidc-app-client-redirect-allowlist / sa-revocation unit tests). No live Keycloak / no network.
 *
 * Acceptance criteria encoded (the issue's ADDED requirement + scenarios):
 *  - the POSTed realm representation carries `bruteForceProtected: true` (the cardinal differential —
 *    it FAILS if the flag is reverted to false/absent);
 *  - a sane, verifiable `failureFactor` (default 10, ≤ the configured threshold so ~35 attempts can
 *    exercise it) plus the lockout window (`maxFailureWaitSeconds`) and `permanentLockout: false`;
 *  - the thresholds are configurable per deployment via env (REALM_BRUTE_FORCE_*), honored by the
 *    pure `bruteForceRealmConfig` resolver (exported, mirroring how #670 exports `parseAllowList`);
 *  - a malformed/empty env value falls back to the safe default rather than disabling protection;
 *  - the existing realm fields (login flags, realm-type attribute) are preserved;
 *  - EVERY brute-force field emitted is a REAL Keycloak RealmRepresentation field (allow-list guard,
 *    bf-05): a hallucinated field such as `failureResetTimeSeconds` makes KC reject the ENTIRE
 *    `POST /realms` with `400 "unable to read contents from stream"`, which broke ALL tenant
 *    provisioning. The fake-fetch harness below returns 201 for ANY body, so it cannot catch an
 *    invalid KC field on its own — the allow-list assertion is what closes that gap.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { kcAdmin, bruteForceRealmConfig } from '../../apps/control-plane/kc-admin.mjs';

const REALM = 'ten-acme';

/**
 * Build a fake Keycloak `fetch` that:
 *  - answers the master-realm admin token POST with {access_token, expires_in};
 *  - captures the JSON body POSTed to `/admin/realms` (realm-create) and returns 201;
 *  - answers the createRealm follow-ups (relaxUserProfile GET/PUT users/profile,
 *    applyRequiredClientScopes GET/POST client-scopes + PUT default-default-client-scopes) with
 *    benign success so createRealm runs to completion.
 * Returns { fetchImpl, captured } where captured.realmBody is the parsed realm payload.
 */
function makeFakeKeycloak() {
  const captured = { tokenCalls: 0, realmBody: null, realmPath: null };

  function ok(status, body) {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(),
      async text() { return body == null ? '' : JSON.stringify(body); },
      async json() { return body ?? null; },
    };
  }

  async function fetchImpl(url, init = {}) {
    const u = String(url);
    const method = init.method ?? 'GET';

    if (u.endsWith('/realms/master/protocol/openid-connect/token')) {
      captured.tokenCalls += 1;
      return ok(200, { access_token: 'fake-admin-token', expires_in: 60 });
    }

    // Realm create — the payload under test.
    if (/\/admin\/realms$/.test(u) && method === 'POST') {
      captured.realmPath = u;
      captured.realmBody = JSON.parse(init.body);
      return ok(201, null);
    }

    // relaxUserProfile: GET returns a profile with required email/firstName/lastName; PUT 200.
    if (/\/admin\/realms\/[^/]+\/users\/profile$/.test(u)) {
      if (method === 'GET') {
        return ok(200, { attributes: [{ name: 'email', required: true }] });
      }
      return ok(200, null); // PUT
    }

    // applyRequiredClientScopes: list (empty), create (201 + Location), set-default (PUT 204).
    if (/\/admin\/realms\/[^/]+\/client-scopes$/.test(u)) {
      if (method === 'GET') return ok(200, []);
      // POST create scope → 201 with a Location so ensureClientScope resolves an id.
      return {
        ok: true, status: 201,
        headers: new Headers({ location: `${u}/00000000-0000-0000-0000-00000000000a` }),
        async text() { return ''; }, async json() { return null; },
      };
    }
    if (/\/admin\/realms\/[^/]+\/default-default-client-scopes\/[^/]+$/.test(u) && method === 'PUT') {
      return ok(204, null);
    }
    // applyRequiredClientScopes also gives the context scopes their claim mappers (#961):
    // list (empty) then create. Asserted properly in tests/blackbox/workspace-id-claim-minting.
    if (/\/admin\/realms\/[^/]+\/client-scopes\/[^/]+\/protocol-mappers\/models$/.test(u)) {
      return method === 'GET' ? ok(200, []) : ok(201, null);
    }

    throw new Error(`unexpected fetch in fake Keycloak: ${method} ${u}`);
  }

  return { fetchImpl, captured };
}

// Swap globalThis.fetch around each test so the module-level `fetch` calls hit the fake.
let realFetch;
test.beforeEach(() => { realFetch = globalThis.fetch; });
test.afterEach(() => { globalThis.fetch = realFetch; });

// ── bf-01 ─────────────────────────────────────────────────────────────────────
// The created realm has brute-force detection ON. This is the core differential: it FAILS on the
// pre-fix behaviour where the realm rep had no bruteForceProtected (KC defaults it to false).
test('bf-01: createRealm enables bruteForceProtected with a sane, verifiable failureFactor', async () => {
  const { fetchImpl, captured } = makeFakeKeycloak();
  globalThis.fetch = fetchImpl;

  await kcAdmin.createRealm({ realm: REALM, displayName: 'Acme' });

  const body = captured.realmBody;
  assert.ok(body, 'a realm-create POST body was captured');

  // Cardinal assertion: brute-force detection is enabled.
  assert.equal(body.bruteForceProtected, true, 'bruteForceProtected MUST be true on a provisioned realm');

  // A meaningful, practically-verifiable failure factor (default 10) — KC's default of 30 is too
  // weak, and a value ≤ ~35 makes the lockout reachable in a finite probe.
  assert.equal(typeof body.failureFactor, 'number', 'failureFactor is a number');
  assert.ok(body.failureFactor > 0 && body.failureFactor <= 30,
    `failureFactor must be a sane positive threshold ≤ 30 (got ${body.failureFactor})`);
  assert.equal(body.failureFactor, 10, 'default failureFactor is 10');

  // A lockout window and temporary (not permanent) lockout by default.
  assert.equal(body.maxFailureWaitSeconds, 900, 'default lockout window is 900s');
  assert.equal(body.permanentLockout, false, 'lockout is temporary by default (account auto-recovers)');

  // The realm's existing identity/login fields are preserved (no regression of #496/#670 setup).
  assert.equal(body.realm, REALM);
  assert.equal(body.loginWithEmailAllowed, true);
  assert.equal(body.attributes?.['in-falcone.realm-type'], 'tenant');
});

// ── bf-02 ─────────────────────────────────────────────────────────────────────
// "Thresholds configurable per deployment": the pure resolver honors REALM_BRUTE_FORCE_* env and
// keeps detection ON by default. This is the deterministic env contract (no module re-import race).
test('bf-02: bruteForceRealmConfig defaults are safe and ON', () => {
  const cfg = bruteForceRealmConfig({}); // empty env → all defaults
  assert.deepEqual(cfg, {
    bruteForceProtected: true,
    failureFactor: 10,
    maxFailureWaitSeconds: 900,
    waitIncrementSeconds: 60,
    minimumQuickLoginWaitSeconds: 60,
    quickLoginCheckMilliSeconds: 1000,
    maxDeltaTimeSeconds: 43200,
    permanentLockout: false,
  }, 'empty env yields the documented safe defaults with protection ON');
});

// ── bf-03 ─────────────────────────────────────────────────────────────────────
// Env overrides are honored: an operator can tune the factor / window / permanent-lockout.
test('bf-03: bruteForceRealmConfig honors env overrides', () => {
  const cfg = bruteForceRealmConfig({
    REALM_BRUTE_FORCE_FAILURE_FACTOR: '5',
    REALM_BRUTE_FORCE_MAX_WAIT_SECONDS: '120',
    REALM_BRUTE_FORCE_PERMANENT_LOCKOUT: 'true',
  });
  assert.equal(cfg.failureFactor, 5, 'failureFactor overridden from env');
  assert.equal(cfg.maxFailureWaitSeconds, 120, 'maxFailureWaitSeconds overridden from env');
  assert.equal(cfg.permanentLockout, true, 'permanentLockout overridden from env');
  // Untouched knobs keep their defaults.
  assert.equal(cfg.bruteForceProtected, true);
  assert.equal(cfg.waitIncrementSeconds, 60);
});

// ── bf-04 ─────────────────────────────────────────────────────────────────────
// Fail-safe parsing: a malformed/empty numeric env falls back to the default (never silently 0),
// and the protection flag can only be disabled by an EXPLICIT false — a garbage value stays ON.
test('bf-04: malformed env falls back to safe defaults (never disables protection by accident)', () => {
  const cfg = bruteForceRealmConfig({
    REALM_BRUTE_FORCE_FAILURE_FACTOR: 'not-a-number',
    REALM_BRUTE_FORCE_MAX_WAIT_SECONDS: '-7',
    REALM_BRUTE_FORCE_PROTECTED: 'garbage',
  });
  assert.equal(cfg.failureFactor, 10, 'non-numeric factor → default 10, not 0');
  assert.equal(cfg.maxFailureWaitSeconds, 900, 'negative window → default 900');
  assert.equal(cfg.bruteForceProtected, true, 'garbage flag value → stays ON (default true)');

  // Protection is only disabled by an explicit, recognised false — an intentional operator opt-out.
  assert.equal(bruteForceRealmConfig({ REALM_BRUTE_FORCE_PROTECTED: 'false' }).bruteForceProtected, false);
  assert.equal(bruteForceRealmConfig({ REALM_BRUTE_FORCE_PROTECTED: '0' }).bruteForceProtected, false);
});

// ── bf-05 ─────────────────────────────────────────────────────────────────────
// Regression guard against re-introducing a hallucinated KC field. A previous fix emitted
// `failureResetTimeSeconds`, which is NOT a field of Keycloak's RealmRepresentation; KC 26 rejected
// the ENTIRE `POST /realms` with `400 {"errorMessage":"unable to read contents from stream"}`, so
// EVERY new-tenant createRealm 400'd — tenant provisioning was completely broken.
//
// The fake-fetch harness in makeFakeKeycloak() returns 201 for ANY body, so it CANNOT detect an
// invalid KC field by itself (the bf-01 test passed even while live createRealm 400'd). This guard
// closes that gap: every brute-force-related key emitted by `bruteForceRealmConfig` AND every such
// key in the realm representation actually POSTed by `createRealm` MUST be within the explicit
// allow-list of REAL Keycloak RealmRepresentation brute-force fields. The test FAILS if any
// unknown/hallucinated field (like `failureResetTimeSeconds`) appears.
//
// Source of truth: org.keycloak.representations.idm.RealmRepresentation (KC 26.x) — the only
// brute-force properties it defines.
const VALID_KC_BRUTE_FORCE_FIELDS = new Set([
  'bruteForceProtected',
  'permanentLockout',
  'failureFactor',
  'maxFailureWaitSeconds',
  'waitIncrementSeconds',
  'minimumQuickLoginWaitSeconds',
  'quickLoginCheckMilliSeconds',
  'maxDeltaTimeSeconds',
  'maxTemporaryLockouts',
  'bruteForceStrategy',
]);

test('bf-05: every emitted brute-force field is a REAL Keycloak RealmRepresentation field (no hallucinated key)', async () => {
  // (a) the pure resolver only emits real KC brute-force fields.
  const cfg = bruteForceRealmConfig({});
  for (const key of Object.keys(cfg)) {
    assert.ok(
      VALID_KC_BRUTE_FORCE_FIELDS.has(key),
      `bruteForceRealmConfig emitted "${key}", which is NOT a valid Keycloak RealmRepresentation ` +
        `brute-force field — KC rejects the whole POST /realms with 400 "unable to read contents ` +
        `from stream". Valid fields: ${[...VALID_KC_BRUTE_FORCE_FIELDS].join(', ')}.`,
    );
  }

  // (b) the realm representation actually POSTed by createRealm carries no invalid brute-force key.
  // (createRealm spreads the resolved config; assert on the real wire payload, not just the resolver.)
  const { fetchImpl, captured } = makeFakeKeycloak();
  globalThis.fetch = fetchImpl;
  await kcAdmin.createRealm({ realm: REALM, displayName: 'Acme' });
  const body = captured.realmBody;
  assert.ok(body, 'a realm-create POST body was captured');

  // Any key in the posted realm rep that is a brute-force concept (i.e. listed in our allow-list of
  // KC's brute-force fields) is, by construction, valid; the failure mode we must catch is a key the
  // code BELIEVES is a brute-force field but KC does not know. So assert that every key emitted by
  // the resolver and present on the body is in the allow-list — and that the body carries no key
  // matching a brute-force naming shape that is outside the allow-list.
  for (const key of Object.keys(cfg)) {
    assert.ok(
      VALID_KC_BRUTE_FORCE_FIELDS.has(key) && key in body,
      `createRealm posted brute-force field "${key}" which must be a valid KC field and present on the realm rep`,
    );
  }
  // Defense in depth: nothing on the posted body that *looks* like a brute-force / failure / lockout
  // knob may escape the allow-list (catches a stray hardcoded field added directly in createRealm).
  const bruteForceShaped = /^(bruteForce|failure|lockout|maxFailure|waitIncrement|quickLogin|minimumQuickLogin|maxDelta|maxTemporary|permanentLockout)/i;
  for (const key of Object.keys(body)) {
    if (bruteForceShaped.test(key)) {
      assert.ok(
        VALID_KC_BRUTE_FORCE_FIELDS.has(key),
        `createRealm posted "${key}", which looks like a brute-force knob but is NOT a valid Keycloak ` +
          `RealmRepresentation field (KC would 400 the whole realm-create). Valid fields: ` +
          `${[...VALID_KC_BRUTE_FORCE_FIELDS].join(', ')}.`,
      );
    }
  }
});
