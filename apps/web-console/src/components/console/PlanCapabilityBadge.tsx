import { Badge } from '@/components/ui/badge'

export function PlanCapabilityBadge({ enabled, label }: { enabled: boolean; label?: string }) {
  return <Badge aria-label={`${label ?? 'Capability'} ${enabled ? 'enabled' : 'disabled'}`} className={enabled ? 'bg-green-100 text-green-900' : 'bg-slate-100 text-slate-900'}>{enabled ? 'Enabled' : 'Disabled'}</Badge>
}
