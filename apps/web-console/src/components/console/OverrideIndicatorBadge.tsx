import { Badge } from '@/components/ui/badge'

export function OverrideIndicatorBadge({ overriddenFromValue, overrideValue }: { overriddenFromValue: number; overrideValue: number }) {
  return <Badge className="border-amber-500/40 bg-amber-500/10 text-amber-700" title={`Plan: ${overriddenFromValue} → Override: ${overrideValue}`}>Override</Badge>
}
