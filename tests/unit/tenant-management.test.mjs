import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTenantFunctionalConfigurationExport,
  buildTenantPurgeDraft,
  buildTenantResourceInventory,
  evaluateTenantLifecycleMutation
} from '../../services/internal-contracts/src/index.mjs';
import {
  buildTenantPurgeRequestDraft,
  getTenantRoute,
  previewTenantFunctionalExport,
  previewTenantInventory,
  previewTenantLifecycleMutation,
  summarizeTenantManagementSurface,
  tenantLifecycleStateMachine
} from '../../apps/control-plane/src/tenant-management.mjs';
import {
  buildTenantActionChecklist,
  buildTenantExportSummary,
  buildTenantGovernanceCards,
  buildTenantInventoryRows,
  buildTenantPurgeModalDefaults
} from '../../apps/web-console/src/tenant-management.mjs';
import { readDomainSeedFixtures } from '../../scripts/lib/domain-model.mjs';

test('tenant helper modules expose governance dashboard, inventory, export, and purge semantics', () => {
  const fixtures = readDomainSeedFixtures();
  const growthProfile = fixtures.profiles.find((profile) => profile.id === 'growth-multi-workspace');
  const activeTenant = growthProfile.tenant;
  const deletedTenant = {
    ...growthProfile.tenant,
    state: 'deleted',
    governance: {
      ...growthProfile.tenant.governance,
      governanceStatus: 'retention',
      retentionPolicy: {
        ...growthProfile.tenant.governance.retentionPolicy,
        purgeEligibleAt: '2026-03-20T00:00:00Z'
      }
    }
  };

  const inventory = buildTenantResourceInventory({
    tenant: activeTenant,
    workspaces: growthProfile.workspaces,
    externalApplications: growthProfile.externalApplications,
    serviceAccounts: growthProfile.serviceAccounts,
    managedResources: growthProfile.managedResources
  });
  const exportBundle = buildTenantFunctionalConfigurationExport({
    tenant: activeTenant,
    workspaces: growthProfile.workspaces,
    externalApplications: growthProfile.externalApplications,
    serviceAccounts: growthProfile.serviceAccounts,
    managedResources: growthProfile.managedResources
  });
  const controlPlaneSummary = summarizeTenantManagementSurface({
    tenant: activeTenant,
    workspaces: growthProfile.workspaces,
    externalApplications: growthProfile.externalApplications,
    serviceAccounts: growthProfile.serviceAccounts,
    managedResources: growthProfile.managedResources
  });
  const suspendPreview = evaluateTenantLifecycleMutation({
    tenant: activeTenant,
    action: 'suspend',
    workspaces: growthProfile.workspaces,
    managedResources: growthProfile.managedResources
  });
  const reactivatePreview = previewTenantLifecycleMutation({
    tenant: { ...activeTenant, state: 'suspended' },
    action: 'reactivate',
    workspaces: growthProfile.workspaces,
    managedResources: growthProfile.managedResources
  });
  const logicalDeletePreview = previewTenantLifecycleMutation({
    tenant: activeTenant,
    action: 'soft_delete',
    workspaces: growthProfile.workspaces,
    managedResources: growthProfile.managedResources
  });
  const purgeBlocked = evaluateTenantLifecycleMutation({
    tenant: deletedTenant,
    action: 'purge',
    workspaces: growthProfile.workspaces,
    managedResources: growthProfile.managedResources,
    now: '2026-03-24T00:00:00Z',
    hasElevatedAccess: false,
    hasSecondConfirmation: false
  });
  const purgeReady = previewTenantLifecycleMutation({
    tenant: deletedTenant,
    action: 'purge',
    workspaces: growthProfile.workspaces,
    managedResources: growthProfile.managedResources,
    now: '2026-03-24T00:00:00Z',
    hasElevatedAccess: true,
    hasSecondConfirmation: true
  });
  const purgeDraft = buildTenantPurgeDraft({ tenant: deletedTenant, actorUserId: 'usr_01betatenantadmin', approvalTicket: 'APR-42' });
  const controlPlanePurgeDraft = buildTenantPurgeRequestDraft({
    tenant: deletedTenant,
    actorUserId: 'usr_01betatenantadmin',
    approvalTicket: 'APR-42'
  });
  const cards = buildTenantGovernanceCards({
    tenant: activeTenant,
    workspaces: growthProfile.workspaces,
    externalApplications: growthProfile.externalApplications,
    serviceAccounts: growthProfile.serviceAccounts,
    managedResources: growthProfile.managedResources
  });
  const rows = buildTenantInventoryRows({
    tenant: activeTenant,
    workspaces: growthProfile.workspaces,
    externalApplications: growthProfile.externalApplications,
    serviceAccounts: growthProfile.serviceAccounts,
    managedResources: growthProfile.managedResources
  });
  const exportSummary = buildTenantExportSummary({
    tenant: activeTenant,
    workspaces: growthProfile.workspaces,
    externalApplications: growthProfile.externalApplications,
    serviceAccounts: growthProfile.serviceAccounts,
    managedResources: growthProfile.managedResources
  });
  const actionChecklist = buildTenantActionChecklist({
    tenant: deletedTenant,
    action: 'purge',
    workspaces: growthProfile.workspaces,
    managedResources: growthProfile.managedResources,
    now: '2026-03-24T00:00:00Z',
    hasElevatedAccess: true,
    hasSecondConfirmation: true
  });
  const purgeModalDefaults = buildTenantPurgeModalDefaults({
    tenant: deletedTenant,
    actorUserId: 'usr_01betatenantadmin',
    approvalTicket: 'APR-42'
  });

  assert.deepEqual(tenantLifecycleStateMachine.states, ['pending_activation', 'active', 'suspended', 'deleted']);
  assert.equal(getTenantRoute('getTenantGovernanceDashboard').path, '/v1/tenants/{tenantId}/dashboard');
  assert.equal(getTenantRoute('purgeTenant').path, '/v1/tenants/{tenantId}/purge');
  assert.equal(inventory.workspaceCount, 3);
  assert.equal(inventory.workspaces.length, 3);
  assert.equal(exportBundle.inventory.managedResourceCount, growthProfile.managedResources.length);
  assert.equal(exportBundle.redactionMode, 'secret_references_only');
  assert.equal(controlPlaneSummary.routes.some((route) => route.operationId === 'listTenants'), true);
  assert.equal(controlPlaneSummary.dashboard.labels.length >= 2, true);
  assert.equal(suspendPreview.allowed, true);
  assert.equal(suspendPreview.descendantImpacts.some((impact) => impact.targetState === 'suspended'), true);
  assert.equal(reactivatePreview.allowed, true);
  assert.equal(reactivatePreview.nextState, 'active');
  assert.equal(logicalDeletePreview.allowed, true);
  assert.equal(logicalDeletePreview.nextState, 'deleted');
  assert.equal(logicalDeletePreview.descendantImpacts.every((impact) => ['soft_deleted', 'suspended'].includes(impact.targetState)), true);
  assert.equal(purgeBlocked.allowed, false);
  assert.match(purgeBlocked.blocker, /elevated access/);
  assert.equal(purgeReady.allowed, true);
  assert.equal(purgeReady.nextState, 'purged');
  assert.deepEqual(purgeReady.requiredControls, ['elevated_access', 'dual_confirmation', 'retention_elapsed', 'export_checkpoint']);
  assert.equal(purgeDraft.approvalTicket, 'APR-42');
  assert.equal(controlPlanePurgeDraft.confirmationText.includes('PURGE ten_01growthbeta'), true);
  assert.equal(cards.some((card) => card.id === 'tenant-lifecycle'), true);
  assert.equal(rows.some((row) => row.workspaceId === 'wrk_01betaprod'), true);
  assert.equal(exportSummary.exportId.startsWith('exp_'), true);
  assert.equal(actionChecklist.allowed, true);
  assert.equal(purgeModalDefaults.requiresElevatedAccess, true);
  assert.equal(previewTenantInventory({
    tenant: activeTenant,
    workspaces: growthProfile.workspaces,
    externalApplications: growthProfile.externalApplications,
    serviceAccounts: growthProfile.serviceAccounts,
    managedResources: growthProfile.managedResources
  }).workspaceCount, 3);
  assert.equal(previewTenantFunctionalExport({
    tenant: activeTenant,
    workspaces: growthProfile.workspaces,
    externalApplications: growthProfile.externalApplications,
    serviceAccounts: growthProfile.serviceAccounts,
    managedResources: growthProfile.managedResources
  }).inventory.workspaceCount, 3);
});
