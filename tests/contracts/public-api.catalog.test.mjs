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
  const controlPlaneAuthRoutes = listControlPlaneRoutes({ family: 'auth' });
  const consoleWorkspaceRoutes = filterConsoleApiRoutes({ family: 'workspaces' });
  const familySummary = summarizePublicApiFamilies();
  const consoleSections = buildConsoleRouteSections();

  assert.equal(publicApiFamilies.length, 12);
  assert.equal(controlPlanePostgresRoutes.length >= 20, true);
  assert.equal(controlPlanePostgresRoutes.every((route) => route.family === 'postgres'), true);
  assert.equal(controlPlaneIamRoutes.length >= 20, true);

  assert.ok(consoleWorkspaceRoutes.some((route) => route.path === '/v1/workspaces'));
  assert.ok(consoleWorkspaceRoutes.some((route) => route.path === '/v1/workspaces/{workspaceId}'));
  assert.ok(consoleWorkspaceRoutes.some((route) => route.path === '/v1/workspaces/{workspaceId}/clone'));
  assert.ok(consoleWorkspaceRoutes.some((route) => route.path === '/v1/workspaces/{workspaceId}/api-surface'));
  assert.ok(consoleWorkspaceRoutes.some((route) => route.path === '/v1/workspaces/{workspaceId}/applications/{applicationId}'));
  assert.ok(consoleSections.some((section) => section.id === 'websockets'));
  assert.ok(consoleSections.some((section) => section.id === 'metrics'));
  assert.ok(consoleSections.some((section) => section.id === 'iam'));
  assert.ok(consoleSections.some((section) => section.id === 'auth'));
  assert.ok(controlPlaneIamRoutes.some((route) => route.path === '/v1/iam/realms/{realmId}/users/{iamUserId}/credential-resets'));
  assert.ok(controlPlaneIamRoutes.some((route) => route.path === '/v1/iam/tenants/{tenantId}/activity'));
  assert.ok(controlPlaneIamRoutes.some((route) => route.path === '/v1/iam/workspaces/{workspaceId}/activity'));
  assert.ok(controlPlanePostgresRoutes.some((route) => route.path === '/v1/postgres/roles'));
  assert.ok(controlPlanePostgresRoutes.some((route) => route.path === '/v1/postgres/users'));
  assert.ok(controlPlanePostgresRoutes.some((route) => route.path === '/v1/postgres/databases/{databaseName}/schemas/{schemaName}'));
  assert.ok(controlPlanePostgresRoutes.some((route) => route.path === '/v1/postgres/databases/{databaseName}/schemas/{schemaName}/tables'));
  assert.ok(controlPlanePostgresRoutes.some((route) => route.path === '/v1/postgres/databases/{databaseName}/schemas/{schemaName}/tables/{tableName}/columns'));
  assert.ok(controlPlanePostgresRoutes.some((route) => route.path === '/v1/postgres/workspaces/{workspaceId}/types'));
  assert.ok(controlPlanePostgresRoutes.some((route) => route.path === '/v1/postgres/workspaces/{workspaceId}/inventory'));
  assert.ok(controlPlaneAuthRoutes.some((route) => route.path === '/v1/auth/login-sessions'));
  assert.ok(controlPlaneAuthRoutes.some((route) => route.path === '/v1/auth/signups'));
  assert.ok(controlPlaneAuthRoutes.some((route) => route.path === '/v1/auth/password-recovery-requests'));
  assert.ok(listControlPlaneRoutes({ family: 'tenants' }).some((route) => route.path === '/v1/tenants/{tenantId}/iam-access'));

  const catalogSection = consoleSections.find((section) => section.id === 'platform');
  assert.ok(catalogSection.routes.some((route) => route.path === '/v1/platform/route-catalog'));

  const platformFamily = familySummary.find((entry) => entry.id === 'platform');
  assert.ok(platformFamily);
  assert.ok(platformFamily.routeCount >= 5);
});
