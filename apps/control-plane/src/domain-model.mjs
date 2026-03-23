import {
  getDomainContract,
  getDomainEntity,
  listDomainEntities,
  listLifecycleEvents
} from '../../../services/internal-contracts/src/index.mjs';

export const controlApiEntityReadContract = getDomainContract('entity_read_model');
export const controlApiEntityWriteContract = getDomainContract('entity_write_model');
export const controlApiLifecycleEventContract = getDomainContract('lifecycle_event');
export const controlPlaneDomainEntities = listDomainEntities();
export const controlPlaneTenantEntity = getDomainEntity('tenant');
export const controlPlaneWorkspaceEntity = getDomainEntity('workspace');
export const controlPlaneLifecycleEvents = listLifecycleEvents();
