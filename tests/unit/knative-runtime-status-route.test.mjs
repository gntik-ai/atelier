import test from 'node:test';
import assert from 'node:assert/strict';

import { routes } from '../../apps/control-plane/routes.mjs';
import { KNATIVE_RUNTIME_HANDLERS } from '../../apps/control-plane/knative-runtime-handlers.mjs';

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
