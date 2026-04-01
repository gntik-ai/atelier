/**
 * Adapter interface and shared types for backup status checks.
 */

export type BackupStatus =
  | 'success'
  | 'failure'
  | 'partial'
  | 'in_progress'
  | 'not_configured'
  | 'not_available'
  | 'pending'

export interface AdapterContext {
  deploymentProfile: string
  serviceAccountToken?: string
  k8sNamespace?: string
  adapterConfig?: Record<string, unknown>
}

export interface BackupCheckResult {
  status: BackupStatus
  lastSuccessfulBackupAt?: Date
  detail?: string
  metadata?: Record<string, unknown>
}

export interface BackupAdapter {
  readonly componentType: string
  readonly instanceLabel: string
  check(
    instanceId: string,
    tenantId: string,
    context: AdapterContext,
  ): Promise<BackupCheckResult>
}

export interface AdapterCapabilities {
  triggerBackup: boolean
  triggerRestore: boolean
  listSnapshots: boolean
}

export interface SnapshotInfo {
  snapshotId: string
  createdAt: Date
  available: boolean
  sizeBytes?: number
  label?: string
}

export interface TriggerResult {
  adapterOperationId?: string
  metadata?: Record<string, unknown>
}

/**
 * Extension of BackupAdapter for adapters supporting mutation actions.
 */
export interface BackupActionAdapter extends BackupAdapter {
  capabilities(): AdapterCapabilities
  triggerBackup(
    instanceId: string,
    tenantId: string,
    context: AdapterContext,
  ): Promise<TriggerResult>
  triggerRestore(
    instanceId: string,
    tenantId: string,
    snapshotId: string,
    context: AdapterContext,
  ): Promise<TriggerResult>
  listSnapshots(
    instanceId: string,
    tenantId: string,
    context: AdapterContext,
  ): Promise<SnapshotInfo[]>
}
