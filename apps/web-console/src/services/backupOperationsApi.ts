/**
 * API client for backup operations endpoints.
 */

const API_BASE = (typeof process !== 'undefined' && process.env?.BACKUP_API_URL) || '/api'

export class BackupOperationsApiError extends Error {
  constructor(public statusCode: number, message: string, public code?: string) {
    super(message)
    this.name = 'BackupOperationsApiError'
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options)
  const data = await res.json()
  if (!res.ok) {
    throw new BackupOperationsApiError(res.status, data.error ?? 'Unknown error', data.error)
  }
  return data as T
}

export interface TriggerResponse {
  operation_id: string
  status: string
  accepted_at: string
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
  return request<TriggerResponse>(`${API_BASE}/v1/backup/trigger`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
}

export async function triggerRestore(
  body: { tenant_id: string; component_type: string; instance_id: string; snapshot_id: string },
  token: string,
): Promise<TriggerResponse> {
  return request<TriggerResponse>(`${API_BASE}/v1/backup/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
}

export async function getOperation(id: string, token: string): Promise<OperationResponse> {
  return request<OperationResponse>(`${API_BASE}/v1/backup/operations/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export async function listSnapshots(
  params: { tenant_id: string; component_type: string; instance_id: string },
  token: string,
): Promise<SnapshotsResponse> {
  const qs = new URLSearchParams(params).toString()
  return request<SnapshotsResponse>(`${API_BASE}/v1/backup/snapshots?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}
