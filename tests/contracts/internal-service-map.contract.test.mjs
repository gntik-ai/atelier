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
  auditPersistenceAdapters,
  auditRecordContract
} from '../../services/audit/src/contract-boundary.mjs';
import { auditContextProjection } from '../../services/audit/src/authorization-context.mjs';
import {
  eventGatewayBoundary,
  eventGatewayPublishRequestContract,
  eventGatewayPublishResultContract,
  eventGatewaySubscriptionRequestContract,
  eventGatewaySubscriptionStatusContract
} from '../../services/event-gateway/src/contract-boundary.mjs';

test('internal contract baseline preserves versioning and dependency expectations', () => {
  assert.equal(INTERNAL_CONTRACT_VERSION, '2026-03-24');
  assert.equal(AUTHORIZATION_MODEL_VERSION, '2026-03-23');
  assert.ok(controlApiBoundary.service_dependencies.includes('provisioning_orchestrator'));
  assert.ok(controlApiBoundary.service_dependencies.includes('audit_module'));
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
  assert.ok(provisioningResultContract.error_classes.includes('recovery_required'));
  assert.ok(eventGatewayPublishRequestContract.required_fields.includes('idempotency_key'));
  assert.ok(eventGatewayPublishRequestContract.required_fields.includes('authorization_decision_id'));
  assert.ok(eventGatewaySubscriptionRequestContract.required_fields.includes('transport'));
  assert.ok(eventGatewayPublishResultContract.required_fields.includes('audit_record_id'));
  assert.ok(eventGatewaySubscriptionStatusContract.required_fields.includes('lag_snapshot'));
  assert.equal(auditRecordContract.write_mode, 'append_only');
  assert.ok(auditRecordContract.required_fields.includes('evidence_pointer'));
  assert.ok(auditRecordContract.required_fields.includes('authorization_decision_id'));

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

  assert.deepEqual([...auditProviderIds].sort(), ['postgresql', 'storage']);
  assert.ok(interactionFlowIds.has('tenant_provisioning'));
  assert.ok(interactionFlowIds.has('tenant_suspension'));
  assert.ok(interactionFlowIds.has('event_publish_gateway'));
  assert.ok(interactionFlowIds.has('realtime_subscription_gateway'));
  assert.equal(getService('event_gateway').package, 'services/event-gateway');
  assert.equal(getContract('adapter_call').owner, 'services/adapters');
});
