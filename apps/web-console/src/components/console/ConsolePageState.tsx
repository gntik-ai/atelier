import { Button } from '@/components/ui/button'

export function ConsolePageState({
  kind,
  title,
  description,
  actionLabel,
  onAction
}: {
  kind: 'loading' | 'error' | 'empty' | 'blocked'
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <section
      aria-busy={kind === 'loading'}
      role={kind === 'error' || kind === 'blocked' ? 'alert' : 'status'}
      className="rounded-3xl border border-border bg-card/70 p-6"
    >
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      {actionLabel && onAction ? (
        <div className="mt-4">
          <Button type="button" variant="outline" onClick={onAction}>
            {actionLabel}
          </Button>
        </div>
      ) : null}
    </section>
  )
}
