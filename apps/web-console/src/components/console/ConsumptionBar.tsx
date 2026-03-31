import { cn } from '@/lib/utils'

function getTone(current: number, limit: number) {
  if (limit <= 0) return current > 0 ? 'bg-red-500' : 'bg-red-400'
  const ratio = current / limit
  if (ratio >= 1) return 'bg-red-500'
  if (ratio >= 0.8) return 'bg-amber-500'
  return 'bg-emerald-500'
}

export function ConsumptionBar({ current, limit, label }: { current: number | null; limit: number; label?: string }) {
  if (limit === -1) {
    return <div aria-label={label ?? 'Unlimited usage'} className="text-sm"><span>{current ?? '—'}</span> <span className="text-muted-foreground">/ Unlimited</span></div>
  }
  if (current === null) {
    return <div aria-label={label ?? 'Usage unavailable'} className="text-sm text-muted-foreground">Data unavailable</div>
  }
  const percentage = limit <= 0 ? 100 : Math.min((current / limit) * 100, 100)
  return (
    <div className="space-y-2">
      <div className="text-sm">{current} / {limit}</div>
      <div role="progressbar" aria-label={label ?? 'Consumption progress'} aria-valuemin={0} aria-valuemax={limit} aria-valuenow={current} className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div data-testid="consumption-bar-fill" className={cn('h-full rounded-full transition-all', getTone(current, limit))} style={{ width: `${percentage}%` }} />
      </div>
    </div>
  )
}
