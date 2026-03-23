import {
  getContextPropagationTarget,
  listNegativeAuthorizationScenarios
} from '../../internal-contracts/src/index.mjs';

export const provisioningAuthorizationContextProjection = getContextPropagationTarget('provisioning_request');
export const provisioningAdapterAuthorizationProjection = getContextPropagationTarget('adapter_call');
export const provisioningNegativeAuthorizationScenarios = listNegativeAuthorizationScenarios().filter((scenario) =>
  ['functions_runtime', 'event_bus', 'object_storage'].includes(scenario.surface)
);
