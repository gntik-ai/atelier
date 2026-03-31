import { Badge } from '@/components/ui/badge'
import { ConsumptionBar } from './ConsumptionBar'
import { OverrideIndicatorBadge } from './OverrideIndicatorBadge'

export interface QuotaDimensionRow {
  dimensionKey: string
  displayLabel: string
  unit?: string | null
  effectiveValue: number
  source: 'override' | 'plan' | 'catalog_default'
  quotaType?: 'hard' | 'soft'
  currentUsage: number | null
  usageStatus: 'within_limit' | 'approaching_limit' | 'at_limit' | 'over_limit' | 'unknown'
  usageUnknownReason?: string | null
  overriddenFromValue?: number | null
  originalPlanValue?: number | null
}

export function QuotaConsumptionTable({ rows, showOverrideDetails = false, title = 'Quota consumption' }: { rows: QuotaDimensionRow[]; showOverrideDetails?: boolean; title?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card/70 p-4">
      <table className="w-full text-sm" aria-label={title}>
        <caption className="mb-2 text-left font-semibold">{title}</caption>
        <thead>
          <tr className="text-left"><th>Dimension</th><th>Limit</th><th>Source</th><th>Consumption</th><th>Status</th></tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.dimensionKey} className="border-t border-border align-top">
              <td className="py-3">
                <div className="font-medium">{row.displayLabel}</div>
                {showOverrideDetails && row.source === 'override' && row.originalPlanValue !== undefined && row.originalPlanValue !== null ? <div className="mt-2"><OverrideIndicatorBadge overriddenFromValue={row.originalPlanValue} overrideValue={row.effectiveValue} /></div> : null}
              </td>
              <td>{row.effectiveValue === -1 ? 'Unlimited' : row.effectiveValue}</td>
              <td><Badge variant="outline">{row.source}</Badge></td>
              <td>
                <ConsumptionBar current={row.currentUsage} limit={row.effectiveValue} label={`${row.displayLabel} consumption`} />
                {row.usageStatus === 'unknown' ? <div className="mt-1 text-xs text-muted-foreground">Data unavailable</div> : null}
              </td>
              <td>{row.usageStatus}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
