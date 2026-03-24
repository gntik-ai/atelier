import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getIamCompatibilitySummary,
  getIamAdminRoute,
  iamAdminApiFamily,
  iamAdminRequestContract,
  isKeycloakVersionSupported,
  listIamAdminRoutes,
  summarizeIamAdminSurface
} from '../../apps/control-plane/src/iam-admin.mjs';

test('iam control-plane helpers expose the new family metadata and compatibility summary', () => {
  const summary = getIamCompatibilitySummary();

  assert.equal(iamAdminApiFamily?.id, 'iam');
  assert.equal(iamAdminRequestContract?.version, '2026-03-24');
  assert.equal(summary.provider, 'keycloak');
  assert.deepEqual(summary.supportedVersions.map((entry) => entry.range), ['24.x', '25.x', '26.x']);
  assert.equal(isKeycloakVersionSupported('24.0.0'), true);
  assert.equal(isKeycloakVersionSupported('27.0.0'), false);
});

test('iam route helpers filter the generated route catalog by family and resource type', () => {
  const iamRoutes = listIamAdminRoutes();
  const clientRoutes = listIamAdminRoutes({ resourceType: 'iam_client' });
  const surface = summarizeIamAdminSurface();
  const userSummary = surface.find((entry) => entry.resourceKind === 'user');

  assert.equal(iamRoutes.length >= 20, true);
  assert.equal(clientRoutes.some((route) => route.path === '/v1/iam/realms/{realmId}/clients/{clientId}'), true);
  assert.equal(getIamAdminRoute('resetIamUserCredentials')?.path, '/v1/iam/realms/{realmId}/users/{iamUserId}/credential-resets');
  assert.ok(userSummary);
  assert.equal(userSummary.actions.includes('reset_credentials'), true);
  assert.equal(userSummary.routeCount >= 4, true);
});
