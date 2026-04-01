/**
 * Internal types for the collector action.
 */

import type { BackupStatus } from '../adapters/types.js'

export interface CollectionResult {
  instanceId: string
  componentType: string
  tenantId: string
  status: BackupStatus
}

export interface CollectorResponse {
  ok: boolean
  processed?: number
  error?: string
}
