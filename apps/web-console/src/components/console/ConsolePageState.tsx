import { useId, type ReactNode, type RefObject } from 'react'
import { Button } from '@/components/ui/button'

export function ConsolePageState({
  kind,
  title,
  description,
  actionLabel,
  onAction,
  actionRef,
  icon,
  children
}: {
  kind: 'loading' | 'error' | 'empty' | 'blocked'
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
  actionRef?: RefObject<HTMLButtonElement>
  icon?: ReactNode
  // Extra inline content rendered below the title/description (and the actionLabel/onAction
  // button, if present) — e.g. WorkspaceRequiredState's inline workspace picker / create-workspace
  // CTA (#742). Optional so every pre-existing call site (title + description [+ a single action])
  // is unaffected.
  children?: ReactNode
}) {
  const titleId = useId()
  const descriptionId = useId()

  return (
    <section
      aria-busy={kind === 'loading'}
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      role={kind === 'error' || kind === 'blocked' ? 'alert' : 'status'}
      className="rounded-3xl border border-border bg-card/70 p-5 shadow-sm sm:p-6"
    >
      <div className="flex gap-4">
        {icon ? (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-background/60 text-muted-foreground" aria-hidden="true">
            {icon}
          </div>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="space-y-2">
            <h2 id={titleId} className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
            <p id={descriptionId} className="max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
          </div>
          {actionLabel && onAction ? (
            <div className="pt-4">
              <Button ref={actionRef} type="button" variant="outline" className="w-full sm:w-auto" onClick={onAction}>
                {actionLabel}
              </Button>
            </div>
          ) : null}
          {children ? <div className="pt-4">{children}</div> : null}
        </div>
      </div>
    </section>
  )
}
