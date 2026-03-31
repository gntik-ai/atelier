import { useEffect, useState } from 'react'
import { ConsolePageState } from '@/components/console/ConsolePageState'
import { WorkspaceAllocationSummaryTable } from '@/components/console/WorkspaceAllocationSummaryTable'
import * as api from '@/services/planManagementApi'

export function ConsoleTenantAllocationSummaryPage() {
  const [data, setData] = useState<api.AllocationSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getTenantAllocationSummary().then(setData).catch((err) => setError(err instanceof Error ? err.message : 'Failed to load allocation summary'))
  }, [])

  if (error) return <ConsolePageState kind="error" title="Allocation summary unavailable" description={error} />
  if (!data) return <ConsolePageState kind="loading" title="Loading allocation summary" description="Fetching workspace sub-quota allocations." />
  if (data.dimensions.every((item) => item.workspaces.length === 0)) return <ConsolePageState kind="empty" title="No workspace allocations yet" description="All dimensions are currently using the shared tenant pool." />

  return (
    <main className="space-y-6">
      <header className="rounded-3xl border border-border bg-card/70 p-6">
        <h1 className="text-2xl font-semibold">Allocation summary</h1>
        <p>Tenant: {data.tenantId}</p>
      </header>
      <WorkspaceAllocationSummaryTable rows={data.dimensions} />
    </main>
  )
}
