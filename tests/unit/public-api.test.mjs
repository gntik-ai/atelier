import test from 'node:test';
import assert from 'node:assert/strict';

import { OPENAPI_PATH, readJson } from '../../scripts/lib/quality-gates.mjs';
import {
  buildRouteCatalog,
  collectPublicApiViolations,
  listFamilyDocumentPaths,
  readGatewayRouting,
  readPublicApiTaxonomy,
  readPublicRouteCatalog
} from '../../scripts/lib/public-api.mjs';

test('public API taxonomy, gateway routing, and generated route catalog remain aligned', () => {
  const document = readJson(OPENAPI_PATH);
  const taxonomy = readPublicApiTaxonomy();
  const routeCatalog = readPublicRouteCatalog();
  const regeneratedCatalog = buildRouteCatalog(document, taxonomy);
  const violations = collectPublicApiViolations({
    document,
    taxonomy,
    routeCatalog,
    gatewayRouting: readGatewayRouting()
  });

  assert.equal(taxonomy.release.path_version, 'v1');
  assert.equal(taxonomy.release.header_version, '2026-03-26');
  assert.equal(taxonomy.release.openapi_semver, '1.21.0');
  assert.equal(listFamilyDocumentPaths().length, taxonomy.families.length);
  assert.deepEqual(routeCatalog.routes, regeneratedCatalog.routes);
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/events/topics'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/events/topics/{resourceId}'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/events/topics/{resourceId}/access'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/events/workspaces/{workspaceId}/inventory'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/events/topics/{resourceId}/publish'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/events/topics/{resourceId}/stream'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/events/topics/{resourceId}/metadata'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/events/workspaces/{workspaceId}/bridges'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/events/workspaces/{workspaceId}/bridges/{bridgeId}'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/functions/actions/{resourceId}/kafka-triggers'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/functions/actions/{resourceId}/kafka-triggers/{triggerId}'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/metrics/workspaces/{workspaceId}/gateway-streams'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/metrics/workspaces/{workspaceId}/kafka-topics'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/metrics/workspaces/{workspaceId}/event-dashboards'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/iam/realms/{realmId}/users/{iamUserId}/credential-resets'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/auth/login-sessions'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/auth/signups'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/auth/password-recovery-requests'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/postgres/roles'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/postgres/users/{postgresUserName}'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/postgres/databases/{databaseName}/schemas/{schemaName}'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/postgres/databases/{databaseName}/schemas/{schemaName}/tables/{tableName}/security'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/postgres/databases/{databaseName}/schemas/{schemaName}/tables/{tableName}/policies'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/postgres/workspaces/{workspaceId}/grants'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/postgres/databases/{databaseName}/extensions'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/postgres/workspaces/{workspaceId}/templates'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/postgres/workspaces/{workspaceId}/inventory'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/rows'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/rows/by-primary-key'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/bulk/insert'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/imports'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/credentials'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/saved-queries/{savedQueryId}/execute'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/published/{endpointSlug}'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/documents'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/documents/{documentId}'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/bulk/write'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/aggregations'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/imports'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/exports'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/mongo/workspaces/{workspaceId}/data/{databaseName}/transactions'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/change-streams'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/tenants/{tenantId}/invitations/{invitationId}/acceptance'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/tenants/{tenantId}/ownership-transfers'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/tenants/{tenantId}/permission-recalculations/{permissionRecalculationId}'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/workspaces/{workspaceId}/permission-recalculations/{permissionRecalculationId}'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}/credential-rotations'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/workspaces/{workspaceId}/clone'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/workspaces/{workspaceId}/api-surface'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/workspaces'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/workspaces/{workspaceId}/applications/templates'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/workspaces/{workspaceId}/applications/{applicationId}/federation/providers'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/workspaces/{workspaceId}/applications/{applicationId}/federation/providers/{providerId}'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/tenants'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/tenants/{tenantId}/dashboard'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/tenants/{tenantId}/inventory'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/tenants/{tenantId}/exports'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/tenants/{tenantId}/reactivation'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/tenants/{tenantId}/purge'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/tenants/{tenantId}/iam-access'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/iam/tenants/{tenantId}/activity'));
  assert.ok(routeCatalog.routes.some((route) => route.path === '/v1/iam/workspaces/{workspaceId}/activity'));
  assert.ok(routeCatalog.routes.every((route) => typeof route.gatewayQosProfile === 'string'));
  assert.ok(routeCatalog.routes.every((route) => typeof route.gatewayRequestValidationProfile === 'string'));
  assert.ok(routeCatalog.routes.every((route) => route.errorEnvelope === 'ErrorResponse'));
  assert.deepEqual(violations, []);
});
