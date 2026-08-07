// Owner-safe aggregate runtime teardown boundary. Runtime adapters are injected by the
// deployment; absence or disagreement is deliberately treated as pending, never success.
export function createRuntimeTeardownCoordinator({ store, runtime }) {
  if (!store) throw new TypeError('runtime teardown requires store');
  const adapter = runtime ?? { async cleanup({ functions = [] }) { return { ready: false, pending: functions, reason: 'runtime_adapter_unavailable' }; } };
  return {
    async purgeTenant(pool, tenantId, correlationId) {
      const ownership = await store.listRuntimeOwnership(pool, { tenantId });
      const result = await adapter.cleanup({ ...ownership, tenantId, correlationId });
      if (!result?.ready || result.pending?.length) {
        await store.deferAggregateCleanup(pool, { tenantId, workspaceId: null, resources: result?.pending ?? ownership.functions, correlationId });
        return { pending: true, statusCode: 202, tenantId, obligations: result?.pending ?? [] };
      }
      return { pending: false, finalize: true, tenantId };
    },
    async purgeWorkspace(pool, workspaceId, correlationId) {
      const ownership = await store.listRuntimeOwnership(pool, { workspaceId });
      const result = await adapter.cleanup({ ...ownership, workspaceId, correlationId });
      if (!result?.ready || result.pending?.length) {
        await store.deferAggregateCleanup(pool, { tenantId: ownership.tenantId, workspaceId, resources: result?.pending ?? ownership.functions, correlationId });
        return { pending: true, statusCode: 202, workspaceId, obligations: result?.pending ?? [] };
      }
      return { pending: false, finalize: true, workspaceId };
    },
  };
}
