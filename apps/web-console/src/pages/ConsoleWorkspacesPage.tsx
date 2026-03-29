import { useState } from 'react'

import { CreateWorkspaceWizard } from '@/components/console/wizards/CreateWorkspaceWizard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useConsoleContext } from '@/lib/console-context'

export function ConsoleWorkspacesPage() {
  const [wizardOpen, setWizardOpen] = useState(false)
  const { activeTenant } = useConsoleContext()

  return (
    <main className="space-y-6">
      <header className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <Badge variant="outline">Workspaces</Badge>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Gestión de workspaces</h1>
              <p className="mt-2 text-sm text-muted-foreground">Onboarding guiado de workspaces dentro del tenant operativo activo.</p>
            </div>
          </div>
          <Button type="button" onClick={() => setWizardOpen(true)}>Nuevo workspace</Button>
        </div>
        <div className="mt-3 text-sm text-muted-foreground">Tenant activo: {activeTenant?.label ?? 'Sin tenant seleccionado'}</div>
      </header>

      <section className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Inventario</h2>
        <p className="mt-2 text-sm text-muted-foreground">Crea workspaces nuevos sin salir del shell administrativo.</p>
      </section>

      <CreateWorkspaceWizard open={wizardOpen} onOpenChange={setWizardOpen} />
    </main>
  )
}
