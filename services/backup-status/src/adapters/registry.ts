/**
 * Adapter registry — singleton that maps componentType → BackupAdapter.
 */

import type { BackupAdapter, BackupCheckResult } from './types.js'

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
