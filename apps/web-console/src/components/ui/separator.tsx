import { cn } from '@/lib/utils'

export function Separator({ className }: { className?: string }) {
  return <div className={cn('my-4 h-px w-full bg-border', className)} />
}
