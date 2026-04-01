/**
 * API client for backup operations endpoints.
 */

const API_BASE = (typeof process !== 'undefined' && process.env?.BACKUP_API_URL) || '/api'

export class BackupOperationsApiError extends Error {
  statusCode: number
  code?: string

  constructor(statusCode: number, message: string, code?: string) {
    super(message)
    this.name = 'BackupOperationsApiError'
    this.statusCode = statusCode
    this.code = code
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options)
  const data = await res.json().catch(() => ({} as Record<string, unknown>))
  if (!res.ok) {
    throw new BackupOperationsApiError(res.status, (data as { error?: string }).error ?? 'Unknown error', (data as { error?: string }).error)
  }
  return data as T
}

export interface TriggerResponse {
  operation_id: string
  status: string
  accepted_at: string
  execution_mode?: 'operative' | 'simulation'
  target_environment?: string
}

export interface OperationResponse {
  schema_version: string
  operation: {
    id: string
    type: string
    tenant_id: string
    component_type: string
    instance_id: string
    status: string
    requester_id: string
    accepted_at: string
    in_progress_at: string | null
    completed_at: string | null
    failed_at: string | null
    snapshot_id: string | null
    failure_reason?: string | null
    failure_reason_public: string | null
    execution_mode?: 'operative' | 'simulation'
    target_environment?: string | null
    validation_summary?: {
      outcome: 'completed' | 'warning' | 'failed'
      checkedAt: string
      checkedBy: string
      environment: string
      snapshotId: string
      checks: Array<{ code: string; result: 'ok' | 'warning' | 'blocking_error'; message: string; metadata?: Record<string, unknown> }>
    } | null
    evidence_refs?: Array<{ kind: 'snapshot' | 'validation' | 'audit' | 'operation'; id: string; label?: string; href?: string | null }>
  }
}

export interface SnapshotItem {
  snapshot_id: string
  created_at: string
  available: boolean
  size_bytes: number | null
  label: string | null
}

export interface SnapshotsResponse {
  schema_version: string
  tenant_id: string
  component_type: string
  instance_id: string
  snapshots: SnapshotItem[]
}

export async function triggerBackup(
  body: { tenant_id: string; component_type: string; instance_id: string },
  token: string,
): Promise<TriggerResponse> {
  return await request<TriggerResponse>(`${API_BASE}/v1/backup/trigger`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
}

export async function triggerRestore(
  body: { tenant_id: string; component_type: string; instance_id: string; snapshot_id: string; execution_mode?: 'operative' | 'simulation' },
  token: string,
): Promise<TriggerResponse> {
  return await request<TriggerResponse>(`${API_BASE}/v1/backup/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
}

export async function getOperation(id: string, token: string): Promise<OperationResponse> {
  return await request<OperationResponse>(`${API_BASE}/v1/backup/operations/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

// --- Restore confirmation flow (US-BKP-01-T04) ---

export interface InitiateRestoreBody {
  tenant_id: string
  component_type: string
  instance_id: string
  snapshot_id: string
  scope?: 'partial' | 'full'
  execution_mode?: 'operative' | 'simulation'
}

export interface PrecheckResultItem {
  code: string
  result: 'ok' | 'warning' | 'blocking_error'
  message: string
  metadata?: Record<string, unknown>
}

export type RiskLevel = 'normal' | 'elevated' | 'critical'
export type SecondFactorType = 'otp' | 'second_actor'

export interface InitiateRestoreResponse {
  schema_version: '2'
  confirmation_token: string
  confirmation_request_id: string
  expires_at: string
  ttl_seconds: number
  risk_level: RiskLevel
  available_second_factors: SecondFactorType[]
  prechecks: PrecheckResultItem[]
  warnings: string[]
  target: {
    tenant_id: string
    tenant_name: string
    component_type: string
    instance_id: string
    snapshot_id: string
    snapshot_created_at: string
    snapshot_age_hours: number
  }
}

export interface ConfirmRestoreBody {
  confirmation_token: string
  confirmed: boolean
  tenant_name_confirmation?: string
  acknowledge_warnings?: boolean
  second_factor_type?: SecondFactorType
  otp_code?: string
  second_actor_token?: string
}

export interface ConfirmRestoreResponse {
  schema_version: '2'
  operation_id?: string
  status: 'accepted' | 'aborted'
  accepted_at?: string
  confirmation_request_id?: string
}

export interface ConfirmationStatusResponse {
  schema_version: '2'
  id: string
  status: 'pending_confirmation' | 'confirmed' | 'aborted' | 'expired' | 'rejected'
  risk_level: RiskLevel
  expires_at: string
  created_at: string
}

export async function initiateRestore(body: InitiateRestoreBody, token: string): Promise<InitiateRestoreResponse> {
  return await request<InitiateRestoreResponse>(`${API_BASE}/v1/backup/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
}

export async function confirmRestore(body: ConfirmRestoreBody, token: string): Promise<ConfirmRestoreResponse> {
  return await request<ConfirmRestoreResponse>(`${API_BASE}/v1/backup/restore/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
}

export async function abortRestore(confirmationToken: string, authToken: string): Promise<void> {
  await request<ConfirmRestoreResponse>(`${API_BASE}/v1/backup/restore/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({ confirmation_token: confirmationToken, confirmed: false }),
  })
}

export async function getConfirmationStatus(confirmationRequestId: string, authToken: string): Promise<ConfirmationStatusResponse> {
  return await request<ConfirmationStatusResponse>(`${API_BASE}/v1/backup/restore/confirm/${confirmationRequestId}`, {
    headers: { Authorization: `Bearer ${authToken}` },
  })
}

export async function listSnapshots(
  params: { tenant_id: string; component_type: string; instance_id: string },
  token: string,
): Promise<SnapshotsResponse> {
  const qs = new URLSearchParams(params).toString()
  return await request<SnapshotsResponse>(`${API_BASE}/v1/backup/snapshots?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}
