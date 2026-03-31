import { Badge } from '@/components/ui/badge'
import type { PlanStatus } from '@/services/planManagementApi'

const classNames: Record<PlanStatus, string> = {
  draft: 'bg-slate-100 text-slate-900',
  active: 'bg-green-100 text-green-900',
  deprecated: 'bg-amber-100 text-amber-900',
  archived: 'bg-zinc-200 text-zinc-900'
}

export function PlanStatusBadge({ status }: { status: PlanStatus }) {
  return <Badge className={classNames[status]}>{status}</Badge>
}
