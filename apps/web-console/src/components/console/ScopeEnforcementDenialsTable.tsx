import { exportDenialsAsCsv, type ScopeEnforcementDenial } from '@/lib/console-scope-enforcement'

const badgeClasses: Record<string, string> = {
  SCOPE_INSUFFICIENT: 'bg-red-100 text-red-800',
  PLAN_ENTITLEMENT_DENIED: 'bg-orange-100 text-orange-800',
  WORKSPACE_SCOPE_MISMATCH: 'bg-yellow-100 text-yellow-800',
  CONFIG_ERROR: 'bg-gray-100 text-gray-800'
}

export function ScopeEnforcementDenialsTable({ denials, isLoading, onLoadMore, hasMore, isSuperadmin }: { denials: ScopeEnforcementDenial[]; isLoading: boolean; onLoadMore?: () => void; hasMore: boolean; isSuperadmin: boolean }) {
  const handleExport = () => {
    const blob = new Blob([exportDenialsAsCsv(denials)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'scope-enforcement-denials.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  if (!isLoading && denials.length === 0) {
    return <div className="rounded border bg-white p-4 text-sm text-slate-600">No denial events in this period</div>
  }

  return (
    <section className="space-y-3">
      <div className="flex gap-2">
        <select aria-label="denial_type"><option value="">All denial types</option></select>
        <input aria-label="actor_id" className="rounded border px-2 py-1" placeholder="Actor ID" />
        <input aria-label="workspace_id" className="rounded border px-2 py-1" placeholder="Workspace ID" />
        <input aria-label="from" type="date" className="rounded border px-2 py-1" />
        <input aria-label="to" type="date" className="rounded border px-2 py-1" />
        <button className="rounded border px-3 py-1" onClick={handleExport}>Export CSV</button>
      </div>
      <div className="overflow-hidden rounded border bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left"><tr><th className="px-3 py-2">Timestamp</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Actor</th><th className="px-3 py-2">Resource</th><th className="px-3 py-2">Missing</th>{isSuperadmin ? <th className="px-3 py-2">Tenant</th> : null}<th className="px-3 py-2">Source IP</th></tr></thead>
          <tbody>
            {denials.map((denial) => (
              <tr key={`${denial.correlation_id}-${denial.denied_at}`} className="border-t">
                <td className="px-3 py-2">{denial.denied_at}</td>
                <td className="px-3 py-2"><span className={`rounded px-2 py-1 text-xs ${badgeClasses[denial.denial_type] ?? badgeClasses.CONFIG_ERROR}`}>{denial.denial_type}</span></td>
                <td className="px-3 py-2">{denial.actor_id} <span className="text-slate-500">({denial.actor_type})</span></td>
                <td className="px-3 py-2">{denial.http_method} {denial.request_path}</td>
                <td className="px-3 py-2">{denial.missing_scopes?.join(', ') || denial.required_entitlement || '—'}</td>
                {isSuperadmin ? <td className="px-3 py-2">{denial.tenant_id}</td> : null}
                <td className="px-3 py-2">{denial.source_ip ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasMore ? <button className="rounded border px-3 py-1" onClick={onLoadMore}>Load more</button> : null}
    </section>
  )
}
