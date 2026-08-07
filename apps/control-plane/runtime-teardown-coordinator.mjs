// Owner-safe aggregate runtime teardown boundary. Runtime adapters are injected by the
// deployment; absence or disagreement is deliberately treated as pending, never success.
export function createRuntimeTeardownCoordinator({ store, runtime }) {
  if (!store) throw new TypeError('runtime teardown requires store');
  const adapter = runtime ?? { async cleanup({ functions = [], mcp = [] }) { return { ready: false, pending: [...functions, ...mcp], reason: 'runtime_adapter_unavailable' }; } };
  const run = async (pool, scope, id, correlationId) => {
    const ownership = await store.listRuntimeOwnership(pool, { ...scope, [scope.tenantId ? 'tenantId' : 'workspaceId']: id });
    const result = await adapter.cleanup({ ...ownership, ...scope, tenantId: ownership.tenantId ?? scope.tenantId, workspaceId: scope.workspaceId ?? id, correlationId });
    const pending = result?.pending ?? (!result?.ready ? [...(ownership.functions ?? []), ...(ownership.mcp ?? [])] : []);
    if (!result?.ready || pending.length) {
      await store.deferAggregateCleanup(pool, { tenantId: ownership.tenantId ?? scope.tenantId, workspaceId: scope.workspaceId ?? (scope.tenantId ? null : id), resources: pending.length ? pending : [...(ownership.functions ?? []), ...(ownership.mcp ?? [])], correlationId });
      return { pending: true, statusCode: 202, tenantId: ownership.tenantId ?? scope.tenantId, workspaceId: scope.workspaceId ?? (scope.tenantId ? null : id), obligations: pending };
    }
    return { pending: false, finalize: true, tenantId: ownership.tenantId ?? scope.tenantId, workspaceId: scope.workspaceId ?? (scope.tenantId ? null : id) };
  };
  return {
    purgeTenant: (pool, tenantId, correlationId) => run(pool, { tenantId }, tenantId, correlationId),
    purgeWorkspace: (pool, workspaceId, correlationId) => run(pool, { workspaceId }, workspaceId, correlationId),
  };
}
