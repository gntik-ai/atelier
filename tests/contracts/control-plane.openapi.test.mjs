import test from 'node:test';
import assert from 'node:assert/strict';

import SwaggerParser from '@apidevtools/swagger-parser';
import { OPENAPI_PATH, collectContractViolations, resolveParameters } from '../../scripts/lib/quality-gates.mjs';

test('control-plane OpenAPI document remains structurally valid', async () => {
  const document = await SwaggerParser.validate(OPENAPI_PATH);

  assert.equal(document.openapi, '3.1.0');
  assert.ok(document.paths['/health']);
  assert.ok(document.paths['/v1/platform/users/{userId}']);
  assert.ok(document.paths['/v1/platform/route-catalog']);
  assert.ok(document.paths['/v1/tenants/{tenantId}']);
  assert.ok(document.paths['/v1/workspaces/{workspaceId}']);
  assert.ok(document.paths['/v1/workspaces/{workspaceId}/applications/{applicationId}']);
  assert.ok(document.paths['/v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}']);
  assert.ok(document.paths['/v1/workspaces/{workspaceId}/managed-resources/{resourceId}']);
  assert.ok(document.paths['/v1/auth/access-checks']);
  assert.ok(document.paths['/v1/platform/plans/{planId}']);
  assert.ok(document.paths['/v1/platform/plans/{planId}/quota-policies/{quotaPolicyId}']);
  assert.ok(document.paths['/v1/platform/deployment-profiles/{deploymentProfileId}']);
  assert.ok(document.paths['/v1/platform/provider-capabilities/{providerCapabilityId}']);
  assert.ok(document.paths['/v1/tenants/{tenantId}/effective-capabilities']);
  assert.ok(document.paths['/v1/workspaces/{workspaceId}/effective-capabilities']);
  assert.ok(document.paths['/v1/postgres/instances/{resourceId}']);
  assert.ok(document.paths['/v1/mongo/databases/{resourceId}']);
  assert.ok(document.paths['/v1/events/topics/{resourceId}']);
  assert.ok(document.paths['/v1/functions/actions/{resourceId}']);
  assert.ok(document.paths['/v1/storage/buckets/{resourceId}']);
  assert.ok(document.paths['/v1/metrics/workspaces/{workspaceId}/series']);
  assert.ok(document.paths['/v1/websockets/sessions/{sessionId}']);
  assert.ok(document.components.securitySchemes.bearerAuth);
  assert.ok(document.components.schemas.RouteCatalogResponse);
});

test('control-plane contract enforces versioning, authorization, family metadata, idempotent mutation expectations, and gateway hardening responses', async () => {
  const document = await SwaggerParser.validate(OPENAPI_PATH);
  const accessCheck = document.paths['/v1/auth/access-checks'].post;
  const createManagedResource = document.paths['/v1/workspaces/{workspaceId}/managed-resources'].post;
  const getWorkspaceCapabilities = document.paths['/v1/workspaces/{workspaceId}/effective-capabilities'].get;
  const createInvitation = document.paths['/v1/tenants/{tenantId}/invitations'].post;
  const getRouteCatalog = document.paths['/v1/platform/route-catalog'].get;
  const createPostgres = document.paths['/v1/postgres/instances'].post;
  const createWebSocketSession = document.paths['/v1/websockets/sessions'].post;

  assert.deepEqual(collectContractViolations(document), []);
  assert.equal(document.info.version, '1.1.0');
  assert.equal(document.components.parameters.XApiVersion.schema.const, '2026-03-24');
  assert.deepEqual(document.components.schemas.ErrorResponse.required, [
    'status',
    'code',
    'message',
    'detail',
    'requestId',
    'correlationId',
    'timestamp',
    'resource'
  ]);

  const accessCheckParameters = resolveParameters(document, accessCheck);
  const managedResourceParameters = resolveParameters(document, createManagedResource);
  const workspaceCapabilitiesParameters = resolveParameters(document, getWorkspaceCapabilities);
  const invitationParameters = resolveParameters(document, createInvitation);
  const routeCatalogParameters = resolveParameters(document, getRouteCatalog);
  const postgresParameters = resolveParameters(document, createPostgres);
  const websocketParameters = resolveParameters(document, createWebSocketSession);

  assert.equal(accessCheck['x-family'], 'auth');
  assert.equal(accessCheck.security?.[0]?.bearerAuth?.length ?? 0, 0);
  assert.equal(accessCheckParameters.some((parameter) => parameter.name === 'Idempotency-Key'), true);
  assert.ok(accessCheck.responses['403']);
  assert.ok(accessCheck.responses['200']);
  assert.ok(accessCheck.responses['413']);
  assert.ok(accessCheck.responses['429']);
  assert.ok(accessCheck.responses['431']);
  assert.ok(accessCheck.responses['504']);

  assert.equal(createManagedResource['x-family'], 'workspaces');
  assert.equal(managedResourceParameters.some((parameter) => parameter.name === 'X-API-Version'), true);
  assert.equal(managedResourceParameters.some((parameter) => parameter.name === 'X-Correlation-Id'), true);
  assert.equal(managedResourceParameters.some((parameter) => parameter.name === 'Idempotency-Key'), true);
  assert.ok(createManagedResource.responses['202']);
  assert.ok(createManagedResource.responses['403']);
  assert.ok(createManagedResource.responses['413']);
  assert.ok(createManagedResource.responses['429']);
  assert.ok(createManagedResource.responses['431']);
  assert.ok(createManagedResource.responses['504']);

  assert.equal(getWorkspaceCapabilities['x-family'], 'workspaces');
  assert.equal(workspaceCapabilitiesParameters.some((parameter) => parameter.name === 'workspaceId'), true);
  assert.ok(getWorkspaceCapabilities.responses['200']);
  assert.ok(document.components.schemas.EffectiveCapabilityResolution);

  assert.equal(createInvitation['x-family'], 'tenants');
  assert.equal(invitationParameters.some((parameter) => parameter.name === 'X-API-Version'), true);
  assert.equal(invitationParameters.some((parameter) => parameter.name === 'X-Correlation-Id'), true);
  assert.equal(invitationParameters.some((parameter) => parameter.name === 'Idempotency-Key'), true);
  assert.ok(document.components.schemas.Invitation);
  assert.ok(document.components.schemas.CommercialPlan);
  assert.ok(document.components.schemas.ProviderCapabilityRecord);

  assert.equal(getRouteCatalog['x-family'], 'platform');
  assert.equal(routeCatalogParameters.some((parameter) => parameter.name === 'family'), true);
  assert.equal(routeCatalogParameters.some((parameter) => parameter.name === 'scope'), true);
  assert.ok(getRouteCatalog.responses['200']);
  assert.ok(getRouteCatalog.responses['429']);
  assert.ok(getRouteCatalog.responses['431']);
  assert.ok(getRouteCatalog.responses['504']);
  assert.ok(document.components.schemas.RouteCatalogEntry.properties.gatewayQosProfile);
  assert.ok(document.components.schemas.RouteCatalogEntry.properties.gatewayRequestValidationProfile);

  assert.equal(createPostgres['x-family'], 'postgres');
  assert.equal(postgresParameters.some((parameter) => parameter.name === 'Idempotency-Key'), true);
  assert.ok(document.components.schemas.PostgresInstance);

  assert.equal(createWebSocketSession['x-family'], 'websockets');
  assert.equal(websocketParameters.some((parameter) => parameter.name === 'Idempotency-Key'), true);
  assert.ok(document.components.schemas.WebSocketSession);
});
