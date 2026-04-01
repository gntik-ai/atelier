/**
 * Keycloak backup adapter (stub).
 * TODO: reemplazar por implementación real cuando el mecanismo de backup de Keycloak esté instrumentado.
 */

import type { BackupActionAdapter, BackupCheckResult, AdapterContext, AdapterCapabilities, SnapshotInfo, TriggerResult } from './types.js'

const ENABLED = process.env.BACKUP_ADAPTER_KEYCLOAK_ENABLED === 'true'

export const keycloakAdapter: BackupActionAdapter = {
  componentType: 'keycloak',
  instanceLabel: 'Servicio de identidad',

  capabilities(): AdapterCapabilities {
    return { triggerBackup: false, triggerRestore: false, listSnapshots: false }
  },

  async triggerBackup(_instanceId: string, _tenantId: string, _context: AdapterContext): Promise<TriggerResult> {
    throw new Error('not_implemented')
  },

  async triggerRestore(_instanceId: string, _tenantId: string, _snapshotId: string, _context: AdapterContext): Promise<TriggerResult> {
    throw new Error('not_implemented')
  },

  async listSnapshots(_instanceId: string, _tenantId: string, _context: AdapterContext): Promise<SnapshotInfo[]> {
    throw new Error('not_implemented')
  },

  async check(_instanceId: string, _tenantId: string, _context: AdapterContext): Promise<BackupCheckResult> {
    if (!ENABLED) {
      return { status: 'not_configured', detail: 'adapter_disabled_in_deployment' }
    }
    // TODO: implementar consulta real al mecanismo de backup de Keycloak
    return { status: 'not_available', detail: 'adapter_not_implemented' }
  },
}
