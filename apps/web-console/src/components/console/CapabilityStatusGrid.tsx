import { Badge } from '@/components/ui/badge'

export function CapabilityStatusGrid({ capabilities }: { capabilities: Array<{ capabilityKey: string; displayLabel: string; enabled: boolean; source: 'plan' | 'catalog_default' }> }) {
  return (
    <div className="rounded-2xl border border-border bg-card/70 p-4">
      <div className="mb-3 text-sm font-semibold">Capabilities</div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {capabilities.map((capability) => (
          <div key={capability.capabilityKey} className="rounded-xl border border-border p-3">
            <div className="font-medium">{capability.displayLabel}</div>
            <div className="mt-2 flex gap-2">
              <Badge className={capability.enabled ? 'bg-emerald-100 text-emerald-900' : 'bg-slate-100 text-slate-900'}>{capability.enabled ? 'Enabled' : 'Disabled'}</Badge>
              <Badge variant="outline">{capability.source === 'plan' ? 'plan' : 'platform default'}</Badge>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
