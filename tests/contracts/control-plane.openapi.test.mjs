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
  assert.ok(document.paths['/v1/tenants/{tenantId}/iam-access']);
  assert.ok(document.paths['/v1/workspaces/{workspaceId}']);
  assert.ok(document.paths['/v1/workspaces/{workspaceId}/applications/{applicationId}']);
  assert.ok(document.paths['/v1/workspaces/{workspaceId}/applications/templates']);
  assert.ok(document.paths['/v1/workspaces/{workspaceId}/applications/{applicationId}/federation/providers']);
  assert.ok(document.paths['/v1/workspaces/{workspaceId}/applications/{applicationId}/federation/providers/{providerId}']);
  assert.ok(document.paths['/v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}']);
  assert.ok(document.paths['/v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}/credential-issuance']);
  assert.ok(document.paths['/v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}/credential-rotations']);
  assert.ok(document.paths['/v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}/credential-revocations']);
  assert.ok(document.paths['/v1/workspaces/{workspaceId}/managed-resources/{resourceId}']);
  assert.ok(document.paths['/v1/auth/access-checks']);
  assert.ok(document.paths['/v1/auth/login-sessions']);
  assert.ok(document.paths['/v1/auth/login-sessions/{sessionId}']);
  assert.ok(document.paths['/v1/auth/login-sessions/{sessionId}/refresh']);
  assert.ok(document.paths['/v1/auth/signups']);
  assert.ok(document.paths['/v1/auth/signups/policy']);
  assert.ok(document.paths['/v1/auth/signups/{registrationId}']);
  assert.ok(document.paths['/v1/auth/signups/{registrationId}/activation-decisions']);
  assert.ok(document.paths['/v1/auth/password-recovery-requests']);
  assert.ok(document.paths['/v1/auth/password-recovery-requests/{recoveryRequestId}/confirmations']);
  assert.ok(document.paths['/v1/auth/status-views/{statusViewId}']);
  assert.ok(document.paths['/v1/iam/realms']);
  assert.ok(document.paths['/v1/iam/realms/{realmId}']);
  assert.ok(document.paths['/v1/iam/realms/{realmId}/clients/{clientId}']);
  assert.ok(document.paths['/v1/iam/realms/{realmId}/roles/{roleName}']);
  assert.ok(document.paths['/v1/iam/realms/{realmId}/scopes/{scopeName}']);
  assert.ok(document.paths['/v1/iam/realms/{realmId}/users/{iamUserId}']);
  assert.ok(document.paths['/v1/iam/realms/{realmId}/users/{iamUserId}/credential-resets']);
  assert.ok(document.paths['/v1/iam/tenants/{tenantId}/activity']);
  assert.ok(document.paths['/v1/iam/workspaces/{workspaceId}/activity']);
  assert.ok(document.paths['/v1/platform/plans/{planId}']);
  assert.ok(document.paths['/v1/platform/plans/{planId}/quota-policies/{quotaPolicyId}']);
  assert.ok(document.paths['/v1/platform/deployment-profiles/{deploymentProfileId}']);
  assert.ok(document.paths['/v1/platform/provider-capabilities/{providerCapabilityId}']);
  assert.ok(document.paths['/v1/tenants/{tenantId}/effective-capabilities']);
  assert.ok(document.paths['/v1/tenants/{tenantId}/invitations/{invitationId}/acceptance']);
  assert.ok(document.paths['/v1/tenants/{tenantId}/invitations/{invitationId}/revocation']);
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
  const createConsoleLoginSession = document.paths['/v1/auth/login-sessions'].post;
  const refreshConsoleLoginSession = document.paths['/v1/auth/login-sessions/{sessionId}/refresh'].post;
  const terminateConsoleLoginSession = document.paths['/v1/auth/login-sessions/{sessionId}'].delete;
  const createConsoleSignup = document.paths['/v1/auth/signups'].post;
  const getConsoleSignupPolicy = document.paths['/v1/auth/signups/policy'].get;
  const decideConsoleSignupActivation = document.paths['/v1/auth/signups/{registrationId}/activation-decisions'].post;
  const createPasswordRecoveryRequest = document.paths['/v1/auth/password-recovery-requests'].post;
  const confirmPasswordRecovery = document.paths['/v1/auth/password-recovery-requests/{recoveryRequestId}/confirmations'].post;
  const getConsoleAccountStatusView = document.paths['/v1/auth/status-views/{statusViewId}'].get;
  const createManagedResource = document.paths['/v1/workspaces/{workspaceId}/managed-resources'].post;
  const createIamRealm = document.paths['/v1/iam/realms'].post;
  const listIamClients = document.paths['/v1/iam/realms/{realmId}/clients'].get;
  const resetIamUserCredentials = document.paths['/v1/iam/realms/{realmId}/users/{iamUserId}/credential-resets'].post;
  const listTenantIamActivity = document.paths['/v1/iam/tenants/{tenantId}/activity'].get;
  const listWorkspaceIamActivity = document.paths['/v1/iam/workspaces/{workspaceId}/activity'].get;
  const setTenantIamAccess = document.paths['/v1/tenants/{tenantId}/iam-access'].patch;
  const getWorkspaceCapabilities = document.paths['/v1/workspaces/{workspaceId}/effective-capabilities'].get;
  const createInvitation = document.paths['/v1/tenants/{tenantId}/invitations'].post;
  const acceptInvitation = document.paths['/v1/tenants/{tenantId}/invitations/{invitationId}/acceptance'].post;
  const revokeInvitation = document.paths['/v1/tenants/{tenantId}/invitations/{invitationId}/revocation'].post;
  const issueServiceAccountCredential = document.paths['/v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}/credential-issuance'].post;
  const rotateServiceAccountCredential = document.paths['/v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}/credential-rotations'].post;
  const revokeServiceAccountCredential = document.paths['/v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}/credential-revocations'].post;
  const listExternalApplicationTemplates = document.paths['/v1/workspaces/{workspaceId}/applications/templates'].get;
  const listFederatedProviders = document.paths['/v1/workspaces/{workspaceId}/applications/{applicationId}/federation/providers'].get;
  const createFederatedProvider = document.paths['/v1/workspaces/{workspaceId}/applications/{applicationId}/federation/providers'].post;
  const updateExternalApplication = document.paths['/v1/workspaces/{workspaceId}/applications/{applicationId}'].put;
  const getRouteCatalog = document.paths['/v1/platform/route-catalog'].get;
  const createPostgres = document.paths['/v1/postgres/instances'].post;
  const publishEvent = document.paths['/v1/events/topics/{resourceId}/publish'].post;
  const streamTopicEvents = document.paths['/v1/events/topics/{resourceId}/stream'].get;
  const getGatewayStreamMetrics = document.paths['/v1/metrics/workspaces/{workspaceId}/gateway-streams'].get;
  const createWebSocketSession = document.paths['/v1/websockets/sessions'].post;

  assert.deepEqual(collectContractViolations(document), []);
  assert.equal(document.info.version, '1.8.0');
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
  const createConsoleLoginSessionParameters = resolveParameters(document, createConsoleLoginSession);
  const refreshConsoleLoginSessionParameters = resolveParameters(document, refreshConsoleLoginSession);
  const terminateConsoleLoginSessionParameters = resolveParameters(document, terminateConsoleLoginSession);
  const createConsoleSignupParameters = resolveParameters(document, createConsoleSignup);
  const getConsoleSignupPolicyParameters = resolveParameters(document, getConsoleSignupPolicy);
  const decideConsoleSignupActivationParameters = resolveParameters(document, decideConsoleSignupActivation);
  const createPasswordRecoveryRequestParameters = resolveParameters(document, createPasswordRecoveryRequest);
  const confirmPasswordRecoveryParameters = resolveParameters(document, confirmPasswordRecovery);
  const getConsoleAccountStatusViewParameters = resolveParameters(document, getConsoleAccountStatusView);
  const managedResourceParameters = resolveParameters(document, createManagedResource);
  const iamRealmParameters = resolveParameters(document, createIamRealm);
  const iamClientListParameters = resolveParameters(document, listIamClients);
  const iamCredentialResetParameters = resolveParameters(document, resetIamUserCredentials);
  const tenantIamActivityParameters = resolveParameters(document, listTenantIamActivity);
  const workspaceIamActivityParameters = resolveParameters(document, listWorkspaceIamActivity);
  const tenantIamAccessParameters = resolveParameters(document, setTenantIamAccess);
  const workspaceCapabilitiesParameters = resolveParameters(document, getWorkspaceCapabilities);
  const invitationParameters = resolveParameters(document, createInvitation);
  const invitationAcceptanceParameters = resolveParameters(document, acceptInvitation);
  const invitationRevocationParameters = resolveParameters(document, revokeInvitation);
  const serviceAccountCredentialIssuanceParameters = resolveParameters(document, issueServiceAccountCredential);
  const serviceAccountCredentialRotationParameters = resolveParameters(document, rotateServiceAccountCredential);
  const serviceAccountCredentialRevocationParameters = resolveParameters(document, revokeServiceAccountCredential);
  const applicationTemplateParameters = resolveParameters(document, listExternalApplicationTemplates);
  const federatedProviderListParameters = resolveParameters(document, listFederatedProviders);
  const federatedProviderCreateParameters = resolveParameters(document, createFederatedProvider);
  const externalApplicationUpdateParameters = resolveParameters(document, updateExternalApplication);
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

  assert.equal(createConsoleLoginSession['x-family'], 'auth');
  assert.equal(createConsoleLoginSessionParameters.some((parameter) => parameter.name === 'Idempotency-Key'), true);
  assert.ok(createConsoleLoginSession.responses['200']);
  assert.ok(createConsoleLoginSession.responses['409']);
  assert.ok(document.components.schemas.ConsoleLoginRequest);
  assert.ok(document.components.schemas.ConsoleLoginSession);
  assert.ok(document.components.schemas.ConsoleTokenSet);
  assert.ok(document.components.schemas.ConsoleAuthenticationState);

  assert.equal(refreshConsoleLoginSession['x-family'], 'auth');
  assert.equal(refreshConsoleLoginSessionParameters.some((parameter) => parameter.name === 'sessionId'), true);
  assert.ok(refreshConsoleLoginSession.responses['200']);
  assert.ok(document.components.schemas.ConsoleTokenRefreshRequest);

  assert.equal(terminateConsoleLoginSession['x-family'], 'auth');
  assert.equal(terminateConsoleLoginSession.security?.[0]?.bearerAuth?.length ?? 0, 0);
  assert.equal(terminateConsoleLoginSessionParameters.some((parameter) => parameter.name === 'sessionId'), true);
  assert.ok(terminateConsoleLoginSession.responses['202']);
  assert.ok(document.components.schemas.ConsoleSessionTerminationAccepted);

  assert.equal(createConsoleSignup['x-family'], 'auth');
  assert.equal(createConsoleSignupParameters.some((parameter) => parameter.name === 'Idempotency-Key'), true);
  assert.ok(createConsoleSignup.responses['202']);
  assert.ok(createConsoleSignup.responses['409']);
  assert.ok(document.components.schemas.ConsoleSignupRequest);
  assert.ok(document.components.schemas.ConsoleSignupRegistration);
  assert.ok(document.components.schemas.ConsoleSignupState);

  assert.equal(getConsoleSignupPolicy['x-family'], 'auth');
  assert.equal(getConsoleSignupPolicyParameters.some((parameter) => parameter.name === 'X-API-Version'), true);
  assert.ok(getConsoleSignupPolicy.responses['200']);
  assert.ok(document.components.schemas.ConsoleSignupPolicy);
  assert.ok(document.components.schemas.SignupPolicyMode);

  assert.equal(decideConsoleSignupActivation['x-family'], 'auth');
  assert.equal(decideConsoleSignupActivation.security?.[0]?.bearerAuth?.length ?? 0, 0);
  assert.equal(decideConsoleSignupActivationParameters.some((parameter) => parameter.name === 'registrationId'), true);
  assert.ok(decideConsoleSignupActivation.responses['202']);
  assert.ok(document.components.schemas.ConsoleSignupActivationDecisionRequest);
  assert.ok(document.components.schemas.ConsoleSignupActivationDecision);
  assert.ok(document.components.schemas.ProvisioningSummary);
  assert.ok(document.components.schemas.ProvisioningResourceState);
  assert.ok(document.components.schemas.ProvisioningRetryHint);
  assert.ok(document.components.schemas.ProvisioningOwnerBinding);

  assert.equal(createPasswordRecoveryRequest['x-family'], 'auth');
  assert.equal(createPasswordRecoveryRequestParameters.some((parameter) => parameter.name === 'Idempotency-Key'), true);
  assert.ok(createPasswordRecoveryRequest.responses['202']);
  assert.ok(document.components.schemas.PasswordRecoveryRequest);
  assert.ok(document.components.schemas.PasswordRecoveryTicket);
  assert.ok(document.components.schemas.PasswordRecoveryStatus);

  assert.equal(confirmPasswordRecovery['x-family'], 'auth');
  assert.equal(confirmPasswordRecoveryParameters.some((parameter) => parameter.name === 'recoveryRequestId'), true);
  assert.ok(confirmPasswordRecovery.responses['200']);
  assert.ok(document.components.schemas.PasswordResetConfirmationRequest);
  assert.ok(document.components.schemas.PasswordResetConfirmation);

  assert.equal(getConsoleAccountStatusView['x-family'], 'auth');
  assert.equal(getConsoleAccountStatusViewParameters.some((parameter) => parameter.name === 'statusViewId'), true);
  assert.ok(getConsoleAccountStatusView.responses['200']);
  assert.ok(document.components.schemas.ConsoleStatusViewId);
  assert.ok(document.components.schemas.ConsoleAccountStatusView);
  assert.ok(document.components.schemas.ConsoleActionLink);

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
  assert.ok(document.components.schemas.IamLifecycleEvent);
  assert.ok(document.components.schemas.IamLifecycleEventCollectionResponse);

  assert.equal(getWorkspaceCapabilities['x-family'], 'workspaces');
  assert.equal(workspaceCapabilitiesParameters.some((parameter) => parameter.name === 'workspaceId'), true);
  assert.ok(getWorkspaceCapabilities.responses['200']);
  assert.ok(document.components.schemas.EffectiveCapabilityResolution);

  assert.equal(listTenantIamActivity['x-family'], 'iam');
  assert.equal(tenantIamActivityParameters.some((parameter) => parameter.name === 'tenantId'), true);
  assert.equal(tenantIamActivityParameters.some((parameter) => parameter.name === 'filter[eventType]'), true);
  assert.ok(listTenantIamActivity.responses['200']);

  assert.equal(listWorkspaceIamActivity['x-family'], 'iam');
  assert.equal(workspaceIamActivityParameters.some((parameter) => parameter.name === 'workspaceId'), true);
  assert.equal(workspaceIamActivityParameters.some((parameter) => parameter.name === 'window[start]'), true);
  assert.ok(listWorkspaceIamActivity.responses['200']);

  assert.equal(setTenantIamAccess['x-family'], 'tenants');
  assert.equal(tenantIamAccessParameters.some((parameter) => parameter.name === 'tenantId'), true);
  assert.equal(tenantIamAccessParameters.some((parameter) => parameter.name === 'Idempotency-Key'), true);
  assert.ok(setTenantIamAccess.responses['202']);
  assert.ok(document.components.schemas.TenantIamAccessStatusUpdateRequest);
  assert.ok(document.components.schemas.TenantIdentityAccessPolicy);
  assert.ok(document.components.schemas.ServiceAccountAccessProjection);

  assert.equal(createInvitation['x-family'], 'tenants');
  assert.equal(invitationParameters.some((parameter) => parameter.name === 'X-API-Version'), true);
  assert.equal(invitationParameters.some((parameter) => parameter.name === 'X-Correlation-Id'), true);
  assert.equal(invitationParameters.some((parameter) => parameter.name === 'Idempotency-Key'), true);
  assert.equal(acceptInvitation['x-family'], 'tenants');
  assert.equal(invitationAcceptanceParameters.some((parameter) => parameter.name === 'invitationId'), true);
  assert.ok(acceptInvitation.responses['202']);
  assert.equal(revokeInvitation['x-family'], 'tenants');
  assert.equal(invitationRevocationParameters.some((parameter) => parameter.name === 'invitationId'), true);
  assert.ok(revokeInvitation.responses['202']);
  assert.equal(issueServiceAccountCredential['x-family'], 'workspaces');
  assert.equal(serviceAccountCredentialIssuanceParameters.some((parameter) => parameter.name === 'serviceAccountId'), true);
  assert.ok(issueServiceAccountCredential.responses['202']);
  assert.equal(rotateServiceAccountCredential['x-family'], 'workspaces');
  assert.equal(serviceAccountCredentialRotationParameters.some((parameter) => parameter.name === 'serviceAccountId'), true);
  assert.ok(rotateServiceAccountCredential.responses['202']);
  assert.equal(revokeServiceAccountCredential['x-family'], 'workspaces');
  assert.equal(serviceAccountCredentialRevocationParameters.some((parameter) => parameter.name === 'serviceAccountId'), true);
  assert.ok(revokeServiceAccountCredential.responses['202']);
  assert.equal(listExternalApplicationTemplates['x-family'], 'workspaces');
  assert.equal(applicationTemplateParameters.some((parameter) => parameter.name === 'planId'), true);
  assert.ok(listExternalApplicationTemplates.responses['200']);
  assert.equal(listFederatedProviders['x-family'], 'workspaces');
  assert.equal(federatedProviderListParameters.some((parameter) => parameter.name === 'applicationId'), true);
  assert.equal(createFederatedProvider['x-rate-limit-class'], 'control-write');
  assert.equal(federatedProviderCreateParameters.some((parameter) => parameter.name === 'Idempotency-Key'), true);
  assert.equal(updateExternalApplication['x-family'], 'workspaces');
  assert.equal(externalApplicationUpdateParameters.some((parameter) => parameter.name === 'applicationId'), true);
  assert.ok(updateExternalApplication.responses['202']);
  assert.ok(document.components.schemas.Invitation);
  assert.ok(document.components.schemas.InvitationAcceptanceRequest);
  assert.ok(document.components.schemas.InvitationRevocationRequest);
  assert.ok(document.components.schemas.ExpirationRule);
  assert.ok(document.components.schemas.CommercialPlan);
  assert.ok(document.components.schemas.ProviderCapabilityRecord);
  assert.ok(document.components.schemas.TenantIdentityContext);
  assert.ok(document.components.schemas.WorkspaceIamBoundary);
  assert.ok(document.components.schemas.ExternalApplicationIamClient);
  assert.ok(document.components.schemas.ExternalApplicationAuthenticationFlow);
  assert.ok(document.components.schemas.ExternalApplicationStarterTemplate);
  assert.ok(document.components.schemas.ExternalApplicationPlanLimit);
  assert.ok(document.components.schemas.FederatedIdentityProvider);
  assert.ok(document.components.schemas.ExternalApplicationValidationSummary);
  assert.ok(document.components.schemas.ServiceAccountIamBinding);
  assert.ok(document.components.schemas.ServiceAccountCredentialPolicy);
  assert.ok(document.components.schemas.ServiceAccountCredentialReference);
  assert.ok(document.components.schemas.ConsoleSessionExpirationPolicy);
  assert.ok(document.components.schemas.KeycloakProtocolMapper);
  assert.ok(document.components.schemas.Tenant.properties.identityContext);
  assert.ok(document.components.schemas.ExternalApplication.properties.iamClient);
  assert.ok(document.components.schemas.ExternalApplication.properties.federatedProviders);
  assert.ok(document.components.schemas.ExternalApplication.properties.authenticationFlows);
  assert.ok(document.components.schemas.ServiceAccount.properties.iamBinding);
  assert.ok(document.components.schemas.ServiceAccount.properties.credentialPolicy);
  assert.ok(document.components.schemas.ManagedResource.properties.accessPolicy);
  assert.ok(document.components.schemas.ConsoleSignupRegistration.properties.provisioning);
  assert.ok(document.components.schemas.ConsoleSignupActivationDecision.properties.tenant);
  assert.ok(document.components.schemas.ConsoleSignupActivationDecision.properties.workspace);
  assert.ok(document.components.schemas.ConsoleSignupActivationDecision.properties.tenantOwnerMembership);
  assert.ok(document.components.schemas.ConsoleSignupActivationDecision.properties.workspaceOwnerMembership);
  assert.ok(document.components.schemas.ConsoleSignupActivationDecision.properties.provisioning);
  assert.ok(document.components.schemas.PlatformUser.properties.activationProvisioning);
  assert.ok(document.components.schemas.Tenant.properties.provisioning);
  assert.ok(document.components.schemas.Workspace.properties.provisioning);
  assert.ok(document.components.schemas.ManagedResource.properties.provisioning);
  assert.ok(document.components.schemas.PostgresInstance.properties.provisioning);
  assert.ok(document.components.schemas.MongoDatabase.properties.provisioning);
  assert.ok(document.components.schemas.EventTopic.properties.provisioning);
  assert.ok(document.components.schemas.FunctionAction.properties.provisioning);
  assert.ok(document.components.schemas.StorageBucket.properties.provisioning);

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
