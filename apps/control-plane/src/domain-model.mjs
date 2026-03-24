import {
  getBusinessStateMachine,
  getDomainContract,
  getDomainEntity,
  getEffectiveCapabilityResolutionContract,
  listDomainEntities,
  listLifecycleEvents
} from '../../../services/internal-contracts/src/index.mjs';

export const controlApiEntityReadContract = getDomainContract('entity_read_model');
export const controlApiEntityWriteContract = getDomainContract('entity_write_model');
export const controlApiLifecycleEventContract = getDomainContract('lifecycle_event');
export const controlApiEffectiveCapabilityResolutionContract = getEffectiveCapabilityResolutionContract();
export const controlPlaneDomainEntities = listDomainEntities();
export const controlPlaneTenantEntity = getDomainEntity('tenant');
export const controlPlaneWorkspaceEntity = getDomainEntity('workspace');
export const controlPlaneInvitationEntity = getDomainEntity('invitation');
export const controlPlanePlanEntity = getDomainEntity('plan');
export const controlPlaneInvitationStateMachine = getBusinessStateMachine('invitation_status');
export const controlPlaneTenantStateMachine = getBusinessStateMachine('tenant_lifecycle');
export const controlPlaneWorkspaceStateMachine = getBusinessStateMachine('workspace_lifecycle');
export const controlPlaneLifecycleEvents = listLifecycleEvents();
