import { useState } from 'react'

import { CreateTenantWizard } from '@/components/console/wizards/CreateTenantWizard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export function ConsoleTenantsPage() {
  const [wizardOpen, setWizardOpen] = useState(false)

  return (
    <main className="space-y-6">
      <header className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <Badge variant="outline">Tenants</Badge>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Gestión de tenants</h1>
              <p className="mt-2 text-sm text-muted-foreground">Alta guiada y gobierno inicial de tenants de plataforma.</p>
            </div>
          </div>
          <Button type="button" onClick={() => setWizardOpen(true)}>Nuevo tenant</Button>
        </div>
      </header>

      <section className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Inventario</h2>
        <p className="mt-2 text-sm text-muted-foreground">Desde esta superficie se inicia el onboarding guiado de nuevos tenants.</p>
      </section>

      <CreateTenantWizard open={wizardOpen} onOpenChange={setWizardOpen} />
    </main>
  )
}
