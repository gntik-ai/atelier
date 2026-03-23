import {
  getEnforcementSurface,
  listContextPropagationTargets,
  listResourceSemantics
} from '../../internal-contracts/src/index.mjs';

export const adapterEnforcementSurfaces = [
  getEnforcementSurface('data_api'),
  getEnforcementSurface('functions_runtime'),
  getEnforcementSurface('event_bus'),
  getEnforcementSurface('object_storage')
].filter(Boolean);

export const adapterContextTargets = listContextPropagationTargets().filter((target) =>
  ['adapter_call', 'kafka_headers', 'openwhisk_activation', 'storage_presign_context'].includes(target.target)
);

export const workspaceOwnedResourceSemantics = listResourceSemantics().filter((resource) => resource.parent_scope === 'workspace');
