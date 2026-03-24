import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectAuthorizationModelViolations,
  readAuthorizationModel
} from '../../scripts/lib/authorization-model.mjs';
import {
  AUTHORIZATION_MODEL_VERSION,
  listEnforcementSurfaces,
  listPermissionMatrix
} from '../../services/internal-contracts/src/index.mjs';

test('authorization model remains internally consistent', () => {
  const model = readAuthorizationModel();
  const violations = collectAuthorizationModelViolations(model);

  assert.deepEqual(violations, []);
  assert.equal(AUTHORIZATION_MODEL_VERSION, '2026-03-24');
  assert.deepEqual(
    listEnforcementSurfaces().map((surface) => surface.id).sort(),
    ['control_api', 'data_api', 'event_bus', 'functions_runtime', 'object_storage']
  );
});

test('permission matrix preserves tenant and workspace boundaries', () => {
  const workspaceRoles = new Map(listPermissionMatrix('workspace').map((entry) => [entry.role, entry]));
  const tenantRoles = new Map(listPermissionMatrix('tenant').map((entry) => [entry.role, entry]));

  assert.equal(workspaceRoles.get('workspace_admin').allowed_actions.includes('workspace.members.manage'), true);
  assert.equal(workspaceRoles.get('workspace_admin').allowed_actions.includes('service_account.admin'), true);
  assert.equal(workspaceRoles.get('workspace_admin').denied_actions.includes('tenant.suspend'), true);
  assert.equal(workspaceRoles.get('workspace_developer').allowed_actions.includes('function.deploy'), true);
  assert.equal(workspaceRoles.get('workspace_developer').allowed_actions.includes('app.redirect_uris.manage'), true);
  assert.equal(workspaceRoles.get('workspace_developer').denied_actions.includes('workspace.members.manage'), true);
  assert.equal(workspaceRoles.get('workspace_operator').allowed_actions.includes('service_account.rotate'), true);

  assert.equal(tenantRoles.get('tenant_admin').allowed_actions.includes('database.admin'), true);
  assert.equal(tenantRoles.get('tenant_admin').allowed_actions.includes('app.credentials.rotate'), true);
  assert.equal(tenantRoles.get('tenant_operator').denied_actions.includes('database.admin'), true);
  assert.equal(tenantRoles.get('tenant_operator').allowed_actions.includes('service_account.read'), true);
  assert.equal(tenantRoles.get('auditor').allowed_actions.includes('tenant.audit.read'), true);
  assert.equal(tenantRoles.get('auditor').allowed_actions.includes('service_account.read'), true);
  assert.equal(tenantRoles.get('auditor').denied_actions.includes('bucket.write'), true);
});
