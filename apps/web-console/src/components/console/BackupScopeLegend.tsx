import { Badge } from '@/components/ui/badge'

const STATUS_BADGES: Array<{ key: string; label: string; className: string; description: string }> = [
  { key: 'platform-managed', label: 'Platform Managed', className: 'bg-emerald-100 text-emerald-900', description: 'Backup is fully managed by the platform' },
  { key: 'operator-managed', label: 'Operator Managed', className: 'bg-amber-100 text-amber-900', description: 'Backup must be configured by the operator' },
  { key: 'not-supported', label: 'Not Supported', className: 'bg-red-100 text-red-900', description: 'Backup is not available for this component on this profile' },
  { key: 'unknown', label: 'Unknown', className: 'bg-slate-100 text-slate-900', description: 'Backup status cannot be determined' }
]

const OPERATIONAL_BADGES: Array<{ key: string; label: string; className: string }> = [
  { key: 'operational', label: 'Operational', className: 'bg-emerald-100 text-emerald-900' },
  { key: 'degraded', label: 'Degraded', className: 'bg-amber-100 text-amber-900' },
  { key: 'unknown', label: 'Unknown', className: 'bg-slate-100 text-slate-900' }
]

export function BackupScopeLegend() {
  return (
    <div className="rounded-2xl border border-border bg-card/70 p-4" data-testid="backup-scope-legend">
      <div className="mb-3 text-sm font-semibold">Coverage Status</div>
      <div className="flex flex-wrap gap-3">
        {STATUS_BADGES.map((badge) => (
          <div key={badge.key} className="flex items-center gap-2">
            <Badge className={badge.className}>{badge.label}</Badge>
            <span className="text-xs text-muted-foreground">{badge.description}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 mb-3 text-sm font-semibold">Operational Status</div>
      <div className="flex flex-wrap gap-3">
        {OPERATIONAL_BADGES.map((badge) => (
          <div key={badge.key} className="flex items-center gap-2">
            <Badge className={badge.className}>{badge.label}</Badge>
          </div>
        ))}
      </div>
    </div>
  )
}

export function getCoverageBadgeClass(status: string): string {
  const badge = STATUS_BADGES.find((b) => b.key === status)
  return badge?.className ?? 'bg-slate-100 text-slate-900'
}
