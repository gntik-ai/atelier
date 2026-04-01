import React from 'react'
import type { AuditEventType } from '../../../../../services/backup-status/src/audit/audit-trail.types.js'

interface Props {
  eventType: AuditEventType
}

const colorMap: Record<string, string> = {
  requested: 'bg-blue-100 text-blue-800',
  started: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  rejected: 'bg-orange-100 text-orange-800',
}

function getSuffix(eventType: string): string {
  return eventType.split('.')[1] ?? 'unknown'
}

export function AuditEventTypeBadge({ eventType }: Props) {
  const suffix = getSuffix(eventType)
  const color = colorMap[suffix] ?? 'bg-gray-100 text-gray-800'

  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${color}`}>
      {eventType}
    </span>
  )
}
