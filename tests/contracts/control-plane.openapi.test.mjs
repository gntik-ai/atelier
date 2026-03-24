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
  assert.ok(document.paths['/v1/iam/realms']);
  assert.ok(document.paths['/v1/iam/realms/{realmId}']);
  assert.ok(document.paths['/v1/iam/realms/{realmId}/clients/{clientId}']);
  assert.ok(document.paths['/v1/iam/realms/{realmId}/roles/{roleName}']);
  assert.ok(document.paths['/v1/iam/realms/{realmId}/scopes/{scopeName}']);
  assert.ok(document.paths['/v1/iam/realms/{realmId}/users/{iamUserId}']);
  assert.ok(document.paths['/v1/iam/realms/{realmId}/users/{iamUserId}/credential-resets']);
  assert.ok(document.paths['/v1/platform/plans/{planId}']);
  assert.ok(document.paths['/v1/platform/plans/{planId}/quota-policies/{quotaPolicyId}']);
  assert.ok(document.paths['/v1/platform/deployment-profiles/{deploymentProfileId}']);
  assert.ok(document.paths['/v1/platform/provider-capabilities/{providerCapabilityId}']);
  assert.ok(document.paths['/v1/tenants/{tenantId}/effective-capabilities']);
  assert.ok(document.paths['/v1/workspaces/{workspaceId}/effective-capabilities']);
  assert.ok(document.paths['/v1/postgres/instances/{resourceId}']);
  assert.ok(document.paths['/v1/mongo/databases/{resourceId}']);
  assert.ok(document.paths['/v1/events/topics/{resourceId}']);
  assert.ok(document.paths['/v1/events/topics/{resourceId}/publish']);
  assert.ok(document.paths['/v1/events/topics/{resourceId}/stream']);
  assert.ok(document.paths['/v1/functions/actions/{resourceId}']);
  assert.ok(document.paths['/v1/storage/buckets/{resourceId}']);
  assert.ok(document.paths['/v1/metrics/workspaces/{workspaceId}/series']);
  assert.ok(document.paths['/v1/metrics/workspaces/{workspaceId}/gateway-streams']);
  assert.ok(document.paths['/v1/websockets/sessions/{sessionId}']);
  assert.ok(document.components.securitySchemes.bearerAuth);
  assert.ok(document.components.schemas.RouteCatalogResponse);
});

