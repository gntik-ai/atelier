/**
 * Adapter registry — singleton that maps componentType → BackupAdapter.
 */
const fallbackAdapter = {
    componentType: 'unknown',
    instanceLabel: 'Componente desconocido',
    async check() {
        return { status: 'not_available' };
    },
};
class AdapterRegistryImpl {
    adapters = new Map();
    register(adapter) {
        this.adapters.set(adapter.componentType, adapter);
    }
    get(componentType) {
        return this.adapters.get(componentType) ?? fallbackAdapter;
    }
    getAll() {
        return [...this.adapters.values()];
    }
}
export const adapterRegistry = new AdapterRegistryImpl();
export function isActionAdapter(adapter) {
    return (adapter !== null &&
        typeof adapter === 'object' &&
        typeof adapter.capabilities === 'function');
}
export function getCapabilities(componentType) {
    const adapter = adapterRegistry.get(componentType);
    if (isActionAdapter(adapter)) {
        return adapter.capabilities();
    }
    return { triggerBackup: false, triggerRestore: false, listSnapshots: false };
}
