import test from 'node:test';
import assert from 'node:assert/strict';

import {
  listControlPlaneRoutes,
  publicApiFamilies,
  summarizePublicApiFamilies
} from '../../apps/control-plane/src/public-api-catalog.mjs';
import {
  buildConsoleRouteSections,
  filterConsoleApiRoutes
} from '../../apps/web-console/src/public-api-catalog.mjs';

test('control-plane and console route-catalog helpers expose the same generated family inventory', () => {
  const controlPlanePostgresRoutes = listControlPlaneRoutes({ family: 'postgres' });
  const controlPlaneIamRoutes = listControlPlaneRoutes({ family: 'iam' });
  const consoleWorkspaceRoutes = filterConsoleApiRoutes({ family: 'workspaces' });
  const familySummary = summarizePublicApiFamilies();
  const consoleSections = buildConsoleRouteSections();

  assert.equal(publicApiFamilies.length, 12);
  assert.equal(controlPlanePostgresRoutes.length, 2);
  assert.equal(controlPlanePostgresRoutes.every((route) => route.family === 'postgres'), true);
  assert.equal(controlPlaneIamRoutes.length >= 20, true);

  assert.ok(consoleWorkspaceRoutes.some((route) => route.path === '/v1/workspaces/{workspaceId}'));
  assert.ok(consoleWorkspaceRoutes.some((route) => route.path === '/v1/workspaces/{workspaceId}/applications/{applicationId}'));
  assert.ok(consoleSections.some((section) => section.id === 'websockets'));
  assert.ok(consoleSections.some((section) => section.id === 'metrics'));
  assert.ok(consoleSections.some((section) => section.id === 'iam'));
  assert.ok(controlPlaneIamRoutes.some((route) => route.path === '/v1/iam/realms/{realmId}/users/{iamUserId}/credential-resets'));

  const catalogSection = consoleSections.find((section) => section.id === 'platform');
  assert.ok(catalogSection.routes.some((route) => route.path === '/v1/platform/route-catalog'));

  const platformFamily = familySummary.find((entry) => entry.id === 'platform');
  assert.ok(platformFamily);
  assert.ok(platformFamily.routeCount >= 5);
});
