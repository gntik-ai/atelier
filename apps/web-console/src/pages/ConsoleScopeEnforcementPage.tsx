import { useEffect, useMemo, useState } from 'react'
import { fetchDenials, type ScopeEnforcementDenial } from '@/lib/console-scope-enforcement'
import { ScopeEnforcementDenialsTable } from '@/components/console/ScopeEnforcementDenialsTable'

function countByType(denials: ScopeEnforcementDenial[], type: string) {
  return denials.filter((item) => item.denial_type === type).length
}

export function ConsoleScopeEnforcementPage({ isSuperadmin = true }: { isSuperadmin?: boolean }) {
  const [denials, setDenials] = useState<ScopeEnforcementDenial[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshTick, setRefreshTick] = useState(0)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [range, setRange] = useState(() => ({ from: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), to: new Date().toISOString() }))

  useEffect(() => {
    let active = true
    setLoading(true)
    fetchDenials({ from: range.from, to: range.to }).then((result) => {
      if (!active) return
      setDenials(result.denials)
      setNextCursor(result.nextCursor)
      setLoading(false)
    })
    return () => { active = false }
  }, [range.from, range.to, refreshTick])

  useEffect(() => {
    if (!autoRefresh) return
    const timer = setInterval(() => setRefreshTick((value) => value + 1), 30000)
    return () => clearInterval(timer)
  }, [autoRefresh])

  const summary = useMemo(() => ({
    SCOPE_INSUFFICIENT: countByType(denials, 'SCOPE_INSUFFICIENT'),
    PLAN_ENTITLEMENT_DENIED: countByType(denials, 'PLAN_ENTITLEMENT_DENIED'),
    WORKSPACE_SCOPE_MISMATCH: countByType(denials, 'WORKSPACE_SCOPE_MISMATCH'),
    CONFIG_ERROR: countByType(denials, 'CONFIG_ERROR')
  }), [denials])

  return (
    <section className="space-y-4 p-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Scope Enforcement — Denial Events</h1>
          <p className="text-sm text-slate-600">Recent blocked requests caused by token scope, plan entitlement, workspace isolation or missing endpoint declarations.</p>
        </div>
        <div className="flex gap-2">
          <button className="rounded border px-3 py-2" onClick={() => setRefreshTick((value) => value + 1)}>Refresh</button>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} />Auto-refresh</label>
        </div>
      </header>
      {isSuperadmin && summary.CONFIG_ERROR > 0 ? <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">⚠ Unconfigured endpoints detected. Check platform configuration.</div> : null}
      <div className="grid gap-3 md:grid-cols-4">
        {Object.entries(summary).map(([key, value]) => <div key={key} className="rounded border bg-white p-3 text-sm"><div className="text-slate-500">{key}</div><div className="text-2xl font-semibold">{value}</div></div>)}
      </div>
      <div className="flex gap-2">
        <input aria-label="from-range" type="date" onChange={(event) => setRange((current) => ({ ...current, from: new Date(event.target.value).toISOString() }))} />
        <input aria-label="to-range" type="date" onChange={(event) => setRange((current) => ({ ...current, to: new Date(event.target.value).toISOString() }))} />
        <div className="rounded border bg-white px-3 py-2 text-sm">Total denials in window: {denials.length}</div>
      </div>
      <ScopeEnforcementDenialsTable denials={denials} isLoading={loading} hasMore={Boolean(nextCursor)} isSuperadmin={isSuperadmin} />
    </section>
  )
}
