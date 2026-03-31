import type { LimitProfileRow } from '@/services/planManagementApi'

function toMap(profile: LimitProfileRow[]) { return new Map(profile.map((item) => [item.dimensionKey, item])) }

export function PlanComparisonView({ currentPlan, targetPlan }: { currentPlan: LimitProfileRow[]; targetPlan: LimitProfileRow[] }) {
  const current = toMap(currentPlan)
  const keys = Array.from(new Set([...current.keys(), ...targetPlan.map((item) => item.dimensionKey)]))
  return (
    <table className="w-full text-sm">
      <thead><tr><th>Dimension</th><th>Current</th><th>Target</th><th>Change</th></tr></thead>
      <tbody>
        {keys.map((key) => {
          const currentValue = current.get(key)?.effectiveValue ?? 0
          const targetValue = targetPlan.find((item) => item.dimensionKey === key)?.effectiveValue ?? 0
          const state = targetValue > currentValue ? 'increased' : targetValue < currentValue ? 'decreased' : 'unchanged'
          return <tr key={key} data-change={state}><td>{key}</td><td>{String(currentValue)}</td><td>{String(targetValue)}</td><td>{state}</td></tr>
        })}
      </tbody>
    </table>
  )
}
