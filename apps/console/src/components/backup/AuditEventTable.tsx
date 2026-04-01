import React, { useState } from 'react'
import { AuditEventTypeBadge } from './AuditEventTypeBadge.js'
import { AuditEventDetail } from './AuditEventDetail.js'
import type { AuditEventAdmin, AuditEventPublic } from '../../../../../services/backup-status/src/audit/audit-trail.types.js'

interface Props {
  events: (AuditEventAdmin | AuditEventPublic)[]
  role: 'admin' | 'tenant_owner'
}

export function AuditEventTable({ events, role }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  return (
    <table className="min-w-full divide-y divide-gray-200 text-sm">
      <thead className="bg-gray-50">
        <tr>
          <th className="px-4 py-2 text-left">Timestamp</th>
          <th className="px-4 py-2 text-left">Event Type</th>
          <th className="px-4 py-2 text-left">Actor</th>
          <th className="px-4 py-2 text-left">Tenant</th>
          <th className="px-4 py-2 text-left">Result</th>
          {role === 'admin' && <th className="px-4 py-2 text-left">Source IP</th>}
          {role === 'admin' && <th className="px-4 py-2 text-left">Component</th>}
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {events.map((event) => (
          <React.Fragment key={event.id}>
            <tr
              className="cursor-pointer hover:bg-gray-50"
              onClick={() => setExpandedId(expandedId === event.id ? null : event.id)}
            >
              <td className="px-4 py-2">{new Date(event.occurred_at).toLocaleString()}</td>
              <td className="px-4 py-2">
                <AuditEventTypeBadge eventType={event.event_type} />
              </td>
              <td className="px-4 py-2">
                {role === 'admin' ? (event as AuditEventAdmin).actor_id : '—'}
              </td>
              <td className="px-4 py-2">{event.tenant_id}</td>
              <td className="px-4 py-2">{event.result}</td>
              {role === 'admin' && (
                <td className="px-4 py-2">{(event as AuditEventAdmin).source_ip ?? '—'}</td>
              )}
              {role === 'admin' && (
                <td className="px-4 py-2">
                  {(event as AuditEventAdmin).component_type}/{(event as AuditEventAdmin).instance_id}
                </td>
              )}
            </tr>
            {expandedId === event.id && (
              <tr>
                <td colSpan={role === 'admin' ? 7 : 5} className="px-4 py-2">
                  <AuditEventDetail event={event} role={role} />
                </td>
              </tr>
            )}
          </React.Fragment>
        ))}
      </tbody>
    </table>
  )
}
