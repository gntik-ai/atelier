import { Badge } from '@/components/ui/badge'
import type { BackupScopeEntry } from '@/lib/backupScopeApi'
import { getCoverageBadgeClass } from './BackupScopeLegend'

function formatRange(range: { min: number; max: number } | null): string {
  if (!range) return '—'
  if (range.min === range.max) return `${range.min} min`
  return `${range.min}–${range.max} min`
}

function OperationalChip({ status }: { status: string }) {
  if (status === 'unknown') return null
  const className = status === 'operational' ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900'
  return <Badge className={className}>{status}</Badge>
}

export function BackupScopeMatrix({ entries, isLoading }: { entries: BackupScopeEntry[]; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div data-testid="matrix-loading" className="space-y-2">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
    )
  }

  if (entries.length === 0) {
    return <div data-testid="matrix-empty" className="text-muted-foreground">No backup scope entries found.</div>
  }

  return (
    <div className="overflow-x-auto" data-testid="backup-scope-matrix">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="sticky left-0 bg-background px-3 py-2 font-semibold">Component</th>
            <th className="px-3 py-2 font-semibold">Profile</th>
            <th className="px-3 py-2 font-semibold">Coverage</th>
            <th className="px-3 py-2 font-semibold">Granularity</th>
            <th className="px-3 py-2 font-semibold">RPO</th>
            <th className="px-3 py-2 font-semibold">RTO</th>
            <th className="px-3 py-2 font-semibold">Limits</th>
            <th className="px-3 py-2 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={`${entry.componentKey}-${entry.profileKey}`} className="border-b" data-testid={`matrix-row-${entry.componentKey}`}>
              <td className="sticky left-0 bg-background px-3 py-2 font-medium">{entry.componentKey}</td>
              <td className="px-3 py-2">{entry.profileKey}</td>
              <td className="px-3 py-2">
                <Badge className={getCoverageBadgeClass(entry.coverageStatus)}>{entry.coverageStatus}</Badge>
              </td>
              <td className="px-3 py-2">{entry.backupGranularity}</td>
              <td className="px-3 py-2" title={entry.rpoRangeMinutes ? `RPO: ${entry.rpoRangeMinutes.min}–${entry.rpoRangeMinutes.max} minutes` : undefined}>
                {formatRange(entry.rpoRangeMinutes)}
              </td>
              <td className="px-3 py-2" title={entry.rtoRangeMinutes ? `RTO: ${entry.rtoRangeMinutes.min}–${entry.rtoRangeMinutes.max} minutes` : undefined}>
                {formatRange(entry.rtoRangeMinutes)}
              </td>
              <td className="px-3 py-2">
                {entry.maxRetentionDays != null && <span className="text-xs">Ret: {entry.maxRetentionDays}d</span>}
                {entry.maxConcurrentJobs != null && <span className="ml-2 text-xs">Jobs: {entry.maxConcurrentJobs}</span>}
                {entry.maxBackupSizeGb != null && <span className="ml-2 text-xs">Max: {entry.maxBackupSizeGb}GB</span>}
              </td>
              <td className="px-3 py-2">
                <OperationalChip status={entry.operationalStatus} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
