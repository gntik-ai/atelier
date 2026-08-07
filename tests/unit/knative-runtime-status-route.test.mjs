import test from 'node:test';
import assert from 'node:assert/strict';

import { routes } from '../../apps/control-plane/routes.mjs';
import {
  KNATIVE_RUNTIME_HANDLERS,
  KNATIVE_STATUS_OBSERVER_ROLES,
  isKnativeStatusObserver,
} from '../../apps/control-plane/knative-runtime-handlers.mjs';

test('knative-status-route-01: read-only platform status route is registered with a dedicated role gate', () => {
  const route = routes.find((candidate) => candidate.method === 'GET'
    && candidate.path === '/v1/platform/runtime/knative');
  assert.deepEqual(route, {
    method: 'GET',
    path: '/v1/platform/runtime/knative',
    localHandler: 'getKnativeRuntimeStatus',
    auth: 'knative_status',
  });
  assert.equal(routes.some((candidate) => candidate.path === route.path && candidate.method !== 'GET'), false);
});

test('knative-status-route-03: read-only status is authorized by exactly the platform observer roles', () => {
  // The backend gate MUST equal the web console gate (router.tsx::isPlatformObserverRole), so a
  // principal that can see the surface can call it and vice versa. Any drift between these two
  // literals is a backend/UI authorization mismatch.
  assert.deepEqual(
    [...KNATIVE_STATUS_OBSERVER_ROLES].sort(),
    ['platform_admin', 'platform_auditor', 'platform_operator', 'superadmin'],
  );
  for (const role of KNATIVE_STATUS_OBSERVER_ROLES) {
    assert.equal(isKnativeStatusObserver({ roles: [role], actorType: 'internal' }), true, `role ${role} must observe`);
  }
});

test('knative-status-route-04: an actor_type=superadmin claim without a platform role is NOT authorized', () => {
  // Removing the actor_type-only fallback: a token that merely asserts actor_type=superadmin but
  // carries none of the four platform roles is denied by the backend, exactly as the console denies
  // it (its platformRoles claim would carry no observer role). Authorization is by verified role.
  assert.equal(isKnativeStatusObserver({ roles: [], actorType: 'superadmin' }), false);
  assert.equal(isKnativeStatusObserver({ roles: ['tenant_owner', 'workspace_admin'], actorType: 'superadmin' }), false);
  assert.equal(isKnativeStatusObserver({ roles: ['tenant_owner'], actorType: 'tenant_owner' }), false);
  // Defensive: missing/blank identity is never an observer.
  assert.equal(isKnativeStatusObserver(null), false);
  assert.equal(isKnativeStatusObserver({}), false);
  assert.equal(isKnativeStatusObserver({ roles: 'superadmin' }), false);
});

test('knative-status-route-02: handler returns only the sanitized source-of-truth projection', async () => {
  const status = {
    mode: 'external', owner: 'cluster-admin', version: '1.22.1', compatibility: 'compatible',
    state: 'ready', stage: 'external_validation', reason: 'READY',
    lastTransitionAt: '2026-08-07T10:00:00.000Z',
  };
  const result = await KNATIVE_RUNTIME_HANDLERS.getKnativeRuntimeStatus({
    knativeRuntime: { status: () => ({ ...status, secret: 'must-not-escape' }) },
  });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body, status);
});
