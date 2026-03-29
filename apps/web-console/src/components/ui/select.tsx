import * as React from 'react'

import { cn } from '@/lib/utils'

export function Select(props: React.ComponentProps<'select'>) {
  return <select className={cn('flex h-11 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50', props.className)} {...props} />
}

export function SelectTrigger(props: React.ComponentProps<'select'>) {
  return <Select {...props} />
}

export function SelectContent({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

export function SelectItem(props: React.ComponentProps<'option'>) {
  return <option {...props} />
}

export function SelectValue({ placeholder }: { placeholder?: string }) {
  return <>{placeholder ?? null}</>
}
