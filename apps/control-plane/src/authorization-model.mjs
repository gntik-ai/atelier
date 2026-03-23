import {
  getAuthorizationContract,
  getContextPropagationTarget,
  getEnforcementSurface,
  listNegativeAuthorizationScenarios
} from '../../../services/internal-contracts/src/index.mjs';

export const controlApiSecurityContextContract = getAuthorizationContract('security_context');
export const controlApiAuthorizationDecisionContract = getAuthorizationContract('authorization_decision');
export const controlApiAuthorizationSurface = getEnforcementSurface('control_api');
export const controlApiCommandContextProjection = getContextPropagationTarget('control_api_command');
export const controlApiNegativeAuthorizationScenarios = listNegativeAuthorizationScenarios().filter(
  (scenario) => scenario.surface === 'control_api'
);
