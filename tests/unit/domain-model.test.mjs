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
  getQuotaPolicy,
  listCommercialPlans,
  listDomainEntities,
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
  const invitationStateMachine = getBusinessStateMachine('invitation_status');
  const seedFixtures = readDomainSeedFixtures();
  const profileIds = seedFixtures.profiles.map((profile) => profile.id);
  const growthProfile = seedFixtures.profiles.find((profile) => profile.id === 'growth-multi-workspace');

  assert.deepEqual(managedResource.supported_kinds, ['database', 'bucket', 'topic', 'function']);
  assert.deepEqual(profileIds, ['starter-single-workspace', 'growth-multi-workspace', 'enterprise-dedicated']);
  assert.equal(seedFixtures.profiles.find((profile) => profile.id === 'starter-single-workspace').workspace_count, 1);
  assert.equal(seedFixtures.profiles.find((profile) => profile.id === 'enterprise-dedicated').tenant.placement, 'dedicated_database');
  assert.equal(growthProfile.managedResources.some((resource) => resource.kind === 'function'), true);
  assert.equal(seedFixtures.profiles.every((profile) => profile.tenantMemberships.length >= 1), true);
  assert.equal(seedFixtures.profiles.every((profile) => profile.workspaceMemberships.length >= 1), true);
  assert.equal(seedFixtures.profiles.every((profile) => profile.invitations.length >= 1), true);
  assert.equal(seedFixtures.profiles.every((profile) => profile.tenant.identityContext.platformRealm === 'in-atelier-platform'), true);
  assert.equal(seedFixtures.profiles.every((profile) => profile.workspaces.every((workspace) => workspace.iamBoundary.clientNamespace)), true);
  assert.equal(growthProfile.externalApplications.filter((application) => application.workspaceId === 'wrk_01betaprod').length >= 2, true);
  assert.equal(growthProfile.serviceAccounts.some((account) => account.iamBinding.clientId === 'beta-prod-svc-mobile-api'), true);
  assert.deepEqual(invitationStateMachine.states, ['pending', 'accepted', 'revoked', 'expired']);
  assert.deepEqual(
    listCommercialPlans().map((plan) => plan.slug),
    ['starter', 'growth', 'regulated', 'enterprise']
  );
  assert.equal(getCommercialPlan('pln_01enterprise').deploymentProfileId, 'dpf_01enterprisefederated');
  assert.equal(getQuotaPolicy('qta_01regulated').defaultLimits.some((limit) => limit.metricKey === 'tenant.audit_retention_days.max'), true);
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
