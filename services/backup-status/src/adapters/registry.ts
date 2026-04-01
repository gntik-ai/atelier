/**
 * Adapter registry — singleton that maps componentType → BackupAdapter.
 */

import type { BackupAdapter, BackupCheckResult, AdapterCapabilities, BackupActionAdapter } from './types.js'

const fallbackAdapter: BackupAdapter = {
  componentType: 'unknown',
  instanceLabel: 'Componente desconocido',
  async check(): Promise<BackupCheckResult> {
    return { status: 'not_available' }
  },
}

class AdapterRegistryImpl {
  private adapters = new Map<string, BackupAdapter>()

  register(adapter: BackupAdapter): void {
    this.adapters.set(adapter.componentType, adapter)
  }

  get(componentType: string): BackupAdapter {
    return this.adapters.get(componentType) ?? fallbackAdapter
  }

  getAll(): BackupAdapter[] {
    return [...this.adapters.values()]
  }
}

export const adapterRegistry = new AdapterRegistryImpl()

export function isActionAdapter(adapter: unknown): adapter is BackupActionAdapter {
  return (
    adapter !== null &&
    typeof adapter === 'object' &&
    typeof (adapter as BackupActionAdapter).capabilities === 'function'
  )
}

export function getCapabilities(componentType: string): AdapterCapabilities {
  const adapter = adapterRegistry.get(componentType)
  if (isActionAdapter(adapter)) {
    return adapter.capabilities()
  }
  return { triggerBackup: false, triggerRestore: false, listSnapshots: false }
}
