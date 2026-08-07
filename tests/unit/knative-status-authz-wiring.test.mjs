/**
 * Regression guard for #933 blocker 1 — the control-plane authorization gate for
 * GET /v1/platform/runtime/knative must delegate to the shared platform-observer predicate and must
 * NOT carry the earlier actor_type-only superadmin fallback that let the backend out-grant the UI.
 *
 * The predicate's behaviour is covered by tests/unit/knative-runtime-status-route.test.mjs
 * (isKnativeStatusObserver). Importing server.mjs has import-time side effects (it builds a runtime,
 * opens pools, reads env), so — mirroring tests/unit/control-plane-database-startup.test.mjs — this
 * guard reads the server source and asserts the WIRING at the `knative_status` branch, closing the
 * gap where the predicate is correct but the gate stops calling it (or regrows the fallback).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  KNATIVE_STATUS_OBSERVER_ROLES,
  isKnativeStatusObserver,
} from '../../apps/control-plane/knative-runtime-handlers.mjs';

const SERVER = readFileSync(
  fileURLToPath(new URL('../../apps/control-plane/server.mjs', import.meta.url)),
  'utf8',
);

test('knative-status-wiring-00: the gate authorizes exactly the platform-observer roles, actor_type is irrelevant', () => {
  // Backend/UI parity: the same four roles the console gates the runtime page on, and nothing else.
  assert.deepEqual([...KNATIVE_STATUS_OBSERVER_ROLES].sort(), [
    'platform_admin', 'platform_auditor', 'platform_operator', 'superadmin',
  ]);
  for (const role of KNATIVE_STATUS_OBSERVER_ROLES) {
    assert.equal(isKnativeStatusObserver({ roles: [role], actorType: 'tenant_member', trustKind: 'platform' }), true);
  }
  // The removed fallback: actor_type=superadmin without a platform role is NOT an observer.
  assert.equal(isKnativeStatusObserver({ roles: [], actorType: 'superadmin' }), false);
  assert.equal(isKnativeStatusObserver({ roles: ['tenant_owner'], actorType: 'superadmin' }), false);
  assert.equal(isKnativeStatusObserver(null), false);
});

test('knative-status-wiring-01: server imports the shared platform-observer predicate', () => {
  assert.match(
    SERVER,
    /import\s*\{[^}]*\bisKnativeStatusObserver\b[^}]*\}\s*from\s*['"]\.\/knative-runtime-handlers\.mjs['"]/,
    'server.mjs must import isKnativeStatusObserver from knative-runtime-handlers.mjs',
  );
});

test('knative-status-wiring-02: the knative_status gate delegates to the predicate with no actor_type fallback', () => {
  // Isolate the knative_status authorization branch: from its guard up to the next `return`.
  const branch = /need === 'knative_status'[\s\S]*?return[^\n;]*;/.exec(SERVER);
  assert.ok(branch, 'server.mjs must have a knative_status authorization branch');
  const branchText = branch[0];

  assert.match(
    branchText,
    /return\s+isKnativeStatusObserver\(\s*identity\s*\)\s*;/,
    'the knative_status gate must return isKnativeStatusObserver(identity)',
  );
  // The removed backend/UI mismatch: no actor_type-only escape hatch on this gate.
  assert.doesNotMatch(
    branchText,
    /actorType/,
    'the knative_status gate must not reference actorType (no actor_type-only superadmin fallback)',
  );
});
