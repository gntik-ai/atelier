import {
  getAuthorizationContract,
  getContextPropagationTarget,
  listNegativeAuthorizationScenarios
} from '../../internal-contracts/src/index.mjs';

export const auditAuthorizationDecisionContract = getAuthorizationContract('authorization_decision');
export const auditContextProjection = getContextPropagationTarget('audit_record');
export const auditRelevantNegativeAuthorizationScenarios = listNegativeAuthorizationScenarios();
