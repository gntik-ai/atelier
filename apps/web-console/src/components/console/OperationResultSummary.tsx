import { useMemo } from 'react'

import { useOperationResult } from '@/lib/console-operations'

interface OperationResultSummaryProps {
  operationId: string
}

function formatCompletedAt(value: string | null): string | null {
  if (!value) {
    return null
  }

  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) {
    return value
  }

  return new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp)
}

export function OperationResultSummary({ operationId }: OperationResultSummaryProps) {
  const { data, isLoading } = useOperationResult(operationId)
  const completedAt = useMemo(() => formatCompletedAt(data?.completedAt ?? null), [data?.completedAt])

  if (isLoading && !data) {
    return <div className="h-28 animate-pulse rounded-2xl border border-border/70 bg-muted/60" aria-busy="true" />
  }

  if (!data || data.resultType === 'pending') {
    return <p role="status" className="text-sm text-muted-foreground">La operación aún está en curso.</p>
  }

  if (data.resultType === 'success') {
    return (
      <div className="rounded-2xl border border-green-200 bg-green-50 p-4 text-sm text-green-900">
        <p className="font-medium">{data.summary ?? 'La operación terminó correctamente.'}</p>
        {completedAt ? <p className="mt-2 text-xs text-green-800">Completada el {completedAt}</p> : null}
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
      <p className="font-medium">{data.failureReason ?? 'La operación falló sin un motivo resumido disponible.'}</p>
      <p className="mt-2 text-xs text-red-800">
        {data.retryable ? 'Esta operación puede reintentarse.' : 'Esta operación no puede reintentarse.'}
      </p>
      {completedAt ? <p className="mt-1 text-xs text-red-700">Finalizada el {completedAt}</p> : null}
    </div>
  )
}

export default OperationResultSummary
