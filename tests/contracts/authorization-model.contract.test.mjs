import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getContextPropagationTarget,
  getContract,
  listResourceSemantics,
  readAuthorizationModel
} from '../../services/internal-contracts/src/index.mjs';
import { OPENAPI_PATH, readJson } from '../../scripts/lib/quality-gates.mjs';

test('authorization model aligns with public access-check resource types', () => {
  const authorizationModel = readAuthorizationModel();
  const openapi = readJson(OPENAPI_PATH);
  const requestSchema = openapi.components.schemas.AccessCheckRequest;
  const openapiResourceTypes = new Set(requestSchema.properties.resourceType.enum);
  const modelResourceTypes = new Set(listResourceSemantics().map((resource) => resource.resource_type));

  assert.equal(authorizationModel.contracts.authorization_decision.version, authorizationModel.version);
  assert.deepEqual([...openapiResourceTypes].sort(), [...modelResourceTypes].sort());
});

test('authorization model includes console backend propagation and denial coverage', () => {
  const target = getContextPropagationTarget('console_backend_activation');
  const model = readAuthorizationModel();
  const scenarioIds = new Set(model.negative_scenarios.map((scenario) => scenario.id));

  assert.ok(target);
  assert.equal(target.carrier, 'activation_annotation');
  assert.equal(target.required_fields.includes('initiating_surface'), true);
  assert.equal(scenarioIds.has('AUTHZ-FN-CON-001'), true);
  assert.equal(scenarioIds.has('AUTHZ-FN-CON-002'), true);
});

test('authorization propagation targets stay aligned with internal service contracts', () => {
  for (const targetId of ['control_api_command', 'provisioning_request', 'adapter_call', 'audit_record']) {
    const target = getContextPropagationTarget(targetId);
    const contract = getContract(targetId);

    assert.ok(target, `missing propagation target ${targetId}`);
    assert.ok(contract, `missing internal contract ${targetId}`);

    for (const field of target.required_fields) {
      assert.equal(
        contract.required_fields.includes(field),
        true,
        `${targetId} contract should require propagated field ${field}`
      );
    }
  }
});
