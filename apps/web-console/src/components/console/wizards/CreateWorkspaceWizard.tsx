import { ConsolePageState } from '@/components/console/ConsolePageState'
import { WizardShell } from '@/components/console/wizards/WizardShell'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useConsoleContext } from '@/lib/console-context'
import { createValidation, submitWizardRequest, useWizardPermissionCheck, useWizardQuotaCheck, type WizardStepProps } from '@/lib/console-wizards'

interface WorkspaceData { tenantId: string; name: string; description: string; maxFunctions: string; maxDatabases: string }

function TenantStep({ data, context }: WizardStepProps<WorkspaceData>) { return <div><Label>Tenant de contexto</Label><p className="mt-2 text-sm">{data.tenantId || context.tenantId || 'Sin tenant activo'}</p></div> }
function NameStep({ data, onChange, validation }: WizardStepProps<WorkspaceData>) { return <div className="space-y-2"><Label htmlFor="workspace-name">Nombre del workspace</Label><Input id="workspace-name" value={data.name ?? ''} onChange={(e) => onChange({ name: e.target.value })} />{validation.fieldErrors.name ? <p className="text-sm text-destructive">{validation.fieldErrors.name}</p> : null}</div> }
function ConfigStep({ data, onChange }: WizardStepProps<WorkspaceData>) { return <div className="grid gap-4"><div className="space-y-2"><Label htmlFor="workspace-description">Descripción</Label><Textarea id="workspace-description" value={data.description ?? ''} onChange={(e) => onChange({ description: e.target.value })} /></div><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="workspace-max-functions">Máx. funciones</Label><Input id="workspace-max-functions" value={data.maxFunctions ?? ''} onChange={(e) => onChange({ maxFunctions: e.target.value })} /></div><div className="space-y-2"><Label htmlFor="workspace-max-databases">Máx. bases de datos</Label><Input id="workspace-max-databases" value={data.maxDatabases ?? ''} onChange={(e) => onChange({ maxDatabases: e.target.value })} /></div></div></div> }

export function CreateWorkspaceWizard({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated?: () => void }) {
  const { activeTenantId } = useConsoleContext()
  const permission = useWizardPermissionCheck('create_workspace')
  const quota = useWizardQuotaCheck('workspaces.count', 'tenant', activeTenantId, null)
  if (!permission.allowed) return open ? <ConsolePageState kind="blocked" title="Acceso bloqueado" description={permission.reason ?? 'No permitido.'} /> : null
  return <WizardShell<WorkspaceData>
    open={open}
    onOpenChange={onOpenChange}
    title="Nuevo workspace"
    description="Alta guiada de workspace dentro del tenant activo."
    context={{ tenantId: activeTenantId, workspaceId: null, principalRoles: [] }}
    initialData={{ tenantId: activeTenantId ?? '', maxFunctions: '10', maxDatabases: '5' }}
    steps={[
      { id: 'tenant', label: 'Tenant', component: TenantStep, validate: (data) => createValidation(!data.tenantId ? { tenantId: 'Selecciona un tenant.' } : {}) },
      { id: 'name', label: 'Nombre', component: NameStep, validate: (data) => createValidation(!data.name?.trim() ? { name: 'El nombre es obligatorio.' } : {}, quota.available ? undefined : quota.reason ?? 'Sin cuota disponible.') },
      { id: 'config', label: 'Configuración', component: ConfigStep, validate: () => createValidation() }
    ]}
    buildSummary={(data) => [{ label: 'Tenant', value: data.tenantId ?? '' }, { label: 'Nombre', value: data.name ?? '' }, { label: 'Descripción', value: data.description ?? '' }, { label: 'Máx. funciones', value: data.maxFunctions ?? '' }, { label: 'Máx. bases de datos', value: data.maxDatabases ?? '' }]}
    onSubmit={async (data) => {
      const tenantId = data.tenantId ?? activeTenantId ?? ''
      const response = await submitWizardRequest<{ workspaceId: string }>(`/v1/tenants/${tenantId}/workspaces`, { name: data.name ?? '', description: data.description ?? '', initialLimits: { maxFunctions: Number(data.maxFunctions ?? 10), maxDatabases: Number(data.maxDatabases ?? 5) } })
      onCreated?.()
      return { resourceId: response.workspaceId, resourceUrl: '/console/workspaces' }
    }}
  />
}
