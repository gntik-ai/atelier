export function WorkspaceAllocationSummaryTable({ rows }: { rows: Array<{ dimensionKey: string; displayLabel: string; unit?: string | null; tenantEffectiveValue: number; totalAllocated: number; unallocated: number | null; workspaces: Array<{ workspaceId: string; allocatedValue: number }>; isFullyAllocated: boolean }> }) {
  return (
    <div className="rounded-2xl border border-border bg-card/70 p-4">
      <table className="w-full text-sm" aria-label="Workspace allocation summary">
        <caption className="mb-2 text-left font-semibold">Workspace allocation summary</caption>
        <thead>
          <tr className="text-left"><th>Dimension</th><th>Tenant limit</th><th>Allocated</th><th>Unallocated</th><th>Breakdown</th></tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.dimensionKey} className="border-t border-border align-top">
              <td>{row.displayLabel}</td>
              <td>{row.tenantEffectiveValue === -1 ? 'Unlimited' : row.tenantEffectiveValue}</td>
              <td>{row.totalAllocated}</td>
              <td>{row.unallocated ?? '—'}{row.isFullyAllocated ? ' (Fully Allocated)' : ''}</td>
              <td>{row.workspaces.length > 0 ? row.workspaces.map((item) => `${item.workspaceId}: ${item.allocatedValue}`).join(', ') : 'Shared pool'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
