import { useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useOperationLogs } from '@/lib/console-operations'
import { cn } from '@/lib/utils'

interface OperationLogEntriesListProps {
  operationId: string
}

const PAGE_SIZE = 20

const LEVEL_META = {
  info: 'border-blue-200 bg-blue-50 text-blue-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  error: 'border-red-200 bg-red-50 text-red-700'
} as const

function formatRelativeTime(value: string): string {
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) {
    return value
  }

  const diffMs = timestamp - Date.now()
  const diffMinutes = Math.round(diffMs / 60_000)
  const formatter = new Intl.RelativeTimeFormat('es', { numeric: 'auto' })

  if (Math.abs(diffMinutes) < 60) {
    return formatter.format(diffMinutes, 'minute')
  }

  const diffHours = Math.round(diffMinutes / 60)
  if (Math.abs(diffHours) < 24) {
    return formatter.format(diffHours, 'hour')
  }

  const diffDays = Math.round(diffHours / 24)
  return formatter.format(diffDays, 'day')
}

export function OperationLogEntriesList({ operationId }: OperationLogEntriesListProps) {
  const [offset, setOffset] = useState(0)
  const { data, isLoading } = useOperationLogs(operationId, { limit: PAGE_SIZE, offset })

  const canGoBack = offset > 0
  const canGoNext = useMemo(() => {
    if (!data) {
      return false
    }

    return offset + data.entries.length < data.total
  }, [data, offset])

  if (isLoading && !data) {
    return (
      <div className="space-y-3" aria-busy="true">
        {[0, 1, 2].map((row) => (
          <div key={row} className="h-16 animate-pulse rounded-2xl border border-border/70 bg-muted/60" />
        ))}
      </div>
    )
  }

  if (!data || data.entries.length === 0) {
    return <p role="status" className="text-sm text-muted-foreground">La operación aún no ha comenzado a ejecutarse.</p>
  }

  return (
    <div className="space-y-4">
      <ul className="space-y-3" aria-label="Entradas de log resumidas">
        {data.entries.map((entry) => (
          <li key={entry.logEntryId} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Badge className={cn('rounded-full border px-2.5 py-1 text-xs font-medium', LEVEL_META[entry.level])}>{entry.level}</Badge>
              <span className="text-xs text-muted-foreground">{formatRelativeTime(entry.occurredAt)}</span>
            </div>
            <p className="mt-3 text-sm leading-6 text-foreground">{entry.message}</p>
          </li>
        ))}
      </ul>

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="outline" disabled={!canGoBack} onClick={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))}>
          Anterior
        </Button>
        <Button type="button" variant="outline" disabled={!canGoNext} onClick={() => setOffset((current) => current + PAGE_SIZE)}>
          Siguiente
        </Button>
      </div>
    </div>
  )
}

export default OperationLogEntriesList
