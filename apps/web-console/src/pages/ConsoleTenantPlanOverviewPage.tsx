import { useEffect, useState } from 'react'
import { CapabilityStatusGrid } from '@/components/console/CapabilityStatusGrid'
import { ConsolePageState } from '@/components/console/ConsolePageState'
import { QuotaConsumptionTable } from '@/components/console/QuotaConsumptionTable'
import * as api from '@/services/planManagementApi'

export function ConsoleTenantPlanOverviewPage() {
  const [summary, setSummary] = useState<api.CurrentEffectiveEntitlementSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getEffectiveEntitlements(undefined, { includeConsumption: true }).then(setSummary).catch((err) => setError(err instanceof Error ? err.message : 'Failed to load plan overview'))
  }, [])

  if (error) return <ConsolePageState kind="error" title="Plan overview unavailable" description={error} />
  if (!summary) return <ConsolePageState kind="loading" title="Loading plan overview" description="Fetching current effective entitlements." />
  if (summary.noAssignment) return <ConsolePageState kind="empty" title="No plan assigned" description="Your tenant does not currently have a plan assignment. Catalog defaults remain active." />

  const overLimitDimensionCount = summary.quotaDimensions.filter((item) => item.usageStatus === 'over_limit').length
  return (
    <main className="space-y-6">
      <header className="rounded-3xl border border-border bg-card/70 p-6">
        <h1 className="text-2xl font-semibold">My plan</h1>
        <p>{summary.planDisplayName}</p>
        <p>{summary.planSlug}</p>
        <p>Latest history entry: {summary.latestHistoryEntryId ?? '—'}</p>
      </header>
      {overLimitDimensionCount > 0 ? <section className="rounded-3xl border border-amber-500 bg-amber-50 p-4">{overLimitDimensionCount} dimensions are currently over limit.</section> : null}
      <QuotaConsumptionTable title="Current effective quotas" rows={summary.quotaDimensions.map((item) => ({ dimensionKey: item.dimensionKey, displayLabel: item.displayLabel ?? item.dimensionKey, unit: item.unit, effectiveValue: item.effectiveValue ?? -1, source: 'plan', currentUsage: item.observedUsage ?? null, usageStatus: item.usageStatus, usageUnknownReason: item.usageUnknownReason }))} />
      <CapabilityStatusGrid capabilities={summary.capabilities.map((item) => ({ capabilityKey: item.capabilityKey, displayLabel: item.displayLabel ?? item.capabilityKey, enabled: item.enabled, source: 'plan' }))} />
    </main>
  )
}
