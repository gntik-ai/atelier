import { ArrowRight, KeyRound } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export function WelcomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-16 text-foreground">
      <section
        aria-labelledby="foundation-title"
        className="w-full max-w-3xl rounded-3xl border border-border bg-card/80 p-10 shadow-2xl shadow-black/20 backdrop-blur"
      >
        <Badge className="mb-6" variant="secondary">
          Fundación de consola lista
        </Badge>
        <div className="space-y-6">
          <div className="space-y-3">
            <p className="text-sm font-medium uppercase tracking-[0.3em] text-muted-foreground">
              EP-14 / US-UI-01-T02
            </p>
            <h1 id="foundation-title" className="text-4xl font-semibold tracking-tight sm:text-5xl">
              In Falcone Console
            </h1>
            <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
              Consola administrativa del producto BaaS multi-tenant preparada para crecer con login,
              navegación contextual y flujos seguros basados en Keycloak por medio de la familia pública
              `/v1/auth/*`.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <article className="rounded-2xl border border-border/80 bg-background/60 p-5">
              <h2 className="text-base font-semibold">Stack confirmado</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                React, Tailwind CSS y componentes base con shadcn/ui ya operativos dentro del monorepo.
              </p>
            </article>
            <article className="rounded-2xl border border-border/80 bg-background/60 p-5">
              <h2 className="text-base font-semibold">Acceso listo para validar</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                La consola ya puede exponer el flujo de login con feedback para estados especiales,
                recuperación de contraseña y descubrimiento de signup.
              </p>
            </article>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button asChild>
              <a href="/login">
                Ir al login
                <KeyRound className="h-4 w-4" aria-hidden="true" />
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href="#foundation-overview">
                Ver alcance inicial
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </a>
            </Button>
            <Badge variant="outline">Sin dependencia de SDKs de navegador para autenticar</Badge>
          </div>

          <div id="foundation-overview" className="rounded-2xl border border-dashed border-border/80 p-5">
            <p className="text-sm leading-6 text-muted-foreground">
              Esta pantalla valida la disponibilidad de la SPA, el sistema de estilos, el enrutamiento base
              y el acceso inicial de la consola. Las rutas protegidas, la persistencia robusta de sesión y
              el shell persistente se incorporarán en tareas posteriores sin rehacer la base tecnológica.
            </p>
          </div>
        </div>
      </section>
    </main>
  )
}
