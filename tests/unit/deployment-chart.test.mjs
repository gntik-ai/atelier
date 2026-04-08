import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectDeploymentChartViolations,
  collectUpgradeValidationViolations,
  compareVersions,
  readProfileValues,
  readRootChart,
  readRootValues,
  readWrapperChart,
  REQUIRED_COMPONENT_ALIASES,
  RECOMMENDED_DEPLOYMENT_PROFILES,
  resolveComponentImage,
  resolveImageRepository
} from '../../scripts/lib/deployment-chart.mjs';
import { readDeploymentTopology } from '../../scripts/lib/deployment-topology.mjs';
import { readDomainModel } from '../../scripts/lib/domain-model.mjs';

test('deployment chart stays internally consistent with packaging guidance', () => {
  const violations = collectDeploymentChartViolations(
    readRootChart(),
    readRootValues(),
    readDeploymentTopology(),
    readWrapperChart(),
    readDomainModel()
  );

  assert.deepEqual(violations, []);
});

test('deployment chart validation detects missing dependency aliases and values layers', () => {
  const brokenChart = structuredClone(readRootChart());
  brokenChart.dependencies = brokenChart.dependencies.filter((entry) => entry.alias !== 'storage');

  const brokenValues = structuredClone(readRootValues());
  delete brokenValues.deployment.valuesLayers.airgap;

  const violations = collectDeploymentChartViolations(
    brokenChart,
    brokenValues,
    readDeploymentTopology(),
    readWrapperChart(),
    readDomainModel()
  );

  assert.ok(violations.some((violation) => violation.includes('Missing wrapper dependency alias storage')));
  assert.ok(violations.some((violation) => violation.includes('deployment.valuesLayers must include airgap')));
});

test('deployment chart validation detects bootstrap catalog drift and invalid secret strategies', () => {
  const brokenValues = structuredClone(readRootValues());
  brokenValues.bootstrap.secretResolution.supportedStrategies = ['kubernetesSecret', 'env'];
  brokenValues.bootstrap.oneShot.governanceCatalog.plans = brokenValues.bootstrap.oneShot.governanceCatalog.plans.slice(1);

  const violations = collectDeploymentChartViolations(
    readRootChart(),
    brokenValues,
    readDeploymentTopology(),
    readWrapperChart(),
    readDomainModel()
  );

  assert.ok(violations.some((violation) => violation.includes('bootstrap.secretResolution.supportedStrategies')));
  assert.ok(violations.some((violation) => violation.includes('governanceCatalog.plans')));
});


test('deployment chart keeps the Keycloak platform and tenant IAM bootstrap baseline', () => {
  const values = readRootValues();
  const keycloakBootstrap = values.bootstrap.oneShot.keycloak;

  assert.ok(keycloakBootstrap.realmRoles.includes('platform_admin'));
  assert.ok(keycloakBootstrap.realmRoles.includes('tenant_owner'));
  assert.ok(keycloakBootstrap.realmRoles.includes('tenant_developer'));
  assert.ok(keycloakBootstrap.realmRoles.includes('tenant_viewer'));
  assert.ok(keycloakBootstrap.realmRoles.includes('workspace_owner'));
  assert.ok(keycloakBootstrap.realmRoles.includes('workspace_admin'));
  assert.ok(keycloakBootstrap.realmRoles.includes('workspace_service_account'));
  assert.ok(keycloakBootstrap.clientScopes.some((scope) => scope.name === 'tenant-context'));
  assert.ok(keycloakBootstrap.clientScopes.some((scope) => scope.name === 'workspace-context'));
  assert.ok(keycloakBootstrap.clients.some((client) => client.clientId === 'in-falcone-gateway'));
  assert.ok(keycloakBootstrap.clients.some((client) => client.clientId === 'in-falcone-console'));
  assert.equal(keycloakBootstrap.realm.login.registrationAllowed, true);
  assert.equal(keycloakBootstrap.realm.login.resetPasswordAllowed, true);
  assert.equal(keycloakBootstrap.clients.find((client) => client.clientId === 'in-falcone-console').directAccessGrantsEnabled, true);
  assert.equal(keycloakBootstrap.tenantRealmTemplate.realmIdPattern, 'tenant-{tenantSlug}');
  assert.equal(
    keycloakBootstrap.tenantRealmTemplate.serviceAccountTemplate.credentialRefPattern,
    'secret://iam/{tenantId}/{workspaceId}/service-accounts/{serviceAccountId}'
  );

  assert.equal(values.webConsole.auth.loginPath, '/login');
  assert.equal(values.webConsole.auth.signupPath, '/signup');
  assert.equal(values.webConsole.auth.autoSignupPolicy.globalMode, 'approval_required');
  assert.equal(values.webConsole.auth.autoSignupPolicy.environmentModes.dev, 'auto_activate');
  assert.equal(values.webConsole.auth.autoSignupPolicy.planModes.enterprise, 'auto_activate');
  assert.equal(values.webConsole.auth.expirationPolicies.invitations.defaultTtl, '72h');
  assert.equal(values.webConsole.auth.expirationPolicies.humanCredentials.passwordMaxAge, '90d');
  assert.equal(values.webConsole.auth.expirationPolicies.serviceCredentials.rotateBefore, '7d');
  assert.equal(values.webConsole.auth.expirationPolicies.sessions.idleTimeout, '30m');
});

