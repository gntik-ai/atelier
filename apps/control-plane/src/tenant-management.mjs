import {
  buildTenantFunctionalConfigurationExport,
  buildTenantPurgeDraft,
  buildTenantResourceInventory,
  evaluateTenantLifecycleMutation,
  filterPublicRoutes,
  getApiFamily,
  getBusinessStateMachine,
  getPublicRoute,
  summarizeTenantGovernanceDashboard
} from '../../../services/internal-contracts/src/index.mjs';

export const tenantApiFamily = getApiFamily('tenants');
export const tenantLifecycleStateMachine = getBusinessStateMachine('tenant_lifecycle');
export const tenantManagementRoutes = filterPublicRoutes({ family: 'tenants' });

export function getTenantRoute(operationId) {
  return getPublicRoute(operationId);
}

export function summarizeTenantManagementSurface({
  tenant,
  workspaces = [],
  externalApplications = [],
  serviceAccounts = [],
  managedResources = [],
  generatedAt
}) {
  const dashboard = summarizeTenantGovernanceDashboard({
    tenant,
    workspaces,
    externalApplications,
    serviceAccounts,
    managedResources,
    generatedAt
  });

  return {
    family: tenantApiFamily,
    lifecycle: tenantLifecycleStateMachine,
    dashboard,
    routes: tenantManagementRoutes
  };
}

export function previewTenantInventory({
  tenant,
  workspaces = [],
  externalApplications = [],
  serviceAccounts = [],
  managedResources = [],
  generatedAt
}) {
  return buildTenantResourceInventory({
    tenant,
    workspaces,
    externalApplications,
    serviceAccounts,
    managedResources,
    generatedAt
  });
}

export function previewTenantFunctionalExport({
  tenant,
  workspaces = [],
  externalApplications = [],
  serviceAccounts = [],
  managedResources = [],
  generatedAt
}) {
  return buildTenantFunctionalConfigurationExport({
    tenant,
    workspaces,
    externalApplications,
    serviceAccounts,
    managedResources,
    generatedAt
  });
}

export function previewTenantLifecycleMutation({
  tenant,
  action,
  workspaces = [],
  managedResources = [],
  now,
  hasElevatedAccess,
  hasSecondConfirmation
}) {
  return evaluateTenantLifecycleMutation({
    tenant,
    action,
    workspaces,
    managedResources,
    now,
    hasElevatedAccess,
    hasSecondConfirmation
  });
}

export function buildTenantPurgeRequestDraft({ tenant, actorUserId = null, approvalTicket = '', confirmationText = '' }) {
  return buildTenantPurgeDraft({ tenant, actorUserId, approvalTicket, confirmationText });
}
