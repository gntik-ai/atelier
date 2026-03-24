import test from 'node:test';
import assert from 'node:assert/strict';

import { controlApiBoundary, controlApiCommandContract } from '../../apps/control-plane/src/internal-service-map.mjs';
import {
  controlApiAuthorizationDecisionContract,
  controlApiAuthorizationSurface,
  controlApiCommandContextProjection
} from '../../apps/control-plane/src/authorization-model.mjs';
import {
  AUTHORIZATION_MODEL_VERSION,
  INTERNAL_CONTRACT_VERSION,
  getContract,
  getService,
  listInteractionFlows
} from '../../services/internal-contracts/src/index.mjs';
import {
  provisioningAdapterPorts,
  provisioningOrchestratorBoundary,
  provisioningRequestContract,
  provisioningResultContract
} from '../../services/provisioning-orchestrator/src/contract-boundary.mjs';
import {
  provisioningAdapterAuthorizationProjection,
  provisioningAuthorizationContextProjection
} from '../../services/provisioning-orchestrator/src/authorization-context.mjs';
import {
  auditModuleBoundary,
  iamLifecycleEventContract as auditLifecycleEventContract,
  auditPersistenceAdapters,
  auditRecordContract
} from '../../services/audit/src/contract-boundary.mjs';
import { auditContextProjection } from '../../services/audit/src/authorization-context.mjs';
import {
  eventGatewayBoundary,
  iamLifecycleEventContract as eventGatewayLifecycleEventContract,
  eventGatewayPublishRequestContract,
  eventGatewayPublishResultContract,
  eventGatewaySubscriptionRequestContract,
  eventGatewaySubscriptionStatusContract
} from '../../services/event-gateway/src/contract-boundary.mjs';

test('internal contract baseline preserves versioning and dependency expectations', () => {
  assert.equal(INTERNAL_CONTRACT_VERSION, '2026-03-24');
  assert.equal(AUTHORIZATION_MODEL_VERSION, '2026-03-24');
  assert.ok(controlApiBoundary.service_dependencies.includes('provisioning_orchestrator'));
  assert.ok(controlApiBoundary.service_dependencies.includes('audit_module'));
  assert.ok(controlApiBoundary.service_dependencies.includes('event_gateway'));
  assert.ok(provisioningOrchestratorBoundary.service_dependencies.includes('audit_module'));
  assert.ok(eventGatewayBoundary.service_dependencies.includes('audit_module'));
  assert.ok(eventGatewayBoundary.adapter_dependencies.includes('kafka'));
  assert.deepEqual(auditModuleBoundary.service_dependencies, []);

  assert.ok(controlApiCommandContract.required_fields.includes('idempotency_key'));
  assert.ok(controlApiCommandContract.required_fields.includes('authorization_decision_id'));
  assert.ok(controlApiCommandContract.required_fields.includes('workspace_id'));
  assert.ok(controlApiCommandContract.required_fields.includes('correlation_id'));
  assert.ok(provisioningRequestContract.required_fields.includes('requested_resources'));
  assert.ok(provisioningRequestContract.required_fields.includes('authorization_decision_id'));
  assert.ok(provisioningRequestContract.required_fields.includes('identity_blueprint_ref'));
  assert.ok(provisioningRequestContract.required_fields.includes('owner_user_id'));
  assert.ok(provisioningRequestContract.required_fields.includes('default_workspace_environment'));
  assert.ok(provisioningRequestContract.required_fields.includes('resource_blueprints'));
  assert.ok(provisioningResultContract.required_fields.includes('resource_states'));
  assert.ok(provisioningResultContract.required_fields.includes('owner_bindings'));
  assert.ok(provisioningResultContract.required_fields.includes('retry'));
  assert.ok(provisioningResultContract.error_classes.includes('recovery_required'));
  assert.ok(eventGatewayBoundary.inbound_contracts.includes('iam_lifecycle_event'));
  assert.equal(auditLifecycleEventContract.version, '2026-03-24');
  assert.equal(eventGatewayLifecycleEventContract.version, '2026-03-24');
  assert.ok(auditLifecycleEventContract.required_fields.includes('audit_record_id'));
  assert.ok(auditLifecycleEventContract.required_fields.includes('origin_surface'));
  assert.ok(eventGatewayPublishRequestContract.required_fields.includes('idempotency_key'));
  assert.ok(eventGatewayPublishRequestContract.required_fields.includes('authorization_decision_id'));
  assert.ok(eventGatewaySubscriptionRequestContract.required_fields.includes('transport'));
  assert.ok(eventGatewayPublishResultContract.required_fields.includes('audit_record_id'));
  assert.ok(eventGatewaySubscriptionStatusContract.required_fields.includes('lag_snapshot'));
  assert.equal(auditRecordContract.write_mode, 'append_only');
  assert.ok(auditRecordContract.required_fields.includes('evidence_pointer'));
  assert.ok(auditRecordContract.required_fields.includes('authorization_decision_id'));
  assert.ok(auditRecordContract.required_fields.includes('actor_id'));
  assert.ok(auditRecordContract.required_fields.includes('origin_surface'));
  assert.ok(auditRecordContract.required_fields.includes('target_workspace_id'));

  assert.equal(controlApiAuthorizationDecisionContract.version, AUTHORIZATION_MODEL_VERSION);
  assert.equal(controlApiAuthorizationSurface.id, 'control_api');
  assert.equal(controlApiCommandContextProjection.target, 'control_api_command');
  assert.equal(provisioningAuthorizationContextProjection.target, 'provisioning_request');
  assert.equal(provisioningAdapterAuthorizationProjection.target, 'adapter_call');
  assert.equal(auditContextProjection.target, 'audit_record');
});

