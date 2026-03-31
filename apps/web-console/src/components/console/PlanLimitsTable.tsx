import type { LimitProfileRow } from '@/services/planManagementApi'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function PlanLimitsTable({ dimensions, editable, onUpdate, onRemove }: { dimensions: LimitProfileRow[]; editable: boolean; onUpdate?: (key: string, value: number) => void; onRemove?: (key: string) => void }) {
  return (
    <table className="w-full text-sm">
      <thead><tr><th>Dimension</th><th>Value</th><th>Source</th><th>Unit</th><th /></tr></thead>
      <tbody>
        {dimensions.map((dimension) => (
          <tr key={dimension.dimensionKey}>
            <td>{dimension.displayLabel}</td>
            <td>
              {editable ? (
                <Input aria-label={`${dimension.dimensionKey}-value`} type="number" min={-1} defaultValue={dimension.explicitValue ?? dimension.effectiveValue} onBlur={(event) => onUpdate?.(dimension.dimensionKey, Number(event.currentTarget.value))} />
              ) : dimension.effectiveValue === -1 ? 'Unlimited' : String(dimension.effectiveValue)}
            </td>
            <td>{dimension.effectiveValue === -1 ? 'unlimited' : dimension.source}</td>
            <td>{dimension.unit ?? 'count'}</td>
            <td>{editable ? <Button type="button" variant="outline" onClick={() => onRemove?.(dimension.dimensionKey)}>Reset</Button> : null}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
