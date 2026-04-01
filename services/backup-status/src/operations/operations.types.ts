/**
 * Types for backup/restore operation lifecycle.
 */

export type OperationType = 'backup' | 'restore'

export type OperationStatus =
  | 'accepted'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'rejected'

export interface OperationRecord {
  id: string
  type: OperationType
  tenantId: string
  componentType: string
  instanceId: string
  status: OperationStatus
  requesterId: string
  requesterRole: string
  snapshotId?: string | null
  failureReason?: string | null
  failureReasonPublic?: string | null
  adapterOperationId?: string | null
  acceptedAt: Date
  inProgressAt?: Date | null
  completedAt?: Date | null
  failedAt?: Date | null
  metadata?: Record<string, unknown> | null
}

export interface OperationResponseV1 {
  schema_version: '1'
  operation: {
    id: string
    type: OperationType
    tenant_id: string
    component_type: string
    instance_id: string
    status: OperationStatus
    requester_id: string
    accepted_at: string
    in_progress_at: string | null
    completed_at: string | null
    failed_at: string | null
    snapshot_id: string | null
    failure_reason?: string | null
    failure_reason_public: string | null
  }
}

export interface OperationResponse {
  operation_id: string
  status: OperationStatus
  accepted_at: string
}
