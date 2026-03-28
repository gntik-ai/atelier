import { Badge } from '@/components/ui/badge'

interface ConsolePlaceholderPageProps {
  title: string
  description: string
  badge?: string
}

export function ConsolePlaceholderPage({ title, description, badge }: ConsolePlaceholderPageProps) {
  return (
    <section className="space-y-6">
      <div className="space-y-3">
        {badge ? <Badge variant="secondary">{badge}</Badge> : null}
        <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{title}</h1>
        <p className="max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg">{description}</p>
      </div>

      <div className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
        <div className="space-y-3 rounded-2xl border border-dashed border-border/70 p-5">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">Shell de consola base</p>
          <p className="text-sm leading-6 text-muted-foreground">
            Esta vista es un placeholder deliberado de T04: valida el layout persistente, la navegación principal y los accesos de
            usuario sin bloquear las siguientes entregas funcionales del producto.
          </p>
        </div>
      </div>
    </section>
  )
}
