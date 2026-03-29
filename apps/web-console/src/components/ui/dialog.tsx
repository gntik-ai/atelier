import * as React from 'react'

import { cn } from '@/lib/utils'

export function Dialog({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean) => void; children: React.ReactNode }) {
  return open ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => onOpenChange(false)}>
      <div onClick={(event) => event.stopPropagation()}>{children}</div>
    </div>
  ) : null
}

export function DialogContent({ className, children }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('w-full max-w-3xl rounded-2xl border border-border bg-background p-6 shadow-xl', className)}>{children}</div>
}

export function DialogHeader({ className, children }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mb-4 space-y-1', className)}>{children}</div>
}

export function DialogTitle({ className, children }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn('text-xl font-semibold', className)}>{children}</h2>
}

export function DialogDescription({ className, children }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm text-muted-foreground', className)}>{children}</p>
}

export function DialogFooter({ className, children }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mt-6 flex items-center justify-end gap-2', className)}>{children}</div>
}

export function DialogClose({ children, asChild = false }: { children: React.ReactNode; asChild?: boolean }) {
  return asChild ? <>{children}</> : <button type="button">{children}</button>
}
