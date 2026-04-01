/**
 * Kafka backup adapter (stub).
 * TODO: reemplazar por implementación real cuando el mecanismo de backup de Kafka esté instrumentado.
 */

import type { BackupAdapter, BackupCheckResult, AdapterContext } from './types.js'

const ENABLED = process.env.BACKUP_ADAPTER_KAFKA_ENABLED === 'true'

export const kafkaAdapter: BackupAdapter = {
  componentType: 'kafka',
  instanceLabel: 'Bus de mensajería',

  async check(_instanceId: string, _tenantId: string, _context: AdapterContext): Promise<BackupCheckResult> {
    if (!ENABLED) {
      return { status: 'not_configured', detail: 'adapter_disabled_in_deployment' }
    }
    // TODO: implementar consulta real al mecanismo de backup de Kafka
    return { status: 'not_available', detail: 'adapter_not_implemented' }
  },
}
