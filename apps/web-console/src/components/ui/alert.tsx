import type { HTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

type AlertVariant = 'default' | 'success' | 'destructive'

function Alert({ className, variant = 'default', ...props }: HTMLAttributes<HTMLDivElement> & { variant?: AlertVariant }) {
  return (
    <div
      role="alert"
      className={cn(
        'rounded-2xl border px-4 py-3 text-sm leading-6',
        variant === 'default' && 'border-border bg-muted/40 text-foreground',
        variant === 'success' && 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100',
        variant === 'destructive' && 'border-destructive/40 bg-destructive/10 text-destructive',
        className
      )}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn('font-semibold tracking-tight', className)} {...props} />
}

function AlertDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('mt-1 text-sm leading-6', className)} {...props} />
}

export { Alert, AlertDescription, AlertTitle }
