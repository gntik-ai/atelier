import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'

export function NotFoundPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-16 text-foreground">
      <section className="w-full max-w-xl rounded-3xl border border-border bg-card/80 p-10 text-center shadow-xl shadow-black/10">
        <p className="text-sm font-medium uppercase tracking-[0.3em] text-muted-foreground">404</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">Página no encontrada</h1>
        <p className="mt-4 text-base leading-7 text-muted-foreground">
          La ruta solicitada no existe todavía en la consola administrativa. Puedes volver al punto de entrada
          principal y continuar desde allí.
        </p>
        <div className="mt-8 flex justify-center">
          <Button asChild variant="secondary">
            <Link to="/">Volver al inicio</Link>
          </Button>
        </div>
      </section>
    </main>
  )
}
