import test from 'node:test';
import assert from 'node:assert/strict';

import {
  controlApiEffectiveCapabilityResolutionContract,
  controlApiEntityReadContract,
  controlApiEntityWriteContract,
  controlApiLifecycleEventContract,
  controlPlaneDomainEntities
} from '../../apps/control-plane/src/domain-model.mjs';
import { OPENAPI_PATH, readJson } from '../../scripts/lib/quality-gates.mjs';
import {
  getDomainEntity,
  getEffectiveCapabilityResolutionDescriptor,
  listBusinessStateMachines,
  listEnvironmentProfiles,
  listLifecycleEvents,
  listResourceSemantics,
  readDomainModel
} from '../../services/internal-contracts/src/index.mjs';

test('domain model aligns with public OpenAPI schemas and paths', () => {
  const domainModel = readDomainModel();
  const openapi = readJson(OPENAPI_PATH);

  assert.equal(controlApiEntityReadContract.version, domainModel.version);
  assert.equal(controlApiEntityWriteContract.version, domainModel.version);
  assert.equal(controlApiLifecycleEventContract.version, domainModel.version);
  assert.equal(controlApiEffectiveCapabilityResolutionContract.version, domainModel.version);

  for (const entity of controlPlaneDomainEntities) {
    assert.ok(openapi.components.schemas[entity.openapi.read_schema], `missing schema ${entity.openapi.read_schema}`);
    assert.ok(openapi.components.schemas[entity.openapi.write_schema], `missing schema ${entity.openapi.write_schema}`);
    assert.ok(openapi.paths[entity.openapi.read_path], `missing path ${entity.openapi.read_path}`);
    assert.ok(openapi.paths[entity.openapi.write_path], `missing path ${entity.openapi.write_path}`);
  }

  const resolutionDescriptor = getEffectiveCapabilityResolutionDescriptor();
  assert.ok(openapi.components.schemas.EffectiveCapabilityResolution);
  assert.ok(openapi.components.schemas.TenantIdentityContext);
  assert.ok(openapi.components.schemas.ExternalApplicationIamClient);
  assert.ok(openapi.components.schemas.ServiceAccountIamBinding);
  assert.ok(openapi.paths[resolutionDescriptor.paths.tenant]);
  assert.ok(openapi.paths[resolutionDescriptor.paths.workspace]);
});

test('domain model preserves deployment, authorization, and governance alignment', () => {
  const workspaceEntity = getDomainEntity('workspace');
  const tenantEntity = getDomainEntity('tenant');
  const applicationEntity = getDomainEntity('external_application');
  const serviceAccountEntity = getDomainEntity('service_account');
  const managedResourceEntity = getDomainEntity('managed_resource');
  const deploymentProfileEntity = getDomainEntity('deployment_profile');
  const providerCapabilityEntity = getDomainEntity('provider_capability');
  const deploymentEnvironments = new Set(listEnvironmentProfiles().map((profile) => profile.id));
  const authorizationResourceTypes = new Set(listResourceSemantics().map((resource) => resource.resource_type));
  const lifecycleCoverage = new Set(listLifecycleEvents().map((event) => `${event.entity_type}:${event.transition}`));

  for (const environment of ['dev', 'sandbox', 'staging', 'prod']) {
    assert.equal(deploymentEnvironments.has(environment), true, `missing deployment environment ${environment}`);
  }

  assert.equal(workspaceEntity.business_rules.some((rule) => rule.includes('deployment topology environment catalog')), true);
  assert.equal(tenantEntity.business_rules.some((rule) => rule.includes('identityContext')), true);
  assert.equal(applicationEntity.business_rules.some((rule) => rule.includes('iamClient.clientId')), true);
  assert.equal(serviceAccountEntity.business_rules.some((rule) => rule.includes('confidential Keycloak client')), true);
  assert.equal(
    deploymentProfileEntity.business_rules.some((rule) => rule.includes('control, data, identity, and observability plane separation')),
    true
  );
  assert.equal(providerCapabilityEntity.business_rules.some((rule) => rule.includes('secret-free')), true);

  for (const kind of managedResourceEntity.supported_kinds) {
    assert.equal(authorizationResourceTypes.has(kind), true, `managed resource kind ${kind} must align with authorization model`);
  }

  assert.equal(authorizationResourceTypes.has('service_account'), true);

  for (const entityId of controlPlaneDomainEntities.map((entity) => entity.id)) {
    for (const transitionId of ['create', 'activate', 'suspend', 'soft_delete']) {
      assert.equal(lifecycleCoverage.has(`${entityId}:${transitionId}`), true, `missing lifecycle event ${entityId}:${transitionId}`);
    }
  }

  assert.equal(listBusinessStateMachines().length >= 5, true);
});