test('all expected component aliases are present in the root chart dependencies', () => {
  const aliases = readRootChart().dependencies.map((entry) => entry.alias);
  assert.deepEqual(aliases, REQUIRED_COMPONENT_ALIASES);
});

test('recommended deployment profile overlays exist and declare their own profile id', () => {
  const declaredProfiles = RECOMMENDED_DEPLOYMENT_PROFILES.map((profileId) => readProfileValues(profileId).deployment.profile);
  assert.deepEqual(declaredProfiles, RECOMMENDED_DEPLOYMENT_PROFILES);
});

test('registry rewriting preserves repository paths while swapping the registry host', () => {
  assert.equal(resolveImageRepository('docker.io/apache/apisix', 'registry.airgap.in-falcone.local'), 'registry.airgap.in-falcone.local/apache/apisix');
  assert.equal(
    resolveImageRepository('ghcr.io/example/in-falcone-control-plane', 'registry.airgap.in-falcone.local'),
    'registry.airgap.in-falcone.local/example/in-falcone-control-plane'
  );

  const values = readRootValues();
  const mirroredValues = structuredClone(values);
  mirroredValues.global.imageRegistry = 'registry.airgap.in-falcone.local';
  assert.equal(resolveComponentImage(mirroredValues, 'apisix'), 'registry.airgap.in-falcone.local/apache/apisix:3.10.0');
});

test('upgrade validation requires an approved currentVersion during in-place upgrades', () => {
  const chart = readRootChart();
  const values = readRootValues();

  assert.deepEqual(
    collectUpgradeValidationViolations(chart, values, { releaseIsUpgrade: true, currentVersion: '0.2.0' }),
    []
  );

  const missingVersionViolations = collectUpgradeValidationViolations(chart, values, {
    releaseIsUpgrade: true,
    currentVersion: ''
  });
  assert.ok(missingVersionViolations.some((violation) => violation.includes('currentVersion is required')));

  const unsupportedVersionViolations = collectUpgradeValidationViolations(chart, values, {
    releaseIsUpgrade: true,
    currentVersion: '0.1.0'
  });
  assert.ok(unsupportedVersionViolations.some((violation) => violation.includes('not listed in supportedPreviousVersions')));
});

test('compareVersions orders supported chart upgrades predictably', () => {
  assert.equal(compareVersions('0.2.0', '0.3.0') < 0, true);
  assert.equal(compareVersions('0.3.0', '0.3.0'), 0);
  assert.equal(compareVersions('0.4.0', '0.3.0') > 0, true);
});