test('consumer scaffolding exposes the expected provider and flow slices', () => {
  const provisioningProviderIds = new Set(provisioningAdapterPorts.map((adapter) => adapter.id));
  const auditProviderIds = new Set(auditPersistenceAdapters.map((adapter) => adapter.id));
  const interactionFlowIds = new Set(listInteractionFlows().map((flow) => flow.id));

  for (const providerId of ['keycloak', 'postgresql', 'mongodb', 'kafka', 'openwhisk', 'storage']) {
    assert.ok(provisioningProviderIds.has(providerId), `missing provisioning adapter ${providerId}`);
  }

  const keycloakAdapter = provisioningAdapterPorts.find((adapter) => adapter.id === 'keycloak');

  assert.deepEqual([...auditProviderIds].sort(), ['postgresql', 'storage']);
  assert.ok(keycloakAdapter.capabilities.includes('ensure_protocol_mappers'));
  assert.ok(keycloakAdapter.capabilities.includes('ensure_group_role_mappings'));
  assert.ok(keycloakAdapter.capabilities.includes('ensure_federated_identity_providers'));
  assert.ok(keycloakAdapter.capabilities.includes('ensure_saml_clients'));
  assert.ok(keycloakAdapter.capabilities.includes('validate_federation_metadata'));
  assert.ok(keycloakAdapter.capabilities.includes('validate_logout_redirects'));
  assert.ok(keycloakAdapter.capabilities.includes('ensure_service_account'));
  assert.ok(keycloakAdapter.capabilities.includes('issue_service_account_credentials'));
  assert.ok(keycloakAdapter.capabilities.includes('rotate_service_account_credentials'));
  assert.ok(keycloakAdapter.capabilities.includes('revoke_service_account_credentials'));
  assert.ok(keycloakAdapter.capabilities.includes('iam_realm_create'));
  assert.ok(keycloakAdapter.capabilities.includes('iam_client_update'));
  assert.ok(keycloakAdapter.capabilities.includes('iam_user_reset_credentials'));
  assert.equal(getContract('adapter_call').required_fields.includes('provisioning_run_id'), true);
  assert.equal(getContract('adapter_call').required_fields.includes('resource_key'), true);
  assert.equal(getContract('adapter_result').required_fields.includes('resource_key'), true);
  assert.equal(getContract('adapter_result').required_fields.includes('attempt_count'), true);
  assert.ok(interactionFlowIds.has('signup_activation_bootstrap'));
  assert.ok(interactionFlowIds.has('tenant_provisioning'));
  assert.ok(interactionFlowIds.has('tenant_suspension'));
  assert.ok(interactionFlowIds.has('workspace_identity_registration'));
  assert.ok(interactionFlowIds.has('workspace_application_federation'));
  assert.ok(interactionFlowIds.has('invitation_membership_reconciliation'));
  assert.ok(interactionFlowIds.has('service_account_credential_rotation'));
  assert.ok(interactionFlowIds.has('iam_administration'));
  assert.ok(interactionFlowIds.has('iam_lifecycle_traceability'));
  assert.ok(interactionFlowIds.has('event_publish_gateway'));
  assert.ok(interactionFlowIds.has('realtime_subscription_gateway'));
  assert.equal(getService('event_gateway').package, 'services/event-gateway');
  assert.equal(getContract('adapter_call').owner, 'services/adapters');
  assert.equal(getContract('identity_blueprint').owner, 'provisioning_orchestrator');
});
