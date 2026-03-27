import test from 'node:test';
import assert from 'node:assert/strict';

import { buildScopeValidatedImportRequest, validateImportBundle } from '../../apps/control-plane/src/functions-admin.mjs';

test('definition import resilience blocks cross-scope bundles before dispatch', () => {
  assert.throws(
    () =>
      buildScopeValidatedImportRequest(
        {
          tenantId: 'ten_01growthalpha',
          workspaceId: 'wrk_01alphadev',
          correlationId: 'corr_fn_import_scope_01'
        },
        {
          bundleVersion: '2026-03-27',
          tenantId: 'ten_01other',
          workspaceId: 'wrk_01alphadev',
          resources: []
        }
      ),
    /tenant scope/
  );
});

test('definition import resilience rejects unsupported visibility policy and logical name collisions', () => {
  const visibility = validateImportBundle(
    {
      bundleVersion: '2026-03-27',
      resources: [{ resourceType: 'function_action', actionName: 'dispatch-billing', visibility: 'internet' }]
    },
    {
      tenantId: 'ten_01growthalpha',
      workspaceId: 'wrk_01alphadev'
    }
  );
  const collision = validateImportBundle(
    {
      bundleVersion: '2026-03-27',
      resources: [{ resourceType: 'function_action', actionName: 'dispatch-billing', name: 'dispatch-billing', visibility: 'public' }]
    },
    {
      tenantId: 'ten_01growthalpha',
      workspaceId: 'wrk_01alphadev',
      existingNames: ['dispatch-billing']
    }
  );

  assert.equal(visibility.valid, false);
  assert.equal(visibility.code, 'IMPORT_POLICY_CONFLICT');
  assert.equal(collision.valid, false);
  assert.equal(collision.code, 'IMPORT_COLLISION');
});
