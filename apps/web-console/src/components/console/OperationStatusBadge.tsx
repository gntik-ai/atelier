import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

import type { OperationStatus } from '@/lib/console-operations'

interface OperationStatusBadgeProps {
  status: OperationStatus
  className?: string
}

const STATUS_LABELS: Record<OperationStatus, string> = {
  pending: 'Pendiente',
  running: 'En curso',
  completed: 'Completada',
  failed: 'Fallida'
}

const STATUS_CLASSNAMES: Record<OperationStatus, string> = {
  pending: 'border-slate-300 bg-slate-100 text-slate-700',
  running: 'border-blue-600 bg-blue-600 text-white animate-pulse',
  completed: 'border-green-600 bg-transparent text-green-600',
  failed: 'border-red-600 bg-red-600 text-white'
}

export function OperationStatusBadge({ status, className }: OperationStatusBadgeProps) {
  return (
    <Badge className={cn('inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium', STATUS_CLASSNAMES[status], className)}>
      {STATUS_LABELS[status]}
    </Badge>
  )
}

export default OperationStatusBadge
