import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectDomainModelViolations,
  readDomainModel,
  readDomainSeedFixtures
} from '../../scripts/lib/domain-model.mjs';
import {
  DOMAIN_MODEL_VERSION,
  evaluatePlanChange,
  getBusinessStateMachine,
  getCommercialPlan,
  getDomainEntity,
  getExternalApplicationPlanLimit,
  getExternalApplicationTemplate,
  getQuotaPolicy,
  summarizeTenantGovernanceDashboard,
  listCommercialPlans,
  listDomainEntities,
  listExternalApplicationSupportedFlows,
  listExternalApplicationTemplates,
  listLifecycleEvents,
  listLifecycleTransitions,
  listPlanChangeScenarios,
  resolveTenantEffectiveCapabilities,
  resolveWorkspaceEffectiveCapabilities
} from '../../services/internal-contracts/src/index.mjs';

test('domain model remains internally consistent', () => {
  const domainModel = readDomainModel();
  const seedFixtures = readDomainSeedFixtures();
  const violations = collectDomainModelViolations(domainModel, seedFixtures);

  assert.deepEqual(violations, []);
  assert.equal(DOMAIN_MODEL_VERSION, '2026-03-24');
  assert.deepEqual(
    listDomainEntities().map((entity) => entity.id),
    [
      'platform_user',
      'tenant',
      'workspace',
      'external_application',
      'service_account',
      'managed_resource',
      'tenant_membership',
      'workspace_membership',
      'invitation',
      'plan',
      'quota_policy',
      'deployment_profile',
      'provider_capability'
    ]
  );
  assert.deepEqual(listLifecycleTransitions().map((transition) => transition.id), ['create', 'activate', 'suspend', 'soft_delete']);
  assert.equal(listLifecycleEvents().length, 52);
});

test('managed resource kinds, governance catalogs, and seed profiles preserve downstream reuse guarantees', () => {
  const managedResource = getDomainEntity('managed_resource');
  const serviceAccount = getDomainEntity('service_account');
  const platformUser = getDomainEntity('platform_user');
  const invitationStateMachine = getBusinessStateMachine('invitation_status');
  const serviceAccountCredentialStateMachine = getBusinessStateMachine('service_account_credential_status');
  const platformUserStateMachine = getBusinessStateMachine('platform_user_access_status');
  const tenantStateMachine = getBusinessStateMachine('tenant_lifecycle');
  const workspaceStateMachine = getBusinessStateMachine('workspace_lifecycle');
  const seedFixtures = readDomainSeedFixtures();
  const profileIds = seedFixtures.profiles.map((profile) => profile.id);
  const growthProfile = seedFixtures.profiles.find((profile) => profile.id === 'growth-multi-workspace');
  const growthDashboard = summarizeTenantGovernanceDashboard({
    tenant: growthProfile.tenant,
    workspaces: growthProfile.workspaces,
    externalApplications: growthProfile.externalApplications,
    serviceAccounts: growthProfile.serviceAccounts,
    managedResources: growthProfile.managedResources
  });

  assert.deepEqual(managedResource.supported_kinds, ['database', 'bucket', 'topic', 'function']);
  assert.equal(managedResource.required_fields.includes('accessPolicy'), true);
  assert.equal(serviceAccount.required_fields.includes('credentialPolicy'), true);
  assert.equal(serviceAccount.required_fields.includes('credentials'), true);
  assert.equal(platformUser.supported_states.includes('pending_activation'), true);
  assert.deepEqual(profileIds, ['starter-single-workspace', 'growth-multi-workspace', 'enterprise-dedicated']);
  assert.equal(seedFixtures.profiles.find((profile) => profile.id === 'starter-single-workspace').workspace_count, 1);
  assert.equal(seedFixtures.profiles.find((profile) => profile.id === 'enterprise-dedicated').tenant.placement, 'dedicated_database');
  assert.equal(growthProfile.managedResources.some((resource) => resource.kind === 'function'), true);
  assert.equal(seedFixtures.profiles.every((profile) => profile.managedResources.every((resource) => resource.accessPolicy)), true);
  assert.equal(seedFixtures.profiles.every((profile) => profile.serviceAccounts.every((account) => account.credentialPolicy && account.credentials?.length >= 1)), true);
  assert.equal(seedFixtures.profiles.every((profile) => profile.tenantMemberships.length >= 1), true);
  assert.equal(seedFixtures.profiles.every((profile) => profile.workspaceMemberships.length >= 1), true);
  assert.equal(seedFixtures.profiles.every((profile) => profile.invitations.length >= 1), true);
  assert.equal(seedFixtures.profiles.every((profile) => profile.tenant.identityContext.platformRealm === 'in-atelier-platform'), true);
  assert.equal(seedFixtures.profiles.every((profile) => Array.isArray(profile.tenant.labels) && profile.tenant.labels.length >= 2), true);
  assert.equal(seedFixtures.profiles.every((profile) => profile.tenant.quotaProfile?.workspaceSubquotas?.length >= 1), true);
  assert.equal(seedFixtures.profiles.every((profile) => profile.tenant.governance?.retentionPolicy?.purgeRequiresElevatedAccess === true), true);
  assert.equal(seedFixtures.profiles.every((profile) => profile.tenant.exportProfile?.redactionMode === 'secret_references_only'), true);
  assert.equal(seedFixtures.profiles.every((profile) => profile.workspaces.every((workspace) => workspace.iamBoundary.clientNamespace)), true);
  assert.equal(seedFixtures.profiles.every((profile) => profile.workspaces.every((workspace) => workspace.iamBoundary.keyPolicy?.secretPathPrefix)), true);
  assert.equal(seedFixtures.profiles.every((profile) => profile.workspaces.every((workspace) => Array.isArray(workspace.resourceInheritance?.logicalResources))), true);
  assert.equal(seedFixtures.profiles.every((profile) => profile.workspaces.every((workspace) => workspace.apiSurface?.applicationBaseUrlPattern)), true);
  assert.equal(seedFixtures.profiles.every((profile) => profile.externalApplications.every((application) => application.endpoints?.length >= 1)), true);
  assert.equal(growthProfile.managedResources.some((resource) => resource.sharingScope === 'tenant_shared' && resource.consumerWorkspaceIds.length >= 2), true);
  assert.equal(growthProfile.externalApplications.filter((application) => application.workspaceId === 'wrk_01betaprod').length >= 2, true);
  assert.equal(growthProfile.externalApplications.some((application) => application.federatedProviders?.some((provider) => provider.protocol === 'oidc')), true);
  assert.equal(
    seedFixtures.profiles.find((profile) => profile.id === 'enterprise-dedicated').externalApplications.some((application) => application.protocol === 'saml'),
    true
  );
  assert.equal(growthProfile.serviceAccounts.some((account) => account.iamBinding.clientId === 'beta-prod-svc-mobile-api'), true);
  assert.deepEqual(invitationStateMachine.states, ['pending', 'accepted', 'revoked', 'expired']);
  assert.ok(serviceAccountCredentialStateMachine);
  assert.deepEqual(serviceAccountCredentialStateMachine.states, ['active', 'rotation_due', 'revoked', 'expired']);
  assert.ok(platformUserStateMachine);
  assert.deepEqual(platformUserStateMachine.states, ['pending_activation', 'active', 'suspended', 'soft_deleted']);
  assert.ok(tenantStateMachine);
  assert.deepEqual(tenantStateMachine.states, ['pending_activation', 'active', 'suspended', 'deleted']);
  assert.ok(workspaceStateMachine);
  assert.deepEqual(workspaceStateMachine.states, ['draft', 'provisioning', 'pending_activation', 'active', 'suspended', 'soft_deleted']);
  assert.deepEqual(
    listCommercialPlans().map((plan) => plan.slug),
    ['starter', 'growth', 'regulated', 'enterprise']
  );
  assert.equal(getCommercialPlan('pln_01enterprise').deploymentProfileId, 'dpf_01enterprisefederated');
  assert.equal(getQuotaPolicy('qta_01regulated').defaultLimits.some((limit) => limit.metricKey === 'tenant.audit_retention_days.max'), true);
  assert.equal(growthDashboard.governanceStatus, 'nominal');
  assert.equal(growthDashboard.inventory.workspaceCount, 3);
  assert.equal(growthDashboard.allowedActions.includes('suspended'), true);
  assert.equal(listExternalApplicationSupportedFlows().length, 5);
  assert.equal(listExternalApplicationTemplates().map((template) => template.templateId).includes('tpl_b2b_saml'), true);
  assert.deepEqual(getExternalApplicationTemplate('tpl_spa_oidc_pkce').supportedAuthenticationFlows, ['oidc_authorization_code_pkce']);
  assert.deepEqual(getExternalApplicationPlanLimit('pln_01enterprise').supportedProtocols, ['oidc', 'saml']);
});

