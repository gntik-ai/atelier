import React, { useState } from 'react'
import { AuditEventFilters } from '../../components/backup/AuditEventFilters.js'
import { AuditEventTable } from '../../components/backup/AuditEventTable.js'
import { useAuditEvents } from '../../hooks/useAuditEvents.js'
import type { AuditQueryFilters } from '../../../../../services/backup-status/src/audit/audit-trail.types.js'

interface Props {
  token: string
}

export function BackupAuditPage({ token }: Props) {
  const [filters, setFilters] = useState<AuditQueryFilters>({})

  const { data, isLoading, hasNextPage, fetchNextPage } = useAuditEvents({
    filters,
    token,
  })

  const events = data?.pages.flatMap((p) => p.events) ?? []

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Backup Audit Trail</h1>
      <AuditEventFilters
        role="admin"
        onChange={(patch) => setFilters((prev) => ({ ...prev, ...patch }))}
      />
      {isLoading ? (
        <p>Loading...</p>
      ) : (
        <>
          <AuditEventTable events={events} role="admin" />
          {hasNextPage && (
            <button
              onClick={() => fetchNextPage()}
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Load more
            </button>
          )}
        </>
      )}
    </div>
  )
}
