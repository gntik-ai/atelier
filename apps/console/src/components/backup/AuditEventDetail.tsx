import React from 'react'
import type { AuditEventAdmin, AuditEventPublic } from '../../../../../services/backup-status/src/audit/audit-trail.types.js'

interface Props {
  event: AuditEventAdmin | AuditEventPublic
  role: 'admin' | 'tenant_owner'
}

export function AuditEventDetail({ event, role }: Props) {
  if (role === 'admin') {
    const e = event as AuditEventAdmin
    return (
      <div className="space-y-2 p-4 bg-gray-50 rounded-md text-sm">
        <div><strong>ID:</strong> {e.id}</div>
        <div><strong>Correlation ID:</strong> {e.correlation_id}</div>
        {e.operation_id && (
          <div>
            <strong>Operation:</strong>{' '}
            <a href={`/admin/backup/operations/${e.operation_id}`} className="text-blue-600 underline">
              {e.operation_id}
            </a>
          </div>
        )}
        <div><strong>Component:</strong> {e.component_type} / {e.instance_id}</div>
        {e.snapshot_id && <div><strong>Snapshot:</strong> {e.snapshot_id}</div>}
        <div><strong>Actor:</strong> {e.actor_id} ({e.actor_role})</div>
        {e.session_id && <div><strong>Session ID:</strong> {e.session_id}</div>}
        {e.source_ip && <div><strong>Source IP:</strong> {e.source_ip}</div>}
        {e.user_agent && <div><strong>User Agent:</strong> {e.user_agent}</div>}
        {e.rejection_reason && <div><strong>Rejection Reason:</strong> {e.rejection_reason}</div>}
        {e.detail && (
          <div>
            <strong>Detail:</strong> {e.detail}
            {e.detail_truncated && <span className="text-yellow-600 ml-1">(truncated)</span>}
          </div>
        )}
      </div>
    )
  }

  const e = event as AuditEventPublic
  return (
    <div className="space-y-2 p-4 bg-gray-50 rounded-md text-sm">
      <div><strong>ID:</strong> {e.id}</div>
      {e.operation_id && <div><strong>Operation ID:</strong> {e.operation_id}</div>}
      {e.rejection_reason_public && (
        <div><strong>Motivo:</strong> {e.rejection_reason_public}</div>
      )}
    </div>
  )
}