test('control-plane contract enforces versioning, authorization, family metadata, idempotent mutation expectations, and gateway hardening responses', async () => {
  const document = await SwaggerParser.validate(OPENAPI_PATH);
  const accessCheck = document.paths['/v1/auth/access-checks'].post;
  const createManagedResource = document.paths['/v1/workspaces/{workspaceId}/managed-resources'].post;
  const createIamRealm = document.paths['/v1/iam/realms'].post;
  const listIamClients = document.paths['/v1/iam/realms/{realmId}/clients'].get;
  const resetIamUserCredentials = document.paths['/v1/iam/realms/{realmId}/users/{iamUserId}/credential-resets'].post;
  const getWorkspaceCapabilities = document.paths['/v1/workspaces/{workspaceId}/effective-capabilities'].get;
  const createInvitation = document.paths['/v1/tenants/{tenantId}/invitations'].post;
  const getRouteCatalog = document.paths['/v1/platform/route-catalog'].get;
  const createPostgres = document.paths['/v1/postgres/instances'].post;
  const publishEvent = document.paths['/v1/events/topics/{resourceId}/publish'].post;
  const streamTopicEvents = document.paths['/v1/events/topics/{resourceId}/stream'].get;
  const getGatewayStreamMetrics = document.paths['/v1/metrics/workspaces/{workspaceId}/gateway-streams'].get;
  const createWebSocketSession = document.paths['/v1/websockets/sessions'].post;

  assert.deepEqual(collectContractViolations(document), []);
  assert.equal(document.info.version, '1.3.0');
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
  const iamRealmParameters = resolveParameters(document, createIamRealm);
  const iamClientListParameters = resolveParameters(document, listIamClients);
  const iamCredentialResetParameters = resolveParameters(document, resetIamUserCredentials);
  const workspaceCapabilitiesParameters = resolveParameters(document, getWorkspaceCapabilities);
  const invitationParameters = resolveParameters(document, createInvitation);
  const routeCatalogParameters = resolveParameters(document, getRouteCatalog);
  const postgresParameters = resolveParameters(document, createPostgres);
  const publishEventParameters = resolveParameters(document, publishEvent);
  const streamTopicParameters = resolveParameters(document, streamTopicEvents);
  const gatewayMetricParameters = resolveParameters(document, getGatewayStreamMetrics);
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

  assert.equal(createIamRealm['x-family'], 'iam');
  assert.equal(iamRealmParameters.some((parameter) => parameter.name === 'Idempotency-Key'), true);
  assert.ok(createIamRealm.responses['202']);
  assert.ok(createIamRealm.responses['409']);
  assert.ok(document.components.schemas.IamRealm);
  assert.ok(document.components.schemas.IamProviderCompatibility);
  assert.ok(document.components.schemas.IamMutationAccepted);

  assert.equal(listIamClients['x-family'], 'iam');
  assert.equal(iamClientListParameters.some((parameter) => parameter.name === 'realmId'), true);
  assert.equal(iamClientListParameters.some((parameter) => parameter.name === 'filter[protocol]'), true);
  assert.ok(document.components.schemas.IamClientCollectionResponse);
  assert.ok(document.components.schemas.IamClientAccessType);

  assert.equal(resetIamUserCredentials['x-family'], 'iam');
  assert.equal(iamCredentialResetParameters.some((parameter) => parameter.name === 'iamUserId'), true);
  assert.equal(iamCredentialResetParameters.some((parameter) => parameter.name === 'Idempotency-Key'), true);
  assert.ok(resetIamUserCredentials.responses['202']);
  assert.ok(resetIamUserCredentials.responses['404']);
  assert.ok(document.components.schemas.IamUser);
  assert.ok(document.components.schemas.IamUserCredentialResetRequest);
  assert.ok(document.components.schemas.IamStatusUpdateRequest);

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
  assert.ok(document.components.schemas.TenantIdentityContext);
  assert.ok(document.components.schemas.WorkspaceIamBoundary);
  assert.ok(document.components.schemas.ExternalApplicationIamClient);
  assert.ok(document.components.schemas.ServiceAccountIamBinding);
  assert.ok(document.components.schemas.KeycloakProtocolMapper);
  assert.ok(document.components.schemas.Tenant.properties.identityContext);
  assert.ok(document.components.schemas.ExternalApplication.properties.iamClient);
  assert.ok(document.components.schemas.ServiceAccount.properties.iamBinding);

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

  assert.equal(publishEvent['x-family'], 'events');
  assert.equal(publishEvent['x-owning-service'], 'event_gateway');
  assert.equal(publishEventParameters.some((parameter) => parameter.name === 'Idempotency-Key'), true);
  assert.ok(publishEvent.responses['202']);
  assert.ok(document.components.schemas.EventPublicationRequest);
  assert.ok(document.components.schemas.EventPublicationAccepted);
  assert.ok(document.components.schemas.EventDeliveryEnvelope);

  assert.equal(streamTopicEvents['x-family'], 'events');
  assert.equal(streamTopicEvents['x-resource-type'], 'event_stream');
  assert.equal(streamTopicParameters.some((parameter) => parameter.name === 'cursor'), true);
  assert.ok(streamTopicEvents.responses['200']);

  assert.equal(getGatewayStreamMetrics['x-family'], 'metrics');
  assert.equal(gatewayMetricParameters.some((parameter) => parameter.name === 'window'), true);
  assert.ok(document.components.schemas.GatewayStreamMetricsResponse);

  assert.equal(createWebSocketSession['x-family'], 'websockets');
  assert.equal(createWebSocketSession['x-owning-service'], 'event_gateway');
  assert.equal(websocketParameters.some((parameter) => parameter.name === 'Idempotency-Key'), true);
  assert.ok(document.components.schemas.WebSocketSession);
  assert.ok(document.components.schemas.EventSubscriptionRequest);
  assert.ok(document.components.schemas.EventBackpressurePolicy);
});
