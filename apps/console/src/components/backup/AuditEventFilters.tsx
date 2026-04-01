import React, { useCallback, useState } from 'react'
import type { AuditQueryFilters, AuditEventType } from '../../../../../services/backup-status/src/audit/audit-trail.types.js'

interface Props {
  role: 'admin' | 'tenant_owner'
  onChange: (filters: Partial<AuditQueryFilters>) => void
}

const EVENT_TYPES: AuditEventType[] = [
  'backup.requested', 'backup.started', 'backup.completed', 'backup.failed', 'backup.rejected',
  'restore.requested', 'restore.started', 'restore.completed', 'restore.failed', 'restore.rejected',
]

export function AuditEventFilters({ role, onChange }: Props) {
  const [tenantId, setTenantId] = useState('')
  const [actorId, setActorId] = useState('')
  const [eventType, setEventType] = useState<string>('')
  const [result, setResult] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const debounceRef = React.useRef<ReturnType<typeof setTimeout>>()

  const emitChange = useCallback(
    (patch: Partial<AuditQueryFilters>) => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => onChange(patch), 300)
    },
    [onChange],
  )

  return (
    <div className="flex flex-wrap gap-3 mb-4">
      {role === 'admin' && (
        <input
          placeholder="Tenant ID"
          value={tenantId}
          onChange={(e) => { setTenantId(e.target.value); emitChange({ tenantId: e.target.value || undefined }) }}
          className="border rounded px-2 py-1 text-sm"
        />
      )}
      {role === 'admin' && (
        <input
          placeholder="Actor ID"
          value={actorId}
          onChange={(e) => { setActorId(e.target.value); emitChange({ actorId: e.target.value || undefined }) }}
          className="border rounded px-2 py-1 text-sm"
        />
      )}
      <select
        value={eventType}
        onChange={(e) => {
          setEventType(e.target.value)
          emitChange({ eventType: (e.target.value || undefined) as AuditEventType | undefined })
        }}
        className="border rounded px-2 py-1 text-sm"
      >
        <option value="">All event types</option>
        {EVENT_TYPES.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>
      <select
        value={result}
        onChange={(e) => { setResult(e.target.value); emitChange({ result: e.target.value || undefined }) }}
        className="border rounded px-2 py-1 text-sm"
      >
        <option value="">All results</option>
        <option value="accepted">accepted</option>
        <option value="rejected">rejected</option>
        <option value="started">started</option>
        <option value="completed">completed</option>
        <option value="failed">failed</option>
      </select>
      <input
        type="datetime-local"
        value={from}
        onChange={(e) => { setFrom(e.target.value); emitChange({ from: e.target.value ? new Date(e.target.value) : undefined }) }}
        className="border rounded px-2 py-1 text-sm"
      />
      <input
        type="datetime-local"
        value={to}
        onChange={(e) => { setTo(e.target.value); emitChange({ to: e.target.value ? new Date(e.target.value) : undefined }) }}
        className="border rounded px-2 py-1 text-sm"
      />
    </div>
  )
}
