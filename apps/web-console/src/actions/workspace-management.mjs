import {
  buildWorkspaceCloneDraft,
  resolveWorkspaceApiSurface,
  resolveWorkspaceResourceInheritance
} from '../../../../services/internal-contracts/src/index.mjs';

export function buildWorkspaceEndpointCards({ workspace, applications = [] }) {
  const surface = resolveWorkspaceApiSurface({
    workspaceId: workspace.workspaceId,
    workspaceSlug: workspace.slug,
    workspaceEnvironment: workspace.environment,
    iamRealm: workspace.iamBoundary?.realm,
    applications
  });

  return surface.endpoints.map((endpoint) => ({
    id: endpoint.name,
    title: endpoint.name,
    audience: endpoint.audience,
    url: endpoint.url
  }));
}

export function buildWorkspaceCloneFormDefaults({ sourceWorkspace, targetWorkspace = {} }) {
  return buildWorkspaceCloneDraft({ sourceWorkspace, targetWorkspace });
}

export function buildWorkspaceResourceSummary(workspace) {
  const inheritance = resolveWorkspaceResourceInheritance(workspace.resourceInheritance ?? {});

  return {
    mode: inheritance.mode,
    sourceWorkspaceId: inheritance.sourceWorkspaceId,
    sharedResourceCount: inheritance.sharedResourceKeys.length,
    specializedResourceCount: inheritance.specializedResourceKeys.length,
    logicalResourceCount: inheritance.logicalResources.length
  };
}