test('effective capability resolution intersects plan entitlements, profiles, and environment safety', () => {
  const tenantResolution = resolveTenantEffectiveCapabilities({ tenantId: 'ten_01growthbeta', planId: 'pln_01growth' });
  const workspaceResolution = resolveWorkspaceEffectiveCapabilities({
    tenantId: 'ten_01growthbeta',
    workspaceId: 'wrk_01betadev',
    workspaceEnvironment: 'dev',
    planId: 'pln_01growth'
  });

  assert.equal(tenantResolution.planId, 'pln_01growth');
  assert.equal(tenantResolution.capabilities.some((capability) => capability.capabilityKey === 'data.kafka.topics'), true);
  assert.equal(tenantResolution.capabilities.some((capability) => capability.capabilityKey === 'observability.logs.extended'), true);
  assert.equal(workspaceResolution.scope, 'workspace');
  assert.equal(workspaceResolution.workspaceId, 'wrk_01betadev');
  assert.equal(workspaceResolution.capabilities.some((capability) => capability.capabilityKey === 'data.kafka.topics'), false);
  assert.equal(workspaceResolution.capabilities.some((capability) => capability.capabilityKey === 'data.openwhisk.actions'), true);
});

test('plan change scenarios prove safe quota and capability transitions', () => {
  const scenarios = listPlanChangeScenarios();
  const evaluated = scenarios.map((scenario) => ({
    id: scenario.id,
    result: evaluatePlanChange({
      fromPlanId: scenario.fromPlanId,
      toPlanId: scenario.toPlanId,
      currentUsage: scenario.currentUsage
    }),
    expected: scenario.expectedOutcome
  }));

  assert.equal(evaluated.length, 3);

  for (const scenario of evaluated) {
    assert.equal(scenario.result.status, scenario.expected.status, `unexpected status for ${scenario.id}`);
    assert.deepEqual(scenario.result.addedCapabilities.sort(), [...scenario.expected.addedCapabilities].sort());
    assert.deepEqual(scenario.result.removedCapabilities.sort(), [...scenario.expected.removedCapabilities].sort());
    assert.deepEqual(scenario.result.blockingMetrics.sort(), [...scenario.expected.blockingMetrics].sort());
  }
});
