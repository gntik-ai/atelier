export function tenantAContext(overrides = {}) {
  return {
    tenantId: 'test-tenant-a',
    workspaceId: 'ws-tenant-a-001',
    actorType: 'svc',
    actorId: 'e2e-runner-a',
    ...overrides
  };
}

export function tenantBContext(overrides = {}) {
  return {
    tenantId: 'test-tenant-b',
    workspaceId: 'ws-tenant-b-001',
    actorType: 'svc',
    actorId: 'e2e-runner-b',
    ...overrides
  };
}
