import test from 'node:test';
import assert from 'node:assert/strict';

import { OPENAPI_PATH, readJson } from '../../scripts/lib/quality-gates.mjs';
import {
  getContract,
  getPublicRoute,
  getService
} from '../../services/internal-contracts/src/index.mjs';
import {
  IAM_ADMIN_CAPABILITY_MATRIX,
  SUPPORTED_KEYCLOAK_VERSION_RANGES,
  keycloakAdminAdapterPort
} from '../../services/adapters/src/keycloak-admin.mjs';

test('iam service contracts and adapter capability baseline cover the Keycloak admin surface', () => {
  const iamAdminRequest = getContract('iam_admin_request');
  const iamAdminResult = getContract('iam_admin_result');
  const controlApi = getService('control_api');
  const provisioning = getService('provisioning_orchestrator');

  assert.ok(controlApi.outbound_contracts.includes('iam_admin_request'));
  assert.ok(provisioning.inbound_contracts.includes('iam_admin_request'));
  assert.ok(provisioning.outbound_contracts.includes('iam_admin_result'));
  assert.equal(iamAdminRequest.owner, 'control_api');
  assert.equal(iamAdminResult.owner, 'provisioning_orchestrator');
  assert.ok(iamAdminRequest.required_fields.includes('resource_kind'));
  assert.ok(iamAdminRequest.required_fields.includes('action'));
  assert.ok(iamAdminResult.required_fields.includes('resource_kind'));
  assert.ok(iamAdminResult.required_fields.includes('normalized_resource'));

  assert.ok(keycloakAdminAdapterPort.capabilities.includes('iam_realm_create'));
  assert.ok(keycloakAdminAdapterPort.capabilities.includes('iam_client_update'));
  assert.ok(keycloakAdminAdapterPort.capabilities.includes('iam_user_reset_credentials'));
  assert.deepEqual(IAM_ADMIN_CAPABILITY_MATRIX.user, ['list', 'get', 'create', 'update', 'delete', 'activate', 'deactivate', 'reset_credentials']);
  assert.deepEqual(SUPPORTED_KEYCLOAK_VERSION_RANGES.map((entry) => entry.range), ['24.x', '25.x', '26.x']);
});

test('iam public routes publish the normalized family metadata and compatibility descriptors', () => {
  const document = readJson(OPENAPI_PATH);
  const createRealmRoute = getPublicRoute('createIamRealm');
  const resetUserCredentialsRoute = getPublicRoute('resetIamUserCredentials');

  assert.equal(createRealmRoute.family, 'iam');
  assert.equal(createRealmRoute.path, '/v1/iam/realms');
  assert.equal(createRealmRoute.gatewayQosProfile, 'tenant_control');
  assert.equal(createRealmRoute.gatewayRequestValidationProfile, 'tenant_control');
  assert.equal(resetUserCredentialsRoute.resourceType, 'iam_user');
  assert.equal(resetUserCredentialsRoute.supportsIdempotencyKey, true);

  assert.ok(document.components.schemas.IamProviderCompatibility);
  assert.ok(document.components.schemas.IamRealm.properties.providerCompatibility);
  assert.ok(document.components.schemas.IamClient.properties.defaultScopes);
  assert.ok(document.components.schemas.IamScope.properties.protocolMappers);
  assert.ok(document.components.schemas.IamUser.properties.groups);
  assert.ok(document.components.schemas.IamUserCredentialResetRequest);
});
