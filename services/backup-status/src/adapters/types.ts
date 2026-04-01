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
