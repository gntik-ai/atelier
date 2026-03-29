import type { ConsoleMetricDimensionView } from '@/lib/console-metrics'

export function ConsoleMetricDimensionRow({ dimension }: { dimension: ConsoleMetricDimensionView }) {
  const progressValue = dimension.pctUsed ?? 0
  return (
    <div className="rounded-2xl border border-border bg-card/50 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-medium">{dimension.displayName}</h3>
          <p className="text-sm text-muted-foreground">{dimension.dimensionId}</p>
        </div>
        <div className="text-right text-sm">
          <p>{dimension.measuredValue}{dimension.hardLimit ? ` / ${dimension.hardLimit}` : ''}</p>
          <p className="text-muted-foreground">{dimension.pctUsed !== null ? `${dimension.pctUsed}% usado` : 'Sin límite fijo'}</p>
        </div>
      </div>
      <progress className="mt-3 h-3 w-full" max={100} value={progressValue} aria-label={`Uso de ${dimension.displayName}`} />
    </div>
  )
}
