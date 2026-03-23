import test from 'node:test';
import assert from 'node:assert/strict';

import {
  controlApiEntityReadContract,
  controlApiEntityWriteContract,
  controlApiLifecycleEventContract,
  controlPlaneDomainEntities
} from '../../apps/control-plane/src/domain-model.mjs';
import { OPENAPI_PATH, readJson } from '../../scripts/lib/quality-gates.mjs';
import {
  getDomainEntity,
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

  for (const entity of controlPlaneDomainEntities) {
    assert.ok(openapi.components.schemas[entity.openapi.read_schema], `missing schema ${entity.openapi.read_schema}`);
    assert.ok(openapi.components.schemas[entity.openapi.write_schema], `missing schema ${entity.openapi.write_schema}`);
    assert.ok(openapi.paths[entity.openapi.read_path], `missing path ${entity.openapi.read_path}`);
    assert.ok(openapi.paths[entity.openapi.write_path], `missing path ${entity.openapi.write_path}`);
  }
});

test('domain model preserves deployment and authorization alignment', () => {
  const workspaceEntity = getDomainEntity('workspace');
  const managedResourceEntity = getDomainEntity('managed_resource');
  const deploymentEnvironments = new Set(listEnvironmentProfiles().map((profile) => profile.id));
  const authorizationResourceTypes = new Set(listResourceSemantics().map((resource) => resource.resource_type));
  const lifecycleCoverage = new Set(listLifecycleEvents().map((event) => `${event.entity_type}:${event.transition}`));

  for (const environment of ['dev', 'sandbox', 'staging', 'prod']) {
    assert.equal(deploymentEnvironments.has(environment), true, `missing deployment environment ${environment}`);
  }

  assert.equal(workspaceEntity.business_rules.some((rule) => rule.includes('deployment topology environment catalog')), true);

  for (const kind of managedResourceEntity.supported_kinds) {
    assert.equal(authorizationResourceTypes.has(kind), true, `managed resource kind ${kind} must align with authorization model`);
  }

  for (const entityId of ['platform_user', 'tenant', 'workspace', 'external_application', 'service_account', 'managed_resource']) {
    for (const transitionId of ['create', 'activate', 'suspend', 'soft_delete']) {
      assert.equal(lifecycleCoverage.has(`${entityId}:${transitionId}`), true, `missing lifecycle event ${entityId}:${transitionId}`);
    }
  }
});
