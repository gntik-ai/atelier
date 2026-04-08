import {
  PROVISIONING_ORCHESTRATOR_SERVICE_ID,
  getContract,
  getService,
  listAdapterPortsForConsumer,
  listInteractionFlows
} from '../../internal-contracts/src/index.mjs';

export { default as idempotencyKeyRecordSchema } from '../../../tests/contracts/schemas/idempotency-key-record.json' with { type: 'json' };
export { default as retryAttemptSchema } from '../../../tests/contracts/schemas/retry-attempt.json' with { type: 'json' };
export { default as asyncOperationRetryRequestSchema } from '../../../tests/contracts/schemas/async-operation-retry-request.json' with { type: 'json' };
export { default as asyncOperationRetryResponseSchema } from '../../../tests/contracts/schemas/async-operation-retry-response.json' with { type: 'json' };
export { default as idempotencyDedupEventContractSchema } from '../../../tests/contracts/schemas/idempotency-dedup-event.json' with { type: 'json' };
export { default as operationRetryEventContractSchema } from '../../../tests/contracts/schemas/operation-retry-event.json' with { type: 'json' };
export { default as failureClassifiedEventSchema } from '../../../services/internal-contracts/src/failure-classified-event.json' with { type: 'json' };
export { default as manualInterventionRequiredEventSchema } from '../../../services/internal-contracts/src/manual-intervention-required-event.json' with { type: 'json' };
export { default as retryOverrideEventSchema } from '../../../services/internal-contracts/src/retry-override-event.json' with { type: 'json' };
export { default as interventionNotificationEventSchema } from '../../../services/internal-contracts/src/intervention-notification-event.json' with { type: 'json' };

export const provisioningOrchestratorBoundary = getService(PROVISIONING_ORCHESTRATOR_SERVICE_ID);
export const provisioningRequestContract = getContract('provisioning_request');
export const provisioningResultContract = getContract('provisioning_result');
export const provisioningAdapterPorts = listAdapterPortsForConsumer(PROVISIONING_ORCHESTRATOR_SERVICE_ID);
export const provisioningFlows = listInteractionFlows().filter(
  (flow) => flow.entry_service === 'control_api'
);
