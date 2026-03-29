export const FIXTURE_TENANT_ALPHA = {
  tenantId: 'ten_alpha',
  tenantSlug: 'tenant-alpha',
  name: 'Tenant Alpha',
  planId: 'starter',
  region: 'eu-west',
  status: 'active'
} as const

export const FIXTURE_TENANT_BETA = {
  tenantId: 'ten_beta',
  tenantSlug: 'tenant-beta',
  name: 'Tenant Beta',
  planId: 'pro',
  region: 'us-east',
  status: 'active'
} as const

export const FIXTURE_WORKSPACE_A1 = {
  workspaceId: 'wrk_a1',
  workspaceSlug: 'workspace-alpha-1',
  tenantId: 'ten_alpha',
  name: 'Workspace Alpha 1'
} as const

export const FIXTURE_WORKSPACE_A2 = {
  workspaceId: 'wrk_a2',
  workspaceSlug: 'workspace-alpha-2',
  tenantId: 'ten_alpha',
  name: 'Workspace Alpha 2'
} as const

export const FIXTURE_WORKSPACE_B1 = {
  workspaceId: 'wrk_b1',
  workspaceSlug: 'workspace-beta-1',
  tenantId: 'ten_beta',
  name: 'Workspace Beta 1'
} as const
