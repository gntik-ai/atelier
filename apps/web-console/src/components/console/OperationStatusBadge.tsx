import { Badge } from '@/components/ui/badge'
import {
  OPERATION_STATUS_LABELS,
  OPERATION_STATUS_TONES
} from '@/lib/generated/async-operation-status-vocabulary.mjs'
import type { OperationStatusTone } from '@/lib/generated/async-operation-status-vocabulary.mjs'
import { cn } from '@/lib/utils'

import type { OperationStatus } from '@/lib/console-operations'

interface OperationStatusBadgeProps {
  status: OperationStatus
  className?: string
}

const STATUS_CLASSNAMES: Record<OperationStatusTone, string> = {
  neutral: 'border-border bg-muted/40 text-muted-foreground',
  progress: 'border-sky-500/30 bg-sky-500/10 text-sky-300 motion-safe:animate-pulse',
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  danger: 'border-red-500/30 bg-red-500/10 text-red-300',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-300'
}

export function OperationStatusBadge({ status, className }: OperationStatusBadgeProps) {
  return (
    <Badge className={cn('inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium', STATUS_CLASSNAMES[OPERATION_STATUS_TONES[status]], className)}>
      {OPERATION_STATUS_LABELS[status]}
    </Badge>
  )
}

export default OperationStatusBadge
