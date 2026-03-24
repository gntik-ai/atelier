import {
  buildTenantPurgeRequestDraft,
  previewTenantFunctionalExport,
  previewTenantInventory,
  previewTenantLifecycleMutation,
  summarizeTenantManagementSurface
} from '../../control-plane/src/tenant-management.mjs';

export function buildTenantGovernanceCards({
  tenant,
  workspaces = [],
  externalApplications = [],
  serviceAccounts = [],
  managedResources = [],
  generatedAt
}) {
  const surface = summarizeTenantManagementSurface({
    tenant,
    workspaces,
    externalApplications,
    serviceAccounts,
    managedResources,
    generatedAt
  });

  return [
    {
      id: 'tenant-lifecycle',
      title: 'Lifecycle',
      value: surface.dashboard.state,
      emphasis: surface.dashboard.governanceStatus,
      secondary: `Allowed actions: ${surface.dashboard.allowedActions.join(', ') || 'none'}`
    },
    {
      id: 'tenant-quotas',
      title: 'Quota posture',
      value: surface.dashboard.quotaAlerts.length === 0 ? 'nominal' : `${surface.dashboard.quotaAlerts.length} alert(s)`,
      emphasis: surface.dashboard.quotaAlerts.some((alert) => alert.severity === 'blocked') ? 'blocked' : 'warning',
      secondary: `Retention: ${surface.dashboard.retentionDays ?? 'n/a'} days`
    },
    {
      id: 'tenant-inventory',
      title: 'Inventory',
      value: `${surface.dashboard.inventory.managedResourceCount} resources`,
      secondary: `${surface.dashboard.inventory.workspaceCount} workspace(s), ${surface.dashboard.inventory.applicationCount} app(s)`
    },
    {
      id: 'tenant-export',
      title: 'Recovery export',
      value: surface.dashboard.lastExportId ?? 'none',
      secondary: surface.dashboard.deleteProtection ? 'Delete protection enabled' : 'Delete protection disabled'
    }
  ];
}

export function buildTenantInventoryRows({
  tenant,
  workspaces = [],
  externalApplications = [],
  serviceAccounts = [],
  managedResources = [],
  generatedAt
}) {
  const inventory = previewTenantInventory({
    tenant,
    workspaces,
    externalApplications,
    serviceAccounts,
    managedResources,
    generatedAt
  });

  return inventory.workspaces.map((workspace) => ({
    workspaceId: workspace.workspaceId,
    workspaceSlug: workspace.workspaceSlug,
    environment: workspace.environment,
    state: workspace.state,
    managedResourceCount: workspace.managedResourceCount,
    applicationCount: workspace.applicationCount,
    serviceAccountCount: workspace.serviceAccountCount
  }));
}

export function buildTenantExportSummary({
  tenant,
  workspaces = [],
  externalApplications = [],
  serviceAccounts = [],
  managedResources = [],
  generatedAt
}) {
  return previewTenantFunctionalExport({
    tenant,
    workspaces,
    externalApplications,
    serviceAccounts,
    managedResources,
    generatedAt
  });
}

export function buildTenantActionChecklist({
  tenant,
  action,
  workspaces = [],
  managedResources = [],
  now,
  hasElevatedAccess,
  hasSecondConfirmation
}) {
  return previewTenantLifecycleMutation({
    tenant,
    action,
    workspaces,
    managedResources,
    now,
    hasElevatedAccess,
    hasSecondConfirmation
  });
}

export function buildTenantPurgeModalDefaults({ tenant, actorUserId = null, approvalTicket = '' }) {
  return buildTenantPurgeRequestDraft({ tenant, actorUserId, approvalTicket });
}
