import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildWorkspaceCloneDraft,
  resolveWorkspaceApiSurface,
  resolveWorkspaceResourceInheritance
} from '../../services/internal-contracts/src/index.mjs';
import {
  getWorkspaceRoute,
  summarizeWorkspaceManagementSurface,
  workspaceLifecycleStateMachine
} from '../../apps/control-plane/src/workspace-management.mjs';
import {
  buildWorkspaceCloneFormDefaults,
  buildWorkspaceEndpointCards,
  buildWorkspaceResourceSummary
} from '../../apps/web-console/src/actions/workspace-management.mjs';
import { readDomainSeedFixtures } from '../../scripts/lib/domain-model.mjs';

test('workspace helper modules expose lifecycle, clone, inheritance, and API-surface primitives', () => {
  const fixtures = readDomainSeedFixtures();
  const growthProfile = fixtures.profiles.find((profile) => profile.id === 'growth-multi-workspace');
  const stagingWorkspace = growthProfile.workspaces.find((workspace) => workspace.workspaceId === 'wrk_01betastaging');
  const stagingApplications = growthProfile.externalApplications.filter((application) => application.workspaceId === stagingWorkspace.workspaceId);

  const apiSurface = resolveWorkspaceApiSurface({
    workspaceId: stagingWorkspace.workspaceId,
    workspaceSlug: stagingWorkspace.slug,
    workspaceEnvironment: stagingWorkspace.environment,
    iamRealm: stagingWorkspace.iamBoundary.realm,
    applications: stagingApplications
  });
  const inheritance = resolveWorkspaceResourceInheritance(stagingWorkspace.resourceInheritance);
  const cloneDraft = buildWorkspaceCloneDraft({
    sourceWorkspace: stagingWorkspace,
    targetWorkspace: {
      slug: 'beta-sandbox',
      displayName: 'Beta Sandbox',
      environment: 'sandbox',
      metadata: { requestedBy: 'usr_01betaowner' }
    }
  });
  const controlPlaneSummary = summarizeWorkspaceManagementSurface({
    workspaceId: stagingWorkspace.workspaceId,
    workspaceSlug: stagingWorkspace.slug,
    workspaceEnvironment: stagingWorkspace.environment,
    iamRealm: stagingWorkspace.iamBoundary.realm,
    applications: stagingApplications
  });
  const endpointCards = buildWorkspaceEndpointCards({ workspace: stagingWorkspace, applications: stagingApplications });
  const cloneDefaults = buildWorkspaceCloneFormDefaults({
    sourceWorkspace: stagingWorkspace,
    targetWorkspace: { slug: 'beta-preview', displayName: 'Beta Preview' }
  });
  const resourceSummary = buildWorkspaceResourceSummary(stagingWorkspace);

  assert.deepEqual(workspaceLifecycleStateMachine.states, ['draft', 'provisioning', 'pending_activation', 'active', 'suspended', 'soft_deleted']);
  assert.equal(getWorkspaceRoute('cloneWorkspace').path, '/v1/workspaces/{workspaceId}/clone');
  assert.equal(apiSurface.controlApiBaseUrl.includes('/v1/workspaces/wrk_01betastaging'), true);
  assert.equal(apiSurface.applicationEndpoints.some((endpoint) => endpoint.applicationId === 'app_01betaadmin'), true);
  assert.equal(inheritance.mode, 'clone_workspace');
  assert.equal(inheritance.sharedResourceKeys.includes('topic.events-topic'), true);
  assert.equal(cloneDraft.clonePolicy.resetCredentialReferences, true);
  assert.equal(cloneDraft.resourceInheritance.sourceWorkspaceId, stagingWorkspace.workspaceId);
  assert.equal(controlPlaneSummary.routes.some((route) => route.operationId === 'getWorkspaceApiSurface'), true);
  assert.equal(endpointCards.some((card) => card.audience === 'identity'), true);
  assert.equal(cloneDefaults.entityType, 'workspace_clone');
  assert.equal(resourceSummary.sharedResourceCount >= 1, true);
});
