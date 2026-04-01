/**
 * S3-compatible storage backup adapter (stub).
 * TODO: reemplazar por implementación real cuando el mecanismo de backup de S3 esté instrumentado.
 */

import type { BackupAdapter, BackupCheckResult, AdapterContext } from './types.js'

const ENABLED = process.env.BACKUP_ADAPTER_S3_ENABLED === 'true'

export const s3Adapter: BackupAdapter = {
  componentType: 's3',
  instanceLabel: 'Almacenamiento de objetos',

  async check(_instanceId: string, _tenantId: string, _context: AdapterContext): Promise<BackupCheckResult> {
    if (!ENABLED) {
      return { status: 'not_configured', detail: 'adapter_disabled_in_deployment' }
    }
    // TODO: implementar consulta real al mecanismo de backup de S3
    return { status: 'not_available', detail: 'adapter_not_implemented' }
  },
}
