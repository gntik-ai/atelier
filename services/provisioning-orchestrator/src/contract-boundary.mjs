import {
  PROVISIONING_ORCHESTRATOR_SERVICE_ID,
  getContract,
  getService,
  listAdapterPortsForConsumer,
  listInteractionFlows
} from '../../internal-contracts/src/index.mjs';

export { default as idempotencyKeyRecordSchema } from '../../../specs/075-idempotent-retry-dedup/contracts/idempotency-key-record.json' with { type: 'json' };
export { default as retryAttemptSchema } from '../../../specs/075-idempotent-retry-dedup/contracts/retry-attempt.json' with { type: 'json' };
export { default as asyncOperationRetryRequestSchema } from '../../../specs/075-idempotent-retry-dedup/contracts/async-operation-retry-request.json' with { type: 'json' };
export { default as asyncOperationRetryResponseSchema } from '../../../specs/075-idempotent-retry-dedup/contracts/async-operation-retry-response.json' with { type: 'json' };
export { default as idempotencyDedupEventContractSchema } from '../../../specs/075-idempotent-retry-dedup/contracts/idempotency-dedup-event.json' with { type: 'json' };
export { default as operationRetryEventContractSchema } from '../../../specs/075-idempotent-retry-dedup/contracts/operation-retry-event.json' with { type: 'json' };

export const provisioningOrchestratorBoundary = getService(PROVISIONING_ORCHESTRATOR_SERVICE_ID);
export const provisioningRequestContract = getContract('provisioning_request');
export const provisioningResultContract = getContract('provisioning_result');
export const provisioningAdapterPorts = listAdapterPortsForConsumer(PROVISIONING_ORCHESTRATOR_SERVICE_ID);
export const provisioningFlows = listInteractionFlows().filter(
  (flow) => flow.entry_service === 'control_api'
);
