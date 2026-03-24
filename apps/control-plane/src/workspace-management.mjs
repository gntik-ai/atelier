import {
  buildWorkspaceCloneDraft,
  filterPublicRoutes,
  getApiFamily,
  getBusinessStateMachine,
  getPublicRoute,
  resolveWorkspaceApiSurface,
  resolveWorkspaceResourceInheritance
} from '../../../services/internal-contracts/src/index.mjs';

export const workspaceApiFamily = getApiFamily('workspaces');
export const workspaceLifecycleStateMachine = getBusinessStateMachine('workspace_lifecycle');
export const workspaceRoutes = filterPublicRoutes({ family: 'workspaces' });

export function listWorkspaceRoutes(filters = {}) {
  return filterPublicRoutes({ family: 'workspaces', ...filters });
}

export function getWorkspaceRoute(operationId) {
  const route = getPublicRoute(operationId);
  return route?.family === 'workspaces' ? route : undefined;
}

export function summarizeWorkspaceManagementSurface({ workspaceId, workspaceSlug, workspaceEnvironment, iamRealm, applications = [] }) {
  return {
    family: workspaceApiFamily,
    routes: workspaceRoutes,
    lifecycle: workspaceLifecycleStateMachine,
    apiSurface: resolveWorkspaceApiSurface({
      workspaceId,
      workspaceSlug,
      workspaceEnvironment,
      iamRealm,
      applications
    })
  };
}

export { buildWorkspaceCloneDraft, resolveWorkspaceApiSurface, resolveWorkspaceResourceInheritance };
